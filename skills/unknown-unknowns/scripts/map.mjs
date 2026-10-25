#!/usr/bin/env node
// unknown-unknowns map: draw an exploration as a live mind map in the browser.
//
//   node scripts/map.mjs open <topic> [--dir <path>] [--goal <text>] [--no-open] [--port <n>]
//   node scripts/map.mjs add <session> <label> [--parent <id>] [--id <id>] [--note <markdown>] [--state suggested|visited]
//   node scripts/map.mjs focus|note|attach|link|rename|remove|show|stop ...   (run `help` for all)
//
// The session folder holds map.json, files/ (the attached files), .server.json and .server.log.
// Commands only change files, so they work when no server runs. `open` starts a small server on
// 127.0.0.1 that serves the page and pushes every change to it with Server-Sent Events.
// Only Node built-ins (Node 18+). Runs under Bun too.

import { spawn } from 'node:child_process';
import {
  closeSync, copyFileSync, createReadStream, existsSync, fsyncSync, mkdirSync, openSync, readdirSync,
  readFileSync, realpathSync, renameSync, rmSync, statSync, watch, writeSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickSide, sidesOf } from './page/layout.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const PAGE_DIR = path.join(path.dirname(SCRIPT), 'page');
const FONT_DIR = path.join(path.dirname(SCRIPT), '..', 'assets', 'fonts');
const APP = 'unknown-unknowns-map';

const MAX_WORDS = 3;
const MAX_CHARS = 28;
const STATES = ['suggested', 'visited', 'current'];
const TYPES = ['html', 'image', 'pdf', 'markdown', 'text', 'other', 'link'];
const FIRST_PORT = 4777;
const PORT_TRIES = 100;
const RESERVED_PORTS = new Set([3000, 3001, 4317, 4321, 4646, 5173, 8080, 8787, 8790]); // common dev tools use these
const IDLE_MS = 30 * 60 * 1000; // the server exits after this long with no page
const DEBOUNCE_MS = 50;
const LOCK_WAIT_MS = 8000;
const LOCK_STALE_MS = 15000;

const EXTENSIONS = {
  html: ['html', 'htm'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico'],
  pdf: ['pdf'],
  markdown: ['md', 'markdown', 'mdx'],
  text: ['txt', 'text', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'ini', 'js', 'mjs', 'ts', 'py', 'sh', 'sql', 'css'],
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

const HELP = `map.mjs draws an exploration as a live mind map in the browser.

Usage:
  map.mjs open <topic> [--dir <path>] [--goal <text>] [--no-open] [--port <n>]
  map.mjs add <session> <label> [--parent <id>] [--id <id>] [--note <markdown>] [--state suggested|visited]
  map.mjs focus <session> <id>
  map.mjs note <session> <id> <markdown> [--append]
  map.mjs attach <session> <id> <file-or-url> [--title <text>]
  map.mjs link <session> <id> <id>
  map.mjs rename <session> <id> <label>
  map.mjs remove <session> <id> [--tree]
  map.mjs show <session>
  map.mjs stop <session>
  map.mjs help

Commands:
  open    Create the map if it is missing, start the live page and print the folder and the URL.
          The topic is the label of the centre node (id "goal"). --goal sets its note.
          The default folder is ~/explorations/<topic-slug>. --no-open does not open a browser.
  add     Add a node and print its id. The parent is the current node unless you give --parent.
          The state is "suggested" unless you give --state. A node under the goal goes to the
          shorter side of the map and keeps that side.
  focus   Make a node current. The previous current node becomes visited. Each focus is one step.
  note    Replace the note of a node, or add to it with --append. The note is Markdown.
          Notes do not render [[...]] links between nodes. Use link to connect two nodes.
  attach  Copy a local file into files/ and attach it to a node, or attach a URL as a link.
          Attach the same file again to update the copy. A file that is in files/ already
          is attached where it is, with no copy.
  link    Draw a cross link between two nodes.
  rename  Change the label of a node. The id stays.
  remove  Remove a node. A node with children needs --tree, which removes them too.
  show    Print the map as an outline with states, steps and attachments.
  stop    Stop the live server.

Rules:
  <session> is the folder that open prints.
  A label has at most ${MAX_WORDS} words and ${MAX_CHARS} characters. The canvas shows only crucial names.
  Put the detail in the note.
  Use - in place of a note to read it from stdin.
  The commands change only files. They work when no server runs.`;

class UserError extends Error {}
const fail = (message) => { throw new UserError(message); };
const now = () => new Date().toISOString();
const sleepSync = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const end = Date.now() + ms; while (Date.now() < end); }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Arguments ─────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(['dir', 'goal', 'port', 'parent', 'id', 'note', 'state', 'title', 'idle']);
const BOOL_FLAGS = new Set(['no-open', 'append', 'tree']);

function parseArgs(argv, allowed) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith('--') || arg.length === 2) { pos.push(arg); continue; }
    const eq = arg.indexOf('=');
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    if (!allowed.includes(name)) fail(`Unknown option --${name}. Run map.mjs help.`);
    if (BOOL_FLAGS.has(name)) {
      if (eq !== -1) fail(`--${name} takes no value.`);
      flags[name] = true;
    } else if (VALUE_FLAGS.has(name)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined) fail(`--${name} needs a value.`);
      flags[name] = value;
    }
  }
  return { flags, pos };
}

function readStdinIf(value) {
  return value === '-' ? readFileSync(0, 'utf8').replace(/\s+$/, '') : value;
}

function portFlag(value) {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('--port must be a whole number from 1024 to 65535.');
  if (RESERVED_PORTS.has(port)) fail(`Port ${port} is kept free for other tools. Use another port.`);
  return port;
}

// ── Names and ids ─────────────────────────────────────────────────────

const LETTERS = { ł: 'l', đ: 'd', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th', ð: 'd', ı: 'i' };

export function slugify(text, max = 48) {
  return String(text).toLowerCase().replace(/[łđøßæœþðı]/g, (c) => LETTERS[c])
    .normalize('NFKD').replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
    .slice(0, max).replace(/-+$/, '');
}

export function checkLabel(raw, what = 'label') {
  const label = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!label) fail(`The ${what} is empty.`);
  const words = label.split(' ').length;
  const chars = [...label].length;
  if (words > MAX_WORDS || chars > MAX_CHARS) {
    fail(`The ${what} "${label}" is too long: ${plural(words, 'word')} and ${plural(chars, 'character')}. `
      + `The canvas shows only crucial names, so a label has at most ${MAX_WORDS} words and ${MAX_CHARS} characters. `
      + 'Put the detail in the note.');
  }
  return label;
}

function checkId(id) {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u.test(id)) fail(`The id "${id}" is not valid. Use letters, digits and hyphens.`);
  return id;
}

function uniqueId(map, base) {
  const taken = new Set(map.nodes.map((n) => n.id));
  const stem = base || 'node';
  if (!taken.has(stem)) return stem;
  for (let n = 2; ; n++) if (!taken.has(`${stem}-${n}`)) return `${stem}-${n}`;
}

// ── The map file ──────────────────────────────────────────────────────

const mapFile = (dir) => path.join(dir, 'map.json');
const filesDir = (dir) => path.join(dir, 'files');

/** Fill in optional fields, so a hand-edited map with missing parts still loads. */
function normalize(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
  map.version ??= 1;
  map.links ??= [];
  map.visits ??= [];
  if (Array.isArray(map.nodes)) {
    for (const n of map.nodes) {
      if (!n || typeof n !== 'object') continue;
      n.parent ??= null;
      n.state ??= 'suggested';
      n.note ??= '';
      n.attachments ??= [];
    }
  }
  return map;
}

/** Returns a sentence that says what is wrong with the map, or null when it is valid. */
export function mapProblem(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return 'The file does not hold a JSON object.';
  if (!Array.isArray(map.nodes)) return '"nodes" is not a list.';
  const byId = new Map();
  for (const [i, n] of map.nodes.entries()) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || !n.id) return `Node ${i + 1} has no id.`;
    if (byId.has(n.id)) return `The id "${n.id}" is used twice.`;
    byId.set(n.id, n);
    if (typeof n.label !== 'string' || !n.label.trim()) return `Node "${n.id}" has no label.`;
    if (!STATES.includes(n.state)) return `Node "${n.id}" has the unknown state "${n.state}".`;
    if (n.side !== undefined && n.side !== 'left' && n.side !== 'right') return `Node "${n.id}" has the unknown side "${n.side}". Use left or right.`;
    if (typeof n.note !== 'string') return `The note of node "${n.id}" is not text.`;
    if (!Array.isArray(n.attachments)) return `The attachments of node "${n.id}" are not a list.`;
    for (const a of n.attachments) {
      if (!a || !TYPES.includes(a.type)) return `Node "${n.id}" has an attachment with an unknown type.`;
      if (typeof (a.type === 'link' ? a.url : a.file) !== 'string') return `Node "${n.id}" has an attachment with no ${a.type === 'link' ? 'url' : 'file'}.`;
    }
  }
  const root = byId.get('goal');
  if (!root || root.parent !== null) return 'The map has no goal node (id "goal" with no parent).';
  for (const n of map.nodes) {
    if (n === root) continue;
    if (!byId.has(n.parent)) return `Node "${n.id}" has the unknown parent "${n.parent}".`;
    let up = n;
    for (let steps = 0; up !== root; steps++) {
      if (steps > map.nodes.length) return `Node "${n.id}" is in a loop of parents.`;
      up = byId.get(up.parent);
    }
  }
  if (!Array.isArray(map.links)) return '"links" is not a list.';
  for (const l of map.links) {
    if (!Array.isArray(l) || l.length !== 2 || !byId.has(l[0]) || !byId.has(l[1])) return `The link ${JSON.stringify(l)} joins unknown nodes.`;
  }
  if (!Array.isArray(map.visits)) return '"visits" is not a list.';
  if (map.nodes.filter((n) => n.state === 'current').length > 1) return 'More than one node is current.';
  return null;
}

export function parseMap(text) {
  let map;
  try { map = JSON.parse(text); } catch (e) { return { error: `map.json is not valid JSON: ${e.message}` }; }
  normalize(map);
  const problem = mapProblem(map);
  return problem ? { error: `map.json is invalid: ${problem}` } : { map };
}

function readMap(dir) {
  let text;
  try { text = readFileSync(mapFile(dir), 'utf8'); } catch { fail(`No map in ${dir}. Run map.mjs open <topic> --dir ${dir}`); }
  const { map, error } = parseMap(text);
  if (error) fail(`${error} Fix the file by hand, then run the command again.`);
  return map;
}

/** Write a file in one step: a temp file next to it, flushed, then renamed over it. */
export function writeAtomic(file, text) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(tmp, file); } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

/** A lock file made with O_EXCL. Waits and retries; removes a lock whose owner is gone. */
function lock(file) {
  const started = Date.now();
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, `${process.pid} ${Date.now()}`);
      closeSync(fd);
      return () => rmSync(file, { force: true });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let owner = '';
    try { owner = readFileSync(file, 'utf8'); } catch { continue; }
    const [pid, time] = owner.split(' ').map(Number);
    if (Date.now() - time > LOCK_STALE_MS || (pid && !alive(pid))) {
      try { if (readFileSync(file, 'utf8') === owner) rmSync(file, { force: true }); } catch {}
      continue;
    }
    if (Date.now() - started > LOCK_WAIT_MS) fail(`Another command holds the lock ${file}. Try again.`);
    sleepSync(10 + Math.random() * 25);
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * Give every first-level node the side that the page shows for it now. Maps made before sides were
 * stored get them on their next change, so later changes cannot move a branch to the other side.
 */
function keepSides(map) {
  for (const [id, side] of sidesOf(map)) {
    const node = map.nodes.find((n) => n.id === id);
    if (node.side === undefined) node.side = side > 0 ? 'right' : 'left';
  }
}

/** Read the map under the lock, let fn change it, and write it back only when it changed. */
function updateMap(dir, fn) {
  const release = lock(path.join(dir, '.map.lock'));
  try {
    const map = readMap(dir);
    keepSides(map);
    const before = JSON.stringify(map);
    const result = fn(map);
    if (JSON.stringify(map) !== before) {
      map.updated = now();
      writeAtomic(mapFile(dir), `${JSON.stringify(map, null, 2)}\n`);
    }
    return result;
  } finally {
    release();
  }
}

function resolveSession(arg) {
  if (!arg) fail('Give the session folder. It is the first line that open prints.');
  let dir = path.resolve(arg);
  if (path.basename(dir) === 'map.json') dir = path.dirname(dir);
  if (existsSync(mapFile(dir))) return dir;
  if (!/[\\/]/.test(arg)) {
    const named = path.join(os.homedir(), 'explorations', arg);
    if (existsSync(mapFile(named))) return named;
  }
  fail(`No map in ${dir}. Run map.mjs open <topic> --dir ${dir}`);
}

const nodeOf = (map, id) => map.nodes.find((n) => n.id === id) ?? fail(`No node has the id "${id}". Run map.mjs show to see the ids.`);
const currentOf = (map) => map.nodes.find((n) => n.state === 'current');
const stepsOf = (map, id) => map.visits.filter((v) => v.id === id).map((v) => v.step);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function typeOf(name) {
  const ext = path.extname(name).slice(1).toLowerCase();
  return Object.keys(EXTENSIONS).find((type) => EXTENSIONS[type].includes(ext)) ?? 'other';
}

// ── Commands ──────────────────────────────────────────────────────────

async function cmdOpen(argv) {
  const { flags, pos } = parseArgs(argv, ['dir', 'goal', 'no-open', 'port']);
  const topic = checkLabel(pos.join(' '), 'topic');
  const port = portFlag(flags.port);
  const goal = readStdinIf(flags.goal);
  const dir = path.resolve(flags.dir ?? path.join(os.homedir(), 'explorations', slugify(topic) || 'exploration'));
  mkdirSync(filesDir(dir), { recursive: true });

  const release = lock(path.join(dir, '.map.lock'));
  let created = false;
  try {
    if (!existsSync(mapFile(dir))) {
      const at = now();
      const map = {
        version: 1, created: at, updated: at,
        nodes: [{ id: 'goal', label: topic, parent: null, state: 'current', note: goal ?? '', attachments: [], created: at }],
        links: [],
        visits: [{ step: 1, id: 'goal', at }],
      };
      writeAtomic(mapFile(dir), `${JSON.stringify(map, null, 2)}\n`);
      created = true;
    }
  } finally {
    release();
  }
  if (!created) {
    const root = readMap(dir).nodes.find((n) => n.id === 'goal');
    if (root.label !== topic) console.error(`The map exists. Its topic stays "${root.label}".`);
    if (goal !== undefined) updateMap(dir, (map) => { nodeOf(map, 'goal').note = goal; });
  }

  const server = await ensureServer(dir, port);
  if (!flags['no-open'] && server.clients === 0) openBrowser(server.url);
  console.log(dir);
  console.log(server.url);
}

function cmdAdd(argv) {
  const { flags, pos } = parseArgs(argv, ['parent', 'id', 'note', 'state']);
  const dir = resolveSession(pos[0]);
  const label = checkLabel(pos.slice(1).join(' '));
  const state = flags.state ?? 'suggested';
  if (!['suggested', 'visited'].includes(state)) fail('--state must be suggested or visited. Use focus to make a node current.');
  const note = readStdinIf(flags.note) ?? '';
  if (flags.id !== undefined) checkId(flags.id);
  const id = updateMap(dir, (map) => {
    const parent = flags.parent !== undefined ? nodeOf(map, flags.parent) : (currentOf(map) ?? nodeOf(map, 'goal'));
    if (flags.id !== undefined && map.nodes.some((n) => n.id === flags.id)) fail(`The id "${flags.id}" is in use. Give another id.`);
    const nodeId = flags.id ?? uniqueId(map, slugify(label));
    const side = parent.id === 'goal' ? { side: pickSide(map) } : {};
    map.nodes.push({ id: nodeId, label, parent: parent.id, ...side, state, note, attachments: [], created: now() });
    return nodeId;
  });
  console.log(id);
}

function cmdFocus(argv) {
  const { pos } = parseArgs(argv, []);
  const dir = resolveSession(pos[0]);
  if (!pos[1]) fail('Give the id of the node to focus.');
  const result = updateMap(dir, (map) => {
    const node = nodeOf(map, pos[1]);
    if (node.state === 'current') return null;
    const previous = currentOf(map);
    if (previous) previous.state = 'visited';
    node.state = 'current';
    const step = map.visits.reduce((max, v) => Math.max(max, Number(v.step) || 0), 0) + 1;
    map.visits.push({ step, id: node.id, at: now() });
    return step;
  });
  console.log(result === null ? `${pos[1]} is already current.` : `${pos[1]} is current (step ${result}).`);
}

function cmdNote(argv) {
  const { flags, pos } = parseArgs(argv, ['append']);
  const dir = resolveSession(pos[0]);
  if (!pos[1]) fail('Give the id of the node.');
  if (pos.length < 3) fail('Give the note text, or - to read it from stdin.');
  const text = readStdinIf(pos.slice(2).join(' '));
  updateMap(dir, (map) => {
    const node = nodeOf(map, pos[1]);
    node.note = flags.append && node.note.trim() ? `${node.note.replace(/\s+$/, '')}\n\n${text.replace(/^\s+/, '')}` : text;
  });
  console.log(`Saved the note of ${pos[1]}.`);
}

function cmdAttach(argv) {
  const { flags, pos } = parseArgs(argv, ['title']);
  const dir = resolveSession(pos[0]);
  const [, id, target] = pos;
  if (!id) fail('Give the id of the node.');
  if (!target) fail('Give a file path or a URL.');
  if (pos.length > 3) fail('Attach one file or URL at a time.');

  if (/^https?:\/\//i.test(target)) {
    let url;
    try { url = new URL(target); } catch { fail(`"${target}" is not a valid URL.`); }
    const title = flags.title ?? `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`;
    const updated = updateMap(dir, (map) => {
      const node = nodeOf(map, id);
      const existing = node.attachments.find((a) => a.type === 'link' && a.url === url.href);
      if (existing) { existing.title = flags.title ?? existing.title; return true; }
      node.attachments.push({ type: 'link', title, url: url.href, added: now() });
      return false;
    });
    console.log(updated ? `Updated the link on ${id}.` : `Attached the link to ${id}.`);
    return;
  }

  const source = path.resolve(target);
  let stat;
  try { stat = statSync(source); } catch { fail(`The file ${source} does not exist.`); }
  if (!stat.isFile()) fail(`${source} is not a file. Attach one file at a time.`);
  mkdirSync(filesDir(dir), { recursive: true });

  const inFiles = sessionFile(dir, source);
  if (inFiles) {
    const result = updateMap(dir, (map) => {
      const node = nodeOf(map, id);
      const type = typeOf(inFiles);
      const existing = node.attachments.find((a) => a.type !== 'link' && a.file === inFiles);
      if (existing) {
        Object.assign(existing, { type, title: flags.title ?? existing.title, updated: now() });
      } else {
        node.attachments.push({ type, title: flags.title ?? titleOf(source, type), file: inFiles, added: now() });
      }
      return { type, updated: Boolean(existing) };
    });
    console.log(result.updated ? `Updated ${inFiles} on ${id}.`
      : `Attached ${inFiles} to ${id} (${result.type}). The file is in files/ already, so it is not copied.`);
    return;
  }

  const result = updateMap(dir, (map) => {
    const node = nodeOf(map, id);
    const existing = node.attachments.find((a) => a.type !== 'link' && a.source === source);
    const name = existing ? path.basename(existing.file) : freeName(dir, map, path.basename(source));
    const dest = path.join(filesDir(dir), name);
    const tmp = path.join(filesDir(dir), `.${name}.${process.pid}.tmp`);
    copyFileSync(source, tmp);
    renameSync(tmp, dest);
    const type = typeOf(name);
    if (existing) {
      Object.assign(existing, { type, title: flags.title ?? existing.title, updated: now() });
    } else {
      node.attachments.push({ type, title: flags.title ?? titleOf(source, type), file: `files/${name}`, source, added: now() });
    }
    return { name, type, updated: Boolean(existing) };
  });
  console.log(result.updated ? `Updated files/${result.name} on ${id}.` : `Attached files/${result.name} to ${id} (${result.type}).`);
}

/**
 * The path as "files/..." when the file is inside the files/ folder of the session and the page
 * can show it, or null. The page does not serve names that start with a dot.
 */
function sessionFile(dir, file) {
  let real;
  let root;
  try { real = realpathSync(file); root = realpathSync(filesDir(dir)); } catch { return null; }
  const parts = path.relative(root, real).split(path.sep);
  if (!real.startsWith(root + path.sep) || parts.some((p) => !p || p.startsWith('.'))) return null;
  return `files/${parts.join('/')}`;
}

/** A file name in files/ that no file and no attachment uses yet. */
function freeName(dir, map, wanted) {
  const clean = wanted.replace(/^\.+/, '') || 'file';
  const used = new Set(map.nodes.flatMap((n) => n.attachments.filter((a) => a.file).map((a) => path.basename(a.file))));
  const ext = path.extname(clean);
  const stem = clean.slice(0, clean.length - ext.length);
  for (let n = 1; ; n++) {
    const name = n === 1 ? clean : `${stem}-${n}${ext}`;
    if (!used.has(name) && !existsSync(path.join(filesDir(dir), name))) return name;
  }
}

function titleOf(file, type) {
  const fallback = path.basename(file);
  try {
    const head = readFileSync(file, 'utf8').slice(0, 65536);
    const found = type === 'html' ? head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
      : type === 'markdown' ? head.match(/^#\s+(.+)$/m)?.[1] : null;
    const title = found?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
    return title || fallback;
  } catch {
    return fallback;
  }
}

function cmdLink(argv) {
  const { pos } = parseArgs(argv, []);
  const dir = resolveSession(pos[0]);
  const [, a, b] = pos;
  if (!a || !b) fail('Give the ids of two nodes.');
  updateMap(dir, (map) => {
    const na = nodeOf(map, a);
    const nb = nodeOf(map, b);
    if (a === b) fail('A node cannot link to itself.');
    if (map.links.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) fail(`${a} and ${b} are already linked.`);
    if (na.parent === b || nb.parent === a) fail(`${a} and ${b} are already joined by a tree edge.`);
    map.links.push([a, b]);
  });
  console.log(`Linked ${a} and ${b}.`);
}

function cmdRename(argv) {
  const { pos } = parseArgs(argv, []);
  const dir = resolveSession(pos[0]);
  if (!pos[1]) fail('Give the id of the node.');
  const label = checkLabel(pos.slice(2).join(' '));
  updateMap(dir, (map) => { nodeOf(map, pos[1]).label = label; });
  console.log(`Renamed ${pos[1]} to "${label}".`);
}

function cmdRemove(argv) {
  const { flags, pos } = parseArgs(argv, ['tree']);
  const dir = resolveSession(pos[0]);
  const id = pos[1];
  if (!id) fail('Give the id of the node.');
  const result = updateMap(dir, (map) => {
    const node = nodeOf(map, id);
    if (id === 'goal') fail('The goal node cannot be removed.');
    const kids = map.nodes.filter((n) => n.parent === id);
    if (kids.length && !flags.tree) fail(`${id} has ${plural(kids.length, 'child')}. Use --tree to remove the node and its children.`);
    const gone = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const n of map.nodes) if (!gone.has(n.id) && gone.has(n.parent)) { gone.add(n.id); grew = true; }
    }
    const lostCurrent = map.nodes.some((n) => gone.has(n.id) && n.state === 'current');
    const files = map.nodes.filter((n) => gone.has(n.id)).reduce((sum, n) => sum + n.attachments.filter((a) => a.file).length, 0);
    map.nodes = map.nodes.filter((n) => !gone.has(n.id));
    map.links = map.links.filter(([a, b]) => !gone.has(a) && !gone.has(b));
    map.visits = map.visits.filter((v) => !gone.has(v.id));
    if (lostCurrent) nodeOf(map, node.parent).state = 'current';
    return { count: gone.size, files, current: lostCurrent ? node.parent : null };
  });
  const lines = [`Removed ${plural(result.count, 'node')}.`];
  if (result.current) lines.push(`${result.current} is current now.`);
  if (result.files) lines.push(`${plural(result.files, 'attached file')} stay in files/.`);
  console.log(lines.join(' '));
}

async function cmdShow(argv) {
  const { pos } = parseArgs(argv, []);
  const dir = resolveSession(pos[0]);
  const map = readMap(dir);
  const server = await findServer(dir);
  const current = currentOf(map);
  const lines = [`map: ${dir}`];
  lines.push(server ? `url: ${server.url} (${plural(server.clients, 'page')} connected)` : 'server: not running. map.mjs open starts it.');
  if (current) lines.push(`current: ${current.id}`);
  lines.push('');

  const kids = new Map(map.nodes.map((n) => [n.id, []]));
  for (const n of map.nodes) if (n.parent !== null) kids.get(n.parent)?.push(n);
  const walk = (n, depth) => {
    const steps = stepsOf(map, n.id);
    const parts = [n.state];
    if (steps.length) parts.push(`${steps.length === 1 ? 'step' : 'steps'} ${steps.join(', ')}`);
    if (n.note.trim()) parts.push('note');
    if (n.attachments.length) parts.push(plural(n.attachments.length, 'attachment'));
    lines.push(`${'  '.repeat(depth)}${n.label} [${n.id}] ${parts.join(', ')}`);
    for (const k of kids.get(n.id)) walk(k, depth + 1);
  };
  walk(nodeOf(map, 'goal'), 0);
  if (map.links.length) {
    lines.push('', 'links:');
    for (const [a, b] of map.links) lines.push(`  ${a} -- ${b}`);
  }
  console.log(lines.join('\n'));
}

async function cmdStop(argv) {
  const { pos } = parseArgs(argv, []);
  const dir = resolveSession(pos[0]);
  const server = await findServer(dir);
  if (!server) {
    console.log('No server runs for this map.');
    return;
  }
  try { process.kill(server.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 60 && alive(server.pid); i++) await sleep(50);
  markStopped(dir, server.pid);
  console.log(`Stopped the server on port ${server.port}.`);
}

// ── Starting and finding the server ───────────────────────────────────

function readServerInfo(dir) {
  try { return JSON.parse(readFileSync(path.join(dir, '.server.json'), 'utf8')); } catch { return null; }
}

/** Keep the port of a stopped server, so the next start uses the same URL and open pages reconnect. */
function markStopped(dir, pid) {
  const info = readServerInfo(dir);
  if (!info || info.pid !== pid) return;
  writeAtomic(path.join(dir, '.server.json'), `${JSON.stringify({ ...info, pid: null, stopped: now() }, null, 2)}\n`);
}

function realDir(dir) {
  try { return realpathSync(dir); } catch { return path.resolve(dir); }
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 800 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { const info = JSON.parse(body); resolve(info.app === APP ? info : null); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** The live server of this session, or null. */
async function findServer(dir) {
  const info = readServerInfo(dir);
  if (!info?.pid || !info.port) return null;
  const live = await ping(info.port);
  if (!live || live.dir !== realDir(dir)) return null;
  return { url: `http://127.0.0.1:${live.port}/`, port: live.port, pid: live.pid, clients: live.clients };
}

async function ensureServer(dir, port) {
  const release = lock(path.join(dir, '.server.lock'));
  try {
    const live = await findServer(dir);
    if (live) return live;
    const log = openSync(path.join(dir, '.server.log'), 'a');
    const args = [SCRIPT, 'serve', dir, ...(port ? ['--port', String(port)] : [])];
    const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', log, log], windowsHide: true });
    child.unref();
    closeSync(log);
    let exited = false;
    child.on('exit', () => { exited = true; });
    for (const end = Date.now() + 8000; Date.now() < end && !exited;) {
      await sleep(40);
      const info = readServerInfo(dir);
      if (info?.pid !== child.pid) continue;
      const started = await findServer(dir);
      if (started) return started;
    }
    fail(`The server did not start. See ${path.join(dir, '.server.log')}.`);
  } finally {
    release();
  }
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => console.error(`Open ${url} in a browser.`));
    child.unref();
  } catch {
    console.error(`Open ${url} in a browser.`);
  }
}

// ── The server ────────────────────────────────────────────────────────

async function cmdServe(argv) {
  const { flags, pos } = parseArgs(argv, ['port', 'idle']);
  const dir = realDir(path.resolve(pos[0] ?? fail('Give the session folder.')));
  const files = filesDir(dir);
  mkdirSync(files, { recursive: true });
  const idleMs = flags.idle !== undefined ? Number(flags.idle) : IDLE_MS;
  const log = (message) => console.log(`${now()} ${message}`);

  const state = { text: null, map: null, error: null, files: new Map() };
  const clients = new Set();

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (event, data) => { for (const res of clients) send(res, event, data); };

  const loadMap = () => {
    let text;
    try { text = readFileSync(mapFile(dir), 'utf8'); } catch { text = null; }
    if (text === state.text) return;
    state.text = text;
    const { map, error } = text === null ? { error: 'map.json is missing.' } : parseMap(text);
    if (error) {
      state.error = error;
      log(`${error} The page keeps the last good map.`);
      broadcast('map-error', { message: error });
    } else {
      state.map = map;
      state.error = null;
      broadcast('map', map);
    }
  };

  const snapshotFiles = () => {
    const snap = new Map();
    let names = [];
    try { names = readdirSync(files); } catch {}
    for (const name of names) {
      if (name.startsWith('.')) continue;
      try { const s = statSync(path.join(files, name)); if (s.isFile()) snap.set(name, `${s.mtimeMs}:${s.size}`); } catch {}
    }
    return snap;
  };

  const diffFiles = () => {
    const next = snapshotFiles();
    for (const [name, sig] of next) if (state.files.get(name) !== sig) broadcast('file', { name });
    for (const name of state.files.keys()) if (!next.has(name)) broadcast('file', { name });
    state.files = next;
  };

  // A burst of changes sends one update: 50 ms after the last change, or 200 ms after the first.
  let timer = null;
  let first = 0;
  const flush = () => { timer = null; first = 0; loadMap(); diffFiles(); };
  const schedule = () => {
    if (!first) first = Date.now();
    clearTimeout(timer);
    timer = setTimeout(flush, Math.max(0, Math.min(DEBOUNCE_MS, first + 200 - Date.now())));
  };

  loadMap();
  state.files = snapshotFiles();

  const watchers = [];
  const watchDir = (target, filter) => {
    try { watchers.push(watch(target, (_event, name) => { if (filter(name)) schedule(); })); } catch {}
  };
  watchDir(dir, (name) => !name || name === 'map.json');
  watchDir(files, (name) => !name || !String(name).startsWith('.'));

  let idleTimer = null;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!clients.size) shutdown('No page was connected for a while.'); }, idleMs);
  };

  const pageCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; "
    + "connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
  // Attached HTML and SVG run in a sandbox with its own origin, so they cannot reach the page.
  const sandboxCsp = 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads';

  const reply = (res, status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  };

  const serveFile = (req, res, base, rel, headers = {}) => {
    const root = realDir(base);
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep)) return reply(res, 403, 'Forbidden.');
    let real;
    try { real = realpathSync(full); } catch { return reply(res, 404, 'Not found.'); }
    if (!real.startsWith(root + path.sep)) return reply(res, 403, 'Forbidden.');
    let stat;
    try { stat = statSync(real); } catch { return reply(res, 404, 'Not found.'); }
    if (!stat.isFile()) return reply(res, 404, 'Not found.');
    const ext = path.extname(real).toLowerCase();
    const type = MIME[ext] ?? (typeOf(real) === 'markdown' || typeOf(real) === 'text' ? 'text/plain; charset=utf-8' : 'application/octet-stream');
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(real).on('error', () => res.destroy()).pipe(res);
  };

  const handle = (req, res) => {
    const host = String(req.headers.host ?? '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) return reply(res, 403, 'Forbidden.'); // blocks DNS rebinding
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed.');

    let pathname;
    try { pathname = decodeURIComponent(String(req.url).split(/[?#]/)[0]); } catch { return reply(res, 400, 'Bad request.'); }
    const parts = pathname.split('/').slice(1);
    if (!pathname.startsWith('/') || /[\0\\]/.test(pathname) || parts.some((p) => p === '..' || p === '.' || p.startsWith('.'))) {
      return reply(res, 403, 'Forbidden.');
    }

    if (pathname === '/' || pathname === '/index.html') return serveFile(req, res, PAGE_DIR, 'index.html', { 'Content-Security-Policy': pageCsp });
    if (pathname === '/api/ping') {
      return reply(res, 200, JSON.stringify({ app: APP, dir, pid: process.pid, port: server.address().port, clients: clients.size }), 'application/json; charset=utf-8');
    }
    if (pathname === '/map.json') {
      if (!state.map) return reply(res, 503, state.error ?? 'No map yet.');
      return reply(res, 200, JSON.stringify(state.map), 'application/json; charset=utf-8');
    }
    if (pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 1000\n\n');
      clients.add(res);
      clearTimeout(idleTimer);
      if (state.map) send(res, 'map', state.map);
      if (state.error) send(res, 'map-error', { message: state.error });
      req.on('close', () => { clients.delete(res); if (!clients.size) armIdle(); });
      return;
    }
    if (parts[0] === 'files' && parts.length > 1) {
      const name = parts.slice(1).join('/');
      const sandboxed = ['.html', '.htm', '.svg'].includes(path.extname(name).toLowerCase());
      return serveFile(req, res, files, name, sandboxed ? { 'Content-Security-Policy': sandboxCsp } : {});
    }
    if (parts[0] === 'fonts' && parts.length === 2) return serveFile(req, res, FONT_DIR, parts[1], { 'Cache-Control': 'max-age=86400' });
    if (parts.length === 1 && /\.(css|js|mjs)$/.test(parts[0])) return serveFile(req, res, PAGE_DIR, parts[0]);
    return reply(res, 404, 'Not found.');
  };

  const saved = readServerInfo(dir)?.port;
  const candidates = [portFlag(flags.port), saved];
  for (let p = FIRST_PORT; candidates.length < PORT_TRIES; p++) candidates.push(p);
  let server = null;
  for (const port of [...new Set(candidates.filter((p) => p && !RESERVED_PORTS.has(p)))]) {
    const attempt = http.createServer(handle);
    try {
      await new Promise((resolve, reject) => {
        attempt.once('error', reject);
        attempt.listen(port, '127.0.0.1', () => { attempt.off('error', reject); resolve(); });
      });
      server = attempt;
      break;
    } catch (e) {
      attempt.close();
      if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e;
    }
  }
  if (!server) fail('No free port found.');
  const port = server.address().port;
  writeAtomic(path.join(dir, '.server.json'), `${JSON.stringify({ pid: process.pid, port, url: `http://127.0.0.1:${port}/`, started: now() }, null, 2)}\n`);
  log(`Serving ${dir} on http://127.0.0.1:${port}/`);

  // A safety net for missed watch events, and a way to notice that the folder is gone.
  const poll = setInterval(() => {
    if (!existsSync(dir)) return shutdown('The session folder is gone.');
    schedule();
  }, 1000);
  const heartbeat = setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15000);
  armIdle();

  let stopping = false;
  function shutdown(reason) {
    if (stopping) return;
    stopping = true;
    log(`Stopping. ${reason}`);
    clearInterval(poll);
    clearInterval(heartbeat);
    clearTimeout(idleTimer);
    clearTimeout(timer);
    try { markStopped(dir, process.pid); } catch {} // before the port closes, so `stop` sees the new file
    for (const w of watchers) w.close();
    for (const res of clients) res.end();
    server.close();
    setTimeout(() => process.exit(0), 50);
  }
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => shutdown(`Got ${signal}.`));
}

// ── Main ──────────────────────────────────────────────────────────────

const COMMANDS = {
  open: cmdOpen, add: cmdAdd, focus: cmdFocus, note: cmdNote, attach: cmdAttach, link: cmdLink,
  rename: cmdRename, remove: cmdRemove, show: cmdShow, stop: cmdStop, serve: cmdServe,
};

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }
  const run = COMMANDS[command];
  if (!run) fail(`Unknown command "${command}". Run map.mjs help.`);
  await run(rest);
}

if (process.argv[1] && realDir(process.argv[1]) === realDir(SCRIPT)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof UserError ? `map.mjs: ${e.message}` : e);
    process.exit(1);
  });
}
