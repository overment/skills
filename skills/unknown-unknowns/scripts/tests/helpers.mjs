// Shared helpers for the map tests. Every test works in a folder under the system temp dir and
// sets HOME to a temp folder too, so no test can touch ~/explorations.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT = fileURLToPath(new URL('../map.mjs', import.meta.url));
const HOME = mkdtempSync(path.join(os.tmpdir(), 'uu-map-home-'));
const env = { ...process.env, HOME, USERPROFILE: HOME };
const made = [HOME];
process.on('exit', () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

export function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'uu-map-test-'));
  made.push(dir);
  return dir;
}

export function run(args, { input } = {}) {
  const out = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, input, timeout: 20000 });
  return { code: out.status, stdout: out.stdout.trim(), stderr: out.stderr.trim() };
}

export function runAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

/** Run a command that must succeed and return its output. */
export function ok(args, options) {
  const out = run(args, options);
  if (out.code !== 0) throw new Error(`map.mjs ${args.join(' ')} failed: ${out.stderr}`);
  return out.stdout;
}

export function readMap(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'map.json'), 'utf8'));
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Start a session with a live server. Returns the folder, the port and a cleanup function. */
export async function openSession(topic = 'Vector databases', extra = []) {
  const root = tempDir();
  const dir = path.join(root, 'session');
  const port = await freePort();
  const [printedDir, url] = ok(['open', topic, '--dir', dir, '--no-open', '--port', String(port), ...extra]).split('\n');
  return {
    dir: printedDir,
    url,
    port: Number(new URL(url).port),
    cleanup: async () => {
      let pid = null;
      try { pid = JSON.parse(readFileSync(path.join(dir, '.server.json'), 'utf8')).pid; } catch {}
      run(['stop', dir]);
      for (let i = 0; pid && alive(pid) && i < 60; i++) await sleep(50);
      if (pid && alive(pid)) process.kill(pid);
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

/** A raw GET, so paths such as /files/../x reach the server as written. */
export function get(port, rawPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET', headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Listen to /events. next(test) waits for the first event that passes the test. */
export function listen(port) {
  const queue = [];
  const waiters = [];
  let buffer = '';
  const req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = block.match(/^event: (.*)$/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (!event) continue;
        queue.push({ event, data: JSON.parse(data) });
        flush();
      }
    });
  });
  req.on('error', () => {});
  const flush = () => {
    for (const w of [...waiters]) {
      const index = queue.findIndex(w.test);
      if (index === -1) continue;
      const [found] = queue.splice(0, index + 1).slice(-1);
      waiters.splice(waiters.indexOf(w), 1);
      clearTimeout(w.timer);
      w.resolve(found);
    }
  };
  return {
    next(test, timeout = 4000) {
      return new Promise((resolve, reject) => {
        const w = { test, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('No matching event arrived.')); }, timeout) };
        waiters.push(w);
        flush();
      });
    },
    close: () => req.destroy(),
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
