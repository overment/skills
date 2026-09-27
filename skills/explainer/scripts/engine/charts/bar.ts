// Bar chart: one series sorted by value, or several series side by side or stacked. Zero baseline, labels at the bar ends.
import {
  BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type MarkStat, type ReadingSpec, type RenderContext,
  type ScaleSpec, type Theme,
} from "../types.ts";
import {
  READING_KEYS, SCALE_KEYS, axisX, axisY, band, esc, factList, fmtUnit, format as readFormat, groupInfo, idFrom, isObj, itemInfo,
  legend, linear, list, mark, markValue, notes, num, number, onSel, rank, ratio, readingSpec, refBand, refLine, scaleSpec,
  seriesSlot, share, signed, svgFigure, text, textWidth, trend, wrap, type Format, type Frame, type Linear,
} from "../kit.ts";
import { textBoxes } from "./boxes.ts";
import { markInk } from "./ink.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

type Orient = "horizontal" | "vertical";

interface BarItem { id: string; label: string; value: number; about?: string; focal: boolean; muted: boolean }
interface BarCell { id: string; category: string; value: number }
interface BarSeries { id: string; label: string; cells: BarCell[]; about?: string; focal: boolean; muted: boolean }

interface BarBlock extends ReadingSpec, ScaleSpec {
  type: "bar";
  id: string;
  title?: string;
  line: number;
  orient: Orient;
  stack: boolean;
  sort: "value" | "none";
  format: Format;
  axis?: string;
  /** Single series in display order; empty when `series` is used. */
  items: BarItem[];
  /** Multi series: category labels in display order, one entry per series. */
  categories: string[];
  series: BarSeries[];
}

const WIDTH = 960;
const PLOT_H = 280;
const GAP = 3;
const REF_ROOM = 16; // headroom above the plot for reference-line labels
const KEYS = ["id", "title", "format", "orient", "stack", "sort", "axis", "data", "categories", "series", ...READING_KEYS, ...SCALE_KEYS];
const ITEM_KEYS = ["id", "label", "value", "about", "focal", "muted"];
const SERIES_KEYS = ["id", "label", "values", "about", "focal", "muted"];
const SYMBOL_UNIT = /^[$€£¥%]$/;

// ---------- parsing ----------

function labelOf(f: Fields, where: string, line: number): string {
  return typeof f.label === "number" ? String(f.label) : requireString(f, "label", where, line);
}

/** `data` as a list of maps, or the `label: value` shorthand. */
function readItems(v: unknown, where: string, line: number): Fields[] {
  if (isObj(v)) return Object.entries(v).map(([label, val]) => (isObj(val) ? { label, ...val } : { label, value: val }));
  return list(v, `${where} data`, line).map((it, i) => {
    if (!isObj(it)) throw new SpecError(`${where} data item ${i + 1} must be a map: { label, value }.`, line);
    return it;
  });
}

/** Explicit ids are kept as written and must be unique in the block. */
function reserveIds(rows: Fields[], taken: Set<string>, where: string, line: number): void {
  for (const r of rows) {
    if (r.id === undefined) continue;
    if (typeof r.id !== "string" || !r.id.trim()) throw new SpecError(`${where}: an item id must be text.`, line);
    if (taken.has(r.id)) throw new SpecError(`${where}: id "${r.id}" is used twice.`, line, "id-unique");
    taken.add(r.id);
  }
}

function oneOf<T extends string>(f: Fields, key: string, allowed: readonly T[], where: string, line: number): T | undefined {
  const v = optString(f, key, where, line);
  if (v === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(v)) throw new SpecError(`${where}: ${key} must be ${allowed.join(" or ")}, got "${v}".`, line);
  return v as T;
}

function readValues(v: unknown, cats: string[], where: string, line: number): (number | undefined)[] {
  if (Array.isArray(v)) {
    if (v.length !== cats.length) {
      throw new SpecError(`${where} has ${v.length} values for ${cats.length} categories; give one per category (null for a gap).`, line);
    }
    return v.map((x, i) => (x === null ? undefined : number(x, `${where} value for "${cats[i]}"`, line)));
  }
  if (isObj(v)) {
    for (const k of Object.keys(v)) {
      if (!cats.includes(k)) throw new SpecError(`${where}: "${k}" is not a category; use one of ${cats.join(", ")}.`, line, "ref-exists");
    }
    return cats.map((c) => (v[c] === undefined || v[c] === null ? undefined : number(v[c], `${where} value for "${c}"`, line)));
  }
  throw new SpecError(`${where} needs \`values\`: a list aligned with \`categories\`, or a map category → value.`, line);
}

function checkFocal(n: number, where: string, line: number, ctx: RenderContext): void {
  if (n > BUDGET.focal) {
    ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${n} focal; keep it to ${BUDGET.focal} so the accent still points somewhere.`, line });
  }
}

/** Bars have one numeric axis, so `{x: …}` and `{y: …}` both mean it. Values are numbers, mean or median; never dates. */
function checkScale(spec: ScaleSpec, where: string, line: number): void {
  for (const m of spec.marks ?? []) {
    if (typeof m.at === "string" && m.at !== "mean" && m.at !== "median") throw new SpecError(`${where}: marks value "${m.at}" must be a number, mean or median.`, line);
  }
  for (const bd of spec.bands ?? []) {
    if (typeof bd.from !== "number" || typeof bd.to !== "number") throw new SpecError(`${where}: bands need numbers in \`from\` and \`to\`.`, line);
  }
}

// ---------- formatting ----------

/** Labels on the chart carry symbol units ($, %); word units ("signups") live in the axis title and the card. */
function symbolUnit(unit?: string): string | undefined {
  return unit && SYMBOL_UNIT.test(unit) ? unit : undefined;
}

/** "Signups, last 90 days" → "signups, last 90 days"; acronyms stay as written. */
function lowerFirst(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

const sum = (xs: number[]) => xs.reduce((a, c) => a + c, 0);

// ---------- geometry ----------

interface Seg { id: string; label: string; value: number; si: number; slot?: number; focal: boolean; muted: boolean; v0: number; v1: number }
interface Row { label: string; segs: Seg[]; total: number; posEnd: number; negEnd: number }

/** One row per category; stacked segments carry their running start/end (positives up, negatives down). */
function rowsOf(b: BarBlock, theme: Theme): Row[] {
  const base: { label: string; segs: Omit<Seg, "v0" | "v1">[] }[] = b.series.length
    ? b.categories.map((c) => ({
        label: c,
        segs: b.series.flatMap((s, si) => {
          const cell = s.cells.find((x) => x.category === c);
          return cell ? [{ id: cell.id, label: `${c}, ${s.label}`, value: cell.value, si, slot: seriesSlot(si, theme), focal: s.focal, muted: s.muted }] : [];
        }),
      }))
    : b.items.map((it) => ({ label: it.label, segs: [{ id: it.id, label: it.label, value: it.value, si: 0, focal: it.focal, muted: it.muted }] }));
  return base.map((r) => {
    let pos = 0, neg = 0;
    const segs = r.segs.map((s): Seg => {
      if (!b.stack) return { ...s, v0: 0, v1: s.value };
      const v0 = s.value >= 0 ? pos : neg;
      if (s.value >= 0) pos += s.value; else neg += s.value;
      return { ...s, v0, v1: v0 + s.value };
    });
    return { label: r.label, segs, total: pos + neg, posEnd: pos, negEnd: neg };
  });
}

/** The values `mean` and `median` marks stand on: the bars, the category totals when stacked, every cell when grouped. */
function statValues(b: BarBlock): number[] {
  if (b.items.length) return b.items.map((it) => it.value);
  if (b.stack) return b.categories.map((c) => sum(b.series.flatMap((s) => s.cells.filter((x) => x.category === c).map((x) => x.value))));
  return b.series.flatMap((s) => s.cells.map((c) => c.value));
}

interface Box { svg: string; x: number; y: number; w: number; h: number }

/** Rect between values a and b on the value axis, starting at c with thickness t on the category axis. */
function barRect(horizontal: boolean, s: Linear, a: number, b: number, c: number, t: number): Box {
  const p = Math.min(s(a), s(b)), q = Math.abs(s(b) - s(a));
  const [x, y, w, h] = horizontal ? [p, c, q, t] : [c, p, t, q];
  return { svg: `<rect class="x-mark-shape" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"/>`, x, y, w, h };
}

interface EndPos { x: number; y: number; anchor: "start" | "middle" | "end" }

/** Where a value label goes just past a bar end: right/left of it when horizontal, above/below when vertical. */
function endPos(horizontal: boolean, s: Linear, end: number, positive: boolean, mid: number, tag: number): EndPos {
  if (horizontal) return { x: s(end) + (positive ? 6 : -6), y: mid + tag * 0.35, anchor: positive ? "start" : "end" };
  return { x: mid, y: positive ? s(end) - 6 : s(end) + 6 + tag * 0.8, anchor: "middle" };
}

function endText(p: EndPos, content: string, cls = "x-value-label"): string {
  return text(p.x, p.y, content, cls, p.anchor);
}

function endBox(p: EndPos, content: string, tag: number): Frame {
  const w = textWidth(content, tag, "sans");
  return { x: p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2, y: p.y - tag * 0.8, w, h: tag };
}

/** Value label centred inside a stacked segment, or nothing when it does not fit. */
function inside(horizontal: boolean, r: Box, content: string, tag: number): string {
  const w = textWidth(content, tag, "sans");
  const fits = horizontal ? r.w >= w + 8 && r.h >= tag + 4 : r.h >= tag + 6 && r.w >= w + 6;
  return fits ? text(r.x + r.w / 2, r.y + r.h / 2 + tag * 0.35, content, "x-value-label x-on-fill", "middle") : "";
}

/** The card and note markers point at the value end of a bar, not its middle. */
function anchorAt(horizontal: boolean, r: Box, positive: boolean): string {
  const [x, y, w, h] = horizontal
    ? [positive ? r.x + r.w - 1 : r.x - 1, r.y, 2, r.h]
    : [r.x, positive ? r.y - 1 : r.y + r.h - 1, r.w, 2];
  return `<rect class="x-anchor" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"/>`;
}

/** Hairline across the plot at the selected bar's value; shown only while that bar is selected. */
function selRule(horizontal: boolean, s: Linear, v: number, plot: Frame): string {
  const p = s(v);
  return horizontal
    ? `<line class="x-ref-rule x-sel-rule" x1="${num(p)}" y1="${num(plot.y)}" x2="${num(p)}" y2="${num(plot.y + plot.h)}"/>`
    : `<line class="x-ref-rule x-sel-rule" x1="${num(plot.x)}" y1="${num(p)}" x2="${num(plot.x + plot.w)}" y2="${num(p)}"/>`;
}

/** Authored `bands:` (behind the bars) and `marks:` (over them) on the value axis. */
function references(b: BarBlock, s: Linear, plot: Frame, horizontal: boolean, f: (v: number) => string, tag: number): { back: string; front: string } {
  const [r0, r1] = s.range;
  const clamp = (v: number) => Math.min(Math.max(r0, r1), Math.max(Math.min(r0, r1), s(v)));
  const values = statValues(b);
  const back = (b.bands ?? []).map((bd) => {
    const span: [number, number] = [clamp(bd.from as number), clamp(bd.to as number)];
    return refBand(plot, horizontal ? { x: span } : { y: span }, bd.label, { px: tag });
  }).join("");
  const front = (b.marks ?? []).map((m) => {
    const v = markValue(m.at as number | MarkStat, values);
    const label = m.label ?? (typeof m.at === "string" ? `${m.at} ${f(v)}` : f(v));
    return refLine(plot, horizontal ? { x: clamp(v) } : { y: clamp(v) }, label, { px: tag });
  }).join("");
  return { back, front };
}

/** Carry a series' focal/muted flag onto its legend item so the swatch matches the marks. */
function flagLegend(svg: string, series: BarSeries[]): string {
  let out = svg;
  for (const s of series) {
    const flag = s.focal ? ` data-focal="true"` : s.muted ? ` data-muted="true"` : "";
    if (flag) out = out.replace(`data-id="${esc(s.id)}"`, `data-id="${esc(s.id)}"${flag}`);
  }
  return out;
}

function union(frames: Frame[]): Frame {
  const x = Math.min(...frames.map((f) => f.x)), y = Math.min(...frames.map((f) => f.y));
  return { x, y, w: Math.max(...frames.map((f) => f.x + f.w)) - x, h: Math.max(...frames.map((f) => f.y + f.h)) - y };
}

// ---------- module ----------

export const blockModule: BlockModule<BarBlock> = {
  type: "bar",

  normalize(raw, ctx) {
    const line = raw.line;
    const d = requireMap(raw.data, "bar", line);
    allowKeys(d, KEYS, "bar", line);
    const id = requireString(d, "id", "bar", line);
    const where = `bar "${id}"`;
    const scale = scaleSpec(d, line);
    checkScale(scale, where, line);
    const base = {
      type: "bar" as const,
      id,
      title: optString(d, "title", where, line),
      line,
      format: readFormat(d.format, line),
      axis: optString(d, "axis", where, line),
      ...readingSpec(d, line),
      ...scale,
    };
    const orient = oneOf(d, "orient", ["horizontal", "vertical"] as const, where, line);
    const sort = oneOf(d, "sort", ["value", "none"] as const, where, line);
    const stack = optBool(d, "stack", where, line);
    const single = d.data !== undefined;
    if (single === (d.series !== undefined || d.categories !== undefined)) {
      throw new SpecError(`${where} needs either \`data\` (one series) or \`categories\` + \`series\` (several), not ${single ? "both" : "neither"}.`, line);
    }
    // the figure's <title> and <desc> ids are taken too, so a bar labelled "Title" can't collide with them
    const taken = new Set([id, `${id}-title`, `${id}-desc`]);

    if (single) {
      if (stack) ctx.warn({ rule: "spec", severity: "warn", message: `${where}: \`stack\` only applies to \`categories\` + \`series\`; it is ignored for \`data\`.`, line });
      const fields = readItems(d.data, where, line);
      if (!fields.length) throw new SpecError(`${where}: \`data\` is empty; give at least one { label, value }.`, line);
      reserveIds(fields, taken, where, line);
      let items: BarItem[] = fields.map((f, i) => {
        const iw = `${where} item ${i + 1}`;
        allowKeys(f, ITEM_KEYS, iw, line);
        const label = labelOf(f, iw, line);
        return {
          id: typeof f.id === "string" ? f.id : idFrom(label, taken, `${id}-`),
          label,
          value: number(f.value, `${iw} value`, line),
          about: optString(f, "about", iw, line),
          focal: optBool(f, "focal", iw, line),
          muted: optBool(f, "muted", iw, line),
        };
      });
      const order = sort ?? "value";
      if (order === "value") items = [...items].sort((a, b) => b.value - a.value);
      if (items.length > 12) {
        ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${items.length} bars; keep 12 or fewer. Show the top 11 and fold the rest into one "Other" bar, or split it into two charts.`, line });
      }
      checkFocal(items.filter((it) => it.focal).length, where, line, ctx);
      const long = items.some((it) => it.label.length > 12);
      return { ...base, orient: orient ?? (items.length > 6 || long ? "horizontal" : "vertical"), stack: false, sort: order, items, categories: [], series: [] };
    }

    const cats = list(d.categories, `${where} categories`, line).map((c, i) => {
      if (typeof c !== "string" && typeof c !== "number") throw new SpecError(`${where} category ${i + 1} must be text.`, line);
      return String(c);
    });
    if (!cats.length) throw new SpecError(`${where}: \`categories\` is empty.`, line);
    if (new Set(cats).size !== cats.length) throw new SpecError(`${where}: every category must be listed once.`, line);
    const fields = list(d.series, `${where} series`, line).map((f, i) => {
      if (!isObj(f)) throw new SpecError(`${where} series ${i + 1} must be a map: { label, values }.`, line);
      return f;
    });
    if (!fields.length) throw new SpecError(`${where}: \`series\` is empty; give at least one { label, values }.`, line);
    reserveIds(fields, taken, where, line);
    const heads = fields.map((f, i) => {
      const sw = `${where} series ${i + 1}`;
      allowKeys(f, SERIES_KEYS, sw, line);
      const label = labelOf(f, sw, line);
      return { f, sw, label, sid: typeof f.id === "string" ? f.id : idFrom(label, taken, `${id}-`) };
    });
    const series: BarSeries[] = heads.map(({ f, sw, label, sid }) => {
      const values = readValues(f.values, cats, sw, line);
      const cells: BarCell[] = [];
      cats.forEach((c, ci) => {
        const v = values[ci];
        if (v !== undefined) cells.push({ id: idFrom(`${label} ${c}`, taken, `${id}-`), category: c, value: v });
      });
      return { id: sid, label, cells, about: optString(f, "about", sw, line), focal: optBool(f, "focal", sw, line), muted: optBool(f, "muted", sw, line) };
    });
    const order = sort ?? "none";
    let categories = cats;
    if (order === "value") {
      const total = (c: string) => series.reduce((acc, s) => acc + (s.cells.find((x) => x.category === c)?.value ?? 0), 0);
      categories = [...cats].sort((a, b) => total(b) - total(a));
    }
    if (cats.length > 6 || series.length > 4) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${cats.length} categories × ${series.length} series; keep it to 6 × 4. Split the categories over two charts, or keep the series that carry the story and drop the rest.`, line });
    }
    checkFocal(series.filter((s) => s.focal).length, where, line, ctx);
    const long = cats.some((c) => c.length > 12);
    return { ...base, orient: orient ?? (cats.length > 6 || long ? "horizontal" : "vertical"), stack, sort: order, items: [], categories, series };
  },

  render(b, ctx) {
    const theme = ctx.theme;
    const pad = theme.grid.pad, tag = theme.type.tag, lp = theme.type.nodeSub, lh = Math.round(lp * 1.35);
    const multi = b.series.length > 0, stacked = multi && b.stack, grouped = multi && !b.stack;
    const nS = multi ? b.series.length : 1;
    const horizontal = b.orient === "horizontal";
    const unit = symbolUnit(b.unit);
    const f = (v: number) => fmtUnit(v, unit, b.format);
    const dv = (v: number) => signed(v, unit, b.format);
    const mw = (s: string) => textWidth(s, tag, "sans");
    const rows = rowsOf(b, theme);
    const refVals = [
      ...(b.marks ?? []).flatMap((m) => (typeof m.at === "number" ? [m.at] : [])),
      ...(b.bands ?? []).flatMap((bd) => [bd.from as number, bd.to as number]),
    ];
    const ends = [...rows.flatMap((r) => r.segs.flatMap((s) => [s.v0, s.v1])), ...refVals];
    const lo = Math.min(0, ...ends), hi = Math.max(0, ...ends);
    // labels past a bar end: every bar, or the row total when stacked; single series also swap in signed differences on selection
    const endLabels = stacked
      ? rows.map((r) => ({ v: r.total, t: f(r.total) }))
      : rows.flatMap((r) => r.segs.map((s) => ({ v: s.value, t: f(s.value) })));
    if (!multi) for (const a of b.items) for (const o of b.items) if (a !== o) endLabels.push({ v: o.value, t: dv(o.value - a.value) });
    const posW = Math.max(0, ...endLabels.filter((l) => l.v >= 0).map((l) => mw(l.t) + 10));
    const negW = Math.max(0, ...endLabels.filter((l) => l.v < 0).map((l) => mw(l.t) + 10));
    const refRoom = b.marks?.length || b.bands?.length ? REF_ROOM : 0;
    const axisTop = Math.round(pad / 2);
    const top = axisTop + (b.axis ? 22 : 0);
    const back: string[] = [], body: string[] = [], front: string[] = [];
    const placed: { sg: Seg; ri: number; rect: Box; pos?: EndPos; inner?: string; names: string }[] = [];
    const obstacles: Frame[] = [];
    let height = 0, axisLeft = pad, s: Linear, plot: Frame;

    if (horizontal) {
      const labelW = Math.min(Math.ceil(Math.max(...rows.map((r) => textWidth(r.label, lp, "sans")))), Math.round(WIDTH * 0.3));
      const lines = rows.map((r) => wrap(r.label, labelW, lp));
      const barT = grouped ? 16 : 20;
      const groupT = grouped ? nS * barT + (nS - 1) * GAP : barT;
      const x0 = pad + labelW + 12 + negW, x1 = WIDTH - pad - posW;
      s = linear([lo, hi], [x0, x1], { zero: true, nice: stacked });
      const rowsTop = top + refRoom;
      let y = rowsTop;
      rows.forEach((r, i) => {
        const h = Math.max(groupT + (grouped ? 18 : 12), lines[i].length * lh + 10), cy = y + h / 2;
        const names = lines[i].map((ln, k) => {
          const ty = cy + (k - (lines[i].length - 1) / 2) * lh + lp * 0.35;
          const w = textWidth(ln, lp, "sans");
          obstacles.push({ x: pad + labelW - w, y: ty - lp, w, h: lp * 1.2 });
          return text(pad + labelW, ty, ln, "x-mark-label", "end");
        }).join("");
        for (const sg of r.segs) {
          const c = grouped ? cy - groupT / 2 + sg.si * (barT + GAP) : cy - barT / 2;
          const rect = barRect(true, s, sg.v0, sg.v1, c, barT);
          if (stacked) placed.push({ sg, ri: i, rect, inner: inside(true, rect, f(sg.value), tag), names: "" });
          else placed.push({ sg, ri: i, rect, pos: endPos(true, s, sg.v1, sg.value >= 0, c + barT / 2, tag), names: multi ? "" : names });
        }
        if (multi) front.push(`<g class="x-bar-category">${names}</g>`);
        if (stacked && r.segs.length) {
          const p = endPos(true, s, r.total >= 0 ? r.posEnd : r.negEnd, r.total >= 0, cy, tag);
          front.push(endText(p, f(r.total)));
          obstacles.push(endBox(p, f(r.total), tag));
        }
        y += h;
      });
      plot = { x: x0, y: rowsTop, w: x1 - x0, h: y - rowsTop };
      front.push(`<line class="x-axis-line" x1="${num(s(0))}" y1="${num(rowsTop)}" x2="${num(s(0))}" y2="${num(y)}"/>`);
      if (stacked) {
        back.push(axisX(plot, s.ticks().map((t) => ({ at: s(t), label: f(t) })), { grid: true }));
        y += 28;
      }
      height = y;
      axisLeft = x0;
    } else {
      const layout = (left: number) => {
        const bnd = band(rows.map((_, i) => String(i)), [left, WIDTH - pad], 0.3, 0.15);
        const groupW = Math.min(bnd.bandwidth, grouped ? nS * 32 : 64);
        return { bnd, groupW, barW: grouped ? (groupW - (nS - 1) * GAP) / nS : groupW };
      };
      let geo = layout(pad);
      const values = !stacked && endLabels.every((l) => mw(l.t) <= (grouped ? geo.barW + GAP : geo.bnd.step - 6));
      const ticks = !values;
      const tickVals = linear([lo, hi], [0, 1], { zero: true, nice: true }).ticks();
      const left = ticks ? pad + Math.max(...tickVals.map((t) => mw(f(t)))) + 10 : pad;
      if (ticks) geo = layout(left);
      const { bnd, groupW, barW } = geo;
      const lines = rows.map((r) => wrap(r.label, bnd.step - 8, lp));
      if (lines.some((ls) => ls.some((ln) => textWidth(ln, lp, "sans") > bnd.step - 4))) {
        ctx.warn({ rule: "label-fit", severity: "warn", message: `bar "${b.id}": some category labels are wider than their column; use \`orient: horizontal\` or shorter labels.`, line: b.line });
      }
      const yTop = top + 18, yBot = yTop + PLOT_H;
      s = linear([lo, hi], [yBot, yTop], { zero: true, nice: ticks });
      const catTop = yBot + ((values || stacked) && lo < 0 ? 18 : 0) + 8;
      rows.forEach((r, i) => {
        const cx = bnd(String(i)) + bnd.bandwidth / 2;
        const names = lines[i].map((ln, k) => {
          const w = textWidth(ln, lp, "sans");
          obstacles.push({ x: cx - w / 2, y: catTop + k * lh, w, h: lp * 1.2 });
          return text(cx, catTop + lp + k * lh, ln, "x-mark-label", "middle");
        }).join("");
        for (const sg of r.segs) {
          const c = grouped ? cx - groupW / 2 + sg.si * (barW + GAP) : cx - barW / 2;
          const rect = barRect(false, s, sg.v0, sg.v1, c, barW);
          if (stacked) placed.push({ sg, ri: i, rect, inner: inside(false, rect, f(sg.value), tag), names: "" });
          else placed.push({ sg, ri: i, rect, pos: values ? endPos(false, s, sg.v1, sg.value >= 0, c + barW / 2, tag) : undefined, names: multi ? "" : names });
        }
        if (multi) front.push(`<g class="x-bar-category">${names}</g>`);
        if (stacked && r.segs.length) {
          const p = endPos(false, s, r.total >= 0 ? r.posEnd : r.negEnd, r.total >= 0, cx, tag);
          front.push(endText(p, f(r.total)));
          obstacles.push(endBox(p, f(r.total), tag));
        }
      });
      plot = { x: left, y: yTop, w: WIDTH - pad - left, h: PLOT_H };
      front.push(`<line class="x-axis-line" x1="${num(left)}" y1="${num(s(0))}" x2="${num(WIDTH - pad)}" y2="${num(s(0))}"/>`);
      if (ticks) back.push(axisY(plot, s.ticks().map((t) => ({ at: s(t), label: f(t) }))));
      height = catTop + lp + (Math.max(...lines.map((ls) => ls.length)) - 1) * lh + 8;
      axisLeft = left;
    }

    // marks: value label at the end; on selection a rule at the value and, for one series, every other bar's signed difference
    const anchors: Record<string, Frame> = {};
    const deltas = !multi && placed.every((p) => p.pos);
    // a difference label that would sit on the selection rule moves to the far side of it
    const clearOf = (p: EndPos, content: string, rule: number): EndPos => {
      const box = endBox(p, content, tag);
      if (horizontal) {
        if (box.x > rule + 3 || box.x + box.w < rule - 3) return p;
        return p.anchor === "end" ? { ...p, x: rule - 6 } : { ...p, x: rule + 6 };
      }
      if (box.y > rule + 3 || box.y + box.h < rule - 3) return p;
      return { ...p, y: p.y < rule ? rule - 5 : rule + 5 + tag * 0.8 };
    };
    for (const p of placed) {
      const { sg, rect } = p;
      const box: Frame = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      let label = p.inner ?? "";
      if (p.pos) {
        label = endText(p.pos, f(sg.value));
        // the value, and the signed difference that replaces it while another bar is selected, print past the end;
        // they are obstacles for other bars' markers, and this bar's own marker is placed clear of all of them
        const ends = [endBox(p.pos, f(sg.value), tag)];
        if (deltas) for (const o of placed) if (o !== p) ends.push(endBox(clearOf(p.pos, dv(sg.value - o.sg.value), s(o.sg.value)), dv(sg.value - o.sg.value), tag));
        obstacles.push(...ends);
        anchors[sg.id] = union([box, ...ends]);
      } else anchors[sg.id] = box;
      const others = deltas ? placed.filter((o) => o !== p).map((o) => endText(clearOf(o.pos!, dv(o.sg.value - sg.value), s(sg.value)), dv(o.sg.value - sg.value), "x-value-label x-delta-label")).join("") : "";
      const sel = stacked ? "" : onSel(selRule(horizontal, s, sg.value, plot) + others);
      const nav = horizontal ? `${p.ri},${sg.si}` : `${sg.si},${p.ri}`;
      // a value printed inside a stacked segment takes the ink that reads on that segment's fill (charts-grids.css)
      const ink = p.inner ? markInk(theme, { focal: sg.focal, muted: sg.muted, slot: sg.slot ?? 1 }) : "";
      const attrs = `${sg.muted ? ` data-muted="true"` : ""}${deltas ? ` data-delta="true"` : ""}${ink} data-nav="${nav}"`;
      body.push(mark({ id: sg.id, label: sg.label, value: f(sg.value), series: sg.slot, focal: sg.focal, cls: "x-bar", attrs },
        rect.svg + anchorAt(horizontal, rect, sg.value >= 0) + label + p.names + sel));
    }
    for (const se of b.series) {
      const own = se.cells.map((c) => anchors[c.id]).filter(Boolean);
      if (own.length) anchors[se.id] = union(own);
    }

    const title = b.axis ? text(axisLeft, axisTop + tag, b.axis, "x-axis-label") : "";
    front.push(title);
    let key = "";
    if (multi) {
      const lg = legend(b.series.map((se, si) => ({ id: se.id, label: se.label, series: seriesSlot(si, theme) })), theme, pad, WIDTH - pad, height + 8);
      key = lg.svg;
      front.push(flagLegend(key, b.series));
      height += 8 + lg.height;
    }
    height += Math.round(pad / 2);

    const refFrame = horizontal ? { ...plot, y: plot.y - refRoom, h: plot.h + refRoom } : plot;
    const refs = references(b, s, refFrame, horizontal, f, tag);
    // axis ticks, the axis title, the legend and reference labels are text a note marker must not cover either
    obstacles.push(...textBoxes(back.join("") + title + key + refs.back + refs.front, tag));
    const marker = notes(b, anchors, { obstacles, bounds: { x: 0, y: 0, w: WIDTH, h: height } });
    const largest = b.items.reduce<BarItem | undefined>((m, it) => (!m || it.value > m.value ? it : m), undefined);
    const desc = multi
      ? `${b.series.length} series (${b.series.map((se) => se.label).join(", ")}) across ${b.categories.length} categories${b.stack ? ", stacked" : ""}.`
      : `${b.items.length} bars${b.axis ? ` of ${b.axis}` : ""}; the largest is ${largest?.label} at ${f(largest?.value ?? 0)}.`;
    return svgFigure({
      id: b.id, kind: "bar", title: b.title, label: b.axis ?? "Bar chart", desc, width: WIDTH, height,
      body: back.join("") + refs.back + body.join("") + refs.front + front.join("") + marker,
    });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const unit = symbolUnit(b.unit);
    const f = (v: number) => fmtUnit(v, unit, b.format);
    const fu = (v: number) => fmtUnit(v, b.unit, b.format);
    const dv = (v: number) => signed(v, unit, b.format);
    if (b.items.length) {
      const vals = b.items.map((it) => it.value), total = sum(vals), mean = total / vals.length;
      const byValue = [...b.items].sort((a, c) => c.value - a.value);
      // compare with the focal bar (or the leader); the focal bar itself compares with the runner-up
      const lead = b.items.find((it) => it.focal) ?? byValue[0];
      const runnerUp = byValue.find((it) => it !== lead);
      const shares = total > 0 && vals.every((v) => v >= 0);
      for (const it of b.items) {
        const r = rank(it.value, vals);
        const other = it === lead ? runnerUp : lead;
        const sh = shares ? share(it.value, total) : "";
        elements[it.id] = itemInfo({
          id: it.id, label: it.label, figure: b.id, kind: "bar", value: fu(it.value), about: it.about, pos: r.text,
          facts: factList([
            { k: "rank", v: `#${r.text}`, raw: r.n },
            shares && { k: "share", v: `${sh} of total (${f(total)})`, raw: (it.value / total) * 100 },
            other && { k: `vs ${other.label}`, v: `${dv(it.value - other.value)} (${ratio(it.value, other.value)})`, ref: other.id, tone: trend(it.value - other.value), raw: it.value - other.value },
            vals.length > 2 && { k: "vs average", v: dv(it.value - mean), tone: trend(it.value - mean), raw: it.value - mean },
          ]),
          say: [it.label, fu(it.value), r.nth, shares && `${sh} of total`].filter(Boolean).join(", "),
        });
      }
    }
    const catTotal = new Map(b.categories.map((c) => [c, sum(b.series.flatMap((s) => s.cells.filter((x) => x.category === c).map((x) => x.value)))]));
    const grand = sum([...catTotal.values()]);
    for (const s of b.series) {
      const sTotal = sum(s.cells.map((c) => c.value)), sVals = s.cells.map((c) => c.value);
      for (const c of s.cells) {
        const peers = b.series.filter((o) => o !== s).flatMap((o) => o.cells.filter((x) => x.category === c.category).map((x) => ({ o, x })));
        const r = rank(c.value, sVals);
        const cTotal = catTotal.get(c.category) ?? 0;
        const facts = b.stack
          ? [
              { k: `share of ${c.category}`, v: share(c.value, cTotal), raw: cTotal ? (c.value / cTotal) * 100 : undefined },
              { k: `share of ${s.label}`, v: share(c.value, sTotal), raw: sTotal ? (c.value / sTotal) * 100 : undefined },
              { k: `${c.category} total`, v: f(cTotal), raw: cTotal },
            ]
          : [
              ...peers.map(({ o, x }) => ({ k: `vs ${o.label}`, v: `${dv(c.value - x.value)} (${ratio(c.value, x.value)})`, ref: x.id, tone: trend(c.value - x.value), raw: c.value - x.value })),
              { k: `rank in ${s.label}`, v: `#${r.text}`, raw: r.n },
            ];
        elements[c.id] = itemInfo({
          id: c.id, label: c.category, sub: s.label, figure: b.id, kind: b.stack ? "segment" : "bar", value: fu(c.value), about: s.about, related: [s.id],
          pos: b.stack ? undefined : `${r.text} in ${s.label}`,
          facts: factList(facts),
          context: b.stack ? undefined : peers.map((p) => p.x.id),
          say: `${c.category}, ${s.label}, ${fu(c.value)}`,
        });
      }
      const byValue = [...s.cells].sort((a, c) => c.value - a.value);
      const top = byValue[0], low = byValue[byValue.length - 1];
      elements[s.id] = groupInfo({
        id: s.id, label: s.label, figure: b.id, members: s.cells.map((c) => c.id), kind: "series", about: s.about, value: fu(sTotal),
        facts: factList([
          b.series.length > 1 && grand > 0 && { k: "share", v: `${share(sTotal, grand)} of all`, raw: (sTotal / grand) * 100 },
          top && { k: "largest", v: `${top.category} · ${f(top.value)}`, ref: top.id },
          byValue.length > 1 && { k: "smallest", v: `${low.category} · ${f(low.value)}`, ref: low.id },
        ]),
        say: `${s.label}, ${fu(sTotal)} in total`,
      });
    }
    return { elements };
  },

  reading(b) {
    const what = b.axis ? lowerFirst(b.axis) : "the value";
    const focal = [...b.items.filter((it) => it.focal).map((it) => it.label), ...b.series.filter((s) => s.focal).map((s) => s.label)];
    const accent = focal.length ? ` The accent marks ${joinList(focal)}, the ${focal.length > 1 ? "ones" : "one"} the text is about.` : "";
    const hint = b.series.length && !b.stack ? "" : " Select a bar to see the others as differences from it.";
    if (!b.series.length) {
      return `Each bar is one category; its length is ${what}, from zero${b.sort === "value" ? ", largest first" : ""}.${accent}${hint}`;
    }
    const names = joinList(b.series.map((s) => s.label));
    if (b.stack) return `Each bar stacks ${names} for one category; its full length is the category total of ${what}.${accent}`;
    return `Bars sit side by side in each category, one colour per series (${names}); length is ${what}, from zero.${accent}`;
  },

  table(b): DataTable {
    const f = (v: number) => fmtUnit(v, symbolUnit(b.unit), b.format);
    const valueHead = b.axis ?? (b.unit ? `Value (${b.unit})` : "Value");
    if (b.items.length) {
      const total = sum(b.items.map((it) => it.value));
      const shares = total > 0 && b.items.every((it) => it.value >= 0);
      return {
        head: ["Category", valueHead, ...(shares ? ["Share"] : [])],
        rows: b.items.map((it) => [it.label, f(it.value), ...(shares ? [share(it.value, total)] : [])]),
      };
    }
    return {
      head: ["Category", ...b.series.map((s) => s.label), ...(b.stack ? ["Total"] : [])],
      rows: b.categories.map((c) => {
        const cells = b.series.map((s) => s.cells.find((x) => x.category === c));
        return [c, ...cells.map((x) => (x ? f(x.value) : "")), ...(b.stack ? [f(sum(cells.map((x) => x?.value ?? 0)))] : [])];
      }),
    };
  },
};
