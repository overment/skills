import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { SCRIPT, alive, freePort, get, listen, ok, openSession, readMap, sleep, tempDir } from './helpers.mjs';

describe('live server', () => {
  let s;
  before(async () => { s = await openSession(); });
  after(() => s.cleanup());

  test('open prints the folder and the URL, and reuses the live server', () => {
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const info = JSON.parse(readFileSync(path.join(s.dir, '.server.json'), 'utf8'));
    const again = ok(['open', 'Vector databases', '--dir', s.dir, '--no-open']).split('\n');
    assert.deepEqual(again, [s.dir, s.url]);
    assert.equal(JSON.parse(readFileSync(path.join(s.dir, '.server.json'), 'utf8')).pid, info.pid);
    assert.match(ok(['show', s.dir]), new RegExp(`url: ${s.url.replace(/[.]/g, '\\.')} \\(0 pages connected\\)`));
  });

  test('serves the page, the fonts, map.json and files', async () => {
    const page = await get(s.port, '/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);
    for (const asset of ['/map.css', '/map.js', '/theme.js', '/layout.mjs', '/markdown.mjs', '/nav.mjs']) assert.equal((await get(s.port, asset)).status, 200, asset);
    const font = await get(s.port, '/fonts/geist-latin-wght-normal.woff2');
    assert.equal(font.status, 200);
    assert.equal(font.headers['content-type'], 'font/woff2');
    const map = await get(s.port, '/map.json');
    assert.equal(JSON.parse(map.body).nodes[0].id, 'goal');

    const src = tempDir();
    writeFileSync(path.join(src, 'notes.md'), '# Notes');
    writeFileSync(path.join(src, 'demo.html'), '<p>demo</p>');
    ok(['attach', s.dir, 'goal', path.join(src, 'notes.md')]);
    ok(['attach', s.dir, 'goal', path.join(src, 'demo.html')]);
    const md = await get(s.port, '/files/notes.md');
    assert.equal(md.status, 200);
    assert.match(md.headers['content-type'], /text\/plain/);
    assert.equal(md.body, '# Notes');
    const html = await get(s.port, '/files/demo.html');
    assert.match(html.headers['content-security-policy'], /^sandbox allow-scripts/);
  });

  test('blocks path traversal and foreign hosts', async () => {
    const attempts = [
      '/files/../map.json', '/files/../.server.json', '/files/..%2fmap.json', '/files/%2e%2e/map.json',
      '/files/%2e%2e%2f%2e%2e%2fscripts%2fmap.mjs', '/fonts/../../scripts/map.mjs', '/fonts/..%2F..%2Fscripts%2Fmap.mjs',
      '/..%2fmap.mjs', '/%2e%2e/%2e%2e/etc/passwd', '/files/%00.md', '/files/..\\map.json', '/.server.json', '/files/.hidden',
      '/%E0%A4%A', '/page/../map.mjs',
    ];
    for (const attempt of attempts) {
      const res = await get(s.port, attempt);
      assert.ok([400, 403, 404].includes(res.status), `${attempt} gave ${res.status}`);
      assert.doesNotMatch(res.body, /"nodes"|"pid"|import |root:/, attempt);
    }
    assert.equal((await get(s.port, '/map.json', { Host: 'evil.example:80' })).status, 403);
    assert.equal((await get(s.port, '/map.json', { Host: `localhost:${s.port}` })).status, 200);
  });

  test('pushes the whole map over SSE after a command', async () => {
    const events = listen(s.port);
    try {
      const first = await events.next((e) => e.event === 'map');
      assert.equal(first.data.nodes[0].id, 'goal');
      const started = Date.now();
      ok(['add', s.dir, 'Embeddings', '--note', 'Vectors']);
      const pushed = await events.next((e) => e.event === 'map' && e.data.nodes.some((n) => n.id === 'embeddings'));
      assert.ok(Date.now() - started < 2000, 'the push arrives quickly');
      assert.equal(pushed.data.nodes.find((n) => n.id === 'embeddings').note, 'Vectors');
      ok(['focus', s.dir, 'embeddings']);
      const focused = await events.next((e) => e.event === 'map' && e.data.nodes.find((n) => n.id === 'embeddings')?.state === 'current');
      assert.equal(focused.data.visits.at(-1).id, 'embeddings');
      assert.match(ok(['show', s.dir]), /\(1 page connected\)/);
    } finally {
      events.close();
    }
  });

  test('sends the file name when an attached file changes', async () => {
    const src = tempDir();
    const file = path.join(src, 'artifact.html');
    writeFileSync(file, '<p>v1</p>');
    ok(['attach', s.dir, 'goal', file]);
    const events = listen(s.port);
    try {
      await events.next((e) => e.event === 'map');
      writeFileSync(file, '<p>v2</p>');
      ok(['attach', s.dir, 'goal', file]);
      const changed = await events.next((e) => e.event === 'file' && e.data.name === 'artifact.html');
      assert.equal(changed.data.name, 'artifact.html');
      writeFileSync(path.join(s.dir, 'files', 'artifact.html'), '<p>edited by hand</p>');
      await events.next((e) => e.event === 'file' && e.data.name === 'artifact.html');
    } finally {
      events.close();
    }
  });

  test('keeps the last good map when map.json breaks, and recovers', async () => {
    const events = listen(s.port);
    const file = path.join(s.dir, 'map.json');
    const good = readFileSync(file, 'utf8');
    try {
      await events.next((e) => e.event === 'map');
      writeFileSync(file, '{ "nodes": [ oops');
      const error = await events.next((e) => e.event === 'map-error');
      assert.match(error.data.message, /map\.json is not valid JSON/);
      const served = JSON.parse((await get(s.port, '/map.json')).body);
      assert.deepEqual(served.nodes.map((n) => n.id), JSON.parse(good).nodes.map((n) => n.id));
      writeFileSync(file, good.replace('"Vector databases"', '"Vector stores"'));
      const back = await events.next((e) => e.event === 'map');
      assert.equal(back.data.nodes[0].label, 'Vector stores');
    } finally {
      writeFileSync(file, good);
      events.close();
    }
  });
});

describe('server life', () => {
  test('stop ends the server and commands keep working without it', async () => {
    const s = await openSession();
    try {
      const { pid } = JSON.parse(readFileSync(path.join(s.dir, '.server.json'), 'utf8'));
      assert.match(ok(['stop', s.dir]), /Stopped the server/);
      for (let i = 0; i < 40 && alive(pid); i++) await sleep(50);
      assert.equal(alive(pid), false);
      const info = JSON.parse(readFileSync(path.join(s.dir, '.server.json'), 'utf8'));
      assert.deepEqual([info.pid, info.port], [null, s.port], 'the port stays for the next start');
      const [, url] = ok(['open', 'Vector databases', '--dir', s.dir, '--no-open']).split('\n');
      assert.equal(url, s.url, 'the next start uses the same port');
      ok(['stop', s.dir]);
      ok(['add', s.dir, 'Offline']);
      assert.ok(readMap(s.dir).nodes.some((n) => n.id === 'offline'));
    } finally {
      await s.cleanup();
    }
  });

  test('takes the next port when the wanted one is busy', async () => {
    const busy = await freePort();
    const blocker = net.createServer().listen(busy, '127.0.0.1');
    await new Promise((resolve) => blocker.once('listening', resolve));
    const dir = path.join(tempDir(), 'session');
    try {
      const [, url] = ok(['open', 'Ports', '--dir', dir, '--no-open', '--port', String(busy)]).split('\n');
      assert.notEqual(Number(new URL(url).port), busy);
    } finally {
      ok(['stop', dir]);
      blocker.close();
    }
  });

  test('exits after the idle time with no page, and waits while a page is connected', async () => {
    const s = await openSession();
    ok(['stop', s.dir]);
    const port = await freePort();
    const child = spawn(process.execPath, [SCRIPT, 'serve', s.dir, '--port', String(port), '--idle', '400'], { stdio: 'ignore' });
    try {
      for (let i = 0; i < 60 && !(await get(port, '/api/ping').catch(() => null)); i++) await sleep(25);
      const events = listen(port);
      await events.next((e) => e.event === 'map');
      await sleep(700);
      assert.equal(alive(child.pid), true, 'a connected page keeps the server alive');
      events.close();
      const exited = await Promise.race([new Promise((resolve) => child.once('exit', () => resolve(true))), sleep(3000).then(() => false)]);
      assert.equal(exited, true, 'the server exits once no page is connected');
      assert.equal(JSON.parse(readFileSync(path.join(s.dir, '.server.json'), 'utf8')).pid, null);
    } finally {
      child.kill();
      await s.cleanup();
    }
  });
});
