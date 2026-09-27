// Waterfall: a starting total, signed changes that walk the running total, and total bars where the reader should stop and read.
// Sign is carried by fill weight (tinted up, hollow down), not by ok/danger hue, so the accent stays the only loud colour.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type MarkStat, type ReadingSpec, type ScaleSpec } from "../types.ts";
import {
  READING_KEYS, SCALE_KEYS, band, esc, factList, fmtUnit, format as readFormat, groupInfo, idFrom, isObj, itemInfo, legend, linear,
  list, mark, markValue, notes, num, number, onSel, ordinal, pct, rank, ratio, readingSpec, refBand, refLine, scaleSpec, share, signed, svgFigure,
  text, textWidth, trend, wrap, type Format, type Frame,
} from "../kit.ts";
import { textBoxes } from "./boxes.ts";
import { allowKeys, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

interface WaterfallStep {
  id: string;
  label: string;
  kind: "start" | "delta" | "total";
  value: number;          // the change for deltas, the total itself otherwise
  level: number;          // running total after this step
  about?: string;
  focal: boolean;
  muted: boolean;
}

interface WaterfallBlock extends ReadingSpec, ScaleSpec {
  type: "waterfall";
  id: string;
  title?: string;
  line: number;
  format: Format;
  axis?: string;
  steps: WaterfallStep[];
  /** Selectable legend keys: every increase, every decrease. Absent when there are none. */
  gains?: string;
  losses?: string;
}

const WIDTH = 960;
const PLOT_H = 280;
const KEYS = ["id", "title", "format", "axis", "data", ...READING_KEYS, ...SCALE_KEYS];
const ITEM_KEYS = ["id", "label", "value", "total", "about", "focal", "muted"];
const SYMBOL_UNIT = /^[$€£¥%]$/;

function labelOf(f: Fields, where: string, line: number): string {
  return typeof f.label === "number" ? String(f.label) : requireString(f, "label", where, line);
}

/** `data` as a list of maps, or the `label: value` shorthand (no totals besides the start). */
function readItems(v: unknown, where: string, line: number): Fields[] {
  if (isObj(v)) return Object.entries(v).map(([label, val]) => (isObj(val) ? { label, ...val } : { label, value: val }));
  return list(v, `${where} data`, line).map((it, i) => {
    if (!isObj(it)) throw new SpecError(`${where} data item ${i + 1} must be a map: { label, value } or { label, total: true }.`, line);
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

/** A waterfall has one numeric axis, the vertical one: `marks: [{y: …}]`, numbers, mean or median of the levels. */
function checkScale(spec: ScaleSpec, where: string, line: number): void {
  for (const m of spec.marks ?? []) {
    if (m.axis !== "y") throw new SpecError(`${where}: a waterfall's values run up the y axis; write the mark as {y: …}.`, line);
    if (typeof m.at === "string" && m.at !== "mean" && m.at !== "median") throw new SpecError(`${where}: marks value "${m.at}" must be a number, mean or median.`, line);
  }
  for (const bd of spec.bands ?? []) {
    if (bd.axis === "x") throw new SpecError(`${where}: bands run along the y axis; drop \`axis: x\`.`, line);
    if (typeof bd.from !== "number" || typeof bd.to !== "number") throw new SpecError(`${where}: bands need numbers in \`from\` and \`to\`.`, line);
  }
}

const sum = (xs: number[]) => xs.reduce((a, c) => a + c, 0);
const symbolUnit = (unit?: string) => (unit && SYMBOL_UNIT.test(unit) ? unit : undefined);
const signedPct = (v: number) => (v > 0 ? `+${pct(v)}` : pct(v));

/** Adds `attrs` to the legend item labelled `label` (the kit legend knows ids and series only). */
function tagLegend(svg: string, label: string, attrs: string): string {
  return svg.replace(new RegExp(`<g class="x-legend-item"([^>]*)>(?=<(?:rect|line|circle)[^>]*/><text[^>]*>${esc(label)}</text>)`), `<g class="x-legend-item"$1${attrs}>`);
}

/** Signed for changes (+12, −4), plain for totals. */
function valueText(st: WaterfallStep, f: (v: number) => string, d: (v: number) => string): string {
  return st.kind === "delta" ? d(st.value) : f(st.level);
}

/** Level before this step: 0 for the start and for totals (they stand on the baseline), else the previous level. */
function before(b: WaterfallBlock, i: number): number {
  return b.steps[i].kind === "delta" ? b.steps[i - 1].level : 0;
}

/**
 * "4.2 + 1.6 + 0.6 + 0.2 − 0.4 − 1.1 = 5.1" for the total at `i`, from the previous total (or the start),
 * in one shared scale, with the ids of every term.
 */
function reconcile(b: WaterfallBlock, i: number): { text: string; scale: string; ids: string[] } {
  let from = i - 1;
  while (from > 0 && b.steps[from].kind === "delta") from--;
  const terms = b.steps.slice(from, i);
  const big = Math.max(...b.steps.map((s) => Math.abs(s.kind === "delta" ? s.value : s.level)));
  const [div, letter] = big >= 1e9 ? [1e9, "B"] : big >= 1e6 ? [1e6, "M"] : big >= 1e4 ? [1e3, "k"] : [1, ""];
  const n = (v: number) => {
    const x = Math.abs(v) / div;
    return x.toLocaleString("en-US", { maximumFractionDigits: x < 10 && !Number.isInteger(x) ? 1 : 0 });
  };
  const parts = terms.map((s, k) => (k === 0 ? n(s.level) : `${s.value < 0 ? "−" : "+"} ${n(s.value)}`));
  const currency = ["$", "€"].includes(b.format) ? b.format : "";
  return { text: `${parts.join(" ")} = ${n(b.steps[i].level)}`, scale: `${currency}${letter}`, ids: terms.map((s) => s.id) };
}

export const blockModule: BlockModule<WaterfallBlock> = {
  type: "waterfall",

  normalize(raw, ctx) {
    const line = raw.line;
    const d = requireMap(raw.data, "waterfall", line);
    allowKeys(d, KEYS, "waterfall", line);
    const id = requireString(d, "id", "waterfall", line);
    const where = `waterfall "${id}"`;
    const scale = scaleSpec(d, line);
    checkScale(scale, where, line);
    const fields = readItems(d.data, where, line);
    if (fields.length < 2) throw new SpecError(`${where} needs a starting total and at least one change in \`data\`; got ${fields.length} item(s).`, line);
    const taken = new Set([id, `${id}-title`, `${id}-desc`]);
    reserveIds(fields, taken, where, line);
    let level = 0;
    const steps = fields.map((f, i): WaterfallStep => {
      const iw = `${where} item ${i + 1}`;
      allowKeys(f, ITEM_KEYS, iw, line);
      const label = labelOf(f, iw, line);
      const isTotal = optBool(f, "total", iw, line);
      let kind: WaterfallStep["kind"], value: number;
      if (i === 0) {
        value = number(f.value, `${iw} value (the starting total)`, line);
        level = value;
        kind = "start";
      } else if (isTotal) {
        if (f.value !== undefined) {
          const given = number(f.value, `${iw} value`, line);
          if (Math.abs(given - level) > 1e-6 * Math.max(1, Math.abs(level))) {
            throw new SpecError(`${iw}: total "${label}" says ${given} but the running total is ${Math.round(level * 1e6) / 1e6}; fix a change above it or drop \`value\`.`, line);
          }
        }
        value = level;
        kind = "total";
      } else {
        value = number(f.value, `${iw} value`, line);
        level += value;
        kind = "delta";
      }
      return {
        id: typeof f.id === "string" ? f.id : idFrom(label, taken, `${id}-`),
        label,
        kind,
        value,
        level,
        about: optString(f, "about", iw, line),
        focal: optBool(f, "focal", iw, line),
        muted: optBool(f, "muted", iw, line),
      };
    });
    if (steps.length > 8) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${steps.length} bars; keep 8 including totals. Merge the smallest changes into one "Other" step.`, line });
    }
    const focal = steps.filter((st) => st.focal).length;
    if (focal > BUDGET.focal) ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} bars focal; keep it to ${BUDGET.focal}.`, line });
    const deltas = steps.filter((st) => st.kind === "delta");
    return {
      type: "waterfall", id, title: optString(d, "title", where, line), line, format: readFormat(d.format, line), axis: optString(d, "axis", where, line),
      steps,
      gains: deltas.some((st) => st.value > 0) ? idFrom("increases", taken, `${id}-`) : undefined,
      losses: deltas.some((st) => st.value < 0) ? idFrom("decreases", taken, `${id}-`) : undefined,
      ...readingSpec(d, line),
      ...scale,
    };
  },

  render(b, ctx) {
    const theme = ctx.theme;
    const pad = theme.grid.pad, tag = theme.type.tag, lp = theme.type.nodeSub, lh = Math.round(lp * 1.35);
    const unit = symbolUnit(b.unit);
    const f = (v: number) => fmtUnit(v, unit, b.format);
    const dv = (v: number) => signed(v, unit, b.format);
    const spans = b.steps.map((st, i): [number, number] => [before(b, i), st.level]);
    const refVals = [
      ...(b.marks ?? []).flatMap((m) => (typeof m.at === "number" ? [m.at] : [])),
      ...(b.bands ?? []).flatMap((bd) => [bd.from as number, bd.to as number]),
    ];
    const flat = [...spans.flat(), ...refVals];
    const lo = Math.min(0, ...flat), hi = Math.max(0, ...flat);
    const axisTop = Math.round(pad / 2);
    const yTop = axisTop + (b.axis ? 22 : 0) + 18, yBot = yTop + PLOT_H;
    const s = linear([lo, hi], [yBot, yTop], { zero: true, nice: false });
    const bnd = band(b.steps.map((st) => st.id), [pad, WIDTH - pad], 0.3, 0.15);
    const bw = Math.min(bnd.bandwidth, 72);
    const lines = b.steps.map((st) => wrap(st.label, bnd.step - 8, lp));
    if (lines.some((ls) => ls.some((ln) => textWidth(ln, lp, "sans") > bnd.step - 4))) {
      ctx.warn({ rule: "label-fit", severity: "warn", message: `waterfall "${b.id}": some labels are wider than their column; shorten them to one or two words.`, line: b.line });
    }
    // labels of downward bars sit under the bar end; category labels start below the lowest one
    const reach = Math.max(yBot, ...spans.map(([a, e]) => (e < a ? s(e) + 8 + tag : yBot)));
    const catTop = reach + 8;
    const left = (i: number) => bnd(b.steps[i].id) + bnd.bandwidth / 2 - bw / 2;
    // the dashed carry line from bar i to bar i+1 at level i, and its level printed in the gap above it
    const link = (i: number, cls: string) => {
      const ly = s(b.steps[i].level);
      return `<line class="${cls}" x1="${num(left(i) + bw)}" y1="${num(ly)}" x2="${num(left(i + 1))}" y2="${num(ly)}"/>`;
    };
    const levelLabel = (i: number) => {
      const x = (left(i) + bw + left(i + 1)) / 2, ly = s(b.steps[i].level);
      return text(x, ly - 5, f(b.steps[i].level), "x-value-label x-level-label", "middle");
    };
    const back: string[] = [], body: string[] = [];
    const anchors: Record<string, Frame> = {};
    const obstacles: Frame[] = [];
    // the carry levels a selection prints are text too: no note marker on them
    b.steps.slice(0, -1).forEach((st, i) => {
      const w = textWidth(f(st.level), tag, "sans"), x = (left(i) + bw + left(i + 1)) / 2, ly = s(st.level);
      obstacles.push({ x: x - w / 2, y: ly - 5 - tag * 0.8, w, h: tag });
    });
    b.steps.forEach((st, i) => {
      const x = left(i), cx = x + bw / 2;
      const [a, e] = spans[i];
      const up = e >= a;
      const ry = Math.min(s(a), s(e)), rh = Math.max(1, Math.abs(s(e) - s(a)));
      anchors[st.id] = { x, y: ry, w: bw, h: rh };
      const rect = `<rect class="x-mark-shape" x="${num(x)}" y="${num(ry)}" width="${num(bw)}" height="${num(rh)}"/>`;
      const anchor = `<rect class="x-anchor" x="${num(x)}" y="${num(up ? ry - 1 : ry + rh - 1)}" width="${num(bw)}" height="2"/>`;
      const vt = valueText(st, f, dv);
      const vy = up ? s(e) - 6 : s(e) + 6 + tag * 0.8;
      const value = text(cx, vy, vt, "x-value-label", "middle");
      const vw = textWidth(vt, tag, "sans");
      obstacles.push({ x: cx - vw / 2, y: vy - tag * 0.8, w: vw, h: tag });
      const names = lines[i].map((ln, k) => {
        const w = textWidth(ln, lp, "sans");
        obstacles.push({ x: cx - w / 2, y: catTop + k * lh, w, h: lp * 1.2 });
        return text(cx, catTop + lp + k * lh, ln, "x-mark-label", "middle");
      }).join("");
      // on selection the carry lines into and out of this bar go solid and print their levels
      const into = i > 0 ? link(i - 1, "x-waterfall-link") + levelLabel(i - 1) : "";
      const out = i < b.steps.length - 1 ? link(i, "x-waterfall-link") + levelLabel(i) : "";
      const sign = st.kind === "delta" ? (st.value >= 0 ? "up" : "down") : "total";
      body.push(mark({
        id: st.id,
        label: st.label,
        value: vt,
        series: st.kind !== "delta" ? 1 : undefined,
        focal: st.focal,
        cls: "x-waterfall-bar",
        attrs: ` data-sign="${sign}"${st.muted ? ` data-muted="true"` : ""} data-nav="0,${i}"`,
      }, rect + anchor + value + names + onSel(into + out)));
      if (i < b.steps.length - 1) back.push(link(i, "x-grid-line x-waterfall-step"));
    });
    const plot: Frame = { x: pad, y: yTop, w: WIDTH - 2 * pad, h: PLOT_H };
    const [r0, r1] = s.range;
    const clamp = (v: number) => Math.min(Math.max(r0, r1), Math.max(Math.min(r0, r1), s(v)));
    const levels = b.steps.map((st) => st.level);
    const bands = (b.bands ?? []).map((bd) => refBand(plot, { y: [clamp(bd.from as number), clamp(bd.to as number)] }, bd.label, { px: tag })).join("");
    const rules = (b.marks ?? []).map((m) => {
      const v = markValue(m.at as number | MarkStat, levels);
      return refLine(plot, { y: clamp(v) }, m.label ?? (typeof m.at === "string" ? `${m.at} ${f(v)}` : f(v)), { px: tag });
    }).join("");
    const zero = `<line class="x-axis-line" x1="${num(pad)}" y1="${num(s(0))}" x2="${num(WIDTH - pad)}" y2="${num(s(0))}"/>`;
    const axis = b.axis ? text(pad, axisTop + tag, b.axis, "x-axis-label") : "";
    let height = catTop + lp + (Math.max(...lines.map((ls) => ls.length)) - 1) * lh + 8;
    // legend: what each fill weight means; the increase and decrease keys select every step of that sign
    const keys = [
      { label: "Total", series: 1, sign: "total" },
      ...(b.gains ? [{ id: b.gains, label: "Increase", sign: "up" }] : []),
      ...(b.losses ? [{ id: b.losses, label: "Decrease", sign: "down" }] : []),
      ...(b.steps.some((st) => st.focal) ? [{ label: "Focal", sign: "focal" }] : []),
    ];
    const lg = legend(keys, theme, pad, WIDTH - pad, height);
    const lsvg = keys.reduce((svg, k) => tagLegend(svg, k.label, ` data-sign="${k.sign}"`), lg.svg);
    height += lg.height + Math.round(pad / 2);
    // the axis title, reference labels and the legend are text a note marker must not cover either
    obstacles.push(...textBoxes(axis + bands + rules + lg.svg, tag));
    const marker = notes(b, anchors, { obstacles, bounds: { x: 0, y: 0, w: WIDTH, h: height } });
    const first = b.steps[0], last = b.steps[b.steps.length - 1];
    const desc = `${b.steps.length} steps from ${first.label} (${f(first.level)}) to ${last.label} (${f(last.level)}). Filled bars are totals, tinted bars add, hollow bars subtract.`;
    return svgFigure({
      id: b.id, kind: "waterfall", title: b.title, label: b.axis ?? "Waterfall chart", desc, width: WIDTH, height,
      body: bands + back.join("") + body.join("") + zero + rules + axis + lsvg + marker,
    });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const unit = symbolUnit(b.unit);
    const f = (v: number) => fmtUnit(v, unit, b.format);
    const fu = (v: number) => fmtUnit(v, b.unit, b.format);
    const dv = (v: number) => signed(v, unit, b.format);
    const deltas = b.steps.filter((st) => st.kind === "delta");
    const gains = deltas.filter((st) => st.value > 0), losses = deltas.filter((st) => st.value < 0);
    const grossGain = sum(gains.map((st) => st.value)), grossLoss = -sum(losses.map((st) => st.value));
    const bigGain = gains.reduce<WaterfallStep | undefined>((m, st) => (!m || st.value > m.value ? st : m), undefined);
    const bigLoss = losses.reduce<WaterfallStep | undefined>((m, st) => (!m || st.value < m.value ? st : m), undefined);
    const sizes = deltas.map((st) => Math.abs(st.value));
    const end = b.steps[b.steps.length - 1];
    b.steps.forEach((st, i) => {
      const from = before(b, i);
      const base = { id: st.id, label: st.label, figure: b.id, value: valueText(st, fu, (v) => signed(v, b.unit, b.format)), about: st.about };
      if (st.kind === "delta") {
        const r = rank(Math.abs(st.value), sizes);
        const loss = st.value < 0;
        const vs = loss ? bigGain : bigLoss;
        const other = vs && vs !== st && (loss
          ? { k: `vs ${vs.label}`, v: `cancels ${share(-st.value, vs.value)}`, ref: vs.id }
          : { k: `vs ${vs.label}`, v: st.value >= -vs.value ? `outweighs it ${ratio(st.value, -vs.value)}` : `offsets ${share(st.value, -vs.value)} of it`, ref: vs.id });
        const gross = loss ? grossLoss : grossGain;
        elements[st.id] = itemInfo({
          ...base, kind: loss ? "decrease" : "increase", sub: `running total ${fu(st.level)}`, pos: r.text,
          related: [loss ? b.losses : b.gains].filter((x): x is string => !!x),
          facts: factList([
            { k: "level", v: `${f(from)} → ${f(st.level)}`, raw: st.level },
            st.value !== 0 && { k: "share", v: `${share(Math.abs(st.value), gross)} of gross ${loss ? "losses" : "gains"} (${f(gross)})`, raw: gross ? (Math.abs(st.value) / gross) * 100 : undefined },
            other,
            { k: "rank", v: `${r.text} changes by size`, raw: r.n },
          ]),
          say: `${st.label}, ${dv(st.value)}, from ${f(from)} to ${f(st.level)}, ${ordinal(r.n)} largest of ${r.of} changes`,
        });
        return;
      }
      if (st.kind === "start") {
        elements[st.id] = itemInfo({
          ...base, kind: "total",
          facts: factList([
            end !== st && { k: `to ${end.label}`, v: `${f(end.level)} (${signedPct(st.level ? ((end.level - st.level) / Math.abs(st.level)) * 100 : 0)})`, ref: end.id, tone: trend(end.level - st.level) },
            bigGain && { k: "largest gain", v: `${bigGain.label} ${dv(bigGain.value)}`, ref: bigGain.id },
            bigLoss && { k: "largest loss", v: `${bigLoss.label} ${dv(bigLoss.value)}`, ref: bigLoss.id },
          ]),
          say: `${st.label}, ${fu(st.level)}`,
        });
        return;
      }
      const rec = reconcile(b, i);
      const baseStep = b.steps.find((s) => s.id === rec.ids[0])!;
      const net = st.level - baseStep.level;
      elements[st.id] = itemInfo({
        ...base, kind: "total",
        links: [{ rel: "Adds up from", ids: rec.ids }],
        facts: factList([
          { k: "net", v: `${dv(net)} (${signedPct(baseStep.level ? (net / Math.abs(baseStep.level)) * 100 : 0)}) vs ${baseStep.label}`, tone: trend(net), raw: net },
          { k: rec.scale ? `adds up (${rec.scale})` : "adds up", v: rec.text },
          bigGain && { k: "largest gain", v: `${bigGain.label} ${dv(bigGain.value)}`, ref: bigGain.id },
          bigLoss && { k: "largest loss", v: `${bigLoss.label} ${dv(bigLoss.value)}`, ref: bigLoss.id },
        ]),
        say: `${st.label}, ${fu(st.level)}, ${dv(net)} since ${baseStep.label}`,
      });
    });
    const key = (gid: string | undefined, list: WaterfallStep[], word: "increases" | "decreases") => {
      if (!gid) return;
      const total = sum(list.map((st) => st.value));
      const top = word === "increases" ? bigGain : bigLoss;
      elements[gid] = groupInfo({
        id: gid, label: word === "increases" ? "Increases" : "Decreases", figure: b.id, kind: "legend", members: list.map((st) => st.id), value: dv(total),
        facts: factList([
          { k: "steps", v: String(list.length), raw: list.length },
          top && { k: "largest", v: `${top.label} ${dv(top.value)}`, ref: top.id },
        ]),
        say: `${list.length} ${word}, ${dv(total)} in all`,
      });
    };
    key(b.gains, gains, "increases");
    key(b.losses, losses, "decreases");
    return { elements };
  },

  reading(b) {
    const f = (v: number) => fmtUnit(v, symbolUnit(b.unit), b.format);
    const first = b.steps[0], last = b.steps[b.steps.length - 1];
    const focal = b.steps.filter((st) => st.focal).map((st) => st.label);
    const i = b.steps.length - 1;
    const rec = last.kind === "total" ? reconcile(b, i) : undefined;
    return `Bars walk from ${first.label} (${f(first.level)}) to ${last.label} (${f(last.level)}). Solid bars are totals; tinted bars add and hollow bars subtract, each starting where the one before ended.` +
      (focal.length ? ` The accent marks ${focal.join(" and ")}.` : "") +
      (rec ? ` It adds up: ${rec.text}${rec.scale ? ` (${rec.scale})` : ""}.` : "");
  },

  table(b): DataTable {
    const unit = symbolUnit(b.unit);
    const f = (v: number) => fmtUnit(v, unit, b.format);
    return {
      head: ["Step", "Change", b.axis ?? "Level"],
      rows: b.steps.map((st) => [st.label, st.kind === "delta" ? signed(st.value, unit, b.format) : "", f(st.level)]),
    };
  },
};
