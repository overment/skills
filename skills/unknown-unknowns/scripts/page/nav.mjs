// Keyboard navigation of the mind map: arrow moves, steps through the journey, find, marks for
// compare and the branch of a node. Pure functions over the boxes that layout() returns
// ({ id, parent, children, side, depth, y }), so the page and the tests use the same code.

export const MAX_MARKS = 4;
export const MAX_RESULTS = 6;

const indexOf = (boxes) => (boxes instanceof Map ? boxes : new Map(boxes.map((b) => [b.id, b])));

/**
 * How recent each node is: a higher number is a later visit. The journey comes first in step
 * order, then the nodes that the user selected on the page, oldest first.
 */
export function recency(visits = [], history = []) {
  const recent = new Map();
  let n = 0;
  for (const v of [...visits].sort((a, b) => a.step - b.step)) recent.set(v.id, ++n);
  for (const id of history) recent.set(id, ++n);
  return recent;
}

/**
 * The node that an arrow key goes to from the node `from`, or null when there is none.
 * key is "left", "right", "up" or "down".
 *
 * Left and right go to the parent or into the children, mirrored on the left side. From the goal,
 * left goes into the left side and right into the right side. Of the children, the one whose
 * subtree holds the latest visit wins (recent, see recency()). With no visit, the child nearest in
 * height wins.
 *
 * Up and down go to the sibling above or below. At the end of a sibling group they go to the
 * nearest node in the same column, which is the same side and depth.
 */
export function move(boxes, from, key, recent = new Map()) {
  const byId = indexOf(boxes);
  const node = byId.get(from);
  if (!node) return null;
  if (key === 'left' || key === 'right') {
    const toward = key === 'right' ? 1 : -1;
    if (node.side === 0) return pickChild(byId, node, node.children.filter((id) => byId.get(id)?.side === toward), recent);
    if (node.side === toward) return pickChild(byId, node, node.children, recent);
    return byId.has(node.parent) ? node.parent : null;
  }
  if (key === 'up' || key === 'down') {
    if (node.side === 0) return null;
    const dir = key === 'down' ? 1 : -1;
    const siblings = (byId.get(node.parent)?.children ?? []).map((id) => byId.get(id)).filter((b) => b?.side === node.side);
    const column = [...byId.values()].filter((b) => b.side === node.side && b.depth === node.depth);
    return (nearest(siblings, node, dir) ?? nearest(column, node, dir))?.id ?? null;
  }
  return null;
}

function nearest(list, node, dir) {
  let best = null;
  for (const b of list) {
    const d = (b.y - node.y) * dir;
    if (b.id !== node.id && d > 0 && (!best || d < (best.y - node.y) * dir)) best = b;
  }
  return best;
}

function pickChild(byId, parent, ids, recent) {
  const kids = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!kids.length) return null;
  let latest = null;
  let score = 0;
  for (const k of kids) {
    const s = latestIn(byId, k.id, recent);
    if (s > score) { latest = k; score = s; }
  }
  if (latest) return latest.id;
  let best = kids[0];
  for (const k of kids) if (Math.abs(k.y - parent.y) < Math.abs(best.y - parent.y)) best = k;
  return best.id;
}

function latestIn(byId, id, recent) {
  let max = recent.get(id) ?? 0;
  const stack = [...(byId.get(id)?.children ?? [])];
  while (stack.length) {
    const k = stack.pop();
    max = Math.max(max, recent.get(k) ?? 0);
    stack.push(...(byId.get(k)?.children ?? []));
  }
  return max;
}

/** The visits in step order, only of nodes that `has(id)` accepts. */
export function journeyOf(visits = [], has = () => true) {
  return [...visits].filter((v) => v && has(v.id)).sort((a, b) => a.step - b.step);
}

/**
 * One step back (delta -1) or forward (+1) through the journey from the node `at`. index is the
 * place of the last step, so a node that the journey holds twice steps on from the right visit.
 * A node off the journey steps back to the last visit or forward to the first one.
 * Returns { index, id }, or null at an end.
 */
export function stepJourney(list, at, index, delta) {
  if (!list.length) return null;
  let i = list[index]?.id === at ? index : list.map((v) => v.id).lastIndexOf(at);
  if (i === -1) i = delta < 0 ? list.length : -1;
  const next = i + delta;
  if (next < 0 || next >= list.length) return null;
  return { index: next, id: list[next].id };
}

/** The ids from the goal down to the node, both included. */
export function pathOf(boxes, id) {
  const byId = indexOf(boxes);
  const ids = [];
  for (let b = byId.get(id); b && !ids.includes(b.id); b = byId.get(b.parent)) ids.unshift(b.id);
  return ids;
}

/** The branch of a node: the path from the goal to it and everything under it. */
export function lineage(boxes, id) {
  const byId = indexOf(boxes);
  const ids = new Set(pathOf(byId, id));
  const stack = [...(byId.get(id)?.children ?? [])];
  while (stack.length) {
    const k = stack.pop();
    if (ids.has(k)) continue;
    ids.add(k);
    stack.push(...(byId.get(k)?.children ?? []));
  }
  return ids;
}

/** Mark or unmark a node. Marks keep their order. A full list does not change. */
export function toggleMark(marks, id, max = MAX_MARKS) {
  if (marks.includes(id)) return { marks: marks.filter((m) => m !== id), changed: true };
  if (marks.length >= max) return { marks, changed: false };
  return { marks: [...marks, id], changed: true };
}

// ── Find ──────────────────────────────────────────────────────────────

const fold = (text) => String(text).toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '');

/** Fold the text for matching, and keep where each folded character came from. */
function folded(text) {
  let out = '';
  const at = [];
  let i = 0;
  for (const ch of text) {
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) at.push(i);
    out += f;
    i += ch.length;
  }
  at.push(i);
  return { out, at };
}

/** A note as plain text: no link targets, no Markdown marks, one line. */
export function plainText(markdown) {
  return String(markdown ?? '')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/^ {0,3}(#{1,6}|>|[-*+]|\d{1,9}[.)])\s+/gm, '')
    .replace(/[*`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function snippet(text, start, length, room = 72) {
  if (text.length <= room) return text;
  let from = Math.max(0, Math.min(text.length - room, start - Math.round((room - length) / 3)));
  if (from > 0) {
    const space = text.indexOf(' ', from);
    if (space !== -1 && space < start) from = space + 1;
  }
  let to = Math.min(text.length, from + room);
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to);
    if (space > start + length) to = space;
  }
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

/**
 * Find nodes. A label match comes first: a label that starts with the query, then one with a word
 * that starts with each term, then one that holds each term. A note match comes after, with a
 * short snippet around the first term. Case and accents do not matter.
 * Returns up to `limit` results: { id, label, in: "label" | "note", snippet }.
 */
export function findNodes(nodes, query, limit = MAX_RESULTS) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const found = [];
  for (const [order, n] of nodes.entries()) {
    const label = fold(n.label);
    if (terms.every((t) => label.includes(t))) {
      const words = label.split(/[^\p{L}\p{N}]+/u);
      const rank = label.startsWith(terms.join(' ')) ? 0 : terms.every((t) => words.some((w) => w.startsWith(t))) ? 1 : 2;
      found.push({ id: n.id, label: n.label, in: 'label', snippet: '', rank, order });
      continue;
    }
    const text = plainText(n.note);
    const note = folded(text);
    if (!terms.every((t) => note.out.includes(t) || label.includes(t))) continue;
    const first = terms.map((t) => note.out.indexOf(t)).filter((i) => i !== -1).sort((a, b) => a - b)[0];
    const term = terms.find((t) => note.out.indexOf(t) === first);
    const start = note.at[first];
    found.push({ id: n.id, label: n.label, in: 'note', snippet: snippet(text, start, note.at[first + term.length] - start), rank: 3, order });
  }
  return found
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map(({ rank, order, ...rest }) => rest);
}
