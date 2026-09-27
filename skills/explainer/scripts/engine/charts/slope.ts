// Slope chart: each item moves from one column to the other; labels and values sit on both axes.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type ReadingSpec, type Unit } from "../types.ts";
import {
  READING_KEYS, delta, factList, fmtUnit, format as readFormat, idFrom, isObj, itemInfo, linear, list, mark, notes as noteMarkers, num, number,
  ordinal, parseUnit, pct, rank, readingSpec, signed, svgFigure, text, textWidth, trend, type Format, type Frame,
} from "../kit.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

interface SlopeItem {
  id: string;
  label: string;
  from: number;
  to: number;
  focal: boolean;
  muted: boolean;
  about?: string;
}

interface SlopeBlock extends ReadingSpec {
  type: "slope";
  id: string;
  title?: string;
  line: number;
  columns: [string, string];
  items: SlopeItem[];
  format: Format;
  unit?: Unit;
  tone: boolean; // rising → ok, falling → danger, on items that are neither focal nor muted
}

const WIDTH = 960;
const MAX_ITEMS = 12;
const SIDE = 10;      // axis → value
const INNER = 8;      // value → label
const MIN_SPAN = 200; // distance between the two axes
const MAX_SPAN = 480;
const NOTE_PAD = 6;   // a note marker (r 8) sits beside the mark it points at, not on it
const EDGE = 8;       // left and right margin: the labels start at the column edge, a selection ring never clips

export const blockModule: BlockModule<SlopeBlock> = {
  type: "slope",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "slope", line);
    allowKeys(data, ["id", "title", "columns", "data", "format", "tone", "unit", ...READING_KEYS], "slope", line);
    const id = requireString(data, "id", "slope", line);
    const where = `slope "${id}"`;
    const cols = list(data.columns, `${where} columns`, line);
    if (cols.length !== 2) throw new SpecError(`${where} needs exactly 2 \`columns\` (before, after), e.g. [2023, 2025]; got ${cols.length}.`, line);
    const columns = cols.map((c, i) => columnText(c, `${where} column ${i + 1}`, line)) as [string, string];
    const tone = optString(data, "tone", where, line);
    if (tone !== undefined && tone !== "change" && tone !== "none") throw new SpecError(`${where}: \`tone\` must be "change" or "none".`, line);

    const rows = list(data.data, `${where} data`, line);
    if (rows.length < 2) throw new SpecError(`${where} needs at least 2 items in \`data\`; got ${rows.length}.`, line);
    const taken = new Set([id, `${id}-title`, `${id}-desc`]);
    const items: SlopeItem[] = rows.map((r, i) => {
      const iw = `${where} item ${i + 1}`;
      if (!isObj(r)) throw new SpecError(`${iw} must be a map: { label, from, to }.`, line);
      allowKeys(r, ["id", "label", "from", "to", "about", "focal", "muted"], iw, line);
      const label = requireString(r, "label", iw, line);
      return {
        id: ownId(r, label, id, taken, iw, line),
        label,
        from: number(r.from, `${iw} ("${label}") from`, line),
        to: number(r.to, `${iw} ("${label}") to`, line),
        focal: optBool(r, "focal", iw, line),
        muted: optBool(r, "muted", iw, line),
        about: optString(r, "about", iw, line),
      };
    });

    if (items.length > MAX_ITEMS) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${items.length} lines; keep it to ${MAX_ITEMS}. Keep the items the story is about and move the rest to a table.`, line });
    }
    const focal = items.filter((it) => it.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} items focal; keep it to ${BUDGET.focal}.`, line });
    }
    const bare = items.filter((it) => !it.about).length;
    if (bare) ctx.warn({ rule: "about-missing", severity: "warn", message: `${where}: ${bare} items have no \`about\`; the detail panel will be empty for them.`, line });

    const reading = readingSpec(data, line);
    checkRefs(reading, new Set(items.map((it) => it.id)), where, line);
    return {
      type: "slope", id, title: optString(data, "title", where, line), line, columns, items,
      format: readFormat(data.format, line), unit: parseUnit(data.unit, line), tone: tone === "change", ...reading,
    };
  },

  render(b, ctx) {
    const th = ctx.theme;
    const pad = th.grid.pad, tag = th.type.tag, px = th.type.nodeSub;
    const gap = Math.max(14, px + 4);
    const fromText = b.items.map((it) => fmtUnit(it.from, b.unit, b.format));
    const toText = b.items.map((it) => fmtUnit(it.to, b.unit, b.format));
    const labelW = Math.max(...b.items.map((it) => wide(it.label, px, "sans")));
    const fromW = Math.max(...fromText.map((t) => wide(t, tag, "mono")));
    const toW = Math.max(...toText.map((t) => wide(t, tag, "mono")));
    const leftW = labelW + INNER + fromW + SIDE;
    const rightW = SIDE + toW + INNER + labelW;
    const room = WIDTH - 2 * pad - leftW - rightW;
    if (room < MIN_SPAN) {
      ctx.warn({ rule: "label-fit", severity: "warn", message: `slope "${b.id}": labels are too long for the page width; shorten the longest labels to a few words.`, line: b.line });
    }
    const span = Math.max(MIN_SPAN, Math.min(MAX_SPAN, room));
    // The drawing starts at the column edge and is as wide as it draws, so a card docked beside it sits next to the labels.
    const head = b.columns.map((c) => wide(c, tag, "sans") / 2);
    const xL = EDGE + Math.max(leftW, head[0]);
    const xR = xL + span;
    const width = Math.ceil(xR + Math.max(rightW, head[1]) + EDGE);
    const headY = pad / 2 + tag;
    const top = headY + 22;
    const bottom = top + Math.max(220, b.items.length * gap * 1.6);
    const height = bottom + pad / 2;

    const vals = b.items.flatMap((it) => [it.from, it.to]);
    const y = linear([Math.min(...vals), Math.max(...vals)], [bottom, top], { nice: false });
    const ly = spread(b.items.map((it) => y(it.from)), gap, top, bottom);
    const ry = spread(b.items.map((it) => y(it.to)), gap, top, bottom);

    const axes = [xL, xR].map((x, k) =>
      `<line class="x-axis-line" x1="${num(x)}" y1="${num(top - 8)}" x2="${num(x)}" y2="${num(bottom + 8)}"/>` +
      text(x, headY, b.columns[k], "x-axis-label", "middle")).join("");

    const order = b.items.map((_, i) => i).sort((a, c) => weight(b.items[a]) - weight(b.items[c]) || a - c);
    const marks = order.map((i) => {
      const it = b.items[i];
      const yf = y(it.from), yt = y(it.to);
      // Focal keeps the accent and muted stays gray context; tone colors the rest, line and dots alike.
      const tone = b.tone && !it.focal && !it.muted ? (it.to > it.from ? "ok" : it.to < it.from ? "danger" : "") : "";
      const attrs = `${it.muted ? ` data-muted="true"` : ""}${tone ? ` data-tone="${tone}"` : ""}`;
      const seg = `x1="${num(xL)}" y1="${num(yf)}" x2="${num(xR)}" y2="${num(yt)}"`;
      return mark(
        { id: it.id, label: it.label, value: change(it.from, it.to, b.unit, b.format), series: 1, focal: it.focal, cls: "x-slope", attrs },
        `<line class="x-line-hit" ${seg}/><line class="x-series-line x-mark-shape" ${seg}/>` +
        `<circle class="x-point x-mark-shape" cx="${num(xL)}" cy="${num(yf)}" r="4"/>` +
        `<circle class="x-point x-mark-shape" cx="${num(xR)}" cy="${num(yt)}" r="4"/>` +
        text(xL - SIDE - fromW - INNER, ly[i] + px * 0.35, it.label, "x-mark-label", "end") +
        text(xL - SIDE, ly[i] + px * 0.35, fromText[i], "x-value-label", "end") +
        text(xR + SIDE, ry[i] + px * 0.35, toText[i], "x-value-label") +
        text(xR + SIDE + toW + INNER, ry[i] + px * 0.35, it.label, "x-mark-label"),
      );
    }).join("");

    // Note markers sit on the right-hand dot; the value and name labels are obstacles.
    const anchors: Record<string, Frame> = {};
    const obstacles: Frame[] = [];
    b.items.forEach((it, i) => {
      const r = 4 + NOTE_PAD;
      anchors[it.id] = { x: xR - r, y: y(it.to) - r, w: 2 * r, h: 2 * r };
      obstacles.push({ x: xR + SIDE, y: ry[i] - px, w: toW + INNER + labelW, h: px + 4 });
      obstacles.push({ x: xL - SIDE - fromW - INNER - labelW, y: ly[i] - px, w: labelW + INNER + fromW, h: px + 4 });
    });
    const noteSvg = noteMarkers(b, anchors, { obstacles, bounds: { x: 0, y: 0, w: width, h: height } });

    return svgFigure({
      id: b.id,
      kind: "slope",
      title: b.title,
      label: `Slope chart from ${b.columns[0]} to ${b.columns[1]}`,
      desc: `How ${joinList(b.items.map((it) => it.label))} changed from ${b.columns[0]} to ${b.columns[1]}.`,
      width,
      height,
      body: `${axes}<g class="x-slopes">${marks}</g>${noteSvg}`,
    });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const [c0, c1] = b.columns;
    const val = (v: number) => fmtUnit(v, b.unit, b.format);
    const froms = b.items.map((it) => it.from), tos = b.items.map((it) => it.to);
    for (const it of b.items) {
      const r0 = rank(it.from, froms), r1 = rank(it.to, tos);
      const moved = r0.n === r1.n ? "unchanged" : r1.n < r0.n ? `up ${r0.n - r1.n}` : `down ${r1.n - r0.n}`;
      elements[it.id] = itemInfo({
        id: it.id, label: it.label, figure: b.id, kind: "line", value: change(it.from, it.to, b.unit, b.format), sub: `${c0} → ${c1}`, about: it.about,
        facts: factList([
          { k: "Change", v: diff(it.from, it.to, b.unit, b.format), tone: trend(it.to - it.from), raw: it.to - it.from },
          { k: "Rank", v: `${ordinal(r0.n)} → ${ordinal(r1.n)} of ${b.items.length} (${moved})` },
          // The value already reads "from → to"; these two carry the raw numbers compare mode diffs.
          { k: c0, v: val(it.from), raw: it.from },
          { k: c1, v: val(it.to), raw: it.to },
        ]),
        pos: r1.text,
        say: `${it.label}, ${val(it.from)} in ${c0} to ${val(it.to)} in ${c1}, ${diff(it.from, it.to, b.unit, b.format)}, ${r1.nth} in ${c1}`,
      });
    }
    return { elements };
  },

  reading(b) {
    const [c0, c1] = b.columns;
    const head = `Each line joins an item's ${c0} value on the left to its ${c1} value on the right; the steeper the line, the bigger the change.`;
    const focal = b.items.filter((it) => it.focal).map((it) => it.label);
    const rest = [
      b.tone ? "green lines rose and red lines fell" : "",
      focal.length ? `the accent line is ${joinList(focal)}` : "",
      b.items.some((it) => it.muted) ? "gray is context" : "",
    ].filter(Boolean);
    return rest.length ? `${head} ${cap(rest.join("; "))}.` : head;
  },

  table(b): DataTable {
    return {
      head: ["Item", b.columns[0], b.columns[1], "Change"],
      rows: b.items.map((it) => {
        const d = it.to - it.from, pts = b.format === "%" || b.unit === "%";
        const change = `${d > 0 ? "+" : ""}${pts ? exact(d, "pts", "auto") : exact(d, b.unit, b.format)}`;
        return [it.label, exact(it.from, b.unit, b.format), exact(it.to, b.unit, b.format), change];
      }),
    };
  },
};

// ---------- helpers (kept local: modules import only from types, kit and util) ----------

function wide(s: string, px: number, font: "sans" | "mono"): number {
  return textWidth(s, px, font) * 1.08;
}

function weight(s: { focal: boolean; muted: boolean }): number {
  return s.focal ? 2 : s.muted ? 0 : 1;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "7.6k → 21k (+180%)"; percentages change by points, not by percent. */
function change(from: number, to: number, unit: Unit | undefined, f: Format): string {
  return `${fmtUnit(from, unit, f)} → ${fmtUnit(to, unit, f)} (${growth(from, to, unit, f) || diff(from, to, unit, f)})`;
}

/** The change as a signed amount: "+13.7k", "−4 pts". */
function diff(from: number, to: number, unit: Unit | undefined, f: Format): string {
  if (f === "%" || unit === "%") return signed(to - from, "pts", f === "%" ? "auto" : f);
  return delta(to, from, unit, f);
}

/** The change in percent ("+180%", "−50%"); "" for percentages (they change by points) and from 0. */
function growth(from: number, to: number, unit: Unit | undefined, f: Format): string {
  if (f === "%" || unit === "%" || from === 0) return "";
  const p = ((to - from) / Math.abs(from)) * 100;
  return `${p > 0 ? "+" : ""}${pct(p)}`;
}

/** Full-precision cell for the data table: "7,600", "$1,234.50", "12%". */
function exact(v: number, unit: Unit | undefined, f: Format): string {
  const digits: Format = f === "1" || f === "2" ? f : Number.isInteger(v) ? "int" : "2";
  return fmtUnit(v, unit ?? (["$", "€", "zł", "%", "h", "d"].includes(f) ? f : undefined), digits);
}

/** notes and story may only point at this chart's lines. */
function checkRefs(r: ReadingSpec, ids: Set<string>, where: string, line: number): void {
  const miss = (id: string, what: string) => {
    if (!ids.has(id)) throw new SpecError(`${where} ${what} points at "${id}", which is not a line of this chart (e.g. "${[...ids][0]}").`, line, "ref-exists");
  };
  (r.notes ?? []).forEach((nt, i) => nt.on.forEach((id) => miss(id, `notes item ${i + 1}`)));
  (r.story ?? []).forEach((st, i) => {
    miss(st.sel, `story step ${i + 1}`);
    if (st.cmp) miss(st.cmp, `story step ${i + 1} cmp`);
  });
}

function columnText(v: unknown, what: string, line: number): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  throw new SpecError(`${what} must be text or a number; got ${JSON.stringify(v)}.`, line);
}

function ownId(item: Fields, label: string, prefix: string, taken: Set<string>, where: string, line: number): string {
  const own = optString(item, "id", where, line);
  if (own === undefined) return idFrom(label, taken, `${prefix}-`);
  if (taken.has(own)) throw new SpecError(`${where}: id "${own}" is used twice.`, line, "id-unique");
  taken.add(own);
  return own;
}

/** Nudge label centres at least `gap` apart; each cluster stays centred on its points, inside [lo, hi]. */
function spread(want: number[], gap: number, lo: number, hi: number): number[] {
  const order = want.map((_, i) => i).sort((a, b) => want[a] - want[b] || a - b);
  const room = (k: number) => Math.max(lo, hi - (k - 1) * gap);
  const clusters: { idx: number[]; sum: number; top: number }[] = [];
  for (const i of order) {
    clusters.push({ idx: [i], sum: want[i], top: Math.min(Math.max(want[i], lo), room(1)) });
    while (clusters.length > 1) {
      const last = clusters[clusters.length - 1], prev = clusters[clusters.length - 2];
      if (prev.top + prev.idx.length * gap <= last.top) break;
      clusters.pop();
      prev.idx.push(...last.idx);
      prev.sum += last.sum;
      const k = prev.idx.length;
      prev.top = Math.min(Math.max(prev.sum / k - ((k - 1) * gap) / 2, lo), room(k));
    }
  }
  const out = new Array<number>(want.length);
  for (const c of clusters) c.idx.forEach((i, k) => { out[i] = c.top + k * gap; });
  return out;
}
