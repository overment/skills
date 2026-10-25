// Layout of the mind map: a two-sided tree. Pure and deterministic, so the page, the CLI and the
// tests use the same code. Units are CSS pixels at zoom 1.
//
// Sides. Every first-level branch has a side, "right" or "left", stored in map.json. A new branch
// goes to the shorter side and keeps it. A branch with no stored side (an older map) gets the side
// that the same rule gives, in the order the branches were made.
//
// Columns. On one side, all nodes of one depth share one x. A column starts after the widest label
// of the column before it. Labels are measured at their widest weight for this, so a focus change
// moves nothing.
//
// Rows. Each side is a tidy tree, packed in one sweep from top to bottom in the order the nodes
// were made (Reingold–Tilford contours, kept per column). Each column keeps the lowest row it uses.
// A subtree starts at the first free row of its own column and goes down from there; each node in
// it moves up as far as the rows used in its column allow, and a parent sits centred on its
// children. In its own column a parent owns the rows from its first to its last child, so no
// label sits beside the edges of another node. Both sides start at y = 0. A new node is placed
// after every node above it, so it moves only its ancestors and the nodes below it on its side.
// The goal sits at the middle of the first-level nodes.
//
// Edges. An edge leaves its parent at a fixed gap past the label, runs a short stem to the fork,
// turns along the fork with rounded corners and runs straight into the child's dot. The fork stands
// in rows that the parent owns, so edges cross no label and no other edge.

export const GEOMETRY = Object.freeze({
  dot: 3.75, // radius of a node dot
  rootDot: 4.5,
  labelGap: 12, // dot centre to the start of the label
  rootLabelGap: 13,
  outPad: 7, // end of a node to the start of its edges, on both sides of the goal too
  stem: 14, // start of the edges to the fork, where they split
  radius: 8, // the corners of an edge
  gapX: 44, // end of the widest label in a column to the dots of the next column
  rootGapX: 60, // the goal's edges to the dots of the first column, on each side
  row: 22, // height of one node
  gapY: 6, // between siblings
  groupGapY: 16, // between two nodes of one column that have different parents
});

const SIDES = { right: 1, left: -1 };
const round = (n) => Math.round(n * 100) / 100;

/**
 * map: { nodes: [{ id, label, parent, state, side? }], links } in creation order.
 * measure(label, { root, state }) returns the width of the label in pixels.
 * Returns {
 *   nodes: [{ id, parent, children, side, depth, x, y, labelX, width }],
 *   edges: [{ from, to }], links: [{ a, b }], bounds: { x, y, width, height },
 * }
 * x and y are the dot centre. side is 0 for the goal, 1 right, -1 left. children are ids in the
 * order of creation, which is from top to bottom on each side. Draw the edges of a parent with
 * fanPaths(parent, its children).
 */
export function layout(map, measure, g = GEOMETRY) {
  const tree = treeOf(map);
  const { root } = tree;
  if (!root) return { nodes: [], edges: [], links: [], bounds: { x: 0, y: 0, width: 0, height: 0 } };
  const sides = assignSides(tree, g);
  const branches = tree.branches;

  const placed = new Map(); // id → { node, kids, side, depth, y }
  for (const side of [1, -1]) {
    const rows = placeSide(tree, branches.filter((b) => sides.get(b.id) === side), g);
    for (const [id, row] of rows.nodes) placed.set(id, { ...row, side });
  }
  const firsts = branches.map((b) => placed.get(b.id).y);
  const rootY = firsts.length ? (Math.min(...firsts) + Math.max(...firsts)) / 2 : 0;

  // Columns: the widest label of each column, at the weight of the current node.
  const measured = new Map();
  const widthOf = (n, state = n.state) => {
    const key = `${n.id}\u0000${state}`;
    if (!measured.has(key)) measured.set(key, Math.max(0, Number(measure(n.label, { root: n === root, state })) || 0));
    return measured.get(key);
  };
  const widest = new Map();
  for (const { node, side, depth } of placed.values()) {
    const key = `${side} ${depth}`;
    widest.set(key, Math.max(widest.get(key) ?? 0, widthOf(node, 'current')));
  }

  // The goal: dot and label centred on x = 0 as one unit.
  const rootWidth = widthOf(root);
  const rootBox = {
    id: root.id, parent: null, children: branches.map((b) => b.id), side: 0, depth: 0,
    x: -(g.rootLabelGap + rootWidth - g.rootDot) / 2, y: rootY, labelX: g.rootLabelGap, width: rootWidth,
  };
  const columns = new Map();
  for (const side of [1, -1]) {
    let x = anchorOut(rootBox, side, g) + side * g.rootGapX;
    for (let depth = 1; widest.has(`${side} ${depth}`); depth++) {
      columns.set(`${side} ${depth}`, x);
      x += side * (g.labelGap + widest.get(`${side} ${depth}`) + g.outPad + g.gapX);
    }
  }

  const boxes = new Map([[root.id, rootBox]]);
  for (const { node, side, depth, y } of placed.values()) {
    const width = widthOf(node);
    boxes.set(node.id, {
      id: node.id, parent: node.parent, children: placed.get(node.id).kids.map((k) => k.id), side, depth,
      x: columns.get(`${side} ${depth}`), y, labelX: side > 0 ? g.labelGap : -g.labelGap - width, width,
    });
  }
  for (const box of boxes.values()) {
    for (const key of ['x', 'y', 'labelX', 'width']) box[key] = round(box[key]);
  }

  const out = tree.nodes.filter((n) => boxes.has(n.id)).map((n) => boxes.get(n.id));
  const edges = out.filter((b) => b.parent !== null).map((b) => ({ from: b.parent, to: b.id }));
  const links = (map.links ?? [])
    .filter((l) => Array.isArray(l) && boxes.has(l[0]) && boxes.has(l[1]))
    .map(([a, b]) => ({ a, b }));
  return { nodes: out, edges, links, bounds: boundsOf(out, g) };
}

/** The side of each first-level branch, 1 right or -1 left: the stored side, or the shorter side. */
export function sidesOf(map, g = GEOMETRY) {
  const tree = treeOf(map);
  return tree.root ? assignSides(tree, g) : new Map();
}

/** The side for a new first-level branch: "right" or "left", whichever is shorter now. */
export function pickSide(map, g = GEOMETRY) {
  const tree = treeOf(map);
  if (!tree.root) return 'right';
  const sides = assignSides(tree, g);
  const on = (side) => tree.branches.filter((b) => sides.get(b.id) === side);
  return shorter(tree, on(1), on(-1), g) > 0 ? 'right' : 'left';
}

/** The nodes, the goal, the children of each node in creation order, and the first-level branches. */
function treeOf(map) {
  const nodes = (map.nodes ?? []).filter((n) => n && typeof n.id === 'string');
  const root = nodes.find((n) => n.id === 'goal') ?? nodes.find((n) => n.parent == null);
  const children = new Map(nodes.map((n) => [n.id, []]));
  for (const n of nodes) if (n !== root && children.has(n.parent)) children.get(n.parent).push(n);
  return { nodes, root, children, branches: root ? children.get(root.id) : [] };
}

function assignSides(tree, g) {
  const sides = new Map();
  const lists = { 1: [], [-1]: [] };
  for (const b of tree.branches) {
    const side = SIDES[b.side] ?? shorter(tree, lists[1], lists[-1], g);
    sides.set(b.id, side);
    lists[side].push(b);
  }
  return sides;
}

/** 1 when the right side is not taller than the left one, else -1. */
function shorter(tree, right, left, g) {
  return placeSide(tree, right, g).height <= placeSide(tree, left, g).height ? 1 : -1;
}

/**
 * The rows of one side. Walks the branches from top to bottom, each subtree before the next one.
 * floor[d] is the lowest row that column d uses so far, and owner[d] the parent of the node there.
 * A node goes one row and one gap below the floor of its column, a larger gap when the node above
 * has another parent, and never above the top of its parent's subtree. A parent goes to the middle
 * of its children and then uses the rows down to its last child.
 * Returns { nodes: Map id → { node, kids, depth, y }, height }.
 */
function placeSide(tree, branches, g) {
  const floor = [];
  const owner = [];
  const nodes = new Map();
  const place = (n, depth, parent, minTop) => {
    const gap = owner[depth] === parent ? g.gapY : g.groupGapY;
    const top = Math.max(minTop, floor[depth] === undefined ? minTop : floor[depth] + g.row + gap);
    nodes.set(n.id, null); // a cycle in bad data stops here
    const kids = tree.children.get(n.id).filter((k) => !nodes.has(k.id));
    const ys = kids.map((k) => place(k, depth + 1, n.id, top));
    const y = kids.length ? (ys[0] + ys[ys.length - 1]) / 2 : top;
    nodes.set(n.id, { node: n, kids, depth, y });
    floor[depth] = kids.length ? ys[ys.length - 1] : y;
    owner[depth] = parent;
    return y;
  };
  for (const b of branches) place(b, 1, tree.root.id, 0);
  return { nodes, height: floor.length ? Math.max(...floor.filter((f) => f !== undefined)) + g.row : 0 };
}

function boundsOf(boxes, g) {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    const dot = b.side === 0 ? g.rootDot : g.dot;
    minX = Math.min(minX, b.x - dot, b.x + b.labelX);
    maxX = Math.max(maxX, b.x + dot, b.x + b.labelX + b.width);
    minY = Math.min(minY, b.y - g.row / 2);
    maxY = Math.max(maxY, b.y + g.row / 2);
  }
  return { x: round(minX), y: round(minY), width: round(maxX - minX), height: round(maxY - minY) };
}

/** Where the edges that leave a node toward one side start: a fixed gap past the node's end. */
export function anchorOut(box, toward, g = GEOMETRY) {
  if (box.side === 0) return toward > 0 ? box.x + box.labelX + box.width + g.outPad : box.x - g.rootDot - g.outPad;
  return box.side > 0 ? box.x + box.labelX + box.width + g.outPad : box.x + box.labelX - g.outPad;
}

/**
 * The edges from a parent to its children, one path for each child, in the order of kids. All of
 * them share the stem and the fork. A child in the parent's row gets a straight line. The corner
 * at the stem is the same for every child on one side and in one direction, so the paths lie
 * exactly on top of each other where they share the way, and can be drawn as one path.
 */
export function fanPaths(parent, kids, g = GEOMETRY) {
  const nearest = new Map(); // "side direction" → the least distance to a child in that direction
  for (const k of kids) {
    const dy = k.y - parent.y;
    if (Math.abs(dy) < 0.5) continue;
    const key = `${k.side} ${Math.sign(dy)}`;
    nearest.set(key, Math.min(nearest.get(key) ?? Infinity, Math.abs(dy)));
  }
  return kids.map((k) => {
    const s = k.side < 0 ? -1 : 1;
    const x0 = round(anchorOut(parent, s, g));
    const y0 = round(parent.y);
    const dy = k.y - parent.y;
    if (Math.abs(dy) < 0.5) return `M${x0} ${y0}H${round(k.x)}`;
    const dir = Math.sign(dy);
    const fork = x0 + s * g.stem;
    const r1 = Math.min(g.radius, nearest.get(`${k.side} ${dir}`) / 2);
    const r2 = Math.min(g.radius, Math.abs(dy) - r1);
    return `M${x0} ${y0}H${round(fork - s * r1)}Q${round(fork)} ${y0} ${round(fork)} ${round(y0 + dir * r1)}`
      + `V${round(k.y - dir * r2)}Q${round(fork)} ${round(k.y)} ${round(fork + s * r2)} ${round(k.y)}H${round(k.x)}`;
  });
}

/** A cross link: a shallow arc between two dots that bends up, or away from the centre. */
export function linkPath(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  if (ny > 0 || (ny === 0 && nx * (a.x + b.x) < 0)) { nx = -nx; ny = -ny; }
  const bend = Math.min(80, length * 0.18);
  const cx = (a.x + b.x) / 2 + nx * bend;
  const cy = (a.y + b.y) / 2 + ny * bend;
  return `M${round(a.x)} ${round(a.y)}Q${round(cx)} ${round(cy)} ${round(b.x)} ${round(b.y)}`;
}
