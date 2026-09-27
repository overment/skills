// Shared kit for every block beyond the grid figure: charts, boards and structures.
// Renderers emit geometry and classes only; color, type and states come from base.css and blocks/*.css.
import { textWidth } from "./figure/grid.ts";
import { pathD } from "./figure/render.ts";
import { esc, isObj } from "./blocks/util.ts";
import {
  SpecError, type BandSpec, type ElementInfo, type Fact, type Link, type MarkStat, type NoteSpec, type ReadingSpec,
  type RefMarkSpec, type ScaleSpec, type StoryStep, type Theme, type Unit,
} from "./types.ts";

export { esc };

// ---------- numbers and text ----------

/** SVG coordinate: one decimal, no "-0". */
export function num(v: number): string {
  const r = Math.round(v * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
}

export type Format = "auto" | "int" | "1" | "2" | "%" | "k" | "$" | "€" | "zł" | "h" | "d";

/** Readable number for labels and the detail panel. `auto` picks int, one decimal or k/M. */
export function fmt(v: number, format: Format = "auto"): string {
  const group = (n: number, digits = 0) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const short = (n: number) => {
    const a = Math.abs(n);
    if (a >= 1e9) return `${group(n / 1e9, a >= 1e10 ? 0 : 1)}B`;
    if (a >= 1e6) return `${group(n / 1e6, a >= 1e7 ? 0 : 1)}M`;
    if (a >= 1e4) return `${group(n / 1e3, 0)}k`;
    return group(n, Number.isInteger(n) ? 0 : 1);
  };
  // k, M or B from 1,000 up, one decimal below 10 of the unit: "7.6k", "21k", "1.2M". Never "7,600" next to "21k".
  const kilo = (n: number) => {
    const a = Math.abs(n);
    if (a < 1e3) return group(n, Number.isInteger(n) ? 0 : 1);
    const [div, suffix] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1e3, "k"];
    const s = n / div;
    return `${group(s, Math.abs(s) >= 9.95 ? 0 : 1).replace(/\.0$/, "")}${suffix}`;
  };
  switch (format) {
    case "int": return group(Math.round(v));
    case "1": return group(v, 1);
    case "2": return group(v, 2);
    case "%": return `${group(v, Number.isInteger(v) ? 0 : 1)}%`;
    case "k": return kilo(v);
    case "$": return `${v < 0 ? "−" : ""}$${short(Math.abs(v))}`;
    case "€": return `${v < 0 ? "−" : ""}€${short(Math.abs(v))}`;
    case "zł": return `${short(v)} zł`;
    case "h": return `${group(v, Number.isInteger(v) ? 0 : 1)} h`;
    case "d": return `${group(v, 0)} d`;
    default: return short(v);
  }
}

export const FORMATS: readonly Format[] = ["auto", "int", "1", "2", "%", "k", "$", "€", "zł", "h", "d"];

/**
 * Labels for one axis. With `k` every tick takes the unit of the largest one (k, M or B) and only as many decimals
 * as it takes for no two ticks to read alike: "0, 2.5k, 5k", "12k, 12.5k, 13k". Other formats go through `fmt`.
 */
export function fmtTicks(values: number[], format: Format = "auto"): string[] {
  if (format !== "k") return values.map((v) => fmt(v, format));
  const top = Math.max(0, ...values.map((v) => Math.abs(v)));
  const [div, suffix] = top >= 1e9 ? [1e9, "B"] : top >= 1e6 ? [1e6, "M"] : top >= 1e3 ? [1e3, "k"] : [1, ""];
  let out: string[] = [];
  for (let digits = 0; digits <= 3; digits++) {
    out = values.map((v) => (v === 0 ? "0" : `${(v / div).toLocaleString("en-US", { maximumFractionDigits: digits })}${suffix}`));
    if (new Set(out).size === values.length) break;
  }
  return out;
}

/** Greedy word wrap by estimated width. Never breaks inside a word. */
export function wrap(text: string, maxWidth: number, px: number, font: "sans" | "mono" = "sans"): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, px, font) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** `<text>` with escaped content. `cls` picks the role: x-tick-label, x-axis-label, x-value-label, x-mark-label. */
export function text(x: number, y: number, content: string, cls: string, anchor: "start" | "middle" | "end" = "start", extra = ""): string {
  return `<text class="${cls}" x="${num(x)}" y="${num(y)}"${anchor === "start" ? "" : ` text-anchor="${anchor}"`}${extra}>${esc(content)}</text>`;
}

// ---------- scales ----------

export interface Linear {
  (v: number): number;
  domain: [number, number];
  range: [number, number];
  ticks(count?: number): number[];
}

/** Nice round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Linear scale. `nice` widens the domain to round ticks; `zero` keeps 0 in the domain (bars must start at 0). */
export function linear(domain: [number, number], range: [number, number], opts: { nice?: boolean; zero?: boolean; count?: number } = {}): Linear {
  let [d0, d1] = domain;
  if (opts.zero) { d0 = Math.min(0, d0); d1 = Math.max(0, d1); }
  if (d0 === d1) { d0 -= 1; d1 += 1; }
  if (opts.nice !== false) {
    const t = niceTicks(d0, d1, opts.count ?? 5);
    const step = t.length > 1 ? t[1] - t[0] : 1;
    d0 = Math.min(d0, Math.floor(d0 / step) * step);
    d1 = Math.max(d1, Math.ceil(d1 / step) * step);
  }
  const [r0, r1] = range;
  const f = ((v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)) as Linear;
  f.domain = [d0, d1];
  f.range = range;
  f.ticks = (count = opts.count ?? 5) => niceTicks(d0, d1, count);
  return f;
}

export interface Band {
  (key: string): number;
  bandwidth: number;
  step: number;
  keys: string[];
}

/** Categorical scale: `band(k)` is the start of k's band. */
export function band(keys: string[], range: [number, number], paddingInner = 0.25, paddingOuter = 0.15): Band {
  const [r0, r1] = range;
  const n = Math.max(1, keys.length);
  const step = (r1 - r0) / (n - paddingInner + 2 * paddingOuter);
  const bw = step * (1 - paddingInner);
  const pos = new Map(keys.map((k, i) => [k, r0 + step * paddingOuter + i * step]));
  const f = ((k: string) => pos.get(k) ?? r0) as Band;
  f.bandwidth = bw;
  f.step = step;
  f.keys = keys;
  return f;
}

// ---------- plot frame and axes ----------

export interface Frame { x: number; y: number; w: number; h: number }

/** Space around a plot for axis labels. Sizes follow the theme's tag size. */
export function plotFrame(width: number, height: number, theme: Theme, opts: { left?: number; bottom?: number; top?: number; right?: number } = {}): Frame {
  const pad = theme.grid.pad;
  const left = opts.left ?? 64, bottom = opts.bottom ?? 48, top = opts.top ?? pad / 2, right = opts.right ?? pad;
  return { x: left, y: top, w: width - left - right, h: height - top - bottom };
}

/** Horizontal axis at the bottom of the frame: baseline, tick labels, optional vertical gridlines and title. */
export function axisX(frame: Frame, ticks: { at: number; label: string }[], opts: { grid?: boolean; title?: string } = {}): string {
  const y = frame.y + frame.h;
  const parts = [`<line class="x-axis-line" x1="${num(frame.x)}" y1="${num(y)}" x2="${num(frame.x + frame.w)}" y2="${num(y)}"/>`];
  for (const t of ticks) {
    if (opts.grid) parts.push(`<line class="x-grid-line" x1="${num(t.at)}" y1="${num(frame.y)}" x2="${num(t.at)}" y2="${num(y)}"/>`);
    parts.push(text(t.at, y + 20, t.label, "x-tick-label", "middle"));
  }
  if (opts.title) parts.push(text(frame.x + frame.w, y + 40, opts.title, "x-axis-label", "end"));
  return `<g class="x-axis x-axis-x">${parts.join("")}</g>`;
}

/** Vertical axis on the left of the frame: tick labels and horizontal gridlines (on by default). */
export function axisY(frame: Frame, ticks: { at: number; label: string }[], opts: { grid?: boolean; title?: string } = {}): string {
  const parts: string[] = [];
  for (const t of ticks) {
    if (opts.grid !== false) parts.push(`<line class="x-grid-line" x1="${num(frame.x)}" y1="${num(t.at)}" x2="${num(frame.x + frame.w)}" y2="${num(t.at)}"/>`);
    parts.push(text(frame.x - 8, t.at + SMALL * 0.35, t.label, "x-tick-label", "end"));
  }
  if (opts.title) parts.push(text(frame.x, frame.y - 8, opts.title, "x-axis-label", "start"));
  return `<g class="x-axis x-axis-y">${parts.join("")}</g>`;
}

// ---------- marks, series, legend ----------

/** 1-based palette slot for the i-th series (0-based), cycling through the theme's palette. */
export function seriesSlot(i: number, theme: Theme): number {
  return (i % theme.series.light.length) + 1;
}

export interface MarkOpts {
  id: string;
  label: string;          // what a screen reader and the detail panel call it
  value?: string;         // formatted value
  series?: number;        // palette slot, sets data-series (fill/stroke color)
  focal?: boolean;        // the one mark the reader should look at: accent color
  cls?: string;           // extra classes, e.g. "x-bar", "x-point"
  attrs?: string;         // extra attributes, already escaped
}

/**
 * A selectable element. `shape` is its SVG (or HTML when `html` is true) with class `x-mark-shape` on the painted part.
 * Clicking selects it, the detail panel shows label, value and about, and everything unrelated dims.
 */
export function mark(o: MarkOpts, shape: string, html = false): string {
  const aria = o.value ? `${o.label}: ${o.value}` : o.label;
  const tag = html ? "div" : "g";
  const series = o.series ? ` data-series="${o.series}"` : "";
  const focal = o.focal ? ` data-focal="true"` : "";
  return `<${tag} class="x-mark${o.cls ? ` ${o.cls}` : ""}" data-id="${esc(o.id)}"${series}${focal} tabindex="0" role="button" aria-label="${esc(aria)}"${o.attrs ?? ""}>${shape}</${tag}>`;
}

export interface LegendItem { id?: string; label: string; series?: number; kind?: string }

/**
 * Legend strip. Items with an `id` are selectable (select a series → its marks light up).
 * `kind` picks the swatch: "swatch" (default), "line", "dash", "dot".
 */
export function legend(items: LegendItem[], theme: Theme, left: number, right: number, top: number): { svg: string; height: number } {
  const px = theme.type.tag;
  const parts = [`<line class="x-legend-rule" x1="${num(left)}" y1="${num(top)}" x2="${num(right)}" y2="${num(top)}"/>`];
  let x = left, row = 0;
  for (const it of items) {
    const w = 24 + textWidth(it.label, px, "sans");
    if (x > left && x + w > right) { x = left; row++; }
    const cy = top + 24 + row * 24;
    const sw = it.kind === "line" || it.kind === "dash"
      ? `<line class="x-legend-line${it.kind === "dash" ? " x-dash" : ""}" x1="${num(x)}" y1="${num(cy)}" x2="${num(x + 16)}" y2="${num(cy)}"/>`
      : it.kind === "dot"
        ? `<circle class="x-legend-swatch" cx="${num(x + 8)}" cy="${num(cy)}" r="4.5"/>`
        : `<rect class="x-legend-swatch" x="${num(x)}" y="${num(cy - 5)}" width="16" height="10" rx="2"/>`;
    const sel = it.id ? ` data-id="${esc(it.id)}" tabindex="0" role="button" aria-label="${esc(it.label)}"` : "";
    const series = it.series ? ` data-series="${it.series}"` : "";
    parts.push(`<g class="x-legend-item"${series}${sel}>${sw}${text(x + 22, cy + px * 0.35, it.label, "x-legend-label")}</g>`);
    x += w + 24;
  }
  return { svg: `<g class="x-legend">${parts.join("")}</g>`, height: 48 + row * 24 };
}

// ---------- figure shell ----------

export interface FigureOpts {
  id: string;
  kind: string;            // block type, becomes data-layout
  title?: string;          // caption above the figure (hidden in bare view)
  label: string;           // accessible name when there is no title
  desc: string;            // one sentence on what the figure shows
  width: number;
  height: number;
  body: string;            // SVG content, painted in order
  defs?: string;           // inner <defs> content (markers, patterns)
}

/** The standard `<figure>` + accessible `<svg>` wrapper every SVG block uses; the svg sits in the figure's `.x-stage`. */
export function svgFigure(o: FigureOpts): string {
  const caption = o.title ? `<figcaption class="x-figure-title">${esc(o.title)}</figcaption>` : "";
  const svg = `<svg class="x-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(o.width)} ${num(o.height)}" width="${num(o.width)}" height="${num(o.height)}" role="group" aria-label="${esc(o.title ?? o.label)}" aria-describedby="${esc(o.id)}-desc">` +
    `<desc id="${esc(o.id)}-desc">${esc(o.desc)}</desc>` +
    (o.defs ? `<defs>${o.defs}</defs>` : "") +
    `${o.body}</svg>`;
  return `<figure class="x-figure x-chart" data-figure="${esc(o.id)}" data-layout="${esc(o.kind)}">${caption}${stageWrap(svg)}</figure>`;
}

/** The same wrapper for HTML blocks (boards, lanes): a figure with an accessible name and a CSS grid body in its `.x-stage`. */
export function htmlFigure(o: { id: string; kind: string; title?: string; label: string; body: string; cls?: string }): string {
  const caption = o.title ? `<figcaption class="x-figure-title">${esc(o.title)}</figcaption>` : "";
  return `<figure class="x-figure x-board${o.cls ? ` ${o.cls}` : ""}" data-figure="${esc(o.id)}" data-layout="${esc(o.kind)}" role="group" aria-label="${esc(o.title ?? o.label)}">${caption}${stageWrap(o.body)}</figure>`;
}

/** Arrow markers for blocks with connectors, ids prefixed by the figure id. */
export function arrowDefs(fid: string): string {
  const m = (id: string, cls: string) =>
    `<marker id="${esc(fid)}-${id}" viewBox="0 0 8 8" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path class="${cls}" d="M0,0 L8,4 L0,8 z"/></marker>`;
  return m("arrow", "x-arrowhead") + m("arrow-link", "x-arrowhead x-arrowhead-link");
}

// ---------- model ----------

/** Card fields every model entry may carry. Empty strings and empty lists are left out. */
export interface CardOpts { facts?: Fact[]; links?: Link[]; context?: string[]; pos?: string; crumb?: string[]; say?: string }

function withCard(info: ElementInfo, o: CardOpts): ElementInfo {
  if (o.facts?.length) info.facts = factList(o.facts);
  const links = o.links?.filter((l) => l.ids.length);
  if (links?.length) info.links = links;
  if (o.context?.length) info.context = o.context;
  if (o.pos) info.pos = o.pos;
  if (o.crumb?.length) info.crumb = o.crumb;
  if (o.say) info.say = o.say;
  return info;
}

/** Model entry for a chart mark, card or row. `related` lights up with it (its series, column, lane…). */
export function itemInfo(o: { id: string; label: string; figure: string; kind?: string; value?: string; sub?: string; about?: string; related?: string[] } & CardOpts): ElementInfo {
  const info: ElementInfo = { id: o.id, type: "item", label: o.label, figure: o.figure };
  if (o.kind) info.kind = o.kind;
  if (o.value) info.value = o.value;
  if (o.sub) info.sub = o.sub;
  if (o.about) info.about = o.about;
  if (o.related?.length) info.related = o.related;
  return withCard(info, o);
}

/** Model entry for a series, column or lane: selecting it lights up every member. */
export function groupInfo(o: { id: string; label: string; figure: string; members: string[]; kind?: string; value?: string; about?: string } & CardOpts): ElementInfo {
  const info: ElementInfo = { id: o.id, type: "group", label: o.label, figure: o.figure, members: o.members };
  if (o.kind) info.kind = o.kind;
  if (o.value) info.value = o.value;
  if (o.about) info.about = o.about;
  return withCard(info, o);
}

// ---------- parsing ----------

export function number(v: unknown, what: string, line: number): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[_,\s]/g, "")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new SpecError(`${what} must be a number, got ${JSON.stringify(v)}.`, line);
  return n;
}

export function list(v: unknown, what: string, line: number): unknown[] {
  if (!Array.isArray(v)) throw new SpecError(`${what} must be a list (- item per line or [a, b]).`, line);
  return v;
}

export function format(v: unknown, line: number): Format {
  if (v === undefined) return "auto";
  const f = String(v) as Format;
  if (!FORMATS.includes(f)) throw new SpecError(`format must be one of ${FORMATS.join(", ")}.`, line);
  return f;
}

/** Stable id from free text, unique within `taken` (adds -2, -3…). */
export function idFrom(textValue: string, taken: Set<string>, prefix = ""): string {
  const base = (prefix + textValue).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

export { isObj };

// ---------- connectors ----------

export { routeEdges, type Point } from "./figure/route.ts";
export { cellRect, groupRect, textWidth } from "./figure/grid.ts";

/** Rounded right-angle path through `points` (corners r ≤ 8), the same stroke the grid figure draws. */
export function orthoPath(points: [number, number][]): string {
  return pathD(points, new Map());
}

// ---------- facts (computed in model(), rendered by the card) ----------

const MINUS = "−";
const PREFIX_UNITS = new Set(["$", "€", "£", "¥"]);
const MAX_FACTS = 5;

/** Percent with one decimal below 10 ("8.8%", "30%", "0.5%"), true minus. */
export function pct(v: number): string {
  // Round once: 24.48 is "24%", not 24.5 → "25%".
  const a = Math.abs(v), one = Math.round(a * 10) / 10;
  const body = one < 10 ? (Number.isInteger(one) ? String(one) : one.toFixed(1)) : String(Math.round(a));
  return `${v < 0 && body !== "0" ? MINUS : ""}${body}%`;
}

/**
 * A value with its unit: `$` `€` `£` `¥` go before ("$1.2k"), `%` sticks after ("8.8%"), anything else
 * follows a space ("930 signups", "3.5 s"). Negatives get a true minus. With a unit, `format` only picks the precision.
 */
export function fmtUnit(v: number, unit?: Unit, format: Format = "auto"): string {
  if (!unit) return fmt(v, format).replace(/^-/, MINUS);
  if (unit === "%" && format === "auto") return pct(v);
  const plain: Format = ["auto", "int", "1", "2", "k"].includes(format) ? format : "auto";
  const body = fmt(Math.abs(v), plain);
  const sign = v < 0 && /[1-9]/.test(body) ? MINUS : "";
  if (PREFIX_UNITS.has(unit)) return `${sign}${unit}${body}`;
  return unit === "%" ? `${sign}${body}%` : `${sign}${body} ${unit}`;
}

/** Always-signed value: "+1,200", "−3,190 signups", "+$40". Zero (after rounding) has no sign. */
export function signed(v: number, unit?: Unit, format: Format = "auto"): string {
  const body = fmtUnit(Math.abs(v), unit, format);
  if (body === fmtUnit(0, unit, format)) return body;
  return `${v < 0 ? MINUS : "+"}${body}`;
}

/** `v` minus `ref`, signed: delta(930, 4120) → "−3,190". */
export function delta(v: number, ref: number, unit?: Unit, format: Format = "auto"): string {
  return signed(v - ref, unit, format);
}

/** `v` over `ref` as a multiple: "2.3×", "12×". "—" when `ref` is 0. */
export function ratio(v: number, ref: number): string {
  const r = v / ref;
  if (!Number.isFinite(r)) return "—";
  const a = Math.abs(r);
  const body = a >= 10 ? fmt(Math.round(a), "int") : a.toFixed(1).replace(/\.0$/, "");
  return `${r < 0 ? MINUS : ""}${body}×`;
}

/** `part` as a share of `total`: "8.8%". "—" when the total is 0. */
export function share(part: number, total: number): string {
  return total ? pct((part / total) * 100) : "—";
}

/** 1 → "1st", 12 → "12th", 23 → "23rd". */
export function ordinal(n: number): string {
  const t = n % 100;
  return `${n}${t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * Rank of `v` among `values`, 1 = largest ("asc": smallest). Ties share the better rank.
 * `text` is "5 of 7" (for pos and facts), `nth` is "5th of 7" (for say lines).
 */
export function rank(v: number, values: number[], dir: "desc" | "asc" = "desc"): { n: number; of: number; text: string; nth: string } {
  const n = 1 + values.filter((x) => (dir === "desc" ? x > v : x < v)).length;
  return { n, of: values.length, text: `${n} of ${values.length}`, nth: `${ordinal(n)} of ${values.length}` };
}

/** Direction of a change, for Fact.tone. */
export function trend(d: number): "up" | "down" | "flat" {
  return d > 0 ? "up" : d < 0 ? "down" : "flat";
}

/** Drops empty rows and keeps the first 5, the card's budget. */
export function factList(rows: (Fact | false | null | undefined)[]): Fact[] {
  return rows.filter((f): f is Fact => !!f && f.v !== "").slice(0, MAX_FACTS);
}

// ---------- shared spec keys: notes, caveat, story, marks, bands, unit ----------

export const READING_KEYS = ["notes", "caveat", "story"] as const;
export const SCALE_KEYS = ["marks", "bands", "unit"] as const;
const MAX_NOTES = 4, MAX_MARKS = 2, MAX_BANDS = 3;

function ids(v: unknown, what: string, line: number): string[] {
  const out = typeof v === "string" ? [v] : Array.isArray(v) ? v : null;
  if (!out || !out.every((x) => typeof x === "string" && x.trim())) throw new SpecError(`${what} must be an id or a list of ids.`, line);
  return out.map((x) => (x as string).trim());
}

function only(o: Record<string, unknown>, keys: string[], what: string, line: number): void {
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  if (extra.length) throw new SpecError(`${what} has unknown field "${extra[0]}". Allowed: ${keys.join(", ")}.`, line);
}

function words(v: unknown, what: string, line: number): string {
  if (typeof v !== "string" || !v.trim()) throw new SpecError(`${what} must be text.`, line);
  return v.trim();
}

/** `notes:` → NoteSpec[]. Items are `{on: id | [ids], text}` or plain text (a note without a marker). At most 4. */
export function parseNotes(raw: unknown, line = 0): NoteSpec[] {
  if (raw === undefined || raw === null) return [];
  const items = list(raw, "notes", line);
  if (items.length > MAX_NOTES) throw new SpecError(`notes has ${items.length} items; keep it to ${MAX_NOTES}: the focal fact, the pattern, and what else the reader must not miss.`, line);
  return items.map((it, i) => {
    const what = `notes item ${i + 1}`;
    if (typeof it === "string") return { on: [], text: words(it, what, line) };
    if (!isObj(it)) throw new SpecError(`${what} must be {on: id, text: …} or plain text.`, line);
    only(it, ["on", "text"], what, line);
    return { on: it.on === undefined ? [] : ids(it.on, `${what} on`, line), text: words(it.text, `${what} text`, line) };
  });
}

/** `caveat:` → one sentence, or undefined. */
export function parseCaveat(raw: unknown, line = 0): string | undefined {
  return raw === undefined || raw === null ? undefined : words(raw, "caveat", line);
}

/** `story:` → StoryStep[]. Items are `{sel, cmp?, note?}` or a bare id. */
export function parseStory(raw: unknown, line = 0): StoryStep[] {
  if (raw === undefined || raw === null) return [];
  return list(raw, "story", line).map((it, i) => {
    const what = `story step ${i + 1}`;
    if (typeof it === "string") return { sel: words(it, what, line) };
    if (!isObj(it)) throw new SpecError(`${what} must be {sel: id, note: …} or an id.`, line);
    only(it, ["sel", "cmp", "note"], what, line);
    const step: StoryStep = { sel: words(it.sel, `${what} sel`, line) };
    if (it.cmp !== undefined) step.cmp = words(it.cmp, `${what} cmp`, line);
    if (it.note !== undefined) step.note = words(it.note, `${what} note`, line);
    return step;
  });
}

function markAt(v: unknown, what: string, line: number): number | string {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[_,\s]/g, ""));
    return Number.isFinite(n) ? n : v.trim();
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  throw new SpecError(`${what} must be a number, a date, mean or median.`, line);
}

/** `marks:` → RefMarkSpec[]. Items are `{y: 2 | mean | median, label?}` or `{x: …, label?}`. At most 2. */
export function parseMarks(raw: unknown, line = 0): RefMarkSpec[] {
  if (raw === undefined || raw === null) return [];
  const items = list(raw, "marks", line);
  if (items.length > MAX_MARKS) throw new SpecError(`marks has ${items.length} lines; keep it to ${MAX_MARKS}, the ones the prose argues against.`, line);
  return items.map((it, i) => {
    const what = `marks item ${i + 1}`;
    if (!isObj(it)) throw new SpecError(`${what} must be {y: value, label: …} or {x: value, label: …}.`, line);
    only(it, ["x", "y", "label"], what, line);
    if ((it.x === undefined) === (it.y === undefined)) throw new SpecError(`${what} needs exactly one of x or y.`, line);
    const axis = it.y === undefined ? "x" : "y";
    const mark: RefMarkSpec = { axis, at: markAt(it[axis], `${what} ${axis}`, line) };
    if (it.label !== undefined) mark.label = words(it.label, `${what} label`, line);
    return mark;
  });
}

/** `bands:` → BandSpec[]. Items are `{from, to, label?, axis?}`. At most 3. */
export function parseBands(raw: unknown, line = 0): BandSpec[] {
  if (raw === undefined || raw === null) return [];
  const items = list(raw, "bands", line);
  if (items.length > MAX_BANDS) throw new SpecError(`bands has ${items.length} ranges; keep it to ${MAX_BANDS}.`, line);
  return items.map((it, i) => {
    const what = `bands item ${i + 1}`;
    if (!isObj(it)) throw new SpecError(`${what} must be {from, to, label}.`, line);
    only(it, ["from", "to", "label", "axis"], what, line);
    const out: BandSpec = { from: markAt(it.from, `${what} from`, line), to: markAt(it.to, `${what} to`, line) };
    if (it.axis !== undefined) {
      if (it.axis !== "x" && it.axis !== "y") throw new SpecError(`${what} axis must be x or y.`, line);
      out.axis = it.axis;
    }
    if (it.label !== undefined) out.label = words(it.label, `${what} label`, line);
    return out;
  });
}

/** `unit:` → a short unit word or symbol ("signups", "ms", "$", "%"). */
export function parseUnit(raw: unknown, line = 0): Unit | undefined {
  if (raw === undefined || raw === null) return undefined;
  const u = words(raw, "unit", line);
  if (u.length > 16) throw new SpecError(`unit must be a short word or symbol, got "${u}".`, line);
  return u;
}

/** Reads notes, caveat and story off a block's YAML. Only keys that are present end up in the result. */
export function readingSpec(data: Record<string, unknown>, line = 0): ReadingSpec {
  const out: ReadingSpec = {};
  if (data.notes != null) out.notes = parseNotes(data.notes, line);
  if (data.caveat != null) out.caveat = parseCaveat(data.caveat, line);
  if (data.story != null) out.story = parseStory(data.story, line);
  return out;
}

/** Reads marks, bands and unit off a block's YAML. Only keys that are present end up in the result. */
export function scaleSpec(data: Record<string, unknown>, line = 0): ScaleSpec {
  const out: ScaleSpec = {};
  if (data.marks != null) out.marks = parseMarks(data.marks, line);
  if (data.bands != null) out.bands = parseBands(data.bands, line);
  if (data.unit != null) out.unit = parseUnit(data.unit, line);
  return out;
}

/** The data value a mark stands on: a number as is, `mean` or `median` of `values`. */
export function markValue(at: number | MarkStat, values: number[]): number {
  if (typeof at === "number") return at;
  if (!values.length) return 0;
  if (at === "mean") return values.reduce((a, b) => a + b, 0) / values.length;
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------- annotations: reference lines, bands, note markers ----------

/**
 * Dashed reference rule across the plot at pixel `at`. `{y}` runs left to right with its label above the
 * right end; `{x}` runs top to bottom with its label at the top, flipped left when it would leave the frame.
 */
export function refLine(frame: Frame, at: { x: number } | { y: number }, label?: string, opts: { px?: number; cls?: string } = {}): string {
  const px = opts.px ?? SMALL;
  // Not `x-ref`: that class is a prose reference link, which the client dims, hit-tests and underlines.
  const cls = `x-ref-line${opts.cls ? ` ${opts.cls}` : ""}`;
  if ("y" in at) {
    const t = label ? text(frame.x + frame.w, at.y - 4, label, "x-ref-label", "end") : "";
    return `<g class="${cls}" data-axis="y"><line class="x-ref-rule" x1="${num(frame.x)}" y1="${num(at.y)}" x2="${num(frame.x + frame.w)}" y2="${num(at.y)}"/>${t}</g>`;
  }
  const flip = label ? at.x + 4 + textWidth(label, px, "sans") > frame.x + frame.w : false;
  const t = label ? text(flip ? at.x - 4 : at.x + 4, frame.y + px, label, "x-ref-label", flip ? "end" : "start") : "";
  return `<g class="${cls}" data-axis="x"><line class="x-ref-rule" x1="${num(at.x)}" y1="${num(frame.y)}" x2="${num(at.x)}" y2="${num(frame.y + frame.h)}"/>${t}</g>`;
}

/** Shaded range across the plot between two pixel positions, label in its top-left corner. */
export function refBand(frame: Frame, span: { x: [number, number] } | { y: [number, number] }, label?: string, opts: { px?: number; cls?: string } = {}): string {
  const px = opts.px ?? SMALL;
  const cls = `x-ref-band${opts.cls ? ` ${opts.cls}` : ""}`;
  const [a, b] = "x" in span ? span.x : span.y;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const r = "x" in span ? { x: lo, y: frame.y, w: hi - lo, h: frame.h } : { x: frame.x, y: lo, w: frame.w, h: hi - lo };
  const t = label ? text(r.x + 4, r.y + px + 2, label, "x-ref-label") : "";
  return `<g class="${cls}" data-axis="${"x" in span ? "x" : "y"}"><rect class="x-ref-band-fill" x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}"/>${t}</g>`;
}

/** Note marker radius: a 20px ring holds a 13px number, the smallest text the page renders. */
export const NOTE_R = 10;
/** The label size a number or tag renders at when the caller passes no theme size. */
const SMALL = 13;

function overlap(a: Frame, b: Frame): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Numbered 20px ring markers for a block's notes, one per note with a target in `anchors` (the target's
 * anchor bbox in SVG coordinates; the first of `on` that has one wins). A marker sits just outside its target,
 * never on it: beside a corner, then an edge's middle, then a step further out. It takes the first spot that
 * covers the least of `obstacles` (labels, marks), the target and earlier markers, inside `bounds`.
 * Returns "" when nothing is placed.
 */
export function notes(block: { id?: string; notes?: NoteSpec[] }, anchors: Record<string, Frame>, opts: { obstacles?: Frame[]; bounds?: Frame } = {}): string {
  const placed: Frame[] = [];
  const parts: string[] = [];
  (block.notes ?? []).forEach((note, i) => {
    const target = note.on.find((id) => anchors[id]);
    if (!target) return;
    // spots sit around the selection ring (sel-gap 3 + sel-ring 2), not the bare box, so a marker never touches the ring;
    // a zero-size anchor is an exact spot an engine picked, so it is used as given
    const bare = anchors[target];
    const a = bare.w > 0 && bare.h > 0 ? { x: bare.x - 5, y: bare.y - 5, w: bare.w + 10, h: bare.h + 10 } : bare;
    const r = NOTE_R, d = NOTE_R + 4, far = NOTE_R + 16;
    const candidates: [number, number][] = [
      [a.x + a.w + r, a.y - r], [a.x + a.w + d, a.y + a.h / 2], [a.x + a.w / 2, a.y - d], [a.x - r, a.y - r],
      [a.x + a.w + r, a.y + a.h + r], [a.x - r, a.y + a.h + r], [a.x - d, a.y + a.h / 2], [a.x + a.w / 2, a.y + a.h + d],
      [a.x + a.w + far, a.y - r], [a.x + a.w + far, a.y + a.h / 2], [a.x - far, a.y + a.h / 2], [a.x + a.w / 2, a.y - far],
    ];
    let best = candidates[0], bestScore = Infinity;
    for (const [cx, cy] of candidates) {
      const box = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
      const b = opts.bounds;
      let score = b && (box.x < b.x || box.y < b.y || box.x + box.w > b.x + b.w || box.y + box.h > b.y + b.h) ? 1000 : 0;
      score += overlap(box, a);
      // every other mark with an anchor is in the way too: a marker never sits on a mark
      for (const [id, o] of Object.entries(anchors)) if (id !== target) score += overlap(box, o);
      for (const o of opts.obstacles ?? []) score += overlap(box, o);
      for (const p of placed) score += 3 * overlap(box, p);
      if (score < bestScore) { best = [cx, cy]; bestScore = score; }
    }
    const [cx, cy] = best;
    placed.push({ x: cx - NOTE_R, y: cy - NOTE_R, w: NOTE_R * 2, h: NOTE_R * 2 });
    const n = i + 1;
    parts.push(`<g class="x-note-marker" data-note="${n}" data-for="${esc(note.on.join(" "))}"><circle class="x-note-ring" cx="${num(cx)}" cy="${num(cy)}" r="${NOTE_R}"/>${text(cx, cy + SMALL * 0.35, String(n), "x-note-num", "middle")}</g>`);
  });
  return parts.length ? `<g class="x-notes"${block.id ? ` data-for="${esc(block.id)}"` : ""} aria-hidden="true">${parts.join("")}</g>` : "";
}

// ---------- state hooks and the stage ----------

const hook = (cls: string, inner: string, html: boolean) => (html ? `<span class="${cls}">${inner}</span>` : `<g class="${cls}">${inner}</g>`);

/** Children shown only while the host mark is selected: reference rule at its value, drop-lines, slack ghosts. */
export function onSel(svg: string, html = false): string {
  return hook("x-on-sel", svg, html);
}

/** Children shown only while the host mark is related to the selection. */
export function onRel(svg: string, html = false): string {
  return hook("x-on-rel", svg, html);
}

/** Children shown only while the host mark is hovered or focused: crosshair rule, halo dots. */
export function onHover(svg: string, html = false): string {
  return hook("x-on-hover", svg, html);
}

/** The positioning box around a figure's svg or board; the card, leader and note overlay live inside it. */
export function stageWrap(inner: string): string {
  return `<div class="x-stage">${inner}</div>`;
}
