// Scatter and bubble chart: two measures per item, optional size and group, labels placed without overlaps.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type MarkStat, type ReadingSpec, type Unit } from "../types.ts";
import {
  READING_KEYS, SCALE_KEYS, axisX, axisY, delta, esc, factList, fmt, fmtTicks, fmtUnit, format as readFormat, groupInfo, idFrom, isObj, itemInfo,
  legend, linear, list, mark, markValue, niceTicks, notes as noteMarkers, num, number, parseUnit, plotFrame, rank, readingSpec, refBand, refLine,
  scaleSpec, seriesSlot, svgFigure, text, textWidth, trend, type Format, type Frame,
} from "../kit.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

interface ScatterPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  size?: number;
  group?: string;
  groupId?: string;
  slot: number;
  focal: boolean;
  muted: boolean;
  about?: string;
}

interface ScatterAxis { title?: string; format: Format; zero: boolean; unit?: Unit }
/** A reference line at a value, or at the mean or median of the points on that axis. */
interface ScatterMark { axis: "x" | "y"; at: number | MarkStat; label?: string }
interface ScatterBand { axis: "x" | "y"; from: number; to: number; label?: string }
interface ScatterGroup { id: string; label: string; slot: number; members: string[] }
type LabelMode = "auto" | "all" | "none";

interface ScatterBlock extends ReadingSpec {
  type: "scatter";
  id: string;
  title?: string;
  line: number;
  x: ScatterAxis;
  y: ScatterAxis;
  size: { title?: string; format: Format };
  labels: LabelMode;
  guides: { x?: number; y?: number };
  groups: ScatterGroup[];
  points: ScatterPoint[];
  bubble: boolean;
  marks: ScatterMark[];
  bands: ScatterBand[];
}

type Box = [number, number, number, number];
type Anchor = "start" | "middle" | "end";

const WIDTH = 960;
const PLOT_HEIGHT = 420;
const MAX_R = 28;
const MAX_POINTS = 60;
const MAX_LABELED = 12;
const MAX_GROUPS = 8;
const NOTE_PAD = 6;   // a note marker (r 8) sits beside the mark it points at, not on it
const LABELS: readonly LabelMode[] = ["auto", "all", "none"];
const PREFIX_UNITS = ["$", "€", "£", "¥"];

export const blockModule: BlockModule<ScatterBlock> = {
  type: "scatter",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "scatter", line);
    allowKeys(data, ["id", "title", "data", "x", "y", "size", "labels", "guides", ...READING_KEYS, ...SCALE_KEYS], "scatter", line);
    const id = requireString(data, "id", "scatter", line);
    const where = `scatter "${id}"`;
    const x = readAxis(data.x, `${where} x`, line);
    const y = readAxis(data.y, `${where} y`, line);
    const sizeMap = subMap(data.size, `${where} size`, ["title", "format"], line);
    const size = { title: optString(sizeMap, "title", `${where} size`, line), format: readFormat(sizeMap.format, line) };
    const labels = (optString(data, "labels", where, line) ?? "auto") as LabelMode;
    if (!LABELS.includes(labels)) throw new SpecError(`${where}: \`labels\` must be one of ${LABELS.join(", ")}.`, line);
    const g = subMap(data.guides, `${where} guides`, ["x", "y"], line);
    const guides = {
      x: g.x === undefined ? undefined : number(g.x, `${where} guides.x`, line),
      y: g.y === undefined ? undefined : number(g.y, `${where} guides.y`, line),
    };

    const rows = list(data.data, `${where} data`, line);
    if (rows.length < 2) throw new SpecError(`${where} needs at least 2 points in \`data\`; got ${rows.length}.`, line);
    const taken = new Set([id, `${id}-title`, `${id}-desc`]);
    const points: ScatterPoint[] = rows.map((r, i) => {
      const pw = `${where} point ${i + 1}`;
      if (!isObj(r)) throw new SpecError(`${pw} must be a map: { label, x, y }.`, line);
      allowKeys(r, ["id", "label", "x", "y", "size", "group", "about", "focal", "muted"], pw, line);
      const label = requireString(r, "label", pw, line);
      const lw = `${pw} ("${label}")`;
      const sz = r.size === undefined || r.size === null ? undefined : number(r.size, `${lw} size`, line);
      if (sz !== undefined && sz < 0) throw new SpecError(`${lw}: size must be 0 or more.`, line);
      return {
        id: ownId(r, label, id, taken, pw, line),
        label,
        x: number(r.x, `${lw} x`, line),
        y: number(r.y, `${lw} y`, line),
        size: sz,
        group: optString(r, "group", pw, line),
        slot: 1,
        focal: optBool(r, "focal", pw, line),
        muted: optBool(r, "muted", pw, line),
        about: optString(r, "about", pw, line),
      };
    });

    const bubble = points.some((p) => p.size !== undefined);
    const noSize = points.find((p) => p.size === undefined);
    if (bubble && noSize) throw new SpecError(`${where}: "${noSize.label}" has no \`size\`; give every point a size, or none.`, line);
    const noGroup = points.find((p) => p.group === undefined);
    if (points.some((p) => p.group !== undefined) && noGroup) {
      throw new SpecError(`${where}: "${noGroup.label}" has no \`group\`; give every point a group, or none.`, line);
    }
    const groups: ScatterGroup[] = [];
    for (const p of points) {
      if (p.group === undefined) continue;
      let grp = groups.find((it) => it.label === p.group);
      if (!grp) {
        grp = { id: idFrom(p.group, taken, `${id}-`), label: p.group, slot: seriesSlot(groups.length, ctx.theme), members: [] };
        groups.push(grp);
      }
      grp.members.push(p.id);
      p.groupId = grp.id;
      p.slot = grp.slot;
    }

    if (points.length > MAX_POINTS) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${points.length} points; keep it to ${MAX_POINTS}. Aggregate into groups, or show the top items and move the rest to a table.`, line });
    }
    if (labels === "all" && points.length > MAX_LABELED) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} labels all ${points.length} points; keep labels to ${MAX_LABELED}. Use \`labels: auto\` and let the detail panel name the rest.`, line });
    }
    if (groups.length > MAX_GROUPS) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${groups.length} groups; keep it to ${MAX_GROUPS} so colors stay distinct. Merge small groups into "Other".`, line });
    }
    const focal = points.filter((p) => p.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} points focal; keep it to ${BUDGET.focal}.`, line });
    }
    const bare = points.filter((p) => !p.about).length;
    if (bare) ctx.warn({ rule: "about-missing", severity: "warn", message: `${where}: ${bare} points have no \`about\`; the detail panel will be empty for them.`, line });

    const reading = readingSpec(data, line);
    checkRefs(reading, new Set([...points.map((p) => p.id), ...groups.map((g) => g.id)]), where, line);
    // Scale keys: a top-level `unit` is what y counts (y is the value axis); `x.unit` and `y.unit` set each axis.
    const scale = scaleSpec(data, line);
    if (scale.unit && !y.unit) y.unit = scale.unit;
    const marks: ScatterMark[] = (scale.marks ?? []).map((m, i) => ({ axis: m.axis, at: value(m.at, `${where} marks item ${i + 1} ${m.axis}`, line, true), label: m.label }));
    const bands: ScatterBand[] = (scale.bands ?? []).map((bd, i) => {
      const what = `${where} bands item ${i + 1}`;
      return { axis: bd.axis ?? "y", from: value(bd.from, `${what} from`, line, false) as number, to: value(bd.to, `${what} to`, line, false) as number, label: bd.label };
    });

    return { type: "scatter", id, title: optString(data, "title", where, line), line, x, y, size, labels, guides, groups, points, bubble, marks, bands, ...reading };
  },

  render(b, ctx) {
    const th = ctx.theme;
    const pad = th.grid.pad, tag = th.type.tag, px = th.type.nodeSub;
    const inset = b.bubble ? MAX_R : 8;
    const refs = (axis: "x" | "y") => [
      ...b.marks.filter((m) => m.axis === axis).map((m) => markValue(m.at, b.points.map((p) => p[axis]))),
      ...b.bands.filter((bd) => bd.axis === axis).flatMap((bd) => [bd.from, bd.to]),
    ];
    const xv = b.points.map((p) => p.x).concat(b.guides.x === undefined ? [] : [b.guides.x], refs("x"));
    const yv = b.points.map((p) => p.y).concat(b.guides.y === undefined ? [] : [b.guides.y], refs("y"));
    const probeX = linear([Math.min(...xv), Math.max(...xv)], [0, 1], { zero: b.x.zero });
    const probeY = linear([Math.min(...yv), Math.max(...yv)], [0, 1], { zero: b.y.zero });
    const yTicks = probeY.ticks();
    const yText = tickLabels(yTicks, b.y);
    const left = Math.max(48, ...yText.map((t) => wide(t, tag, "mono") + 16));
    const xTitle = b.x.title ?? wordUnit(b.x.unit), yTitle = b.y.title ?? wordUnit(b.y.unit);
    const frame = plotFrame(WIDTH, PLOT_HEIGHT, th, { left, right: pad, top: Math.max(pad / 2, yTitle ? 28 : 14), bottom: xTitle ? 46 : 36 });
    const sx = linear(probeX.domain, [frame.x + inset, frame.x + frame.w - inset], { nice: false });
    const sy = linear(probeY.domain, [frame.y + frame.h - inset, frame.y + inset], { nice: false });

    const maxSize = b.bubble ? Math.max(...b.points.map((p) => p.size ?? 0)) : 0;
    const radius = (s: number) => (maxSize > 0 ? Math.max(3, MAX_R * Math.sqrt(s / maxSize)) : 4);
    const geo = b.points.map((p) => ({ cx: sx(p.x), cy: sy(p.y), r: b.bubble ? radius(p.size ?? 0) : 5 }));

    // Bubbles: largest first so small ones stay on top. Points: context first, focal last.
    const order = b.points.map((_, i) => i).sort((a, c) =>
      b.bubble
        ? (b.points[c].size ?? 0) - (b.points[a].size ?? 0) || a - c
        : weight(b.points[a]) - weight(b.points[c]) || a - c);

    const guides = [
      b.guides.x === undefined ? "" : `<line class="x-guide-line" x1="${num(sx(b.guides.x))}" y1="${num(frame.y)}" x2="${num(sx(b.guides.x))}" y2="${num(frame.y + frame.h)}"/>`,
      b.guides.y === undefined ? "" : `<line class="x-guide-line" x1="${num(frame.x)}" y1="${num(sy(b.guides.y))}" x2="${num(frame.x + frame.w)}" y2="${num(sy(b.guides.y))}"/>`,
    ].join("");

    const marks = order.map((i) => {
      const p = b.points[i], g = geo[i];
      return mark(
        { id: p.id, label: p.label, value: valueText(b, p), series: p.slot, focal: p.focal, cls: b.bubble ? "x-bubble-mark" : "x-point-mark", attrs: p.muted ? ` data-muted="true"` : "" },
        `<circle class="x-point${b.bubble ? " x-bubble" : ""} x-mark-shape" cx="${num(g.cx)}" cy="${num(g.cy)}" r="${num(g.r)}"/>`,
      );
    }).join("");

    // Labels: first free spot among right, left, above, below; skipped when nothing fits.
    const placed: Box[] = [];
    const circles: Box[] = b.bubble ? [] : geo.map((g) => [g.cx - g.r, g.cy - g.r, g.cx + g.r, g.cy + g.r]);
    const labelSvg: string[] = [];
    const chosen = labelOrder(b);
    let hidden = 0;
    for (const i of chosen) {
      const p = b.points[i];
      const spot = spots(geo[i], wide(p.label, px, "sans"), px).find((s) =>
        inside(s.box, frame) && !placed.some((o) => overlaps(o, s.box)) && !circles.some((c, k) => k !== i && overlaps(c, s.box)));
      if (!spot) { hidden++; continue; }
      placed.push(spot.box);
      labelSvg.push(text(spot.x, spot.y, p.label, "x-mark-label x-scatter-label", spot.anchor));
    }
    if (b.labels === "all" && hidden) {
      ctx.warn({ rule: "label-fit", severity: "warn", message: `scatter "${b.id}": ${hidden} of ${chosen.length} labels were hidden to avoid overlaps; use \`labels: auto\` or label fewer points.`, line: b.line });
    }

    const yAxis = axisY(frame, yTicks.map((v, k) => ({ at: sy(v), label: yText[k] })), { title: yTitle });
    const xTicks = probeX.ticks(), xText = tickLabels(xTicks, b.x);
    const xAxis = axisX(frame, xTicks.map((v, k) => ({ at: sx(v), label: xText[k] })), { grid: true, title: xTitle });
    const bands = b.bands.map((bd) => (bd.axis === "y"
      ? refBand(frame, { y: [sy(bd.from), sy(bd.to)] }, bd.label, { px: tag })
      : refBand(frame, { x: [sx(bd.from), sx(bd.to)] }, bd.label, { px: tag }))).join("");
    const refLines = b.marks.map((m) => {
      const v = markValue(m.at, b.points.map((p) => p[m.axis]));
      return m.axis === "y" ? refLine(frame, { y: sy(v) }, m.label, { px: tag }) : refLine(frame, { x: sx(v) }, m.label, { px: tag });
    }).join("");

    // Note markers sit on a point; placed labels are obstacles.
    const anchors: Record<string, Frame> = {};
    b.points.forEach((p, i) => { const g = geo[i], r = g.r + NOTE_PAD; anchors[p.id] = { x: g.cx - r, y: g.cy - r, w: 2 * r, h: 2 * r }; });
    const noteSvg = noteMarkers(b, anchors, { obstacles: placed.map((o) => ({ x: o[0], y: o[1], w: o[2] - o[0], h: o[3] - o[1] })), bounds: frame });

    let below = "", extra = 0;
    if (b.groups.length) {
      const lg = legend(b.groups.map((g) => ({ id: g.id, label: g.label, series: g.slot, kind: "dot" })), th, frame.x, WIDTH - pad, PLOT_HEIGHT);
      below += lg.svg;
      extra += lg.height;
    }
    if (b.bubble && maxSize > 0) {
      const key = sizeKey(b, maxSize, frame.x, PLOT_HEIGHT + extra + 8, tag);
      below += key.svg;
      extra += key.height;
    }

    return svgFigure({
      id: b.id,
      kind: "scatter",
      title: b.title,
      label: `${b.bubble ? "Bubble" : "Scatter"} chart of ${yTitle ?? "y"} against ${xTitle ?? "x"}`,
      desc: `${b.points.length} items placed by ${xTitle ?? "x"} (across) and ${yTitle ?? "y"} (up)${b.bubble ? `, sized by ${b.size.title ?? "size"}` : ""}${b.groups.length ? `, colored by group` : ""}.`,
      width: WIDTH,
      height: PLOT_HEIGHT + extra,
      body: `${yAxis}${xAxis}${bands}${guides}${refLines}<g class="x-points">${marks}</g><g class="x-scatter-labels" aria-hidden="true">${labelSvg.join("")}</g>${below}${noteSvg}`,
    });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const xs = b.points.map((p) => p.x), ys = b.points.map((p) => p.y);
    const xName = axisName(b.x, "x"), yName = axisName(b.y, "y");
    for (const p of b.points) {
      const ry = rank(p.y, ys), rx = rank(p.x, xs);
      const group = b.groups.find((g) => g.id === p.groupId);
      elements[p.id] = itemInfo({
        id: p.id, label: p.label, figure: b.id, kind: b.bubble ? "bubble" : "point", value: valueText(b, p), sub: p.group, about: p.about,
        related: p.groupId ? [p.groupId] : undefined,
        facts: factList([
          { k: yName, v: `${val(p.y, b.y)} · ${ry.nth}`, raw: p.y },
          { k: xName, v: `${val(p.x, b.x)} · ${rx.nth}`, raw: p.x },
          p.size !== undefined && { k: b.size.title ?? "Size", v: fmt(p.size, b.size.format), raw: p.size },
          b.guides.y !== undefined && { k: `vs ${yName} guide`, v: delta(p.y, b.guides.y, b.y.unit, b.y.format), tone: trend(p.y - b.guides.y) },
          b.guides.x !== undefined && { k: `vs ${xName} guide`, v: delta(p.x, b.guides.x, b.x.unit, b.x.format), tone: trend(p.x - b.guides.x) },
          group && { k: "Group", v: group.label, ref: group.id },
        ]),
        pos: ry.text,
        context: group ? group.members.filter((m) => m !== p.id) : undefined,
        say: `${p.label}, ${valueText(b, p)}, ${ry.nth} by ${yName}`,
      });
    }
    for (const g of b.groups) {
      const mine = b.points.filter((p) => p.groupId === g.id);
      const mean = (f: (p: ScatterPoint) => number) => mine.reduce((t, p) => t + f(p), 0) / mine.length;
      const count = `${mine.length} ${mine.length === 1 ? "point" : "points"}`;
      elements[g.id] = groupInfo({
        id: g.id, label: g.label, figure: b.id, members: g.members, kind: "group", value: count,
        facts: factList([
          { k: "Points", v: `${mine.length} of ${b.points.length}` },
          { k: `Mean ${yName}`, v: val(mean((p) => p.y), b.y) },
          { k: `Mean ${xName}`, v: val(mean((p) => p.x), b.x) },
        ]),
        say: `${g.label}, ${count}, mean ${yName} ${val(mean((p) => p.y), b.y)}`,
      });
    }
    return { elements };
  },

  reading(b) {
    const head = `Each dot is one item: across is ${axisName(b.x, "x").toLowerCase()}, up is ${axisName(b.y, "y").toLowerCase()}` +
      `${b.bubble ? `, and its area is ${(b.size.title ?? "size").toLowerCase()}` : ""}${b.groups.length ? "; color is the group" : ""}.`;
    const focal = b.points.filter((p) => p.focal).map((p) => p.label);
    const rest = [
      focal.length ? `the accent ${focal.length > 1 ? "dots are" : "dot is"} ${joinList(focal)}` : "",
      b.points.some((p) => p.muted) ? "gray is context" : "",
      b.guides.x !== undefined || b.guides.y !== undefined || b.marks.length || b.bands.length ? "dashed rules and shaded ranges are references" : "",
    ].filter(Boolean);
    return rest.length ? `${head} ${cap(rest.join("; "))}.` : head;
  },

  table(b): DataTable {
    const head = ["Item", axisName(b.x, "x"), axisName(b.y, "y")];
    if (b.bubble) head.push(b.size.title ?? "Size");
    if (b.groups.length) head.push("Group");
    return {
      head,
      rows: b.points.map((p) => {
        const row = [p.label, exact(p.x, b.x), exact(p.y, b.y)];
        if (b.bubble) row.push(exact(p.size ?? 0, { format: b.size.format, zero: false }));
        if (b.groups.length) row.push(p.group ?? "");
        return row;
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

function valueText(b: ScatterBlock, p: ScatterPoint): string {
  const parts = [`${axisName(b.x, "x")} ${val(p.x, b.x)}`, `${axisName(b.y, "y")} ${val(p.y, b.y)}`];
  if (p.size !== undefined) parts.push(`${b.size.title ?? "size"} ${fmt(p.size, b.size.format)}`);
  return parts.join(" · ");
}

/** auto: focal points, then the extremes on each axis (and the largest bubble). */
function labelOrder(b: ScatterBlock): number[] {
  if (b.labels === "none") return [];
  const all = b.points.map((_, i) => i);
  const focal = all.filter((i) => b.points[i].focal);
  if (b.labels === "all") return [...focal, ...all.filter((i) => !b.points[i].focal)];
  const top = (f: (p: ScatterPoint) => number) => all.reduce((a, i) => (f(b.points[i]) > f(b.points[a]) ? i : a), 0);
  const picks = [...focal, top((p) => p.y), top((p) => -p.y), top((p) => p.x), top((p) => -p.x)];
  if (b.bubble) picks.push(top((p) => p.size ?? 0));
  return [...new Set(picks)];
}

function spots(g: { cx: number; cy: number; r: number }, tw: number, px: number): { x: number; y: number; anchor: Anchor; box: Box }[] {
  const h = px / 2 + 1, o = g.r + 4;
  return [
    { x: g.cx + o, y: g.cy + px * 0.35, anchor: "start", box: [g.cx + o, g.cy - h, g.cx + o + tw, g.cy + h] },
    { x: g.cx - o, y: g.cy + px * 0.35, anchor: "end", box: [g.cx - o - tw, g.cy - h, g.cx - o, g.cy + h] },
    { x: g.cx, y: g.cy - o, anchor: "middle", box: [g.cx - tw / 2, g.cy - o - px, g.cx + tw / 2, g.cy - o + 2] },
    { x: g.cx, y: g.cy + o + px * 0.8, anchor: "middle", box: [g.cx - tw / 2, g.cy + o, g.cx + tw / 2, g.cy + o + px + 1] },
  ];
}

function overlaps(a: Box, b: Box): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

function inside(box: Box, f: Frame): boolean {
  return box[0] >= f.x && box[2] <= f.x + f.w && box[1] >= f.y && box[3] <= f.y + f.h;
}

/** Two reference circles, bottom-aligned, with their values: the largest bubble and a round quarter. */
function sizeKey(b: ScatterBlock, maxSize: number, left: number, top: number, tag: number): { svg: string; height: number } {
  const title = text(left, top + 10, b.size.title ? `Size · ${b.size.title}` : "Size", "x-axis-label");
  const base = top + 24 + 2 * MAX_R;
  const circle = (cx: number, r: number) => `<circle class="x-size-key-circle" cx="${num(cx)}" cy="${num(base - r)}" r="${num(r)}"/>`;
  const maxText = fmt(maxSize, b.size.format);
  let svg = title + circle(left + MAX_R, MAX_R) + text(left + 2 * MAX_R + 8, base - MAX_R + tag * 0.35, maxText, "x-value-label");
  const quarter = niceTicks(0, maxSize / 4, 1).at(-1) ?? 0;
  if (quarter > 0 && quarter < maxSize) {
    const r = MAX_R * Math.sqrt(quarter / maxSize);
    const cx = left + 2 * MAX_R + 8 + wide(maxText, tag, "mono") + 24 + r;
    svg += circle(cx, r) + text(cx + r + 8, base - r + tag * 0.35, fmt(quarter, b.size.format), "x-value-label");
  }
  return { svg: `<g class="x-size-key" aria-hidden="true">${svg}</g>`, height: 24 + 2 * MAX_R + 16 };
}

function readAxis(v: unknown, where: string, line: number): ScatterAxis {
  const m = subMap(v, where, ["title", "format", "zero", "unit"], line);
  return { title: optString(m, "title", where, line), format: readFormat(m.format, line), zero: optBool(m, "zero", where, line), unit: parseUnit(m.unit, line) };
}

function val(v: number, a: ScatterAxis): string {
  return fmtUnit(v, a.unit, a.format);
}

/** What an axis measures, for cards and the reading line: its title, else a word unit, else "x" or "y". */
function axisName(a: ScatterAxis, fallback: string): string {
  return a.title ?? wordUnit(a.unit) ?? fallback;
}

function wordUnit(unit?: Unit): string | undefined {
  return unit && unit !== "%" && !PREFIX_UNITS.includes(unit) ? unit : undefined;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Axis labels in one unit ("0, 25k, 50k"), with the unit symbol when it is one ($, €, %). Word units go in the axis title. */
function tickLabels(ticks: number[], a: ScatterAxis): string[] {
  const out = fmtTicks(ticks, a.format).map((t) => t.replace(/^-/, "−"));
  if (!a.unit || !["auto", "int", "1", "2", "k"].includes(a.format)) return out;
  if (PREFIX_UNITS.includes(a.unit)) return out.map((t) => (t.startsWith("−") ? `−${a.unit}${t.slice(1)}` : `${a.unit}${t}`));
  return a.unit === "%" ? out.map((t) => `${t}%`) : out;
}

/** Full-precision cell for the data table: "7,600", "$1,234.50", "12%". */
function exact(v: number, a: { format: Format; unit?: Unit; zero: boolean }): string {
  const f = a.format;
  const digits: Format = f === "1" || f === "2" ? f : Number.isInteger(v) ? "int" : "2";
  return fmtUnit(v, a.unit ?? (["$", "€", "zł", "%", "h", "d"].includes(f) ? f : undefined), digits);
}

function value(v: number | string, what: string, line: number, stat: boolean): number | MarkStat {
  if (typeof v === "number") return v;
  if (stat && (v === "mean" || v === "median")) return v;
  throw new SpecError(`${what} must be a number${stat ? ", mean or median" : ""}; got "${v}".`, line);
}

/** notes and story may only point at this chart's points and groups. */
function checkRefs(r: ReadingSpec, ids: Set<string>, where: string, line: number): void {
  const miss = (id: string, what: string) => {
    if (!ids.has(id)) throw new SpecError(`${where} ${what} points at "${id}", which is not a point or group of this chart (e.g. "${[...ids][0]}").`, line, "ref-exists");
  };
  (r.notes ?? []).forEach((nt, i) => nt.on.forEach((id) => miss(id, `notes item ${i + 1}`)));
  (r.story ?? []).forEach((st, i) => {
    miss(st.sel, `story step ${i + 1}`);
    if (st.cmp) miss(st.cmp, `story step ${i + 1} cmp`);
  });
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

// esc is used through text(); keep the import explicit for label attributes added later.
void esc;
