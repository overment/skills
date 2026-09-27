// Events: a second-precision trace. Dots on a time axis, spans on a track above it, clusters of repeated
// events as stacked duration bars below it (each bar its own mark), long empty gaps collapsed into '//'
// breaks. Labels go through a placer that keeps them inside the figure, never ellipsises, and falls back
// to a numbered marker. In the expanded view each `note` becomes a numbered box on a band above or below
// the trace, tied to a kit.notes() marker at its moment; a click opens the card at the moment itself.
import {
  esc, itemInfo, list, notes as noteMarkers, num, onHover, ordinal, readingSpec, text, textWidth, wrap,
  type Frame,
} from "../kit.ts";
import { allowKeys, entries, optBool, optString, requireMap, requireString } from "../blocks/util.ts";
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type Fact, type NoteSpec, type RawBlock, type ReadingSpec, type RenderContext, type Tone } from "../types.ts";
import { checkRelations, panel, parseTone, plain, registerCollect, relIds, reportIndex, RELS, tierFields, type Contribution, type Decl } from "./common.ts";
import { fmtDuration, fmtOffset, parseDuration, parseTime, resolveTimes, type TimeSpec } from "./units.ts";

export const WIDTH = 1024;
const EDGE = 12;                  // nothing is drawn closer than this to the left or right edge
const X0 = EDGE + 20, X1 = WIDTH - EDGE - 20;
const R = 5;                      // event dot
const SPAN_H = 8, BAR_H = 10, BAR_GAP = 6;
const BREAK_W = 36;
const MAX_LINES = 2;              // per text part (label, sub)
const WRAP_CH = 32;
const NOTE_W = 236, NOTE_LINES = 5; // expanded-view boxes
const MAX_EVENTS = 14, MAX_CLUSTERS = 3, MAX_CLUSTER_ITEMS = 6, MAX_ANNOTATED = 6;
const LINK_KEYS = ["fix", "metric", "check"] as const;
const BLOCK_KEYS = ["id", "title", "tz", "start", "end", "compress", "annotate", "events", "spans", "clusters", "notes", "caveat", "story"];
const EVENT_KEYS = ["at", "label", "sub", "note", "tone", "focal", "about", "place", ...LINK_KEYS];
const SPAN_KEYS = ["from", "to", "label", "sub", "note", "tone", "focal", "about", "place", ...LINK_KEYS];
const CLUSTER_KEYS = ["label", "sub", "note", "tone", "focal", "about", "items", "place", ...LINK_KEYS];
const ITEM_KEYS = ["id", "at", "dur", "label", "note", "about", ...LINK_KEYS];

type Side = "above" | "below";
type Links = Record<(typeof LINK_KEYS)[number], string[]>;

interface Base { id: string; label: string; sub?: string; note?: string; tone?: Tone; focal: boolean; about?: string; place?: Side; links: Links }
export interface TraceEvent extends Base { kind: "event"; at: number }
export interface TraceSpan extends Base { kind: "span"; from: number; to: number }
export interface ClusterItem { id: string; label: string; at: number; dur: number; about?: string; note?: string; links: Links }
export interface TraceCluster extends Base { kind: "cluster"; items: ClusterItem[] }
type Item = TraceEvent | TraceSpan | TraceCluster;
/** Anything a reader can click on the trace, bars included. */
type Moment = Item | (ClusterItem & { kind: "item"; parent: TraceCluster });

export interface EventsBlock extends ReadingSpec {
  type: "events";
  id: string;
  title?: string;
  line: number;
  tz?: string;
  domain: [number, number];     // ms after t0
  clockAt: Record<string, string>; // element id → clock text at its start
  startClock?: string;          // clock at t = 0
  ends: [string, string];       // axis end labels
  compress: boolean;
  annotate: string[];           // ids whose `note` shows as a box in the expanded view, in order
  events: TraceEvent[];
  spans: TraceSpan[];
  clusters: TraceCluster[];
  t0Label: string;              // what t0 is, for "+12 s from Message sent"
  anchors: [string, string][];
  tiers: Record<string, ReturnType<typeof tierFields>>;
}

// ---------- time scale ----------

export interface Break { from: number; to: number; x0: number; x1: number }
export interface TimeScale { (t: number): number; breaks: Break[]; skipped: number }

/**
 * Piecewise-linear time → x. An empty stretch between occupied intervals collapses into a fixed-width
 * break when it is longer than `threshold` of the domain and at least 2.5× the median gap, so only a gap
 * that dominates the trace is cut, never the even spacing of a steady sequence. A little real time is
 * kept on each side of a break.
 */
export function timeScale(intervals: [number, number][], domain: [number, number], range: [number, number], compress = true, threshold = 0.15): TimeScale {
  const [d0, d1] = domain;
  const span = Math.max(1, d1 - d0);
  const iv = intervals
    .map(([a, b]) => [Math.max(d0, Math.min(a, b)), Math.min(d1, Math.max(a, b))] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of iv) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  const gaps: [number, number][] = [];
  if (compress) {
    const keep = span * 0.02;
    const all = merged.slice(1).map((m, i) => [merged[i][1], m[0]] as [number, number]);
    const sizes = all.map(([a, b]) => b - a).sort((p, q) => p - q);
    const median = sizes.length ? sizes[(sizes.length - 1) >> 1] : 0;
    for (const [g0, g1] of all) if (g1 - g0 > threshold * span && g1 - g0 >= 2.5 * median) gaps.push([g0 + keep, g1 - keep]);
  }
  const skipped = gaps.reduce((s, [a, b]) => s + (b - a), 0);
  const px = (range[1] - range[0] - gaps.length * BREAK_W) / Math.max(1, span - skipped);
  const x = ((t: number) => {
    let pos = range[0], cursor = d0;
    for (const [g0, g1] of gaps) {
      if (t <= g0) return pos + (t - cursor) * px;
      pos += (g0 - cursor) * px;
      if (t < g1) return pos + ((t - g0) / (g1 - g0)) * BREAK_W;
      pos += BREAK_W;
      cursor = g1;
    }
    return pos + (t - cursor) * px;
  }) as TimeScale;
  x.breaks = gaps.map(([from, to]) => ({ from, to, x0: 0, x1: 0 }));
  for (const b of x.breaks) { b.x0 = x(b.from); b.x1 = b.x0 + BREAK_W; }
  x.skipped = skipped;
  return x;
}

const STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000];

/** Relative tick times (multiples of a round step from t0) for the kept part of the domain. */
export function relTicks(domain: [number, number], kept: number, count = 7): number[] {
  const step = STEPS.find((s) => kept / s <= count) ?? STEPS[STEPS.length - 1];
  const out: number[] = [];
  for (let t = Math.ceil(domain[0] / step) * step; t <= domain[1]; t += step) out.push(t);
  return out;
}

// ---------- label placement ----------

export interface Box { x: number; y: number; w: number; h: number }
export interface Seg { a: [number, number]; b: [number, number] }
export interface LabelReq { id: string; x: number; w: number; h: number; prefer: Side; y0: { above: number; below: number }; only?: boolean }
export interface Placement { id: string; box: Box; leader?: Seg; side: Side }

const hit = (a: Box, b: Box, m = 0) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;

/** Does the segment cross the box (Liang–Barsky)? */
export function segHitsBox(s: Seg, r: Box, m = 0): boolean {
  const [x0, y0] = s.a, [x1, y1] = s.b;
  const dx = x1 - x0, dy = y1 - y0;
  let t0 = 0, t1 = 1;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, x0 - (r.x - m)) && clip(dx, r.x + r.w + m - x0) && clip(-dy, y0 - (r.y - m)) && clip(dy, r.y + r.h + m - y0) && t0 < t1;
}

/** Start at the dot, centred, ending at the dot, then shifted away in 20px steps (reached by a diagonal leader). */
function candidatesX(r: LabelReq): [number, number][] {
  const start = r.x - 6, end = r.x - r.w + 6;
  const out: [number, number][] = [[start, 0], [r.x - r.w / 2, 3], [end, 5]];
  for (let k = 1; k <= 8; k++) out.push([start + k * 20, 6 + k * 2], [end - k * 20, 8 + k * 2]);
  return out;
}

/**
 * Places each label box beside its anchor x, above or below the axis (y = 0). Candidates step outward
 * from the axis in 6px tiers with several alignments (see candidatesX); a box is clamped to [EDGE, width − EDGE], so an edge label re-anchors inward instead of being cut.
 * A box never overlaps an obstacle, another box or a leader; its leader never crosses a box.
 * Requests that find no spot are returned in `failed`.
 */
export function placeLabels(reqs: LabelReq[], obstacles: Box[], width = WIDTH): { placed: Placement[]; failed: string[] } {
  const placed: Placement[] = [];
  const failed: string[] = [];
  const boxes: Box[] = [...obstacles];
  const leaders: Seg[] = [];
  const TIER = 6, TIERS = 28;
  for (const r of reqs) {
    let best: { p: Placement; cost: number } | undefined;
    for (const side of (r.only ? [r.prefer] : [r.prefer, r.prefer === "above" ? "below" : "above"]) as Side[]) {
      for (let t = 0; t <= TIERS; t++) {
        const dy = t * TIER;
        const y = side === "above" ? r.y0.above - dy - r.h : r.y0.below + dy;
        for (const [x1, bias] of candidatesX(r)) {
          const x = Math.max(EDGE, Math.min(width - EDGE - r.w, x1));
          const box = { x, y, w: r.w, h: r.h };
          const inside = r.x >= x + 2 && r.x <= x + r.w - 2;
          const near = t === 0 && inside;
          const leader: Seg | undefined = near ? undefined : {
            a: [r.x, side === "above" ? r.y0.above + 3 : r.y0.below - 5],
            b: [Math.max(x + 4, Math.min(x + r.w - 4, r.x)), side === "above" ? y + r.h + 1 : y - 1],
          };
          // how far the anchor sits outside the text, not from its centre: text that starts at its dot reads best
          const off = Math.max(0, x + 6 - r.x, r.x - (x + r.w - 6));
          const cost = dy + off * 0.5 + bias + (side === r.prefer ? 0 : 24) + (leader ? 8 : 0);
          if (best && cost >= best.cost) continue;
          if (boxes.some((b) => hit(box, b, 3))) continue;
          if (leaders.some((l) => segHitsBox(l, box, 2))) continue;
          if (leader && boxes.slice(obstacles.length).some((b) => segHitsBox(leader, b, 2))) continue;
          best = { p: { id: r.id, box, leader, side }, cost };
        }
      }
    }
    if (!best) { failed.push(r.id); continue; }
    placed.push(best.p);
    boxes.push(best.p.box);
    if (best.p.leader) leaders.push(best.p.leader);
  }
  return { placed, failed };
}

// ---------- parsing ----------

function side(v: unknown, what: string, line: number): Side | undefined {
  if (v == null) return undefined;
  if (v === "above" || v === "below") return v;
  throw new SpecError(`${what}: \`place\` must be above or below.`, line);
}

function links(f: Record<string, unknown>, what: string, line: number): Links {
  return { fix: relIds(f.fix, `${what} fix`, line), metric: relIds(f.metric, `${what} metric`, line), check: relIds(f.check, `${what} check`, line) };
}

function base(id: string, f: Record<string, unknown>, what: string, line: number): Base {
  return {
    id, label: requireString(f, "label", what, line), sub: optString(f, "sub", what, line), note: optString(f, "note", what, line),
    tone: parseTone(f.tone, what, line), focal: optBool(f, "focal", what, line), about: optString(f, "about", what, line),
    place: side(f.place, what, line), links: links(f, what, line),
  };
}

export function parseEvents(raw: RawBlock, ctx: RenderContext): EventsBlock {
  const line = raw.line;
  const data = requireMap(raw.data, "events", line);
  allowKeys(data, BLOCK_KEYS, "events", line);
  const id = requireString(data, "id", "events", line);
  const where = `events "${id}"`;
  const specs = new Map<string, TimeSpec>();
  const anchors: [string, string][] = [];
  const note = (el: string, s: TimeSpec) => { if (s.kind === "ref") anchors.push([el, s.id]); return s; };

  const evRaw = entries(data.events, `${where} events`, line);
  if (!evRaw.length) throw new SpecError(`${where} needs at least one event.`, line);
  const drafts = evRaw.map(([eid, f]) => {
    const w = `${where} event "${eid}"`;
    allowKeys(f, EVENT_KEYS, w, line);
    if (f.at == null) throw new SpecError(`${w} needs \`at\` (10:08:57.2, +13.2s or another-event+2s).`, line);
    specs.set(eid, note(eid, parseTime(f.at, `${w} at`, line)));
    return base(eid, f, w, line);
  });
  const spanRaw = entries(data.spans, `${where} spans`, line).map(([sid, f]) => {
    const w = `${where} span "${sid}"`;
    allowKeys(f, SPAN_KEYS, w, line);
    if (f.from == null || f.to == null) throw new SpecError(`${w} needs \`from\` and \`to\`.`, line);
    specs.set(`${sid}\u0000from`, note(sid, parseTime(f.from, `${w} from`, line)));
    specs.set(`${sid}\u0000to`, note(sid, parseTime(f.to, `${w} to`, line)));
    return base(sid, f, w, line);
  });
  const clusterRaw = entries(data.clusters, `${where} clusters`, line).map(([cid, f]) => {
    const w = `${where} cluster "${cid}"`;
    allowKeys(f, CLUSTER_KEYS, w, line);
    const b = base(cid, f, w, line);
    const raws = list(f.items, `${w} items`, line);
    const items = raws.map((it, i) => {
      const iw = `${w} item ${i + 1}`;
      const fi = requireMap(it, iw, line);
      allowKeys(fi, ITEM_KEYS, iw, line);
      if (fi.at == null || fi.dur == null) throw new SpecError(`${iw} needs \`at\` and \`dur\`.`, line);
      const iid = optString(fi, "id", iw, line) ?? `${cid}-${i + 1}`;
      specs.set(iid, note(cid, parseTime(fi.at, `${iw} at`, line)));
      return {
        id: iid, label: optString(fi, "label", iw, line) ?? `${ordinal(i + 1)} of ${plain(b.label)}`,
        dur: parseDuration(fi.dur, `${iw} dur`, line), about: optString(fi, "about", iw, line), note: optString(fi, "note", iw, line), links: links(fi, iw, line),
      };
    });
    if (!items.length) throw new SpecError(`${w} needs at least one item.`, line);
    if (items.length > MAX_CLUSTER_ITEMS) ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${w} has ${items.length} items; keep it to ${MAX_CLUSTER_ITEMS} and give the rest as a count in \`sub\`.` });
    return { b, items };
  });
  const start = data.start == null ? undefined : parseTime(data.start, `${where} start`, line);
  if (data.end != null) specs.set("\u0000end", parseTime(data.end, `${where} end`, line));
  const { times, clock } = resolveTimes(specs, start, where, line);

  const ids = new Set<string>();
  for (const x of [...drafts, ...spanRaw, ...clusterRaw.flatMap((c) => [c.b, ...c.items])]) {
    if (ids.has(x.id)) throw new SpecError(`${where}: id "${x.id}" is used twice.`, line, "id-unique");
    ids.add(x.id);
  }
  const events: TraceEvent[] = drafts.map((d): TraceEvent => ({ ...d, kind: "event", at: times.get(d.id)! })).sort((a, b) => a.at - b.at);
  const spans: TraceSpan[] = spanRaw.map((s): TraceSpan => {
    const from = times.get(`${s.id}\u0000from`)!, to = times.get(`${s.id}\u0000to`)!;
    if (to <= from) throw new SpecError(`${where} span "${s.id}" ends before it starts.`, line);
    return { ...s, kind: "span", from, to };
  });
  const clusters: TraceCluster[] = clusterRaw.map(({ b, items }): TraceCluster => ({
    ...b, kind: "cluster",
    items: items.map((it) => ({ ...it, at: times.get(it.id)! })).sort((p, q) => p.at - q.at),
  }));
  if (events.length + spans.length + clusters.length > MAX_EVENTS) ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} has ${events.length + spans.length + clusters.length} events, spans and clusters; keep it to ${MAX_EVENTS}. Merge repeats into a cluster or move minor moments into \`about\`.` });
  if (clusters.length > MAX_CLUSTERS) ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} has ${clusters.length} clusters; keep it to ${MAX_CLUSTERS}.` });
  const focal = [...events, ...spans, ...clusters].filter((e) => e.focal).length;
  if (focal > BUDGET.focal) ctx.warn({ rule: "budget-focal", severity: "warn", line, message: `${where} marks ${focal} parts focal; keep it to ${BUDGET.focal}.` });

  const all = [
    ...events.map((e) => e.at), ...spans.flatMap((s) => [s.from, s.to]),
    ...clusters.flatMap((c) => c.items.flatMap((i) => [i.at, i.at + i.dur])),
  ];
  const end = times.get("\u0000end");
  const domain: [number, number] = [Math.min(0, ...all), Math.max(end ?? -Infinity, ...all)];
  if (end !== undefined && end < Math.max(...all)) throw new SpecError(`${where}: \`end\` comes before the last event; move it or drop it.`, line);
  const clockAt: Record<string, string> = {};
  for (const e of events) { const c = clock.at(e.at); if (c) clockAt[e.id] = c; }
  for (const s of spans) { const c = clock.at(s.from); if (c) clockAt[s.id] = c; }
  for (const c of clusters) {
    const k = clock.at(c.items[0].at);
    if (k) clockAt[c.id] = k;
    for (const it of c.items) { const t = clock.at(it.at); if (t) clockAt[it.id] = t; }
  }
  const endText = (t: number) => clock.at(t) ?? fmtOffset(t);
  const tz = optString(data, "tz", where, line);
  const compressRaw = data.compress ?? "auto";
  if (compressRaw !== "auto" && compressRaw !== "off" && compressRaw !== true && compressRaw !== false) throw new SpecError(`${where}: \`compress\` must be auto or off.`, line);
  const first = events.find((e) => e.at === 0);

  // the expanded view's boxes: every `note` in time order (auto), none (off), or the ids listed
  const moments = momentsOf(events, spans, clusters);
  const noted = moments.filter((m) => m.note);
  let annotate: string[];
  if (data.annotate == null || data.annotate === "auto") annotate = noted.map((m) => m.id);
  else if (data.annotate === "off" || data.annotate === false) annotate = [];
  else {
    annotate = relIds(data.annotate, `${where} annotate`, line);
    for (const aid of annotate) {
      const m = moments.find((x) => x.id === aid);
      if (!m) throw new SpecError(`${where}: \`annotate\` names "${aid}", which is not an event, span, cluster or bar here.`, line, "ref-exists");
      if (!m.note && !m.about) throw new SpecError(`${where}: "${aid}" is in \`annotate\` but has no \`note\` or \`about\` to show.`, line);
    }
  }
  if (annotate.length > MAX_ANNOTATED) ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} shows ${annotate.length} notes on the trace; keep it to ${MAX_ANNOTATED}, the moments the cards explain. The rest open on click.` });

  return {
    type: "events", id, title: optString(data, "title", where, line), line, tz,
    domain, clockAt, startClock: clock.at(0),
    ends: [endText(domain[0]), endText(domain[1])],
    compress: compressRaw === "auto" || compressRaw === true,
    annotate, events, spans, clusters,
    t0Label: first ? plain(first.label) : "start",
    anchors, tiers: {},
    ...readingSpec(data, line),
  };
}

/** Every clickable moment in time order: events, spans, clusters, and each cluster's bars after it. */
function momentsOf(events: TraceEvent[], spans: TraceSpan[], clusters: TraceCluster[]): Moment[] {
  const top: Item[] = [...events, ...spans, ...clusters].sort((p, q) => startOf(p) - startOf(q));
  return top.flatMap((e): Moment[] => e.kind === "cluster" ? [e, ...e.items.map((it) => ({ ...it, kind: "item" as const, parent: e }))] : [e]);
}

function decls(b: EventsBlock): Decl[] {
  const own = (id: string, l: Links): Decl[] => LINK_KEYS.map((k) => ({ from: id, rel: RELS[k], ids: l[k] })).filter((d) => d.ids.length);
  return momentsOf(b.events, b.spans, b.clusters).flatMap((m) => own(m.id, m.links));
}

function contribution(b: EventsBlock): Contribution {
  return {
    elements: momentsOf(b.events, b.spans, b.clusters).map((m) => ({ id: m.id, kind: m.kind, label: plain(m.label), parent: m.kind === "item" ? m.parent.id : undefined })),
    decls: decls(b),
    anchors: b.anchors,
  };
}

registerCollect("events", (raw, ctx) => contribution(parseEvents(raw, ctx)));

// ---------- facts ----------

const startOf = (e: Moment) => (e.kind === "event" || e.kind === "item" ? e.at : e.kind === "span" ? e.from : e.items[0].at);
const durs = (c: TraceCluster) => c.items.map((i) => i.dur);

function clusterValue(c: TraceCluster): string {
  const d = durs(c).map((ms) => fmtDuration(ms));
  const unit = d.every((s) => s.endsWith(" s")) ? " s" : "";
  return unit ? `${d.map((s) => s.slice(0, -2)).join(" / ")} s` : d.join(" / ");
}

function valueOf(e: Moment, b: EventsBlock): string {
  if (e.kind === "span") return fmtDuration(e.to - e.from);
  if (e.kind === "cluster") return clusterValue(e);
  if (e.kind === "item") return fmtDuration(e.dur);
  return [b.clockAt[e.id], fmtOffset(e.at)].filter(Boolean).join(" · ");
}

/** The text of an expanded-view box: the short `note`, else `about`. */
const noteText = (m: Moment) => plain(m.note ?? m.about ?? "");

// ---------- module ----------

export const eventsModule: BlockModule<EventsBlock> = {
  type: "events",

  normalize(raw, ctx) {
    const b = parseEvents(raw, ctx);
    const index = reportIndex(ctx.doc, ctx, raw, contribution(b));
    const where = `events "${b.id}"`;
    for (const m of momentsOf(b.events, b.spans, b.clusters)) {
      b.tiers[m.id] = tierFields(index, m.id);
      if (m.kind === "item") continue;
      // a moment on the trace is only as useful as what it explains and what it points to
      if (!m.about) ctx.warn({ rule: "about-missing", severity: "warn", line: b.line, message: `${where} "${m.id}" has no \`about\`; say what happened at this moment, for the card that opens on click.` });
      if (!index.linked(m.id)) ctx.warn({ rule: "ref-exists", severity: "warn", line: b.line, message: `${where} "${m.id}" points at no card, row or step; add \`fix\`, \`metric\` or \`check\` so a click lights its counterparts.` });
    }
    for (const s of b.story ?? []) {
      for (const sid of [s.sel, s.cmp].filter(Boolean) as string[]) {
        if (!index.kinds.has(sid)) ctx.warn({ rule: "ref-exists", severity: "warn", line: b.line, message: `${where} story step "${sid}" is no report element; check the id.` });
      }
    }
    checkRelations(index, decls(b), where, b.line, ctx);
    return b;
  },

  render(b, ctx) {
    const theme = ctx.theme;
    // every word on the trace is sans with tabular figures (durations, times and ticks included), so it is measured as sans
    const px = theme.type.caption, lh = Math.round(px * 1.3), small = theme.type.nodeSub, tag = theme.type.tag;
    const maxW = WRAP_CH * 0.55 * px;
    const items: Item[] = [...b.spans, ...b.events, ...b.clusters];
    const moments = momentsOf(b.events, b.spans, b.clusters);
    const intervals: [number, number][] = [
      ...b.events.map((e) => [e.at, e.at] as [number, number]),
      ...b.spans.map((s) => [s.from, s.to] as [number, number]),
      ...b.clusters.flatMap((c) => c.items.map((i) => [i.at, i.at + i.dur] as [number, number])),
    ];
    const x = timeScale(intervals, b.domain, [X0, X1], b.compress);

    // --- fixed geometry around the axis (y = 0), then labels around it ---
    const obstacles: Box[] = [{ x: X0 - 8, y: -1.5, w: X1 - X0 + 16, h: 3 }];
    for (const e of b.events) obstacles.push({ x: x(e.at) - R - 1, y: -R - 1, w: 2 * R + 2, h: 2 * R + 2 });
    const spanBars = b.spans.map((s) => {
      const x0 = x(s.from), x1 = Math.max(x0 + 4, x(s.to));
      const box = { x: x0, y: -R - 4 - SPAN_H, w: x1 - x0, h: SPAN_H };
      obstacles.push(box);
      return { s, box };
    });
    let barTop = R + 8;
    const barBox = new Map<string, Box>();
    const clusterBars = b.clusters.map((c) => {
      const rows = c.items.map((it, i) => {
        const bx = x(it.at), bw = Math.max(3, x(it.at + it.dur) - bx);
        const y = barTop + i * (BAR_H + BAR_GAP);
        const words = fmtDuration(it.dur);
        const tw = textWidth(words, small, "sans");
        const right = bx + bw + 6 + tw <= WIDTH - EDGE;
        const tx = right ? bx + bw + 6 : Math.max(EDGE + tw, bx - 6);
        const box = { x: bx, y, w: bw, h: BAR_H };
        const tbox = { x: right ? tx : tx - tw, y: y - 1, w: tw, h: BAR_H + 2 };
        obstacles.push(box, tbox);
        barBox.set(it.id, box);
        return { it, box, words, tx, anchor: right ? "start" as const : "end" as const };
      });
      const top = barTop;
      barTop += c.items.length * (BAR_H + BAR_GAP) + 6;
      const whisker = { x: x(c.items[0].at) - 0.5, y: R, w: 1, h: top - R };
      obstacles.push(whisker);
      return { c, rows, x0: x(c.items[0].at) };
    });
    const belowStart = R + 6;

    // --- label text; anything over two lines per part becomes a numbered marker ---
    interface Text { lines: { s: string; cls: string }[]; w: number; h: number; fits: boolean }
    const texts = new Map<string, Text>();
    for (const e of items) {
      const head = e.kind === "span" ? `${fmtDuration(e.to - e.from)} · ${plain(e.label)}` : plain(e.label);
      // a span's label sits over its own bar, so it may use the bar's width
      const room = e.kind === "span" ? Math.max(maxW, x(e.to) - x(e.from) - 8) : maxW;
      const label = wrap(head, room, px), sub = e.sub ? wrap(plain(e.sub), room, px) : [];
      const lines = [...label.map((s) => ({ s, cls: "x-rep-label" })), ...sub.map((s) => ({ s, cls: "x-rep-sub" }))];
      const w = Math.ceil(Math.max(...lines.map((l) => textWidth(l.s, px, "sans") * (l.cls === "x-rep-label" ? 1.06 : 1.03)))) + 2;
      texts.set(e.id, { lines, w, h: lines.length * lh, fits: label.length <= MAX_LINES && sub.length <= MAX_LINES });
    }
    const anchorX = (e: Moment) => (e.kind === "event" || e.kind === "item" ? x(e.at) : e.kind === "span" ? x(e.from) + 6 : x(e.items[0].at));
    const reqs: LabelReq[] = items
      .filter((e) => texts.get(e.id)!.fits)
      .sort((a, b2) => Number(b2.focal) - Number(a.focal) || (b2.kind === "cluster" ? 1 : 0) - (a.kind === "cluster" ? 1 : 0) || startOf(a) - startOf(b2))
      .map((e) => {
        const t = texts.get(e.id)!;
        const prefer: Side = e.place ?? (e.kind === "event" ? "below" : "above");
        const top = e.kind === "span" ? -R - 8 - SPAN_H : -R - 4;
        return { id: e.id, x: anchorX(e), w: t.w, h: t.h, prefer, y0: { above: top, below: belowStart } };
      });
    const { placed } = placeLabels(reqs, obstacles);
    const at = new Map(placed.map((p) => [p.id, p]));
    const fallback: NoteSpec[] = [];
    for (const e of items) {
      if (at.has(e.id)) continue;
      const t = texts.get(e.id)!;
      fallback.push({ on: [e.id], text: [plain(e.label), e.sub ? plain(e.sub) : ""].filter(Boolean).join(" · ") });
      ctx.warn({ rule: "label-fit", severity: "warn", line: b.line, message: `events "${b.id}" "${e.id}": ${t.fits ? "no room for its label near its time" : `its text needs more than ${MAX_LINES} lines of ${WRAP_CH} characters`}; it shows as a numbered marker with the text in the notes. Shorten \`label\`/\`sub\` or move detail into \`about\`.` });
    }

    // --- bounds, then emit with a vertical offset ---
    const allBoxes = [...obstacles, ...placed.map((p) => p.box)];
    const minY = Math.min(...allBoxes.map((r) => r.y), -R - 20) - 6;
    const maxY = Math.max(...allBoxes.map((r) => r.y + r.h), R + 4);
    const oy = 8 - minY;
    const Y = (y: number) => y + oy;
    const axisY = Y(0);
    const rulerY = Y(maxY) + 16;
    const height = Math.ceil(rulerY + 24);

    const label = (e: Item) => {
      const p = at.get(e.id);
      if (!p) return "";
      const t = texts.get(e.id)!;
      const lead = p.leader ? `<line class="x-rep-leader" x1="${num(p.leader.a[0])}" y1="${num(Y(p.leader.a[1]))}" x2="${num(p.leader.b[0])}" y2="${num(Y(p.leader.b[1]))}"/>` : "";
      // text starts at the box edge; with a start alignment the first glyph sits over the dot
      const lines = t.lines.map((l, i) => text(p.box.x, Y(p.box.y) + (i + 1) * lh - (lh - px) / 2 - 1, l.s, l.cls)).join("");
      return lead + lines;
    };
    const readout = (e: Moment) => {
      const t = startOf(e), cx = anchorX(e);
      const words = [b.clockAt[e.id], fmtOffset(t)].filter(Boolean).join(" · ");
      const w = textWidth(words, small, "sans") + 8;
      const tx = Math.max(EDGE, Math.min(WIDTH - EDGE - w, cx - w / 2));
      return onHover(`<line class="x-rep-readout-rule" x1="${num(cx)}" y1="${num(axisY + R + 2)}" x2="${num(cx)}" y2="${num(rulerY - 2)}"/>` +
        `<rect class="x-rep-readout-bg" x="${num(tx)}" y="${num(rulerY + 4)}" width="${num(w)}" height="${num(small + 6)}" rx="3"/>` +
        text(tx + 4, rulerY + 4 + small + 1, words, "x-rep-readout"));
    };
    const toneOf = (e: Moment) => (e.kind === "item" ? e.parent.tone : e.tone);
    const attrs = (e: Moment) => { const t = toneOf(e); return t && t !== "neutral" ? ` data-tone="${t}"` : ""; };
    const aria = (e: Moment) => [plain(e.label), e.kind === "item" ? "" : e.sub ? plain(e.sub) : "", b.clockAt[e.id] ?? fmtOffset(startOf(e)), e.kind === "event" ? "" : valueOf(e, b)].filter(Boolean).join(", ");
    const markOf = (e: Moment, shape: string) => {
      const focal = e.kind !== "item" && e.focal ? ` data-focal="true"` : "";
      return `<g class="x-mark x-rep-${e.kind}" data-id="${esc(e.id)}"${attrs(e)}${focal} tabindex="0" role="button" aria-label="${esc(aria(e))}">${shape}</g>`;
    };

    const parts: string[] = [];
    // axis, broken at each '//'
    let from = X0 - 8;
    for (const br of x.breaks) {
      parts.push(`<line class="x-axis-line" x1="${num(from)}" y1="${num(axisY)}" x2="${num(br.x0 + 6)}" y2="${num(axisY)}"/>`);
      from = br.x1 - 6;
      parts.push(`<g class="x-rep-break" aria-hidden="true"><path class="x-rep-break-mark" d="M${num(br.x0 + 10)},${num(axisY + 6)} L${num(br.x0 + 16)},${num(axisY - 6)} M${num(br.x1 - 16)},${num(axisY + 6)} L${num(br.x1 - 10)},${num(axisY - 6)}"/></g>`);
    }
    parts.push(`<line class="x-axis-line" x1="${num(from)}" y1="${num(axisY)}" x2="${num(X1 + 8)}" y2="${num(axisY)}"/>`);

    for (const { s, box } of spanBars) {
      const bar = `<rect class="x-mark-shape x-rep-span-bar" x="${num(box.x)}" y="${num(Y(box.y))}" width="${num(box.w)}" height="${SPAN_H}" rx="2"/>`;
      parts.push(markOf(s, bar + label(s) + readout(s)));
    }
    for (const { c, rows, x0 } of clusterBars) {
      const last = rows[rows.length - 1].box;
      const whisker = `<line class="x-rep-whisker" x1="${num(x0)}" y1="${num(axisY)}" x2="${num(x0)}" y2="${num(Y(last.y + last.h))}"/>`;
      const tick = `<circle class="x-rep-cluster-dot" cx="${num(x0)}" cy="${num(axisY)}" r="3"/>`;
      // an unpainted box around the bars comes first, so the ring and the card take the whole cluster;
      // each bar is drawn after it as a mark of its own, so a click on a bar selects that press
      const right = Math.max(...rows.map((r) => r.box.x + r.box.w));
      const box = `<rect class="x-mark-shape x-rep-cluster-box" x="${num(x0 - 3)}" y="${num(Y(rows[0].box.y) - 3)}" width="${num(right - x0 + 6)}" height="${num(last.y + last.h - rows[0].box.y + 6)}" rx="3"/>`;
      parts.push(markOf(c, box + whisker + tick + label(c) + readout(c)));
      for (const r of rows) {
        const m: Moment = { ...r.it, kind: "item", parent: c };
        parts.push(markOf(m,
          `<rect class="x-mark-shape x-rep-bar" x="${num(r.box.x)}" y="${num(Y(r.box.y))}" width="${num(r.box.w)}" height="${BAR_H}" rx="2"/>` +
          text(r.tx, Y(r.box.y) + BAR_H / 2 + small * 0.36, r.words, "x-rep-dur", r.anchor) + readout(m)));
      }
    }
    for (const e of b.events) {
      const cx = x(e.at);
      parts.push(markOf(e, label(e) + `<circle class="x-mark-shape x-rep-dot" cx="${num(cx)}" cy="${num(axisY)}" r="${R}"/>` + readout(e)));
    }

    // ruler: absolute ends, relative ticks, the skipped time at each break
    const ruler: string[] = [];
    let rfrom = X0 - 8;
    for (const br of x.breaks) {
      ruler.push(`<line class="x-rep-ruler" x1="${num(rfrom)}" y1="${num(rulerY)}" x2="${num(br.x0 + 6)}" y2="${num(rulerY)}"/>`);
      rfrom = br.x1 - 6;
    }
    ruler.push(`<line class="x-rep-ruler" x1="${num(rfrom)}" y1="${num(rulerY)}" x2="${num(X1 + 8)}" y2="${num(rulerY)}"/>`);
    const taken: [number, number][] = [];
    const put = (tx: number, s: string, anchor: "start" | "middle" | "end", cls = "x-tick-label") => {
      // tick labels set at the tag size, the skipped time at the trace's small size (report.css)
      const w = textWidth(s, cls === "x-tick-label" ? tag : small, "sans");
      const left = anchor === "start" ? tx : anchor === "end" ? tx - w : tx - w / 2;
      if (left < EDGE || left + w > WIDTH - EDGE || taken.some(([a, z]) => left < z + 10 && a < left + w + 10)) return false;
      taken.push([left, left + w]);
      ruler.push(text(tx, rulerY + 14, s, cls, anchor));
      return true;
    };
    const leftEnd = b.tz ? `${b.ends[0]} ${b.tz}` : b.ends[0];
    put(X0 - 8, leftEnd, "start");
    put(X1 + 8, b.ends[1], "end");
    for (const br of x.breaks) put((br.x0 + br.x1) / 2, `// ${fmtDuration(br.to - br.from)}`, "middle", "x-rep-break-label");
    for (const t of relTicks(b.domain, b.domain[1] - b.domain[0] - x.skipped)) {
      if (x.breaks.some((br) => t > br.from && t < br.to)) continue;
      const tx = x(t);
      if (put(tx, fmtOffset(t), "middle")) ruler.push(`<line class="x-rep-ruler-tick" x1="${num(tx)}" y1="${num(rulerY - 3)}" x2="${num(tx)}" y2="${num(rulerY + 3)}"/>`);
    }

    // --- numbered markers: the author's notes, then the expanded-view boxes, then labels with no room ---
    const anchors: Record<string, Frame> = {};
    for (const m of moments) {
      // a marker takes a corner of the moment's label: next to the dot every corner touches the axis
      const cx = anchorX(m), lab = at.get(m.id)?.box;
      const r = lab ?? (m.kind === "span" ? spanBars.find((s) => s.s.id === m.id)!.box : m.kind === "item" ? barBox.get(m.id)! : { x: cx - R, y: -R, w: 2 * R, h: 2 * R });
      anchors[m.id] = { ...r, y: Y(r.y) };
    }
    const own = b.notes ?? [];
    const boxes = b.annotate.map((id) => moments.find((m) => m.id === id)!).map((m) => ({ m, text: noteText(m) }));
    const markerObstacles = [...obstacles, ...placed.map((p) => p.box)].map((r) => ({ ...r, y: Y(r.y) }));
    const bounds = { x: EDGE, y: 0, w: WIDTH - 2 * EDGE, h: height };
    const pad = (n: number): NoteSpec[] => Array.from({ length: n }, () => ({ on: [], text: "" }));
    // full-view markers: the author's notes and the boxes; kit.notes numbers by position, so the boxes follow the notes
    const fullMarkers = noteMarkers({ id: b.id, notes: [...own, ...boxes.map((x) => ({ on: [x.m.id], text: x.text }))] }, anchors, { obstacles: markerObstacles, bounds });
    // markers that stand in for a label stay visible in bare view
    const fallbackMarkers = fallback.length
      ? noteMarkers({ id: b.id, notes: [...pad(own.length + boxes.length), ...fallback] }, anchors, { obstacles: markerObstacles, bounds }).replace('class="x-notes"', 'class="x-notes x-rep-fallback"')
      : "";
    const bands = annotationBands(b, boxes, own.length, anchorX, (id) => at.get(id)?.side ?? (moments.find((m) => m.id === id)?.kind === "item" ? "below" : "above"), px, ctx);

    const svg = `<svg class="x-svg x-rep-trace" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="group" aria-labelledby="${esc(b.id)}-desc">` +
      `<desc id="${esc(b.id)}-desc">${esc(eventsModule.reading!(b))}</desc>` +
      parts.join("") + `<g class="x-rep-ruler-row" aria-hidden="true">${ruler.join("")}</g>` + fullMarkers + fallbackMarkers + `</svg>`;
    const list = fallback.length
      ? `<ol class="x-rep-fallback-list" start="${own.length + boxes.length + 1}">${fallback.map((n) => `<li>${esc(n.text)}</li>`).join("")}</ol>`
      : "";
    return panel({ id: b.id, kind: "events", title: b.title, label: "Event trace", body: `<div class="x-rep-trace-wrap">${bands.top}${svg}${bands.bottom}${list}</div>`, ctx });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const top = momentsOf(b.events, b.spans, b.clusters).filter((m) => m.kind !== "item");
    const moments = momentsOf(b.events, b.spans, b.clusters);
    const noteNo = new Map(b.annotate.map((id, i) => [id, (b.notes?.length ?? 0) + i + 1]));
    for (const e of moments) {
      const t = startOf(e);
      const facts: Fact[] = [];
      const when = [b.clockAt[e.id], fmtOffset(t)].filter(Boolean).join(" · ");
      let pos: string, kind: string;
      if (e.kind === "item") {
        const i = e.parent.items.findIndex((x) => x.id === e.id);
        facts.push({ k: "Started", v: when });
        const prev = e.parent.items[i - 1];
        if (prev) facts.push({ k: "After the previous", v: fmtOffset(e.at - prev.at), ref: prev.id });
        pos = `${i + 1} of ${e.parent.items.length}`;
        kind = "repeat";
      } else {
        // the value already says when an event happened; facts add what the value can't
        const i = top.indexOf(e), prev = top[i - 1];
        if (e.kind === "span") facts.push({ k: "From", v: when }, { k: "To", v: fmtOffset(e.to) });
        if (e.kind === "cluster") {
          const d = durs(e), total = d.reduce((s, v) => s + v, 0);
          facts.push({ k: "First", v: when }, { k: "Total", v: fmtDuration(total) }, { k: "Mean", v: fmtDuration(total / d.length) });
        }
        if (prev) facts.push({ k: "Since previous", v: fmtOffset(t - startOf(prev)), ref: prev.id });
        pos = `${i + 1} of ${top.length}`;
        kind = e.kind === "cluster" ? "repeated" : e.kind;
      }
      const n = noteNo.get(e.id);
      if (n) facts.unshift({ k: "Note", v: String(n) });
      const tiers = b.tiers[e.id] ?? {};
      const value = valueOf(e, b);
      elements[e.id] = itemInfo({
        id: e.id, label: plain(e.label), figure: b.id, kind, value, about: e.about ?? e.note,
        related: tiers.related, context: tiers.context, links: tiers.links, facts, pos,
        say: `${plain(e.label)}, ${value}${e.kind === "event" ? ` from ${b.t0Label}` : ""}`,
      });
    }
    return { elements };
  },

  reading(b) {
    const intervals: [number, number][] = [
      ...b.events.map((e) => [e.at, e.at] as [number, number]),
      ...b.spans.map((s) => [s.from, s.to] as [number, number]),
      ...b.clusters.flatMap((c) => c.items.map((i) => [i.at, i.at + i.dur] as [number, number])),
    ];
    const x = timeScale(intervals, b.domain, [X0, X1], b.compress);
    const skip = x.breaks.length ? `; // skips ${fmtDuration(x.skipped)} with no events` : "";
    const bars = b.clusters.length ? " Bars under the axis are repeated events, each as long as it took, with its duration at its end." : "";
    const notes = b.annotate.length ? " Numbered boxes explain the marked moments; click any moment for the full story and the cards, rows and steps it connects to." : "";
    return `Spacing is proportional to time${skip}.${bars}${notes}`;
  },

  table(b): DataTable {
    return {
      head: ["Time", `From ${b.t0Label}`, "What", "Duration"],
      rows: momentsOf(b.events, b.spans, b.clusters).map((e) => [
        b.clockAt[e.id] ?? "", fmtOffset(startOf(e)),
        [plain(e.label), e.kind !== "item" && e.sub ? plain(e.sub) : ""].filter(Boolean).join(" · "),
        e.kind === "event" ? "" : e.kind === "item" ? fmtDuration(e.dur) : valueOf(e, b),
      ]),
    };
  },
};

/**
 * The expanded view's explanation boxes, on a band above and a band below the trace (separate svgs at the
 * same scale, so bare view drops them without leaving a gap). Each box sits on the side of its moment's
 * label, as close above or below the moment as the other boxes allow; its number marks the moment in the trace.
 */
function annotationBands(
  b: EventsBlock, boxes: { m: Moment; text: string }[], first: number,
  anchorX: (m: Moment) => number, sideOf: (id: string) => Side, px: number, ctx: RenderContext,
): { top: string; bottom: string } {
  const lh = Math.round(px * 1.35), inner = NOTE_W - 34;
  interface Req { m: Moment; n: number; lines: string[]; side: Side }
  const reqs: Req[] = [];
  boxes.forEach(({ m, text: t }, i) => {
    const lines = wrap(t, inner, px);
    if (lines.length > NOTE_LINES) {
      ctx.warn({ rule: "label-fit", severity: "warn", line: b.line, message: `events "${b.id}" "${m.id}": its note needs ${lines.length} lines on the trace (${NOTE_LINES} fit); write a shorter \`note\` and keep the detail in \`about\`. It still opens on click.` });
      return;
    }
    reqs.push({ m, n: first + i + 1, lines, side: sideOf(m.id) });
  });
  const band = (side: Side) => {
    const mine = reqs.filter((r) => r.side === side);
    if (!mine.length) return "";
    const lab = mine.map((r): LabelReq => ({ id: r.m.id, x: anchorX(r.m), w: NOTE_W, h: 16 + r.lines.length * lh, prefer: side, y0: { above: -10, below: 10 }, only: true }));
    const { placed } = placeLabels(lab, []);
    const ys = placed.flatMap((p) => [p.box.y, p.box.y + p.box.h]);
    const h = Math.ceil(side === "above" ? -Math.min(...ys) + 4 : Math.max(...ys) + 4);
    const Y = (y: number) => (side === "above" ? y + h : y);
    const out = placed.map((p) => {
      const r = mine.find((q) => q.m.id === p.id)!;
      const { x: bx, w } = p.box, by = Y(p.box.y);
      const body = r.lines.map((l, i) => text(bx + 30, by + 8 + (i + 1) * lh - (lh - px) / 2 - 1, l, "x-rep-annot-text")).join("");
      // a reference to its moment: a click selects the moment, and the open card keeps clear of it
      return `<g class="x-rep-annot-note x-ref" data-note="${r.n}" data-ref="${esc(r.m.id)}">` +
        `<rect class="x-rep-annot-box" x="${num(bx)}" y="${num(by)}" width="${w}" height="${num(p.box.h)}" rx="4"/>` +
        `<circle class="x-note-ring" cx="${num(bx + 15)}" cy="${num(by + 15)}" r="8"/>${text(bx + 15, by + 18.5, String(r.n), "x-note-num", "middle")}${body}</g>`;
    }).join("");
    return `<svg class="x-svg x-rep-annot" data-band="${side === "above" ? "top" : "bottom"}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${h}" width="${WIDTH}" height="${h}" role="group" aria-label="Notes on the trace">${out}</svg>`;
  };
  return { top: band("above"), bottom: band("below") };
}
