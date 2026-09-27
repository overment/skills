// Polar: one value per step of a cycle (weekdays, months, hours) as radial bars around a hole, clockwise from the top.
// A narrow gap at the top, where the cycle wraps, holds the spoke that carries the ring values, so no ring label sits on a bar.
import {
  BUDGET, SpecError, type BlockModule, type DataTable, type DocModel, type ElementInfo, type RawBlock, type ReadingSpec, type RenderContext,
} from "../types.ts";
import {
  NOTE_R, READING_KEYS, factList, fmtUnit, format, idFrom, isObj, itemInfo, linear, mark, niceTicks, notes, num, number, onSel, parseUnit, pct,
  rank, ratio, readingSpec, share, signed, svgFigure, text, textWidth, trend, wrap, type Format, type Frame,
} from "../kit.ts";
import { allowKeys, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

interface PolarItem { id: string; label: string; value: number; about?: string; focal: boolean; muted: boolean }

interface PolarBlock extends ReadingSpec {
  type: "polar";
  id: string;
  title?: string;
  line: number;
  format: Format;
  unit?: string;
  /** What one full turn is ("week", "year", "day"), for "24% of the week". */
  cycle?: string;
  max?: number;
  items: PolarItem[]; // cycle order, clockwise from the top
}

type Line = { t: string; cls: string };

const RADIUS = 170;
/** Left and right margin: the drawing starts at the column edge, and a selection ring (3px out, 2px wide) never clips. */
const EDGE = 8;
/** Note markers see each bar as tiles this size, so none lands on a bar. */
const TILE = 6;
const HOLE = 0.24;
const GAP = 12;
const LABEL_MAX = 120;
const SEAM_MAX = (24 * Math.PI) / 180; // widest gap the ring labels may claim before inner labels are dropped
const SOFT = 8;
const HARD = 12;
const ITEM_KEYS = ["id", "label", "value", "about", "focal", "muted"];
const SYMBOL_UNIT = /^[$€£¥%]$/;

function labelOf(v: unknown, what: string, line: number): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  throw new SpecError(`${what} must be text.`, line);
}

function claimId(explicit: string | undefined, label: string, taken: Set<string>, prefix: string, where: string, line: number): string {
  if (explicit === undefined) return idFrom(label, taken, prefix);
  if (taken.has(explicit)) throw new SpecError(`${where}: id "${explicit}" is used twice.`, line, "id-unique");
  taken.add(explicit);
  return explicit;
}

function niceMax(v: number): number {
  return v > 0 ? linear([0, v], [0, 1], { nice: true, count: 4 }).domain[1] : 1;
}

/** Lines of text just outside a circle; (dx, dy) is the outward direction, so labels grow away from the chart. */
function outside(x: number, y: number, dx: number, dy: number, lines: Line[], lh: number, cap: number, px: number): { svg: string; box: Frame } {
  const anchor = dx > 0.3 ? "start" : dx < -0.3 ? "end" : "middle";
  const h = (lines.length - 1) * lh + cap;
  const first = y - h / 2 + (dy * h) / 2 + cap;
  // measured at the 600 weight a selected label takes (about 8% wider), so it never grows past the crop
  const w = Math.max(...lines.map((l) => textWidth(l.t, px, "sans"))) * 1.08;
  const bx = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return { svg: lines.map((l, i) => text(x, first + i * lh, l.t, l.cls, anchor)).join(""), box: { x: bx, y: first - cap, w, h } };
}

/** Annular sector from angle a0 to a1 (radians, clockwise in SVG space). */
function sector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${num(cx + r * Math.cos(a))},${num(cy + r * Math.sin(a))}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)}A${num(r1)},${num(r1)} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${num(r0)},${num(r0)} 0 ${large} 0 ${p(r0, a0)}Z`;
}

function entriesOf(v: unknown, where: string, line: number): { label: string; fields: Fields; where: string }[] {
  if (Array.isArray(v)) {
    return v.map((it, i) => {
      const iw = `${where} data ${i + 1}`;
      if (!isObj(it)) throw new SpecError(`${iw} must be a map: { label, value, about }.`, line);
      allowKeys(it, ITEM_KEYS, iw, line);
      return { label: labelOf(it.label, `${iw} label`, line), fields: it, where: iw };
    });
  }
  if (isObj(v)) {
    return Object.entries(v).map(([k, it]) => {
      const iw = `${where} data "${k}"`;
      if (isObj(it)) {
        allowKeys(it, ITEM_KEYS.filter((key) => key !== "label"), iw, line);
        return { label: k, fields: it, where: iw };
      }
      return { label: k, fields: { value: it }, where: iw };
    });
  }
  throw new SpecError(`${where} needs \`data\`: a list of { label, value, about } or a map label: value.`, line);
}

const labeler = (b: PolarBlock) => (v: number) => fmtUnit(v, b.unit && SYMBOL_UNIT.test(b.unit) ? b.unit : undefined, b.format);
const signedPct = (v: number) => (v > 0 ? `+${pct(v)}` : pct(v));

/** Geometry shared by render and the tests: scale top, ring values, which rings carry a label, and the seam gap. */
export function polarLayout(b: PolarBlock, tag: number): { top: number; hole: number; rings: number[]; labelled: number[]; seam: number; radius: (v: number) => number } {
  const top = b.max ?? niceMax(Math.max(...b.items.map((i) => i.value)));
  const hole = Math.round(RADIUS * HOLE);
  const radius = (v: number) => hole + (Math.min(v, top) / top) * (RADIUS - hole);
  const rings = niceTicks(0, top, 4).filter((t) => t > 0 && t <= top);
  const f = labeler(b);
  // the gap a label needs at its ring: its half width (plus the halo) must fit between the spoke and the next bar
  const need = (t: number) => 2 * Math.asin(Math.min(1, (textWidth(f(t), tag, "mono") / 2 + 4) / radius(t)));
  const labelled: number[] = [];
  let seam = 0;
  for (const t of [...rings].reverse()) {
    const g = Math.max(seam, need(t));
    if (labelled.length && g > SEAM_MAX) break;
    labelled.unshift(t);
    seam = g;
  }
  return { top, hole, rings, labelled, seam, radius };
}

function normalize(raw: RawBlock, ctx: RenderContext): PolarBlock {
  const line = raw.line;
  const data = requireMap(raw.data, "polar", line);
  allowKeys(data, ["id", "title", "format", "unit", "cycle", "max", "data", ...READING_KEYS], "polar", line);
  const id = requireString(data, "id", "polar", line);
  const where = `polar "${id}"`;
  const taken = new Set([id, `${id}-title`, `${id}-desc`]);
  const items: PolarItem[] = entriesOf(data.data, where, line).map(({ label, fields, where: iw }) => {
    const value = number(fields.value, `${iw} value`, line);
    if (value < 0) throw new SpecError(`${iw} value is ${value}; radial bars start at 0. Use a bar chart for negative values.`, line);
    return {
      id: claimId(optString(fields, "id", iw, line), label, taken, `${id}-`, where, line),
      label,
      value,
      about: optString(fields, "about", iw, line),
      focal: optBool(fields, "focal", iw, line),
      muted: optBool(fields, "muted", iw, line),
    };
  });
  if (items.length < 3) throw new SpecError(`${where} needs at least 3 categories; got ${items.length}. With fewer, use a bar chart.`, line);

  const top = items.reduce((a, c) => (c.value > a.value ? c : a), items[0]);
  let max: number | undefined;
  if (data.max !== undefined) {
    max = number(data.max, `${where} max`, line);
    if (max <= 0) throw new SpecError(`${where} max must be above 0; got ${max}.`, line);
    if (max < top.value) throw new SpecError(`${where} max is ${max} but ${top.label} is ${top.value}; raise \`max\` or drop it.`, line);
  }

  const n = items.length;
  if (n > HARD) {
    ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} has ${n} categories; above ${HARD} the sectors turn into slivers. Group them (hours into 4-hour blocks, days into weeks) or use a line chart.` });
  } else if (n > SOFT) {
    ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} has ${n} categories; above ${SOFT} the labels crowd. Keep ${n} only when the cycle needs every step (months); otherwise group them.` });
  }
  const focal = items.filter((i) => i.focal).length;
  if (focal > BUDGET.focal) {
    ctx.warn({ rule: "budget-focal", severity: "warn", line, message: `${where} marks ${focal} categories focal; keep it to ${BUDGET.focal}.` });
  }
  const labels = items.map((i) => i.label);
  const dup = labels.find((l, i) => labels.indexOf(l) !== i);
  if (dup !== undefined) {
    ctx.warn({ rule: "label-duplicate", severity: "warn", line, message: `${where} lists "${dup}" twice; each step of the cycle needs its own label.` });
  }
  return {
    type: "polar", id, title: optString(data, "title", where, line), line, format: format(data.format, line), unit: parseUnit(data.unit, line),
    cycle: optString(data, "cycle", where, line), max, items, ...readingSpec(data, line),
  };
}

function render(b: PolarBlock, ctx: RenderContext): string {
  const theme = ctx.theme;
  const pad = theme.grid.pad;
  const px = theme.type.nodeSub;
  const tag = theme.type.tag;
  const lh = Math.round(Math.max(px, tag) * 1.35);
  const cap = px * 0.72;
  const n = b.items.length;
  const f = labeler(b);
  const { hole, rings, labelled, seam, radius } = polarLayout(b, tag);
  const step = (2 * Math.PI - seam) / n;
  const gap = step * 0.06;
  const start = -Math.PI / 2 + seam / 2;

  const labels: Line[][] = b.items.map((it) => [
    ...wrap(it.label, LABEL_MAX, px, "sans").map((t) => ({ t, cls: "x-mark-label" })),
    { t: f(it.value), cls: "x-value-label" },
  ]);
  const room = Math.max(...labels.map((l) => (l.length - 1) * lh + cap));
  const cy = pad + room + GAP + RADIUS;
  const height = cy + RADIUS + GAP + room + pad;
  const mean = b.items.reduce((a, c) => a + c.value, 0) / n;

  // Drawn around cx; `lo`/`hi` are the ink's horizontal ends (outer ring, labels, note markers).
  const draw = (cx: number) => {
    const grid = [
      ...rings.map((t) => `<circle class="x-grid-line x-polar-ring" cx="${num(cx)}" cy="${num(cy)}" r="${num(radius(t))}"/>`),
      `<circle class="x-axis-line x-polar-base" cx="${num(cx)}" cy="${num(cy)}" r="${num(hole)}"/>`,
      `<line class="x-grid-line x-polar-spoke" x1="${num(cx)}" y1="${num(cy - hole)}" x2="${num(cx)}" y2="${num(cy - RADIUS)}"/>`,
    ];

    // the mean ring, its value just left of the spoke (the first sector and its selection ring sit right of it); shown while a sector is selected
    const meanR = radius(mean);
    const meanRing = `<circle class="x-ref-rule x-sel-rule x-polar-mean" cx="${num(cx)}" cy="${num(cy)}" r="${num(meanR)}"/>` +
      text(cx - 5, cy - meanR + 3.5, `mean ${f(mean)}`, "x-tick-label x-polar-tick x-delta-label", "end");
    const anchors: Record<string, Frame> = {};
    const names: Frame[] = [];
    const bars: Frame[] = [];
    const marks = b.items.map((it, i) => {
      const a0 = start + i * step + gap;
      const a1 = start + (i + 1) * step - gap;
      const mid = (a0 + a1) / 2;
      const dx = Math.cos(mid), dy = Math.sin(mid);
      const r1 = Math.max(radius(it.value), hole + 1.5);
      const tip = { x: cx + dx * r1, y: cy + dy * r1 };
      anchors[it.id] = { x: tip.x - 4, y: tip.y - 4, w: 8, h: 8 };
      for (let r = hole + TILE / 2; r < r1; r += TILE) {
        for (let a = a0; a < a1; a += TILE / r) bars.push({ x: cx + r * Math.cos(a) - TILE / 2, y: cy + r * Math.sin(a) - TILE / 2, w: TILE, h: TILE });
      }
      const name = outside(cx + dx * (RADIUS + GAP), cy + dy * (RADIUS + GAP), dx, dy, labels[i], lh, cap, px);
      names.push(name.box);
      const shape = `<path class="x-mark-shape x-polar-bar" d="${sector(cx, cy, hole, r1, a0, a1)}"/>` +
        `<rect class="x-anchor" x="${num(tip.x - 1)}" y="${num(tip.y - 1)}" width="2" height="2"/>${name.svg}`;
      return mark({ id: it.id, label: it.label, value: f(it.value), focal: it.focal, cls: "x-polar-sector", attrs: `${it.muted ? ` data-muted="true"` : ""} data-nav="0,${i}"` }, shape + onSel(meanRing));
    });

    // ring values on the spoke in the seam; a label within 12px of the mean ring steps aside while the mean is shown
    const ticks = labelled.map((t) => {
      const near = Math.abs(radius(t) - meanR) < 12 ? ` data-near-mean="true"` : "";
      return text(cx, cy - radius(t) + 3.5, f(t), "x-tick-label x-polar-tick", "middle", near);
    });
    // a marker sits off every bar and label; it may sit on either side, and the crop keeps it
    const markers = notes(b, anchors, { obstacles: [...names, ...bars], bounds: { x: -1e4, y: 0, w: 2e4, h: height } });
    const xs = [
      cx - RADIUS, cx + RADIUS, ...names.flatMap((l) => [l.x, l.x + l.w]),
      ...[...markers.matchAll(/class="x-note-ring" cx="([-\d.]+)"/g)].flatMap((m) => [Number(m[1]) - NOTE_R, Number(m[1]) + NOTE_R]),
    ];
    const body = `<g class="x-polar-grid">${grid.join("")}</g>${marks.join("")}<g class="x-polar-ticks">${ticks.join("")}</g>${markers}`;
    return { body, lo: Math.min(...xs), hi: Math.max(...xs) };
  };

  // The drawing starts at the column edge, so a card docked beside it sits right next to the chart.
  const { body, hi } = draw(EDGE - draw(0).lo);
  const peak = b.items.reduce((a, c) => (c.value > a.value ? c : a), b.items[0]);

  return svgFigure({
    id: b.id,
    kind: "polar",
    title: b.title,
    label: `Radial bars from ${b.items[0].label} to ${b.items[n - 1].label}`,
    desc: `${n} categories from ${b.items[0].label} to ${b.items[n - 1].label}, clockwise from the top; the largest is ${peak.label} at ${f(peak.value)}.`,
    width: Math.ceil(hi + EDGE),
    height,
    body,
  });
}

function model(b: PolarBlock): Partial<DocModel> {
  const elements: Record<string, ElementInfo> = {};
  const f = labeler(b);
  const fu = (v: number) => fmtUnit(v, b.unit, b.format);
  const dv = (v: number) => signed(v, b.unit && SYMBOL_UNIT.test(b.unit) ? b.unit : undefined, b.format);
  const vals = b.items.map((it) => it.value);
  const total = vals.reduce((a, c) => a + c, 0), mean = total / vals.length;
  const byValue = [...b.items].sort((a, c) => c.value - a.value);
  const peak = byValue[0], runnerUp = byValue[1];
  const whole = b.cycle ? `the ${b.cycle}` : "the total";
  const vs = (it: PolarItem, o: PolarItem) =>
    ({ k: `vs ${o.label}`, v: `${dv(it.value - o.value)}${o.value ? ` (${signedPct(((it.value - o.value) / o.value) * 100)})` : ""}`, ref: o.id, tone: trend(it.value - o.value), raw: it.value - o.value });
  b.items.forEach((it, i) => {
    const r = rank(it.value, vals);
    const prev = b.items[(i - 1 + b.items.length) % b.items.length];
    const other = it === peak ? runnerUp : peak;
    elements[it.id] = itemInfo({
      id: it.id, label: it.label, figure: b.id, kind: "bar", value: fu(it.value), about: it.about, pos: r.text,
      facts: factList([
        { k: "rank", v: `#${r.text}`, raw: r.n },
        total > 0 && { k: "share", v: `${share(it.value, total)} of ${whole}`, raw: (it.value / total) * 100 },
        mean > 0 && { k: "vs mean", v: `${ratio(it.value, mean)} the mean (${f(mean)})`, raw: it.value / mean },
        other && vs(it, other),
        prev !== other && prev !== it && vs(it, prev),
      ]),
      say: `${it.label}, ${fu(it.value)}, ${r.nth}${total > 0 ? `, ${share(it.value, total)} of ${whole}` : ""}`,
    });
  });
  return { elements };
}

function reading(b: PolarBlock): string {
  const focal = b.items.filter((it) => it.focal).map((it) => it.label);
  return `Each wedge is one step of the ${b.cycle ?? "cycle"}, clockwise from ${b.items[0].label} at the top. Read a wedge's length from the inner ring, not its area; the ring values sit on the spoke in the gap at the top.` +
    (focal.length ? ` The accent marks ${focal.join(" and ")}.` : "");
}

function table(b: PolarBlock): DataTable {
  const f = labeler(b);
  const total = b.items.reduce((a, c) => a + c.value, 0);
  return {
    head: ["Step", b.unit ? `Value (${b.unit})` : "Value", "Share"],
    rows: b.items.map((it) => [it.label, f(it.value), share(it.value, total)]),
  };
}

export const blockModule: BlockModule<PolarBlock> = { type: "polar", normalize, render, model, reading, table };
