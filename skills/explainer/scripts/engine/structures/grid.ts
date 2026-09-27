// Shared by schema and uml: boxes on the figure grid, their connectors, connector labels and the canvas around them.
// Box-to-box links go through the figure router (routeBoxes); schema's physical mode routes row to row (routeRows).
import { SpecError, type FigureBlock, type Layout, type ReadingSpec, type Theme } from "../types.ts";
import { esc, list, num, number, routeEdges, textWidth } from "../kit.ts";

export type Pt = [number, number];
export interface Rect { x: number; y: number; w: number; h: number }
export interface Box { id: string; label: string; at: Pt; span: Pt }
export interface Link { id: string; from: string; to: string }
/** A routed connector. `joins` are bus junction dots; `warn` is a sentence for `check`. */
export interface Route { points: Pt[]; joins?: Pt[]; warn?: string }

// ---------- grid ----------

export function cell(v: unknown, what: string, line: number): Pt {
  const n = list(v, what, line).map((x, i) => number(x, `${what}[${i}]`, line));
  if (n.length !== 2 || n.some((x) => !Number.isInteger(x) || x < 0)) throw new SpecError(`${what} must be [col, row] with whole numbers from 0, e.g. [0, 1].`, line);
  return [n[0] as number, n[1] as number];
}

export function spanOf(v: unknown, what: string, line: number): number | undefined {
  if (v === undefined) return undefined;
  const n = number(v, what, line);
  if (!Number.isInteger(n) || n < 1 || n > 4) throw new SpecError(`${what} must be a width in cells from 1 to 4.`, line);
  return n;
}

export function cellsFor(size: number, cellSize: number, gap: number): number {
  return Math.max(1, Math.ceil((size + gap) / (cellSize + gap) - 1e-6));
}

/** The widest a schema or uml figure's columns may run, so the card keeps its 16px gutter and 256px beside it. */
export const FIGURE_MAX = 960;

/**
 * One column width for the whole figure: the widest box that sits in one column, on the 8px grid, never
 * narrower than the theme's cell and never so wide that `cols` columns pass FIGURE_MAX. A box too wide for
 * that takes two columns and leaves the others alone.
 */
export function columnWidth(widths: number[], cols: number, theme: Theme): number {
  const { pad, cell: [cw], gap: [gx] } = theme.grid;
  const cap = Math.max(cw, Math.floor((FIGURE_MAX - 2 * pad - (cols - 1) * gx) / cols / 8) * 8);
  return Math.max(cw, ...widths.map((w) => Math.ceil(w / 8) * 8).filter((w) => w <= cap));
}

/** The theme with this figure's column width, for everything that lays boxes and routes on the grid. */
export function withColumn(theme: Theme, width: number): Theme {
  return { ...theme, grid: { ...theme.grid, cell: [width, theme.grid.cell[1]] } };
}

/** A box as drawn: one column is the column width; a wider box is as wide as its widest row, within its span. */
export function boxWidth(span: number, need: number, theme: Theme): number {
  const [cw] = theme.grid.cell, [gx] = theme.grid.gap;
  return span === 1 ? cw : Math.min(span * cw + (span - 1) * gx, Math.max(cw, Math.ceil(need / 8) * 8));
}

export function rectOf(at: Pt, span: Pt, theme: Theme): Rect {
  const [cw, ch] = theme.grid.cell, [gx, gy] = theme.grid.gap, pad = theme.grid.pad;
  return { x: pad + at[0] * (cw + gx), y: pad + at[1] * (ch + gy), w: span[0] * cw + (span[0] - 1) * gx, h: span[1] * ch + (span[1] - 1) * gy };
}

/** Grid cells shared by two boxes. */
export function overlaps(a: { at: Pt; span: Pt }, b: { at: Pt; span: Pt }): boolean {
  return a.at[0] < b.at[0] + b.span[0] && b.at[0] < a.at[0] + a.span[0] && a.at[1] < b.at[1] + b.span[1] && b.at[1] < a.at[1] + a.span[1];
}

// ---------- text ----------

export function fitText(s: string, max: number, px: number, font: "sans" | "mono"): string {
  if (textWidth(s, px, font) <= max) return s;
  let cut = s;
  while (cut.length > 1 && textWidth(`${cut}…`, px, font) > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

export function count(n: number, word: string, plural = `${word}s`): string {
  return `${n} ${n === 1 ? word : plural}`;
}

/** notes and story may only point at this block's elements. */
export function checkRefs(r: ReadingSpec, ids: Set<string>, where: string, line: number): void {
  const miss = (id: string, what: string) => {
    if (!ids.has(id)) throw new SpecError(`${where} ${what} points at "${id}", which is not an element of this block (e.g. "${[...ids][0]}").`, line, "ref-exists");
  };
  for (const n of r.notes ?? []) for (const id of n.on) miss(id, "note");
  for (const s of r.story ?? []) {
    miss(s.sel, "story step");
    if (s.cmp) miss(s.cmp, "story step");
  }
}

// ---------- geometry ----------

/** How far a row-to-row route keeps from boxes it doesn't join. */
const CLEAR = 6;

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function hit(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function segBox(a: Pt, b: Pt): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

function segs(p: Pt[]): [Pt, Pt][] {
  return p.slice(1).map((b, i) => [p[i] as Pt, b]);
}

/** Union of rects, for the canvas. */
export function union(rs: Rect[]): Rect {
  const x1 = Math.min(...rs.map((r) => r.x)), y1 = Math.min(...rs.map((r) => r.y));
  const x2 = Math.max(...rs.map((r) => r.x + r.w)), y2 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** The ids of rects (other than `skip`) that the polyline passes within `d` px of. */
function touched(p: Pt[], rects: Map<string, Rect>, skip: string[], d: number): string[] {
  const out: string[] = [];
  for (const [id, r] of rects) {
    if (skip.includes(id)) continue;
    const box = inflate(r, d);
    if (segs(p).some(([a, b]) => hit(segBox(a, b), box))) out.push(id);
  }
  return out;
}

function simplify(p: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const q of p) {
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1] as Pt, b = out[i] as Pt, c = out[i + 1] as Pt;
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(i, 1);
  }
  return out;
}

// ---------- box-to-box routes (er tables, uml classes) ----------

type Side = "left" | "right" | "top" | "bottom";
/** How far a self loop reaches out: the 22px notation ends keep a straight run before the corner. */
const LOOP = 36;

/** Routes through the figure router, its warnings kept for `check`; a self link loops out of the side no other connector uses. */
export function routeBoxes(
  block: { id: string; line: number; grid: Pt },
  boxes: Box[],
  links: Link[],
  rects: Map<string, Rect>,
  theme: Theme,
  layout: Layout = "flow",
): Map<string, Route> {
  const fig: FigureBlock = {
    type: "figure", id: block.id, layout, grid: block.grid,
    nodes: boxes.map((b) => ({ id: b.id, label: b.label, at: b.at, span: b.span, kind: "service" as const, focal: false, tags: [] })),
    edges: links.filter((l) => l.from !== l.to).map((l) => ({ id: l.id, from: l.from, to: l.to, kind: "flow" as const })),
    groups: [], scenes: [], legend: false, line: block.line,
  };
  const out = new Map<string, Route>();
  for (const r of fig.edges.length ? routeEdges(fig, theme, rects) : []) out.set(r.id, r.warn ? { points: r.points, warn: r.warn } : { points: r.points });
  const ends = [...out.values()].flatMap((r) => (r.points.length ? [r.points[0] as Pt, r.points[r.points.length - 1] as Pt] : []));
  for (const l of links) {
    if (l.from !== l.to) continue;
    const r = rects.get(l.from) as Rect;
    out.set(l.id, { points: selfLoop(r, freeSide(r, ends)) });
  }
  return out;
}

function sideOf(p: Pt, r: Rect): Side | null {
  const on = (a: number, b: number) => Math.abs(a - b) < 0.5;
  if (on(p[0], r.x + r.w) && p[1] >= r.y && p[1] <= r.y + r.h) return "right";
  if (on(p[0], r.x) && p[1] >= r.y && p[1] <= r.y + r.h) return "left";
  if (on(p[1], r.y + r.h) && p[0] >= r.x && p[0] <= r.x + r.w) return "bottom";
  if (on(p[1], r.y) && p[0] >= r.x && p[0] <= r.x + r.w) return "top";
  return null;
}

function freeSide(r: Rect, ends: Pt[]): Side {
  const order: Side[] = ["right", "left", "bottom", "top"];
  const used = (s: Side) => ends.filter((p) => sideOf(p, r) === s).length;
  return order.find((s) => !used(s)) ?? order.reduce((a, b) => (used(b) < used(a) ? b : a));
}

function selfLoop(r: Rect, side: Side): Pt[] {
  if (side === "right" || side === "left") {
    const x = side === "right" ? r.x + r.w : r.x, out = side === "right" ? LOOP : -LOOP;
    const y1 = r.y + 17, y2 = r.y + Math.min(r.h - 8, 64);
    return [[x, y1], [x + out, y1], [x + out, y2], [x, y2]];
  }
  const y = side === "bottom" ? r.y + r.h : r.y, out = side === "bottom" ? LOOP : -LOOP;
  const x2 = r.x + r.w - 17, x1 = r.x + Math.max(8, r.w - 64);
  return [[x2, y], [x2, y + out], [x1, y + out], [x1, y]];
}

// ---------- row-to-row routes (schema physical mode) ----------

/** A foreign key: from its row on the `from` table to the referenced row on the `to` table (row centres). `end` names
 * the notation drawn at the referenced row; keys only share a bus, and so one end marker, when it is the same. */
export interface RowLink extends Link { fromY: number; toY: number; end?: string }

/** Straight run from a table side to the first corner: the 21px crow's foot, the 8px corner and 1px air. */
const STUB = 30;
const LANE = 12;
/** Lanes in a gutter between two table columns sit within ±BAND of its centre, so both stubs keep STUB. */
const BAND = 22;
/** A same-column bracket reaches this far out of the table side on the outer edges of the grid. */
const BRACKET = 36;
/** Two keys arriving at one row sit this far above and below its centre. */
const PORT = 8;
/** Verticals whose spans come closer than twice this share no lane. */
const SPAN_GAP = 6;

type Kind = "straight" | "z" | "bracket" | "around";
interface Plan {
  link: RowLink;
  kind: Kind;
  fx: number; tx: number;            // x of the fk end and of the pk end
  fy: number; ty: number;            // y of both ends, after port offsets
  side: [1 | -1, 1 | -1];            // outward direction of each end: 1 = leaves the right side
  gutters: number[];                 // vertical gutters holding its verticals (around: two)
  run?: number;                      // around: y of the horizontal between the two gutters
  bus?: string;                      // shares one lane with the other keys into the same row
  blocked?: boolean;
}
interface User { key: string; gutter: number; plans: Plan[]; lo: number; hi: number }

/**
 * Connectors that leave the exact fk row and end at the exact referenced row, on the left or right table side.
 * Tables side by side get a Z through the gutter next to the referenced table; tables in one column get a
 * one-sided bracket; keys into one row sit at ±PORT, and three or more that arrive the same way share a bus
 * with junction dots and one end marker. Lanes in a gutter are ordered to minimise crossings; what remains
 * crossed gets a hop when drawn.
 */
export function routeRows(block: { grid: Pt }, boxes: Box[], links: RowLink[], rects: Map<string, Rect>, theme: Theme): Map<string, Route> {
  const { pad, cell: [cw, ch], gap: [gx, gy] } = theme.grid;
  const [cols, rows] = block.grid;
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const labels = new Map(boxes.map((b) => [b.id, b.label]));
  const colGutter = (g: number) => pad + g * (cw + gx) - gx / 2;
  const rowGutters = [pad - 28, ...Array.from({ length: rows - 1 }, (_, r) => pad + (r + 1) * (ch + gy) - gy / 2), pad + rows * (ch + gy) - gy + 28];
  const leftEdge = pad, rightEdge = pad + cols * (cw + gx) - gx;
  const laneX = (g: number, t: number, n: number): number => {
    if (g <= 0) return leftEdge - BRACKET - LANE * (n - 1 - t);
    if (g >= cols) return rightEdge + BRACKET + LANE * t;
    const step = n > 1 ? Math.min(LANE, (2 * BAND) / (n - 1)) : 0;
    return colGutter(g) + (t - (n - 1) / 2) * step;
  };
  const warns = new Map<string, string[]>();
  const warn = (id: string, msg: string) => (warns.get(id) ?? warns.set(id, []).get(id) as string[]).push(msg);
  const clear = (p: Pt[], l: Link) => touched(p, rects, [l.from, l.to], CLEAR).length === 0;
  const name = (l: RowLink) => `${labels.get(l.from)} -> ${labels.get(l.to)}`;

  // 1. Shape and gutters: Z between tables side by side, bracket within one column, around when no gutter is free.
  const options = new Map<Plan, number[]>();
  const plans: Plan[] = links.map((l) => {
    const a = rects.get(l.from) as Rect, b = rects.get(l.to) as Rect;
    const A = byId.get(l.from) as Box, B = byId.get(l.to) as Box;
    const plan: Plan = { link: l, kind: "bracket", fx: 0, tx: 0, fy: l.fromY, ty: l.toY, side: [1, 1], gutters: [] };
    const right = a.x + a.w <= b.x, left = b.x + b.w <= a.x;
    if (l.from === l.to || (!right && !left)) return plan;
    plan.kind = "z";
    plan.side = right ? [1, -1] : [-1, 1];
    plan.fx = right ? a.x + a.w : a.x;
    plan.tx = right ? b.x : b.x + b.w;
    const [g1, g2] = right ? [A.at[0] + A.span[0], B.at[0]] : [A.at[0], B.at[0] + B.span[0]];
    // The gutter next to the referenced table first: the corner sits by the key, the long run stays on the fk row.
    const order = Array.from({ length: Math.abs(g2 - g1) + 1 }, (_, i) => (g2 > g1 ? g2 - i : g2 + i));
    const open = order.filter((g) => clear(zPoints(plan, colGutter(g)), l));
    if (open.length) {
      plan.gutters = [open[0] as number];
      if (open.length > 1) options.set(plan, open);
      return plan;
    }
    const mid = (l.fromY + l.toY) / 2;
    const run = [...rowGutters].sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid)).find((y) => clear(aroundPoints(plan, colGutter(g1), y, colGutter(g2)), l));
    if (run !== undefined) {
      plan.kind = "around";
      plan.gutters = [g1, g2];
      plan.run = run;
      return plan;
    }
    plan.gutters = [order[0] as number];
    plan.blocked = true;
    return plan;
  });

  // 2. Of several free gutters, the one whose runs cross and overlap the fewest others; the key's own gutter breaks ties.
  const centred = (p: Plan): Pt[] => build(p, (g) => colGutter(g));
  const conflicts = (p: Plan) => plans.filter((q) => q !== p && q.gutters.length).reduce((n, q) => {
    const a = centred(p), b = centred(q);
    return n + crossCount(a, b) + 5 * runOverlaps(a, b, true);
  }, 0);
  for (let pass = 0; pass < 2; pass++) {
    for (const [p, open] of options) {
      let best = { g: p.gutters[0] as number, s: Infinity };
      open.forEach((g, i) => {
        p.gutters = [g];
        const s = conflicts(p) + i / 2;
        if (s < best.s) best = { g, s };
      });
      p.gutters = [best.g];
    }
  }

  // 3. Bracket side: fewer crossed runs, then fewer keys already on that side of its rows, then no neighbour, then right.
  const load = (self: Plan, table: string, dir: 1 | -1, y: number) =>
    plans.filter((q) => q !== self && q.gutters.length).reduce((n, q) =>
      n + ([0, 1] as const).filter((e) => (e ? q.link.to : q.link.from) === table && q.side[e] === dir && (e ? q.link.toY : q.link.fromY) === y).length, 0);
  for (const p of plans) {
    if (p.kind !== "bracket") continue;
    const l = p.link, a = rects.get(l.from) as Rect, b = rects.get(l.to) as Rect;
    const A = byId.get(l.from) as Box, B = byId.get(l.to) as Box;
    const lo = Math.min(l.fromY, l.toY), hi = Math.max(l.fromY, l.toY);
    let best: { score: number; apply: () => void } | null = null;
    for (const dir of [1, -1] as const) {
      const g = dir === 1 ? Math.max(A.at[0] + A.span[0], B.at[0] + B.span[0]) : Math.min(A.at[0], B.at[0]);
      const fx = dir === 1 ? a.x + a.w : a.x, tx = dir === 1 ? b.x + b.w : b.x;
      const lane = g <= 0 || g >= cols ? laneX(g, 0, 1) : colGutter(g) - dir * (BAND - 8);
      const pts: Pt[] = [[fx, l.fromY], [lane, l.fromY], [lane, l.toY], [tx, l.toY]];
      const crossings = plans.filter((q) => q !== p && q.gutters.length).reduce((n, q) => n + crossCount(pts, centred(q)), 0);
      const neighbour = [...rects].some(([id, r]) => id !== l.from && id !== l.to && r.y < hi && r.y + r.h > lo &&
        (dir === 1 ? r.x >= fx && r.x <= fx + gx + 1 : r.x + r.w <= fx && r.x + r.w >= fx - gx - 1));
      const ports = load(p, l.from, dir, l.fromY) + load(p, l.to, dir, l.toY);
      const score = (clear(pts, l) ? 0 : 1000) + crossings * 10 + ports * 3 + (neighbour ? 2 : 0) + (dir === -1 ? 1 : 0);
      if (!best || score < best.score) best = { score, apply: () => { p.side = [dir, dir]; p.fx = fx; p.tx = tx; p.gutters = [g]; p.blocked = score >= 1000; } };
    }
    best?.apply();
  }

  // 4. Ports. Three or more keys whose last corner sits in one gutter share a bus into the row; every other
  //    arrival at that row gets its own port at ±PORT.
  const shape = (p: Plan) => `${p.kind === "around" ? p.gutters[1] : p.gutters[0]}|${p.link.end ?? ""}`;
  const ends = new Map<string, { p: Plan; end: 0 | 1 }[]>();
  for (const p of plans) {
    for (const end of [0, 1] as const) {
      const table = end ? p.link.to : p.link.from, y = end ? p.link.toY : p.link.fromY;
      const k = `${table}|${p.side[end]}|${y}`;
      (ends.get(k) ?? ends.set(k, []).get(k) as { p: Plan; end: 0 | 1 }[]).push({ p, end });
    }
  }
  for (const [k, group] of ends) {
    if (group.length < 2) continue;
    const other = (e: { p: Plan; end: 0 | 1 }) => (e.end ? e.p.link.fromY : e.p.link.toY);
    const byShape = new Map<string, { p: Plan; end: 0 | 1 }[]>();
    for (const e of group) if (e.end === 1) (byShape.get(shape(e.p)) ?? byShape.set(shape(e.p), []).get(shape(e.p)) as { p: Plan; end: 0 | 1 }[]).push(e);
    const arrivals: { p: Plan; end: 0 | 1 }[][] = [];
    const bussed = new Set<Plan>();
    for (const [sig, list] of byShape) {
      if (list.length < 3) continue;
      for (const e of list) { e.p.bus = `${k}|${sig}`; bussed.add(e.p); }
      arrivals.push(list);
    }
    for (const e of group) if (!(e.end === 1 && bussed.has(e.p))) arrivals.push([e]);
    if (arrivals.length < 2) continue;
    const mean = (a: { p: Plan; end: 0 | 1 }[]) => a.reduce((n, e) => n + other(e), 0) / a.length;
    arrivals.sort((u, v) => mean(u) - mean(v) || ((u[0] as { p: Plan }).p.link.id < (v[0] as { p: Plan }).p.link.id ? -1 : 1));
    arrivals.forEach((a, i) => {
      const off = (i - (arrivals.length - 1) / 2) * ((2 * PORT) / (arrivals.length - 1));
      for (const e of a) {
        if (e.end) e.p.ty += off;
        else e.p.fy += off;
      }
    });
    if (arrivals.length > 2) warn((group[0] as { p: Plan }).p.link.id, `${arrivals.length} keys meet one row of "${labels.get(k.split("|")[0] as string)}" from the same side; move a table so some arrive from the other side.`);
  }

  // 5. Rows at the same height join straight when nothing sits between them; routes around that share a
  //    row gutter take separate runs.
  for (const p of plans) {
    if (p.kind === "z" && !p.bus && p.fy === p.ty && clear([[p.fx, p.fy], [p.tx, p.ty]], p.link)) {
      p.kind = "straight";
      p.gutters = [];
      p.blocked = false;
    }
  }
  const runs = new Map<number, string[]>();
  for (const p of plans) {
    if (p.kind !== "around") continue;
    (runs.get(p.run as number) ?? runs.set(p.run as number, []).get(p.run as number) as string[]).push(p.link.id);
  }
  for (const p of plans) {
    if (p.kind !== "around") continue;
    const list = runs.get(p.run as number) as string[];
    p.run = (p.run as number) + (list.indexOf(p.link.id) - (list.length - 1) / 2) * LANE;
  }

  // 6. Lanes: per gutter, the order with the fewest crossings, packed so verticals that don't overlap share a lane.
  const verticals = (p: Plan): { key: string; gutter: number; entry: number; exit: number }[] => {
    if (p.kind === "straight" || !p.gutters.length) return [];
    if (p.kind === "around") {
      return [
        { key: `${p.link.id}|0`, gutter: p.gutters[0] as number, entry: p.fy, exit: p.run as number },
        { key: p.bus ?? `${p.link.id}|1`, gutter: p.gutters[1] as number, entry: p.run as number, exit: p.ty },
      ];
    }
    return [{ key: p.bus ?? p.link.id, gutter: p.gutters[0] as number, entry: p.fy, exit: p.ty }];
  };
  const users: User[] = [];
  for (const p of plans) {
    for (const v of verticals(p)) {
      const lo = Math.min(v.entry, v.exit), hi = Math.max(v.entry, v.exit);
      const u = users.find((x) => x.key === v.key);
      if (u) {
        u.plans.push(p);
        u.lo = Math.min(u.lo, lo);
        u.hi = Math.max(u.hi, hi);
      } else users.push({ key: v.key, gutter: v.gutter, plans: [p], lo, hi });
    }
  }
  const x = new Map<string, number>(users.map((u) => [u.key, laneX(u.gutter, 0, 1)]));
  const laneOf = (p: Plan, i: number) => x.get(verticals(p)[i]?.key as string) as number;
  const built = () => plans.map((p) => build(p, (_, i) => laneOf(p, i)));
  const score = () => {
    const all = built();
    let s = 0;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (plans[i]?.bus && plans[i]?.bus === plans[j]?.bus) continue;
        s += crossCount(all[i] as Pt[], all[j] as Pt[]) + 5 * runOverlaps(all[i] as Pt[], all[j] as Pt[]);
      }
    }
    return s;
  };
  const gutterIds = [...new Set(users.map((u) => u.gutter))].sort((p, q) => p - q);
  for (let pass = 0; pass < 2; pass++) {
    for (const g of gutterIds) {
      const mine = users.filter((u) => u.gutter === g);
      let best = { s: Infinity, xs: mine.map((u) => x.get(u.key) as number) };
      for (const order of orders(mine)) {
        const track: number[] = [];
        order.forEach((u, i) => {
          track[i] = Math.max(0, ...order.slice(0, i).map((v, j) => (v.lo - SPAN_GAP < u.hi + SPAN_GAP && u.lo - SPAN_GAP < v.hi + SPAN_GAP ? (track[j] as number) + 1 : 0)));
        });
        const n = Math.max(...track) + 1;
        order.forEach((u, i) => x.set(u.key, laneX(g, track[i] as number, n)));
        const s = score();
        if (s < best.s) best = { s, xs: mine.map((u) => x.get(u.key) as number) };
      }
      mine.forEach((u, i) => x.set(u.key, best.xs[i] as number));
      const lanes = new Set(best.xs).size;
      if (pass === 1 && g > 0 && g < cols && lanes > 5) {
        for (const u of mine) warn(u.plans[0]?.link.id as string, `${lanes} connectors share the gutter between table columns ${g} and ${g + 1}; spread the tables so fewer keys pass one gutter.`);
      }
    }
  }

  // 7. Two runs at almost the same height that overlap or nearly meet read as one line: the later one moves within its row.
  let pts = built();
  for (let j = 1; j < plans.length; j++) {
    for (let i = 0; i < j; i++) {
      const pj = plans[j] as Plan;
      if (pj.bus && pj.bus === plans[i]?.bus) continue;
      const clash = runClash(pts[i] as Pt[], pts[j] as Pt[]);
      if (clash === null) continue;
      const away = (y: number, row: number) => {
        const up = y >= (runAt(pts[i] as Pt[], clash) ?? clash) ? 1 : -1;
        return [y + up * PORT, y - up * PORT].find((v) => Math.abs(v - row) <= PORT) ?? y;
      };
      if (Math.abs(clash - pj.fy) < 0.5) pj.fy = away(pj.fy, pj.link.fromY);
      else if (Math.abs(clash - pj.ty) < 0.5) pj.ty = away(pj.ty, pj.link.toY);
      pts = built();
    }
  }

  // Junction dots where a branch meets a shared lane between its ends.
  const joins = new Map<Plan, Pt[]>();
  for (const u of users) {
    if (u.plans.length < 2) continue;
    const marks = new Map<number, Plan>();
    for (const p of u.plans) {
      const v = verticals(p).find((w) => w.key === u.key);
      if (!v) continue;
      for (const y of [v.entry, v.exit]) if (y > u.lo && y < u.hi && !marks.has(y)) marks.set(y, p);
    }
    const lane = x.get(u.key) as number;
    for (const [y, p] of marks) joins.set(p, [...(joins.get(p) ?? []), [lane, y]]);
  }

  const out = new Map<string, Route>();
  plans.forEach((p, i) => {
    const points = pts[i] as Pt[];
    if (p.blocked || !clear(points, p.link)) warn(p.link.id, `Foreign key ${name(p.link)} has no clear path between the tables; move a table so a gutter between them is free.`);
    const route: Route = { points };
    const j = joins.get(p);
    if (j) route.joins = j;
    const w = warns.get(p.link.id);
    if (w) route.warn = w.join(" ");
    out.set(p.link.id, route);
  });
  return out;
}

function zPoints(p: Plan, lane: number): Pt[] {
  return [[p.fx, p.fy], [lane, p.fy], [lane, p.ty], [p.tx, p.ty]];
}

function aroundPoints(p: Plan, x1: number, y: number, x2: number): Pt[] {
  return [[p.fx, p.fy], [x1, p.fy], [x1, y], [x2, y], [x2, p.ty], [p.tx, p.ty]];
}

function build(p: Plan, lane: (g: number, i: number) => number): Pt[] {
  if (p.kind === "straight") return [[p.fx, p.fy], [p.tx, p.ty]];
  if (p.kind === "around") return simplify(aroundPoints(p, lane(p.gutters[0] as number, 0), p.run as number, lane(p.gutters[1] as number, 1)));
  if (!p.gutters.length) return [];
  return simplify(zPoints(p, lane(p.gutters[0] as number, 0)));
}

/** Every order of a gutter's users, or for more than six a few rotations of the sorted order. */
function orders<T extends { lo: number; key: string }>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => a.lo - b.lo || (a.key < b.key ? -1 : 1));
  if (sorted.length > 6) return sorted.map((_, i) => [...sorted.slice(i), ...sorted.slice(0, i)]);
  const out: T[][] = [];
  const walk = (rest: T[], acc: T[]) => {
    if (!rest.length) { out.push(acc); return; }
    rest.forEach((v, i) => walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, v]));
  };
  walk(sorted, []);
  return out;
}

/** Proper crossings between the horizontal runs of one polyline and the vertical runs of the other. */
export function crossCount(p: Pt[], q: Pt[]): number {
  let n = 0;
  for (const [a, b] of segs(p)) {
    for (const [c, d] of segs(q)) {
      const [h, v] = a[1] === b[1] && c[0] === d[0] ? [[a, b], [c, d]] : a[0] === b[0] && c[1] === d[1] ? [[c, d], [a, b]] : [null, null];
      if (!h || !v) continue;
      const [h1, h2] = h as [Pt, Pt], [v1, v2] = v as [Pt, Pt];
      const y = h1[1], xv = v1[0];
      if (xv > Math.min(h1[0], h2[0]) + 0.5 && xv < Math.max(h1[0], h2[0]) - 0.5 && y > Math.min(v1[1], v2[1]) + 0.5 && y < Math.max(v1[1], v2[1]) - 0.5) n++;
    }
  }
  return n;
}

/** Parallel runs of two polylines closer than half a lane over more than 2px: they read as one line. */
function runOverlaps(p: Pt[], q: Pt[], horizontalOnly = false): number {
  let n = 0;
  for (const [a, b] of segs(p)) {
    for (const [c, d] of segs(q)) {
      const hz = a[1] === b[1] && c[1] === d[1], vt = !horizontalOnly && a[0] === b[0] && c[0] === d[0];
      if (!hz && !vt) continue;
      const k = hz ? 1 : 0, m = hz ? 0 : 1;
      if (Math.abs(a[k] - c[k]) >= LANE / 2) continue;
      const lo = Math.max(Math.min(a[m], b[m]), Math.min(c[m], d[m])), hi = Math.min(Math.max(a[m], b[m]), Math.max(c[m], d[m]));
      if (hi - lo > 2) n++;
    }
  }
  return n;
}

/** y of a horizontal run of `q` at about the height of one of `p` and overlapping it or ending within two lanes of it, or null. */
function runClash(p: Pt[], q: Pt[]): number | null {
  for (const [a, b] of segs(q)) {
    if (a[1] !== b[1]) continue;
    for (const [c, d] of segs(p)) {
      if (c[1] !== d[1] || Math.abs(a[1] - c[1]) >= LANE / 2) continue;
      const lo = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])), hi = Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]));
      if (hi - lo > -2 * LANE) return a[1];
    }
  }
  return null;
}

function runAt(p: Pt[], y: number): number | null {
  for (const [a, b] of segs(p)) if (a[1] === b[1] && Math.abs(a[1] - y) < LANE / 2) return a[1];
  return null;
}

// ---------- drawing ----------

const CORNER = 8;
const HOP = 4;
const HOP_MARGIN = CORNER + HOP + 2;

/** Rounded right-angle path with 4px hops where a horizontal run crosses a vertical run drawn earlier. */
export function edgePath(pts: Pt[], earlier: Pt[][]): string {
  const hops = hopsFor(pts, earlier);
  const dist = (a: Pt, b: Pt) => Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  const radius = (i: number) =>
    i <= 0 || i >= pts.length - 1 ? 0 : Math.min(CORNER, dist(pts[i - 1] as Pt, pts[i] as Pt) / 2, dist(pts[i] as Pt, pts[i + 1] as Pt) / 2);
  const first = pts[0] as Pt;
  let d = `M${num(first[0])},${num(first[1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as Pt, b = pts[i + 1] as Pt;
    const ux = Math.sign(b[0] - a[0]), uy = Math.sign(b[1] - a[1]);
    for (const x of hops.get(i) ?? []) {
      d += ` L${num(x - HOP * ux)},${num(a[1])} A${HOP},${HOP} 0 0 ${ux > 0 ? 1 : 0} ${num(x + HOP * ux)},${num(a[1])}`;
    }
    const r = radius(i + 1);
    d += ` L${num(b[0] - ux * r)},${num(b[1] - uy * r)}`;
    if (r > 0) {
      const c = pts[i + 2] as Pt;
      d += ` Q${num(b[0])},${num(b[1])} ${num(b[0] + Math.sign(c[0] - b[0]) * r)},${num(b[1] + Math.sign(c[1] - b[1]) * r)}`;
    }
  }
  return d;
}

function hopsFor(pts: Pt[], earlier: Pt[][]): Map<number, number[]> {
  const verticals = earlier.flatMap((p) => segs(p).filter(([a, b]) => a[0] === b[0] && a[1] !== b[1]));
  const out = new Map<number, number[]>();
  segs(pts).forEach(([a, b], i) => {
    if (a[1] !== b[1]) return;
    const y = a[1], lo = Math.min(a[0], b[0]) + HOP_MARGIN, hi = Math.max(a[0], b[0]) - HOP_MARGIN, dir = Math.sign(b[0] - a[0]);
    const xs = verticals
      .filter(([c, e]) => c[0] > lo && c[0] < hi && y > Math.min(c[1], e[1]) + 1 && y < Math.max(c[1], e[1]) - 1)
      .map(([c]) => c[0])
      .sort((p, q) => (p - q) * dir);
    const kept: number[] = [];
    for (const x of xs) if (!kept.length || Math.abs(x - (kept[kept.length - 1] as number)) >= 2 * HOP + 2) kept.push(x);
    if (kept.length) out.set(i, kept);
  });
  return out;
}

export function edgeSvg(
  e: Link, d: string, markers: { start?: string; end?: string }, dashed: boolean, extra: string, cls = "",
): string {
  const m = (markers.start ? ` marker-start="url(#${esc(markers.start)})"` : "") + (markers.end ? ` marker-end="url(#${esc(markers.end)})"` : "");
  return `<g class="x-edge x-struct-edge${dashed ? " x-dashed" : ""}${cls ? ` ${cls}` : ""}" data-id="${esc(e.id)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-kind="${dashed ? "return" : "flow"}">` +
    `<path class="x-edge-line" d="${d}"${m}/><path class="x-edge-hit" d="${d}"/>${extra}</g>`;
}

/** The name band across the top of a box, rounded like the box: the focal tint lives here, never behind the rows. */
export function bandPath(r: Rect, h: number, radius: number): string {
  const q = Math.min(radius, h / 2);
  return `<path class="x-struct-band" d="M${num(r.x)},${num(r.y + h)} L${num(r.x)},${num(r.y + q)} Q${num(r.x)},${num(r.y)} ${num(r.x + q)},${num(r.y)} L${num(r.x + r.w - q)},${num(r.y)} Q${num(r.x + r.w)},${num(r.y)} ${num(r.x + r.w)},${num(r.y + q)} L${num(r.x + r.w)},${num(r.y + h)} Z"/>`;
}

export function joinDots(joins: Pt[] | undefined): string {
  return (joins ?? []).map(([x, y]) => `<circle class="x-struct-join" cx="${num(x)}" cy="${num(y)}" r="2.5"/>`).join("");
}

// ---------- connector labels ----------

const LABEL_H = 14, LABEL_PAD = 4, LABEL_GAP = 6;

/**
 * The box for a label beside the longest run that fits it, clear of boxes and earlier labels, and of other lines
 * when it can be. Returns null when no run has room; the caller warns.
 */
export function placeLabel(label: string, pts: Pt[], px: number, blocked: Rect[], lines: Rect[], below = false): Rect | null {
  const tw = textWidth(label, px, "sans"), w = tw + 2 * LABEL_PAD;
  // Its own runs first, longest first; a run it shares with others (a bus trunk) would make the label ambiguous.
  const shared = (a: Pt, b: Pt) => lines.some((l) => { const r = segBox(a, b); return r.x >= l.x && r.y >= l.y && r.x + r.w <= l.x + l.w && r.y + r.h <= l.y + l.h; });
  const runs = segs(pts).map(([a, b]) => ({ a, b, len: Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), own: !shared(a, b) }))
    .sort((p, q) => Number(q.own) - Number(p.own) || q.len - p.len);
  const spots: Rect[] = [];
  for (const { a, b, len } of runs) {
    if (a[1] === b[1] && len >= w + 12) {
      const room = (len - w - 12) / 2, cx = (a[0] + b[0]) / 2;
      for (const f of [0, -0.5, 0.5, -1, 1]) {
        const x = cx + f * room - w / 2, up = { x, y: a[1] - LABEL_GAP - LABEL_H, w, h: LABEL_H }, down = { x, y: a[1] + LABEL_GAP, w, h: LABEL_H };
        spots.push(...(below ? [down, up] : [up, down]));
      }
    } else if (a[0] === b[0] && len >= LABEL_H + 12) {
      const room = (len - LABEL_H - 12) / 2, cy = (a[1] + b[1]) / 2;
      for (const f of [0, -0.5, 0.5, -1, 1]) {
        const y = cy + f * room - LABEL_H / 2;
        spots.push({ x: a[0] + LABEL_GAP, y, w, h: LABEL_H }, { x: a[0] - LABEL_GAP - w, y, w, h: LABEL_H });
      }
    }
  }
  const free = (r: Rect) => !blocked.some((o) => hit(r, o));
  return spots.find((r) => free(r) && !lines.some((l) => hit(r, l))) ?? spots.find(free) ?? null;
}

/**
 * What a note marker keeps off: every run, 3px either side, and the 22px notation end at both sides of the
 * connector, as wide as its crow's foot, diamond or arrowhead.
 */
export function markerObstacles(pts: Pt[]): Rect[] {
  if (pts.length < 2) return [];
  const end = (a: Pt, b: Pt): Rect => {
    const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
    return inflate(segBox(a, [a[0] + dx * 22, a[1] + dy * 22]), 8);
  };
  return [...segs(pts).map(([a, b]) => inflate(segBox(a, b), 3)), end(pts[0] as Pt, pts[1] as Pt), end(pts[pts.length - 1] as Pt, pts[pts.length - 2] as Pt)];
}

/** Thin boxes around every run, for label placement. */
export function runBoxes(pts: Pt[]): Rect[] {
  return segs(pts).map(([a, b]) => inflate(segBox(a, b), 1));
}
