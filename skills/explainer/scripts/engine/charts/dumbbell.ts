// Dumbbell: two values per row, a hollow dot for the first and a solid dot for the second, joined by a line. Rows sorted by the size of the change.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type ReadingSpec } from "../types.ts";
import {
  READING_KEYS, axisX, esc, factList, fmtUnit, format as readFormat, groupInfo, idFrom, isObj, itemInfo, legend, linear, list, mark,
  markValue, notes, num, number, onSel, parseUnit, pct, rank, readingSpec, signed, svgFigure, text, textWidth, trend, wrap, type Format,
  type Frame,
} from "../kit.ts";
import { textBoxes } from "./boxes.ts";
import { allowKeys, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

interface DumbbellRow { id: string; label: string; from: number; to: number; about?: string; focal: boolean; muted: boolean }

interface DumbbellBlock extends ReadingSpec {
  type: "dumbbell";
  id: string;
  title?: string;
  line: number;
  format: Format;
  unit?: string;
  axis?: string;
  columns: [string, string];
  /** Legend ids for the two ends; selecting one lights every dot of that end and shows its mean. */
  ends: [string, string];
  /** Which direction is an improvement; unset = the change is neutral. */
  better?: "lower" | "higher";
  sort: "change" | "none";
  rows: DumbbellRow[];
}

const WIDTH = 960;
const R = 6;
const KEYS = ["id", "title", "format", "unit", "axis", "columns", "better", "sort", "data", ...READING_KEYS];
const ROW_KEYS = ["id", "label", "from", "to", "about", "focal", "muted"];
const SYMBOL_UNIT = /^[$€£¥%]$/;

function labelOf(f: Fields, where: string, line: number): string {
  return typeof f.label === "number" ? String(f.label) : requireString(f, "label", where, line);
}

/** `data` as a list of { label, from, to }, or the shorthand `label: [from, to]`. */
function readRows(v: unknown, where: string, line: number): Fields[] {
  if (isObj(v)) {
    return Object.entries(v).map(([label, val]) => {
      if (Array.isArray(val)) {
        if (val.length !== 2) throw new SpecError(`${where}: "${label}" needs two values [from, to].`, line);
        return { label, from: val[0], to: val[1] };
      }
      if (isObj(val)) return { label, ...val };
      throw new SpecError(`${where}: "${label}" needs [from, to] or { from, to }.`, line);
    });
  }
  return list(v, `${where} data`, line).map((it, i) => {
    if (!isObj(it)) throw new SpecError(`${where} data item ${i + 1} must be a map: { label, from, to }.`, line);
    return it;
  });
}

function reserveIds(rows: Fields[], taken: Set<string>, where: string, line: number): void {
  for (const r of rows) {
    if (r.id === undefined) continue;
    if (typeof r.id !== "string" || !r.id.trim()) throw new SpecError(`${where}: an item id must be text.`, line);
    if (taken.has(r.id)) throw new SpecError(`${where}: id "${r.id}" is used twice.`, line, "id-unique");
    taken.add(r.id);
  }
}

function readColumns(v: unknown, where: string, line: number): [string, string] {
  if (v === undefined) return ["Before", "After"];
  const cols = list(v, `${where} columns`, line);
  if (cols.length !== 2 || cols.some((c) => typeof c !== "string" && typeof c !== "number")) {
    throw new SpecError(`${where}: columns must name exactly two values, e.g. [Before, After].`, line);
  }
  return [String(cols[0]), String(cols[1])];
}

const symbolUnit = (unit?: string) => (unit && SYMBOL_UNIT.test(unit) ? unit : undefined);
const signedPct = (v: number) => (v > 0 ? `+${pct(v)}` : pct(v));
const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / Math.max(1, xs.length);

/** How much a row improved: from − to when lower is better, to − from when higher is, else the size of the change. */
function gain(b: DumbbellBlock, r: DumbbellRow): number {
  return b.better === "lower" ? r.from - r.to : b.better === "higher" ? r.to - r.from : Math.abs(r.to - r.from);
}

/** Adds `extra` inside the legend item with data-id `id`, after its label. */
function intoLegend(svg: string, id: string, extra: string): string {
  return svg.replace(new RegExp(`(<g class="x-legend-item"[^>]*data-id="${esc(id)}"[^>]*>[\\s\\S]*?</text>)</g>`), `$1${extra}</g>`);
}

export const blockModule: BlockModule<DumbbellBlock> = {
  type: "dumbbell",

  normalize(raw, ctx) {
    const line = raw.line;
    const d = requireMap(raw.data, "dumbbell", line);
    allowKeys(d, KEYS, "dumbbell", line);
    const id = requireString(d, "id", "dumbbell", line);
    const where = `dumbbell "${id}"`;
    const columns = readColumns(d.columns, where, line);
    const sort = optString(d, "sort", where, line) ?? "change";
    if (sort !== "change" && sort !== "none") throw new SpecError(`${where}: sort must be change or none, got "${sort}".`, line);
    const better = optString(d, "better", where, line);
    if (better !== undefined && better !== "lower" && better !== "higher") throw new SpecError(`${where}: better must be lower or higher, got "${better}".`, line);
    const fields = readRows(d.data, where, line);
    if (!fields.length) throw new SpecError(`${where}: \`data\` is empty; give at least one { label, from, to }.`, line);
    const taken = new Set([id, `${id}-title`, `${id}-desc`]);
    reserveIds(fields, taken, where, line);
    let rows: DumbbellRow[] = fields.map((f, i) => {
      const iw = `${where} row ${i + 1}`;
      allowKeys(f, ROW_KEYS, iw, line);
      const label = labelOf(f, iw, line);
      return {
        id: typeof f.id === "string" ? f.id : idFrom(label, taken, `${id}-`),
        label,
        from: number(f.from, `${iw} from`, line),
        to: number(f.to, `${iw} to`, line),
        about: optString(f, "about", iw, line),
        focal: optBool(f, "focal", iw, line),
        muted: optBool(f, "muted", iw, line),
      };
    });
    if (sort === "change") rows = [...rows].sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
    if (rows.length > 12) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${rows.length} rows; keep 12 or fewer. Keep the rows with the largest change, or split by group into two charts.`, line });
    }
    const focal = rows.filter((r) => r.focal).length;
    if (focal > BUDGET.focal) ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} rows focal; keep it to ${BUDGET.focal}.`, line });
    const ends: [string, string] = [idFrom(columns[0], taken, `${id}-`), idFrom(columns[1], taken, `${id}-`)];
    return {
      type: "dumbbell", id, title: optString(d, "title", where, line), line, format: readFormat(d.format, line), unit: parseUnit(d.unit, line),
      axis: optString(d, "axis", where, line), columns, ends, better, sort, rows, ...readingSpec(d, line),
    };
  },

  render(b, ctx) {
    const theme = ctx.theme;
    const pad = theme.grid.pad, tag = theme.type.tag, lp = theme.type.nodeSub, lh = Math.round(lp * 1.35);
    const unit = symbolUnit(b.unit);
    const f = (v: number) => fmtUnit(v, unit, b.format);
    const vals = b.rows.flatMap((r) => [r.from, r.to]);
    const valW = Math.max(...vals.map((v) => textWidth(f(v), tag, "sans"))) + 14;
    const labelW = Math.min(Math.ceil(Math.max(...b.rows.map((r) => textWidth(r.label, lp, "sans")))), Math.round(WIDTH * 0.3));
    const lines = b.rows.map((r) => wrap(r.label, labelW, lp));
    const top = Math.round(pad / 2);
    const x0 = pad + labelW + 12 + valW, x1 = WIDTH - pad - valW;
    const s = linear([Math.min(...vals), Math.max(...vals)], [x0, x1], { nice: true });
    const body: string[] = [];
    const anchors: Record<string, Frame> = {};
    const obstacles: Frame[] = [];
    let y = top;
    b.rows.forEach((r, i) => {
      const h = Math.max(32, lines[i].length * lh + 10), cy = y + h / 2;
      // a note marker belongs to one row: the line between two rows is off limits, so it lands beside its own row
      if (i > 0) obstacles.push({ x: pad, y: y - 4, w: WIDTH - 2 * pad, h: 8 });
      const a = s(r.from), c = s(r.to);
      const names = lines[i].map((ln, k) => {
        const ty = cy + (k - (lines[i].length - 1) / 2) * lh + lp * 0.35;
        const w = textWidth(ln, lp, "sans");
        obstacles.push({ x: pad + labelW - w, y: ty - lp, w, h: lp * 1.2 });
        return text(pad + labelW, ty, ln, "x-mark-label", "end");
      }).join("");
      const hit = `<rect class="x-row-hit" x="${num(pad)}" y="${num(y)}" width="${num(WIDTH - 2 * pad)}" height="${num(h)}"/>`;
      const bar = `<line class="x-dumbbell-bar" x1="${num(a)}" y1="${num(cy)}" x2="${num(c)}" y2="${num(cy)}"/>`;
      // a small arrowhead just before the second dot says which way the row moved
      const dir = Math.sign(c - a);
      const arrow = Math.abs(c - a) > 2 * R + 10
        ? `<path class="x-dumbbell-arrow" d="M${num(c - dir * (R + 2))},${num(cy)}L${num(c - dir * (R + 8))},${num(cy - 3.5)}L${num(c - dir * (R + 8))},${num(cy + 3.5)}Z"/>`
        : "";
      const dot = (cls: string, x: number) => `<circle class="x-mark-shape x-dumbbell-dot ${cls}" cx="${num(x)}" cy="${num(cy)}" r="${R}"/>`;
      const ty = cy + tag * 0.35;
      const lo = f(Math.min(r.from, r.to)), hi = f(Math.max(r.from, r.to));
      const values = r.from === r.to
        ? text(a + R + 6, ty, f(r.to), "x-value-label")
        : text(Math.min(a, c) - R - 6, ty, lo, "x-value-label", "end") + text(Math.max(a, c) + R + 6, ty, hi, "x-value-label");
      const loW = textWidth(lo, tag, "sans"), hiW = textWidth(hi, tag, "sans");
      obstacles.push(
        { x: Math.min(a, c) - R - 6 - loW, y: ty - tag * 0.8, w: loW, h: tag },
        { x: Math.max(a, c) + R + 6, y: ty - tag * 0.8, w: hiW, h: tag },
      );
      const span = { x: Math.min(a, c) - R, y: cy - R, w: Math.abs(c - a) + 2 * R, h: 2 * R };
      // note markers go outside the row's value labels, never between two rows
      const before = r.from === r.to ? 0 : loW + 6;
      anchors[r.id] = { x: span.x - before, y: span.y, w: span.w + before + hiW + 6, h: span.h };
      const ch = r.to - r.from;
      const change = `${signed(ch, unit, b.format)}${r.from ? ` (${signedPct((ch / Math.abs(r.from)) * 100)})` : ""}`;
      // on selection: a surface band behind the row and the change printed over the middle of the line
      const band = onSel(`<rect class="x-dumbbell-band" x="${num(pad)}" y="${num(y + 1)}" width="${num(WIDTH - 2 * pad)}" height="${num(h - 2)}"/>`);
      const mid = onSel(text((a + c) / 2, cy - R - 4, change, "x-value-label x-delta-label", "middle"));
      // the change prints while the row is selected, which is when its note marker is in view too
      const chW = textWidth(change, tag, "sans");
      obstacles.push({ x: (a + c) / 2 - chW / 2, y: cy - R - 4 - tag * 0.8, w: chW, h: tag });
      body.push(mark({
        id: r.id,
        label: r.label,
        value: `${f(r.from)} → ${f(r.to)}`,
        focal: r.focal,
        cls: "x-dumbbell",
        attrs: `${r.muted ? ` data-muted="true"` : ""} data-nav="${i},0"`,
      }, band + hit + names + bar + arrow + dot("x-dumbbell-from", a) + dot("x-dumbbell-to", c) +
        `<rect class="x-anchor" x="${num(span.x)}" y="${num(span.y)}" width="${num(span.w)}" height="${num(span.h)}"/>` + values + mid));
      y += h;
    });
    const plot: Frame = { x: x0, y: top, w: x1 - x0, h: y - top };
    const axis = axisX(plot, s.ticks().map((t) => ({ at: s(t), label: f(t) })), { grid: true, title: b.axis });
    let height = y + (b.axis ? 40 : 24);
    const lg = legend([
      { id: b.ends[0], label: b.columns[0], kind: "dot" },
      { id: b.ends[1], label: b.columns[1], kind: "dot" },
    ], theme, pad, WIDTH - pad, height + 4);
    // selecting a legend end shows the mean of that end as a rule across the rows
    let lsvg = lg.svg;
    b.ends.forEach((eid, k) => {
      const m = mean(b.rows.map((r) => (k === 0 ? r.from : r.to)));
      const rule = `<line class="x-ref-rule x-sel-rule" x1="${num(s(m))}" y1="${num(top)}" x2="${num(s(m))}" y2="${num(y)}"/>`;
      lsvg = intoLegend(lsvg, eid, onSel(rule + text(s(m) + 4, top + tag, `mean ${f(m)}`, "x-ref-label x-delta-label")))
        .replace(`data-id="${esc(eid)}"`, `data-id="${esc(eid)}" data-end="${k === 0 ? "from" : "to"}"`);
    });
    const sorted = b.sort === "change" ? text(WIDTH - pad, height + 4 + 24 + tag * 0.35, "sorted by size of change", "x-legend-label x-legend-note", "end") : "";
    lsvg += sorted;
    height += 4 + lg.height + Math.round(pad / 2);
    // tick labels, the axis title and the legend are text a note marker must not cover either
    obstacles.push(...textBoxes(axis + lg.svg + sorted, tag));
    const marker = notes(b, anchors, { obstacles, bounds: { x: 0, y: 0, w: WIDTH, h: height } });
    const desc = `${b.rows.length} rows, each compared between ${b.columns[0]} (hollow dot) and ${b.columns[1]} (solid dot)${b.axis ? ` on ${b.axis}` : ""}.`;
    return svgFigure({ id: b.id, kind: "dumbbell", title: b.title, label: b.axis ?? "Dumbbell chart", desc, width: WIDTH, height, body: axis + body.join("") + lsvg + marker });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const unit = symbolUnit(b.unit);
    const f = (v: number) => fmtUnit(v, unit, b.format);
    const fu = (v: number) => fmtUnit(v, b.unit, b.format);
    const sg = (v: number) => signed(v, b.unit, b.format);
    const gains = b.rows.map((r) => gain(b, r));
    const median = markValue("median", b.rows.map((r) => r.to - r.from));
    const by = b.better ? "gain" : "size of change";
    for (const r of b.rows) {
      const ch = r.to - r.from;
      const rk = rank(gain(b, r), gains);
      const improved = b.better === "lower" ? ch < 0 : ch > 0;
      elements[r.id] = itemInfo({
        id: r.id,
        label: r.label,
        figure: b.id,
        kind: "change",
        value: `${f(r.from)} → ${fu(r.to)}`,
        about: r.about,
        pos: rk.text,
        facts: factList([
          { k: "change", v: `${sg(ch)}${r.from ? ` (${signedPct((ch / Math.abs(r.from)) * 100)})` : ""}`, tone: trend(ch), raw: ch },
          { k: "rank", v: `${rk.text} by ${by}`, raw: rk.n },
          b.rows.length > 2 && { k: "median change", v: sg(median), raw: median },
          b.better && ch !== 0 && { k: `${b.better} is better`, v: `${improved ? "better" : "worse"} by ${fu(Math.abs(ch))}`, tone: trend(ch) },
        ]),
        say: `${r.label}, ${f(r.from)} to ${fu(r.to)}, ${sg(ch)}, ${rk.nth} by ${by}`,
      });
    }
    b.ends.forEach((eid, k) => {
      const vals = b.rows.map((r) => (k === 0 ? r.from : r.to));
      const top = b.rows[vals.indexOf(Math.max(...vals))], low = b.rows[vals.indexOf(Math.min(...vals))];
      elements[eid] = groupInfo({
        id: eid, label: b.columns[k], figure: b.id, kind: k === 0 ? "first value" : "second value", members: b.rows.map((r) => r.id),
        value: `mean ${fu(mean(vals))}`,
        facts: factList([
          { k: "range", v: `${f(Math.min(...vals))}–${f(Math.max(...vals))}` },
          { k: "highest", v: `${top.label} · ${f(Math.max(...vals))}`, ref: top.id },
          low !== top && { k: "lowest", v: `${low.label} · ${f(Math.min(...vals))}`, ref: low.id },
        ]),
        say: `${b.columns[k]}, mean ${fu(mean(vals))} over ${b.rows.length} rows`,
      });
    });
    return { elements };
  },

  reading(b) {
    const focal = b.rows.filter((r) => r.focal).map((r) => r.label);
    const better = b.better ? ` ${b.better === "lower" ? "Lower" : "Higher"} is better.` : "";
    const order = b.sort === "change" ? " Rows are sorted by the size of the change, largest first." : "";
    return `Each row runs from ${b.columns[0]} (hollow dot) to ${b.columns[1]} (solid dot); the arrowhead shows the direction.${better}${order}` +
      (focal.length ? ` The accent marks ${focal.join(" and ")}.` : "");
  },

  table(b): DataTable {
    const unit = symbolUnit(b.unit);
    const f = (v: number) => fmtUnit(v, unit, b.format);
    return {
      head: ["Row", b.columns[0], b.columns[1], "Change", "Change %"],
      rows: b.rows.map((r) => [r.label, f(r.from), f(r.to), signed(r.to - r.from, unit, b.format), r.from ? signedPct(((r.to - r.from) / Math.abs(r.from)) * 100) : "—"]),
    };
  },
};
