import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GEOMETRY, anchorOut, fanPaths, layout, linkPath, pickSide, sidesOf } from '../page/layout.mjs';

const g = GEOMETRY;
const SIBLING = g.row + g.gapY;
const COUSIN = g.row + g.groupGapY;

// A fixed width per character stands in for the browser's text measure. The current node is
// drawn heavier, so its label is wider.
const measure = (label, { root, state }) => label.length * (root ? 8.5 : state === 'current' ? 7.6 : 7.2);

function node(id, parent, label = id, extra = {}) {
  return { id, label, parent, state: 'suggested', note: '', attachments: [], ...extra };
}

function sample() {
  return {
    nodes: [
      { ...node('goal', null, 'Vector databases'), state: 'visited' },
      node('embeddings', 'goal', 'Embeddings'),
      node('cosine', 'embeddings', 'Cosine similarity'),
      node('dims', 'embeddings', 'Dimensions'),
      node('index', 'goal', 'Index types'),
      node('hnsw', 'index', 'HNSW'),
      node('ivf', 'index', 'IVF'),
      node('pq', 'ivf', 'Product quantization'),
      node('recall', 'goal', 'Recall'),
      node('filters', 'goal', 'Metadata filters'),
      node('pre', 'filters', 'Pre-filtering'),
      node('post', 'filters', 'Post-filtering'),
      node('cost', 'goal', 'Cost'),
      { ...node('hybrid', 'recall', 'Hybrid search'), state: 'current' },
      node('bm25', 'hybrid', 'BM25'),
    ],
    links: [['bm25', 'pq'], ['cosine', 'hybrid']],
    visits: [],
  };
}

/** A random number source from a seed (mulberry32), so every run sees the same maps. */
function randomFrom(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['Raft', 'quorum', 'Merkle', 'trees', 'consistent', 'hashing', 'CAP', 'leader', 'leases', 'vector', 'clocks', 'gossip', 'Bloom', 'filters', 'LSM', 'compaction', 'hinted', 'handoff', 'two-phase', 'commit', 'sharding', 'B-trees'];

/**
 * A random map from a seed: unbalanced, up to 4 levels deep, labels of 1 to 3 words, a side for
 * each first-level node as `add` stores it. Each new node goes through add(map, node).
 */
function generated(seed, count = 40, linkCount = 10, add = (map, n) => map.nodes.push(n)) {
  const random = randomFrom(seed);
  const map = { nodes: [node('goal', null, 'Distributed databases')], links: [], visits: [] };
  const depth = new Map([['goal', 0]]);
  for (let i = 1; i < count; i++) {
    const open = map.nodes.filter((n) => depth.get(n.id) < 4);
    const parent = open[Math.floor(random() ** 2 * open.length)]; // early nodes get more children
    const label = Array.from({ length: 1 + Math.floor(random() * 3) }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' ');
    const n = node(`n${i}`, parent.id, label.slice(0, 28));
    if (parent.id === 'goal') n.side = pickSide(map);
    add(map, n);
    depth.set(n.id, depth.get(parent.id) + 1);
  }
  map.nodes[Math.floor(random() * count)].state = 'current';
  while (map.links.length < linkCount) {
    const a = map.nodes[Math.floor(random() * count)].id;
    const b = map.nodes[Math.floor(random() * count)].id;
    if (a !== b) map.links.push([a, b]);
  }
  return map;
}

const byId = (result) => new Map(result.nodes.map((b) => [b.id, b]));
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.02, `${what}: ${a} is not ${b}`);

/** The edge paths of every parent, as layout's callers draw them. */
function edgePaths(result) {
  const boxes = byId(result);
  const out = [];
  for (const parent of result.nodes) {
    const kids = parent.children.map((id) => boxes.get(id));
    fanPaths(parent, kids).forEach((d, i) => out.push({ from: parent.id, to: kids[i].id, d }));
  }
  return out;
}

/** Points along a path of absolute M, H, V, Q and C commands. */
function points(d) {
  const out = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MHVQC])([^MHVQC]*)/g)) {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const curve = (ctrl, end) => {
      for (let t = 0; t <= 1; t += 0.01) {
        const u = 1 - t;
        const pts = [[x, y], ...ctrl, end];
        const w = pts.length === 3 ? [u * u, 2 * u * t, t * t] : [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
        out.push([pts.reduce((s, p, i) => s + p[0] * w[i], 0), pts.reduce((s, p, i) => s + p[1] * w[i], 0)]);
      }
      [x, y] = end;
    };
    const line = (x2, y2) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x, y2 - y)));
      for (let i = 0; i <= steps; i++) out.push([x + ((x2 - x) * i) / steps, y + ((y2 - y) * i) / steps]);
      [x, y] = [x2, y2];
    };
    if (cmd === 'M') { [x, y] = n; out.push([x, y]); }
    if (cmd === 'H') line(n[0], y);
    if (cmd === 'V') line(x, n[0]);
    if (cmd === 'Q') curve([[n[0], n[1]]], [n[2], n[3]]);
    if (cmd === 'C') curve([[n[0], n[1]], [n[2], n[3]]], [n[4], n[5]]);
  }
  return out;
}

/** The area of a node: its dot and its label, one row high. */
const rect = (b) => {
  const dot = b.side === 0 ? g.rootDot : g.dot;
  return {
    left: Math.min(b.x - dot, b.x + b.labelX),
    right: Math.max(b.x + dot, b.x + b.labelX + b.width),
    top: b.y - g.row / 2,
    bottom: b.y + g.row / 2,
  };
};

/** Every rule that keeps a map clean, checked on one layout. */
function assertClean(result, name) {
  const rects = result.nodes.map((b) => [b.id, rect(b)]);
  for (const [i, [ida, a]] of rects.entries()) {
    for (const [idb, b] of rects.slice(i + 1)) {
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      assert.ok(!overlap, `${name}: ${ida} and ${idb} overlap`);
    }
  }
  const sampled = edgePaths(result).map((e) => ({ ...e, pts: points(e.d) }));
  for (const e of sampled) {
    for (const [x, y] of e.pts) {
      for (const [id, r] of rects) {
        if (id === e.to) continue; // the edge ends at this dot
        assert.ok(!(x > r.left && x < r.right && y > r.top && y < r.bottom), `${name}: the edge to ${e.to} crosses ${id} at ${x}, ${y}`);
      }
    }
  }
  // Edges of different parents never come within 2 px of each other.
  const cells = new Map();
  for (const [i, e] of sampled.entries()) {
    for (const [x, y] of e.pts) {
      const key = `${Math.round(x / 2)} ${Math.round(y / 2)}`;
      if (!cells.has(key)) cells.set(key, new Set());
      cells.get(key).add(i);
    }
  }
  for (const set of cells.values()) {
    const parents = new Set([...set].map((i) => sampled[i].from));
    assert.ok(parents.size <= 1, `${name}: edges of ${[...parents].join(' and ')} meet`);
  }
}

test('the same map always gives the same layout', () => {
  const first = layout(sample(), measure);
  const second = layout(JSON.parse(JSON.stringify(sample())), measure);
  assert.deepEqual(first, second);
  const shuffledKeys = sample();
  shuffledKeys.nodes = shuffledKeys.nodes.map((n) => Object.fromEntries(Object.entries(n).reverse()));
  assert.deepEqual(layout(shuffledKeys, measure), first);
  assert.deepEqual(edgePaths(first), edgePaths(second));
  assert.equal(first.nodes.length, 15);
  assert.equal(first.edges.length, 14);
  assert.deepEqual(first.links, [{ a: 'bm25', b: 'pq' }, { a: 'cosine', b: 'hybrid' }]);
});

test('the goal is centred on x = 0 and sits at the middle of the first-level nodes', () => {
  const result = layout(sample(), measure);
  const boxes = byId(result);
  const goal = boxes.get('goal');
  assert.equal(goal.side, 0);
  near(goal.x - g.rootDot + (g.rootDot + g.rootLabelGap + goal.width) / 2, 0, 'the middle of the goal');
  const firsts = goal.children.map((id) => boxes.get(id).y);
  near(goal.y, (Math.min(...firsts) + Math.max(...firsts)) / 2, 'the goal y');
  assert.deepEqual([...new Set(goal.children.map((id) => boxes.get(id).side))].sort(), [-1, 1]);
});

test('every node knows its parent and its children, from top to bottom', () => {
  const boxes = byId(layout(sample(), measure));
  assert.deepEqual(boxes.get('index').children, ['hnsw', 'ivf']);
  assert.equal(boxes.get('ivf').parent, 'index');
  for (const box of boxes.values()) {
    const ys = box.children.map((id) => boxes.get(id).y);
    if (box.side !== 0) assert.deepEqual(ys, [...ys].sort((a, b) => a - b), `the children of ${box.id} go down`);
    for (const id of box.children) {
      assert.equal(boxes.get(id).parent, box.id);
      if (box.side !== 0) assert.equal(boxes.get(id).side, box.side, `${id} is on the side of ${box.id}`);
      assert.ok(boxes.get(id).x * boxes.get(id).side > box.x * boxes.get(id).side, `${id} is further out than ${box.id}`);
    }
  }
});

test('the nodes of one depth on one side stand in one column, after the widest label before it', () => {
  for (const map of [sample(), generated(7), generated(21)]) {
    const result = layout(map, measure);
    const goal = result.nodes.find((b) => b.side === 0);
    const columns = new Map();
    for (const b of result.nodes.filter((n) => n.side !== 0)) {
      const key = `${b.side} ${b.depth}`;
      if (!columns.has(key)) columns.set(key, { x: b.x, widest: 0 });
      const column = columns.get(key);
      assert.equal(b.x, column.x, `${b.id} is in the column of depth ${b.depth}`);
      const label = map.nodes.find((n) => n.id === b.id).label;
      column.widest = Math.max(column.widest, measure(label, { state: 'current' })); // the widest weight
    }
    for (const side of [1, -1]) {
      if (columns.has(`${side} 1`)) near(columns.get(`${side} 1`).x, anchorOut(goal, side) + side * g.rootGapX, 'the first column');
      for (let depth = 2; columns.has(`${side} ${depth}`); depth++) {
        const before = columns.get(`${side} ${depth - 1}`);
        near(side * (columns.get(`${side} ${depth}`).x - before.x), g.labelGap + before.widest + g.outPad + g.gapX, `column ${depth}`);
      }
    }
  }
});

test('a focus change moves no node', () => {
  const map = sample();
  const before = layout(map, measure);
  map.nodes.find((n) => n.id === 'hybrid').state = 'visited';
  map.nodes.find((n) => n.id === 'filters').state = 'current'; // the widest label of its column
  const after = byId(layout(map, measure));
  for (const b of before.nodes) {
    assert.deepEqual([after.get(b.id).x, after.get(b.id).y], [b.x, b.y], `${b.id} stays`);
  }
});

test('a new branch goes to the shorter side, and a stored side stays', () => {
  const map = { nodes: [node('goal', null)] };
  assert.equal(pickSide(map), 'right', 'a tie goes to the right');
  map.nodes.push(node('a', 'goal', 'a', { side: 'right' }));
  assert.equal(pickSide(map), 'left');
  map.nodes.push(node('b', 'goal', 'b', { side: 'left' }), ...[1, 2, 3].map((i) => node(`b${i}`, 'b')));
  assert.equal(pickSide(map), 'right', 'the left side is taller now');
  // A stored side wins over the shorter side.
  map.nodes.push(node('c', 'goal', 'c', { side: 'left' }));
  assert.equal(sidesOf(map).get('c'), -1);
  assert.equal(byId(layout(map, measure)).get('c').side, -1);
  // A map from before sides were stored gets the shorter side for each branch, in order.
  const old = { nodes: [node('goal', null), node('x', 'goal'), ...[1, 2, 3].map((i) => node(`x${i}`, 'x')), node('y', 'goal'), node('z', 'goal')] };
  assert.deepEqual([...sidesOf(old)], [['x', 1], ['y', -1], ['z', -1]]);
});

test('both sides start at y = 0 and read from top to bottom in the order of creation', () => {
  const map = { nodes: [node('goal', null), ...['a', 'b', 'c', 'd'].map((id, i) => node(id, 'goal', id, { side: i % 2 ? 'left' : 'right' }))] };
  const boxes = byId(layout(map, measure));
  assert.deepEqual(['a', 'c'].map((id) => boxes.get(id).y), [0, SIBLING]);
  assert.deepEqual(['b', 'd'].map((id) => boxes.get(id).y), [0, SIBLING]);
});

test('siblings keep one gap, cousins a larger one, and a parent sits centred on its children', () => {
  const kids = (parent, n) => Array.from({ length: n }, (_, i) => node(`${parent}${i + 1}`, parent));
  const map = { nodes: [node('goal', null), node('p', 'goal'), node('a', 'p'), ...kids('a', 3), node('b', 'p'), ...kids('b', 2), node('leaf', 'p')] };
  const boxes = byId(layout(map, measure));
  const y = (id) => boxes.get(id).y;
  assert.deepEqual([y('a2') - y('a1'), y('a3') - y('a2'), y('b2') - y('b1')], [SIBLING, SIBLING, SIBLING]);
  assert.equal(y('b1') - y('a3'), COUSIN, 'children of different parents');
  for (const id of ['a', 'b', 'p']) {
    const children = boxes.get(id).children.map(y);
    near(y(id), (children[0] + children[children.length - 1]) / 2, `${id} is centred`);
  }
  // A parent owns the rows of its children in its own column, so the next sibling comes after them.
  assert.equal(y('b') - y('a3') >= SIBLING, true);
  assert.equal(y('leaf') - y('b2'), SIBLING);
});

test('subtrees pack tightly: a node moves up beside the deeper rows of the subtree above it', () => {
  const map = { nodes: [node('goal', null), node('p', 'goal'), node('a', 'p'), node('a1', 'a'), ...[1, 2, 3, 4, 5].map((i) => node(`k${i}`, 'a1')), node('leaf', 'p')] };
  const boxes = byId(layout(map, measure));
  // a has one child, so its own rows end at a1. The leaf comes one row below that, beside k4.
  assert.equal(boxes.get('leaf').y - boxes.get('a').y, SIBLING);
  assert.equal(boxes.get('leaf').y, boxes.get('k4').y);
});

test('every edge leaves its parent at the same gap, splits at the fork and ends at the dot of the child', () => {
  const result = layout(sample(), measure);
  const boxes = byId(result);
  for (const e of edgePaths(result)) {
    const parent = boxes.get(e.from);
    const child = boxes.get(e.to);
    const [x, y] = e.d.match(/^M([-\d.]+) ([-\d.]+)/).slice(1).map(Number);
    assert.equal(y, parent.y);
    const end = parent.side === 0
      ? (child.side > 0 ? parent.x + parent.labelX + parent.width : parent.x - g.rootDot)
      : (parent.side > 0 ? parent.x + parent.labelX + parent.width : parent.x + parent.labelX);
    near(Math.abs(x - end), g.outPad, `the edge to ${e.to} leaves ${e.from} at the gap`);
    assert.ok(e.d.endsWith(`${child.y}H${child.x}`), `the edge to ${e.to} runs straight into its dot`);
    const fork = e.d.match(/Q([-\d.]+) /)?.[1];
    if (fork) near(Math.abs(Number(fork) - x), g.stem, `the fork of ${e.from}`);
  }
  const goal = boxes.get('goal');
  near(anchorOut(goal, 1) + anchorOut(goal, -1), 0, 'the goal is symmetric');
});

test('a large fan is no broom: its edges share one stem and one fork, then split apart', () => {
  const map = { nodes: [node('goal', null), node('p', 'goal'), ...Array.from({ length: 8 }, (_, i) => node(`k${i}`, 'p'))] };
  const result = layout(map, measure);
  const boxes = byId(result);
  const parent = boxes.get('p');
  const paths = fanPaths(parent, parent.children.map((id) => boxes.get(id)));
  const fork = anchorOut(parent, 1) + g.stem;
  const stem = paths.map((d) => d.match(/^M[-\d.]+ [-\d.]+H/)[0]);
  assert.equal(new Set(stem).size, 1, 'one stem');
  assert.equal(new Set(paths.map((d) => d.match(/Q([-\d.]+) /)[1])).size, 1, 'one fork');
  // Past the corner at the fork, every edge runs alone.
  const beyond = paths.map((d) => points(d).filter(([x]) => x > fork + g.radius + 0.5));
  for (const [i, a] of beyond.entries()) {
    for (const b of beyond.slice(i + 1)) {
      const closest = Math.min(...a.map(([x, y]) => Math.min(...b.map(([u, v]) => Math.hypot(x - u, y - v)))));
      assert.ok(closest >= SIBLING - 1, `two edges come ${closest} px close`);
    }
  }
});

test('no labels overlap, no edge crosses a label, and edges of different parents never meet', () => {
  assertClean(layout(sample(), measure), 'sample');
  for (let seed = 1; seed <= 40; seed++) assertClean(layout(generated(seed), measure), `seed ${seed}`);
});

test('a new node moves only its ancestors and the nodes below it on its own side', () => {
  const same = () => 60; // one label width, so the columns stay and only rows can move
  for (let seed = 1; seed <= 25; seed++) {
    let before = null;
    generated(seed, 45, 0, (map, n) => {
      map.nodes.push(n);
      const now = byId(layout(map, same));
      if (before) {
        const parents = new Map(map.nodes.map((m) => [m.id, m.parent]));
        const ancestors = new Set();
        for (let id = n.id; id; id = parents.get(id)) ancestors.add(id);
        const order = [];
        const walk = (id) => { order.push(id); for (const m of map.nodes) if (m.parent === id) walk(m.id); };
        walk('goal');
        for (const [id, was] of before) {
          if (ancestors.has(id)) continue;
          const is = now.get(id);
          const unrelated = is.side !== now.get(n.id).side || order.indexOf(id) < order.indexOf(n.id);
          if (unrelated) assert.deepEqual([is.x, is.y], [was.x, was.y], `seed ${seed}: adding ${n.id} moved ${id}`);
        }
      }
      before = now;
    });
  }
});

test('labels are measured with the state of their node', () => {
  const seen = [];
  layout(sample(), (label, options) => { seen.push([label, options.state]); return label.length * 7; });
  assert.ok(seen.some(([label, state]) => label === 'Hybrid search' && state === 'current'));
  assert.ok(seen.some(([label, state]) => label === 'Cost' && state === 'suggested'));
});

test('cross links are shallow arcs between two dots', () => {
  const boxes = byId(layout(sample(), measure));
  assert.match(linkPath(boxes.get('bm25'), boxes.get('pq')), /^M[-\d.]+ [-\d.]+Q[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/);
});

test('an empty or rootless map gives an empty layout', () => {
  assert.deepEqual(layout({ nodes: [] }, measure).nodes, []);
  assert.equal(layout({ nodes: [node('goal', null)] }, measure).nodes.length, 1);
  assert.deepEqual(fanPaths(layout({ nodes: [node('goal', null)] }, measure).nodes[0], []), []);
});
