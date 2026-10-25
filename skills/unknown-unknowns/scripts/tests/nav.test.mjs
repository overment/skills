import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layout } from '../page/layout.mjs';
import {
  MAX_MARKS, findNodes, journeyOf, lineage, move, pathOf, plainText, recency, stepJourney, toggleMark,
} from '../page/nav.mjs';

const measure = (label, { root, state }) => label.length * (root ? 8.5 : state === 'current' ? 7.6 : 7.2);

function node(id, parent, label = id, extra = {}) {
  return { id, label, parent, state: 'suggested', note: '', attachments: [], ...extra };
}

// Right: core (stocks, delays, loops (reinforcing, balancing)), engineering (conway).
// Left: visual (iceberg, causal), debugging (metastable, coupling).
function sample() {
  return {
    nodes: [
      node('goal', null, 'Systems thinking'),
      node('core', 'goal', 'Core elements', { side: 'right' }),
      node('visual', 'goal', 'Visual tools', { side: 'left' }),
      node('engineering', 'goal', 'Engineering design', { side: 'right' }),
      node('debugging', 'goal', 'Debugging', { side: 'left' }),
      node('stocks', 'core', 'Stocks and flows', { note: 'A **stock** is what piles up. See [Meadows](https://example.com).' }),
      node('delays', 'core', 'Delays', { note: 'A delay between action and result makes people overshoot.' }),
      node('loops', 'core', 'Feedback loops'),
      node('reinforcing', 'loops', 'Reinforcing loop'),
      node('balancing', 'loops', 'Balancing loop', { note: 'It pulls a stock toward a goal.' }),
      node('conway', 'engineering', "Conway's law"),
      node('iceberg', 'visual', 'Iceberg model', { note: 'Events, patterns, structures, mental models.' }),
      node('causal', 'visual', 'Causal loop diagram'),
      node('metastable', 'debugging', 'Metastable failure'),
      node('coupling', 'debugging', 'Tight coupling', { note: 'Kopplung — a café of delays.' }),
    ],
    links: [],
    visits: [],
  };
}

const boxesOf = (map) => layout(map, measure).nodes;
const at = (boxes, id) => boxes.find((b) => b.id === id);

test('left and right go to a child and back to the parent, mirrored on the left side', () => {
  const boxes = boxesOf(sample());
  assert.equal(move(boxes, 'loops', 'right'), 'reinforcing');
  assert.equal(move(boxes, 'reinforcing', 'left'), 'loops');
  assert.equal(move(boxes, 'core', 'left'), 'goal');
  assert.equal(move(boxes, 'visual', 'left'), 'iceberg');
  assert.equal(move(boxes, 'iceberg', 'right'), 'visual');
  assert.equal(move(boxes, 'visual', 'right'), 'goal');
  assert.equal(move(boxes, 'reinforcing', 'right'), null, 'a leaf has no child');
  assert.equal(move(boxes, 'causal', 'left'), null);
  assert.equal(move(boxes, 'nope', 'left'), null);
});

test('from the goal, left goes into the left side and right into the right side, to the child nearest in height', () => {
  const boxes = boxesOf(sample());
  const goal = at(boxes, 'goal');
  const nearestOn = (side) => boxes.filter((b) => b.parent === 'goal' && b.side === side)
    .sort((a, b) => Math.abs(a.y - goal.y) - Math.abs(b.y - goal.y))[0].id;
  assert.equal(move(boxes, 'goal', 'right'), nearestOn(1));
  assert.equal(move(boxes, 'goal', 'left'), nearestOn(-1));
  assert.equal(at(boxes, move(boxes, 'goal', 'left')).side, -1);
  assert.equal(move(boxes, 'goal', 'up'), null);
  assert.equal(move(boxes, 'goal', 'down'), null);

  const loops = at(boxes, 'loops');
  const kids = ['reinforcing', 'balancing'].map((id) => at(boxes, id));
  const near = kids.sort((a, b) => Math.abs(a.y - loops.y) - Math.abs(b.y - loops.y))[0].id;
  assert.equal(move(boxes, 'loops', 'right'), near);
});

test('a child whose subtree was visited last wins over the nearest one', () => {
  const map = sample();
  const boxes = boxesOf(map);
  map.visits = [{ step: 1, id: 'goal' }, { step: 2, id: 'balancing' }, { step: 3, id: 'conway' }];
  const recent = recency(map.visits);
  assert.equal(move(boxes, 'goal', 'right', recent), 'engineering', 'step 3 is under engineering');
  assert.equal(move(boxes, 'core', 'right', recent), 'loops', 'step 2 is under loops');
  assert.equal(move(boxes, 'loops', 'right', recent), 'balancing');
  // What the user selected on the page is later than every step of the journey.
  const walked = recency(map.visits, ['stocks', 'delays']);
  assert.equal(move(boxes, 'goal', 'right', walked), 'core');
  assert.equal(move(boxes, 'core', 'right', walked), 'delays');
});

test('up and down go to the sibling, then to the nearest node in the same column', () => {
  const boxes = boxesOf(sample());
  const column = (side, depth) => boxes.filter((b) => b.side === side && b.depth === depth).sort((a, b) => a.y - b.y).map((b) => b.id);
  assert.deepEqual(column(1, 2), ['stocks', 'delays', 'loops', 'conway']);
  assert.equal(move(boxes, 'stocks', 'down'), 'delays');
  assert.equal(move(boxes, 'delays', 'up'), 'stocks');
  assert.equal(move(boxes, 'loops', 'down'), 'conway', 'the end of the group goes on in the column');
  assert.equal(move(boxes, 'conway', 'up'), 'loops');
  assert.equal(move(boxes, 'stocks', 'up'), null, 'the top of the column');
  assert.equal(move(boxes, 'conway', 'down'), null);
  assert.equal(move(boxes, 'core', 'down'), 'engineering');
  assert.equal(move(boxes, 'iceberg', 'down'), 'causal');
  assert.equal(move(boxes, 'causal', 'down'), 'metastable', 'the left side has its own columns');
});

test('every node can be reached with the arrows, and a move into a child comes back with the other arrow', () => {
  const boxes = boxesOf(sample());
  const seen = new Set(['goal']);
  const queue = ['goal'];
  while (queue.length) {
    const id = queue.shift();
    for (const key of ['left', 'right', 'up', 'down']) {
      const next = move(boxes, id, key);
      if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  assert.equal(seen.size, boxes.length);
  for (const b of boxes) {
    for (const key of ['left', 'right']) {
      const next = move(boxes, b.id, key);
      if (!next || at(boxes, next).parent !== b.id) continue;
      assert.equal(move(boxes, next, key === 'left' ? 'right' : 'left'), b.id, `${b.id} ${key}`);
    }
  }
});

test('the journey steps back and forward in visit order and stops at the ends', () => {
  const visits = [{ step: 3, id: 'delays' }, { step: 1, id: 'goal' }, { step: 2, id: 'core' }, { step: 4, id: 'core' }, { step: 5, id: 'gone' }];
  const list = journeyOf(visits, (id) => id !== 'gone');
  assert.deepEqual(list.map((v) => v.id), ['goal', 'core', 'delays', 'core']);
  assert.deepEqual(stepJourney(list, 'delays', -1, -1), { index: 1, id: 'core' });
  assert.deepEqual(stepJourney(list, 'delays', -1, 1), { index: 3, id: 'core' });
  assert.deepEqual(stepJourney(list, 'core', 1, 1), { index: 2, id: 'delays' }, 'the index tells which visit of core');
  assert.deepEqual(stepJourney(list, 'core', 7, -1), { index: 2, id: 'delays' }, 'without it, the last visit counts');
  assert.equal(stepJourney(list, 'goal', 0, -1), null);
  assert.equal(stepJourney(list, 'core', 3, 1), null);
  assert.deepEqual(stepJourney(list, 'stocks', -1, -1), { index: 3, id: 'core' }, 'off the journey, back goes to the last step');
  assert.deepEqual(stepJourney(list, null, -1, 1), { index: 0, id: 'goal' });
  assert.equal(stepJourney([], 'goal', 0, 1), null);
});

test('find matches labels first, then notes with a snippet, up to six results', () => {
  const { nodes } = sample();
  assert.deepEqual(findNodes(nodes, ''), []);
  assert.deepEqual(findNodes(nodes, '  '), []);
  const loop = findNodes(nodes, 'loop');
  assert.deepEqual(loop.map((r) => r.id), ['loops', 'reinforcing', 'balancing', 'causal'], 'word matches keep the map order');
  assert.deepEqual(findNodes(nodes, 'oop').map((r) => r.id), ['loops', 'reinforcing', 'balancing', 'causal']);
  assert.deepEqual(findNodes(nodes, 'de').map((r) => r.id), ['debugging', 'delays', 'engineering', 'iceberg', 'coupling'],
    'a label that starts with the query, a word that does, part of a word, then a note');
  assert.deepEqual(findNodes(nodes, 'debug').map((r) => r.id), ['debugging']);
  assert.ok(loop.every((r) => r.in === 'label'));
  assert.deepEqual(findNodes(nodes, 'loop bal').map((r) => r.id), ['balancing'], 'every term must match');
  assert.deepEqual(findNodes(nodes, 'feed').map((r) => r.id), ['loops'], 'a label that starts with the query');

  const delay = findNodes(nodes, 'delay');
  assert.deepEqual(delay.map((r) => [r.id, r.in]), [['delays', 'label'], ['coupling', 'note']]);
  const stock = findNodes(nodes, 'stock');
  assert.deepEqual(stock.map((r) => [r.id, r.in]), [['stocks', 'label'], ['balancing', 'note']]);
  assert.match(stock[1].snippet, /^It pulls a stock toward a goal\.$/);

  const cafe = findNodes(nodes, 'cafe');
  assert.equal(cafe[0].id, 'coupling', 'accents do not matter');
  assert.match(cafe[0].snippet, /café/, 'the snippet keeps the original text');
  assert.equal(findNodes(nodes, 'meadows')[0].snippet, 'A stock is what piles up. See Meadows.', 'no Markdown in the snippet');
  assert.equal(findNodes(nodes, 'example.com').length, 0, 'link targets do not match');
  assert.equal(findNodes(nodes, 'e').length, 6);
  assert.equal(findNodes(nodes, 'e', 3).length, 3);
});

test('a long note gives a short snippet around the match', () => {
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`);
  words[40] = 'needle';
  const [hit] = findNodes([node('a', null, 'A', { note: words.join(' ') })], 'needle');
  assert.match(hit.snippet, /^….*needle.*…$/);
  assert.ok(hit.snippet.length <= 76, hit.snippet);
  assert.equal(plainText('# Title\n\n- **bold** and `code`\n> quote [x](http://a.b)'), 'Title bold and code quote x');
});

test('the path and the branch of a node', () => {
  const boxes = boxesOf(sample());
  assert.deepEqual(pathOf(boxes, 'balancing'), ['goal', 'core', 'loops', 'balancing']);
  assert.deepEqual(pathOf(boxes, 'goal'), ['goal']);
  assert.deepEqual(pathOf(boxes, 'nope'), []);
  assert.deepEqual([...lineage(boxes, 'loops')].sort(), ['balancing', 'core', 'goal', 'loops', 'reinforcing']);
  assert.equal(lineage(boxes, 'goal').size, boxes.length, 'the branch of the goal is the whole map');
});

test('marks keep their order and stop at four', () => {
  let marks = [];
  for (const id of ['a', 'b', 'c', 'd']) ({ marks } = toggleMark(marks, id));
  assert.equal(MAX_MARKS, 4);
  assert.deepEqual(marks, ['a', 'b', 'c', 'd']);
  const full = toggleMark(marks, 'e');
  assert.equal(full.changed, false);
  assert.equal(full.marks, marks);
  ({ marks } = toggleMark(marks, 'b'));
  assert.deepEqual(marks, ['a', 'c', 'd']);
  ({ marks } = toggleMark(marks, 'b'));
  assert.deepEqual(marks, ['a', 'c', 'd', 'b']);
});
