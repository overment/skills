// Radar: a few series scored on 3–8 shared axes. Each series is one filled polygon and one selectable mark; each axis name is selectable too.
import {
  BUDGET, SpecError, type BlockModule, type DataTable, type DocModel, type ElementInfo, type RawBlock, type ReadingSpec, type RenderContext,
} from "../types.ts";
import {
  NOTE_R, READING_KEYS, esc, factList, fmtUnit, format, idFrom, isObj, itemInfo, legend, linear, list, mark, notes, num, number, onSel,
  parseUnit, readingSpec, seriesSlot, signed, svgFigure, text, textWidth, wrap, type Format, type Frame,
} from "../kit.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString } from "../blocks/util.ts";

interface RadarAxis { id: string; label: string; max: number }

interface RadarSeries {
  id: string;
  label: string;
  values: number[]; // aligned with axes
  about?: string;
  focal: boolean;
  muted: boolean;
}

interface RadarBlock extends ReadingSpec {
  type: "radar";
  id: string;
  title?: string;
  line: number;
  format: Format;
  unit?: string;
  axes: RadarAxis[];
  shared: boolean; // every axis has the same max, so the rings can carry values
  series: RadarSeries[];
}

type Line = { t: string; cls: string };

const RADIUS = 150;
/** Left and right margin: the drawing starts at the column edge, and a selection ring (3px out, 2px wide) never clips. */
const EDGE = 8;
const RINGS = 4;
const GAP = 12;
const LABEL_MAX = 150;
const MAX_SERIES = 5;
const MAX_AXES = 8;
const SYMBOL_UNIT = /^[$€£¥%]$/;

function labelOf(v: unknown, what: string, line: number): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  throw new SpecError(`${what} must be text.`, line);
}

function positive(v: unknown, what: string, line: number): number {
  const n = number(v, what, line);
  if (n <= 0) throw new SpecError(`${what} must be above 0; got ${n}.`, line);
  return n;
}

function claimId(explicit: string | undefined, label: string, taken: Set<string>, prefix: string, where: string, line: number): string {
  if (explicit === undefined) return idFrom(label, taken, prefix);
  if (taken.has(explicit)) throw new SpecError(`${where}: id "${explicit}" is used twice.`, line, "id-unique");
  taken.add(explicit);
  return explicit;
}

/** Round top of the scale, e.g. 8.7 → 10. */
function niceMax(v: number): number {
  return v > 0 ? linear([0, v], [0, 1], { nice: true, count: RINGS }).domain[1] : 1;
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

/** Kit legends know series slots only; carry focal/muted over so the swatch matches the mark. */
function flagLegend(svg: string, series: RadarSeries[]): string {
  let out = svg;
  for (const s of series) {
    const flag = s.focal ? ` data-focal="true"` : s.muted ? ` data-muted="true"` : "";
    if (flag) out = out.replace(`data-id="${esc(s.id)}"`, `data-id="${esc(s.id)}"${flag}`);
  }
  return out;
}

function valuesFor(v: unknown, axes: string[], what: string, line: number): number[] {
  if (Array.isArray(v)) {
    if (v.length !== axes.length) throw new SpecError(`${what} has ${v.length} values for ${axes.length} axes; give one per axis, in axis order.`, line);
    return v.map((x, i) => number(x, `${what} (${axes[i]})`, line));
  }
  if (isObj(v)) {
    for (const k of Object.keys(v)) {
      if (!axes.includes(k)) throw new SpecError(`${what}: "${k}" is not an axis. Axes: ${axes.join(", ")}.`, line, "ref-exists");
    }
    return axes.map((a) => {
      if (!Object.hasOwn(v, a)) throw new SpecError(`${what} has no value for axis "${a}".`, line);
      return number(v[a], `${what} (${a})`, line);
    });
  }
  throw new SpecError(`${what} must be a list aligned with \`axes\` or a map axis: value.`, line);
}

const labeler = (b: RadarBlock) => (v: number) => fmtUnit(v, b.unit && SYMBOL_UNIT.test(b.unit) ? b.unit : undefined, b.format);

function summary(b: RadarBlock, s: RadarSeries): string {
  const f = labeler(b);
  return b.axes.map((a, j) => `${a.label} ${f(s.values[j])}`).join(" · ");
}

/** The series a series is compared with: the focal one, or (for the focal one) the first other. */
function counterpart(b: RadarBlock, s: RadarSeries): RadarSeries | undefined {
  const focal = b.series.find((x) => x.focal);
  return focal && focal !== s ? focal : b.series.find((x) => x !== s);
}

function normalize(raw: RawBlock, ctx: RenderContext): RadarBlock {
  const line = raw.line;
  const data = requireMap(raw.data, "radar", line);
  allowKeys(data, ["id", "title", "format", "unit", "max", "axes", "series", ...READING_KEYS], "radar", line);
  const id = requireString(data, "id", "radar", line);
  const where = `radar "${id}"`;
  const max = data.max === undefined ? undefined : positive(data.max, `${where} max`, line);

  const axesRaw = list(data.axes, `${where} axes`, line);
  if (axesRaw.length < 3) throw new SpecError(`${where} needs at least 3 \`axes\`; got ${axesRaw.length}. Compare 1–2 measures with a bar chart instead.`, line);
  const axisLabels: string[] = [];
  const axisMax: (number | undefined)[] = [];
  const axisIds: (string | undefined)[] = [];
  axesRaw.forEach((a, i) => {
    const aw = `${where} axis ${i + 1}`;
    if (isObj(a)) {
      allowKeys(a, ["id", "label", "max"], aw, line);
      axisLabels.push(labelOf(a.label, `${aw} label`, line));
      axisMax.push(a.max === undefined ? undefined : positive(a.max, `${aw} max`, line));
      axisIds.push(optString(a, "id", aw, line));
    } else {
      axisLabels.push(labelOf(a, aw, line));
      axisMax.push(undefined);
      axisIds.push(undefined);
    }
  });
  const dup = axisLabels.find((l, i) => axisLabels.indexOf(l) !== i);
  if (dup !== undefined) throw new SpecError(`${where}: axis "${dup}" is listed twice.`, line);

  const seriesRaw = list(data.series, `${where} series`, line);
  if (!seriesRaw.length) throw new SpecError(`${where} needs at least one entry in \`series\`.`, line);
  const taken = new Set([id, `${id}-title`, `${id}-desc`]);
  const series: RadarSeries[] = seriesRaw.map((s, i) => {
    const sw = `${where} series ${i + 1}`;
    if (!isObj(s)) throw new SpecError(`${sw} must be a map: { label, values, about }.`, line);
    allowKeys(s, ["id", "label", "values", "about", "focal", "muted"], sw, line);
    const label = labelOf(s.label, `${sw} label`, line);
    const values = valuesFor(s.values, axisLabels, `${sw} values`, line);
    values.forEach((v, j) => {
      if (v < 0) throw new SpecError(`${sw}: ${axisLabels[j]} is ${v}; radar values start at 0.`, line);
    });
    return {
      id: claimId(optString(s, "id", sw, line), label, taken, `${id}-`, where, line),
      label,
      values,
      about: optString(s, "about", sw, line),
      focal: optBool(s, "focal", sw, line),
      muted: optBool(s, "muted", sw, line),
    };
  });

  const fallback = max ?? niceMax(Math.max(...series.flatMap((s) => s.values)));
  const axes = axisLabels.map((label, j): RadarAxis => {
    const m = axisMax[j] ?? fallback;
    for (const s of series) {
      if (s.values[j] > m) throw new SpecError(`${where}: ${s.label} scores ${s.values[j]} on ${label}, above its max ${m}. Raise \`max\` or fix the value.`, line);
    }
    return { id: claimId(axisIds[j], `axis ${label}`, taken, `${id}-`, where, line), label, max: m };
  });
  const shared = axes.every((a) => a.max === axes[0].max);

  if (series.length > MAX_SERIES) {
    ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} draws ${series.length} series; above ${MAX_SERIES} the polygons hide each other. Keep the 2–3 that carry the point and move the rest to a second radar or a grouped bar chart.` });
  }
  if (axes.length > MAX_AXES) {
    ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} has ${axes.length} axes; above ${MAX_AXES} the labels crowd. Split the axes by theme into two radars of ${Math.ceil(axes.length / 2)}.` });
  }
  const focal = series.filter((s) => s.focal).length;
  if (focal > BUDGET.focal) {
    ctx.warn({ rule: "budget-focal", severity: "warn", line, message: `${where} marks ${focal} series focal; keep it to ${BUDGET.focal}.` });
  }
  return {
    type: "radar", id, title: optString(data, "title", where, line), line, format: format(data.format, line), unit: parseUnit(data.unit, line),
    axes, shared, series, ...readingSpec(data, line),
  };
}

function render(b: RadarBlock, ctx: RenderContext): string {
  const theme = ctx.theme;
  const pad = theme.grid.pad;
  const px = theme.type.nodeSub;
  const tag = theme.type.tag;
  const lh = Math.round(Math.max(px, tag) * 1.35);
  const cap = px * 0.72;
  const n = b.axes.length;
  const f = labeler(b);

  const labels: Line[][] = b.axes.map((a) => {
    const lines: Line[] = wrap(a.label, LABEL_MAX, px, "sans").map((t) => ({ t, cls: "x-mark-label x-radar-axis" }));
    if (!b.shared) lines.push({ t: `max ${f(a.max)}`, cls: "x-tick-label" });
    return lines;
  });
  const room = Math.max(...labels.map((l) => (l.length - 1) * lh + cap));
  const cy = pad + room + GAP + RADIUS;

  // Drawn around cx; `lo`/`hi` are the ink's horizontal ends (rim, axis names, note markers).
  const draw = (cx: number) => {
    const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
    const at = (i: number, r: number): [number, number] => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
    const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${num(x)},${num(y)}`).join("L")}Z`;
    const radius = (s: RadarSeries, j: number) => (RADIUS * s.values[j]) / b.axes[j].max;

    const grid: string[] = [];
    for (let k = 1; k <= RINGS; k++) {
      grid.push(`<path class="x-grid-line x-radar-ring" d="${poly(b.axes.map((_, i) => at(i, (RADIUS * k) / RINGS)))}"/>`);
    }
    for (let i = 0; i < n; i++) {
      const [x, y] = at(i, RADIUS);
      grid.push(`<line class="x-radar-spoke" x1="${num(cx)}" y1="${num(cy)}" x2="${num(x)}" y2="${num(y)}"/>`);
    }
    if (b.shared) {
      for (const k of [RINGS / 2, RINGS]) {
        const r = (RADIUS * k) / RINGS;
        grid.push(text(cx + 5, cy - r + tag + 3, f((b.axes[0].max * k) / RINGS), "x-tick-label x-radar-tick"));
      }
    }

    // one value label per vertex: outward when there is room before the axis name, inward near the rim
    const readout = (j: number, r: number, content: string, side = 0) => {
      const ux = Math.cos(angle(j)), uy = Math.sin(angle(j));
      const out = r <= RADIUS * 0.8 ? 12 : -14;
      const x = cx + ux * (r + out) - uy * side, y = cy + uy * (r + out) + ux * side + tag * 0.35;
      return text(x, y, content, "x-value-label x-radar-readout", Math.abs(ux) < 0.3 ? "middle" : (ux > 0) === (out > 0) ? "start" : "end");
    };

    // muted under, focal on top; palette slots follow the declared order so colors never shift
    const rank = (s: RadarSeries) => (s.focal ? 2 : s.muted ? 0 : 1);
    const order = b.series.map((s, i) => ({ s, i })).sort((a, c) => rank(a.s) - rank(c.s) || a.i - c.i);
    const anchors: Record<string, Frame> = {};
    // all areas first, then all outlines and dots, so no fill washes over another series' line;
    // the area layer mirrors the series id (no tab stop) so clicking inside a polygon still selects it
    const areas = order.map(({ s, i }) => {
      const d = poly(s.values.map((_, j) => at(j, radius(s, j))));
      const flags = `${s.focal ? ` data-focal="true"` : ""}${s.muted ? ` data-muted="true"` : ""}`;
      return `<g class="x-mark x-radar-series x-radar-fill" data-id="${esc(s.id)}" data-series="${seriesSlot(i, theme)}"${flags} aria-hidden="true"><path class="x-mark-shape x-radar-area" d="${d}"/></g>`;
    });
    const outlines = order.map(({ s, i }) => {
      const pts = s.values.map((_, j) => at(j, radius(s, j)));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      anchors[s.id] = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      const dots = pts.map(([x, y]) => `<circle class="x-mark-shape x-radar-dot" cx="${num(x)}" cy="${num(y)}" r="3"/>`).join("");
      const values = s.values.map((v, j) => readout(j, radius(s, j), f(v))).join("");
      return mark(
        { id: s.id, label: s.label, value: summary(b, s), series: seriesSlot(i, theme), focal: s.focal, cls: "x-radar-series", attrs: s.muted ? ` data-muted="true"` : "" },
        `<path class="x-series-line" d="${poly(pts)}"/>${dots}${onSel(values)}`,
      );
    });

    // axis marks: the name (and its hit box) selects the axis; on selection every series' value is printed at its vertex
    const axisMarks = b.axes.map((a, j) => {
      const [x, y] = at(j, RADIUS + GAP);
      const name = outside(x, y, Math.cos(angle(j)), Math.sin(angle(j)), labels[j], lh, cap, px);
      const bx = { x: name.box.x - 4, y: name.box.y - 4, w: name.box.w + 8, h: name.box.h + 8 };
      anchors[a.id] = name.box;
      // series whose vertices sit within 14px share one label
      const vs = b.series.map((s) => ({ s, r: radius(s, j) })).sort((p, q) => q.r - p.r);
      const clusters: { r: number; items: typeof vs }[] = [];
      for (const v of vs) {
        const last = clusters[clusters.length - 1];
        if (last && last.r - v.r < 14) last.items.push(v);
        else clusters.push({ r: v.r, items: [v] });
      }
      const values = clusters.map((c) => {
        const same = c.items.every((it) => it.s.values[j] === c.items[0].s.values[j]);
        const content = same && c.items.length > 1
          ? `${c.items.length === b.series.length ? (c.items.length === 2 ? "both" : "all") : c.items.length} ${f(c.items[0].s.values[j])}`
          : c.items.map((it) => f(it.s.values[j])).join(" · ");
        return readout(j, c.r, content, 0);
      }).join("");
      return mark(
        { id: a.id, label: a.label, value: b.series.map((s) => `${s.label} ${f(s.values[j])}`).join(" · "), cls: "x-radar-axis-mark", attrs: ` data-nav="0,${j}"` },
        `<rect class="x-mark-shape x-radar-axis-hit" x="${num(bx.x)}" y="${num(bx.y)}" width="${num(bx.w)}" height="${num(bx.h)}"/>${name.svg}${onSel(values)}`,
      );
    });

    const below = cy + RADIUS + GAP + room;
    const names = Object.values(anchors).filter((_, k) => k >= b.series.length);
    // the rim and every axis name with its 4px hit box
    const xs = [...b.axes.map((_, i) => at(i, RADIUS)[0]), ...names.flatMap((a) => [a.x - 4, a.x + a.w + 4])];
    const lo = Math.min(...xs), hi = Math.max(...xs);
    let body = `<g class="x-radar-grid">${grid.join("")}</g><g class="x-radar-areas">${areas.join("")}</g>${outlines.join("")}<g class="x-radar-axes">${axisMarks.join("")}</g>`;
    let height = below + pad;
    if (b.series.length > 1) {
      const lg = legend(b.series.map((s, i) => ({ id: s.id, label: s.label, series: seriesSlot(i, theme) })), theme, lo, hi, below + GAP);
      body += flagLegend(lg.svg, b.series);
      height = below + GAP + lg.height + pad / 2;
    }
    // markers may sit on either side; the crop keeps them
    const markers = notes(b, anchors, { obstacles: names, bounds: { x: -1e4, y: 0, w: 2e4, h: height } });
    const ends = [...markers.matchAll(/class="x-note-ring" cx="([-\d.]+)"/g)].flatMap((m) => [Number(m[1]) - NOTE_R, Number(m[1]) + NOTE_R]);
    return { body: body + markers, height, lo: Math.min(lo, ...ends), hi: Math.max(hi, ...ends) };
  };

  // The drawing starts at the column edge, so a card docked beside it sits right next to the chart.
  const { body, height, hi } = draw(EDGE - draw(0).lo);

  return svgFigure({
    id: b.id,
    kind: "radar",
    title: b.title,
    label: `Radar of ${joinList(b.series.map((s) => s.label))}`,
    desc: `${b.series.length} series scored on ${n} axes: ${joinList(b.axes.map((a) => a.label))}.`,
    width: Math.ceil(hi + EDGE),
    height,
    body,
  });
}

function model(b: RadarBlock): Partial<DocModel> {
  const elements: Record<string, ElementInfo> = {};
  const f = labeler(b);
  const fu = (v: number) => fmtUnit(v, b.unit, b.format);
  const d = (v: number) => signed(v, b.unit && SYMBOL_UNIT.test(b.unit) ? b.unit : undefined, b.format);
  const focal = b.series.find((s) => s.focal);
  for (const s of b.series) {
    const other = counterpart(b, s);
    let facts: ElementInfo["facts"];
    if (other) {
      const deltas = b.axes.map((a, j) => ({ a, j, dv: s.values[j] - other.values[j] }));
      const higher = deltas.filter((x) => x.dv > 0).length, lower = deltas.filter((x) => x.dv < 0).length;
      const ties = deltas.filter((x) => x.dv === 0).map((x) => x.a.label);
      const parts = [higher && `higher on ${higher}`, lower && `lower on ${lower}`, ties.length && `tie on ${joinList(ties)}`].filter(Boolean) as string[];
      // "higher on 4 of 5, tie on Trust": the count of axes goes with the first number
      const verdict = parts.map((p, k) => (k === 0 && !p.startsWith("tie") ? `${p} of ${b.axes.length}` : p)).join(", ");
      const biggest = [...deltas].filter((x) => x.dv !== 0).sort((p, q) => Math.abs(q.dv) - Math.abs(p.dv) || p.j - q.j);
      facts = factList([
        { k: `vs ${other.label}`, v: verdict, ref: other.id },
        ...biggest.map((x) => ({ k: x.a.label, v: `${f(s.values[x.j])} (${d(x.dv)})`, ref: x.a.id, tone: x.dv > 0 ? "up" as const : "down" as const, raw: x.dv })),
      ]);
    } else {
      const best = b.axes.reduce((m, a, j) => (s.values[j] / a.max > s.values[m] / b.axes[m].max ? j : m), 0);
      const worst = b.axes.reduce((m, a, j) => (s.values[j] / a.max < s.values[m] / b.axes[m].max ? j : m), 0);
      facts = factList([
        { k: "highest", v: `${b.axes[best].label} · ${f(s.values[best])}`, ref: b.axes[best].id },
        { k: "lowest", v: `${b.axes[worst].label} · ${f(s.values[worst])}`, ref: b.axes[worst].id },
      ]);
    }
    elements[s.id] = itemInfo({
      id: s.id, label: s.label, figure: b.id, kind: "series", value: summary(b, s), about: s.about, facts,
      context: b.axes.map((a) => a.id),
      say: `${s.label}: ${b.axes.map((a, j) => `${a.label} ${fu(s.values[j])}`).join(", ")}`,
    });
  }
  b.axes.forEach((a, j) => {
    const byValue = [...b.series].sort((p, q) => q.values[j] - p.values[j] || Number(q.focal) - Number(p.focal));
    elements[a.id] = itemInfo({
      id: a.id, label: a.label, figure: b.id, kind: "axis",
      value: byValue.map((s) => `${s.label} ${f(s.values[j])}`).join(" · "),
      pos: `${j + 1} of ${b.axes.length}`,
      // every series stays lit: an axis is read across all of them
      related: b.series.map((s) => s.id),
      context: b.axes.filter((x) => x !== a).map((x) => x.id),
      facts: factList(byValue.map((s) => ({
        k: s.label,
        v: !focal || s === focal ? `${f(s.values[j])} of ${f(a.max)}`
          : s.values[j] === focal.values[j] ? `${f(s.values[j])} (tie with ${focal.label})`
          : `${f(s.values[j])} (${d(s.values[j] - focal.values[j])} vs ${focal.label})`,
        ref: s.id,
        raw: s.values[j],
      }))),
      say: `${a.label}: ${byValue.map((s) => `${s.label} ${fu(s.values[j])}`).join(", ")}`,
    });
  });
  return { elements };
}

function reading(b: RadarBlock): string {
  const f = labeler(b);
  const scale = b.shared ? `from 0 at the centre to ${f(b.axes[0].max)} at the rim` : "from 0 at the centre to its own maximum, printed under its name";
  const focal = b.series.filter((s) => s.focal).map((s) => s.label);
  return `Each axis runs ${scale}; each series is one outline joining its scores, so a larger shape scores higher overall.` +
    (focal.length ? ` The accent outline is ${joinList(focal)}.` : "") +
    " Select an axis name to compare every series on it.";
}

function table(b: RadarBlock): DataTable {
  const f = labeler(b);
  return {
    head: ["Axis", ...b.series.map((s) => s.label), ...(b.shared ? [] : ["Max"])],
    rows: b.axes.map((a, j) => [a.label, ...b.series.map((s) => f(s.values[j])), ...(b.shared ? [] : [f(a.max)])]),
  };
}

export const blockModule: BlockModule<RadarBlock> = { type: "radar", normalize, render, model, reading, table };
