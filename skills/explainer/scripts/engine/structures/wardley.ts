// Wardley map: components placed by how visible they are to the user (y) and how evolved they are (x),
// joined by value-chain dependencies. Straight diagonal links are this type's grammar.
import { BUDGET, SpecError, type BlockModule, type DataTable, type Diagnostic, type ElementInfo, type Fact, type ReadingSpec, type Theme } from "../types.ts";
import {
  READING_KEYS, arrowDefs, groupInfo, idFrom, isObj, list, mark, notes, num, number, onSel, plotFrame, rank, readingSpec, svgFigure, text, textWidth,
  type Frame,
} from "../kit.ts";
import { allowKeys, esc, optBool, optString, requireMap, requireString } from "../blocks/util.ts";

interface Component {
  id: string; label: string; visibility: number; evolution: number; about?: string;
  focal: boolean; muted: boolean; inertia: boolean; moving?: number;
}
interface Dependency { id: string; from: string; to: string }

interface WardleyBlock extends ReadingSpec {
  type: "wardley";
  id: string;
  title?: string;
  line: number;
  components: Component[];
  links: Dependency[];
  stages: string[]; // one id per stage header, in STAGES order
}

type Pt = [number, number];
interface Rect { x: number; y: number; w: number; h: number }
type Anchor = "start" | "middle" | "end";
interface Spot { rect: Rect; anchor: Anchor; rank: number; dir: Pt; leader?: [Pt, Pt] }
interface Seg { id: string; a: Pt; b: Pt; ends: string[] }

const STAGES = ["Genesis", "Custom", "Product", "Commodity"] as const;
const R = 6;
const RIM = R + 2;            // link ends sit on this circle around the dot
const PORT = 3.5;             // minimum gap between two link ends at one dot
const MIN_ARC = 2 * Math.asin(PORT / (2 * RIM));
const BUNDLE = (4 * Math.PI) / 180;
const DOT_CLEAR = 3, LBL_CLEAR = 2, SEG_CLEAR = 3, NEAR = 6, LEADER = 32;
const G1 = R + 5, G2 = R + 14;
const MAX_COMPONENTS = 12, MAX_LINKS = 14, MAX_MOVES = 2, MAX_INERTIA = 2;
const WIDTH = 960, HEIGHT = 480;
/** With notes, the plot leaves this much of the figure free beside it: a 240px callout and a 16px gutter. */
const LANE = 256;

const stage = (e: number) => STAGES[Math.min(3, Math.floor(e * 4))];
const valueOf = (c: Component) => (c.moving === undefined ? stage(c.evolution) : `${stage(c.evolution)} → ${stage(c.moving)}`);
const deg = (r: number) => Math.round((r * 180) / Math.PI * 10) / 10;

// ---------- geometry ----------

const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function pointRectDist(p: Pt, r: Rect): number {
  return Math.hypot(Math.max(r.x - p[0], 0, p[0] - r.x - r.w), Math.max(r.y - p[1], 0, p[1] - r.y - r.h));
}

function segsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Distance between a segment and a rectangle; 0 when they touch or cross. */
function rectSegDist(r: Rect, a: Pt, b: Pt): number {
  const corners: Pt[] = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  if (!pointRectDist(a, r) || !pointRectDist(b, r)) return 0;
  for (let i = 0; i < 4; i++) if (segsCross(a, b, corners[i], corners[(i + 1) % 4])) return 0;
  return Math.min(pointRectDist(a, r), pointRectDist(b, r), ...corners.map((c) => pointSegDist(c, a, b)));
}

/**
 * Link ends around one dot, in angle order: ends closer than PORT on the rim are spread apart
 * symmetrically around their mean, so links that arrive together stay distinguishable.
 */
function spread(angles: number[]): number[] {
  const n = angles.length;
  if (n < 2) return angles;
  const order = angles.map((a, i) => i).sort((i, j) => angles[i] - angles[j] || i - j);
  const sorted = order.map((i) => angles[i]);
  if (n * MIN_ARC >= 2 * Math.PI - MIN_ARC) {
    const out = new Array<number>(n);
    order.forEach((i, k) => { out[i] = sorted[0] + (k * 2 * Math.PI) / n; });
    return out;
  }
  // cut the circle at its widest gap, so clusters never straddle the seam
  let cut = n - 1, widest = sorted[0] + 2 * Math.PI - sorted[n - 1];
  for (let k = 0; k < n - 1; k++) if (sorted[k + 1] - sorted[k] > widest) { widest = sorted[k + 1] - sorted[k]; cut = k; }
  const seq = Array.from({ length: n }, (_, k) => {
    const s = (cut + 1 + k) % n;
    return sorted[s] + (s <= cut ? 2 * Math.PI : 0);
  });
  let clusters = seq.map((a) => ({ members: [a], center: a }));
  const pos = (c: { members: number[]; center: number }) => c.members.map((_, j) => c.center + (j - (c.members.length - 1) / 2) * MIN_ARC);
  for (let merged = true; merged;) {
    merged = false;
    for (let k = 0; k < clusters.length - 1; k++) {
      const a = clusters[k], b = clusters[k + 1];
      if (pos(a).at(-1)! + MIN_ARC > pos(b)[0] + 1e-9) {
        const members = [...a.members, ...b.members];
        clusters.splice(k, 2, { members, center: members.reduce((s, x) => s + x, 0) / members.length });
        merged = true;
        break;
      }
    }
  }
  const spreadSeq = clusters.flatMap(pos);
  const out = new Array<number>(n);
  spreadSeq.forEach((a, k) => { out[order[(cut + 1 + k) % n]] = a; });
  return out;
}

// ---------- layout ----------

interface Layout {
  frame: Frame;
  X: (e: number) => number;
  pos: Map<string, Pt>;
  segs: Seg[];
  spots: Map<string, Spot>;
  trails: Map<string, { x1: number; x2: number; y: number; mx: number }>;
  bars: Map<string, number>;
  left: boolean;              // the callout lane sits left of the plot
  warnings: Diagnostic[];
}

/** How evolved the first note's target is: a component's evolution, a link's midpoint, a stage's middle. */
function noteEvolution(block: WardleyBlock): number | undefined {
  const evo = new Map(block.components.map((c) => [c.id, c.evolution]));
  const at = (id: string): number | undefined => {
    if (evo.has(id)) return evo.get(id);
    const l = block.links.find((x) => x.id === id);
    if (l) return ((evo.get(l.from) ?? 0) + (evo.get(l.to) ?? 0)) / 2;
    const s = block.stages.indexOf(id);
    return s >= 0 ? (s + 0.5) / 4 : undefined;
  };
  return block.notes?.[0]?.on.map(at).find((x) => x !== undefined);
}

function layout(block: WardleyBlock, theme: Theme): Layout {
  const px = theme.type.nodeSub;
  // Callouts need a lane that the card, docked right of the figure, doesn't cover: keep one inside the figure,
  // on the side of the first note (the focal fact), so its callout sits level with what it is about.
  const lane = block.notes?.length ? LANE : 0;
  const left = lane > 0 && (noteEvolution(block) ?? 1) < 0.5;
  const frame = plotFrame(WIDTH, HEIGHT, theme, { left: 76 + (left ? lane : 0), bottom: 52, top: theme.grid.pad, right: theme.grid.pad + (left ? 0 : lane) });
  const X = (e: number) => frame.x + e * frame.w;
  const Y = (v: number) => frame.y + (1 - v) * frame.h;
  const bottom = frame.y + frame.h;
  const pos = new Map<string, Pt>(block.components.map((c) => [c.id, [X(c.evolution), Y(c.visibility)]]));
  const byId = new Map(block.components.map((c) => [c.id, c]));
  const where = `wardley "${block.id}"`;
  const warnings: Diagnostic[] = [];
  const warn = (rule: string, message: string) => warnings.push({ rule, severity: "warn", message: `${where}: ${message}`, line: block.line });

  // movement trails and inertia bars sit on the dot's row
  const trails = new Map<string, { x1: number; x2: number; y: number; mx: number }>();
  const bars = new Map<string, number>();
  for (const c of block.components) {
    const [x, y] = pos.get(c.id)!;
    const dir = c.moving !== undefined && X(c.moving) < x ? -1 : 1;
    if (c.inertia) bars.set(c.id, x + dir * (R + 9));
    if (c.moving === undefined) continue;
    const mx = X(c.moving);
    const start = x + dir * (R + (c.inertia ? 16 : 3));
    const end = mx - dir * (R + 3);
    if ((end - start) * dir > 8) trails.set(c.id, { x1: start, x2: end, y, mx });
    else trails.set(c.id, { x1: x, x2: x, y, mx });
    for (let k = 1; k < 4; k++) {
      if (Math.abs(mx - X(k / 4)) < 3) {
        warn("move-boundary", `the ghost of "${c.label}" sits on the ${STAGES[k - 1]}|${STAGES[k]} boundary (${c.moving}), so its target stage is ambiguous; use ${(k / 4 - 0.05).toFixed(2)} or ${(k / 4 + 0.05).toFixed(2)}.`);
      }
    }
  }

  // ports: every link end gets its own spot on the dot's rim
  const ends = new Map<string, { link: number; end: 0 | 1; angle: number }[]>();
  block.links.forEach((l, i) => {
    const a = pos.get(l.from)!, b = pos.get(l.to)!;
    const t = Math.atan2(b[1] - a[1], b[0] - a[0]);
    ends.set(l.from, [...(ends.get(l.from) ?? []), { link: i, end: 0, angle: t }]);
    ends.set(l.to, [...(ends.get(l.to) ?? []), { link: i, end: 1, angle: Math.atan2(a[1] - b[1], a[0] - b[0]) }]);
  });
  const rim = block.links.map((): [Pt, Pt] => [[0, 0], [0, 0]]);
  for (const [id, list] of ends) {
    const c = byId.get(id)!, p = pos.get(id)!, trail = trails.get(id);
    const fixed = trail && trail.x1 !== trail.x2 ? [trail.x2 > p[0] ? 0 : Math.PI] : [];
    const angles = spread([...list.map((e) => e.angle), ...fixed]);
    list.forEach((e, k) => { rim[e.link][e.end] = [p[0] + RIM * Math.cos(angles[k]), p[1] + RIM * Math.sin(angles[k])]; });
    const sorted = [...list].sort((a, b) => a.angle - b.angle);
    for (let k = 0; k < sorted.length; k++) {
      const a = sorted[k], b = sorted[(k + 1) % sorted.length];
      if (a === b) continue;
      let gap = Math.abs(b.angle - a.angle);
      gap = Math.min(gap, 2 * Math.PI - gap);
      if (gap < BUNDLE && (sorted.length > 2 || k === 0)) {
        warn("link-bundle", `links "${block.links[a.link].id}" and "${block.links[b.link].id}" meet ${c.label} ${deg(gap)}° apart and read as one line; drop one if the value chain implies it, or nudge a component by 0.05.`);
      }
    }
  }
  const segs: Seg[] = block.links.map((l, i) => ({ id: l.id, a: rim[i][0], b: rim[i][1], ends: [l.from, l.to] }));

  for (const s of segs) {
    for (const c of block.components) {
      if (s.ends.includes(c.id)) continue;
      const d = pointSegDist(pos.get(c.id)!, s.a, s.b);
      if (d < R + NEAR) warn("link-near-dot", `link "${s.id}" passes ${Math.round(d)}px from the dot of "${c.label}", so it looks connected to it; nudge "${c.label}" by 0.05.`);
      const t = trails.get(c.id);
      if (t && pointSegDist([t.mx, t.y], s.a, s.b) < R + NEAR) warn("link-near-dot", `link "${s.id}" passes through the ghost of "${c.label}"; nudge "${c.label}" or its moving_to by 0.05.`);
    }
  }

  // ---------- labels: 24 anchored slots per dot, then leader slots, scored and improved in sweeps ----------
  const bounds = { x0: frame.x + 2, x1: frame.x + frame.w, y0: 4, y1: bottom - 2 };
  const ghosts = [...trails.values()].map((t): Pt => [t.mx, t.y]);
  const trailRects = [...trails.values()].filter((t) => t.x1 !== t.x2).map((t) => ({ x: Math.min(t.x1, t.x2), y: t.y - R - DOT_CLEAR, w: Math.abs(t.x2 - t.x1), h: 2 * (R + DOT_CLEAR) }));
  const barRects = [...bars.entries()].map(([id, bx]) => inflate({ x: bx - 3, y: pos.get(id)![1] - 10, w: 6, h: 20 }, DOT_CLEAR));
  const rules = [0.25, 0.5, 0.75].map(X);
  const h = px * 1.25;

  const candidates = (c: Component): Spot[] => {
    const [x, y] = pos.get(c.id)!;
    const w = textWidth(c.label, px, "sans") * 1.08 * (c.focal ? 1.06 : 1);
    const out: Spot[] = [];
    [G1, G2].forEach((g, ring) => {
      const d = 0.7 * g;
      const slots: [number, number, Anchor, Pt][] = [
        [x + g, y - h / 2, "start", [1, 0]],
        [x - g - w, y - h / 2, "end", [-1, 0]],
        [x - w / 2, y - g - h, "middle", [0, -1]],
        [x - w / 2, y + g, "middle", [0, 1]],
        [x + d, y - d - h, "start", [0.7, -0.7]],
        [x + d, y + d, "start", [0.7, 0.7]],
        [x - d - w, y - d - h, "end", [-0.7, -0.7]],
        [x - d - w, y + d, "end", [-0.7, 0.7]],
        [x + R - w, y - g - h, "end", [-0.45, -0.9]],
        [x - R, y - g - h, "start", [0.45, -0.9]],
        [x + R - w, y + g, "end", [-0.45, 0.9]],
        [x - R, y + g, "start", [0.45, 0.9]],
      ];
      slots.forEach(([sx, sy, anchor, dir], k) => out.push({ rect: { x: sx, y: sy, w, h }, anchor, rank: k + ring * 20, dir }));
    });
    for (let k = 0; k < 8; k++) {
      const t = (k * Math.PI) / 4, ux = Math.cos(t), uy = Math.sin(t);
      const qx = x + LEADER * ux, qy = y + LEADER * uy;
      const anchor: Anchor = ux > 0.3 ? "start" : ux < -0.3 ? "end" : "middle";
      const rx = anchor === "start" ? qx : anchor === "end" ? qx - w : qx - w / 2;
      const ry = uy > 0.3 ? qy : uy < -0.3 ? qy - h : qy - h / 2;
      const rect = { x: rx, y: ry, w, h };
      const near: Pt = [Math.max(rect.x, Math.min(x, rect.x + w)), Math.max(rect.y, Math.min(y, rect.y + h))];
      out.push({ rect, anchor, rank: 60 + k, dir: [ux, uy], leader: [[x + RIM * ux, y + RIM * uy], near] });
    }
    return out;
  };

  const own = new Map(block.components.map((c) => [c.id, segs.filter((s) => s.ends.includes(c.id))]));
  const bias = new Map(block.components.map((c) => {
    const p = pos.get(c.id)!;
    let sx = 0, sy = 0;
    for (const s of own.get(c.id)!) {
      const q = pos.get(s.ends[0] === c.id ? s.ends[1] : s.ends[0])!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      sx += (q[0] - p[0]) / len;
      sy += (q[1] - p[1]) / len;
    }
    const len = Math.hypot(sx, sy);
    return [c.id, len ? [sx / len, sy / len] as Pt : [0, 0] as Pt];
  }));

  const placed = new Map<string, Spot>();
  const cost = (c: Component, s: Spot): number => {
    const r = s.rect;
    let total = s.rank;
    if (r.x < bounds.x0 || r.x + r.w > bounds.x1 || r.y < bounds.y0 || r.y + r.h > bounds.y1) total += 1e6;
    for (const o of block.components) {
      if (pointRectDist(pos.get(o.id)!, r) < R + 2 + (o.id === c.id ? LBL_CLEAR : DOT_CLEAR)) total += 1e5;
    }
    for (const g of ghosts) if (pointRectDist(g, r) < R + 2 + DOT_CLEAR) total += 1e5;
    for (const t of [...trailRects, ...barRects]) if (overlaps(r, t)) total += 600;
    for (const seg of segs) {
      const d = rectSegDist(r, seg.a, seg.b);
      if (d < SEG_CLEAR) total += seg.ends.includes(c.id) ? 1000 : 300;
      else if (d < NEAR) total += (NEAR - d) * 15;
    }
    for (const x of rules) if (x > r.x - LBL_CLEAR && x < r.x + r.w + LBL_CLEAR) total += 40;
    const b = bias.get(c.id)!;
    total += 10 * Math.max(0, s.dir[0] * b[0] + s.dir[1] * b[1]);
    for (const [id, o] of placed) {
      if (id === c.id) continue;
      if (overlaps(inflate(r, LBL_CLEAR), o.rect)) total += 1e5;
      if (o.leader && rectSegDist(r, ...o.leader) < SEG_CLEAR) total += 300;
      if (s.leader && rectSegDist(o.rect, ...s.leader) < SEG_CLEAR) total += 300;
    }
    if (s.leader) {
      for (const o of block.components) {
        if (o.id !== c.id && pointSegDist(pos.get(o.id)!, ...s.leader) < R + 2 + LBL_CLEAR) total += 300;
      }
      for (const seg of segs) if (segsCross(s.leader[0], s.leader[1], seg.a, seg.b)) total += 50;
    }
    return total;
  };
  const best = (c: Component, options: Spot[]): { spot: Spot; score: number } => {
    let spot = options[0], score = Infinity;
    for (const o of options) {
      const v = cost(c, o);
      if (v < score) { spot = o; score = v; }
    }
    return { spot, score };
  };

  const crowd = (c: Component) => {
    const p = pos.get(c.id)!;
    return block.components.filter((o) => o !== c && Math.hypot(pos.get(o.id)![0] - p[0], pos.get(o.id)![1] - p[1]) < 120).length;
  };
  const order = block.components
    .map((c, i) => ({ c, i, deg: own.get(c.id)!.length, crowd: crowd(c) }))
    .sort((a, b) => b.deg - a.deg || b.crowd - a.crowd || a.i - b.i)
    .map((o) => o.c);
  const options = new Map(block.components.map((c) => [c.id, candidates(c)]));
  for (const c of order) placed.set(c.id, best(c, options.get(c.id)!).spot);
  for (let sweep = 0; sweep < 3; sweep++) {
    let changed = false;
    for (const c of order) {
      const current = cost(c, placed.get(c.id)!);
      const next = best(c, options.get(c.id)!);
      if (next.score < current - 1e-9) {
        placed.set(c.id, next.spot);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const c of block.components) {
    const s = placed.get(c.id)!, r = s.rect;
    const crossed = segs.filter((seg) => rectSegDist(r, seg.a, seg.b) < LBL_CLEAR).map((seg) => seg.id);
    const hitDot = block.components.some((o) => pointRectDist(pos.get(o.id)!, r) < R + 1 + LBL_CLEAR) || ghosts.some((g) => pointRectDist(g, r) < R + 1 + LBL_CLEAR);
    const hitLabel = [...placed].some(([id, o]) => id !== c.id && overlaps(r, o.rect));
    const out = r.x < bounds.x0 || r.x + r.w > bounds.x1 || r.y < bounds.y0 || r.y + r.h > bounds.y1;
    if (crossed.length) warn("label-fit", `label "${c.label}" is crossed by ${crossed.join(", ")}; nudge "${c.label}" by 0.05 in visibility or evolution.`);
    else if (hitDot || hitLabel || out) warn("label-fit", `label "${c.label}" has no clear spot next to its dot; nudge "${c.label}" by 0.05 in visibility or evolution.`);
  }

  return { frame, X, pos, segs, spots: placed, trails, bars, left, warnings };
}

// ---------- value chain ----------

function chain(block: WardleyBlock) {
  const needs = new Map(block.components.map((c) => [c.id, [] as string[]]));
  const neededBy = new Map(block.components.map((c) => [c.id, [] as string[]]));
  for (const l of block.links) {
    needs.get(l.from)!.push(l.to);
    neededBy.get(l.to)!.push(l.from);
  }
  /** Everything that needs `id`, directly or through others, and the links between them. */
  const upward = (id: string): { nodes: string[]; links: string[] } => {
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length) for (const up of neededBy.get(queue.shift()!)!) if (!seen.has(up)) { seen.add(up); queue.push(up); }
    return {
      nodes: [...seen].filter((n) => n !== id),
      links: block.links.filter((l) => seen.has(l.from) && seen.has(l.to)).map((l) => l.id),
    };
  };
  /** Shortest route up the chain to a component nothing else needs (the user need). */
  const toUser = (id: string): string[] | undefined => {
    const parent = new Map<string, string>([[id, id]]);
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur !== id && !neededBy.get(cur)!.length) {
        const path: string[] = [];
        for (let n = cur; n !== id; n = parent.get(n)!) path.unshift(n);
        return path;
      }
      for (const up of neededBy.get(cur)!) if (!parent.has(up)) { parent.set(up, cur); queue.push(up); }
    }
    return undefined;
  };
  return { needs, neededBy, upward, toUser };
}

/** Notes and story steps may only point at this block's own elements. */
function checkRefs(spec: ReadingSpec, known: Set<string>, where: string, line: number): void {
  const refs = [...(spec.notes ?? []).flatMap((n) => n.on), ...(spec.story ?? []).flatMap((s) => (s.cmp ? [s.sel, s.cmp] : [s.sel]))];
  const missing = refs.find((id) => !known.has(id));
  if (missing) throw new SpecError(`${where}: notes or story point at "${missing}", which is not an element of this block.`, line, "ref-exists");
}

export const blockModule: BlockModule<WardleyBlock> = {
  type: "wardley",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "wardley", line);
    allowKeys(data, ["id", "title", "components", "links", ...READING_KEYS], "wardley", line);
    const id = requireString(data, "id", "wardley", line);
    const where = `wardley "${id}"`;
    const unit = (v: unknown, what: string): number => {
      if (v === undefined) throw new SpecError(`${what} is required: a number from 0 to 1.`, line);
      const n = number(v, what, line);
      if (n < 0 || n > 1) throw new SpecError(`${what} must be between 0 and 1, got ${n}.`, line);
      return n;
    };

    const taken = new Set<string>();
    const fields = list(data.components, `${where} components`, line).map((c, i) => {
      const cw = `${where} component ${i + 1}`;
      if (!isObj(c)) throw new SpecError(`${cw} must be a map: { id, label, visibility, evolution }.`, line);
      allowKeys(c, ["id", "label", "visibility", "evolution", "about", "focal", "muted", "moving_to", "inertia"], cw, line);
      const given = optString(c, "id", cw, line);
      if (given) {
        if (taken.has(given)) throw new SpecError(`${where}: component id "${given}" is used twice.`, line, "id-unique");
        taken.add(given);
      }
      return {
        given,
        label: requireString(c, "label", cw, line),
        visibility: unit(c.visibility, `${cw} visibility`),
        evolution: unit(c.evolution, `${cw} evolution`),
        about: optString(c, "about", cw, line),
        focal: optBool(c, "focal", cw, line),
        muted: optBool(c, "muted", cw, line),
        inertia: optBool(c, "inertia", cw, line),
        moving: c.moving_to === undefined ? undefined : unit(c.moving_to, `${cw} moving_to`),
      };
    });
    if (!fields.length) throw new SpecError(`${where} needs at least one component.`, line);
    const stages = STAGES.map((s) => idFrom(`stage ${s}`, taken, `${id}-`));
    const components: Component[] = fields.map(({ given, ...rest }) => ({ id: given ?? idFrom(rest.label, taken, `${id}-`), ...rest }));

    const find = (ref: string) => components.find((c) => c.id === ref) ?? components.find((c) => c.label === ref);
    const count = new Map<string, number>();
    const links: Dependency[] = (data.links === undefined ? [] : list(data.links, `${where} links`, line)).map((v, i) => {
      const lw = `${where} link ${i + 1}`;
      let spec: string | undefined;
      if (typeof v === "string") spec = v;
      else if (isObj(v) && Object.keys(v).length === 1 && v[Object.keys(v)[0]] == null) spec = Object.keys(v)[0];
      const m = spec === undefined ? null : /^\s*(.+?)\s*->\s*(.+?)\s*$/.exec(spec);
      if (!m) throw new SpecError(`${lw} must read "a -> b" (a needs b); value-chain links carry no label.`, line);
      const [from, to] = [m[1], m[2]].map((ref) => {
        const c = find(ref);
        if (!c) throw new SpecError(`${lw} "${spec}" points at "${ref}", which is not a component id or label.`, line, "ref-exists");
        return c.id;
      });
      if (from === to) throw new SpecError(`${lw} "${spec}" links a component to itself; drop it.`, line);
      const base = `${from}->${to}`;
      const n = (count.get(base) ?? 0) + 1;
      count.set(base, n);
      return { id: n === 1 ? base : `${base}#${n}`, from, to };
    });

    const warn = (rule: string, message: string) => ctx.warn({ rule, severity: "warn", message: `${where} ${message}`, line });
    if (components.length > MAX_COMPONENTS) {
      warn("budget-nodes", `has ${components.length} components; keep it to ${MAX_COMPONENTS}. Fold commodity parts (hosting, storage, network) into one, or map each user need separately.`);
    }
    if (links.length > MAX_LINKS) {
      warn("budget-edges", `has ${links.length} links; keep it to ${MAX_LINKS}. Keep only the dependencies the argument uses.`);
    }
    const moves = components.filter((c) => c.moving !== undefined).length;
    if (moves > MAX_MOVES) warn("budget-focal", `moves ${moves} components; show movement only for the ${MAX_MOVES} the decision is about.`);
    const inert = components.filter((c) => c.inertia).length;
    if (inert > MAX_INERTIA) warn("budget-focal", `marks ${inert} components with inertia; keep it to the ${MAX_INERTIA} the argument is about.`);
    const focal = components.filter((c) => c.focal).length;
    if (focal > BUDGET.focal) warn("budget-focal", `marks ${focal} components focal; keep it to ${BUDGET.focal}.`);
    for (const c of components) {
      if (c.moving !== undefined && c.moving < c.evolution) {
        warn("move-left", `component "${c.label}" moves left (moving_to ${c.moving} < evolution ${c.evolution}); parts only evolve toward commodity, so check the numbers.`);
      }
    }
    // a link the rest of the chain already implies adds a line and says nothing new
    for (const l of links) {
      const parent = new Map<string, string>([[l.from, l.from]]);
      const queue = [l.from];
      while (queue.length && !parent.has(l.to)) {
        const cur = queue.shift()!;
        for (const o of links) {
          if (o === l || o.from !== cur || parent.has(o.to)) continue;
          parent.set(o.to, cur);
          queue.push(o.to);
        }
      }
      if (!parent.has(l.to)) continue;
      const path = [l.to];
      for (let n = l.to; n !== l.from;) path.unshift((n = parent.get(n)!));
      warn("link-implied", `link "${l.id}" is implied by ${path.join(" -> ")}; drop it, the value chain already says it.`);
    }
    const reading = readingSpec(data, line);
    checkRefs(reading, new Set([...stages, ...components.map((c) => c.id), ...links.map((l) => l.id)]), where, line);
    return { type: "wardley", id, title: optString(data, "title", where, line), line, components, links, stages, ...reading };
  },

  render(block, ctx) {
    const { theme } = ctx;
    const tag = theme.type.tag;
    const L = layout(block, theme);
    L.warnings.forEach((d) => ctx.warn(d));
    const { frame, X, pos } = L;
    const bottom = frame.y + frame.h;

    // stage rules stop short of any label they would run through
    const rects = [...L.spots.values()].map((s) => inflate(s.rect, LBL_CLEAR));
    const rules = [0.25, 0.5, 0.75].map((q) => {
      const x = X(q);
      const gaps = rects.filter((r) => x > r.x && x < r.x + r.w).sort((a, b) => a.y - b.y);
      const runs: [number, number][] = [];
      let y = frame.y;
      for (const r of gaps) {
        if (r.y > y) runs.push([y, r.y]);
        y = Math.max(y, r.y + r.h);
      }
      if (y < bottom) runs.push([y, bottom]);
      return runs.map(([a, b]) => `<line class="x-wardley-rule" x1="${num(x)}" y1="${num(a)}" x2="${num(x)}" y2="${num(b)}"/>`).join("");
    });
    const axes = rules.join("") +
      `<g class="x-axis"><line class="x-axis-line" x1="${num(frame.x)}" y1="${num(frame.y)}" x2="${num(frame.x)}" y2="${num(bottom)}"/>` +
      `<line class="x-axis-line" x1="${num(frame.x)}" y1="${num(bottom)}" x2="${num(frame.x + frame.w)}" y2="${num(bottom)}"/>` +
      text(frame.x - 8, frame.y + tag * 0.7, "Visible", "x-axis-label", "end") +
      text(frame.x - 8, bottom, "Invisible", "x-axis-label", "end") +
      text(frame.x + frame.w, bottom + 44, "Evolution →", "x-axis-label", "end") + `</g>`;

    const stages = STAGES.map((s, i) => {
      const x0 = X(i / 4), x1 = X((i + 1) / 4), hy = bottom + 6, hh = 20;
      const band = onSel(`<rect class="x-wardley-band" x="${num(x0)}" y="${num(frame.y)}" width="${num(x1 - x0)}" height="${num(frame.h)}"/>`);
      return mark({ id: block.stages[i], label: `${s} stage`, cls: "x-wardley-stage" }, band +
        `<rect class="x-mark-shape" x="${num(x0 + 4)}" y="${num(hy)}" width="${num(x1 - x0 - 8)}" height="${hh}" rx="${num(theme.radius)}"/>` +
        text((x0 + x1) / 2, hy + hh / 2 + tag * 0.35, s, "x-wardley-stage-label", "middle"));
    });

    const links = L.segs.map((s) => {
      const d = `M${num(s.a[0])},${num(s.a[1])} L${num(s.b[0])},${num(s.b[1])}`;
      const [from, to] = s.ends;
      return `<g class="x-edge" data-id="${esc(s.id)}" data-from="${esc(from)}" data-to="${esc(to)}" data-kind="flow"><path class="x-edge-line" d="${d}"/><path class="x-edge-hit" d="${d}"/></g>`;
    });

    const comps = block.components.map((c) => {
      const [x, y] = pos.get(c.id)!, spot = L.spots.get(c.id)!, r = spot.rect;
      let extra = "";
      const t = L.trails.get(c.id);
      if (t) {
        if (t.x1 !== t.x2) {
          const d = `M${num(t.x1)},${num(y)} L${num(t.x2)},${num(y)}`;
          extra += `<path class="x-wardley-casing" d="${d}"/><path class="x-wardley-move" d="${d}" marker-end="url(#${esc(block.id)}-arrow)"/>`;
        }
        extra += `<circle class="x-wardley-ghost" cx="${num(t.mx)}" cy="${num(y)}" r="${R}"/>`;
      }
      const bx = L.bars.get(c.id);
      if (bx !== undefined) extra += `<line class="x-wardley-inertia" x1="${num(bx)}" y1="${num(y - 10)}" x2="${num(bx)}" y2="${num(y + 10)}"/>`;
      if (spot.leader) {
        const [a, b] = spot.leader;
        extra += `<line class="x-wardley-leader" x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"/>`;
      }
      const tx = spot.anchor === "start" ? r.x : spot.anchor === "end" ? r.x + r.w : r.x + r.w / 2;
      const shape = `${extra}<circle class="x-mark-shape" cx="${num(x)}" cy="${num(y)}" r="${R}"/>` + text(tx, r.y + r.h * 0.78, c.label, "x-mark-label", spot.anchor);
      const attrs = (c.muted ? ` data-muted="true"` : "") + (c.inertia ? ` data-inertia="true"` : "");
      return mark({ id: c.id, label: c.label, value: valueOf(c), focal: c.focal, cls: "x-wardley-comp", attrs }, shape);
    });

    const anchors: Record<string, Frame> = {};
    for (const c of block.components) {
      const [x, y] = pos.get(c.id)!;
      anchors[c.id] = { x: x - R, y: y - R, w: 2 * R, h: 2 * R };
    }
    for (const s of L.segs) {
      const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2;
      anchors[s.id] = { x: mx - 2, y: my - 2, w: 4, h: 4 };
    }
    block.stages.forEach((sid, i) => { anchors[sid] = { x: X(i / 4) + 4, y: bottom + 6, w: X((i + 1) / 4) - X(i / 4) - 8, h: 20 }; });
    // Links, label leaders and movement trails: a marker never sits on a line.
    const lines: [Pt, Pt][] = [
      ...L.segs.map((s): [Pt, Pt] => [s.a, s.b]),
      ...[...L.spots.values()].flatMap((s) => (s.leader ? [s.leader] : [])),
      ...[...L.trails.values()].map((t): [Pt, Pt] => [[t.x1, t.y], [t.mx, t.y]]),
    ];
    const lineBoxes = lines.flatMap(([a, b]) => {
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
      return Array.from({ length: n + 1 }, (_, k) => ({ x: a[0] + ((b[0] - a[0]) * k) / n - 3, y: a[1] + ((b[1] - a[1]) * k) / n - 3, w: 6, h: 6 }));
    });
    const markers = notes(block, anchors, {
      obstacles: [...[...L.spots.values()].map((s) => s.rect), ...Object.entries(anchors).filter(([k]) => pos.has(k)).map(([, f]) => f), ...lineBoxes],
      bounds: { x: 0, y: 0, w: WIDTH, h: HEIGHT },
    });

    // A left lane is empty in the bare view (no notes there), so the page slides it out of the column.
    const figure = svgFigure({
      id: block.id,
      kind: "wardley",
      title: block.title,
      label: "Wardley map",
      desc: `${block.components.length} components placed by how visible they are to the user and how evolved they are, from genesis to commodity.`,
      width: WIDTH,
      height: HEIGHT,
      defs: arrowDefs(block.id),
      body: axes + stages.join("") + links.join("") + comps.join("") + markers,
    });
    return L.left ? figure.replace(`data-layout="wardley"`, `data-layout="wardley" data-lane="left"`) : figure;
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const byId = new Map(block.components.map((c) => [c.id, c]));
    const label = (id: string) => byId.get(id)!.label;
    const { needs, neededBy, upward, toUser } = chain(block);
    const stageId = (e: number) => block.stages[STAGES.indexOf(stage(e))];
    const vis = block.components.map((c) => c.visibility);
    const names = (ids: string[]) => ids.map(label).join(", ");

    for (const c of block.components) {
      const up = upward(c.id);
      const path = toUser(c.id);
      const r = rank(c.visibility, vis);
      const facts: Fact[] = [];
      if (c.moving !== undefined) facts.push({ k: "Moving", v: `${stage(c.evolution)} → ${stage(c.moving)}`, ref: stageId(c.moving) });
      if (!neededBy.get(c.id)!.length) facts.push({ k: "Role", v: needs.get(c.id)!.length ? "user need: the anchor of the chain" : "nothing needs it yet" });
      else if (path) facts.push({ k: "Path to user", v: path.map(label).join(" → ") });
      facts.push({ k: "Visibility", v: `${c.visibility.toFixed(2)} · ${r.nth}` });
      facts.push({ k: "Evolution", v: `${c.evolution.toFixed(2)} · ${stage(c.evolution)}`, ref: stageId(c.evolution) });
      if (c.inertia) facts.push({ k: "Inertia", v: "resists moving" });
      const direct = new Set([...needs.get(c.id)!, ...neededBy.get(c.id)!]);
      const info: ElementInfo = { id: c.id, type: "node", label: c.label, kind: "component", figure: block.id, value: valueOf(c) + (c.inertia ? " · inertia" : "") };
      if (c.about) info.about = c.about;
      info.facts = facts.slice(0, 5);
      info.links = [{ rel: "Needs", ids: needs.get(c.id)! }, { rel: "Needed by", ids: neededBy.get(c.id)! }].filter((l) => l.ids.length);
      const context = [...up.nodes.filter((n) => !direct.has(n)), ...up.links, stageId(c.evolution)];
      if (context.length) info.context = context;
      info.say = [
        `${c.label}, ${valueOf(c)}`,
        neededBy.get(c.id)!.length ? `needed by ${names(neededBy.get(c.id)!)}` : "",
        needs.get(c.id)!.length ? `needs ${names(needs.get(c.id)!)}` : "",
      ].filter(Boolean).join(", ");
      elements[c.id] = info;
    }
    for (const l of block.links) {
      const a = byId.get(l.from)!, b = byId.get(l.to)!;
      const up = upward(l.from);
      const info: ElementInfo = { id: l.id, type: "edge", label: `${a.label} needs ${b.label}`, from: l.from, to: l.to, kind: "flow", figure: block.id };
      info.facts = [{ k: "Stages", v: `${stage(a.evolution)} → ${stage(b.evolution)}` }];
      const context = [...up.nodes, ...up.links];
      if (context.length) info.context = context;
      info.say = `${a.label} needs ${b.label}`;
      elements[l.id] = info;
    }
    STAGES.forEach((s, i) => {
      const members = block.components.filter((c) => stage(c.evolution) === s).map((c) => c.id);
      const arriving = block.components.filter((c) => c.moving !== undefined && stage(c.moving) === s && stage(c.evolution) !== s);
      const facts: Fact[] = [{ k: "Components", v: String(members.length) }, ...arriving.map((c) => ({ k: "Moving in", v: c.label, ref: c.id }))];
      elements[block.stages[i]] = groupInfo({
        id: block.stages[i], label: s, figure: block.id, kind: "stage", members,
        facts, links: [{ rel: "Components", ids: members }],
        context: arriving.map((c) => c.id),
        pos: `${i + 1} of 4`,
        say: `${s} stage, ${members.length ? names(members) : "no components"}`,
      });
    });
    return { elements };
  },

  reading() {
    return "Height is how visible a part is to the user, from the user need at the top to deep infrastructure at the bottom. Left to right is how evolved it is, from Genesis (built from scratch) to Commodity (bought as a utility). A line means the upper part needs the lower one; a dashed arrow shows where a part is moving.";
  },

  table(block): DataTable {
    const label = new Map(block.components.map((c) => [c.id, c.label]));
    return {
      head: ["Component", "Visibility", "Evolution", "Stage", "Needs"],
      rows: block.components.map((c) => [
        c.label, c.visibility.toFixed(2), c.evolution.toFixed(2), valueOf(c) + (c.inertia ? " · inertia" : ""),
        block.links.filter((l) => l.from === c.id).map((l) => label.get(l.to)!).join(", "),
      ]),
    };
  },
};
