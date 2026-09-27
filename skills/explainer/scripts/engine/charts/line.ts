// Line chart: values across ordered categories or ISO dates. Each series line is a mark, and so is each point.
import {
  BUDGET, SpecError, type BandSpec, type BlockModule, type DataTable, type ElementInfo, type MarkStat, type ReadingSpec, type Unit,
} from "../types.ts";
import {
  READING_KEYS, SCALE_KEYS, axisX, axisY, delta, esc, factList, fmtTicks, fmtUnit, format as readFormat, groupInfo, idFrom, isObj, itemInfo, legend,
  linear, list, mark, markValue, notes as noteMarkers, num, number, pct, plotFrame, rank, readingSpec, refBand, refLine, scaleSpec, seriesSlot,
  share, signed, svgFigure, textWidth, trend, type Format, type Frame, type LegendItem,
} from "../kit.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

interface LineSeries {
  id: string;
  label: string;
  values: (number | null)[]; // aligned with categories; null = gap
  points: string[];          // point mark id per category, "" where nothing is drawn (a gap, or a gap below it in a stack)
  slot: number;
  focal: boolean;
  muted: boolean;
  about?: string;
}

/** A reference line: `y` at a value (or the mean or median of every value), `x` at a position on the category axis. */
interface LineMark { axis: "x" | "y"; at: number | MarkStat; label?: string }
/** A shaded range; x positions are category indexes, or UTC ms on a time axis. */
interface LineBand { axis: "x" | "y"; from: number; to: number; label?: string }

interface LineBlock extends ReadingSpec {
  type: "line";
  id: string;
  title?: string;
  line: number;
  categories: string[];
  labels: string[];  // tick and detail labels ("Mar 4" for dates)
  times?: number[];  // UTC ms when every category is an ISO date → time scale
  series: LineSeries[];
  format: Format;
  unit?: Unit;
  area: boolean;
  stack: boolean;
  zero: boolean;
  xTitle?: string;
  yTitle?: string;
  marks: LineMark[];
  bands: LineBand[];
}

type Pt = [number, number];

const WIDTH = 960;
const PLOT_HEIGHT = 380;
const MAX_SERIES = 5;
const MAX_POINTS = 24;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;
const PREFIX_UNITS = ["$", "€", "£", "¥"];
const NOTE_PAD = 6;   // a note marker (r 8) sits beside the mark it points at, not on it

export const blockModule: BlockModule<LineBlock> = {
  type: "line",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "line", line);
    allowKeys(data, ["id", "title", "categories", "series", "format", "area", "stack", "x", "y", ...READING_KEYS, ...SCALE_KEYS], "line", line);
    const id = requireString(data, "id", "line", line);
    const where = `line "${id}"`;
    const categories = list(data.categories, `${where} categories`, line).map((c, i) => category(c, `${where} category ${i + 1}`, line));
    if (categories.length < 2) throw new SpecError(`${where} needs at least 2 \`categories\`; got ${categories.length}.`, line);
    const twice = categories.find((c, i) => categories.indexOf(c) !== i);
    if (twice !== undefined) throw new SpecError(`${where}: category "${twice}" is listed twice.`, line);
    const dates = readDates(categories, where, line);
    const x = subMap(data.x, `${where} x`, ["title"], line);
    const y = subMap(data.y, `${where} y`, ["title", "zero"], line);
    const stack = optBool(data, "stack", where, line);
    let area = optBool(data, "area", where, line);

    const rawSeries = list(data.series, `${where} series`, line);
    if (!rawSeries.length) throw new SpecError(`${where} needs at least one entry in \`series\`.`, line);
    const taken = new Set([id, `${id}-title`, `${id}-desc`]);
    const series: LineSeries[] = rawSeries.map((s, i) => {
      const sw = `${where} series ${i + 1}`;
      if (!isObj(s)) throw new SpecError(`${sw} must be a map: { label, values }.`, line);
      allowKeys(s, ["id", "label", "values", "about", "focal", "muted"], sw, line);
      const label = requireString(s, "label", sw, line);
      const values = readValues(s.values, categories, `${sw} ("${label}")`, line);
      if (values.every((v) => v === null)) throw new SpecError(`${sw} ("${label}") has no values.`, line);
      return {
        id: ownId(s, label, id, taken, sw, line),
        label,
        values,
        points: [] as string[],
        slot: seriesSlot(i, ctx.theme),
        focal: optBool(s, "focal", sw, line),
        muted: optBool(s, "muted", sw, line),
        about: optString(s, "about", sw, line),
      };
    });

    if (stack && series.some((s) => s.values.some((v) => v !== null && v < 0))) {
      throw new SpecError(`${where}: \`stack\` needs values of 0 or more; drop stack to show negative values.`, line);
    }
    // A stacked band stands on the total below it. Where a lower series has a gap that total is unknown,
    // so the band breaks there instead of dropping to a floor that would read as zero.
    const whole = categories.map(() => true);
    const hidden: string[] = [];
    for (const s of series) {
      s.points = s.values.map((v, i) => {
        if (v === null) { whole[i] = false; return ""; }
        if (stack && !whole[i]) { hidden.push(`${s.label} at ${categories[i]}`); return ""; }
        return idFrom(`${s.id}-${i}`, taken);
      });
      if (s.points.every((p) => !p)) {
        throw new SpecError(`${where}: every value of "${s.label}" sits on a gap in the series below it, so no part of its band can be drawn. Fill the gaps below (0 if the value really was zero) or drop \`stack\`.`, line);
      }
    }
    if (hidden.length) {
      ctx.warn({ rule: "spec", severity: "warn", message: `${where}: with \`stack\`, a gap (~) breaks its band and every band above it, so ${hidden.length} value${hidden.length > 1 ? "s are" : " is"} not drawn (${hidden.slice(0, 3).join(", ")}${hidden.length > 3 ? ", …" : ""}). Use 0 where the value really was zero.`, line });
    }

    if (area && !stack && series.length > 1) {
      ctx.warn({ rule: "spec", severity: "warn", message: `${where}: \`area\` fills a single series; overlapping areas hide each other. Use \`stack: true\` for parts of a whole, or drop \`area\`.`, line });
      area = false;
    }
    if (series.length > MAX_SERIES) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${series.length} series; keep it to ${MAX_SERIES}. Mute the context series, or split into two charts that share the y scale.`, line });
    }
    if (categories.length > MAX_POINTS) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${categories.length} points per series; keep it to ${MAX_POINTS}. Aggregate to a coarser period (weeks → months) or split the range into two charts.`, line });
    }
    const focal = series.filter((s) => s.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} series focal; keep it to ${BUDGET.focal}.`, line });
    }
    const bare = series.filter((s) => !s.about).length;
    if (bare) ctx.warn({ rule: "about-missing", severity: "warn", message: `${where}: ${bare} series have no \`about\`; the detail panel will be empty for them.`, line });

    const reading = readingSpec(data, line);
    const ids = new Set(series.flatMap((s) => [s.id, ...s.points.filter(Boolean)]));
    checkRefs(reading, ids, where, line);
    const scale = scaleSpec(data, line);
    const xAt = (v: number | string, what: string) => xPosition(v, categories, dates?.times, what, line);
    const marks: LineMark[] = (scale.marks ?? []).map((m, i) => {
      const what = `${where} marks item ${i + 1} ${m.axis}`;
      if (m.axis === "x") return { axis: "x", at: xAt(m.at, what), label: m.label };
      return { axis: "y", at: yValue(m.at, what, line, true), label: m.label };
    });
    const bands: LineBand[] = (scale.bands ?? []).map((bd: BandSpec, i) => {
      const what = `${where} bands item ${i + 1}`;
      const axis = bd.axis ?? "y";
      const at = (v: number | string, end: string) => (axis === "x" ? xAt(v, `${what} ${end}`) : yValue(v, `${what} ${end}`, line, false) as number);
      return { axis, from: at(bd.from, "from"), to: at(bd.to, "to"), label: bd.label };
    });

    return {
      type: "line", id, title: optString(data, "title", where, line), line,
      categories, labels: dates?.labels ?? categories, times: dates?.times, series,
      format: readFormat(data.format, line), unit: scale.unit, area, stack,
      zero: optBool(y, "zero", `${where} y`, line),
      xTitle: optString(x, "title", `${where} x`, line),
      yTitle: optString(y, "title", `${where} y`, line),
      marks, bands, ...reading,
    };
  },

  render(b, ctx) {
    const th = ctx.theme;
    const pad = th.grid.pad, tag = th.type.tag, px = th.type.nodeSub;
    const n = b.categories.length;
    const val = (v: number) => fmtUnit(v, b.unit, b.format);

    // Stacked series are drawn at their running total; `base` is the band's floor. Nothing is drawn where points[i] is "".
    const base = b.series.map(() => b.categories.map(() => 0));
    const drawn: (number | null)[][] = b.series.map((s) => s.values.map((v, i) => (s.points[i] ? v : null)));
    if (b.stack) {
      const acc = b.categories.map(() => 0);
      b.series.forEach((s, si) => s.values.forEach((v, i) => { base[si][i] = acc[i]; acc[i] += v ?? 0; drawn[si][i] = s.points[i] ? acc[i] : null; }));
    }
    const stat = statValues(b);
    const markY = b.marks.filter((m) => m.axis === "y").map((m) => markValue(m.at, stat));
    const bandY = b.bands.filter((bd) => bd.axis === "y").flatMap((bd) => [bd.from, bd.to]);
    const all = [...drawn.flat().filter((v): v is number => v !== null), ...markY, ...bandY];
    const probe = linear([Math.min(...all), Math.max(...all)], [0, 1], { zero: b.zero || b.area || b.stack });
    const ticks = probe.ticks();
    const tickText = tickLabels(ticks, b.format, b.unit);
    const yTitle = b.yTitle ?? wordUnit(b.unit);

    const direct = b.series.length <= 3;
    const ends = b.series.map((s) => { const i = lastShown(s.points); return { i, value: val(s.values[i] as number) }; });
    const endWidth = (si: number) => wide(b.series[si].label, px, "sans") + 6 + wide(ends[si].value, tag, "mono");
    const left = Math.max(48, ...tickText.map((t) => wide(t, tag, "mono") + 16), wide(b.labels[0], tag, "mono") / 2 + 8);
    const right = direct
      ? Math.max(pad, ...b.series.map((_, si) => endWidth(si) + 14))
      : Math.max(pad, wide(b.labels[n - 1], tag, "mono") / 2 + 8);
    const frame = plotFrame(WIDTH, PLOT_HEIGHT, th, { left, right, top: Math.max(pad / 2, yTitle ? 28 : 14), bottom: b.xTitle ? 46 : 36 });
    const y = linear(probe.domain, [frame.y + frame.h, frame.y], { nice: false });
    const xOf = (u: number) => (b.times
      ? frame.x + ((u - b.times[0]) / (b.times[n - 1] - b.times[0])) * frame.w
      : frame.x + (u / (n - 1)) * frame.w);
    const xs = b.categories.map((_, i) => xOf(b.times ? b.times[i] : i));
    const at = (si: number, i: number): Pt | null => { const v = drawn[si][i]; return v === null ? null : [xs[i], y(v)]; };

    // Context first, the focal series last so it paints on top.
    const order = b.series.map((_, i) => i).sort((a, c) => weight(b.series[a]) - weight(b.series[c]) || a - c);
    const endY = direct ? spread(b.series.map((_, si) => at(si, ends[si].i)![1]), Math.max(14, px + 3), frame.y, frame.y + frame.h) : [];

    const lines = order.map((si) => {
      const s = b.series[si];
      const pts = b.categories.map((_, i) => at(si, i));
      const d = pathOf(pts);
      let fill = "";
      if (b.stack) {
        fill = runs(drawn[si]).map((idx) => areaPath([
          ...idx.map((i): Pt => [xs[i], y(drawn[si][i]!)]),
          ...idx.map((i): Pt => [xs[i], y(base[si][i])]).reverse(),
        ], s, "x-series-area x-stacked")).join("");
      } else if (b.area) {
        const y0 = y(0);
        fill = segments(pts).map((seg) => areaPath([...seg, [seg[seg.length - 1][0], y0], [seg[0][0], y0]], s, "x-series-area")).join("");
      }
      const e = ends[si];
      const label = direct
        ? `<text class="x-mark-label x-end-label" x="${num(xs[e.i] + 8)}" y="${num(endY[si] + px * 0.35)}">${esc(s.label)}<tspan class="x-value-label" dx="6">${esc(e.value)}</tspan></text>`
        : "";
      return mark(
        { id: s.id, label: s.label, value: `${e.value} at ${b.labels[e.i]}`, series: s.slot, focal: s.focal, cls: "x-line", attrs: muted(s) },
        `${fill}<path class="x-line-hit" d="${d}"/><path class="x-series-line x-mark-shape" d="${d}"/>${label}`,
      );
    }).join("");

    const points = order.map((si) => {
      const s = b.series[si];
      return s.values.map((v, i) => {
        if (v === null || !s.points[i]) return "";
        const [cx, cy] = at(si, i)!;
        return mark(
          { id: s.points[i], label: `${s.label}, ${b.labels[i]}`, value: val(v), series: s.slot, focal: s.focal, cls: "x-line-point", attrs: muted(s) },
          `<circle class="x-point x-mark-shape" cx="${num(cx)}" cy="${num(cy)}" r="3.5"/>`,
        );
      }).join("");
    }).join("");

    const yAxis = axisY(frame, ticks.map((v, k) => ({ at: y(v), label: tickText[k] })), { title: yTitle });
    const xAxis = axisX(frame, thin(xs, b.labels, tag).map((i) => ({ at: xs[i], label: b.labels[i] })), { title: b.xTitle });
    const bands = b.bands.map((bd) => (bd.axis === "y"
      ? refBand(frame, { y: [y(bd.from), y(bd.to)] }, bd.label, { px: tag })
      : refBand(frame, { x: [xOf(bd.from), xOf(bd.to)] }, bd.label, { px: tag }))).join("");
    const refs = b.marks.map((m) => (m.axis === "y"
      ? refLine(frame, { y: y(markValue(m.at, stat)) }, m.label, { px: tag })
      : refLine(frame, { x: xOf(m.at as number) }, m.label, { px: tag }))).join("");

    let legendSvg = "", legendH = 0;
    if (!direct) {
      const items: LegendItem[] = b.series.map((s) => ({ id: s.id, label: s.label, series: s.slot, kind: b.stack ? "swatch" : "line" }));
      const lg = legend(items, th, frame.x, WIDTH - right, PLOT_HEIGHT);
      legendSvg = b.series.reduce((svg, s) => flagLegend(svg, s), lg.svg);
      legendH = lg.height;
    }

    // Note markers sit on a point, or on a series' last point; end labels are obstacles.
    const anchors: Record<string, Frame> = {};
    b.series.forEach((s, si) => {
      s.points.forEach((p, i) => { if (p) anchors[p] = dot(at(si, i)!, 3.5 + NOTE_PAD); });
      anchors[s.id] = dot(at(si, ends[si].i)!, 3.5 + NOTE_PAD);
    });
    const obstacles: Frame[] = direct ? b.series.map((_, si) => ({ x: xs[ends[si].i] + 8, y: endY[si] - px, w: endWidth(si), h: px + 4 })) : [];
    const noteSvg = noteMarkers(b, anchors, { obstacles, bounds: { x: 0, y: 0, w: WIDTH, h: PLOT_HEIGHT } });

    const names = b.series.map((s) => s.label);
    return svgFigure({
      id: b.id,
      kind: "line",
      title: b.title,
      label: `Line chart of ${joinList(names)}`,
      desc: `${b.stack ? "Stacked areas" : "Lines"} for ${joinList(names)} across ${n} ${b.times ? "dates" : "points"}, from ${b.labels[0]} to ${b.labels[n - 1]}.`,
      width: WIDTH,
      height: PLOT_HEIGHT + legendH,
      body: `${yAxis}${xAxis}${bands}${refs}<g class="x-lines">${lines}</g><g class="x-points">${points}</g>${legendSvg}${noteSvg}`,
    });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const val = (v: number) => fmtUnit(v, b.unit, b.format);
    const many = b.series.length > 1;
    const lasts = b.series.map((s) => s.values[lastShown(s.points)] as number);
    const totals = b.categories.map((_, i) => b.series.reduce((t, s) => t + (s.values[i] ?? 0), 0));
    b.series.forEach((s, si) => {
      const shown = s.points.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
      const first = shown[0], last = shown[shown.length - 1];
      const v0 = s.values[first]!, v1 = s.values[last]!;
      const peak = shown.reduce((a, i) => (s.values[i]! > s.values[a]! ? i : a), first);
      const low = shown.reduce((a, i) => (s.values[i]! < s.values[a]! ? i : a), first);
      const place = many ? rank(v1, lasts) : undefined;
      const facts = factList([
        last !== first && { k: `Since ${b.labels[first]}`, v: change(v0, v1, b.unit, b.format), tone: trend(v1 - v0) },
        peak !== last && { k: "Peak", v: `${val(s.values[peak]!)} · ${b.labels[peak]}`, ref: s.points[peak], raw: s.values[peak]! },
        low !== first && low !== last && { k: "Low", v: `${val(s.values[low]!)} · ${b.labels[low]}`, ref: s.points[low], raw: s.values[low]! },
        b.stack && many && { k: `Share in ${b.labels[last]}`, v: share(v1, totals[last]) },
      ]);
      elements[s.id] = groupInfo({
        id: s.id, label: s.label, figure: b.id, members: s.points.filter(Boolean), kind: "series", about: s.about,
        value: `${val(v1)} at ${b.labels[last]}`,
        facts, pos: place?.text,
        say: [s.label, `${val(v1)} at ${b.labels[last]}`, last !== first && `${change(v0, v1, b.unit, b.format)} since ${b.labels[first]}`, place && place.nth].filter(Boolean).join(", "),
      });

      shown.forEach((i, k) => {
        const v = s.values[i]!;
        const prev = k > 0 ? shown[k - 1] : undefined;
        const here = b.series.map((o) => o.values[i]).filter((x): x is number => x !== null);
        const place = here.length > 1 ? rank(v, here) : undefined;
        const facts = factList([
          prev !== undefined && { k: `vs ${b.labels[prev]}`, v: change(s.values[prev]!, v, b.unit, b.format), tone: trend(v - s.values[prev]!), ref: s.points[prev] },
          k > 1 && { k: `vs ${b.labels[first]}`, v: change(v0, v, b.unit, b.format), tone: trend(v - v0), ref: s.points[first] },
          place && { k: `Rank in ${b.labels[i]}`, v: place.text },
          b.stack && many && { k: "Share of total", v: share(v, totals[i]) },
          { k: "Series", v: s.label, ref: s.id },
        ]);
        elements[s.points[i]] = itemInfo({
          id: s.points[i], label: `${s.label}, ${b.labels[i]}`, figure: b.id, kind: "point", value: val(v), about: s.about, related: [s.id],
          facts, pos: `${k + 1} of ${shown.length}`,
          context: s.points.filter((p) => p && p !== s.points[i]),
          say: [s.label, b.labels[i], val(v), prev !== undefined && `${change(s.values[prev]!, v, b.unit, b.format)} vs ${b.labels[prev]}`, place && place.nth].filter(Boolean).join(", "),
        });
      });
    });
    return { elements };
  },

  reading(b) {
    const what = b.yTitle ?? wordUnit(b.unit) ?? "value";
    const span = `${b.labels[0]} to ${b.labels[b.labels.length - 1]}`;
    const head = b.stack
      ? `Bands stack from ${span}: each band's thickness is one series and the top edge is the total ${what.toLowerCase()}.`
      : `Each line is one series from ${span}; higher means more ${what.toLowerCase()}.`;
    const focal = b.series.filter((s) => s.focal).map((s) => s.label);
    const rest = [
      focal.length ? `The accent ${b.stack ? "band" : "line"} is ${joinList(focal)}` : "",
      b.series.some((s) => s.muted) ? "gray is context" : "",
      b.series.some((s) => s.values.includes(null)) ? "breaks are missing values" : "",
      b.marks.length || b.bands.length ? "dashed rules and shaded ranges are references" : "",
    ].filter(Boolean);
    return rest.length ? `${head} ${cap(rest.join("; "))}.` : head;
  },

  table(b): DataTable {
    return {
      head: [b.xTitle ?? (b.times ? "Date" : "Category"), ...b.series.map((s) => s.label)],
      rows: b.categories.map((c, i) => [c, ...b.series.map((s) => (s.values[i] === null ? "" : exact(s.values[i]!, b.unit, b.format)))]),
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

function muted(s: { muted: boolean }): string {
  return s.muted ? ` data-muted="true"` : "";
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dot(p: Pt, r: number): Frame {
  return { x: p[0] - r, y: p[1] - r, w: 2 * r, h: 2 * r };
}

function flagLegend(svg: string, s: LineSeries): string {
  const flags = `${s.focal ? ` data-focal="true"` : ""}${muted(s)}`;
  if (!flags) return svg;
  const key = `data-id="${esc(s.id)}"`;
  return svg.replace(key, () => key + flags);
}

function areaPath(pts: Pt[], s: LineSeries, cls: string): string {
  const d = pts.map((p, i) => `${i ? "L" : "M"}${num(p[0])},${num(p[1])}`).join("") + "Z";
  return `<path class="${cls}" data-series="${s.slot}"${s.focal ? ` data-focal="true"` : ""}${muted(s)} d="${d}"/>`;
}

/** Index runs of consecutive values that are drawn. */
function runs(values: (number | null)[]): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  values.forEach((v, i) => {
    if (v !== null) cur.push(i);
    else if (cur.length) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out;
}

function segments(pts: (Pt | null)[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of pts) {
    if (p) cur.push(p);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

function pathOf(pts: (Pt | null)[]): string {
  return segments(pts).map((seg) => seg.map((p, i) => `${i ? "L" : "M"}${num(p[0])},${num(p[1])}`).join("")).join("");
}

/** Index of the last drawn point. */
function lastShown(points: string[]): number {
  let last = -1;
  points.forEach((p, i) => { if (p) last = i; });
  return last;
}

/** Values `mean` and `median` marks stand on: every value, or the stack totals where no series has a gap. */
function statValues(b: LineBlock): number[] {
  if (b.stack) {
    const totals = b.categories
      .map((_, i) => (b.series.every((s) => s.values[i] !== null) ? b.series.reduce((t, s) => t + s.values[i]!, 0) : null))
      .filter((v): v is number => v !== null);
    if (totals.length) return totals;
  }
  return b.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
}

/** Axis labels in one unit ("0, 25k, 50k"), with the unit symbol when it is one ($, €, %). Word units go in the axis title. */
function tickLabels(ticks: number[], f: Format, unit?: Unit): string[] {
  const out = fmtTicks(ticks, f).map((t) => t.replace(/^-/, "−"));
  if (!unit || !["auto", "int", "1", "2", "k"].includes(f)) return out;
  if (PREFIX_UNITS.includes(unit)) return out.map((t) => (t.startsWith("−") ? `−${unit}${t.slice(1)}` : `${unit}${t}`));
  return unit === "%" ? out.map((t) => `${t}%`) : out;
}

function wordUnit(unit?: Unit): string | undefined {
  return unit && unit !== "%" && !PREFIX_UNITS.includes(unit) ? unit : undefined;
}

/** "+40.5k (+131%)"; percentages change by points ("+4 pts"). */
function change(from: number, to: number, unit: Unit | undefined, f: Format): string {
  if (f === "%" || unit === "%") return signed(to - from, "pts", f === "%" ? "auto" : f);
  const d = delta(to, from, unit, f);
  if (!from) return d;
  const p = ((to - from) / Math.abs(from)) * 100;
  return `${d} (${p > 0 ? "+" : ""}${pct(p)})`;
}

/** Full-precision cell for the data table: "71,500", "$1,234.50", "12%". */
function exact(v: number, unit: Unit | undefined, f: Format): string {
  const digits: Format = f === "1" || f === "2" ? f : Number.isInteger(v) ? "int" : "2";
  return fmtUnit(v, unit ?? (["$", "€", "zł", "%", "h", "d"].includes(f) ? f : undefined), digits);
}

/** notes and story may only point at this chart's series and points. */
function checkRefs(r: ReadingSpec, ids: Set<string>, where: string, line: number): void {
  const miss = (id: string, what: string) => {
    if (!ids.has(id)) throw new SpecError(`${where} ${what} points at "${id}", which is not a series or point of this chart (e.g. "${[...ids][0]}").`, line, "ref-exists");
  };
  (r.notes ?? []).forEach((nt, i) => nt.on.forEach((id) => miss(id, `notes item ${i + 1}`)));
  (r.story ?? []).forEach((st, i) => {
    miss(st.sel, `story step ${i + 1}`);
    if (st.cmp) miss(st.cmp, `story step ${i + 1} cmp`);
  });
}

/** A mark or band end on the category axis: a category's index, or UTC ms of a date inside the range on a time axis. */
function xPosition(v: number | string, cats: string[], times: number[] | undefined, what: string, line: number): number {
  const s = String(v);
  if (times) {
    const m = ISO_DATE.exec(s);
    const t = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1) : NaN;
    if (!Number.isFinite(t)) throw new SpecError(`${what} must be a date like ${cats[0]}; got "${s}".`, line);
    if (t < times[0] || t > times[times.length - 1]) throw new SpecError(`${what}: ${s} is outside the chart, ${cats[0]} to ${cats[cats.length - 1]}.`, line, "ref-exists");
    return t;
  }
  const i = cats.indexOf(s);
  if (i < 0) throw new SpecError(`${what}: "${s}" is not one of the categories (${cats.join(", ")}).`, line, "ref-exists");
  return i;
}

function yValue(v: number | string, what: string, line: number, stat: boolean): number | MarkStat {
  if (typeof v === "number") return v;
  if (stat && (v === "mean" || v === "median")) return v;
  throw new SpecError(`${what} must be a number${stat ? ", mean or median" : ""}; got "${v}".`, line);
}

/** Tick indices that fit side by side, kept from the end so the latest category always shows. */
function thin(xs: number[], labels: string[], px: number): number[] {
  const keep: number[] = [];
  let edge = Infinity;
  for (let i = xs.length - 1; i >= 0; i--) {
    const half = wide(labels[i], px, "mono") / 2;
    if (xs[i] + half + 12 <= edge) { keep.push(i); edge = xs[i] - half; }
  }
  return keep.reverse();
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

function subMap(v: unknown, where: string, keys: string[], line: number): Fields {
  if (v === undefined) return {};
  const m = requireMap(v, where, line);
  allowKeys(m, keys, where, line);
  return m;
}

function ownId(item: Fields, label: string, prefix: string, taken: Set<string>, where: string, line: number): string {
  const own = optString(item, "id", where, line);
  if (own === undefined) return idFrom(label, taken, `${prefix}-`);
  if (taken.has(own)) throw new SpecError(`${where}: id "${own}" is used twice.`, line, "id-unique");
  taken.add(own);
  return own;
}

/** Category text; YAML may hand over dates as Date objects and years as numbers. */
function category(v: unknown, what: string, line: number): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  throw new SpecError(`${what} must be text, a number or an ISO date; got ${JSON.stringify(v)}.`, line);
}

/** When every category is YYYY-MM or YYYY-MM-DD: UTC times and short labels ("Mar", "Mar 4", with the year when it changes). */
function readDates(cats: string[], where: string, line: number): { times: number[]; labels: string[] } | undefined {
  const parts = cats.map((c) => ISO_DATE.exec(c));
  if (!parts.every(Boolean)) return undefined;
  const times = parts.map((m, i) => {
    const yr = Number(m![1]), mo = Number(m![2]), day = m![3] ? Number(m![3]) : 1;
    const t = Date.UTC(yr, mo - 1, day);
    const d = new Date(t);
    if (mo < 1 || mo > 12 || d.getUTCDate() !== day) throw new SpecError(`${where}: "${cats[i]}" is not a real date.`, line);
    return t;
  });
  if (times.some((t, i) => i > 0 && t <= times[i - 1])) throw new SpecError(`${where}: dates must be in order, oldest first.`, line);
  const daily = parts.some((m) => m![3] !== undefined);
  const years = new Set(parts.map((m) => m![1])).size > 1;
  const labels = times.map((t) => {
    const d = new Date(t);
    const m = MONTHS[d.getUTCMonth()];
    if (daily) return years ? `${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : `${m} ${d.getUTCDate()}`;
    return years ? `${m} ${d.getUTCFullYear()}` : m;
  });
  return { times, labels };
}

function readValues(v: unknown, cats: string[], where: string, line: number): (number | null)[] {
  const one = (x: unknown, what: string) => (x === null || x === undefined || x === "" ? null : number(x, what, line));
  if (Array.isArray(v)) {
    if (v.length !== cats.length) {
      throw new SpecError(`${where} has ${v.length} values but there are ${cats.length} categories; give one value per category (~ for a gap).`, line);
    }
    return v.map((x, i) => one(x, `${where} value ${i + 1}`));
  }
  if (isObj(v)) {
    const out: (number | null)[] = cats.map(() => null);
    for (const [k, x] of Object.entries(v)) {
      const i = cats.indexOf(k);
      if (i < 0) throw new SpecError(`${where}: "${k}" is not one of the categories (${cats.join(", ")}).`, line, "ref-exists");
      out[i] = one(x, `${where} "${k}"`);
    }
    return out;
  }
  throw new SpecError(`${where} needs \`values\`: a list aligned with categories, or a map category → value.`, line);
}
