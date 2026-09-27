// Heatmap: rows × columns of values shaded on the sequential ramp. Rows and columns are selectable groups.
import { SpecError, type BlockModule, type ElementInfo, type Fact, type ReadingSpec } from "../types.ts";
import {
  fmt, format as parseFormat, groupInfo, idFrom, isObj, itemInfo, list, mark, notes as noteMarkers, num, number, parseUnit, rank, ratio, readingSpec,
  share, svgFigure, text, textWidth, trend, type Format, type Frame,
} from "../kit.ts";
import { textBoxes } from "./boxes.ts";
import { allowKeys, optString, requireMap, requireString } from "../blocks/util.ts";
import { rampInk } from "./ink.ts";

interface HeatCell { id: string; value: number; level: number }

interface HeatmapBlock extends ReadingSpec {
  type: "heatmap";
  id: string;
  title?: string;
  line: number;
  format: Format;
  scale: "quantile" | "linear";
  rows: { id: string; label: string; about?: string }[];
  columns: { id: string; label: string; about?: string }[];
  cells: (HeatCell | null)[][]; // [row][column]; null = no value
  range?: [number, number];     // min and max value, for the ramp legend
  unit?: string;                // what one cell counts ("tickets"), for the reading line and say
}

interface Rect { x: number; y: number; w: number; h: number }

const W = 960;
const MAX_ROWS = 12, MAX_COLS = 16;

function labelOf(v: unknown, what: string, line: number): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  throw new SpecError(`${what} must be a text label, got ${JSON.stringify(v)}.`, line);
}

function labels(v: unknown, what: string, line: number): string[] {
  const out = list(v, what, line).map((x, i) => labelOf(x, `${what} item ${i + 1}`, line));
  if (!out.length) throw new SpecError(`${what} needs at least one label.`, line);
  const seen = new Set<string>();
  for (const l of out) {
    if (seen.has(l)) throw new SpecError(`${what}: "${l}" is listed twice.`, line, "id-unique");
    seen.add(l);
  }
  return out;
}

function aboutMap(v: unknown, known: string[], what: string, of: string, line: number): Map<string, string> {
  const out = new Map<string, string>();
  if (v === undefined || v === null) return out;
  if (!isObj(v)) throw new SpecError(`${what} must be a map of label: one or two sentences.`, line);
  for (const [k, about] of Object.entries(v)) {
    if (!known.includes(k)) throw new SpecError(`${what}: "${k}" is not one of ${of} (${known.join(", ")}).`, line, "ref-exists");
    if (typeof about !== "string") throw new SpecError(`${what}.${k} must be text.`, line);
    out.set(k, about);
  }
  return out;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && (v.trim() === "" || v.trim() === "-"));
}

/** Level 0–6 for a value: by rank (quantile) or by position between min and max (linear). */
function levelScale(values: number[], scale: "quantile" | "linear"): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0] ?? 0, max = sorted[n - 1] ?? 0;
  if (n < 2 || min === max) return () => 3;
  if (scale === "linear") return (v) => Math.min(6, Math.floor(((v - min) / (max - min)) * 7));
  return (v) => {
    let below = 0, same = 0;
    for (const s of sorted) {
      if (s < v) below++;
      else if (s === v) same++;
    }
    return Math.min(6, Math.floor(((below + (same - 1) / 2) / (n - 1)) * 7));
  };
}

/** The text itself, or a shortened "…" version that fits, or "" when nothing fits. */
function fit(s: string, max: number, px: number, font: "sans" | "mono"): string {
  if (textWidth(s, px, font) <= max) return s;
  const chars = Array.from(s);
  for (let n = chars.length - 1; n > 0; n--) {
    const cut = `${chars.slice(0, n).join("").trimEnd()}…`;
    if (textWidth(cut, px, font) <= max) return cut;
  }
  return "";
}

const SCALE_NOTE = { quantile: "quantile bins", linear: "linear steps" } as const;

function box(r: Rect): string {
  return `x="${num(r.x)}" y="${num(r.y)}" width="${num(Math.max(0, r.w))}" height="${num(Math.max(0, r.h))}"`;
}

export const blockModule: BlockModule<HeatmapBlock> = {
  type: "heatmap",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "heatmap", line);
    allowKeys(data, ["id", "title", "rows", "columns", "values", "format", "scale", "rowAbout", "columnAbout", "unit", "notes", "caveat", "story"], "heatmap", line);
    const id = requireString(data, "id", "heatmap", line);
    const where = `heatmap "${id}"`;
    const title = optString(data, "title", where, line);
    const format = parseFormat(data.format, line);
    const scale = data.scale ?? "quantile";
    if (scale !== "quantile" && scale !== "linear") {
      throw new SpecError(`${where}: scale must be quantile or linear, got ${JSON.stringify(scale)}.`, line);
    }
    const rowLabels = labels(data.rows, `${where} rows`, line);
    const colLabels = labels(data.columns, `${where} columns`, line);
    const rowAbout = aboutMap(data.rowAbout, rowLabels, `${where} rowAbout`, "the rows", line);
    const colAbout = aboutMap(data.columnAbout, colLabels, `${where} columnAbout`, "the columns", line);

    const rowsRaw = list(data.values, `${where} values`, line);
    if (rowsRaw.length !== rowLabels.length) {
      throw new SpecError(`${where} values has ${rowsRaw.length} rows but rows lists ${rowLabels.length}; give one list per row.`, line);
    }
    const grid: (number | null)[][] = rowsRaw.map((r, i) => {
      const rw = `${where} values row ${i + 1} (${rowLabels[i]})`;
      const cells = list(r, rw, line);
      if (cells.length !== colLabels.length) {
        throw new SpecError(`${rw} has ${cells.length} values but columns lists ${colLabels.length}; use null for an empty cell.`, line);
      }
      return cells.map((v, j) => (isEmpty(v) ? null : number(v, `${where} value at ${rowLabels[i]} × ${colLabels[j]}`, line)));
    });

    if (rowLabels.length > MAX_ROWS || colLabels.length > MAX_COLS) {
      ctx.warn({
        rule: "budget-nodes",
        severity: "warn",
        message: `${where} has ${rowLabels.length} × ${colLabels.length} cells; keep it within ${MAX_ROWS} × ${MAX_COLS}. Aggregate the columns (days → weeks) or split the rows into two heatmaps.`,
        line,
      });
    }

    const flat = grid.flat().filter((v): v is number => v !== null);
    const level = levelScale(flat, scale);
    const taken = new Set<string>();
    const rows = rowLabels.map((label) => ({ id: idFrom(label, taken, `${id}-row-`), label, about: rowAbout.get(label) }));
    const columns = colLabels.map((label) => ({ id: idFrom(label, taken, `${id}-col-`), label, about: colAbout.get(label) }));
    const cells = grid.map((r, i) =>
      r.map((v, j) => (v === null ? null : { id: idFrom(`${rowLabels[i]} ${colLabels[j]}`, taken, `${id}-`), value: v, level: level(v) })),
    );
    const range: [number, number] | undefined = flat.length ? [Math.min(...flat), Math.max(...flat)] : undefined;
    return { type: "heatmap", id, title, line, format, scale, rows, columns, cells, range, unit: parseUnit(data.unit, line), ...readingSpec(data, line) };
  },

  render(b, ctx) {
    const theme = ctx.theme;
    const pad = theme.grid.pad, px = theme.type.nodeSub, tag = theme.type.tag;
    const nR = b.rows.length, nC = b.columns.length;

    // Row labels on the left, sized to the longest one (capped: longer ones are shortened, the model keeps the full text).
    const rowTextW = Math.min(W * 0.28, Math.max(...b.rows.map((r) => textWidth(r.label, px, "sans"))));
    const x0 = pad + Math.ceil(rowTextW) + 16;
    // Column labels sit flat when they fit their column, otherwise they turn 45° and reserve room on the right.
    const colTextW = Math.max(...b.columns.map((c) => textWidth(c.label, tag, "sans")));
    const flatW = (W - pad - x0) / nC;
    const rotate = colTextW > flatW - 8;
    const colTextMax = rotate ? Math.min(colTextW, 120) : flatW - 8;
    const diag = rotate ? colTextMax * Math.SQRT1_2 : 0;
    const cw = (W - pad - x0 - diag) / nC;
    const ch = Math.max(28, Math.min(40, cw * 0.7));
    const headH = rotate ? Math.ceil(diag) + tag + 8 : tag + 14;
    const y0 = pad / 2 + headH;
    const parts: string[] = [];
    const anchors: Record<string, Frame> = {};
    const labelBoxes: Frame[] = [];
    // a head's hit area is clear gutter; note markers only need to keep off its visible label
    const headText: Record<string, Frame> = {};

    b.columns.forEach((c, j) => {
      const cx = x0 + j * cw + cw / 2;
      const ly = y0 - 8;
      const lab = fit(c.label, colTextMax, tag, "sans");
      const label = rotate
        ? text(cx, ly, lab, "x-tick-label", "start", ` transform="rotate(-45 ${num(cx)} ${num(ly)})"`)
        : text(cx, ly, lab, "x-tick-label", "middle");
      const hit = { x: x0 + j * cw + 1, y: pad / 2, w: cw - 2, h: headH - 2 };
      anchors[c.id] = hit;
      const lw = textWidth(lab, tag, "sans");
      // a turned label runs across the whole head strip; a flat one is only as wide as its text
      headText[c.id] = rotate ? hit : { x: cx - lw / 2, y: ly - tag * 0.8, w: lw, h: tag };
      labelBoxes.push(headText[c.id]);
      parts.push(mark({ id: c.id, label: c.label, cls: "x-grid-head", attrs: ` data-nav="-1,${j}"` }, `<rect class="x-mark-shape" ${box(hit)}/>${label}`));
    });

    b.rows.forEach((row, i) => {
      const y = y0 + i * ch;
      const hit = { x: pad, y: y + 1, w: x0 - pad - 4, h: ch - 2 };
      anchors[row.id] = hit;
      const rowLab = fit(row.label, rowTextW, px, "sans");
      const label = text(x0 - 10, y + ch / 2 + px * 0.35, rowLab, "x-mark-label", "end");
      const rw = textWidth(rowLab, px, "sans");
      headText[row.id] = { x: x0 - 10 - rw, y: y + ch / 2 - px / 2, w: rw, h: px };
      labelBoxes.push(headText[row.id]);
      parts.push(mark({ id: row.id, label: row.label, cls: "x-grid-head", attrs: ` data-nav="${i},-1"` }, `<rect class="x-mark-shape" ${box(hit)}/>${label}`));

      b.columns.forEach((col, j) => {
        const cell = b.cells[i]?.[j] ?? null;
        const r = { x: x0 + j * cw + 1, y: y + 1, w: cw - 2, h: ch - 2 };
        if (!cell) {
          // Not selectable, but charts-grids.css fades it with the rest of the grid while something is lit.
          parts.push(`<rect class="x-heat-empty" ${box(r)}/>`);
          return;
        }
        anchors[cell.id] = r;
        const value = fmt(cell.value, b.format);
        const vw = textWidth(value, px, "sans");
        const show = cw >= 36 && vw <= r.w - 8 && r.h >= px + 8;
        if (show) labelBoxes.push({ x: r.x + r.w / 2 - vw / 2, y: r.y + r.h / 2 - px / 2, w: vw, h: px });
        const valueText = show ? text(r.x + r.w / 2, r.y + r.h / 2 + px * 0.35, value, "x-mark-label x-on-fill", "middle") : "";
        parts.push(mark(
          { id: cell.id, label: `${row.label} · ${col.label}`, value, cls: "x-cell", attrs: ` data-level="${cell.level}"${rampInk(theme, cell.level)} data-nav="${i},${j}"` },
          `<rect class="x-mark-shape" ${box(r)}/>${valueText}`,
        ));
      });
    });

    // Ramp legend: min label, 7 swatches, max label, and how values map to the swatches.
    let bottom = y0 + nR * ch;
    if (b.range) {
      const ly = bottom + 16;
      const lo = fmt(b.range[0], b.format), hi = fmt(b.range[1], b.format);
      const base = ly + 5 + tag * 0.35;
      const ramp = [text(x0, base, lo, "x-tick-label")];
      const sx = x0 + textWidth(lo, tag, "sans") + 8;
      for (let k = 0; k <= 6; k++) {
        ramp.push(`<rect class="x-ramp-swatch" data-level="${k}" x="${num(sx + k * 22)}" y="${num(ly)}" width="20" height="10" rx="2"/>`);
      }
      const hx = sx + 7 * 22 + 6;
      ramp.push(text(hx, base, hi, "x-tick-label"));
      ramp.push(text(hx + textWidth(hi, tag, "sans") + 12, base, SCALE_NOTE[b.scale], "x-tick-label x-ramp-scale"));
      parts.push(`<g class="x-ramp" aria-hidden="true">${ramp.join("")}</g>`);
      // the ramp is text and swatches a note marker on a bottom-row cell must not cover
      labelBoxes.push(...textBoxes(ramp.join(""), tag), { x: sx, y: ly, w: 7 * 22 - 2, h: 10 });
      bottom = ly + 10;
    }
    parts.push(noteMarkers(b, { ...anchors, ...headText }, { obstacles: labelBoxes, bounds: { x: 0, y: 0, w: W, h: bottom + pad } }));

    const empty = b.cells.flat().filter((c) => c === null).length;
    const desc = b.range
      ? `Each cell is shaded by its value in ${SCALE_NOTE[b.scale]}, from ${fmt(b.range[0], b.format)} (faintest) to ${fmt(b.range[1], b.format)} (strongest)${empty ? `; ${empty} cells have no value` : ""}.`
      : "No cell has a value.";
    return svgFigure({
      id: b.id,
      kind: "heatmap",
      title: b.title,
      label: `Heatmap of ${nR} rows by ${nC} columns`,
      desc,
      width: W,
      height: bottom + pad,
      body: parts.join(""),
    });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const val = (x: number) => fmt(x, b.format);
    const flat = b.cells.flat().filter((c): c is HeatCell => c !== null);
    const values = flat.map((c) => c.value);
    const grand = values.reduce((a, x) => a + x, 0);
    const rowCells = b.rows.map((_, i) => (b.cells[i] ?? []).filter((c): c is HeatCell => c !== null));
    const colCells = b.columns.map((_, j) => b.cells.map((r) => r[j] ?? null).filter((c): c is HeatCell => c !== null));
    const where = new Map<string, [number, number]>();
    b.cells.forEach((r, i) => r.forEach((c, j) => { if (c) where.set(c.id, [i, j]); }));
    const nameIn = (c: HeatCell, axis: "row" | "col") => {
      const [i, j] = where.get(c.id) ?? [0, 0];
      return axis === "row" ? b.columns[j]?.label ?? "" : b.rows[i]?.label ?? "";
    };
    const extremes = (cells: HeatCell[]) => {
      let hi = cells[0], lo = cells[0];
      for (const c of cells) {
        if (hi && c.value > hi.value) hi = c;
        if (lo && c.value < lo.value) lo = c;
      }
      return { hi, lo };
    };
    const place = (x: number, all: number[]) => {
      const up = rank(x, all), down = rank(x, all, "asc");
      if (all.length > 1 && up.n === 1) return `highest of ${all.length}`;
      if (all.length > 1 && down.n === 1) return `lowest of ${all.length}`;
      return up.nth;
    };
    const headCard = (label: string, cells: HeatCell[], axis: "row" | "col", totals: number[], noun: string) => {
      const total = cells.reduce((a, c) => a + c.value, 0);
      const { hi, lo } = extremes(cells);
      const facts: Fact[] = [
        { k: "Share of all", v: share(total, grand), raw: grand ? (total / grand) * 100 : 0 },
        { k: "Rank", v: `${rank(total, totals).nth} ${noun}s` },
      ];
      if (hi) facts.push({ k: "Peak", v: `${nameIn(hi, axis)} · ${val(hi.value)}`, ref: hi.id });
      if (lo && lo !== hi) facts.push({ k: "Lowest", v: `${nameIn(lo, axis)} · ${val(lo.value)}`, ref: lo.id });
      const say = `${label}, ${val(total)} in total, ${share(total, grand)} of all${hi ? `, peak ${nameIn(hi, axis)} ${val(hi.value)}` : ""}`;
      return { value: cells.length ? val(total) : undefined, facts, say, total };
    };

    const rowTotals = rowCells.map((cs) => cs.reduce((a, c) => a + c.value, 0));
    const colTotals = colCells.map((cs) => cs.reduce((a, c) => a + c.value, 0));
    b.rows.forEach((row, i) => {
      const cells = rowCells[i] ?? [];
      const card = headCard(row.label, cells, "row", rowTotals, "row");
      elements[row.id] = groupInfo({
        id: row.id, label: row.label, figure: b.id, kind: "row", about: row.about, members: cells.map((c) => c.id),
        value: card.value, facts: card.facts, pos: `${i + 1} of ${b.rows.length}`, say: card.say,
      });
    });
    b.columns.forEach((col, j) => {
      const cells = colCells[j] ?? [];
      const card = headCard(col.label, cells, "col", colTotals, "column");
      elements[col.id] = groupInfo({
        id: col.id, label: col.label, figure: b.id, kind: "column", about: col.about, members: cells.map((c) => c.id),
        value: card.value, facts: card.facts, pos: `${j + 1} of ${b.columns.length}`, say: card.say,
      });
    });

    b.rows.forEach((row, i) => {
      b.columns.forEach((col, j) => {
        const c = b.cells[i]?.[j];
        if (!c) return;
        const inRow = rowCells[i] ?? [], inCol = colCells[j] ?? [];
        const rowTotal = rowTotals[i] ?? 0;
        const colAvg = inCol.reduce((a, x) => a + x.value, 0) / Math.max(1, inCol.length);
        const r = rank(c.value, values);
        const rowX = extremes(inRow), colX = extremes(inCol);
        // Row neighbour: its peak, or its low when this cell is the peak. Column neighbour: its low, or its peak.
        const rowRef = rowX.hi && rowX.hi.id !== c.id ? { k: `${row.label} peak`, c: rowX.hi } : rowX.lo && rowX.lo.id !== c.id ? { k: `${row.label} low`, c: rowX.lo } : null;
        const colRef = colX.lo && colX.lo.id !== c.id ? { k: `Lowest ${col.label}`, c: colX.lo } : colX.hi && colX.hi.id !== c.id ? { k: `Highest ${col.label}`, c: colX.hi } : null;
        const facts: Fact[] = [
          { k: "Rank", v: place(c.value, values) },
          { k: "Row share", v: `${share(c.value, rowTotal)} of ${row.label} (${val(rowTotal)})`, raw: rowTotal ? (c.value / rowTotal) * 100 : 0 },
        ];
        if (inCol.length > 1) facts.push({ k: `vs ${col.label} average`, v: `${ratio(c.value, colAvg)} (${val(colAvg)})`, tone: trend(c.value - colAvg) });
        if (colRef) facts.push({ k: colRef.k, v: `${b.rows[where.get(colRef.c.id)?.[0] ?? 0]?.label} · ${val(colRef.c.value)}`, ref: colRef.c.id, raw: colRef.c.value });
        if (rowRef) facts.push({ k: rowRef.k, v: `${b.columns[where.get(rowRef.c.id)?.[1] ?? 0]?.label} · ${val(rowRef.c.value)}`, ref: rowRef.c.id, raw: rowRef.c.value });
        elements[c.id] = itemInfo({
          id: c.id, label: `${row.label} · ${col.label}`, figure: b.id, kind: "cell",
          value: val(c.value), related: [row.id, col.id],
          context: [...inRow, ...inCol].filter((x) => x.id !== c.id).map((x) => x.id),
          facts, pos: r.text, crumb: [row.id],
          links: [{ rel: "Row", ids: [row.id] }, { rel: "Column", ids: [col.id] }],
          say: `${row.label} · ${col.label}, ${val(c.value)}${b.unit ? ` ${b.unit}` : ""}, ${place(c.value, values)}, ${share(c.value, rowTotal)} of ${row.label}`,
        });
      });
    });
    return { elements };
  },

  reading(b) {
    const bins = b.scale === "quantile"
      ? "7 quantile bins, so each shade holds about the same number of cells"
      : b.range ? `7 equal steps from ${fmt(b.range[0], b.format)} to ${fmt(b.range[1], b.format)}` : "7 equal steps";
    return `Each cell ${b.unit ? `counts ${b.unit}` : "is one value"} for its row and column, printed when it fits. Shade uses ${bins}; the strongest shade is the highest value${b.cells.flat().some((c) => c === null) ? ", and a dashed cell has no value" : ""}.`;
  },

  table(b) {
    return {
      head: ["", ...b.columns.map((c) => c.label)],
      rows: b.rows.map((r, i) => [r.label, ...b.columns.map((_, j) => {
        const c = b.cells[i]?.[j];
        return c ? fmt(c.value, b.format) : "—";
      })]),
    };
  },
};
