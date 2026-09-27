// Beeswarm: one numeric axis, one dot per item, dots dodged off the row centreline so none overlap. Optional rows per group.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type MarkStat, type ReadingSpec, type ScaleSpec } from "../types.ts";
import {
  READING_KEYS, SCALE_KEYS, axisX, factList, fmtUnit, format as readFormat, groupInfo, idFrom, isObj, itemInfo, linear, list, mark,
  markValue, notes, num, number, onSel, ordinal, rank, readingSpec, refBand, refLine, scaleSpec, seriesSlot, svgFigure, text, textWidth,
  wrap, type Format, type Frame,
} from "../kit.ts";
import { textBoxes } from "./boxes.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

interface SwarmDot { id: string; label: string; value: number; group?: string; about?: string; focal: boolean; muted: boolean }
interface SwarmGroup { id: string; label: string }

interface BeeswarmBlock extends ReadingSpec, ScaleSpec {
  type: "beeswarm";
  id: string;
  title?: string;
  line: number;
  format: Format;
  axis?: string;
  groups: SwarmGroup[];   // in order of first appearance; empty = one row
  dots: SwarmDot[];       // `group` holds the group id
}

const WIDTH = 960;
const R = 5;
const HEAD = 16; // room above the rows for the selected dot's readout, and again for reference-line labels when there are any
const KEYS = ["id", "title", "format", "axis", "data", ...READING_KEYS, ...SCALE_KEYS];
const ITEM_KEYS = ["id", "label", "value", "group", "about", "focal", "muted"];
const SYMBOL_UNIT = /^[$€£¥%]$/;

function labelOf(f: Fields, where: string, line: number): string {
  return typeof f.label === "number" ? String(f.label) : requireString(f, "label", where, line);
}

function readItems(v: unknown, where: string, line: number): Fields[] {
  if (isObj(v)) return Object.entries(v).map(([label, val]) => (isObj(val) ? { label, ...val } : { label, value: val }));
  return list(v, `${where} data`, line).map((it, i) => {
    if (!isObj(it)) throw new SpecError(`${where} data item ${i + 1} must be a map: { label, value, group? }.`, line);
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

/** A beeswarm has one numeric axis, the horizontal one: `marks: [{x: 2, label: 2 h target}]`. */
function checkScale(spec: ScaleSpec, where: string, line: number): void {
  for (const m of spec.marks ?? []) {
    if (m.axis !== "x") throw new SpecError(`${where}: a beeswarm's values run along the x axis; write the mark as {x: …}.`, line);
    if (typeof m.at === "string" && m.at !== "mean" && m.at !== "median") throw new SpecError(`${where}: marks value "${m.at}" must be a number, mean or median.`, line);
  }
  for (const bd of spec.bands ?? []) {
    if (bd.axis === "y") throw new SpecError(`${where}: bands run along the x axis; drop \`axis: y\`.`, line);
    if (typeof bd.from !== "number" || typeof bd.to !== "number") throw new SpecError(`${where}: bands need numbers in \`from\` and \`to\`.`, line);
  }
}

/**
 * Offsets from the centreline for dots at ascending `xs`, `d` apart at least.
 * Each dot takes the free candidate closest to the centre (ties: above first), so the layout is deterministic.
 */
function dodge(xs: number[], d: number): number[] {
  const ys: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const near: number[] = [];
    for (let j = i - 1; j >= 0 && xs[i] - xs[j] < d; j--) near.push(j);
    const cands = [0];
    for (const j of near) {
      const dy = Math.sqrt(d * d - (xs[i] - xs[j]) ** 2);
      cands.push(ys[j] + dy, ys[j] - dy);
    }
    cands.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
    const free = cands.find((c) => near.every((j) => (xs[i] - xs[j]) ** 2 + (c - ys[j]) ** 2 >= d * d - 1e-6));
    ys.push(free ?? 0);
  }
  return ys;
}

const symbolUnit = (unit?: string) => (unit && SYMBOL_UNIT.test(unit) ? unit : undefined);

/** Quantile by linear interpolation between the closest ranks (q in 0..1). */
function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return 0;
  const at = (s.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return s[lo] + (s[hi] - s[lo]) * (at - lo);
}

/** "lowest of 8", "3rd lowest of 8", "highest of 8". */
function place(v: number, values: number[]): string {
  const r = rank(v, values, "asc");
  if (values.length < 2) return "only one";
  if (r.n === 1) return `lowest of ${r.of}`;
  if (!values.some((x) => x > v)) return `highest of ${r.of}`;
  return `${ordinal(r.n)} lowest of ${r.of}`;
}

/** "0.4–3.2 h": the unit once, at the end, when both ends carry the same one. */
function span(lo: string, hi: string): string {
  const tail = hi.match(/[^\d.,]+$/)?.[0];
  return `${tail && lo.endsWith(tail) ? lo.slice(0, -tail.length) : lo}–${hi}`;
}

/** Reference lines resolve mean/median over every dot. */
function refValue(b: BeeswarmBlock, at: number | string): number {
  return markValue(at as number | MarkStat, b.dots.map((d) => d.value));
}

export const blockModule: BlockModule<BeeswarmBlock> = {
  type: "beeswarm",

  normalize(raw, ctx) {
    const line = raw.line;
    const d = requireMap(raw.data, "beeswarm", line);
    allowKeys(d, KEYS, "beeswarm", line);
    const id = requireString(d, "id", "beeswarm", line);
    const where = `beeswarm "${id}"`;
    const scale = scaleSpec(d, line);
    checkScale(scale, where, line);
    const fields = readItems(d.data, where, line);
    if (!fields.length) throw new SpecError(`${where}: \`data\` is empty; give at least one { label, value }.`, line);
    const taken = new Set([id, `${id}-title`, `${id}-desc`]);
    reserveIds(fields, taken, where, line);
    const parsed = fields.map((f, i) => {
      const iw = `${where} item ${i + 1}`;
      allowKeys(f, ITEM_KEYS, iw, line);
      const g = f.group;
      if (g !== undefined && typeof g !== "string" && typeof g !== "number") throw new SpecError(`${iw}: group must be text.`, line);
      return {
        f,
        label: labelOf(f, iw, line),
        value: number(f.value, `${iw} value`, line),
        group: g === undefined ? undefined : String(g),
        about: optString(f, "about", iw, line),
        focal: optBool(f, "focal", iw, line),
        muted: optBool(f, "muted", iw, line),
      };
    });
    const withGroup = parsed.filter((p) => p.group !== undefined).length;
    if (withGroup && withGroup < parsed.length) {
      throw new SpecError(`${where}: ${withGroup} of ${parsed.length} items have a \`group\`; give every item a group or none.`, line);
    }
    const groups: SwarmGroup[] = [];
    const groupId = new Map<string, string>();
    for (const p of parsed) {
      if (p.group === undefined || groupId.has(p.group)) continue;
      const gid = idFrom(p.group, taken, `${id}-`);
      groupId.set(p.group, gid);
      groups.push({ id: gid, label: p.group });
    }
    const dots: SwarmDot[] = parsed.map((p) => ({
      id: typeof p.f.id === "string" ? p.f.id : idFrom(p.label, taken, `${id}-`),
      label: p.label,
      value: p.value,
      group: p.group === undefined ? undefined : groupId.get(p.group),
      about: p.about,
      focal: p.focal,
      muted: p.muted,
    }));
    if (dots.length > 80) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${dots.length} dots; keep 80 or fewer. Show a sample, or bin the values into a bar chart per range.`, line });
    }
    if (groups.length > 6) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${groups.length} groups; keep 6 or fewer. Merge small groups or split into two charts.`, line });
    }
    const focal = dots.filter((p) => p.focal).length;
    if (focal > BUDGET.focal) ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} dots focal; keep it to ${BUDGET.focal}.`, line });
    return {
      type: "beeswarm", id, title: optString(d, "title", where, line), line, format: readFormat(d.format, line), axis: optString(d, "axis", where, line),
      groups, dots, ...readingSpec(d, line), ...scale,
    };
  },

  render(b, ctx) {
    const theme = ctx.theme;
    const pad = theme.grid.pad, tag = theme.type.tag, lp = theme.type.nodeSub, lh = Math.round(lp * 1.35);
    const f = (v: number) => fmtUnit(v, symbolUnit(b.unit), b.format);
    const grouped = b.groups.length > 0;
    const labelW = grouped ? Math.min(Math.ceil(Math.max(...b.groups.map((g) => textWidth(g.label, lp, "sans")))) + 16, Math.round(WIDTH * 0.25)) : 0;
    const x0 = pad + (grouped ? labelW + 16 : 0) + R, x1 = WIDTH - pad - R;
    const refVals = [
      ...(b.marks ?? []).flatMap((m) => (typeof m.at === "number" ? [m.at] : [])),
      ...(b.bands ?? []).flatMap((bd) => [bd.from as number, bd.to as number]),
    ];
    const vals = [...b.dots.map((d) => d.value), ...refVals];
    const s = linear([Math.min(...vals), Math.max(...vals)], [x0, x1], { nice: true });
    // reference-line labels take the first line above the rows, the selected dot's readout the line under it
    const refRows = b.marks?.length || b.bands?.some((bd) => bd.label) ? 1 : 0;
    const top = Math.round(pad / 2), rowsTop = top + HEAD * (1 + refRows), readoutY = top + tag + HEAD * refRows;
    const rows: { group?: SwarmGroup; slot?: number; dots: SwarmDot[] }[] = grouped
      ? b.groups.map((g, gi) => ({ group: g, slot: seriesSlot(gi, theme), dots: b.dots.filter((d) => d.group === g.id) }))
      : [{ dots: b.dots }];
    // pass 1: row heights and dot positions, so every selection rule can span the whole plot
    let y = rowsTop;
    const laid = rows.map((row) => {
      const sorted = [...row.dots].sort((a, c) => a.value - c.value);
      const xs = sorted.map((d) => s(d.value));
      const ys = dodge(xs, 2 * R + 1);
      const reach = Math.max(0, ...ys.map((v) => Math.abs(v))) + R;
      const head = sorted.some((d) => d.focal) ? tag + 10 : 0;
      const h = Math.max(40, 2 * reach + 16) + head, cy = y + head + (h - head) / 2;
      const out = { row, sorted, xs, ys, reach, y, h, cy };
      y += h;
      return out;
    });
    const plot: Frame = { x: x0 - R, y: top, w: x1 - x0 + 2 * R, h: y - top };
    const body: string[] = [];
    const anchors: Record<string, Frame> = {};
    const obstacles: Frame[] = [];
    const readout = (x: number, content: string) => {
      const flip = x + 4 + textWidth(content, tag, "sans") > plot.x + plot.w;
      return text(flip ? x - 4 : x + 4, readoutY, content, "x-ref-label x-delta-label", flip ? "end" : "start");
    };
    for (const { row, sorted, xs, ys, reach, y: ry, h, cy } of laid) {
      if (row.group) {
        const lines = wrap(row.group.label, labelW - 16, lp);
        const label = lines.map((ln, k) => text(pad + 16, cy + (k - (lines.length - 1) / 2) * lh + lp * 0.35, ln, "x-mark-label")).join("");
        // median tick and middle-half band: shown while the group is selected, and always in the full view
        const v = row.dots.map((d) => d.value);
        const q1 = s(quantile(v, 0.25)), q3 = s(quantile(v, 0.75)), md = s(quantile(v, 0.5));
        const stats = `<g class="x-on-sel x-swarm-stats"><rect class="x-swarm-iqr" x="${num(q1)}" y="${num(ry + 4)}" width="${num(Math.max(1, q3 - q1))}" height="${num(h - 8)}"/>` +
          `<line class="x-swarm-median" x1="${num(md)}" y1="${num(ry + 2)}" x2="${num(md)}" y2="${num(ry + h - 2)}"/></g>`;
        // the row header is the group's mark: swatch, name, and an anchor box so the card points at the row name
        const head = { x: pad, y: cy - lp, w: labelW, h: lp * 2 };
        body.push(mark({ id: row.group.id, label: row.group.label, value: `median ${f(quantile(v, 0.5))}`, series: row.slot, cls: "x-swarm-group" },
          `${stats}<circle class="x-mark-shape x-swarm-swatch" cx="${num(pad + 5)}" cy="${num(cy)}" r="4.5"/>${label}` +
          `<rect class="x-anchor" x="${num(head.x)}" y="${num(head.y)}" width="${num(head.w)}" height="${num(head.h)}"/>`));
        anchors[row.group.id] = head;
        obstacles.push({ x: pad, y: cy - lp, w: labelW, h: lp * 2 });
      }
      sorted.forEach((d, i) => {
        const cx = xs[i], dy = cy + ys[i];
        anchors[d.id] = { x: cx - R, y: dy - R, w: 2 * R, h: 2 * R };
        obstacles.push(anchors[d.id]);
        let note = "";
        if (d.focal) {
          const w = textWidth(d.label, lp, "sans");
          const lx = Math.min(Math.max(cx, x0 - R + w / 2), x1 + R - w / 2);
          note = text(lx, cy - reach - 6, d.label, "x-mark-label", "middle");
          obstacles.push({ x: lx - w / 2, y: cy - reach - 6 - lp, w, h: lp * 1.2 });
        }
        // on selection: a hairline at its value through every row, with its name and value above the plot
        const rule = `<line class="x-ref-rule x-sel-rule" x1="${num(cx)}" y1="${num(top + 4)}" x2="${num(cx)}" y2="${num(plot.y + plot.h)}"/>`;
        body.push(mark({
          id: d.id,
          label: d.label,
          value: f(d.value),
          series: row.slot,
          focal: d.focal,
          cls: "x-swarm",
          attrs: d.muted ? ` data-muted="true"` : "",
        }, `<circle class="x-mark-shape x-swarm-dot" cx="${num(cx)}" cy="${num(dy)}" r="${R}"/>${note}${onSel(rule + readout(cx, `${d.label} · ${f(d.value)}`))}`));
      });
    }
    const [r0, r1] = s.range;
    const clamp = (v: number) => Math.min(r1, Math.max(r0, s(v)));
    const bands = (b.bands ?? []).map((bd) => refBand(plot, { x: [clamp(bd.from as number), clamp(bd.to as number)] }, bd.label, { px: tag })).join("");
    const rules = (b.marks ?? []).map((m) => {
      const v = refValue(b, m.at);
      return refLine(plot, { x: clamp(v) }, m.label ?? (typeof m.at === "string" ? `${m.at} ${f(v)}` : f(v)), { px: tag });
    }).join("");
    const axis = axisX({ ...plot, y: rowsTop, h: y - rowsTop }, s.ticks().map((t) => ({ at: s(t), label: f(t) })), { grid: true, title: b.axis });
    // the packing note shares the axis title's row (axisX sets it 40px under the plot, the tick labels 20px), left-aligned
    const packing = grouped || b.dots.length > 1 ? text(plot.x, y + 40, "vertical spread only keeps dots apart", "x-legend-label x-legend-note") : "";
    const height = y + (b.axis || packing ? 40 : 24) + Math.round(pad / 2);
    // tick labels, the axis title, reference labels and the packing note are text a note marker must not cover either
    obstacles.push(...textBoxes(axis + bands + rules + packing, tag));
    const marker = notes(b, anchors, { obstacles, bounds: { x: 0, y: 0, w: WIDTH, h: height } });
    const desc = `${b.dots.length} items on one axis${grouped ? `, in ${b.groups.length} groups (${b.groups.map((g) => g.label).join(", ")})` : ""}${b.axis ? `: ${b.axis}` : ""}.`;
    return svgFigure({ id: b.id, kind: "beeswarm", title: b.title, label: b.axis ?? "Beeswarm chart", desc, width: WIDTH, height, body: bands + axis + rules + body.join("") + packing + marker });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const unit = symbolUnit(b.unit);
    const f = (v: number) => fmtUnit(v, unit, b.format);
    const fu = (v: number) => fmtUnit(v, b.unit, b.format);
    const all = b.dots.map((d) => d.value);
    const target = (b.marks ?? [])[0];
    const targetAt = target ? refValue(b, target.at) : undefined;
    for (const g of b.groups) {
      const members = b.dots.filter((d) => d.group === g.id);
      const v = members.map((d) => d.value);
      const md = quantile(v, 0.5);
      const under = targetAt === undefined ? 0 : v.filter((x) => x < targetAt).length;
      elements[g.id] = groupInfo({
        id: g.id, label: g.label, figure: b.id, kind: "group", members: members.map((d) => d.id), value: `median ${fu(md)}`,
        facts: factList([
          { k: "n", v: String(v.length), raw: v.length },
          { k: "median", v: fu(md), raw: md },
          { k: "range", v: span(fu(Math.min(...v)), fu(Math.max(...v))) },
          { k: "middle half", v: span(fu(quantile(v, 0.25)), fu(quantile(v, 0.75))) },
          target && targetAt !== undefined && { k: `under ${target.label ?? f(targetAt)}`, v: `${under} of ${v.length}`, raw: under },
        ]),
        say: `${g.label}, ${v.length} items, median ${fu(md)}, from ${f(Math.min(...v))} to ${fu(Math.max(...v))}`,
      });
    }
    for (const d of b.dots) {
      const g = b.groups.find((x) => x.id === d.group);
      const peers = g ? b.dots.filter((x) => x.group === g.id) : b.dots;
      const pv = peers.map((x) => x.value);
      const sorted = [...peers].sort((a, c) => a.value - c.value || b.dots.indexOf(a) - b.dots.indexOf(c));
      const at = sorted.indexOf(d);
      const lower = sorted[at - 1], higher = sorted[at + 1];
      const where = g ? `in ${g.label}` : "overall";
      elements[d.id] = itemInfo({
        id: d.id,
        label: d.label,
        figure: b.id,
        kind: "point",
        value: fu(d.value),
        sub: g?.label,
        about: d.about,
        related: g ? [g.id] : undefined,
        context: peers.filter((x) => x !== d).map((x) => x.id),
        pos: rank(d.value, pv, "asc").text,
        facts: factList([
          { k: where, v: place(d.value, pv) },
          g && { k: `${g.label} median`, v: fu(quantile(pv, 0.5)), raw: quantile(pv, 0.5) },
          g && { k: "overall", v: place(d.value, all) },
          lower && { k: "next lower", v: `${lower.label} · ${f(lower.value)}`, ref: lower.id },
          higher && { k: "next higher", v: `${higher.label} · ${f(higher.value)}`, ref: higher.id },
        ]),
        say: `${d.label}, ${fu(d.value)}, ${place(d.value, pv)}${g ? ` in ${g.label}` : ""}`,
      });
    }
    return { elements };
  },

  reading(b) {
    const what = b.axis ? b.axis.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()) : "its value";
    const groups = b.groups.length ? ` Each row is one group (${joinList(b.groups.map((g) => g.label))}).` : "";
    const focal = b.dots.filter((d) => d.focal).map((d) => d.label);
    const marks = (b.marks ?? []).map((m) => m.label).filter(Boolean);
    return `Each dot is one item placed by ${what}; dots that would overlap are pushed up or down, so the vertical spread only keeps them apart.${groups}` +
      (marks.length ? ` The dashed line marks ${joinList(marks as string[])}.` : "") +
      (focal.length ? ` The accent dot is ${joinList(focal)}.` : "");
  },

  table(b): DataTable {
    const f = (v: number) => fmtUnit(v, symbolUnit(b.unit), b.format);
    const name = (d: SwarmDot) => b.groups.find((g) => g.id === d.group)?.label ?? "";
    const valueHead = b.axis ?? (b.unit ? `Value (${b.unit})` : "Value");
    return {
      head: ["Item", ...(b.groups.length ? ["Group"] : []), valueHead],
      rows: b.dots.map((d) => [d.label, ...(b.groups.length ? [name(d)] : []), f(d.value)]),
    };
  },
};
