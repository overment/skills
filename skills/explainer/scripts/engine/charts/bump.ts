// Bump chart: rank over periods. Rank 1 sits on top; each dot carries its rank number.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type ReadingSpec } from "../types.ts";
import {
  READING_KEYS, factList, groupInfo, idFrom, isObj, itemInfo, list, mark, notes as noteMarkers, num, number, ordinal, readingSpec, seriesSlot,
  svgFigure, text, textWidth, trend, type Frame,
} from "../kit.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

interface BumpSeries {
  id: string;
  label: string;
  ranks: (number | null)[]; // aligned with categories; null = not ranked that period
  points: string[];         // dot mark id per period, "" where unranked
  slot: number;
  focal: boolean;
  muted: boolean;
  about?: string;
}

interface BumpBlock extends ReadingSpec {
  type: "bump";
  id: string;
  title?: string;
  line: number;
  categories: string[];
  labels: string[];
  series: BumpSeries[];
}

type Pt = [number, number];

const WIDTH = 960;
const ROW = 36;
const DOT_R = 11;
const MAX_SERIES = 8;
const MAX_PERIODS = 8;
const NOTE_PAD = 6;   // a note marker (r 8) sits beside the mark it points at, not on it
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_DATE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

export const blockModule: BlockModule<BumpBlock> = {
  type: "bump",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "bump", line);
    allowKeys(data, ["id", "title", "categories", "series", ...READING_KEYS], "bump", line);
    const id = requireString(data, "id", "bump", line);
    const where = `bump "${id}"`;
    const categories = list(data.categories, `${where} categories`, line).map((c, i) => category(c, `${where} category ${i + 1}`, line));
    if (categories.length < 2) throw new SpecError(`${where} needs at least 2 \`categories\` (periods); got ${categories.length}.`, line);
    const twice = categories.find((c, i) => categories.indexOf(c) !== i);
    if (twice !== undefined) throw new SpecError(`${where}: period "${twice}" is listed twice.`, line);

    const rawSeries = list(data.series, `${where} series`, line);
    if (rawSeries.length < 2) throw new SpecError(`${where} needs at least 2 \`series\` to rank; got ${rawSeries.length}.`, line);
    const taken = new Set([id, `${id}-title`, `${id}-desc`]);
    const series: BumpSeries[] = rawSeries.map((s, i) => {
      const sw = `${where} series ${i + 1}`;
      if (!isObj(s)) throw new SpecError(`${sw} must be a map: { label, ranks }.`, line);
      allowKeys(s, ["id", "label", "ranks", "about", "focal", "muted"], sw, line);
      const label = requireString(s, "label", sw, line);
      const ranks = readRanks(s.ranks, categories, `${sw} ("${label}")`, line);
      if (ranks.every((r) => r === null)) throw new SpecError(`${sw} ("${label}") has no ranks.`, line);
      return {
        id: ownId(s, label, id, taken, sw, line),
        label,
        ranks,
        points: [] as string[],
        slot: seriesSlot(i, ctx.theme),
        focal: optBool(s, "focal", sw, line),
        muted: optBool(s, "muted", sw, line),
        about: optString(s, "about", sw, line),
      };
    });
    for (const s of series) s.points = s.ranks.map((r, i) => (r === null ? "" : idFrom(`${s.id}-${i}`, taken)));

    categories.forEach((c, i) => {
      const seen = new Map<number, string>();
      for (const s of series) {
        const r = s.ranks[i];
        if (r === null) continue;
        const other = seen.get(r);
        if (other !== undefined) {
          ctx.warn({ rule: "spec", severity: "warn", message: `${where}: "${other}" and "${s.label}" both rank ${r} in ${c}; give each series its own rank per period.`, line });
        }
        seen.set(r, s.label);
      }
    });
    if (series.length > MAX_SERIES || categories.length > MAX_PERIODS) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${series.length} series × ${categories.length} periods; keep it to ${MAX_SERIES} × ${MAX_PERIODS}. Rank only the top ${MAX_SERIES}, or split the periods into two charts.`, line });
    }
    const focal = series.filter((s) => s.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} series focal; keep it to ${BUDGET.focal}.`, line });
    }
    const bare = series.filter((s) => !s.about).length;
    if (bare) ctx.warn({ rule: "about-missing", severity: "warn", message: `${where}: ${bare} series have no \`about\`; the detail panel will be empty for them.`, line });

    const reading = readingSpec(data, line);
    checkRefs(reading, new Set(series.flatMap((s) => [s.id, ...s.points.filter(Boolean)])), where, line);
    return { type: "bump", id, title: optString(data, "title", where, line), line, categories, labels: dateLabels(categories) ?? categories, series, ...reading };
  },

  render(b, ctx) {
    const th = ctx.theme;
    const pad = th.grid.pad, tag = th.type.tag, px = th.type.nodeSub;
    const n = b.categories.length;
    const maxRank = Math.max(...b.series.flatMap((s) => s.ranks.filter((r): r is number => r !== null)));
    const labelW = Math.max(...b.series.map((s) => wide(s.label, px, "sans")));
    const x0 = pad + labelW + 8 + DOT_R;
    const x1 = WIDTH - pad - labelW - 8 - DOT_R;
    if (x1 - x0 < 48 * (n - 1)) {
      ctx.warn({ rule: "label-fit", severity: "warn", message: `bump "${b.id}": series labels leave too little room between periods; shorten the longest labels.`, line: b.line });
    }
    const xs = b.categories.map((_, i) => x0 + (i / (n - 1)) * (x1 - x0));
    const headY = pad / 2 + tag;
    const top = headY + 12;
    const yOf = (r: number) => top + (r - 0.5) * ROW;
    const height = top + maxRank * ROW + pad / 2;
    const gap = Math.max(14, px + 3);

    const firsts = b.series.map((s) => s.ranks.findIndex((r) => r !== null));
    const lasts = b.series.map((s) => lastIndex(s.ranks));
    const leftY = placeEnds(firsts, b.series.map((s, si) => yOf(s.ranks[firsts[si]]!)), gap, top, height);
    const rightY = placeEnds(lasts, b.series.map((s, si) => yOf(s.ranks[lasts[si]]!)), gap, top, height);

    const heads = thin(xs, b.labels, tag).map((i) => text(xs[i], headY, b.labels[i], "x-tick-label", "middle")).join("");
    const order = b.series.map((_, i) => i).sort((a, c) => weight(b.series[a]) - weight(b.series[c]) || a - c);

    const lines = order.map((si) => {
      const s = b.series[si];
      const d = segments(s.ranks.map((r, i) => (r === null ? null : [xs[i], yOf(r)] as Pt))).map(curve).join("");
      const ends =
        text(xs[firsts[si]] - DOT_R - 8, leftY[si] + px * 0.35, s.label, "x-mark-label x-end-label", "end") +
        text(xs[lasts[si]] + DOT_R + 8, rightY[si] + px * 0.35, s.label, "x-mark-label x-end-label", "start");
      return mark(
        { id: s.id, label: s.label, value: `Rank ${s.ranks[firsts[si]]} → ${s.ranks[lasts[si]]}`, series: s.slot, focal: s.focal, cls: "x-bump", attrs: muted(s) },
        `<path class="x-line-hit" d="${d}"/><path class="x-series-line x-mark-shape" d="${d}"/>${ends}`,
      );
    }).join("");

    const dots = order.map((si) => {
      const s = b.series[si];
      return s.ranks.map((r, i) => {
        if (r === null) return "";
        const cx = xs[i], cy = yOf(r);
        return mark(
          { id: s.points[i], label: `${s.label}, ${b.labels[i]}`, value: rankValue(s.ranks, i), series: s.slot, focal: s.focal, cls: "x-bump-dot", attrs: muted(s) },
          `<circle class="x-point x-mark-shape" cx="${num(cx)}" cy="${num(cy)}" r="${DOT_R}"/>` +
          text(cx, cy + tag * 0.35, String(r), "x-mark-label x-on-fill x-bump-rank", "middle"),
        );
      }).join("");
    }).join("");

    // Note markers sit on a dot, or on a series' last dot; end labels are obstacles.
    const anchors: Record<string, Frame> = {};
    const obstacles: Frame[] = [];
    const pr = DOT_R + NOTE_PAD;
    const box = (i: number, r: number): Frame => ({ x: xs[i] - pr, y: yOf(r) - pr, w: 2 * pr, h: 2 * pr });
    b.series.forEach((s, si) => {
      s.ranks.forEach((r, i) => { if (r !== null) anchors[s.points[i]] = box(i, r); });
      anchors[s.id] = box(lasts[si], s.ranks[lasts[si]]!);
      const w = wide(s.label, px, "sans");
      obstacles.push({ x: xs[firsts[si]] - DOT_R - 8 - w, y: leftY[si] - px, w, h: px + 4 });
      obstacles.push({ x: xs[lasts[si]] + DOT_R + 8, y: rightY[si] - px, w, h: px + 4 });
    });
    const noteSvg = noteMarkers(b, anchors, { obstacles, bounds: { x: 0, y: 0, w: WIDTH, h: height } });

    return svgFigure({
      id: b.id,
      kind: "bump",
      title: b.title,
      label: `Rank of ${joinList(b.series.map((s) => s.label))}`,
      desc: `Rank of ${b.series.length} series over ${n} periods, ${b.labels[0]} to ${b.labels[n - 1]}; rank 1 is at the top.`,
      width: WIDTH,
      height,
      body: `<g class="x-axis x-axis-x">${heads}</g><g class="x-lines">${lines}</g><g class="x-points">${dots}</g>${noteSvg}`,
    });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const ranked = b.categories.map((_, i) => b.series.filter((s) => s.ranks[i] !== null).length);
    for (const s of b.series) {
      const shown = s.ranks.map((r, i) => (r === null ? -1 : i)).filter((i) => i >= 0);
      const first = shown[0], last = shown[shown.length - 1];
      const r0 = s.ranks[first]!, r1 = s.ranks[last]!;
      const best = shown.reduce((a, i) => (s.ranks[i]! < s.ranks[a]! ? i : a), first);
      const worst = shown.reduce((a, i) => (s.ranks[i]! > s.ranks[a]! ? i : a), first);
      const moved = r0 === r1 ? "unchanged" : r1 < r0 ? `up ${r0 - r1}` : `down ${r1 - r0}`;
      elements[s.id] = groupInfo({
        id: s.id, label: s.label, figure: b.id, members: s.points.filter(Boolean), kind: "series", about: s.about,
        value: `Rank ${r0} → ${r1}`,
        facts: factList([
          last !== first && { k: `${b.labels[first]} → ${b.labels[last]}`, v: `${ordinal(r0)} → ${ordinal(r1)} (${moved})`, tone: trend(r0 - r1) },
          { k: "Best", v: `${ordinal(s.ranks[best]!)} · ${b.labels[best]}`, ref: s.points[best] },
          worst !== best && { k: "Worst", v: `${ordinal(s.ranks[worst]!)} · ${b.labels[worst]}`, ref: s.points[worst] },
          shown.length < b.categories.length && { k: "Ranked", v: `${shown.length} of ${b.categories.length} periods` },
        ]),
        pos: `${r1} of ${ranked[last]}`,
        say: [s.label, `${ordinal(r1)} in ${b.labels[last]}`, last !== first && `${moved} since ${b.labels[first]}`].filter(Boolean).join(", "),
      });
      shown.forEach((i, k) => {
        const r = s.ranks[i]!;
        const prev = k > 0 ? shown[k - 1] : undefined;
        elements[s.points[i]] = itemInfo({
          id: s.points[i], label: `${s.label}, ${b.labels[i]}`, figure: b.id, kind: "rank", value: rankValue(s.ranks, i), about: s.about, related: [s.id],
          facts: factList([
            { k: `Rank in ${b.labels[i]}`, v: `${ordinal(r)} of ${ranked[i]}` },
            prev !== undefined && { k: `vs ${b.labels[prev]}`, v: step(s.ranks[prev]!, r), tone: trend(s.ranks[prev]! - r), ref: s.points[prev] },
            k > 1 && { k: `vs ${b.labels[first]}`, v: step(r0, r), tone: trend(r0 - r), ref: s.points[first] },
            { k: "Series", v: s.label, ref: s.id },
          ]),
          pos: `${r} of ${ranked[i]}`,
          context: s.points.filter((p) => p && p !== s.points[i]),
          say: `${s.label}, ${b.labels[i]}, ${rankValue(s.ranks, i).toLowerCase()}`,
        });
      });
    }
    return { elements };
  },

  reading(b) {
    const head = `Rank 1 is at the top and each dot carries its rank for that period; lines that cross swapped places.`;
    const focal = b.series.filter((s) => s.focal).map((s) => s.label);
    const rest = [
      focal.length ? `the accent line is ${joinList(focal)}` : "",
      b.series.some((s) => s.muted) ? "gray is context" : "",
      b.series.some((s) => s.ranks.includes(null)) ? "a break means unranked that period" : "",
    ].filter(Boolean);
    return rest.length ? `${head} ${cap(rest.join("; "))}.` : head;
  },

  table(b): DataTable {
    return {
      head: ["Series", ...b.categories],
      rows: b.series.map((s) => [s.label, ...s.ranks.map((r) => (r === null ? "" : String(r)))]),
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

/** Rank movement between two periods: "up 2", "down 1", "unchanged". */
function step(from: number, to: number): string {
  return from === to ? "unchanged" : to < from ? `up ${from - to}` : `down ${to - from}`;
}

/** notes and story may only point at this chart's series and dots. */
function checkRefs(r: ReadingSpec, ids: Set<string>, where: string, line: number): void {
  const miss = (id: string, what: string) => {
    if (!ids.has(id)) throw new SpecError(`${where} ${what} points at "${id}", which is not a series or dot of this chart (e.g. "${[...ids][0]}").`, line, "ref-exists");
  };
  (r.notes ?? []).forEach((nt, i) => nt.on.forEach((id) => miss(id, `notes item ${i + 1}`)));
  (r.story ?? []).forEach((st, i) => {
    miss(st.sel, `story step ${i + 1}`);
    if (st.cmp) miss(st.cmp, `story step ${i + 1} cmp`);
  });
}

/** "Rank 3, up 2" compared with the previous ranked period. */
function rankValue(ranks: (number | null)[], i: number): string {
  const r = ranks[i]!;
  let prev: number | null = null;
  for (let k = i - 1; k >= 0 && prev === null; k--) prev = ranks[k];
  if (prev === null) return `Rank ${r}`;
  if (prev === r) return `Rank ${r}, unchanged`;
  return prev > r ? `Rank ${r}, up ${prev - r}` : `Rank ${r}, down ${r - prev}`;
}

function lastIndex(values: (number | null)[]): number {
  let last = -1;
  values.forEach((v, i) => { if (v !== null) last = i; });
  return last;
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

/** Smooth S-curves between periods: horizontal handles at the midpoint. */
function curve(seg: Pt[]): string {
  return seg.map((p, i) => {
    if (!i) return `M${num(p[0])},${num(p[1])}`;
    const q = seg[i - 1], mx = (q[0] + p[0]) / 2;
    return `C${num(mx)},${num(q[1])} ${num(mx)},${num(p[1])} ${num(p[0])},${num(p[1])}`;
  }).join("");
}

/** Spread end labels only among series whose label sits at the same period. */
function placeEnds(at: number[], want: number[], gap: number, lo: number, hi: number): number[] {
  const out = [...want];
  for (const k of new Set(at)) {
    const members = at.map((v, i) => (v === k ? i : -1)).filter((i) => i >= 0);
    const ys = spread(members.map((i) => want[i]), gap, lo, hi);
    members.forEach((i, j) => { out[i] = ys[j]; });
  }
  return out;
}

function thin(xs: number[], labels: string[], px: number): number[] {
  const keep: number[] = [];
  let edge = Infinity;
  for (let i = xs.length - 1; i >= 0; i--) {
    const half = wide(labels[i], px, "mono") / 2;
    if (xs[i] + half + 12 <= edge) { keep.push(i); edge = xs[i] - half; }
  }
  return keep.reverse();
}

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

function ownId(item: Fields, label: string, prefix: string, taken: Set<string>, where: string, line: number): string {
  const own = optString(item, "id", where, line);
  if (own === undefined) return idFrom(label, taken, `${prefix}-`);
  if (taken.has(own)) throw new SpecError(`${where}: id "${own}" is used twice.`, line, "id-unique");
  taken.add(own);
  return own;
}

function category(v: unknown, what: string, line: number): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  throw new SpecError(`${what} must be text, a number or an ISO date; got ${JSON.stringify(v)}.`, line);
}

/** Short labels when every period is an ISO date; undefined otherwise. */
function dateLabels(cats: string[]): string[] | undefined {
  const parts = cats.map((c) => ISO_DATE.exec(c));
  if (!parts.every(Boolean)) return undefined;
  const years = new Set(parts.map((m) => m![1])).size > 1;
  return parts.map((m) => {
    const mon = MONTHS[Number(m![2]) - 1] ?? m![2];
    const head = m![3] ? `${mon} ${Number(m![3])}` : mon;
    return years ? `${head}${m![3] ? "," : ""} ${m![1]}` : head;
  });
}

function readRanks(v: unknown, cats: string[], where: string, line: number): (number | null)[] {
  const one = (x: unknown, what: string): number | null => {
    if (x === null || x === undefined || x === "") return null;
    const r = number(x, what, line);
    if (!Number.isInteger(r) || r < 1) throw new SpecError(`${what} must be a whole number from 1 (top); got ${JSON.stringify(x)}.`, line);
    return r;
  };
  if (Array.isArray(v)) {
    if (v.length !== cats.length) {
      throw new SpecError(`${where} has ${v.length} ranks but there are ${cats.length} periods; give one rank per period (~ when unranked).`, line);
    }
    return v.map((x, i) => one(x, `${where} rank ${i + 1}`));
  }
  if (isObj(v)) {
    const out: (number | null)[] = cats.map(() => null);
    for (const [k, x] of Object.entries(v)) {
      const i = cats.indexOf(k);
      if (i < 0) throw new SpecError(`${where}: "${k}" is not one of the periods (${cats.join(", ")}).`, line, "ref-exists");
      out[i] = one(x, `${where} "${k}"`);
    }
    return out;
  }
  throw new SpecError(`${where} needs \`ranks\`: a list aligned with categories, or a map period → rank.`, line);
}
