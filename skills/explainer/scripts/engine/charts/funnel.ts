// Funnel: ordered stages as centered bars (width ∝ value) with step conversion on the right.
// The biggest relative drop becomes the focal stage unless the author marks one.
import { BUDGET, SpecError, type BlockModule, type ElementInfo, type Fact, type ReadingSpec } from "../types.ts";
import {
  fmt, format as readFormat, idFrom, isObj, itemInfo, list, mark, notes as noteMarkers, num, number, onSel, rank, readingSpec, share, signed,
  svgFigure, text, textWidth, wrap, type Format, type Frame,
} from "../kit.ts";
import { allowKeys, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";
import { markInk } from "./ink.ts";

interface FunnelStage {
  id: string;
  label: string;
  value: number;
  about?: string;
  focal: boolean;
  muted: boolean;
}

interface FunnelBlock extends ReadingSpec {
  type: "funnel";
  id: string;
  title?: string;
  line: number;
  format: Format;
  stages: FunnelStage[];
}

const MAX_STAGES = 7;
const ITEM_KEYS = ["id", "label", "value", "about", "focal", "muted"];
const RATE_HEAD = "Conversion";
/** Left and right margin: the labels start at the column edge, and a selection ring (3px out, 2px wide) never clips. */
const EDGE = 8;

function labelOf(v: unknown, where: string, line: number): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  throw new SpecError(`${where} needs a \`label\` (text).`, line);
}

function stageOf(x: Fields, label: string, where: string, line: number): Omit<FunnelStage, "id"> & { id?: string } {
  if (x.value === undefined || x.value === null) throw new SpecError(`${where} needs a \`value\`.`, line);
  const value = number(x.value, `${where} value`, line);
  if (value < 0) throw new SpecError(`${where} value must be 0 or more; got ${value}.`, line);
  return {
    id: optString(x, "id", where, line),
    label,
    value,
    about: optString(x, "about", where, line),
    focal: optBool(x, "focal", where, line),
    muted: optBool(x, "muted", where, line),
  };
}

function readStages(v: unknown, where: string, line: number) {
  if (v === undefined) throw new SpecError(`${where} needs \`data\`: a list of { label, value, about } from the first stage to the last.`, line);
  if (!Array.isArray(v) && isObj(v)) {
    return Object.entries(v).map(([label, x]) => {
      const iw = `${where} stage "${label}"`;
      if (isObj(x)) {
        allowKeys(x, ITEM_KEYS.filter((k) => k !== "label"), iw, line);
        return stageOf(x, label, iw, line);
      }
      return stageOf({ value: x }, label, iw, line);
    });
  }
  return list(v, `${where} data`, line).map((x, i) => {
    const iw = `${where} stage ${i + 1}`;
    if (!isObj(x)) throw new SpecError(`${iw} must be a map: { label, value, about }.`, line);
    allowKeys(x, ITEM_KEYS, iw, line);
    return stageOf(x, labelOf(x.label, iw, line), iw, line);
  });
}

/** Explicit ids stay as written (prose links use them); the rest become `<block>-<label>`. */
function withIds<T extends { id?: string; label: string }>(items: T[], blockId: string, where: string, line: number): (T & { id: string })[] {
  const taken = new Set<string>([blockId]);
  for (const it of items) {
    if (it.id === undefined) continue;
    if (taken.has(it.id)) throw new SpecError(`${where}: id "${it.id}" is used twice (ids must also differ from the block id).`, line, "id-unique");
    taken.add(it.id);
  }
  return items.map((it) => ({ ...it, id: it.id ?? idFrom(it.label, taken, `${blockId}-`) }));
}

/** Share of `whole` as a rounded percent: "42%", "3.5%". */
function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const p = (part / whole) * 100;
  return fmt(p >= 10 ? Math.round(p) : Math.round(p * 10) / 10, "%");
}

export const blockModule: BlockModule<FunnelBlock> = {
  type: "funnel",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "funnel", line);
    allowKeys(data, ["id", "title", "format", "data", "focal", "notes", "caveat", "story"], "funnel", line);
    const id = requireString(data, "id", "funnel", line);
    const where = `funnel "${id}"`;
    const format = readFormat(data.format, line);
    // `focal: false` on the block turns the automatic focal off: a neutral funnel with no accent.
    const auto = optBool(data, "focal", where, line, true);
    const stages: FunnelStage[] = withIds(readStages(data.data, where, line), id, where, line);
    const n = stages.length;
    if (n < 2) throw new SpecError(`${where} needs at least 2 stages in \`data\`; got ${n}.`, line);
    if (n > MAX_STAGES) {
      const k = Math.ceil(n / 2);
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${n} stages; the budget is ${MAX_STAGES}. Merge steps that lose almost nobody, or split it into two funnels: stages 1–${k} and ${k}–${n}.`, line });
    }
    for (let i = 1; i < n; i++) {
      const prev = stages[i - 1], cur = stages[i];
      if (cur.value > prev.value) {
        ctx.warn({ rule: "spec", severity: "warn", message: `${where}: "${cur.label}" (${fmt(cur.value, format)}) is larger than "${prev.label}" (${fmt(prev.value, format)}) above it. A funnel only narrows; check for re-entries or mixed units, or use a bar chart.`, line });
      }
    }
    const focal = stages.filter((s) => s.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} stages focal; keep it to ${BUDGET.focal}.`, line });
    }
    if (focal === 0 && auto) {
      let at = -1, worst = 1;
      for (let i = 1; i < n; i++) {
        const prev = stages[i - 1].value;
        if (prev <= 0 || stages[i].muted) continue;
        const r = stages[i].value / prev;
        if (r < worst) { worst = r; at = i; }
      }
      if (at > 0) stages[at].focal = true;
    }
    return { type: "funnel", id, title: optString(data, "title", where, line), line, format, stages, ...readingSpec(data, line) };
  },

  render(block, ctx) {
    const { theme } = ctx;
    const W = 960, pad = theme.grid.pad, px = theme.type.nodeSub, tag = theme.type.tag;
    const stages = block.stages;
    const lineH = Math.round(px * 1.3), gap = 12;
    const lines = stages.map((s) => wrap(s.label, 240, px));
    // the widest line at the 600 weight a selected label takes, so the longest label starts at the column edge and never clips
    const labelW = Math.max(...lines.flat().map((ln) => textWidth(ln, px, "sans"))) * 1.08;
    const barH = Math.max(32, Math.max(...lines.map((l) => l.length)) * lineH + 10);
    const rates = stages.map((s, i) => (i === 0 ? "" : `→ ${pct(s.value, stages[i - 1].value)}`));
    // the head and the rates are sans; a selected rate turns 600
    const headW = textWidth(RATE_HEAD, tag, "sans") * 1.08;
    const rateW = Math.max(headW, ...rates.map((r) => textWidth(r, tag, "sans") * 1.08));
    const top = pad / 2 + tag + 12;
    const left = EDGE + labelW + 16, right = W - EDGE - rateW - 24;
    const cx = (left + right) / 2;
    const max = Math.max(...stages.map((s) => s.value)) || 1;
    const height = top + stages.length * (barH + gap) - gap + pad;

    const mids = stages.map((_, i) => top + i * (barH + gap) + barH / 2);
    const bracketX = right + 12;
    const anchors: Record<string, Frame> = {};
    const labelBoxes: Frame[] = [];
    const rows = stages.map((s, i) => {
      const y = top + i * (barH + gap), mid = mids[i];
      const w = s.value > 0 ? Math.max(2, (s.value / max) * (right - left)) : 0;
      const value = fmt(s.value, block.format);
      anchors[s.id] = { x: cx - w / 2, y, w, h: barH };
      const parts = [`<rect class="x-mark-shape" x="${num(cx - w / 2)}" y="${num(y)}" width="${num(w)}" height="${num(barH)}"/>`];
      const first = mid - ((lines[i].length - 1) * lineH) / 2 + px * 0.35;
      lines[i].forEach((ln, k) => parts.push(text(EDGE + labelW, first + k * lineH, ln, "x-mark-label", "end")));
      labelBoxes.push({ x: EDGE, y, w: labelW, h: barH });
      const inside = w >= textWidth(value, px, "sans") + 20;
      parts.push(inside
        ? text(cx, mid + px * 0.35, value, "x-mark-label x-on-fill x-funnel-value", "middle")
        : text(cx + w / 2 + 6, mid + tag * 0.35, value, "x-value-label"));
      if (rates[i]) {
        parts.push(text(W - EDGE, mid + tag * 0.35, rates[i], "x-value-label x-funnel-rate", "end"));
        labelBoxes.push({ x: W - EDGE - rateW, y: mid - tag, w: rateW, h: tag * 2 });
      }
      // Selected: a bracket in the conversion column from the first stage down to this one, with the share of the top.
      if (i >= 2) {
        const y0 = mids[0], y1 = mid;
        const tick = (yy: number) => `M${num(bracketX - 4)},${num(yy)}H${num(bracketX)}`;
        parts.push(onSel(
          `<path class="x-funnel-bracket" d="${tick(y0)}M${num(bracketX)},${num(y0)}V${num(y1)}${tick(y1)}"/>` +
          text(W - EDGE, mid + tag * 1.35 + 4, `${pct(s.value, stages[0].value)} from top`, "x-value-label x-funnel-total", "end"),
        ));
      }
      const attrs = (s.muted ? ` data-muted="true"` : "") + (inside ? markInk(theme, { focal: s.focal, muted: s.muted }) : "") + ` data-nav="${i},0"`;
      return mark({ id: s.id, label: s.label, value, focal: s.focal, cls: "x-funnel-stage", attrs }, parts.join(""));
    });

    const [a, z] = [stages[0], stages[stages.length - 1]];
    return svgFigure({
      id: block.id,
      kind: "funnel",
      title: block.title,
      label: `Funnel from ${a.label} to ${z.label}`,
      desc: `${stages.length} stages from ${a.label} (${fmt(a.value, block.format)}) to ${z.label} (${fmt(z.value, block.format)}); ${pct(z.value, a.value)} make it through.`,
      width: W,
      height,
      body: text(W - EDGE, top - 12, RATE_HEAD, "x-axis-label", "end") + `<g class="x-funnel">${rows.join("")}</g>` +
        noteMarkers(block, anchors, { obstacles: labelBoxes, bounds: { x: 0, y: 0, w: W, h: height } }),
    });
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const stages = block.stages, n = stages.length;
    const first = stages[0], last = stages[n - 1];
    const val = (x: number) => fmt(x, block.format);
    const losses = stages.map((s, i) => (i === 0 ? 0 : Math.max(0, stages[i - 1].value - s.value)));
    const totalLoss = losses.reduce((a, x) => a + x, 0);
    const steps = losses.slice(1);
    const worst = losses.indexOf(Math.max(...losses));
    stages.forEach((s, i) => {
      const prev = stages[i - 1], next = stages[i + 1];
      const facts: Fact[] = [];
      if (prev) {
        // The chart already prints the step rate, so the card leads with what it can't show: this step's share of all drop-off.
        const lost = losses[i] > 0 && totalLoss > 0;
        if (lost) facts.push({ k: "Drop-off share", v: `${share(losses[i], totalLoss)} of all drop-off`, raw: (losses[i] / totalLoss) * 100 });
        facts.push({ k: "Step conversion", v: `${pct(s.value, prev.value)} of ${prev.label} (${signed(s.value - prev.value, undefined, block.format)})`, raw: prev.value ? (s.value / prev.value) * 100 : 0 });
        if (i > 1) facts.push({ k: "From the top", v: `${pct(s.value, first.value)} of ${first.label}`, raw: first.value ? (s.value / first.value) * 100 : 0 });
        if (lost && steps.length > 1) facts.push({ k: "Drop rank", v: `${rank(losses[i], steps).nth} steps` });
      } else {
        facts.push({ k: "Reach the end", v: `${pct(last.value, s.value)} (${val(last.value)})`, ref: last.id });
        if (worst > 0) facts.push({ k: "Biggest drop", v: `${stages[worst].label} (${signed(-losses[worst], undefined, block.format)})`, ref: stages[worst].id });
      }
      const related = [...new Set([prev?.id, first.id].filter((x): x is string => !!x && x !== s.id))];
      const links = [prev && { rel: "Previous", ids: [prev.id] }, next && { rel: "Next", ids: [next.id] }].filter((l): l is { rel: string; ids: string[] } => !!l);
      const say = [`${s.label}, ${val(s.value)}`, prev ? `${pct(s.value, prev.value)} of ${prev.label}` : "", losses[i] > 0 && totalLoss > 0 ? `${share(losses[i], totalLoss)} of all drop-off` : ""].filter(Boolean).join(", ");
      elements[s.id] = itemInfo({
        id: s.id, label: s.label, figure: block.id, kind: "stage", value: val(s.value), about: s.about,
        related, facts, links, pos: `${i + 1} of ${n}`, say,
      });
    });
    return { elements };
  },

  reading() {
    return "Bar width = the count that reached each stage, on one scale. The % on the right is conversion from the stage above; select a stage to see its share of the top and of all drop-off.";
  },

  table(block) {
    const first = block.stages[0];
    return {
      head: ["Stage", "Count", "From previous", "From first"],
      rows: block.stages.map((s, i) => [s.label, fmt(s.value, block.format), i ? pct(s.value, block.stages[i - 1].value) : "—", i ? pct(s.value, first.value) : "—"]),
    };
  },
};
