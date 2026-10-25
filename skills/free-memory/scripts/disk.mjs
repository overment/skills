#!/usr/bin/env node
// free-memory disk: find disk space that agent work left behind, sort it into delete / ask / keep, and delete safely.
//
//   node scripts/disk.mjs scan [--keep] [--json] [--root <dir>]... [--temp <dir>]...
//                              [--min-age 60m] [--temp-age 2d] [--idle-age 14d]
//   node scripts/disk.mjs delete <id> [<id> ...] [--dry-run]
//   node scripts/disk.mjs delete --suggested [--except <id>,<id>] [--dry-run]
//
// Kinds:
//   worktree  a linked git worktree. Removed with `git worktree remove` (never --force), so git itself
//             refuses a locked worktree or one with unsaved edits. Branches and commits stay.
//   prune     a worktree record whose folder is already gone. `git worktree prune` drops the record.
//   build     output that a build or an install makes again: a folder with CACHEDIR.TAG (Cargo target),
//             node_modules next to a lockfile, framework build caches.
//   temp      a leftover file or folder at the top of a temp folder.
//   clone     a repository at the top of a temp folder.
//   orphan    a folder that says it is a worktree, but git no longer knows it.
//   cache     a tool cache in the home folder.
//
// scan saves its items to $TMPDIR/free-memory-disk-scan.json. delete only acts on items from that scan,
// checks each one again just before it deletes it, and refuses items marked keep.
// Works on macOS and Linux. Needs git and du; lsof on macOS. No dependencies.

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAC = process.platform === 'darwin';
const HOME = os.homedir();
const ME = process.getuid();
const CACHE = path.join(os.tmpdir(), 'free-memory-disk-scan.json');
const SCAN_TTL = 60 * 60; // delete refuses a scan older than this
const REPO_DEPTH = 4; // how deep scan looks for repositories below each root
const POOL = 8; // parallel git and du processes

const WALK_SKIP = new Set(['node_modules', 'Library', 'Applications', 'Movies', 'Music', 'Pictures', '.Trash', '.cache',
  '.npm', '.cargo', '.rustup', '.bun', '.pnpm-store', '.docker', '.local', '.nvm', '.vscode', '.cursor', 'target']);
const BUILD_NAMES = new Set(['node_modules', '.next', '.svelte-kit', '.turbo', '.parcel-cache', '.nuxt']);
const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb', 'npm-shrinkwrap.json'];
const TOOL_CACHES = [ // [path below home, how it comes back]
  ['.npm/_cacache', 'npm downloads packages again (or run npm cache clean --force)'],
  ['.bun/install/cache', 'bun downloads packages again (or run bun pm cache rm)'],
  ['.cargo/registry', 'cargo downloads crates again'],
  ['.local/share/pnpm/store', 'pnpm downloads packages again; prefer pnpm store prune'],
  ['Library/pnpm/store', 'pnpm downloads packages again; prefer pnpm store prune'],
  ['Library/Caches/ms-playwright', 'tests need npx playwright install again'],
  ['Library/Caches/pnpm', 'pnpm downloads packages again'],
  ['Library/Caches/Yarn', 'yarn downloads packages again (or run yarn cache clean)'],
  ['Library/Caches/node-gyp', 'native modules download headers again'],
  ['Library/Caches/go-build', 'go builds again (or run go clean -cache)'],
  ['Library/Caches/pip', 'pip downloads packages again (or run pip cache purge)'],
  ['Library/Caches/Homebrew', 'prefer brew cleanup'],
  ['.cache/ms-playwright', 'tests need npx playwright install again'],
];
const CACHE_MIN_KB = 512 * 1024; // smaller tool caches are not worth a question
// System indexers and scanners open files everywhere. They do not mean that somebody works in a folder.
const SCANNERS = /^(mds|mds_stores|mdworker|mdworker_shared|mdsync|StorageManagementService|fseventsd|backupd|photoanalysisd|mediaanalysisd|lsof|du)$/;
const APP_DATA = [path.join(HOME, 'Library'), path.join(HOME, '.local/share'), path.join(HOME, '.config')]; // apps manage what they keep here

// ---------- helpers ----------

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 512 << 20, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C' }, ...opts });
  } catch (e) {
    return e.stdout || ''; // lsof exits 1 when some processes are gone; the output is still good
  }
}

function runA(cmd, args, timeout = 0) { // resolves to { code, out, err }; code is null on a timeout
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 256 << 20, timeout, env: { ...process.env, LC_ALL: 'C' } }, (e, stdout, stderr) => {
      resolve({ code: e ? (e.killed ? null : (typeof e.code === 'number' ? e.code : 1)) : 0, out: stdout || '', err: (stderr || '').trim() });
    });
  });
}

async function pool(list, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(POOL, list.length) }, async () => {
    while (i < list.length) await fn(list[i++]);
  }));
}

const tilde = (s) => (s.startsWith(HOME + '/') || s === HOME ? '~' + s.slice(HOME.length) : s);
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith('/') ? parent : parent + '/');
const now = () => Date.now() / 1000;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const progress = (msg) => process.stderr.write(`${msg}\n`);

function real(p) {
  try { return realpathSync(p); } catch { return path.resolve(p); }
}

function lst(p) {
  try { return lstatSync(p); } catch { return null; }
}

function mtime(p) {
  try { return statSync(p).mtimeMs / 1000; } catch { return 0; }
}

function readText(p) {
  try { return readFileSync(p, 'utf8').trim(); } catch { return ''; }
}

function fmtAge(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(sec / 86400)}d${Math.floor((sec % 86400) / 3600)}h`;
}

function fmtSize(kb) {
  if (kb == null) return '?';
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}G`;
  return `${Math.round(kb / 1024)}M`;
}

function diskSummary(dir) { // POSIX df: filesystem, 1024-blocks, used, available, capacity, mount point
  const line = run('df', ['-kP', dir]).trim().split('\n').pop()?.split(/\s+/) || [];
  const [total, used, avail] = [+line[1], +line[2], +line[3]];
  if (!total) return { text: 'unknown', availKB: 0 };
  const gb = (kb) => `${((kb * 1024) / 1e9).toFixed(1)} GB`;
  return { text: `${gb(avail)} free of ${gb(total)} (${Math.round((used / (used + avail)) * 100)}% used) on ${line.slice(5).join(' ') || dir}`, availKB: avail };
}

// Newest change time of a folder, its direct entries, and the named extra paths. Cheap, and enough to
// tell a folder somebody touched in the last hour from one nobody touched for days.
function lastChange(dir, extra = []) {
  let t = mtime(dir);
  try {
    for (const e of readdirSync(dir)) t = Math.max(t, lst(path.join(dir, e))?.mtimeMs / 1000 || 0);
  } catch {}
  for (const p of extra) t = Math.max(t, mtime(p));
  return t;
}

// ---------- processes that use a path ----------

// Every folder that holds a process's working directory, an open file, a path in its arguments, or its
// CARGO_TARGET_DIR. An item is in use when its path is one of these folders.
function readHolders() {
  const self = new Set([process.pid]);
  const table = new Map();
  for (const line of run('ps', ['-A', '-o', 'pid=,ppid=,uid=,comm=']).split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (m) table.set(+m[1], { ppid: +m[2], uid: +m[3], exe: path.basename(m[4]) });
  }
  for (let p = table.get(process.pid)?.ppid; p && p !== 1 && !self.has(p); p = table.get(p)?.ppid) self.add(p);

  const held = new Map(); // folder -> { pid, exe, self }
  const add = (pid, raw) => {
    if (!raw || raw[0] !== '/') return;
    let p = raw.replace(/\/+$/, '');
    if (MAC) p = p.replace(/^\/(tmp|var|etc)(\/|$)/, '/private/$1$2');
    const exe = table.get(pid)?.exe || '?';
    if (SCANNERS.test(exe)) return;
    const info = { pid, exe, self: self.has(pid) };
    for (let d = p; d && d !== '/'; d = path.dirname(d)) {
      const cur = held.get(d);
      if (cur && (!cur.self || info.self)) break; // this folder and its parents are already marked
      held.set(d, info);
    }
  };
  const mine = [...table.entries()].filter(([, t]) => t.uid === ME).map(([pid]) => pid);

  if (MAC || !existsSync('/proc')) {
    let pid = 0;
    for (const line of run('lsof', ['-nP', '-w', '-u', String(ME), '-Fpn']).split('\n')) {
      if (line[0] === 'p') pid = +line.slice(1);
      else if (line[0] === 'n') add(pid, line.slice(1).replace(/ \(.*\)$/, ''));
    }
    // Paths in arguments, and CARGO_TARGET_DIR: a build tool uses its target folder without holding a file open.
    for (const line of run('ps', ['-x', '-ww', '-o', 'pid=,command=']).split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (m) for (const tok of m[2].split(/[\s=:,]+/)) if (tok.startsWith('/')) add(+m[1], tok);
    }
    for (const line of run('ps', ['-x', '-ww', '-E', '-o', 'pid=,command=']).split('\n')) {
      const pid = +line.trim().split(/\s/)[0];
      for (const m of line.matchAll(/\bCARGO_TARGET_DIR=(\S+)/g)) add(pid, m[1]);
    }
  } else {
    for (const pid of mine) {
      try { add(pid, readlinkSync(`/proc/${pid}/cwd`)); } catch {}
      try {
        for (const fd of readdirSync(`/proc/${pid}/fd`)) {
          try { add(pid, readlinkSync(`/proc/${pid}/fd/${fd}`)); } catch {}
        }
      } catch {}
      try { for (const tok of readFileSync(`/proc/${pid}/cmdline`, 'utf8').split(/[\0=:,]/)) add(pid, tok); } catch {}
      try {
        const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').find((e) => e.startsWith('CARGO_TARGET_DIR='));
        if (env) add(pid, env.slice('CARGO_TARGET_DIR='.length));
      } catch {}
    }
  }
  return { held, alive: (pid) => table.has(pid) };
}

// ---------- discovery ----------

function defaultTemps() {
  const list = [os.tmpdir(), '/tmp', '/var/tmp'].filter((p) => existsSync(p)).map(real);
  return [...new Set(list)];
}

// Where git keeps a worktree's admin folder, and the repository it belongs to.
function worktreeLink(dir) {
  const text = readText(path.join(dir, '.git'));
  const m = text.match(/^gitdir:\s*(.+)$/m);
  if (!m) return null;
  const admin = path.resolve(dir, m[1].trim());
  if (!existsSync(admin)) return { admin, common: null };
  const common = path.resolve(admin, readText(path.join(admin, 'commondir')) || '../..');
  return { admin, common: existsSync(common) ? real(common) : null };
}

const mainOf = (common) => (path.basename(common) === '.git' ? path.dirname(common) : common);

function findRepos(roots, temps) {
  const mains = new Set();
  const linked = new Set();
  const stack = roots.map((r) => [real(r), 0]);
  const seen = new Set();
  while (stack.length) {
    const [dir, depth] = stack.pop();
    if (seen.has(dir) || temps.some((t) => inside(dir, t))) continue;
    seen.add(dir);
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    const git = ents.find((e) => e.name === '.git');
    if (git) {
      if (git.isDirectory()) mains.add(dir);
      else if (git.isFile()) linked.add(dir);
      continue;
    }
    if (depth >= REPO_DEPTH) continue;
    for (const e of ents) if (e.isDirectory() && !WALK_SKIP.has(e.name)) stack.push([path.join(dir, e.name), depth + 1]);
  }
  return { mains, linked };
}

// Build output below a folder, without going into the folders it finds.
function findBuilds(dir, depth = 3) {
  const out = [];
  const walk = (d, level) => {
    let ents;
    try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (BUILD_NAMES.has(e.name) || existsSync(path.join(p, 'CACHEDIR.TAG'))) { out.push(p); continue; }
      if (level < depth && !existsSync(path.join(p, '.git'))) walk(p, level + 1);
    }
  };
  walk(dir, 1);
  return out;
}

// A lockfile beside node_modules or in a folder above it, up to the checkout root (workspace packages).
function hasLockfile(dir, top) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (LOCKFILES.some((f) => existsSync(path.join(d, f)))) return true;
    if (d === top || !inside(d, top) || d === path.dirname(d)) return false;
  }
}

function isBuild(p) {
  return BUILD_NAMES.has(path.basename(p)) || existsSync(path.join(p, 'CACHEDIR.TAG')) || existsSync(path.join(p, '.rustc_info.json'));
}

// A .git anywhere in the top levels of a folder: a temp folder that holds repositories or worktrees.
function holdsRepo(dir, depth = 3, budget = { n: 2000 }) {
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  if (ents.some((e) => e.name === '.git')) return true;
  if (depth <= 0) return false;
  for (const e of ents) {
    if (!e.isDirectory() || BUILD_NAMES.has(e.name) || --budget.n < 0) continue;
    if (holdsRepo(path.join(dir, e.name), depth - 1, budget)) return true;
  }
  return false;
}

function listWorktrees(main) {
  const out = [];
  for (const block of run('git', ['-C', main, 'worktree', 'list', '--porcelain']).split('\n\n')) {
    const lines = block.split('\n').filter(Boolean);
    const get = (k) => lines.find((l) => l === k || l.startsWith(k + ' '));
    const wt = get('worktree')?.slice(9);
    if (!wt) continue;
    const locked = get('locked');
    out.push({
      path: wt,
      head: get('HEAD')?.slice(5) || null,
      branch: get('branch')?.slice('branch refs/heads/'.length) || null,
      bare: !!get('bare'),
      locked: locked ? locked.slice(7).trim() || '(no reason given)' : null,
      missing: !!get('prunable') || !existsSync(wt),
    });
  }
  return out;
}

// The lines a worktree's work should have landed on: the main checkout's branch and the default branch.
function basesOf(main) {
  const out = [];
  const add = (name, ref) => {
    const sha = run('git', ['-C', main, 'rev-parse', '--verify', '-q', `${ref}^{commit}`]).trim();
    if (sha && !out.some((b) => b.sha === sha)) out.push({ name, sha });
  };
  const head = run('git', ['-C', main, 'symbolic-ref', '-q', '--short', 'HEAD']).trim();
  add(head || 'HEAD', 'HEAD');
  const remote = run('git', ['-C', main, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']).trim();
  if (remote) add(remote, remote);
  for (const b of ['main', 'master']) add(b, `refs/heads/${b}`);
  return out;
}

// Commits in tip that are not in any base, by ancestry or by patch (a cherry-pick or rebase counts).
async function unmergedCount(main, tip, bases) {
  let best = null;
  let bestBase = null;
  for (const b of bases) {
    if ((await runA('git', ['-C', main, 'merge-base', '--is-ancestor', tip, b.sha])).code === 0) return { n: 0, base: b.name };
    const r = await runA('git', ['-C', main, 'cherry', b.sha, tip], 30000);
    if (r.code !== 0) continue;
    const n = r.out.split('\n').filter((l) => l.startsWith('+')).length;
    if (best === null || n < best) { best = n; bestBase = b.name; }
    if (n === 0) break;
  }
  return { n: best, base: bestBase || bases[0]?.name || 'HEAD' };
}

async function dirtyCount(dir) {
  const r = await runA('git', ['-C', dir, '--no-optional-locks', 'status', '--porcelain', '--untracked-files=normal'], 60000);
  return r.code === 0 ? r.out.split('\n').filter(Boolean).length : null;
}

async function sizeKB(p) {
  const r = await runA('du', ['-sk', p]);
  const n = parseInt(r.out, 10);
  return Number.isFinite(n) ? n : null;
}

function staleLock(reason, admin, alive) {
  const pid = reason.match(/\bpid[ :=]*(\d+)/i);
  if (pid && !alive(+pid[1])) return `the process that locked it (pid ${pid[1]}) is gone`;
  if (/^initializing$/i.test(reason) && now() - mtime(path.join(admin, 'locked')) > 86400) return 'git never finished adding it';
  return null;
}

// ---------- scan ----------

async function collect(opts) {
  const temps = opts.temps.length ? opts.temps.map(real) : defaultTemps();
  const roots = opts.roots.length ? opts.roots.map(real) : [real(HOME)];
  const { held, alive } = readHolders();
  const holder = (p) => held.get(p) || null;
  const items = [];

  progress('Looking for repositories…');
  const { mains, linked } = findRepos(roots, temps);

  // Top entries of each temp folder.
  const tempEntries = [];
  const tempClones = new Set();
  for (const t of temps) {
    let names = [];
    try { names = readdirSync(t); } catch {}
    for (const name of names) {
      const p = path.join(t, name);
      const s = lst(p);
      if (!s || s.uid !== ME || s.isSymbolicLink() || p === CACHE) continue;
      if (s.isDirectory()) {
        const g = lst(path.join(p, '.git'));
        if (g?.isFile()) { linked.add(p); continue; }
        if (g?.isDirectory()) { mains.add(p); tempClones.add(p); tempEntries.push({ p, kind: 'clone' }); continue; }
        tempEntries.push({ p, kind: isBuild(p) ? 'build' : 'temp', dir: true });
      } else if (s.size >= 50 * 1024 * 1024) {
        tempEntries.push({ p, kind: 'temp', dir: false, kb: Math.round(s.blocks / 2) });
      }
    }
  }

  // Worktrees, found from their repository so that every registered one counts, wherever it lives.
  const orphans = [];
  for (const dir of linked) {
    const link = worktreeLink(dir);
    if (link?.common) mains.add(mainOf(link.common));
    else orphans.push({ kind: 'orphan', path: real(dir), admin: link?.admin || null });
  }
  progress(`Checking ${mains.size} repositories…`);
  const worktreePaths = new Set();
  const mainInfo = new Map();
  for (const main of mains) {
    const list = listWorktrees(main);
    const primary = list[0];
    mainInfo.set(main, { linkedCount: list.length - 1, bases: null });
    for (const w of list.slice(1)) {
      const p = w.missing ? w.path : real(w.path);
      if (worktreePaths.has(p)) continue;
      worktreePaths.add(p);
      const admin = linkedAdmin(main, w.path);
      items.push({ kind: w.missing ? 'prune' : 'worktree', path: p, repo: main, branch: w.branch, head: w.head, locked: w.locked, admin });
    }
    if (primary && !primary.bare && !tempClones.has(main)) items.push({ kind: 'main', path: real(primary.path), repo: main });
  }
  // A folder whose link is broken but that a repository still lists is a worktree item, not an orphan.
  items.push(...orphans.filter((o) => !worktreePaths.has(o.path)));
  for (const e of tempEntries) {
    if (e.kind === 'clone') items.push({ kind: 'clone', path: e.p, repo: e.p });
    else items.push({ kind: e.kind, path: e.p, dir: e.dir, kb: e.kb ?? null, inTemp: true });
  }

  // Facts that need git or the file system, in parallel.
  progress(`Checking ${items.filter((i) => i.kind === 'worktree').length} worktrees…`);
  for (const it of items) {
    if (it.kind !== 'prune') it.holder = holder(it.path);
    if (it.locked) it.stale = staleLock(it.locked, it.admin || '', alive);
  }
  await pool(items, async (it) => {
    if (it.kind === 'worktree') {
      it.idle = now() - lastChange(it.path, ['index', 'HEAD', 'logs/HEAD'].map((f) => path.join(it.admin || '', f)));
      if (it.holder || it.locked) return;
      it.dirty = await dirtyCount(it.path);
      const info = mainInfo.get(it.repo);
      info.bases ??= basesOf(it.repo);
      if (it.head) {
        const u = await unmergedCount(it.repo, it.head, info.bases);
        it.unmerged = u.n;
        it.base = u.base;
        if (!it.branch && u.n) {
          const r = await runA('git', ['-C', it.repo, 'for-each-ref', '--count=1', '--contains', it.head, '--format=%(refname:short)', 'refs/heads', 'refs/remotes', 'refs/tags']);
          it.reachableFrom = r.out.trim() || null;
        }
      }
    } else if (it.kind === 'clone') {
      it.idle = now() - lastChange(it.path, [path.join(it.path, '.git/index'), path.join(it.path, '.git/HEAD')]);
      it.dirty = await dirtyCount(it.path);
      const r = await runA('git', ['-C', it.path, 'log', '--branches', '--not', '--remotes', '--oneline']);
      it.unpushed = r.code === 0 ? r.out.split('\n').filter(Boolean).length : null;
      it.linkedCount = Math.max(0, mainInfo.get(it.path)?.linkedCount || 0);
    } else if (it.kind === 'main') {
      it.idle = now() - Math.max(lastChange(path.join(it.path, '.git'), []), +run('git', ['-C', it.path, 'log', '-1', '--format=%ct']).trim() || 0);
    } else if (it.kind === 'temp' || it.kind === 'build' || it.kind === 'orphan') {
      it.idle = now() - (it.dir === false ? mtime(it.path) : lastChange(it.path));
      if (it.kind === 'temp' && it.dir) it.repoInside = holdsRepo(it.path);
    }
  });

  // Build output inside worktrees, main checkouts and temp folders.
  const builds = [];
  const seenBuild = new Set();
  const addBuild = (b) => { if (!seenBuild.has(b.path)) { seenBuild.add(b.path); builds.push(b); } };
  for (const it of items) {
    if (it.kind === 'worktree' || it.kind === 'main') {
      for (const b of findBuilds(it.path)) addBuild({ kind: 'build', path: real(b), parent: it.path, parentKind: it.kind });
    } else if (it.kind === 'temp' && it.dir && !it.repoInside) {
      for (const b of findBuilds(it.path, 1)) addBuild({ kind: 'build', path: real(b), parent: it.path, parentKind: 'temp', inTemp: true });
    }
  }
  for (const b of builds) {
    b.holder = holder(b.path);
    b.idle = now() - lastChange(b.path, [path.join(b.path, 'debug'), path.join(b.path, 'release'), path.join(b.path, '.rustc_info.json')]);
    if (path.basename(b.path) === 'node_modules') b.lockfile = hasLockfile(path.dirname(b.path), b.parent);
  }
  items.push(...builds);

  // Tool caches in the home folder.
  if (!opts.roots.length) {
    const seen = new Set();
    const addCache = (p, how) => {
      if (!existsSync(p) || seen.has(real(p))) return;
      seen.add(real(p));
      items.push({ kind: 'cache', path: real(p), how, holder: holder(real(p)), idle: now() - lastChange(p) });
    };
    for (const [rel, how] of TOOL_CACHES) addCache(path.join(HOME, rel), how);
    try {
      for (const e of readdirSync(path.join(HOME, '.cache'), { withFileTypes: true })) {
        if (e.isDirectory()) addCache(path.join(HOME, '.cache', e.name), 'the tool that made it fills it again');
      }
    } catch {}
  }
  return { items, temps, roots };
}

function judge(it, opts, ctx) {
  const v = (verdict, why) => Object.assign(it, { verdict, why });
  const h = it.holder;
  if (h?.self) return v('keep', 'this agent session works in it');
  const using = h ? `a process uses it: ${h.exe} (${h.pid})` : null;

  switch (it.kind) {
    case 'main':
      return v('keep', 'main checkout');
    case 'prune':
      if (it.locked) return it.stale ? v('ask', `its folder is gone, and it is locked, but ${it.stale}; lock note: ${it.locked}`) : v('keep', `its folder is gone, but it is locked: ${it.locked}`);
      return v('delete', 'its folder is gone or no longer a checkout of this repository; git worktree prune drops the record');
    case 'worktree': {
      if (using) return v('keep', using);
      if (APP_DATA.some((d) => inside(it.path, d))) return v('keep', 'kept in an app\'s data folder; the app manages it');
      if (it.locked) return it.stale ? v('ask', `locked, but ${it.stale}; lock note: ${it.locked}`) : v('keep', `locked: ${it.locked}`);
      if (it.idle < opts.minAge) return v('keep', `changed ${fmtAge(it.idle)} ago`);
      if (it.dirty == null) return v('ask', 'git cannot read its status');
      if (it.dirty > 0) return v('keep', `${plural(it.dirty, 'unsaved change')}`);
      if (it.unmerged == null) return v('ask', `could not tell whether its commits are in ${it.base || 'the main line'}`);
      if (it.unmerged > 0) {
        if (it.branch) return v('ask', `${plural(it.unmerged, 'commit')} not in ${it.base}; branch ${it.branch} keeps them if the worktree goes`);
        if (it.reachableFrom) return v('ask', `detached; ${plural(it.unmerged, 'commit')} not in ${it.base}, but ${it.reachableFrom} has them`);
        return v('keep', `detached HEAD with ${plural(it.unmerged, 'commit')} on no branch; removing it would lose them`);
      }
      return v('delete', `clean, merged into ${it.base}, untouched ${fmtAge(it.idle)}`);
    }
    case 'build': {
      if (using) return v('keep', using);
      if (it.idle < opts.minAge) return v('keep', `changed ${fmtAge(it.idle)} ago`);
      if (it.lockfile === false) return v('ask', 'node_modules with no lockfile: a new install may resolve other versions');
      if (it.parentKind === 'main') {
        const repoIdle = ctx.byPath.get(it.parent)?.idle ?? 0;
        if (repoIdle < opts.idleAge) return v('keep', `build output of a main checkout used ${fmtAge(repoIdle)} ago`);
        return v('ask', `build output of a main checkout nobody used for ${fmtAge(repoIdle)}; the next build or install makes it again`);
      }
      if (it.parentKind === 'worktree') {
        const wt = ctx.byPath.get(it.parent);
        if (wt?.holder) return v('keep', `its worktree is in use: ${wt.holder.exe} (${wt.holder.pid})`);
        if (wt && wt.idle < opts.minAge) return v('keep', `its worktree changed ${fmtAge(wt.idle)} ago`);
        if (wt?.locked) return v('ask', `build output in a locked worktree (${wt.locked}); the lock may cover it`);
        return v('delete', 'build output in a worktree nobody works in; the checkout and its edits stay');
      }
      return v('delete', 'build output in a temp folder that no process uses; a build makes it again');
    }
    case 'temp':
      if (using) return v('keep', using);
      if (it.repoInside) return v('keep', 'holds a repository or worktree; those are judged on their own, so scan again after they go');
      if (/^com\.apple\./.test(path.basename(it.path))) return v('keep', 'macOS service folder');
      if (it.idle < opts.tempAge) return v('keep', `changed ${fmtAge(it.idle)} ago`);
      return v('delete', `temp ${it.dir === false ? 'file' : 'folder'} untouched for ${fmtAge(it.idle)}; no process uses it`);
    case 'clone':
      if (using) return v('keep', using);
      if (it.linkedCount) return v('keep', `${it.linkedCount} worktrees belong to it`);
      if (it.dirty == null || it.unpushed == null) {
        return it.idle < opts.tempAge ? v('keep', `changed ${fmtAge(it.idle)} ago`) : v('ask', 'has a .git folder that git cannot read, so git cannot check it for unsaved work');
      }
      if (it.dirty > 0 || it.unpushed > 0) {
        return v('keep', [it.dirty && plural(it.dirty, 'unsaved change'), it.unpushed && `${plural(it.unpushed, 'commit')} on no remote`].filter(Boolean).join(' and '));
      }
      if (it.idle < opts.tempAge) return v('keep', `changed ${fmtAge(it.idle)} ago`);
      return v('delete', `clone in a temp folder, everything pushed, untouched ${fmtAge(it.idle)}`);
    case 'orphan':
      if (using) return v('keep', using);
      return v('ask', 'says it is a worktree, but git no longer knows it, so git cannot check it for unsaved edits');
    case 'cache':
      if (using) return v('keep', using);
      return v('ask', `tool cache; ${it.how}`);
  }
  return v('keep', 'unknown kind');
}

function linkedAdmin(main, wtPath) {
  const link = worktreeLink(wtPath);
  if (link?.admin) return link.admin;
  // The folder is gone: find the admin folder whose gitdir file points at it.
  const dir = path.join(run('git', ['-C', main, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim(), 'worktrees');
  try {
    for (const name of readdirSync(dir)) {
      const target = readText(path.join(dir, name, 'gitdir'));
      if (target && path.dirname(target) === wtPath) return path.join(dir, name);
    }
  } catch {}
  return null;
}

const KIND_ORDER = ['worktree', 'prune', 'build', 'temp', 'clone', 'orphan', 'cache'];

// Look-alike temp leftovers (random suffixes) print as one line.
function clusterKey(it) {
  if (it.kind !== 'temp' && !(it.kind === 'build' && it.inTemp && !it.parent)) return null;
  const base = path.basename(it.path).replace(/\d+/g, '#').replace(/[-_.][A-Za-z0-9#]{5,}$/, '-*').replace(/#/g, '');
  return `${it.kind}\n${path.dirname(it.path)}\n${base}`;
}

async function scan(opts) {
  const before = diskSummary(HOME);
  const { items, temps: tempRoots, roots } = await collect(opts);
  const protect = [...roots, ...tempRoots, ...items.filter((i) => i.kind === 'main').map((i) => i.path)];
  const byPath = new Map(items.map((i) => [i.path, i]));
  for (const it of items) judge(it, opts, { byPath });

  // A worktree that goes takes its build output with it.
  const going = new Set(items.filter((i) => i.kind === 'worktree' && i.verdict === 'delete').map((i) => i.path));
  let list = items.filter((i) => i.kind !== 'main' && !(i.kind === 'build' && going.has(i.parent)));

  progress('Measuring sizes…');
  const tempSizes = new Map();
  await pool(tempRoots, async (t) => {
    const r = await runA('du', ['-k', '-d', '1', t]);
    for (const line of r.out.split('\n')) {
      const m = line.match(/^(\d+)\s+(.*)$/);
      if (m) tempSizes.set(real(m[2]), +m[1]);
    }
  });
  const measure = list.filter((i) => i.kb == null && i.kind !== 'prune' && (opts.keep || opts.json || i.verdict !== 'keep'));
  await pool(measure, async (i) => { i.kb = tempSizes.get(i.path) ?? await sizeKB(i.path); });
  for (const i of list) if (i.kind === 'prune') i.kb = 0;
  // A worktree or temp folder that stays counts without the build output that goes.
  for (const b of list.filter((i) => i.kind === 'build' && i.parent && i.kb)) {
    const parent = byPath.get(b.parent);
    if (parent?.kb) parent.kb = Math.max(0, parent.kb - b.kb);
  }
  if (opts.cacheFloor) list = list.filter((i) => i.kind !== 'cache' || (i.kb ?? 0) >= CACHE_MIN_KB);

  const order = { delete: 0, ask: 1, keep: 2 };
  list.sort((a, b) => order[a.verdict] - order[b.verdict]
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    || String(clusterKey(a) ?? '').localeCompare(String(clusterKey(b) ?? ''))
    || (b.kb ?? 0) - (a.kb ?? 0));
  list.forEach((it, i) => { it.id = i + 1; it.sig = signature(it); });
  writeFileSync(CACHE, JSON.stringify({ at: Date.now(), protect, items: list }));
  if (opts.json) console.log(JSON.stringify(list, null, 2));
  else printScan(list, before, opts);
}

function signature(it) {
  const s = lst(it.path);
  return s ? { dev: s.dev, ino: s.ino } : null;
}

function printScan(list, disk, opts) {
  console.log(`Disk: ${disk.text}`);
  const sections = [['delete', 'DELETE: safe to delete'], ['ask', 'ASK: check or ask the user first'], ['keep', 'KEEP']];
  for (const [verdict, title] of sections) {
    const sec = list.filter((i) => i.verdict === verdict);
    const kb = sec.reduce((s, i) => s + (i.kb || 0), 0);
    const kinds = KIND_ORDER.map((k) => [k, sec.filter((i) => i.kind === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
    console.log(`\n${title} — ${sec.length} items${kinds ? ` (${kinds})` : ''}, ${verdict === 'keep' && !opts.keep ? 'size not measured' : fmtSize(kb)}`);
    if (verdict === 'keep' && !opts.keep) { console.log('  (use --keep to list them)'); continue; }
    const clusters = [];
    for (const it of sec) {
      const key = clusterKey(it);
      const last = clusters[clusters.length - 1];
      if (key && last && last.key === key) last.items.push(it);
      else clusters.push({ key, items: [it] });
    }
    for (const c of clusters) {
      const it = c.items[0];
      if (c.items.length > 3) {
        const kb2 = c.items.reduce((s, i) => s + (i.kb || 0), 0);
        const name = path.basename(it.path).replace(/\d+/g, '#').replace(/[-_.][A-Za-z0-9#]{5,}$/, '-*').replace(/#/g, '');
        console.log(`  ${`${it.id}-${c.items[c.items.length - 1].id}`.padEnd(9)} ${fmtSize(kb2).padStart(6)}  ${it.kind.padEnd(8)} ×${c.items.length} ${tilde(path.join(path.dirname(it.path), name))}`);
        console.log(`  ${''.padEnd(9)} ${''.padStart(6)}  why      ${it.why}`);
        continue;
      }
      for (const i of c.items) {
        const extra = i.kind === 'worktree' || i.kind === 'prune' ? `  [${i.branch || 'detached'}] of ${tilde(i.repo)}` : '';
        console.log(`  ${String(i.id).padEnd(9)} ${fmtSize(i.kb).padStart(6)}  ${i.kind.padEnd(8)} ${tilde(i.path)}${extra}`);
        console.log(`  ${''.padEnd(9)} ${''.padStart(6)}  why      ${i.why}`);
      }
    }
  }
  console.log(`\nScan saved. Delete with: node ${tilde(process.argv[1])} delete <id> ...  (or delete --suggested)`);
}

// ---------- delete ----------

async function del(ids, opts) {
  if (!existsSync(CACHE)) fail(`No scan found. Run: node ${tilde(process.argv[1])} scan`);
  const last = JSON.parse(readFileSync(CACHE, 'utf8'));
  if ((Date.now() - last.at) / 1000 > SCAN_TTL) fail('The last scan is older than 1 hour. Run scan again.');
  if (opts.suggested) ids = last.items.filter((i) => i.verdict === 'delete').map((i) => i.id);
  ids = [...new Set(ids)].filter((id) => !opts.except.includes(id));
  if (!ids.length) fail('Nothing to delete.');

  const { held } = readHolders();
  const skipped = [];
  const targets = [];
  for (const id of ids) {
    const it = last.items.find((i) => i.id === id);
    if (!it) { skipped.push(`${id}: not in the last scan`); continue; }
    if (it.verdict === 'keep') { skipped.push(`${id}: marked keep (${it.why})`); continue; }
    targets.push(it);
  }
  // Inner paths first, so a folder and the build output inside it both get their own checks.
  targets.sort((a, b) => b.path.length - a.path.length);

  const check = (it) => { // why this item may not go now, or null
    const s = lst(it.path);
    if (it.kind === 'prune') return null; // git worktree prune drops only records that git itself finds stale
    if (!s) return 'already gone';
    if (s.isSymbolicLink()) return 'is now a symbolic link';
    if (it.sig && (s.dev !== it.sig.dev || s.ino !== it.sig.ino)) return 'a different folder now has this path';
    if (inside(HOME, it.path) || last.protect.some((p) => inside(p, it.path))) return 'protected path';
    const h = held.get(it.path);
    if (h) return h.self ? 'this agent session works in it' : `a process uses it now: ${h.exe} (${h.pid})`;
    if (it.kind === 'build' && !isBuild(it.path)) return 'no longer looks like build output';
    if (it.kind === 'worktree' || it.kind === 'temp' || it.kind === 'build' || it.kind === 'orphan') {
      const idle = now() - (it.kind === 'worktree'
        ? lastChange(it.path, ['index', 'HEAD', 'logs/HEAD'].map((f) => path.join(it.admin || '', f)))
        : it.dir === false ? mtime(it.path) : lastChange(it.path));
      if (it.idle != null && idle < it.idle - 120 && idle < 3600) return `changed ${fmtAge(idle)} ago, after the scan`;
    }
    return null;
  };

  const startKB = diskSummary(HOME).availKB;
  const done = [];
  const pruneRepos = new Set();
  console.log(`${opts.dryRun ? 'Would delete' : 'Deleting'} ${targets.length} items:`);
  for (const it of targets) {
    const why = check(it);
    if (why) { skipped.push(`${it.id} ${tilde(it.path)}: ${why}`); continue; }
    if (it.kind === 'worktree') {
      const now2 = listWorktrees(it.repo).find((w) => real(w.path) === it.path);
      if (!now2) { skipped.push(`${it.id} ${tilde(it.path)}: no longer a worktree of ${tilde(it.repo)}`); continue; }
      if (now2.locked) { skipped.push(`${it.id} ${tilde(it.path)}: locked (${now2.locked}); unlock only with the owner's yes`); continue; }
      const dirty = await dirtyCount(it.path);
      if (dirty !== 0) { skipped.push(`${it.id} ${tilde(it.path)}: ${dirty == null ? 'git cannot read its status' : `${plural(dirty, 'unsaved change')} now`}`); continue; }
      if (it.verdict === 'delete' && now2.head) {
        const u = await unmergedCount(it.repo, now2.head, basesOf(it.repo));
        if (u.n !== 0) { skipped.push(`${it.id} ${tilde(it.path)}: commits not in ${u.base} now`); continue; }
      }
      console.log(`  ${String(it.id).padEnd(6)} ${fmtSize(it.kb).padStart(6)}  git worktree remove ${tilde(it.path)}`);
      if (!opts.dryRun) {
        const r = await runA('git', ['-C', it.repo, 'worktree', 'remove', it.path]);
        if (r.code !== 0) { skipped.push(`${it.id} ${tilde(it.path)}: git refused: ${r.err.split('\n')[0]}`); continue; }
        pruneRepos.add(it.repo);
      }
    } else if (it.kind === 'prune') {
      const lock = listWorktrees(it.repo).find((w) => w.path === it.path)?.locked;
      if (lock) { skipped.push(`${it.id} ${tilde(it.path)}: locked (${lock}); unlock only with the owner's yes`); continue; }
      console.log(`  ${String(it.id).padEnd(6)} ${'0M'.padStart(6)}  git worktree prune (record of ${tilde(it.path)})`);
      if (!opts.dryRun) pruneRepos.add(it.repo);
    } else if (it.kind === 'clone') {
      const dirty = await dirtyCount(it.path);
      const r = await runA('git', ['-C', it.path, 'log', '--branches', '--not', '--remotes', '--oneline']);
      if (dirty !== 0 || r.code !== 0 || r.out.trim()) { skipped.push(`${it.id} ${tilde(it.path)}: has unsaved changes or unpushed commits now`); continue; }
      console.log(`  ${String(it.id).padEnd(6)} ${fmtSize(it.kb).padStart(6)}  rm ${tilde(it.path)}`);
      if (!opts.dryRun) rmSync(it.path, { recursive: true, force: true });
    } else {
      console.log(`  ${String(it.id).padEnd(6)} ${fmtSize(it.kb).padStart(6)}  rm ${tilde(it.path)}`);
      if (!opts.dryRun) rmSync(it.path, { recursive: true, force: true });
    }
    done.push(it);
  }
  for (const repo of pruneRepos) await runA('git', ['-C', repo, 'worktree', 'prune']);

  if (skipped.length) console.log(`\nSkipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
  const plannedKB = done.reduce((s, i) => s + (i.kb || 0), 0);
  if (opts.dryRun) { console.log(`\nWould free about ${fmtSize(plannedKB)}.`); return; }
  const freedKB = Math.max(0, diskSummary(HOME).availKB - startKB);
  console.log(`\nDeleted ${done.length} of ${targets.length} items. Free space grew by ${fmtSize(freedKB)} (the scan measured ${fmtSize(plannedKB)}).`);
  console.log(`Disk: ${diskSummary(HOME).text}`);
}

// ---------- cli ----------

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseAge(s, name) {
  const m = String(s).match(/^(\d+)(s|m|h|d)?$/);
  if (!m) fail(`Bad ${name}: ${s} (use 30m, 2h, 1d)`);
  return +m[1] * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] || 'm'];
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const value = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const values = (name) => rest.flatMap((a, i) => (a === name && rest[i + 1] ? [rest[i + 1]] : []));

if (cmd === 'scan') {
  await scan({
    keep: flag('--keep'), json: flag('--json'), roots: values('--root'), temps: values('--temp'),
    minAge: parseAge(value('--min-age') ?? '60m', '--min-age'),
    tempAge: parseAge(value('--temp-age') ?? '2d', '--temp-age'),
    idleAge: parseAge(value('--idle-age') ?? '14d', '--idle-age'),
    cacheFloor: !flag('--all-caches'),
  });
} else if (cmd === 'delete') {
  const except = (value('--except') || '').split(',').filter(Boolean).map(Number);
  const ids = rest.filter((a, i) => /^\d+$/.test(a) && rest[i - 1] !== '--except').map(Number);
  await del(ids, { suggested: flag('--suggested'), dryRun: flag('--dry-run'), except });
} else {
  console.log(`Usage:
  node scripts/disk.mjs scan [--keep] [--json] [--root <dir>]... [--temp <dir>]...
                             [--min-age 60m] [--temp-age 2d] [--idle-age 14d] [--all-caches]
  node scripts/disk.mjs delete <id> [<id> ...] [--dry-run]
  node scripts/disk.mjs delete --suggested [--except <id>,<id>] [--dry-run]`);
  process.exit(cmd ? 1 : 0);
}
