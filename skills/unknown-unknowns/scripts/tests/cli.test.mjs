import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ok, openSession, readMap, run, runAsync, tempDir } from './helpers.mjs';

describe('cli', () => {
  // One real session made by `open`, stopped, then copied for each test. No test needs a server.
  let template;
  const roots = [];

  before(async () => {
    const session = await openSession('Vector databases', ['--goal', 'Pick one for a RAG app']);
    run(['stop', session.dir]);
    template = tempDir();
    cpSync(path.join(session.dir, 'map.json'), path.join(template, 'map.json'));
    mkdirSync(path.join(template, 'files'));
    await session.cleanup();
  });

  after(() => {
    for (const dir of [template, ...roots]) rmSync(dir, { recursive: true, force: true });
  });

  function session() {
    const root = tempDir();
    roots.push(root);
    const dir = path.join(root, 'session');
    cpSync(template, dir, { recursive: true });
    return dir;
  }

  function fails(args, pattern, options) {
    const out = run(args, options);
    assert.notEqual(out.code, 0, `expected map.mjs ${args.join(' ')} to fail`);
    assert.match(out.stderr, pattern);
    return out.stderr;
  }

  describe('open', () => {
    test('creates the folder, the goal node and the first step', () => {
      const map = readMap(template);
      assert.equal(map.nodes.length, 1);
      assert.deepEqual(
        { id: map.nodes[0].id, label: map.nodes[0].label, parent: map.nodes[0].parent, state: map.nodes[0].state, note: map.nodes[0].note },
        { id: 'goal', label: 'Vector databases', parent: null, state: 'current', note: 'Pick one for a RAG app' },
      );
      assert.deepEqual(map.visits.map((v) => [v.step, v.id]), [[1, 'goal']]);
      assert.deepEqual(map.links, []);
    });

    test('rejects a long topic, a reserved port and a bad port', () => {
      const dir = path.join(tempDir(), 'x');
      roots.push(path.dirname(dir));
      fails(['open', 'A topic with far too many words', '--dir', dir, '--no-open'], /at most 3 words and 28 characters/);
      fails(['open', 'Short', '--dir', dir, '--no-open', '--port', '8787'], /kept free for other tools/);
      fails(['open', 'Short', '--dir', dir, '--no-open', '--port', 'abc'], /--port must be a whole number/);
      assert.equal(existsSync(path.join(dir, 'map.json')), false);
    });
  });

  describe('add', () => {
    test('adds to the current node with a unique slug id', () => {
      const dir = session();
      assert.equal(ok(['add', dir, 'Embeddings']), 'embeddings');
      assert.equal(ok(['add', dir, 'Embeddings']), 'embeddings-2');
      assert.equal(ok(['add', dir, 'Crème brûlée']), 'creme-brulee');
      ok(['focus', dir, 'embeddings']);
      assert.equal(ok(['add', dir, 'Cosine', '--note', 'Angle **only**']), 'cosine');
      const map = readMap(dir);
      const byId = Object.fromEntries(map.nodes.map((n) => [n.id, n]));
      assert.equal(byId.embeddings.parent, 'goal');
      assert.equal(byId['embeddings-2'].parent, 'goal');
      assert.equal(byId.cosine.parent, 'embeddings');
      assert.equal(byId.cosine.state, 'suggested');
      assert.equal(byId.cosine.note, 'Angle **only**');
    });

    test('a node under the goal goes to the shorter side and keeps it', () => {
      const dir = session();
      ok(['add', dir, 'Alpha', '--parent', 'goal']);
      ok(['add', dir, 'Beta', '--parent', 'goal']);
      for (const label of ['One', 'Two', 'Three']) ok(['add', dir, label, '--parent', 'beta']);
      ok(['add', dir, 'Gamma', '--parent', 'goal']);
      const side = (id) => readMap(dir).nodes.find((n) => n.id === id).side;
      assert.deepEqual(['alpha', 'beta', 'gamma'].map(side), ['right', 'left', 'right']);
      assert.equal(side('one'), undefined, 'only first-level nodes store a side');
      for (const label of ['Four', 'Five', 'Six', 'Seven']) ok(['add', dir, label, '--parent', 'alpha']);
      assert.deepEqual(['alpha', 'beta', 'gamma'].map(side), ['right', 'left', 'right'], 'growth moves no branch');
    });

    test('a map from before sides were stored gets them on its next change', () => {
      const dir = session();
      const map = readMap(dir);
      const plain = (id, parent) => ({ id, label: id, parent, state: 'suggested', note: '', attachments: [] });
      map.nodes.push(plain('x', 'goal'), plain('x1', 'x'), plain('x2', 'x'), plain('x3', 'x'), plain('y', 'goal'), plain('z', 'goal'));
      writeFileSync(path.join(dir, 'map.json'), JSON.stringify(map));
      ok(['show', dir]);
      assert.equal(readMap(dir).nodes.find((n) => n.id === 'x').side, undefined, 'reading changes nothing');
      ok(['add', dir, 'Deep', '--parent', 'z']);
      const sides = Object.fromEntries(readMap(dir).nodes.filter((n) => n.parent === 'goal').map((n) => [n.id, n.side]));
      assert.deepEqual(sides, { x: 'right', y: 'left', z: 'left' });
    });

    test('takes --parent, --id and --state visited', () => {
      const dir = session();
      ok(['add', dir, 'Embeddings']);
      assert.equal(ok(['add', dir, 'HNSW', '--parent', 'embeddings', '--id', 'graph-index', '--state', 'visited']), 'graph-index');
      const node = readMap(dir).nodes.find((n) => n.id === 'graph-index');
      assert.equal(node.parent, 'embeddings');
      assert.equal(node.state, 'visited');
    });

    test('rejects unknown parents, ids in use, bad ids and bad states', () => {
      const dir = session();
      fails(['add', dir, 'X', '--parent', 'nope'], /No node has the id "nope"/);
      fails(['add', dir, 'X', '--id', 'goal'], /The id "goal" is in use/);
      fails(['add', dir, 'X', '--id', 'has space'], /is not valid/);
      fails(['add', dir, 'X', '--state', 'current'], /--state must be suggested or visited/);
      fails(['add', dir, 'X', '--colour', 'red'], /Unknown option --colour/);
      assert.equal(readMap(dir).nodes.length, 1);
    });

    test('allows at most 3 words and 28 characters in a label', () => {
      const dir = session();
      ok(['add', dir, 'one two three']);
      ok(['add', dir, 'x'.repeat(28)]);
      const message = fails(['add', dir, 'one two three four'], /4 words/);
      assert.match(message, /canvas shows only crucial names/);
      assert.match(message, /note/);
      fails(['add', dir, 'y'.repeat(29)], /29 characters/);
      fails(['add', dir, '   '], /The label is empty/);
      assert.equal(readMap(dir).nodes.length, 3);
    });
  });

  describe('focus', () => {
    test('moves current, marks the previous node visited and records steps', () => {
      const dir = session();
      ok(['add', dir, 'Alpha']);
      ok(['add', dir, 'Beta']);
      assert.match(ok(['focus', dir, 'alpha']), /step 2/);
      assert.match(ok(['focus', dir, 'beta']), /step 3/);
      assert.match(ok(['focus', dir, 'beta']), /already current/);
      assert.match(ok(['focus', dir, 'alpha']), /step 4/);
      const map = readMap(dir);
      const state = Object.fromEntries(map.nodes.map((n) => [n.id, n.state]));
      assert.deepEqual(state, { goal: 'visited', alpha: 'current', beta: 'visited' });
      assert.deepEqual(map.visits.map((v) => [v.step, v.id]), [[1, 'goal'], [2, 'alpha'], [3, 'beta'], [4, 'alpha']]);
      fails(['focus', dir, 'gamma'], /No node has the id "gamma"/);
    });
  });

  describe('note', () => {
    test('replaces, appends and reads stdin', () => {
      const dir = session();
      ok(['note', dir, 'goal', 'First']);
      ok(['note', dir, 'goal', 'Second', '--append']);
      assert.equal(readMap(dir).nodes[0].note, 'First\n\nSecond');
      ok(['note', dir, 'goal', '-'], { input: '- one\n- two\n' });
      assert.equal(readMap(dir).nodes[0].note, '- one\n- two');
      ok(['note', dir, 'goal', '- a list item']);
      assert.equal(readMap(dir).nodes[0].note, '- a list item');
      fails(['note', dir, 'nope', 'x'], /No node has the id/);
      fails(['note', dir, 'goal'], /Give the note text/);
    });
  });

  describe('link', () => {
    test('draws cross links and rejects bad ones', () => {
      const dir = session();
      ok(['add', dir, 'Alpha']);
      ok(['add', dir, 'Beta']);
      ok(['add', dir, 'Gamma', '--parent', 'alpha']);
      ok(['link', dir, 'gamma', 'beta']);
      fails(['link', dir, 'gamma', 'beta'], /already linked/);
      fails(['link', dir, 'beta', 'gamma'], /already linked/);
      fails(['link', dir, 'beta', 'beta'], /cannot link to itself/);
      fails(['link', dir, 'alpha', 'gamma'], /tree edge/);
      fails(['link', dir, 'beta', 'nope'], /No node has the id "nope"/);
      assert.deepEqual(readMap(dir).links, [['gamma', 'beta']]);
    });
  });

  describe('rename', () => {
    test('changes the label and keeps the id', () => {
      const dir = session();
      ok(['add', dir, 'Alpha']);
      ok(['rename', dir, 'alpha', 'Alpha prime']);
      const node = readMap(dir).nodes.find((n) => n.id === 'alpha');
      assert.equal(node.label, 'Alpha prime');
      fails(['rename', dir, 'alpha', 'a b c d e'], /at most 3 words/);
      fails(['rename', dir, 'nope', 'X'], /No node has the id/);
    });
  });

  describe('remove', () => {
    test('protects the goal and nodes with children', () => {
      const dir = session();
      ok(['add', dir, 'Alpha']);
      ok(['add', dir, 'Child', '--parent', 'alpha']);
      fails(['remove', dir, 'goal'], /goal node cannot be removed/);
      fails(['remove', dir, 'alpha'], /has 1 child. Use --tree/);
      fails(['remove', dir, 'nope'], /No node has the id/);
      assert.equal(readMap(dir).nodes.length, 3);
    });

    test('--tree removes the subtree, its links and visits, and moves current up', () => {
      const dir = session();
      ok(['add', dir, 'Alpha']);
      ok(['add', dir, 'Beta']);
      ok(['add', dir, 'Child', '--parent', 'alpha']);
      ok(['link', dir, 'child', 'beta']);
      ok(['focus', dir, 'alpha']);
      ok(['focus', dir, 'child']);
      assert.match(ok(['remove', dir, 'alpha', '--tree']), /Removed 2 nodes\. goal is current now\./);
      const map = readMap(dir);
      assert.deepEqual(map.nodes.map((n) => n.id), ['goal', 'beta']);
      assert.equal(map.nodes[0].state, 'current');
      assert.deepEqual(map.links, []);
      assert.deepEqual(map.visits.map((v) => v.id), ['goal']);
      ok(['remove', dir, 'beta']);
      assert.deepEqual(readMap(dir).nodes.map((n) => n.id), ['goal']);
    });
  });

  describe('attach', () => {
    test('copies files, records the type by extension and avoids name clashes', () => {
      const dir = session();
      const src = tempDir();
      roots.push(src);
      const files = {
        'page.html': '<!doctype html><title>Demo &amp; page</title><p>Hi</p>',
        'chart.png': 'png',
        'paper.pdf': '%PDF-1.4',
        'notes.md': '# Reading notes\n\nText',
        'data.csv': 'a,b',
        'blob.bin': 'x',
      };
      for (const [name, body] of Object.entries(files)) writeFileSync(path.join(src, name), body);
      for (const name of Object.keys(files)) ok(['attach', dir, 'goal', path.join(src, name)]);
      mkdirSync(path.join(src, 'other'));
      writeFileSync(path.join(src, 'other', 'page.html'), '<p>Other</p>');
      assert.match(ok(['attach', dir, 'goal', path.join(src, 'other', 'page.html'), '--title', 'Second page']), /files\/page-2\.html/);
      ok(['attach', dir, 'goal', 'https://example.com/docs/', '--title', 'Docs']);

      const list = readMap(dir).nodes[0].attachments;
      assert.deepEqual(list.map((a) => [a.type, a.file ?? a.url, a.title]), [
        ['html', 'files/page.html', 'Demo & page'],
        ['image', 'files/chart.png', 'chart.png'],
        ['pdf', 'files/paper.pdf', 'paper.pdf'],
        ['markdown', 'files/notes.md', 'Reading notes'],
        ['text', 'files/data.csv', 'data.csv'],
        ['other', 'files/blob.bin', 'blob.bin'],
        ['html', 'files/page-2.html', 'Second page'],
        ['link', 'https://example.com/docs/', 'Docs'],
      ]);
      assert.deepEqual(readdirSync(path.join(dir, 'files')).sort(), ['blob.bin', 'chart.png', 'data.csv', 'notes.md', 'page-2.html', 'page.html', 'paper.pdf']);
      assert.equal(readFileSync(path.join(dir, 'files', 'page-2.html'), 'utf8'), '<p>Other</p>');
    });

    test('attaching the same file again updates the copy in place', () => {
      const dir = session();
      const src = tempDir();
      roots.push(src);
      const file = path.join(src, 'demo.html');
      writeFileSync(file, '<p>v1</p>');
      ok(['attach', dir, 'goal', file]);
      writeFileSync(file, '<p>v2</p>');
      assert.match(ok(['attach', dir, 'goal', file]), /Updated files\/demo\.html/);
      assert.equal(readMap(dir).nodes[0].attachments.length, 1);
      assert.equal(readFileSync(path.join(dir, 'files', 'demo.html'), 'utf8'), '<p>v2</p>');
    });

    test('a file that is in files/ already is recorded where it is, with no copy', () => {
      const dir = session();
      mkdirSync(path.join(dir, 'files', 'drafts'));
      writeFileSync(path.join(dir, 'files', 'sketch.html'), '<title>Sketch</title><p>v1</p>');
      writeFileSync(path.join(dir, 'files', 'drafts', 'plan.md'), '# Plan');
      writeFileSync(path.join(dir, 'files', '.hidden.md'), '# Hidden');
      ok(['add', dir, 'Alpha']);

      assert.match(ok(['attach', dir, 'goal', path.join(dir, 'files', 'sketch.html')]), /Attached files\/sketch\.html to goal \(html\)\. The file is in files\/ already/);
      assert.match(ok(['attach', dir, 'goal', path.join(dir, 'files', 'sketch.html'), '--title', 'New title']), /Updated files\/sketch\.html on goal/);
      ok(['attach', dir, 'alpha', path.join(dir, 'files', 'sketch.html')]);
      ok(['attach', dir, 'alpha', path.join(dir, 'files', 'drafts', 'plan.md')]);
      // The page does not serve hidden names, so a hidden file is copied to a name it can show.
      assert.match(ok(['attach', dir, 'alpha', path.join(dir, 'files', '.hidden.md')]), /Attached files\/hidden\.md/);

      const map = readMap(dir);
      const list = (id) => map.nodes.find((n) => n.id === id).attachments.map((a) => [a.type, a.file, a.title, a.source ?? null]);
      assert.deepEqual(list('goal'), [['html', 'files/sketch.html', 'New title', null]]);
      assert.deepEqual(list('alpha'), [
        ['html', 'files/sketch.html', 'Sketch', null],
        ['markdown', 'files/drafts/plan.md', 'Plan', null],
        ['markdown', 'files/hidden.md', 'Hidden', path.join(dir, 'files', '.hidden.md')],
      ]);
      assert.deepEqual(readdirSync(path.join(dir, 'files')).sort(), ['.hidden.md', 'drafts', 'hidden.md', 'sketch.html']);
      assert.equal(readFileSync(path.join(dir, 'files', 'sketch.html'), 'utf8'), '<title>Sketch</title><p>v1</p>');
    });

    test('rejects missing files, folders and unknown nodes', () => {
      const dir = session();
      const src = tempDir();
      roots.push(src);
      fails(['attach', dir, 'goal', path.join(src, 'missing.md')], /does not exist/);
      fails(['attach', dir, 'goal', src], /is not a file/);
      writeFileSync(path.join(src, 'a.md'), 'x');
      fails(['attach', dir, 'nope', path.join(src, 'a.md')], /No node has the id/);
      assert.equal(readMap(dir).nodes[0].attachments.length, 0);
    });
  });

  describe('show', () => {
    test('prints an indented outline with state, steps, notes and attachments', () => {
      const dir = session();
      ok(['add', dir, 'Alpha']);
      ok(['focus', dir, 'alpha']);
      ok(['add', dir, 'Child', '--note', 'Detail']);
      ok(['link', dir, 'child', 'goal']);
      ok(['attach', dir, 'alpha', 'https://example.com']);
      const out = ok(['show', dir]);
      assert.match(out, /server: not running/);
      assert.match(out, /^current: alpha$/m);
      assert.match(out, /^Vector databases \[goal\] visited, step 1, note$/m);
      assert.match(out, /^ {2}Alpha \[alpha\] current, step 2, 1 attachment$/m);
      assert.match(out, /^ {4}Child \[child\] suggested, note$/m);
      assert.match(out, /^ {2}child -- goal$/m);
    });
  });

  describe('general', () => {
    test('help lists every command', () => {
      const out = ok(['help']);
      for (const command of ['open', 'add', 'focus', 'note', 'attach', 'link', 'rename', 'remove', 'show', 'stop', 'help']) {
        assert.match(out, new RegExp(`map\\.mjs ${command}\\b`));
      }
    });

    test('help says that notes do not link nodes and that link does', () => {
      const out = ok(['help']);
      const note = out.slice(out.indexOf('  note '), out.indexOf('  attach '));
      assert.match(note, /Notes do not render \[\[\.\.\.\]\] links between nodes\. Use link to connect two nodes\./);
      assert.match(out, /A file that is in files\/ already\s+is attached where it is, with no copy\./);
    });

    test('unknown commands and missing maps fail with a clear message', () => {
      fails(['dance'], /Unknown command "dance"/);
      const empty = tempDir();
      roots.push(empty);
      fails(['add', empty, 'X'], /No map in/);
    });

    test('commands work with no server and start none', () => {
      const dir = session();
      ok(['add', dir, 'Alpha']);
      assert.equal(existsSync(path.join(dir, '.server.json')), false);
      assert.match(ok(['stop', dir]), /No server runs/);
    });

    test('a broken map.json is refused and left as it is', () => {
      const dir = session();
      writeFileSync(path.join(dir, 'map.json'), '{ "nodes": [');
      fails(['add', dir, 'Alpha'], /map\.json is not valid JSON/);
      assert.equal(readFileSync(path.join(dir, 'map.json'), 'utf8'), '{ "nodes": [');
      writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ nodes: [{ id: 'goal', label: 'G', parent: null }, { id: 'a', label: 'A', parent: 'zzz' }] }));
      fails(['show', dir], /unknown parent "zzz"/);
      writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ nodes: [{ id: 'goal', label: 'G', parent: null }, { id: 'a', label: 'A', parent: 'goal', side: 'middle' }] }));
      fails(['show', dir], /unknown side "middle"/);
    });
  });

  describe('atomic writes', () => {
    test('parallel commands keep every change, and a reader never sees a partial file', async () => {
      const dir = session();
      const labels = Array.from({ length: 16 }, (_, i) => `Node ${i + 1}`);
      let reads = 0;
      let broken = 0;
      let done = false;
      const reader = (async () => {
        while (!done) {
          try { JSON.parse(readFileSync(path.join(dir, 'map.json'), 'utf8')); } catch { broken++; }
          reads++;
          await new Promise((resolve) => setImmediate(resolve));
        }
      })();
      const results = await Promise.all(labels.map((label) => runAsync(['add', dir, label, '--parent', 'goal'])));
      done = true;
      await reader;
      assert.deepEqual(results.filter((r) => r.code !== 0), []);
      const ids = readMap(dir).nodes.map((n) => n.id).sort();
      assert.equal(ids.length, 17);
      assert.deepEqual(new Set(results.map((r) => r.stdout)).size, 16);
      assert.ok(reads > 10, 'the reader ran during the writes');
      assert.equal(broken, 0);
      assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith('.tmp') || name.endsWith('.lock')), []);
    });
  });
});
