#!/usr/bin/env node
// free-memory: find stale processes, sort them into kill / ask / keep groups, and stop them safely.
//
//   node scripts/procs.mjs scan [--all] [--keep] [--json] [--min-age 60m]
//   node scripts/procs.mjs kill <pid> [<pid> ...] [--dry-run]
//   node scripts/procs.mjs kill --suggested [--except <pid>,<pid>] [--dry-run]
//
// scan saves its groups to $TMPDIR/free-memory-last-scan.json. kill only stops processes from that
// scan, and only when the process start time still matches, so a reused PID is never hit.
// Works on macOS and Linux. No dependencies.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAC = process.platform === 'darwin';
const HOME = os.homedir();
const ME = process.getuid();
const CACHE = path.join(os.tmpdir(), 'free-memory-last-scan.json');
const RECENT = 10 * 60; // a group member younger than this means the group is still in use
const SCAN_TTL = 60 * 60; // kill refuses a scan older than this

const DEV_EXE = new Set(('node nodejs bun bunx deno npm npx pnpm yarn corepack tsx ts-node esbuild workerd turbo nx ' +
  'nodemon vite vitest jest next nuxt astro wrangler miniflare chrome-headless-shell uvicorn gunicorn hypercorn ' +
  'watchexec cargo-watch').split(' '));
const DEV_PY = /\b(uvicorn|gunicorn|hypercorn|flask|runserver|http\.server|streamlit|jupyter|mkdocs|fastapi)\b/;
const AUTOMATION = /ms-playwright|chrome-headless-shell|puppeteer|playwright_chromiumdev_profile|--enable-automation/;
const SYSTEM_PATH = /^(\/System\/|\/usr\/libexec\/|\/usr\/sbin\/|\/sbin\/|\/Library\/Apple\/)/;
const APP_BUNDLE = /\.app\/Contents\//;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh']);
const MULTIPLEXERS = new Set(['tmux', 'screen', 'zellij']);
const REAPERS = new Set(['launchd', 'init', 'systemd']);
const FIXTURE = /setInterval|\bfixtures?\b|stubborn|\bstubs?\b|smoke|\bstall|sleep-forever/i;
const INLINE = /\s(-e|--eval|-p|--print)\s/;
const TAIL = /(^|\s)tail\s|\blogs?\s+(-f|--follow)\b|--follow\b|deployment tail/;
const WATCHER = /\swatch(\s|$)|--watch\b|nodemon|\s--hot\b|watchexec|cargo-watch/;
const SCRIPT = /\.(c|m)?(j|t)sx?$|\.py$/;
const TEMP_ROOTS = [...new Set([os.tmpdir(), '/tmp/', '/private/tmp/', '/var/tmp/', '/var/folders/', '/private/var/folders/'])]
  .map((r) => (r.endsWith('/') ? r : r + '/'));

// ---------- helpers ----------

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C' } });
  } catch (e) {
    return e.stdout || ''; // lsof exits 1 when some PIDs are gone; the output is still good
  }
}

function seconds(s) { // "[[dd-]hh:]mm:ss[.xx]" from etime and time
  if (!s || s === '-') return 0;
  let days = 0;
  if (s.includes('-')) { const [d, rest] = s.split('-'); days = Number(d); s = rest; }
  return days * 86400 + s.split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const hasTty = (p) => p && !/^\?+$/.test(p.tty);
const isTemp = (s) => TEMP_ROOTS.some((r) => s.includes(r));
const tilde = (s) => s.split(HOME).join('~');

function fmtAge(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(sec / 86400)}d${Math.floor((sec % 86400) / 3600)}h`;
}

function fmtMB(kb) {
  return kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)}G` : `${Math.round(kb / 1024)}M`;
}

// App bundle paths contain spaces, so take the binary name from everything before the first option.
const appName = (args) => (APP_BUNDLE.test(args) ? path.basename(args.split(' --')[0].trim()) : null);

function label(args, width = 90) { // readable name: app binary name, or the command line
  const s = tilde(appName(args) || args).replace(/\s+/g, ' ');
  return s.length > width ? s.slice(0, width - 1) + '…' : s;
}

function shortLabel(p) { // "node server.js (51643)": paths cut to their last part
  const s = appName(p.args) || p.args.split(/\s+/).map((t) => (t.includes('/') && !t.startsWith('--') ? path.basename(t) : t)).join(' ');
  return `${s.length > 36 ? s.slice(0, 35) + '…' : s} (${p.pid})`;
}

// ---------- process table ----------

function readProcs() {
  const cols = ['pid', 'ppid', 'uid', 'rss', '%cpu', 'stat', 'tty', 'etime', 'time', 'lstart', 'args'];
  const out = run('ps', ['-Aww', ...cols.flatMap((c) => ['-o', `${c}=`])]);
  const re = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/;
  const procs = new Map();
  for (const line of out.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const args = m[11].trim();
    const exe = path.basename(args.split(/\s/)[0]).replace(/^-/, '');
    procs.set(+m[1], {
      pid: +m[1], ppid: +m[2], uid: +m[3], rssKB: +m[4], cpu: +m[5], stat: m[6], tty: m[7],
      age: seconds(m[8]), cpuTime: seconds(m[9]), lstart: m[10].replace(/\s+/g, ' '), args, exe,
    });
  }
  const children = new Map();
  for (const p of procs.values()) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p);
  }
  return { procs, children };
}

function ancestors(procs, pid) {
  const out = [];
  const seen = new Set([pid]);
  let p = procs.get(pid);
  while (p && p.ppid && !seen.has(p.ppid)) {
    const parent = procs.get(p.ppid);
    if (!parent) break;
    out.push(parent);
    seen.add(parent.pid);
    if (parent.pid === 1) break;
    p = parent;
  }
  return out;
}

function descendants(children, pid) {
  const out = [];
  const stack = [...(children.get(pid) || [])];
  while (stack.length) {
    const c = stack.shift();
    out.push(c);
    stack.push(...(children.get(c.pid) || []));
  }
  return out;
}

// This script, the shell that runs it, the agent that runs the shell, and everything above.
function selfInfo(procs) {
  const up = ancestors(procs, process.pid);
  const set = new Set([process.pid, ...up.map((p) => p.pid)]);
  const agent = up.find((p) => !SHELLS.has(p.exe) && p.pid !== 1);
  return { set, agent: agent?.pid };
}

function cwdOf(pids) {
  const map = new Map();
  if (!pids.length) return map;
  if (MAC || !existsSync('/proc')) {
    let pid = 0;
    for (const line of run('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')]).split('\n')) {
      if (line[0] === 'p') pid = +line.slice(1);
      else if (line[0] === 'n') map.set(pid, { path: line.slice(1), gone: !existsSync(line.slice(1)) });
    }
  } else {
    for (const pid of pids) {
      try {
        const link = readlinkSync(`/proc/${pid}/cwd`);
        const gone = link.endsWith(' (deleted)');
        const p = link.replace(/ \(deleted\)$/, '');
        map.set(pid, { path: p, gone: gone || !existsSync(p) });
      } catch {}
    }
  }
  return map;
}

function listeningPorts() {
  const map = new Map();
  const add = (pid, addr) => { if (!map.has(pid)) map.set(pid, new Set()); map.get(pid).add(addr); };
  const out = run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']);
  if (out) {
    let pid = 0;
    for (const line of out.split('\n')) {
      if (line[0] === 'p') pid = +line.slice(1);
      else if (line[0] === 'n') add(pid, line.slice(1));
    }
  } else { // Linux without lsof
    for (const line of run('ss', ['-ltnpH']).split('\n')) {
      const addr = line.trim().split(/\s+/)[3];
      for (const m of line.matchAll(/pid=(\d+)/g)) add(+m[1], addr);
    }
  }
  return map;
}

function memorySummary() {
  const gb = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`;
  const parts = [`${gb(os.totalmem())} RAM`];
  if (MAC) {
    const swap = run('sysctl', ['-n', 'vm.swapusage']).match(/total = ([\d.]+)M\s+used = ([\d.]+)M/);
    if (swap) parts.push(`swap ${(swap[2] / 1024).toFixed(1)} of ${(swap[1] / 1024).toFixed(1)} GB used`);
    const free = run('memory_pressure', ['-Q']).match(/free percentage: (\d+)%/);
    if (free) parts.push(`${free[1]}% memory free`);
  } else if (existsSync('/proc/meminfo')) {
    const info = Object.fromEntries(readFileSync('/proc/meminfo', 'utf8').split('\n')
      .map((l) => l.match(/^(\w+):\s+(\d+)/)).filter(Boolean).map((m) => [m[1], +m[2] * 1024]));
    parts.push(`${gb(info.MemAvailable)} available`, `swap ${gb(info.SwapTotal - info.SwapFree)} of ${gb(info.SwapTotal)} used`);
  }
  return parts.join(', ');
}

// ---------- scan ----------

function isCandidate(p, all) {
  if (p.uid !== ME || p.pid === 1) return false;
  if (AUTOMATION.test(p.args)) return true;
  if (SYSTEM_PATH.test(p.args) || APP_BUNDLE.test(p.args.split(' --')[0])) return false;
  if (all) return true;
  if (DEV_EXE.has(p.exe)) return true;
  return /^python[\d.]*$/.test(p.exe) && DEV_PY.test(p.args);
}

function scriptPath(p, cwd) { // the first script argument, resolved against the cwd
  const tok = p.args.split(/\s+/).slice(1).find((t) => !t.startsWith('-') && SCRIPT.test(t));
  if (!tok) return null;
  if (path.isAbsolute(tok)) return tok;
  return cwd ? path.resolve(cwd, tok) : null;
}

function buildGroups({ procs, children }, opts) {
  const self = selfInfo(procs);
  const cand = new Set([...procs.values()].filter((p) => isCandidate(p, opts.all) && !self.set.has(p.pid)).map((p) => p.pid));

  // Climb from each candidate through candidate parents and orphaned wrapper shells to the group root.
  const rootOf = (p) => {
    let r = p;
    for (;;) {
      const parent = procs.get(r.ppid);
      if (!parent || parent.pid === 1 || self.set.has(parent.pid)) return r;
      if (cand.has(parent.pid) || (SHELLS.has(parent.exe) && !hasTty(parent))) { r = parent; continue; }
      return r;
    }
  };
  const roots = [...new Set([...cand].map((pid) => rootOf(procs.get(pid))))]
    .sort((a, b) => ancestors(procs, a.pid).length - ancestors(procs, b.pid).length);

  const claimed = new Set();
  const groups = [];
  for (const root of roots) {
    if (claimed.has(root.pid)) continue;
    const members = [root, ...descendants(children, root.pid)].filter((m) => !claimed.has(m.pid));
    members.forEach((m) => claimed.add(m.pid));
    groups.push({ root, members });
  }

  const ports = listeningPorts();
  const mains = groups.map((g) => g.members.find((m) => cand.has(m.pid)) || g.root);
  const cwds = cwdOf([...new Set(groups.flatMap((g, i) => [g.root.pid, mains[i].pid]))]);

  const out = groups.map((g, i) => {
    const { root, members } = g;
    const main = mains[i];
    const up = ancestors(procs, root.pid);
    const parent = procs.get(root.ppid);
    const cwd = cwds.get(main.pid) || cwds.get(root.pid);
    const script = scriptPath(main, cwd?.path);
    const groupPorts = members.flatMap((m) => [...(ports.get(m.pid) || [])]);
    const youngest = Math.min(...members.map((m) => m.age));
    return {
      root: root.pid,
      main: main.pid,
      command: main.args,
      exe: main.exe,
      parent: parent ? { pid: parent.pid, exe: parent.exe } : null,
      orphan: !parent || parent.pid === 1 || REAPERS.has(parent.exe),
      tty: hasTty(root) || hasTty(main),
      multiplexer: up.find((a) => MULTIPLEXERS.has(a.exe))?.exe || null,
      session: members.some((m) => self.set.has(m.pid)) || up.some((a) => a.pid === self.agent),
      otherUser: root.uid !== ME,
      age: root.age,
      youngest,
      rssKB: members.reduce((s, m) => s + m.rssKB, 0),
      cpuTime: members.reduce((s, m) => s + m.cpuTime, 0),
      cpu: members.reduce((s, m) => s + m.cpu, 0),
      cwd: cwd?.path || null,
      cwdGone: !!cwd?.gone,
      script,
      scriptGone: !!script && !existsSync(script),
      ports: [...new Set(groupPorts)],
      temp: isTemp(main.args) || isTemp(cwd?.path || ''),
      fixture: FIXTURE.test(main.args),
      inline: ['node', 'bun', 'deno'].includes(main.exe) && INLINE.test(` ${main.args} `),
      tail: TAIL.test(main.args),
      watcher: WATCHER.test(members.map((m) => m.args).join('\n')),
      automation: AUTOMATION.test(main.args),
      browser: browserState(main, procs),
      app: APP_BUNDLE.test(main.args.split(' --')[0]) && !AUTOMATION.test(main.args),
      members: members.map((m) => ({ pid: m.pid, ppid: m.ppid, lstart: m.lstart, rssKB: m.rssKB, exe: m.exe })),
    };
  });

  // Same command in the same folder twice: the copy without a port lost the race for it.
  const byKey = new Map();
  for (const g of out) {
    const key = `${g.command}\n${g.cwd}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(g);
  }
  for (const list of byKey.values()) {
    const holder = list.find((g) => g.ports.length);
    if (holder) for (const g of list) if (g !== holder && !g.ports.length) g.duplicateOf = holder.root;
  }

  for (const g of out) Object.assign(g, judge(g, opts.minAge));
  return out;
}

// Test browsers: one driven over a pipe can never be reached again once its parent exits.
// Crash handlers always detach (PPID 1), so they are stale only when their browser has exited.
function browserState(main, procs) {
  if (/crashpad/.test(main.args)) {
    const bundle = main.args.split('.app/')[0];
    const live = [...procs.values()].some((p) => p.args.startsWith(bundle) && !/crashpad/.test(p.args));
    return live ? 'crashpad-live' : 'crashpad-dead';
  }
  return /--remote-debugging-pipe/.test(main.args) ? 'pipe' : null;
}

function judge(g, minAge) {
  const v = (verdict, why) => ({ verdict, why });
  if (g.session) return v('keep', 'started by this agent session; stop it yourself when you are done with it');
  if (g.otherUser) return v('keep', 'owned by another user');
  if (g.age < minAge) return v('keep', `started ${fmtAge(g.age)} ago`);

  if (g.cwdGone) {
    const why = `its folder is gone (${tilde(g.cwd)})`;
    if (g.multiplexer || (g.tty && !g.orphan)) return v('ask', `${why}, but it runs in an open terminal`);
    return v(g.app ? 'ask' : 'kill', why);
  }
  if (g.browser === 'crashpad-live') return v('keep', 'crash handler of a test browser that still runs');
  if (g.multiplexer) return v('keep', `runs inside a ${g.multiplexer} session, so somebody started it on purpose`);
  if (g.tty && !g.orphan) return v('keep', 'runs in an open terminal');
  if (!g.orphan) return v('keep', `its parent ${g.parent.exe} (${g.parent.pid}) is still running`);

  // From here on, the parent is gone.
  const kill = (why) => v(g.app ? 'ask' : 'kill', why);
  if (g.browser === 'crashpad-dead') return kill('crash handler left behind by a test browser that has exited');
  if (g.automation && g.browser === 'pipe') return kill('test browser whose controller exited; nothing can drive it again');
  if (g.youngest < RECENT && g.youngest < g.age) return v('keep', `orphaned, but still active: a child process started ${fmtAge(g.youngest)} ago`);
  if (g.fixture) return kill('test fixture that outlived its test run');
  if (g.inline) return kill('inline script (-e) that outlived the process that started it');
  if (g.tail) return kill('log tail that nobody reads');
  if (g.duplicateOf) return kill(`duplicate of ${g.duplicateOf}, which holds the port`);
  if (g.watcher && !g.ports.length) return kill('watcher with no running server and no port');
  if (g.automation) return v('ask', 'orphaned test browser with a debugging port; check that no tool still connects to it');
  if (g.temp) return kill('orphaned, and it runs from a temp folder');
  if (g.scriptGone) return v('ask', `its script is no longer at ${tilde(g.script)}; the project was moved or deleted, and the process still runs the old code`);
  if (g.ports.length) return v('ask', `orphaned server on ${g.ports.join(' ')}; the project folder still exists`);
  return v('ask', 'orphaned, purpose unclear (a daemon may be detached on purpose)');
}

function notes(g) {
  const n = [];
  if (g.cpuTime > 3600) n.push(`used ${fmtAge(g.cpuTime)} of CPU time`);
  if (g.cpu > 5) n.push(`${Math.round(g.cpu)}% CPU now`);
  if (g.ports.some((p) => p.startsWith('*:') || p.startsWith('0.0.0.0:') || p.startsWith('[::]:'))) n.push('listens on all network interfaces');
  return n;
}

function printScan(groups, procs, opts) {
  const all = [...procs.values()];
  const top = (key, fmt) => all.sort((a, b) => b[key] - a[key]).slice(0, 6).map((p) => `${shortLabel(p)} ${fmt(p[key])}`).join(' · ');
  console.log(`Memory: ${memorySummary()}`);
  console.log(`Top CPU now: ${top('cpu', (c) => `${Math.round(c)}%`)}`);
  console.log(`Top memory:  ${top('rssKB', fmtMB)}`);

  const sections = [['kill', 'KILL: stale, safe to stop'], ['ask', 'ASK: maybe stale, check or ask the user first'], ['keep', 'KEEP']];
  for (const [verdict, title] of sections) {
    const list = groups.filter((g) => g.verdict === verdict).sort((a, b) => b.rssKB + b.cpuTime - (a.rssKB + a.cpuTime));
    const procCount = list.reduce((s, g) => s + g.members.length, 0);
    const rss = list.reduce((s, g) => s + g.rssKB, 0);
    console.log(`\n${title} — ${list.length} groups, ${procCount} processes, ${fmtMB(rss)}`);
    if (verdict === 'keep' && !opts.keep) { console.log('  (use --keep to list them)'); continue; }

    // Fold look-alike single-purpose leaks (same reason, same command shape, no port) into one line.
    const clusters = new Map();
    for (const g of list) {
      const shape = g.inline ? g.command.replace(/^\S+/, g.exe) : `${g.exe} ${path.basename(g.script || g.command.split(/\s+/)[1] || '')}`;
      const key = g.ports.length ? `solo:${g.root}` : `${g.why}\n${shape}`;
      if (!clusters.has(key)) clusters.set(key, []);
      clusters.get(key).push(g);
    }
    for (const c of clusters.values()) {
      const g = c[0];
      const procsN = c.reduce((s, x) => s + x.members.length, 0);
      const rssC = c.reduce((s, x) => s + x.rssKB, 0);
      const ages = c.map((x) => x.age);
      const [lo, hi] = [fmtAge(Math.min(...ages)), fmtAge(Math.max(...ages))];
      const age = lo === hi ? lo : `${lo}–${hi}`;
      const head = c.length > 1 ? `×${c.length}` : String(g.root);
      console.log(`  ${head.padEnd(6)} ${label(g.command)}`);
      console.log(`         ${procsN} procs, ${fmtMB(rssC)}, age ${age}${g.ports.length ? `, ports ${g.ports.join(' ')}` : ''}`);
      if (g.cwd) console.log(`         cwd  ${tilde(g.cwd)}${c.length > 1 ? ' (first)' : ''}`);
      console.log(`         why  ${g.why}`);
      const n = [...new Set(c.flatMap(notes))];
      if (n.length) console.log(`         note ${n.join('; ')}`);
      console.log(`         pids ${c.map((x) => (x.members.length > 1 ? `${x.root}(+${x.members.length - 1})` : x.root)).join(' ')}`);
    }
  }
  console.log(`\nScan saved. Stop groups with: node ${tilde(process.argv[1])} kill <root pid> ...  (or kill --suggested)`);
}

function scan(opts) {
  const table = readProcs();
  const groups = buildGroups(table, opts);
  writeFileSync(CACHE, JSON.stringify({ at: Date.now(), groups }));
  if (opts.json) console.log(JSON.stringify(groups, null, 2));
  else printScan(groups, table.procs, opts);
}

// ---------- kill ----------

function kill(pids, opts) {
  if (!existsSync(CACHE)) fail(`No scan found. Run: node ${tilde(process.argv[1])} scan`);
  const last = JSON.parse(readFileSync(CACHE, 'utf8'));
  if ((Date.now() - last.at) / 1000 > SCAN_TTL) fail('The last scan is older than 1 hour. Run scan again.');

  if (opts.suggested) pids = last.groups.filter((g) => g.verdict === 'kill').map((g) => g.root);
  pids = pids.filter((p) => !opts.except.includes(p));
  if (!pids.length) fail('Nothing to stop.');

  let { procs, children } = readProcs();
  const self = selfInfo(procs);
  const targets = new Map();
  const skipped = [];

  for (const pid of pids) {
    let group = last.groups.find((g) => g.root === pid);
    let list = group?.members;
    if (!group) { // a member PID: take it and its scanned descendants
      group = last.groups.find((g) => g.members.some((m) => m.pid === pid));
      if (!group) { skipped.push(`${pid}: not in the last scan`); continue; }
      const keep = new Set([pid]);
      for (let grew = true; grew;) {
        grew = false;
        for (const m of group.members) if (keep.has(m.ppid) && !keep.has(m.pid)) { keep.add(m.pid); grew = true; }
      }
      list = group.members.filter((m) => keep.has(m.pid));
    }
    if (group.session) { skipped.push(`${pid}: belongs to this agent session`); continue; }
    for (const m of list) {
      const live = procs.get(m.pid);
      if (!live || live.stat.startsWith('Z')) continue; // already gone
      if (live.lstart !== m.lstart) { skipped.push(`${m.pid}: PID reused by another process`); continue; }
      if (self.set.has(m.pid) || live.uid !== ME || m.pid === 1) { skipped.push(`${m.pid}: protected`); continue; }
      targets.set(m.pid, live);
    }
  }
  // Children born after the scan belong to a verified target, so they go too.
  for (const pid of [...targets.keys()]) {
    for (const d of descendants(children, pid)) if (!self.set.has(d.pid) && d.uid === ME) targets.set(d.pid, d);
  }

  if (skipped.length) console.log(`Skipped:\n  ${skipped.join('\n  ')}`);
  if (!targets.size) fail('No live processes to stop.');
  const totalKB = [...targets.values()].reduce((s, p) => s + p.rssKB, 0);
  console.log(`${opts.dryRun ? 'Would stop' : 'Stopping'} ${targets.size} processes, about ${fmtMB(totalKB)}:`);
  for (const p of targets.values()) console.log(`  ${String(p.pid).padEnd(6)} ${label(p.args, 100)}`);
  if (opts.dryRun) return;

  const signal = (sig, list) => list.forEach((p) => { try { process.kill(p.pid, sig); } catch {} });
  const alive = () => {
    ({ procs } = readProcs());
    return [...targets.values()].filter((t) => {
      const live = procs.get(t.pid);
      return live && live.lstart === t.lstart && !live.stat.startsWith('Z');
    });
  };
  signal('SIGTERM', [...targets.values()]);
  let left = alive();
  for (let i = 0; i < 20 && left.length; i++) { sleep(250); left = alive(); }
  if (left.length) {
    console.log(`SIGKILL for ${left.length} that ignored SIGTERM: ${left.map((p) => p.pid).join(' ')}`);
    signal('SIGKILL', left);
    for (let i = 0; i < 8 && left.length; i++) { sleep(250); left = alive(); }
  }
  const freed = [...targets.values()].filter((t) => !left.includes(t)).reduce((s, p) => s + p.rssKB, 0);
  console.log(`Stopped ${targets.size - left.length} of ${targets.size} processes, about ${fmtMB(freed)} freed.`);
  if (left.length) console.log(`Still running: ${left.map((p) => p.pid).join(' ')}`);
}

// ---------- cli ----------

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseAge(s) {
  const m = String(s).match(/^(\d+)(s|m|h|d)?$/);
  if (!m) fail(`Bad --min-age: ${s} (use 30m, 2h, 1d)`);
  return +m[1] * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] || 'm'];
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const value = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };

if (cmd === 'scan') {
  scan({ all: flag('--all'), keep: flag('--keep'), json: flag('--json'), minAge: parseAge(value('--min-age') ?? '60m') });
} else if (cmd === 'kill') {
  const except = (value('--except') || '').split(',').filter(Boolean).map(Number);
  const pids = rest.filter((a, i) => /^\d+$/.test(a) && rest[i - 1] !== '--except').map(Number);
  kill(pids, { suggested: flag('--suggested'), dryRun: flag('--dry-run'), except });
} else {
  console.log(`Usage:
  node scripts/procs.mjs scan [--all] [--keep] [--json] [--min-age 60m]
  node scripts/procs.mjs kill <pid> [<pid> ...] [--dry-run]
  node scripts/procs.mjs kill --suggested [--except <pid>,<pid>] [--dry-run]`);
  process.exit(cmd ? 1 : 0);
}
