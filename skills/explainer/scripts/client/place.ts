// Card placement: a pure, deterministic scorer. Every rect is in stage pixels (.x-stage, origin top-left),
// so a shot at a given width always yields the same card.

export interface Rect { x: number; y: number; w: number; h: number }
/** `group` ties the boxes of one element together (a connector is a string of small boxes). */
export interface Obstacle extends Rect { weight: number; kind?: "selected" | "related" | "label" | "mark"; group?: number }
export type Side = "right" | "left" | "below" | "above" | "gutter" | "free";
export type Mode = "float" | "dock-right" | "dock-below";

export interface PlaceInput {
  anchor: Rect;                     // the part the card points at
  subject?: Rect;                   // the whole selected element with its own labels; candidates also sit around it
  card: { w: number; h: number };
  stage: { w: number; h: number };
  plot?: Rect;                      // the svg or board inside the stage; the gutter candidate sits right of it
  plotMin?: number;                 // the narrowest the plot renders (its CSS min-width); a right dock may not squeeze it below that
  view?: { x: number; w: number };  // the viewport's horizontal span, in stage coordinates
  obstacles: Obstacle[];
  gap?: number;
  mobile?: boolean;                 // narrow viewport or stage: always dock below
}

export interface Placement {
  mode: Mode;
  side: Side;
  rect: Rect;                       // for dock-right, the card's box in the reserved gutter
  score: number;
  covers: { selected: number; related: number; labels: number }; // px² of the selection, the most-covered related element's share, labels hidden
}

/** Obstacle weights: a covered label loses information, so labels weigh more than shapes. */
export const WEIGHT = { selected: 100, related: 12, label: 3, mark: 1 } as const;
export const GAP = 12;
/** The card's gutter: this far right of the plot, on the 8px grid. */
export const GUTTER = 16;
/** A leader longer than this, or one that would cross a label, is left out: the ink ring already marks the anchor. */
export const LEADER_MAX = 160;
/** Stages wider than this dock the card in a right gutter; narrower ones dock it under the figure. */
export const DOCK_RIGHT_MIN = 720;
/** A floating card covers nothing the selection lights up; if it would, it docks. */
const RELATED_MAX = 0;
/** A floating card hides no label at all (other marks' names and values). */
const LABELS_MAX = 0;
/** A floating card stays this close to what it points at; farther than that it docks instead. */
const FLOAT_REACH = 64;
/** A floating card may hang this far out of the stage (over the prose around it) before it docks instead. */
const SPILL_MAX = 0.25;
/** Step of the free-space scan: open areas of the plot away from the anchor are candidates too. */
const GRID = 24;

export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Shortest distance between two rects; 0 when they touch or overlap. */
export function distance(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * 4 sides × 3 alignments around the anchor (and again around the subject when it is bigger), slid along
 * their side to stay in the stage, plus the gutter right of the plot.
 */
export function candidates(input: PlaceInput): (Rect & { side: Side })[] {
  const out = around(input, input.anchor);
  const sub = input.subject;
  const a = input.anchor;
  if (sub && (sub.x < a.x || sub.y < a.y || sub.x + sub.w > a.x + a.w || sub.y + sub.h > a.y + a.h)) out.push(...around(input, sub));
  const p = input.plot, gap = input.gap ?? GAP, { w, h } = input.card;
  if (p && p.x + p.w + gap + w <= input.stage.w) {
    out.push({ side: "gutter", x: p.x + p.w + gap, y: clamp(a.y + a.h / 2 - h / 2, 0, input.stage.h - h), w, h });
  }
  const { stage } = input;
  const near = [a, sub].filter((r): r is Rect => !!r);
  for (let y = 0; y <= Math.max(0, stage.h - h); y += GRID) {
    for (let x = 0; x <= stage.w - w; x += GRID) {
      const r = { x, y, w, h };
      if (near.some((n) => distance(r, n) <= FLOAT_REACH)) out.push({ side: "free", ...r });
    }
  }
  return out;
}

function around(input: PlaceInput, a: Rect): (Rect & { side: Side })[] {
  const { card: { w, h }, stage } = input;
  const gap = input.gap ?? GAP;
  const out: (Rect & { side: Side })[] = [];
  const alongY = [a.y, a.y + a.h / 2 - h / 2, a.y + a.h - h].map((y) => clamp(y, 0, stage.h - h));
  const alongX = [a.x, a.x + a.w / 2 - w / 2, a.x + a.w - w].map((x) => clamp(x, 0, stage.w - w));
  for (const y of alongY) out.push({ side: "right", x: a.x + a.w + gap, y, w, h });
  for (const y of alongY) out.push({ side: "left", x: a.x - gap - w, y, w, h });
  for (const x of alongX) out.push({ side: "below", x, y: a.y + a.h + gap, w, h });
  for (const x of alongX) out.push({ side: "above", x, y: a.y - gap - h, w, h });
  return out;
}

/** Related coverage is per element: hiding a third of one connector counts, however many other elements are lit. */
function coverage(r: Rect, obstacles: Obstacle[]): Placement["covers"] {
  let sel = 0, labels = 0;
  const rel = new Map<number | string, [number, number]>();
  obstacles.forEach((o, i) => {
    if (o.kind === "selected") sel += overlap(r, o);
    else if (o.kind === "related") {
      const key = o.group ?? `o${i}`;
      const [hit, area] = rel.get(key) ?? [0, 0];
      rel.set(key, [hit + overlap(r, o), area + o.w * o.h]);
    } else if (o.kind === "label") labels += overlap(r, o) / Math.max(1, o.w * o.h);
  });
  let related = 0;
  for (const [hit, area] of rel.values()) if (area) related = Math.max(related, hit / area);
  return { selected: sel, related, labels };
}

/**
 * Σ weight × the covered share of each obstacle + distance / 400 + 1000 off-stage or off-screen sideways +
 * up to 4 for spilling over the prose above or below. Hiding a whole label costs 3, a whole bar 1, any of the
 * selection up to 100, whatever the card's size.
 */
export function score(r: Rect, input: PlaceInput): number {
  const area = r.w * r.h || 1;
  let s = 0;
  for (const o of input.obstacles) {
    const hit = overlap(r, o);
    if (hit) s += (o.weight * hit) / Math.max(1, Math.min(o.w * o.h, area));
  }
  s += distance(r, input.anchor) / 400;
  const { stage, view } = input;
  if (r.x < 0 || r.x + r.w > stage.w) s += 1000;
  if (view && (r.x < view.x || r.x + r.w > view.x + view.w)) s += 1000;
  const inside = Math.max(0, Math.min(r.y + r.h, stage.h) - Math.max(r.y, 0));
  s += 4 * (1 - inside / (r.h || 1));
  return s;
}

/**
 * The column a docked card takes in the gutter: 16px right of the plot, as wide as the card, down the whole
 * stage (the card sits level with whatever it points at). Undefined when the stage has no room for it there.
 */
export function dockColumn(stage: { w: number; h: number }, plot: Rect | undefined, cardW: number): Rect | undefined {
  if (!plot || plot.x + plot.w + GUTTER + cardW > stage.w) return undefined;
  return { x: plot.x + plot.w + GUTTER, y: 0, w: cardW, h: stage.h };
}

/**
 * The gutter first: when the plot leaves room for the card 16px to its right, the card docks there, level
 * with the anchor. Otherwise the lowest-scoring spot within 64px of the anchor, unless it still covers any of
 * the selection, anything related or any label, or hangs more than a quarter out of the stage:
 * then the card docks, into a right gutter the stage reserves (only when the plot keeps its full width and
 * 70% of the stage), under the figure otherwise.
 */
export function place(input: PlaceInput): Placement {
  const { card, stage, anchor } = input;
  const none = { selected: 0, related: 0, labels: 0 };
  const dockBelow = (): Placement => ({
    mode: "dock-below", side: "below", rect: { x: 0, y: stage.h + GUTTER, w: stage.w, h: card.h }, score: 0, covers: none,
  });
  if (input.mobile) return dockBelow();
  const level = () => Math.round(clamp(anchor.y + anchor.h / 2 - card.h / 2, 0, stage.h - card.h) / 8) * 8;
  const dock = dockColumn(stage, input.plot, card.w);
  if (dock) return { mode: "dock-right", side: "gutter", rect: { x: dock.x, y: level(), w: card.w, h: card.h }, score: 0, covers: none };
  let best: (Rect & { side: Side }) | null = null, bestScore = Infinity;
  for (const c of candidates(input)) {
    const s = score(c, input);
    if (s < bestScore - 1e-9) { best = c; bestScore = s; }
  }
  if (best) {
    const covers = coverage(best, input.obstacles);
    const offside = best.x < 0 || best.x + best.w > stage.w;
    const inside = Math.max(0, Math.min(best.y + best.h, stage.h) - Math.max(best.y, 0));
    const spills = inside < best.h * (1 - SPILL_MAX);
    if (!offside && !spills && covers.selected === 0 && covers.related <= RELATED_MAX && covers.labels <= LABELS_MAX) {
      const { side, ...rect } = best;
      return { mode: "float", side, rect, score: bestScore, covers };
    }
  }
  // The right gutter shrinks the plot; below the figure is better than shrinking it by more than 30%
  // or past its minimum width (where it would scroll).
  const plotW = input.plot?.w ?? stage.w;
  const room = stage.w - card.w - GUTTER;
  if (stage.w > DOCK_RIGHT_MIN && room >= Math.max(plotW * 0.7, input.plotMin ?? 0)) {
    const x = input.plot ? Math.min(stage.w - card.w, input.plot.x + Math.min(input.plot.w, room) + GUTTER) : stage.w - card.w;
    return { mode: "dock-right", side: "gutter", rect: { x, y: level(), w: card.w, h: card.h }, score: bestScore, covers: none };
  }
  return dockBelow();
}

export interface Leader { x1: number; y1: number; x2: number; y2: number; length: number; caret: boolean }

/** Does the segment (x1,y1)→(x2,y2) pass through rect r? Liang–Barsky clipping. */
export function crosses(x1: number, y1: number, x2: number, y2: number, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - r.x], [dx, r.x + r.w - x1], [-dy, y1 - r.y], [dy, r.y + r.h - y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Line from the card's edge to the anchor; a caret when they are 16px apart or less. The nearest points win
 * unless the line would run through a label: then lines between the card's and the anchor's edge midpoints
 * are tried, fewest labels crossed first, shortest second.
 */
export function leader(card: Rect, anchor: Rect, labels: Rect[] = []): Leader {
  const near = (a0: number, a1: number, b0: number, b1: number): [number, number] => {
    if (a1 < b0) return [a1, b0];
    if (b1 < a0) return [a0, b1];
    const m = (Math.max(a0, b0) + Math.min(a1, b1)) / 2;
    return [m, m];
  };
  const [x1, x2] = near(card.x, card.x + card.w, anchor.x, anchor.x + anchor.w);
  const [y1, y2] = near(card.y, card.y + card.h, anchor.y, anchor.y + anchor.h);
  const make = (a: number, b: number, c: number, d: number): Leader => {
    const length = Math.hypot(c - a, d - b);
    return { x1: a, y1: b, x2: c, y2: d, length, caret: length <= 16 };
  };
  const first = make(x1, y1, x2, y2);
  const hits = (l: Leader) => labels.filter((r) => crosses(l.x1, l.y1, l.x2, l.y2, r)).length;
  if (first.caret || !labels.length || !hits(first)) return first;
  const mids = (r: Rect): [number, number][] => [
    [r.x, r.y + r.h / 2], [r.x + r.w, r.y + r.h / 2], [r.x + r.w / 2, r.y], [r.x + r.w / 2, r.y + r.h],
  ];
  const ends: [number, number][] = [[x2, y2], ...mids(anchor)];
  const tries = [first, ...mids(card).flatMap(([ex, ey]) => ends.map(([tx, ty]) => make(ex, ey, tx, ty)))];
  return tries.reduce((best, l) => {
    const d = hits(l) - hits(best);
    return d < 0 || (d === 0 && l.length < best.length) ? l : best;
  });
}

// ---------- annotation layer: every note's callout on the graph at once ----------

export interface CalloutItem {
  anchor: Rect;      // the note marker (or the target mark when the engine drew no marker)
  w: number;
  h: number;
  keep?: Rect[];     // the note's own targets: never covered
}

/** Clearance around every mark, label, connector and marker, and between callouts: one grid unit. */
const CALLOUT_CLEAR = 8;
const CALLOUT_STEP = 16;
/** Off the lanes, a callout farther than this from its marker and targets is left to the reading panel. */
const CALLOUT_REACH = 240;

/** How far a callout sits from what its note is about: the marker or the nearest of its targets. */
export function near(r: Rect, it: CalloutItem): number {
  return Math.min(distance(r, it.anchor), ...(it.keep ?? []).map((k) => distance(r, k)));
}

/** The rect a callout's leader should reach: whichever of the marker and the targets is closest. */
export function nearest(r: Rect, it: CalloutItem): Rect {
  return [it.anchor, ...(it.keep ?? [])].reduce((a, b) => (distance(r, b) < distance(r, a) ? b : a));
}

const grow = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

/**
 * Places the callouts one after another, in note order. A callout only goes where it covers nothing: no
 * obstacle (mark, label, connector, marker), no earlier callout and none of its note's targets, with 8px
 * clearance, inside the stage and on the 8px grid. Lanes come first: right of `plot`, then left of it, where
 * callouts share an x; then free space in the plot. Among clean spots the nearest to the marker or a target
 * wins (a lane spot counts at half its distance and may be any distance away, its number pairs it with the
 * marker; one aligned with an earlier callout gains a grid step). Null when nothing clean is within reach: the note then lives in the reading panel and its marker only.
 *
 * `dock` is the column a docked card takes (dockColumn): no callout goes there, since the card would hide it,
 * so the right lane moves past it, and a second lane opens under the plot, 16px below it, where callouts
 * sit side by side and then in rows. A spot in that lane may reach below the stage; the caller grows the stage
 * to hold it. Pure and deterministic, like place().
 */
export function placeCallouts(items: CalloutItem[], stage: { w: number; h: number }, obstacles: Obstacle[], plot?: Rect, dock?: Rect): (Rect | null)[] {
  const placed: Rect[] = [];
  const blocked = obstacles.map((o) => grow(o, CALLOUT_CLEAR));
  if (dock) blocked.push(grow({ ...dock, y: 0, h: Math.max(dock.y + dock.h, stage.h) + items.reduce((s, it) => s + it.h + GUTTER, 0) }, CALLOUT_CLEAR));
  const snap = (v: number) => Math.round(v / 8) * 8;
  const laneTop = plot && dock ? Math.ceil((plot.y + plot.h + GUTTER) / 8) * 8 : undefined;
  return items.map((it) => {
    const { anchor: a, w, h } = it;
    if (w > stage.w || (h > stage.h && laneTop === undefined)) return null;
    const xs = new Set<number>();
    for (let x = 0; x <= stage.w - w; x += CALLOUT_STEP) xs.add(x);
    const lanes: number[] = [];
    const edge = dock ? dock.x + dock.w : plot ? plot.x + plot.w : 0;
    if (plot && edge + GUTTER + w <= stage.w) lanes.push(snap(edge + GUTTER));
    if (plot && plot.x - GUTTER - w >= 0) lanes.push(snap(plot.x - GUTTER - w));
    for (const p of placed) xs.add(p.x);
    lanes.forEach((x) => xs.add(x));
    // the lane under the plot is as deep as every callout stacked, so there is always a row left in it
    const bottom = laneTop === undefined ? stage.h - h : Math.max(stage.h - h, laneTop + items.reduce((s, x) => s + x.h + GUTTER, 0));
    let best: Rect | null = null, bestScore = Infinity;
    for (let y = 0; y <= bottom; y += 8) {
      const under = laneTop !== undefined && y >= laneTop;
      if (y + h > stage.h && !under) continue;
      for (const x of xs) {
        const c = { x, y, w, h };
        if (x < 0 || x + w > stage.w) continue;
        if (overlap(c, grow(a, CALLOUT_CLEAR)) > 0 || (it.keep ?? []).some((k) => overlap(c, grow(k, CALLOUT_CLEAR)) > 0)) continue;
        if (placed.some((p) => overlap(c, grow(p, CALLOUT_CLEAR)) > 0) || blocked.some((o) => overlap(c, o) > 0)) continue;
        const d = near(c, it), lane = under || lanes.includes(x);
        if (d > CALLOUT_REACH && !lane) continue;
        const aligned = placed.some((p) => p.x === x || (under && p.y === y));
        const s = (lane ? d / 2 : d) - (aligned ? 8 : 0);
        if (s < bestScore - 1e-9) { best = c; bestScore = s; }
      }
    }
    if (best) placed.push(best);
    return best;
  });
}
