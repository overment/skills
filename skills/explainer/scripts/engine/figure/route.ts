import type { FigureBlock, GroupSpec, NodeSpec, Theme } from "../types.ts";
import { cellRect, figureSize, groupRect, inflate, overlaps, segmentBox, type Rect } from "./grid.ts";

export type Point = [number, number];
export interface RoutedEdge { id: string; points: Point[]; warn?: string }

type Side = "left" | "right" | "top" | "bottom";
type Axis = "col" | "row";
interface End { edge: string; node: string; side: Side; toward: Point; key: "src" | "tgt" }
interface Plan { channels: string[]; outer: boolean; build(pos: (channel: string) => number): Point[] }
type Gutters = Record<Axis, number[]>;
interface Border { at: number; lo: number; hi: number }

const LANE = 12;
const CLEAR = 4;
const MIN_SPREAD = 12;
const ALIGN_INSET = 8;
/** Outer channels run this far outside the node edge, beyond any zone border. */
const OUTER = 28;
/** A lane closer than this to a zone border moves off it. */
const BORDER_CLEAR = 6;
/** Route cost: a bend costs this much length, a crossing much more, the outer ring more still. */
const BEND_COST = 24;
const CROSS_COST = 160;
/** A route through a zone neither of its ends sits in reads as if it belonged there: dearer than a crossing. */
const ZONE_COST = 240;
const OUTER_COST = OUTER * 2;
const VERTICAL_FIRST: readonly string[] = ["tree", "layers", "states"];

const round1 = (v: number) => Math.round(v * 10) / 10;
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Orthogonal routes through the gutters. `boxes` overrides a node's drawn rect (a table shorter than its grid span):
 * connectors attach to the drawn rect, but routes still keep out of the whole reserved span.
 */
export function routeEdges(fig: FigureBlock, theme: Theme, boxes?: Map<string, Rect>): RoutedEdge[] {
  const { pad, cell: [cw, ch], gap: [gx, gy] } = theme.grid;
  const [cols, rows] = fig.grid;
  const size = figureSize(fig.grid, theme);
  const gutter: Gutters = { col: gutters(cols, cw, gx, pad, size.w), row: gutters(rows, ch, gy, pad, size.h) };
  const nodes = new Map(fig.nodes.map((n) => [n.id, n]));
  const reserved = new Map(fig.nodes.map((n) => [n.id, cellRect(n.at, n.span, theme)]));
  const rects = new Map(fig.nodes.map((n) => [n.id, boxes?.get(n.id) ?? reserved.get(n.id)!]));
  const diamond = new Set(fig.nodes.filter((n) => n.kind === "decision").map((n) => n.id));
  const center = (id: string): Point => {
    const r = rects.get(id)!;
    return [r.x + r.w / 2, r.y + r.h / 2];
  };
  const warns = new Map<string, string[]>();
  const warn = (id: string, message: string) => {
    const list = warns.get(id);
    if (!list) warns.set(id, [message]);
    else if (!list.includes(message)) list.push(message);
  };
  const channelCenter = (key: string) => {
    const [axis, g] = key.split(":");
    return gutter[axis as Axis][Number(g)];
  };

  // Trees hang children off one bus per parent: a drop, a shared horizontal run and one drop per child.
  const bus = fig.layout === "tree" ? treeBuses(fig, nodes, rects, reserved, gutter) : new Map<string, Point[]>();

  const sides = new Map<string, [Side, Side]>();
  // Hierarchies and state machines leave a node downward when the target sits in a lower row.
  const verticalFirst = VERTICAL_FIRST.includes(fig.layout);
  for (const e of fig.edges) {
    if (e.from === e.to || bus.has(e.id)) continue;
    const s = rects.get(e.from)!, t = rects.get(e.to)!;
    sides.set(e.id, diamond.has(e.from) || diamond.has(e.to) ? diamondFacing(s, t) : facing(s, t, verticalFirst));
  }
  // A connector from another row that would enter a side another connector already leaves by runs back to back
  // with it, and neither direction reads. It enters through the face toward its source row instead, when that face
  // is free and the L-shaped route there is clear.
  const horiz = (side: Side) => side === "left" || side === "right";
  for (const e of fig.edges) {
    const s = sides.get(e.id);
    if (!s || diamond.has(e.to) || diamond.has(e.from) || !horiz(s[0])) continue;
    const src = rects.get(e.from)!, tgt = rects.get(e.to)!;
    const below = src.y >= tgt.y + tgt.h, above = src.y + src.h <= tgt.y;
    if (!below && !above) continue;
    const uses = (o: typeof e, end: 0 | 1, node: string, side: Side) => o.id !== e.id && (end === 0 ? o.from : o.to) === node && sides.get(o.id)?.[end] === side;
    if (!fig.edges.some((o) => uses(o, 0, e.to, s[1]))) continue;
    const face: Side = below ? "bottom" : "top";
    if (fig.edges.some((o) => uses(o, 0, e.to, face) || uses(o, 1, e.to, face))) continue;
    const p0: Point = [s[0] === "left" ? src.x : src.x + src.w, src.y + src.h / 2];
    const p3: Point = [tgt.x + tgt.w / 2, below ? tgt.y + tgt.h : tgt.y];
    if (isClear([p0, [p3[0], p0[1]], p3], reserved, [e.from, e.to])) sides.set(e.id, [s[0], face]);
  }

  const sideEnds = new Map<string, End[]>();
  for (const e of fig.edges) {
    const s = sides.get(e.id);
    if (!s) continue;
    for (const end of [
      { edge: e.id, node: e.from, side: s[0], toward: center(e.to), key: "src" as const },
      { edge: e.id, node: e.to, side: s[1], toward: center(e.from), key: "tgt" as const },
    ]) {
      const k = `${end.node}|${end.side}`;
      sideEnds.set(k, [...(sideEnds.get(k) ?? []), end]);
    }
  }

  // Attach points: every connector sharing a side gets its own slot, ordered by where it heads (`lean`), then by
  // where its other end lies. A decision is a diamond: its connectors all leave from the vertex on that side.
  const attachAll = (lean: Map<string, number>): Map<string, Point> => {
    const attach = new Map<string, Point>();
    const alone = new Set<string>();
    for (const ends of sideEnds.values()) {
      const { node, side } = ends[0];
      const r = rects.get(node)!;
      const along = side === "left" || side === "right" ? 1 : 0;
      const key = (end: End) => lean.get(`${end.edge}|${end.key}`) ?? end.toward[along];
      ends.sort((a, b) => key(a) - key(b) || a.toward[along] - b.toward[along] || byId(a.edge, b.edge));
      const step = (along === 1 ? r.h : r.w) / (ends.length + 1);
      if (!diamond.has(node) && ends.length > 1 && step < MIN_SPREAD) {
        for (const end of ends) warn(end.edge, `${ends.length} connectors share the ${side} side of "${node}" and sit closer than ${MIN_SPREAD}px; move a node so they use different sides.`);
      }
      ends.forEach((end, k) => {
        const t = diamond.has(node) ? (along === 1 ? r.h : r.w) / 2 : round1(step * (k + 1));
        const p: Point =
          side === "left" ? [r.x, r.y + t] :
          side === "right" ? [r.x + r.w, r.y + t] :
          side === "top" ? [r.x + t, r.y] : [r.x + t, r.y + r.h];
        attach.set(`${end.edge}|${end.key}`, p);
        if (ends.length === 1) alone.add(`${end.edge}|${end.key}`);
      });
    }

    // Facing ends align so the connector runs straight, as long as the moved end keeps its spacing on that side.
    // A vertex never moves.
    const onSide = (node: string, side: Side) => (sideEnds.get(`${node}|${side}`) ?? []).map((end) => attach.get(`${end.edge}|${end.key}`)!);
    for (const e of fig.edges) {
      const s = sides.get(e.id);
      if (!s || horiz(s[0]) !== horiz(s[1])) continue;
      const c = s[0] === "left" || s[0] === "right" ? 1 : 0;
      const p0 = attach.get(`${e.id}|src`)!, p3 = attach.get(`${e.id}|tgt`)!;
      if (p0[c] === p3[c]) continue;
      const fits = (id: string, side: Side, self: Point, v: number) => {
        if (diamond.has(id)) return false;
        const r = rects.get(id)!;
        const lo = c === 1 ? r.y : r.x, len = c === 1 ? r.h : r.w;
        if (v < lo + ALIGN_INSET || v > lo + len - ALIGN_INSET) return false;
        return onSide(id, side).every((q) => q === self || Math.abs(q[c] - v) >= MIN_SPREAD);
      };
      const tgtFirst = alone.has(`${e.id}|tgt`) || !alone.has(`${e.id}|src`);
      const moves: [() => boolean, () => void][] = [
        [() => fits(e.to, s[1], p3, p0[c]), () => { p3[c] = p0[c]; }],
        [() => fits(e.from, s[0], p0, p3[c]), () => { p0[c] = p3[c]; }],
      ];
      for (const [ok, apply] of tgtFirst ? moves : moves.reverse()) if (ok()) { apply(); break; }
    }
    return attach;
  };

  // Zones a connector may pass through: the ones either end sits in. Any other zone it enters costs ZONE_COST.
  const zoneRects = fig.groups.map((g) => ({ g, r: inflate(groupRect(g.from, g.to, theme), -BORDER_CLEAR) }));
  const within = (n: NodeSpec, g: GroupSpec) => n.at[0] >= g.from[0] && n.at[0] <= g.to[0] && n.at[1] >= g.from[1] && n.at[1] <= g.to[1];
  const entered = (points: Point[], from: string, to: string) => zoneRects.filter(({ g, r }) =>
    !within(nodes.get(from)!, g) && !within(nodes.get(to)!, g) && points.slice(1).some((b, i) => overlaps(segmentBox(points[i], b), r)));
  const trespass = (points: Point[], from: string, to: string) => entered(points, from, to).length;

  // Route choice: the cheapest clear plan, where length, bends, crossings with other routes, zones it has no end in
  // and the outer ring all cost.
  const choose = (attach: Map<string, Point>, others: Map<string, Point[]>, crossCost: number) => {
    const chosen = new Map<string, { plan: Plan; clean: boolean; points: Point[] }>();
    for (const e of fig.edges) {
      const s = sides.get(e.id);
      if (!s) continue;
      const plans = candidates(nodes.get(e.from)!, nodes.get(e.to)!, s[0], s[1], attach.get(`${e.id}|src`)!, attach.get(`${e.id}|tgt`)!, gutter);
      const drawn = [...bus.values(), ...[...others].filter(([id]) => id !== e.id).map(([, p]) => p)];
      let best: { plan: Plan; points: Point[]; score: number } | null = null;
      plans.forEach((plan, i) => {
        const points = plan.build(channelCenter);
        if (!isClear(points, reserved, [e.from, e.to])) return;
        const score = length(points) + BEND_COST * (points.length - 2) + crossCost * crossings(points, drawn) + ZONE_COST * trespass(points, e.from, e.to) + (plan.outer ? OUTER_COST : 0) + i * 1e-3;
        if (!best || score < best.score) best = { plan, points, score };
      });
      const pick: { plan: Plan; points: Point[] } = best ?? { plan: plans[0], points: plans[0].build(channelCenter) };
      chosen.set(e.id, { plan: pick.plan, clean: !!best, points: pick.points });
      others.set(e.id, pick.points);
    }
    return chosen;
  };

  // Two passes: the first finds where each route wants to go, the second orders each side's slots by that
  // direction (a detour that heads up takes the upper slot) and only then charges for crossings.
  const first = choose(attachAll(new Map()), new Map(), 0);
  const lean = new Map<string, number>();
  for (const [id, { points }] of first) {
    const s = sides.get(id)!;
    const cs = s[0] === "left" || s[0] === "right" ? 1 : 0, ct = s[1] === "left" || s[1] === "right" ? 1 : 0;
    const n = points.length;
    lean.set(`${id}|src`, points[Math.min(2, n - 1)][cs]);
    lean.set(`${id}|tgt`, points[Math.max(0, n - 3)][ct]);
  }
  const chosen = choose(attachAll(lean), new Map([...first].map(([id, c]) => [id, c.points])), CROSS_COST);
  for (const [id, { clean }] of chosen) {
    if (clean) continue;
    const e = fig.edges.find((x) => x.id === id)!;
    warn(id, `Connector ${e.from} -> ${e.to} has no clear path around the other nodes; move a node so a gutter between them is free.`);
  }

  // Lanes: edges share a gutter channel unless their runs along it overlap; overlapping runs get distinct offsets.
  const runs = new Map<string, { id: string; lo: number; hi: number }[]>();
  for (const [id, { plan, points }] of chosen) {
    for (const key of new Set(plan.channels)) {
      const span = runAlong(points, key.split(":")[0] as Axis, channelCenter(key));
      if (span) runs.set(key, [...(runs.get(key) ?? []), { id, ...span }]);
    }
  }
  const offset = new Map<string, number>();
  const extent = new Map<string, { lo: number; hi: number }>();
  for (const [key, list] of runs) {
    for (const r of list) extent.set(`${key}|${r.id}`, r);
    for (const cluster of clusters(list)) {
      const lane = new Map<string, number>();
      for (const r of cluster) {
        const taken = new Set(cluster.filter((o) => lane.has(o.id) && o.lo < r.hi && r.lo < o.hi).map((o) => lane.get(o.id)!));
        let k = 0;
        while (taken.has(k)) k++;
        lane.set(r.id, k);
      }
      const n = Math.max(...lane.values()) + 1;
      for (const [id, k] of lane) offset.set(`${key}|${id}`, (k - (n - 1) / 2) * LANE);
    }
  }

  // Zone borders: a lane keeps clear of any border it runs alongside, measured only where both actually run.
  const borders: Record<Axis, Border[]> = { col: [], row: [] };
  for (const g of fig.groups) {
    const r = groupRect(g.from, g.to, theme);
    borders.col.push({ at: r.x, lo: r.y, hi: r.y + r.h }, { at: r.x + r.w, lo: r.y, hi: r.y + r.h });
    borders.row.push({ at: r.y, lo: r.x, hi: r.x + r.w }, { at: r.y + r.h, lo: r.x, hi: r.x + r.w });
  }
  const lanePos = (id: string) => (key: string) => {
    const axis = key.split(":")[0] as Axis;
    const mid = channelCenter(key);
    const v = mid + (offset.get(`${key}|${id}`) ?? 0);
    const run = extent.get(`${key}|${id}`);
    const near = run && borders[axis].find((b) => Math.abs(v - b.at) < BORDER_CLEAR && b.lo < run.hi && run.lo < b.hi);
    return near ? near.at + (mid >= near.at ? BORDER_CLEAR : -BORDER_CLEAR) : v;
  };

  return fig.edges.map((e) => {
    const drop = bus.get(e.id);
    if (drop) return { id: e.id, points: drop };
    const pick = chosen.get(e.id);
    if (!pick) return { id: e.id, points: [], warn: `Connector ${e.from} -> ${e.to} starts and ends at the same node; remove it.` };
    let points = simplify(pick.plan.build(lanePos(e.id)));
    // Offsets are known only now: when one pushes a clean route into a node, take the next plan that stays clear
    // at its real lane positions before giving up with a warning.
    if (pick.clean && !isClear(points, reserved, [e.from, e.to])) {
      const s = sides.get(e.id)!;
      const retry = candidates(nodes.get(e.from)!, nodes.get(e.to)!, s[0], points[0], points.at(-1)!, gutter)
        .map((plan) => simplify(plan.build(lanePos(e.id))))
        .filter((p) => isClear(p, reserved, [e.from, e.to]))
        .sort((a, b) => length(a) + BEND_COST * a.length - (length(b) + BEND_COST * b.length))[0];
      if (retry) points = retry;
      else warn(e.id, `Connector ${e.from} -> ${e.to} shares a crowded gutter and touches a node; spread the nodes apart.`);
    }
    for (const { g } of entered(points, e.from, e.to)) {
      warn(e.id, `Connector ${e.from} -> ${e.to} runs through the "${g.label}" zone although neither end is in it, so it reads as part of that zone; move a node so the path goes around it.`);
    }
    const w = warns.get(e.id);
    return w ? { id: e.id, points, warn: w.join(" ") } : { id: e.id, points };
  });
}

function gutters(n: number, cell: number, gap: number, pad: number, total: number): number[] {
  return Array.from({ length: n + 1 }, (_, g) =>
    g === 0 ? pad - OUTER : g === n ? total - pad + OUTER : pad + g * (cell + gap) - gap / 2);
}

function facing(s: Rect, t: Rect, verticalFirst: boolean): [Side, Side] {
  if (verticalFirst && t.y >= s.y + s.h) return ["bottom", "top"];
  if (verticalFirst && t.y + t.h <= s.y) return ["top", "bottom"];
  if (t.x >= s.x + s.w) return ["right", "left"];
  if (t.x + t.w <= s.x) return ["left", "right"];
  if (t.y >= s.y + s.h) return ["bottom", "top"];
  return ["top", "bottom"];
}

/** A diamond branches sideways only to its own row; anything above or below leaves from the top or bottom vertex. */
function diamondFacing(s: Rect, t: Rect): [Side, Side] {
  const sameRow = t.y < s.y + s.h && t.y + t.h > s.y;
  if (sameRow) return t.x >= s.x + s.w ? ["right", "left"] : ["left", "right"];
  return t.y >= s.y + s.h ? ["bottom", "top"] : ["top", "bottom"];
}

/** One bus per parent in the gutter above its children; parents whose buses overlap there get separate lanes. */
function treeBuses(fig: FigureBlock, nodes: Map<string, NodeSpec>, rects: Map<string, Rect>, reserved: Map<string, Rect>, gutter: Gutters): Map<string, Point[]> {
  const byParent = new Map<string, { id: string; child: string }[]>();
  for (const e of fig.edges) {
    const p = nodes.get(e.from)!, c = nodes.get(e.to)!;
    if (e.from === e.to || c.at[1] !== p.at[1] + p.span[1]) continue;
    byParent.set(e.from, [...(byParent.get(e.from) ?? []), { id: e.id, child: e.to }]);
  }
  const cx = (id: string) => rects.get(id)!.x + rects.get(id)!.w / 2;
  const spans = new Map<number, { id: string; lo: number; hi: number }[]>();
  for (const [parent, kids] of byParent) {
    const row = nodes.get(kids[0].child)!.at[1];
    const xs = [cx(parent), ...kids.map((k) => cx(k.child))];
    spans.set(row, [...(spans.get(row) ?? []), { id: parent, lo: Math.min(...xs), hi: Math.max(...xs) }]);
  }
  const lane = new Map<string, number>();
  for (const list of spans.values()) {
    for (const cluster of clusters(list)) {
      const k = new Map<string, number>();
      for (const r of cluster) {
        const taken = new Set(cluster.filter((o) => k.has(o.id) && o.lo < r.hi && r.lo < o.hi).map((o) => k.get(o.id)!));
        let i = 0;
        while (taken.has(i)) i++;
        k.set(r.id, i);
      }
      const n = Math.max(...k.values()) + 1;
      for (const [id, i] of k) lane.set(id, (i - (n - 1) / 2) * LANE);
    }
  }
  const out = new Map<string, Point[]>();
  for (const [parent, kids] of byParent) {
    const p = rects.get(parent)!;
    for (const { id, child } of kids) {
      const c = rects.get(child)!;
      const y = gutter.row[nodes.get(child)!.at[1]] + lane.get(parent)!;
      const points = simplify([[cx(parent), p.y + p.h], [cx(parent), y], [cx(child), y], [cx(child), c.y]]);
      if (isClear(points, reserved, [parent, child])) out.set(id, points);
    }
  }
  return out;
}

/** Ordered routes: straight, one channel near the target then further away, then around via a cross gutter. */
function candidates(src: NodeSpec, tgt: NodeSpec, exit: Side, entry: Side, p0: Point, p3: Point, gutter: Gutters): Plan[] {
  const across = (side: Side) => side === "left" || side === "right";
  // perpendicular faces (a back edge entering the face toward its source): one bend, straight into the target
  if (across(exit) !== across(entry)) return [{ channels: [], outer: false, build: () => (across(exit) ? [p0, [p3[0], p0[1]], p3] : [p0, [p0[0], p3[1]], p3]) }];
  const m = exit === "left" || exit === "right" ? 0 : 1;
  const c = 1 - m;
  const mainAxis: Axis = m === 0 ? "col" : "row";
  const crossAxis: Axis = m === 0 ? "row" : "col";
  const P = (main: number, cross: number): Point => (m === 0 ? [main, cross] : [cross, main]);
  const forward = exit === "right" || exit === "bottom";
  const srcAdj = forward ? src.at[m] + src.span[m] : src.at[m];
  const tgtAdj = forward ? tgt.at[m] : tgt.at[m] + tgt.span[m];
  const edge = (g: number, n: number) => g === 0 || g === n;
  const plans: Plan[] = [];

  if (p0[c] === p3[c]) plans.push({ channels: [], outer: false, build: () => [p0, p3] });
  for (let g = tgtAdj; forward ? g >= srcAdj : g <= srcAdj; g += forward ? -1 : 1) {
    const k = `${mainAxis}:${g}`;
    plans.push({ channels: [k], outer: edge(g, gutter[mainAxis].length - 1), build: (pos) => [p0, P(pos(k), p0[c]), P(pos(k), p3[c]), p3] });
  }
  if (srcAdj !== tgtAdj) {
    const cross = gutter[crossAxis];
    const k1 = `${mainAxis}:${srcAdj}`, k2 = `${mainAxis}:${tgtAdj}`;
    cross.forEach((_, h) => {
      const kh = `${crossAxis}:${h}`;
      plans.push({
        channels: [k1, kh, k2],
        // The outer ring widens the figure and runs along zone borders.
        outer: edge(h, cross.length - 1),
        build: (pos) => [p0, P(pos(k1), p0[c]), P(pos(k1), pos(kh)), P(pos(k2), pos(kh)), P(pos(k2), p3[c]), p3],
      });
    });
  }
  return plans;
}

function isClear(points: Point[], rects: Map<string, Rect>, skip: string[]): boolean {
  for (const [id, r] of rects) {
    if (skip.includes(id)) continue;
    const box = inflate(r, CLEAR);
    for (let i = 0; i < points.length - 1; i++) if (overlaps(segmentBox(points[i], points[i + 1]), box)) return false;
  }
  return true;
}

function length(points: Point[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += Math.abs(points[i][0] - points[i - 1][0]) + Math.abs(points[i][1] - points[i - 1][1]);
  return d;
}

/** Proper crossings: a horizontal run of one route passes through the interior of a vertical run of another. */
function crossings(points: Point[], others: Point[][]): number {
  let n = 0;
  const segs = (p: Point[]) => p.slice(1).map((b, i) => [p[i], b] as const);
  const mine = segs(points);
  for (const other of others) {
    for (const [a, b] of mine) {
      for (const [c, d] of segs(other)) if (crosses(a, b, c, d) || crosses(c, d, a, b)) n++;
    }
  }
  return n;
}

function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  if (a[1] !== b[1] || c[0] !== d[0] || a[0] === b[0] || c[1] === d[1]) return false;
  const x = c[0], y = a[1];
  return x > Math.min(a[0], b[0]) + 1 && x < Math.max(a[0], b[0]) - 1 && y > Math.min(c[1], d[1]) + 1 && y < Math.max(c[1], d[1]) - 1;
}

/** Where a route runs inside the channel at `at`: the interval it covers along the channel, or null. */
function runAlong(points: Point[], axis: Axis, at: number): { lo: number; hi: number } | null {
  const i = axis === "col" ? 0 : 1, j = 1 - i;
  let lo = Infinity, hi = -Infinity;
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k];
    if (Math.abs(a[i] - at) > 0.01 || Math.abs(b[i] - at) > 0.01) continue;
    lo = Math.min(lo, a[j], b[j]);
    hi = Math.max(hi, a[j], b[j]);
  }
  return lo <= hi ? { lo, hi } : null;
}

/** Runs grouped into chains of overlaps, each sorted by where it starts; lanes are only shared out inside a chain. */
function clusters<T extends { id: string; lo: number; hi: number }>(list: T[]): T[][] {
  const sorted = [...list].sort((a, b) => a.lo - b.lo || a.hi - b.hi || byId(a.id, b.id));
  const out: T[][] = [];
  let reach = -Infinity;
  for (const r of sorted) {
    if (out.length && r.lo < reach) out[out.length - 1].push(r);
    else out.push([r]);
    reach = Math.max(reach, r.hi);
  }
  return out;
}

function simplify(points: Point[]): Point[] {
  const same = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const out: Point[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || !same(q[0], p[0]) || !same(q[1], p[1])) out.push([round1(p[0]), round1(p[1])]);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const [a, b, d] = [out[i - 1], out[i], out[i + 1]];
    if ((same(a[0], b[0]) && same(b[0], d[0])) || (same(a[1], b[1]) && same(b[1], d[1]))) out.splice(i, 1);
  }
  return out;
}
