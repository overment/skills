// Quadrant: items placed on a 2×2 of two judgements (effort × impact). Quadrants are selectable groups of their items.
// The quadrant cells only take clicks on their names, so a click on empty plot space clears the selection.
import {
  BUDGET, SpecError, type BlockModule, type DataTable, type DocModel, type ElementInfo, type RawBlock, type ReadingSpec, type RenderContext,
} from "../types.ts";
import {
  READING_KEYS, factList, fmt, groupInfo, idFrom, isObj, itemInfo, list, mark, notes, num, number, readingSpec, svgFigure, text, textWidth,
  wrap, type Frame,
} from "../kit.ts";
import { textBoxes } from "./boxes.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

interface QuadrantAxis { low: string; high: string; title?: string }

interface QuadrantCell { id: string; label: string; named: boolean; about?: string }

interface QuadrantPoint {
  id: string;
  label: string;
  x: number; // 0 = low, 1 = high
  y: number;
  q: number; // quadrant index: 0 TL, 1 TR, 2 BL, 3 BR
  about?: string;
  focal: boolean;
  muted: boolean;
}

interface QuadrantBlock extends ReadingSpec {
  type: "quadrant";
  id: string;
  title?: string;
  line: number;
  x: QuadrantAxis;
  y: QuadrantAxis;
  cells: QuadrantCell[]; // TL, TR, BL, BR
  points: QuadrantPoint[];
}

interface Box { x: number; y: number; w: number; h: number }

const WIDTH = 960;
const PLOT_H = 440;
const DOT = 6;
const INSET = 12;
const LABEL_GAP = 8; // dot edge to label: clears the selection ring (3px gap, 2px ring, its bg underlay)
const BOLD = 1.05; // axis titles and quadrant names are sans at 600, a little wider than the 400 estimate
const MAX_ITEMS = 12;
const POINT_KEYS = ["id", "label", "x", "y", "about", "focal", "muted"];
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
const CORNER_AT: [number, number][] = [[0, 1], [1, 1], [0, 0], [1, 0]];
const NEAR = 0.08; // positions closer than this on an axis read as "similar"
const NEIGHBOURS = 3;

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

function axisOf(v: unknown, what: string, line: number): QuadrantAxis {
  const m = requireMap(v, what, line);
  allowKeys(m, ["low", "high", "title"], what, line);
  return { low: labelOf(m.low, `${what} low`, line), high: labelOf(m.high, `${what} high`, line), title: optString(m, "title", what, line) };
}

function unitOf(v: unknown, what: string, axis: QuadrantAxis, line: number): number {
  const n = number(v, what, line);
  if (n < 0 || n > 1) throw new SpecError(`${what} must be between 0 (${axis.low}) and 1 (${axis.high}); got ${n}.`, line);
  return n;
}

function pointsOf(v: unknown, where: string, line: number): { label: string; fields: Fields; where: string }[] {
  if (Array.isArray(v)) {
    return v.map((it, i) => {
      const iw = `${where} data ${i + 1}`;
      if (!isObj(it)) throw new SpecError(`${iw} must be a map: { label, x, y, about }.`, line);
      allowKeys(it, POINT_KEYS, iw, line);
      return { label: labelOf(it.label, `${iw} label`, line), fields: it, where: iw };
    });
  }
  if (isObj(v)) {
    return Object.entries(v).map(([k, it]) => {
      const iw = `${where} data "${k}"`;
      if (Array.isArray(it)) {
        if (it.length !== 2) throw new SpecError(`${iw} must be [x, y].`, line);
        return { label: k, fields: { x: it[0], y: it[1] }, where: iw };
      }
      if (isObj(it)) {
        allowKeys(it, POINT_KEYS.filter((key) => key !== "label"), iw, line);
        return { label: k, fields: it, where: iw };
      }
      throw new SpecError(`${iw} must be [x, y] or { x, y, about }.`, line);
    });
  }
  throw new SpecError(`${where} needs \`data\`: a list of { label, x, y, about }.`, line);
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function normalize(raw: RawBlock, ctx: RenderContext): QuadrantBlock {
  const line = raw.line;
  const data = requireMap(raw.data, "quadrant", line);
  allowKeys(data, ["id", "title", "x", "y", "quadrants", "data", ...READING_KEYS], "quadrant", line);
  const id = requireString(data, "id", "quadrant", line);
  const where = `quadrant "${id}"`;
  const x = axisOf(data.x, `${where} x`, line);
  const y = axisOf(data.y, `${where} y`, line);

  // quadrants: 4 names, or 4 { label, about } maps, in the order top-left, top-right, bottom-left, bottom-right
  let named: { label: string; about?: string }[] | undefined;
  if (data.quadrants !== undefined) {
    named = list(data.quadrants, `${where} quadrants`, line).map((q, i) => {
      const qw = `${where} quadrants item ${i + 1}`;
      if (typeof q === "string" || typeof q === "number") return { label: labelOf(q, qw, line) };
      if (!isObj(q)) throw new SpecError(`${qw} must be a name or { label, about }.`, line);
      allowKeys(q, ["label", "about"], qw, line);
      return { label: labelOf(q.label, `${qw} label`, line), about: optString(q, "about", qw, line) };
    });
    if (named.length !== 4) throw new SpecError(`${where} quadrants needs 4 labels in the order top-left, top-right, bottom-left, bottom-right; got ${named.length}.`, line);
  }
  const taken = new Set([id, `${id}-title`, `${id}-desc`]);
  const fallback = [`${y.high} · ${x.low}`, `${y.high} · ${x.high}`, `${y.low} · ${x.low}`, `${y.low} · ${x.high}`];
  const cells: QuadrantCell[] = CORNERS.map((corner, i) => ({
    id: idFrom(corner, taken, `${id}-`),
    label: named?.[i].label ?? fallback[i],
    named: named !== undefined,
    about: named?.[i].about,
  }));

  const points: QuadrantPoint[] = pointsOf(data.data, where, line).map(({ label, fields, where: iw }) => {
    const px = unitOf(fields.x, `${iw} x`, x, line);
    const py = unitOf(fields.y, `${iw} y`, y, line);
    return {
      id: claimId(optString(fields, "id", iw, line), label, taken, `${id}-`, where, line),
      label,
      x: px,
      y: py,
      q: (py >= 0.5 ? 0 : 2) + (px >= 0.5 ? 1 : 0),
      about: optString(fields, "about", iw, line),
      focal: optBool(fields, "focal", iw, line),
      muted: optBool(fields, "muted", iw, line),
    };
  });
  if (!points.length) throw new SpecError(`${where} needs at least one item in \`data\`.`, line);

  if (points.length > MAX_ITEMS) {
    ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} places ${points.length} items; above ${MAX_ITEMS} the labels collide. Keep the items the decision is about, or split the list by theme into two quadrants.` });
  }
  const focal = points.filter((p) => p.focal).length;
  if (focal > BUDGET.focal) {
    ctx.warn({ rule: "budget-focal", severity: "warn", line, message: `${where} marks ${focal} items focal; keep it to ${BUDGET.focal}.` });
  }
  const labels = points.map((p) => p.label);
  const dup = labels.find((l, i) => labels.indexOf(l) !== i);
  if (dup !== undefined) {
    ctx.warn({ rule: "label-duplicate", severity: "warn", line, message: `${where} lists "${dup}" twice; merge them or name them apart.` });
  }
  return { type: "quadrant", id, title: optString(data, "title", where, line), line, x, y, cells, points, ...readingSpec(data, line) };
}

function render(b: QuadrantBlock, ctx: RenderContext): string {
  const theme = ctx.theme;
  const pad = theme.grid.pad;
  const tag = theme.type.tag;
  const px = theme.type.nodeSub;
  const tagW = (s: string) => textWidth(s, tag, "sans");

  const left = pad + Math.max(tagW(b.y.low), tagW(b.y.high)) + 10;
  const top = pad + (b.y.title ? 22 : 6);
  const f: Box = { x: left, y: top, w: WIDTH - left - pad, h: PLOT_H };
  const midX = f.x + f.w / 2, midY = f.y + f.h / 2;

  // x axis row: low at the left end, high at the right end, title centered when it fits between them
  const tlh = Math.round(tag * 1.4), tcap = tag * 0.75;
  const rowY = f.y + f.h + 6 + tag * 0.8;
  const titleW = b.x.title ? tagW(b.x.title) * BOLD : 0;
  const inline = b.x.title !== undefined && Math.max(tagW(b.x.low), tagW(b.x.high)) + 16 < f.w / 2 - titleW / 2;
  const height = rowY + (b.x.title && !inline ? tlh : 0) + pad;

  const axes = [
    `<line class="x-axis-line" x1="${num(midX)}" y1="${num(f.y)}" x2="${num(midX)}" y2="${num(f.y + f.h)}"/>`,
    `<line class="x-axis-line" x1="${num(f.x)}" y1="${num(midY)}" x2="${num(f.x + f.w)}" y2="${num(midY)}"/>`,
    text(f.x - 10, f.y + tag * 0.75, b.y.high, "x-tick-label", "end"),
    text(f.x - 10, f.y + f.h, b.y.low, "x-tick-label", "end"),
    text(f.x, rowY, b.x.low, "x-tick-label"),
    text(f.x + f.w, rowY, b.x.high, "x-tick-label", "end"),
  ];
  // the dividers sit at 0.5 on both judgements
  axes.push(text(midX, f.y - 5, "0.5", "x-tick-label x-quadrant-divider", "middle"), text(f.x - 10, midY + tag * 0.35, "0.5", "x-tick-label x-quadrant-divider", "end"));
  if (b.y.title) axes.push(text(f.x, f.y - 10, b.y.title, "x-axis-label"));
  if (b.x.title) axes.push(text(midX, inline ? rowY : rowY + tlh, b.x.title, "x-axis-label", "middle"));

  // axis ends, titles and divider values keep point labels and note markers off them
  const obstacles: Box[] = textBoxes(axes.join(""), tag);
  // quadrant cells, corner labels kept as obstacles for the point labels
  const anchors: Record<string, Frame> = {};
  const cellMarks = b.cells.map((cell, qi) => {
    const right = qi % 2 === 1, low = qi >= 2;
    const c: Box = { x: right ? midX : f.x, y: low ? midY : f.y, w: f.w / 2, h: f.h / 2 };
    let label = "";
    if (cell.named) {
      const lines = wrap(cell.label, (c.w - 2 * INSET) / BOLD, tag, "sans");
      const h = (lines.length - 1) * tlh + tcap;
      const w = Math.max(...lines.map((l) => tagW(l) * BOLD));
      const ax = right ? c.x + c.w - INSET : c.x + INSET;
      const y0 = low ? c.y + c.h - INSET - h : c.y + INSET;
      obstacles.push({ x: right ? ax - w : ax, y: y0, w, h });
      anchors[cell.id] = { x: right ? ax - w : ax, y: y0, w, h };
      label = lines.map((l, k) => text(ax, y0 + tcap + k * tlh, l, "x-axis-label x-quadrant-label", right ? "end" : "start")).join("");
    }
    const members = b.points.filter((p) => p.q === qi).length;
    return mark({ id: cell.id, label: cell.label, value: `${members} ${members === 1 ? "item" : "items"}`, cls: "x-quadrant-cell", attrs: ` data-level="${qi === 0 || qi === 3 ? 1 : 0}"${cell.named ? ` data-named="true"` : ""}` },
      `<rect class="x-mark-shape" x="${num(c.x)}" y="${num(c.y)}" width="${num(c.w)}" height="${num(c.h)}"/>${label}`);
  });

  // point labels: try right, left, above, below; first clear spot wins, otherwise the least-covered one
  const pos = b.points.map((p) => ({ x: f.x + p.x * f.w, y: f.y + (1 - p.y) * f.h }));
  b.points.forEach((p, i) => { anchors[p.id] = { x: pos[i].x - DOT, y: pos[i].y - DOT, w: 2 * DOT, h: 2 * DOT }; });
  for (const p of pos) obstacles.push({ x: p.x - DOT - 1, y: p.y - DOT - 1, w: 2 * DOT + 2, h: 2 * DOT + 2 });
  const placed: { tx: number; ty: number; anchor: "start" | "middle" | "end" }[] = [];
  const byFocal = b.points.map((_, i) => i).sort((i, j) => Number(b.points[j].focal) - Number(b.points[i].focal) || i - j);
  for (const i of byFocal) {
    const { x, y } = pos[i];
    const w = textWidth(b.points[i].label, px, "sans"), h = px * 1.2, off = DOT + LABEL_GAP;
    const options: { box: Box; tx: number; anchor: "start" | "middle" | "end" }[] = [
      { box: { x: x + off, y: y - h / 2, w, h }, tx: x + off, anchor: "start" },
      { box: { x: x - off - w, y: y - h / 2, w, h }, tx: x - off, anchor: "end" },
      { box: { x: x - w / 2, y: y - off - h, w, h }, tx: x, anchor: "middle" },
      { box: { x: x - w / 2, y: y + off, w, h }, tx: x, anchor: "middle" },
    ];
    let best = options[0], cost = Infinity;
    for (const o of options) {
      const c = (o.box.w * o.box.h - overlapArea(o.box, f)) * 4 + obstacles.reduce((s, ob) => s + overlapArea(o.box, ob), 0);
      if (c < cost) { best = o; cost = c; }
      if (c < 0.5) break; // area arithmetic leaves float residue on a clear spot
    }
    if (cost >= 0.5) {
      ctx.warn({ rule: "label-fit", severity: "warn", line: b.line, message: `quadrant "${b.id}": label "${b.points[i].label}" overlaps a neighbour or the edge; nudge its x/y or shorten it.` });
    }
    obstacles.push(best.box);
    placed[i] = { tx: best.tx, ty: best.box.y + px * 0.95, anchor: best.anchor };
  }

  const paint = b.points.map((_, i) => i).sort((i, j) => Number(b.points[i].focal) - Number(b.points[j].focal) || i - j);
  const pointMarks = paint.map((i) => {
    const p = b.points[i], l = placed[i];
    return mark({ id: p.id, label: p.label, value: b.cells[p.q].label, focal: p.focal, cls: "x-point", attrs: p.muted ? ` data-muted="true"` : "" },
      `<circle class="x-mark-shape" cx="${num(pos[i].x)}" cy="${num(pos[i].y)}" r="${DOT}"/>${text(l.tx, l.ty, p.label, "x-mark-label", l.anchor)}`);
  });

  const xName = b.x.title ?? `${b.x.low} to ${b.x.high}`;
  const yName = b.y.title ?? `${b.y.low} to ${b.y.high}`;
  return svgFigure({
    id: b.id,
    kind: "quadrant",
    title: b.title,
    label: `${yName} against ${xName}`,
    desc: `${b.points.length} items placed by ${xName} (left to right) and ${yName} (bottom to top).`,
    width: WIDTH,
    height,
    body: `<g class="x-quadrant-cells">${cellMarks.join("")}</g><g class="x-axis">${axes.join("")}</g><g class="x-quadrant-points">${pointMarks.join("")}</g>` +
      notes(b, anchors, { obstacles, bounds: { x: 0, y: 0, w: WIDTH, h: height } }),
  });
}

/** "less effort, similar impact": where `q` sits relative to `p`, in the axes' own words. */
function relative(b: QuadrantBlock, p: QuadrantPoint, q: QuadrantPoint): string {
  const word = (axis: QuadrantAxis, d: number) => {
    const name = axis.title?.toLowerCase();
    if (Math.abs(d) < NEAR) return name ? `similar ${name}` : `level with it toward ${axis.high}`;
    if (name) return `${d < 0 ? "less" : "more"} ${name}`;
    return `toward ${d < 0 ? axis.low : axis.high}`;
  };
  return `${word(b.x, q.x - p.x)}, ${word(b.y, q.y - p.y)}`;
}

function model(b: QuadrantBlock): Partial<DocModel> {
  const elements: Record<string, ElementInfo> = {};
  const two = (v: number) => fmt(v, "2");
  const xName = b.x.title ?? "x", yName = b.y.title ?? "y";
  b.cells.forEach((cell, qi) => {
    const [cx, cy] = CORNER_AT[qi];
    const members = b.points.filter((p) => p.q === qi).sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy));
    elements[cell.id] = groupInfo({
      id: cell.id, label: cell.label, figure: b.id, kind: "quadrant", members: members.map((p) => p.id), about: cell.about,
      value: `${members.length} ${members.length === 1 ? "item" : "items"}`,
      pos: CORNERS[qi],
      links: [{ rel: "Items, most extreme first", ids: members.map((p) => p.id) }],
      say: `${cell.label}, ${members.length} ${members.length === 1 ? "item" : "items"}${members.length ? `: ${members.map((p) => p.label).join(", ")}` : ""}`,
    });
  });
  for (const p of b.points) {
    const cell = b.cells[p.q];
    const near = b.points.filter((q) => q !== p).sort((q, r) => Math.hypot(q.x - p.x, q.y - p.y) - Math.hypot(r.x - p.x, r.y - p.y)).slice(0, NEIGHBOURS);
    elements[p.id] = itemInfo({
      // both judgements are the value line; the quadrant is the eyebrow; the facts are the nearest items in the axes' words
      id: p.id, label: p.label, figure: b.id, kind: "point", about: p.about, related: [cell.id],
      value: `${xName} ${two(p.x)} · ${yName} ${two(p.y)}`,
      pos: cell.label,
      context: b.points.filter((q) => q !== p && q.q === p.q).map((q) => q.id),
      facts: factList(near.map((q) => ({ k: q.label, v: relative(b, p, q), ref: q.id }))),
      say: `${p.label}, ${cell.label}: ${xName.toLowerCase()} ${two(p.x)}, ${yName.toLowerCase()} ${two(p.y)}`,
    });
  }
  return { elements };
}

function reading(b: QuadrantBlock): string {
  const xName = b.x.title?.toLowerCase() ?? `${b.x.low} to ${b.x.high}`;
  const yName = b.y.title?.toLowerCase() ?? `${b.y.low} to ${b.y.high}`;
  const focal = b.points.filter((p) => p.focal).map((p) => p.label);
  return `Items are placed by ${xName} (left to right) and ${yName} (bottom to top); the lines at 0.5 split the four corners. Positions are judgements from 0 to 1, not measurements.` +
    (focal.length ? ` The accent marks ${joinList(focal)}.` : "");
}

function table(b: QuadrantBlock): DataTable {
  return {
    head: ["Item", b.x.title ?? "x", b.y.title ?? "y", "Quadrant"],
    rows: b.points.map((p) => [p.label, fmt(p.x, "2"), fmt(p.y, "2"), b.cells[p.q].label]),
  };
}

export const blockModule: BlockModule<QuadrantBlock> = { type: "quadrant", normalize, render, model, reading, table };
