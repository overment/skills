// Marimekko: each column is as wide as its total and split by share. A segment name keeps one palette slot across columns.
import { SpecError, type BlockModule, type ElementInfo, type Fact, type ReadingSpec } from "../types.ts";
import {
  axisY, fmt, format as parseFormat, groupInfo, idFrom, isObj, itemInfo, legend, list, mark, notes as noteMarkers, num, number, rank,
  readingSpec, seriesSlot, share, svgFigure, text, textWidth, type Format, type Frame,
} from "../kit.ts";
import { textBoxes } from "./boxes.ts";
import { allowKeys, optBool, optString, requireMap, requireString } from "../blocks/util.ts";
import { markInk } from "./ink.ts";

interface MekkoSegment { id: string; name: string; series: string; slot: number; value: number; share: number; about?: string; focal: boolean; muted: boolean }
interface MekkoColumn { id: string; label: string; width: number; about?: string; segments: MekkoSegment[] }
interface MekkoSeries { id: string; name: string; slot: number; about?: string; members: string[] }

interface MarimekkoBlock extends ReadingSpec {
  type: "marimekko";
  id: string;
  title?: string;
  line: number;
  format: Format;          // for column widths
  columns: MekkoColumn[];  // left to right; segments bottom to top in series order
  series: MekkoSeries[];   // largest total area first
  total: number;           // sum of column widths
}

interface Rect { x: number; y: number; w: number; h: number }

const W = 960, PLOT_H = 340, LEFT = 48;
const MAX_COLS = 6, MAX_SEGS = 5;

function labelOf(v: unknown, what: string, line: number): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  throw new SpecError(`${what} must be a text label, got ${JSON.stringify(v)}.`, line);
}

function aboutMap(v: unknown, known: string[], what: string, of: string, line: number): Map<string, string> {
  const out = new Map<string, string>();
  if (v === undefined || v === null) return out;
  if (!isObj(v)) throw new SpecError(`${what} must be a map of name: one or two sentences.`, line);
  for (const [k, about] of Object.entries(v)) {
    if (!known.includes(k)) throw new SpecError(`${what}: "${k}" is not one of ${of} (${known.join(", ")}).`, line, "ref-exists");
    if (typeof about !== "string") throw new SpecError(`${what}.${k} must be text.`, line);
    out.set(k, about);
  }
  return out;
}

function fit(s: string, max: number, px: number, font: "sans" | "mono"): string {
  if (textWidth(s, px, font) <= max) return s;
  const chars = Array.from(s);
  for (let n = chars.length - 1; n > 0; n--) {
    const cut = `${chars.slice(0, n).join("").trimEnd()}…`;
    if (textWidth(cut, px, font) <= max) return cut;
  }
  return "";
}

function inset(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) };
}

function box(r: Rect): string {
  return `x="${num(r.x)}" y="${num(r.y)}" width="${num(Math.max(0, r.w))}" height="${num(Math.max(0, r.h))}"`;
}

function pct1(share: number): string {
  return fmt(Math.round(share * 1000) / 10, "%");
}

export const blockModule: BlockModule<MarimekkoBlock> = {
  type: "marimekko",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "marimekko", line);
    allowKeys(data, ["id", "title", "format", "data", "sort", "segmentAbout", "notes", "caveat", "story"], "marimekko", line);
    const id = requireString(data, "id", "marimekko", line);
    const where = `marimekko "${id}"`;
    const title = optString(data, "title", where, line);
    const format = parseFormat(data.format, line);
    const sort = optBool(data, "sort", where, line, true);
    const src = list(data.data, `${where} data`, line);
    if (!src.length) throw new SpecError(`${where} needs at least one column in \`data\`.`, line);

    const names: string[] = [];
    const parsed = src.map((c, index) => {
      const cw = `${where} column ${index + 1}`;
      if (!isObj(c)) throw new SpecError(`${cw} must be a map: { label, width, segments }.`, line);
      allowKeys(c, ["id", "label", "width", "segments", "about", "muted"], cw, line);
      const label = labelOf(c.label, `${cw} label`, line);
      const cn = `${where} column "${label}"`;
      const width = number(c.width, `${cn} width`, line);
      if (width <= 0) throw new SpecError(`${cn} width must be above 0, got ${width}.`, line);
      if (!isObj(c.segments)) {
        throw new SpecError(`${cn} segments must be a map of name: share, e.g. { Retail: 40, Online: 60 }.`, line);
      }
      const segs = Object.entries(c.segments).map(([name, v]) => {
        const sw = `${cn} segment "${name}"`;
        let value: number;
        let about: string | undefined;
        let focal = false, muted = false;
        if (isObj(v)) {
          allowKeys(v, ["value", "about", "focal", "muted"], sw, line);
          value = number(v.value, `${sw} value`, line);
          about = optString(v, "about", sw, line);
          focal = optBool(v, "focal", sw, line);
          muted = optBool(v, "muted", sw, line);
        } else value = number(v, sw, line);
        if (value < 0) throw new SpecError(`${sw} must be 0 or more, got ${value}.`, line);
        if (!names.includes(name)) names.push(name);
        return { name, value, about, focal, muted };
      });
      const sum = segs.reduce((a, s) => a + s.value, 0);
      if (sum <= 0) throw new SpecError(`${cn} segments add up to 0; give at least one share above 0.`, line);
      return {
        custom: c.id === undefined ? undefined : labelOf(c.id, `${cw} id`, line),
        label, width, segs, sum, index,
        about: optString(c, "about", cw, line),
        muted: optBool(c, "muted", cw, line),
      };
    });

    const segmentAbout = aboutMap(data.segmentAbout, names, `${where} segmentAbout`, "the segment names", line);
    const area = new Map<string, number>(names.map((n) => [n, 0]));
    for (const c of parsed) for (const s of c.segs) area.set(s.name, (area.get(s.name) ?? 0) + (c.width * s.value) / c.sum);
    const order = names
      .map((name, i) => ({ name, i, area: area.get(name) ?? 0 }))
      .sort((a, b) => b.area - a.area || a.i - b.i)
      .map((s) => s.name);
    const cols = sort ? [...parsed].sort((a, b) => b.width - a.width || a.index - b.index) : parsed;

    const taken = new Set<string>();
    for (const c of parsed) {
      if (!c.custom) continue;
      if (taken.has(c.custom)) throw new SpecError(`${where}: id "${c.custom}" is used twice.`, line, "id-unique");
      taken.add(c.custom);
    }
    const colIds = cols.map((c) => c.custom ?? idFrom(c.label, taken, `${id}-`));
    const series: MekkoSeries[] = order.map((name, k) => ({
      id: idFrom(name, taken, `${id}-series-`), name, slot: seriesSlot(k, ctx.theme), about: segmentAbout.get(name), members: [],
    }));
    const byName = new Map(series.map((s) => [s.name, s]));
    const columns: MekkoColumn[] = cols.map((c, ci) => ({
      id: colIds[ci] ?? idFrom(c.label, taken, `${id}-`),
      label: c.label,
      width: c.width,
      about: c.about,
      segments: order.flatMap((name) => {
        const s = c.segs.find((x) => x.name === name);
        const ser = byName.get(name);
        if (!s || !ser || s.value === 0) return [];
        const segId = idFrom(`${c.label} ${name}`, taken, `${id}-`);
        ser.members.push(segId);
        return [{
          id: segId, name, series: ser.id, slot: ser.slot, value: s.value, share: s.value / c.sum,
          about: s.about, focal: s.focal, muted: s.muted || c.muted,
        }];
      }),
    }));

    if (columns.length > MAX_COLS || series.length > MAX_SEGS) {
      ctx.warn({
        rule: "budget-nodes",
        severity: "warn",
        message: `${where} has ${columns.length} columns × ${series.length} segments; keep it within ${MAX_COLS} × ${MAX_SEGS}. Merge the smallest columns or segments into "Other", or split into two charts.`,
        line,
      });
    }
    const focal = columns.reduce((a, c) => a + c.segments.filter((s) => s.focal).length, 0);
    if (focal > 2) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} segments focal; keep it to 2.`, line });
    }

    return { type: "marimekko", id, title, line, format, columns, series, total: columns.reduce((a, c) => a + c.width, 0), ...readingSpec(data, line) };
  },

  render(b, ctx) {
    const theme = ctx.theme;
    const pad = theme.grid.pad, px = theme.type.nodeSub, tag = theme.type.tag;
    const frame = { x: LEFT, y: pad / 2, w: W - LEFT - pad, h: PLOT_H };
    const base = frame.y + frame.h;
    const headH = px + tag + 16;
    const parts: string[] = [];
    const anchors: Record<string, Frame> = {};
    const labelBoxes: Frame[] = [];
    // a column head's hit area is clear gutter; note markers only need to keep off its visible text
    const headText: Record<string, Frame> = {};
    const rowOf = new Map(b.series.map((s, k) => [s.id, b.series.length - 1 - k]));

    const ticks = [0, 25, 50, 75, 100].map((v) => ({ at: frame.y + frame.h * (1 - v / 100), label: `${v}%` }));
    parts.push(axisY(frame, ticks, { grid: false }));
    // tick labels are text a note marker must not sit on
    for (const t of ticks) {
      const w = textWidth(t.label, tag, "sans");
      labelBoxes.push({ x: frame.x - 8 - w, y: t.at - tag * 0.65, w, h: tag });
    }

    let x = frame.x;
    b.columns.forEach((col, ci) => {
      const cw = (col.width / b.total) * frame.w;
      let top = base;
      for (const seg of col.segments) {
        const sh = seg.share * frame.h;
        const r = inset({ x, y: top - sh, w: cw, h: sh }, 1);
        top -= sh;
        anchors[seg.id] = r;
        const pct = `${Math.round(seg.share * 100)}%`;
        const ink = markInk(theme, { focal: seg.focal, muted: seg.muted, slot: seg.slot });
        const onFill = ink || !seg.muted ? " x-on-fill" : "";
        const pw = textWidth(pct, px, "sans");
        const show = r.h >= px + 6 && pw <= r.w - 8;
        if (show) labelBoxes.push({ x: r.x + r.w / 2 - pw / 2, y: r.y + r.h / 2 - px / 2, w: pw, h: px });
        const label = show ? text(r.x + r.w / 2, r.y + r.h / 2 + px * 0.35, pct, `x-mark-label${onFill}`, "middle") : "";
        parts.push(mark(
          {
            id: seg.id, label: `${col.label} · ${seg.name}`, value: pct1(seg.share), series: seg.slot, focal: seg.focal,
            cls: "x-segment", attrs: (seg.muted ? ` data-muted="true"` : "") + ink + ` data-nav="${rowOf.get(seg.series) ?? 0},${ci}"`,
          },
          `<rect class="x-mark-shape" ${box(r)}/>${label}`,
        ));
      }

      // Column head below: label and width. Too-narrow columns keep the hit area, the model has the name.
      const cx = x + cw / 2;
      const hy = base + 4;
      const width = fmt(col.width, b.format);
      const lab = fit(col.label, cw - 6, px, "sans");
      const showWidth = textWidth(width, tag, "sans") <= cw - 6;
      const head = (lab ? text(cx, hy + 4 + px * 0.9, lab, "x-mark-label", "middle") : "") +
        (showWidth ? text(cx, hy + 8 + px + tag * 0.9, width, "x-value-label", "middle") : "");
      const hit = { x: x + 1, y: hy, w: cw - 2, h: headH };
      anchors[col.id] = hit;
      const tw = Math.max(lab ? textWidth(lab, px, "sans") : 0, showWidth ? textWidth(width, tag, "sans") : 0);
      headText[col.id] = tw ? { x: cx - tw / 2, y: hy + 4, w: tw, h: headH - 4 } : hit;
      labelBoxes.push(headText[col.id]);
      parts.push(mark(
        { id: col.id, label: col.label, value: width, cls: "x-grid-head", attrs: ` data-nav="${b.series.length},${ci}"` },
        `<rect class="x-mark-shape" ${box(hit)}/>${head}`,
      ));
      x += cw;
    });

    const lg = legend(b.series.map((s) => ({ id: s.id, label: s.name, series: s.slot })), theme, frame.x, frame.x + frame.w, base + 4 + headH + 8);
    parts.push(lg.svg);
    const height = base + 4 + headH + 8 + lg.height;
    labelBoxes.push(...textBoxes(lg.svg, tag));
    parts.push(noteMarkers(b, { ...anchors, ...headText }, { obstacles: labelBoxes, bounds: { x: 0, y: 0, w: W, h: height } }));

    return svgFigure({
      id: b.id,
      kind: "marimekko",
      title: b.title,
      label: `Marimekko of ${b.columns.length} columns by ${b.series.length} segments`,
      desc: `Each column is as wide as its total (${fmt(b.total, b.format)} altogether) and is split by share, so every column adds up to 100%.`,
      width: W,
      height,
      body: parts.join(""),
    });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const val = (x: number) => fmt(x, b.format);
    const amount = (col: MekkoColumn, seg: MekkoSegment) => col.width * seg.share;
    const colOf = new Map<string, MekkoColumn>();
    const segs = new Map<string, MekkoSegment>();
    for (const col of b.columns) for (const seg of col.segments) { colOf.set(seg.id, col); segs.set(seg.id, seg); }
    const seriesTotal = new Map(b.series.map((s) => [s.id, s.members.reduce((a, id) => a + amount(colOf.get(id)!, segs.get(id)!), 0)]));

    for (const s of b.series) {
      const total = seriesTotal.get(s.id) ?? 0;
      const facts: Fact[] = [{ k: "Share of total", v: share(total, b.total), raw: (total / b.total) * 100 }];
      for (const id of s.members) {
        const col = colOf.get(id)!, seg = segs.get(id)!;
        facts.push({ k: col.label, v: `${pct1(seg.share)} · ${val(amount(col, seg))}`, ref: id, raw: seg.share * 100 });
      }
      elements[s.id] = groupInfo({
        id: s.id, label: s.name, figure: b.id, kind: "series", about: s.about, members: s.members,
        value: val(total), facts,
        say: `${s.name}, ${val(total)}, ${share(total, b.total)} of total`,
      });
    }
    b.columns.forEach((col, ci) => {
      const facts: Fact[] = [{ k: "Share of total", v: share(col.width, b.total), raw: (col.width / b.total) * 100 }];
      for (const seg of col.segments) facts.push({ k: seg.name, v: `${pct1(seg.share)} · ${val(amount(col, seg))}`, ref: seg.id, raw: seg.share * 100 });
      elements[col.id] = groupInfo({
        id: col.id, label: col.label, figure: b.id, kind: "column", about: col.about, members: col.segments.map((s) => s.id),
        value: val(col.width), facts, pos: `${ci + 1} of ${b.columns.length}`,
        say: `${col.label}, ${val(col.width)}, ${share(col.width, b.total)} of total${col.segments[0] ? `, largest part ${[...col.segments].sort((p, q) => q.share - p.share)[0]!.name}` : ""}`,
      });
      for (const seg of col.segments) {
        const abs = amount(col, seg);
        const ser = b.series.find((x) => x.id === seg.series)!;
        const sTotal = seriesTotal.get(ser.id) ?? 0;
        // The same segment name in the column where it holds the largest share (or the smallest, when this is the largest).
        const peers = ser.members.filter((id) => id !== seg.id).map((id) => ({ id, seg: segs.get(id)!, col: colOf.get(id)! }));
        const hi = peers.reduce<typeof peers[number] | undefined>((m, p) => (!m || p.seg.share > m.seg.share ? p : m), undefined);
        const lo = peers.reduce<typeof peers[number] | undefined>((m, p) => (!m || p.seg.share < m.seg.share ? p : m), undefined);
        const chip = hi && hi.seg.share > seg.share ? { k: `Highest ${seg.name}`, p: hi } : lo ? { k: `Lowest ${seg.name}`, p: lo } : null;
        const facts: Fact[] = [
          { k: "Share of column", v: `${pct1(seg.share)} of ${col.label}`, raw: seg.share * 100 },
          { k: "Share of segment", v: `${share(abs, sTotal)} of all ${seg.name}`, raw: sTotal ? (abs / sTotal) * 100 : 0 },
          { k: "Share of total", v: `${share(abs, b.total)} of total`, raw: (abs / b.total) * 100 },
        ];
        if (chip) facts.push({ k: chip.k, v: `${chip.p.col.label} ${pct1(chip.p.seg.share)}`, ref: chip.p.id, raw: chip.p.seg.share * 100 });
        elements[seg.id] = itemInfo({
          id: seg.id, label: `${col.label} · ${seg.name}`, figure: b.id, kind: "segment",
          value: val(abs), about: seg.about, related: [col.id, seg.series],
          context: [...col.segments.map((x) => x.id), ...ser.members].filter((id, i, all) => id !== seg.id && all.indexOf(id) === i),
          crumb: [col.id], facts, pos: rank(seg.share, col.segments.map((x) => x.share)).text,
          links: [{ rel: "Column", ids: [col.id] }, { rel: "Segment", ids: [ser.id] }],
          say: `${col.label} · ${seg.name}, ${val(abs)}, ${pct1(seg.share)} of ${col.label}, ${share(abs, sTotal)} of all ${seg.name}`,
        });
      }
    });
    return { elements };
  },

  reading() {
    return "Column width = the column's total; segment height = its share of that column, so every column adds up to 100%. Colour = segment, the same in every column.";
  },

  table(b) {
    return {
      head: ["Column", "Total", ...b.series.map((s) => s.name)],
      rows: b.columns.map((c) => [c.label, fmt(c.width, b.format), ...b.series.map((s) => {
        const seg = c.segments.find((x) => x.series === s.id);
        return seg ? pct1(seg.share) : "—";
      })]),
    };
  },
};
