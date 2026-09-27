// Timeline: dated events on a horizontal axis, labels stacked above and below without collisions, optional lanes and periods.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type Fact, type NoteSpec, type StoryStep } from "../types.ts";
import {
  READING_KEYS, esc, fmt, groupInfo, idFrom, isObj, itemInfo, linear, list, mark, notes, num, parseBands, parseMarks, readingSpec, refBand, refLine,
  svgFigure, text, textWidth, wrap, type Frame,
} from "../kit.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString } from "../blocks/util.ts";

const WIDTH = 960;
const MAX_EVENTS = 12;
const LABEL_MAX = 200; // event labels wrap past this width
const LANE_MAX = 160;  // lane label column
const DOT = 5;
const FOCAL_DOT = 6.5;
const FOCAL_STEM = 12; // the focal event's leader is this much longer, so the turning point stands out
const GAP = 12;        // minimum space between two labels on one level
const LANE_GAP = 16;
const BRUSH_H = 20;    // the axis strip under the plot that takes a drag
const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BLOCK_KEYS = ["id", "title", "start", "end", "events", "periods", "marks", "bands", ...READING_KEYS];
const EVENT_KEYS = ["id", "date", "label", "lane", "about", "focal", "muted"];
const PERIOD_KEYS = ["id", "label", "start", "end", "about"];

type Precision = "year" | "month" | "day";

interface TimelineEvent {
  id: string;
  label: string;
  date: number;       // UTC day number
  prec: Precision;    // how the date was written; sets how it is labelled
  lane?: string;      // lane id
  about?: string;
  focal: boolean;
  muted: boolean;
}

interface TimelinePeriod {
  id: string;
  label: string;
  start: number;
  end: number;        // exclusive
  startPrec: Precision;
  endPrec: Precision;
  about?: string;
}

interface TimelineLane { id: string; label: string; members: string[] }

interface TimelineBlock {
  type: "timeline";
  id: string;
  title?: string;
  line: number;
  start: number;            // first day shown
  end: number;              // last day shown (exclusive)
  events: TimelineEvent[];  // sorted by date
  periods: TimelinePeriod[]; // sorted by start
  lanes: TimelineLane[];    // empty = one unnamed lane
  marks: { at: number; label?: string }[];
  bands: { from: number; to: number; label?: string }[];
  notes?: NoteSpec[];
  caveat?: string;
  story?: StoryStep[];
}

interface Label { lines: string[]; date: string; w: number }
interface Placed { x: number; left: number; right: number; anchor: "start" | "end"; side: -1 | 1; level: number }

// ---------- dates: UTC day numbers ----------

interface Day { day: number; prec: Precision }

function utcDay(y: number, m: number, d: number): number {
  const t = new Date(0);
  t.setUTCFullYear(y, m, d);
  return Math.round(t.getTime() / DAY_MS);
}

function ymd(day: number): { y: number; m: number; d: number } {
  const t = new Date(day * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

function parseDay(v: unknown, what: string, line: number): Day {
  if (v instanceof Date && Number.isFinite(v.getTime())) return { day: Math.floor(v.getTime() / DAY_MS), prec: "day" };
  const s = typeof v === "string" ? v.trim() : typeof v === "number" && Number.isInteger(v) ? String(v) : "";
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s);
  if (m) {
    const y = Number(m[1]), mo = m[2] ? Number(m[2]) - 1 : 0, d = m[3] ? Number(m[3]) : 1;
    const day = utcDay(y, mo, d);
    const back = ymd(day);
    if (back.y === y && back.m === mo && back.d === d) return { day, prec: m[3] ? "day" : m[2] ? "month" : "year" };
  }
  throw new SpecError(`${what} must be a date like 2024, 2024-03 or 2024-03-04, got ${JSON.stringify(v)}.`, line);
}

/** Exclusive end of a date read as "through": that day, the whole month or the whole year. */
function endOf(v: Day): number {
  const { y, m } = ymd(v.day);
  return v.prec === "day" ? v.day + 1 : v.prec === "month" ? utcDay(y, m + 1, 1) : utcDay(y + 1, 0, 1);
}

function dateText(day: number, prec: Precision, year: boolean): string {
  const { y, m, d } = ymd(day);
  if (prec === "year") return String(y);
  if (prec === "month") return year ? `${MONTHS[m]} ${y}` : MONTHS[m];
  return year ? `${MONTHS[m]} ${d}, ${y}` : `${MONTHS[m]} ${d}`;
}

const iso = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Time between two days in words: "12 days", "15 months", "3 years". Years only when either end is a bare year. */
function gapText(a: number, b: number, coarse = false): string {
  const d = Math.abs(b - a);
  const plural = (n: number, w: string) => `${fmt(n)} ${w}${n === 1 ? "" : "s"}`;
  if (coarse) return plural(Math.max(1, Math.round(d / 365.25)), "year");
  if (d < 45) return d === 0 ? "the same day" : plural(d, "day");
  const months = Math.round(d / 30.44);
  if (months < 24) return plural(months, "month");
  return plural(Math.round((d / 365.25) * 2) / 2, "year");
}

/** A `marks:`/`bands:` value on the calendar: a date, or a bare year the YAML read as a number. */
function markDay(v: number | string, what: string, line: number): Day {
  if (typeof v === "number" && !(Number.isInteger(v) && v >= 1000 && v <= 9999)) {
    throw new SpecError(`${what} runs along the calendar, so it takes a date like 2024-03, got ${v}.`, line);
  }
  if (v === "mean" || v === "median") throw new SpecError(`${what} runs along the calendar, so it takes a date, not ${v}.`, line);
  return parseDay(v, what, line);
}

interface Tick { day: number; label: string }

/** Calendar ticks for [start, end]: days, Mondays, months, quarters or years, whichever suits the span. */
function calendarTicks(start: number, end: number): Tick[] {
  const span = end - start, out: Tick[] = [];
  const s = ymd(start);
  const short = (day: number) => { const { m, d } = ymd(day); return `${MONTHS[m]} ${d}`; };
  if (span <= 31) {
    for (let d = start; d <= end; d++) out.push({ day: d, label: short(d) });
  } else if (span <= 140) {
    const monday = start + ((8 - new Date(start * DAY_MS).getUTCDay()) % 7);
    for (let d = monday; d <= end; d += 7) out.push({ day: d, label: short(d) });
  } else if (span <= 1100) {
    const step = span <= 400 ? 1 : 3;
    let k = s.y * 12 + s.m + (s.d === 1 ? 0 : 1);
    k = Math.ceil(k / step) * step;
    for (; ; k += step) {
      const y = Math.floor(k / 12), m = k % 12, d = utcDay(y, m, 1);
      if (d > end) break;
      out.push({ day: d, label: m === 0 || !out.length ? `${MONTHS[m]} ${y}` : MONTHS[m] });
    }
  } else {
    const step = [1, 2, 5, 10, 20, 50, 100].find((n) => span / 365.25 / n <= 12) ?? 100;
    let y = s.y + (s.m === 0 && s.d === 1 ? 0 : 1);
    y = Math.ceil(y / step) * step;
    for (; ; y += step) {
      const d = utcDay(y, 0, 1);
      if (d > end) break;
      out.push({ day: d, label: String(y) });
    }
  }
  return out;
}

function tickLabels(ticks: Tick[], at: (d: number) => number, y: number, px: number, minX: number, maxX: number): string {
  const out: string[] = [];
  let last = -Infinity;
  for (const t of ticks) {
    const x = at(t.day), w = textWidth(t.label, px, "sans"), left = x - w / 2;
    if (left < minX || left + w > maxX || left < last + 12) continue;
    out.push(text(x, y, t.label, "x-tick-label", "middle"));
    last = left + w;
  }
  return out.join("");
}

// ---------- label placement ----------

/**
 * Lowest free level on one side of the axis for a label box [left, right] whose leader stands at x.
 * Labels are placed right to left, so a label never covers a leader placed after it; the checks keep
 * boxes apart on a level, keep other leaders out of this box, and keep this leader out of flipped boxes.
 */
function levelFor(side: Placed[], x: number, left: number, right: number): number {
  const clash = (level: number, strict: boolean) => side.some((p) =>
    (p.level === level && p.left < right + GAP && left < p.right + GAP) ||
    (p.level >= level && p.x >= left - GAP / 2 && p.x <= right + GAP / 2) ||
    (strict && p.level < level && p.left - 4 <= x && x <= p.right + 4));
  const ceiling = side.length ? Math.max(...side.map((p) => p.level)) + 1 : 0;
  for (let level = 0; level <= ceiling; level++) if (!clash(level, true)) return level;
  for (let level = 0; level <= ceiling; level++) if (!clash(level, false)) return level;
  return ceiling;
}

/** Side (above −1 / below 1) and level for every event in one lane. Ties alternate sides. */
function place(events: TimelineEvent[], at: (d: number) => number, labels: Map<string, Label>, minX: number, maxX: number): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const all: Placed[] = [];
  let prefer: -1 | 1 = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i], x = at(e.date), w = labels.get(e.id)!.w;
    const flip = x + 6 + w > maxX && x - 6 - w >= minX;
    const box = flip ? { left: x - 6 - w, right: x - 6 } : { left: x + 6, right: x + 6 + w };
    const up = levelFor(all.filter((p) => p.side === -1), x, box.left, box.right);
    const down = levelFor(all.filter((p) => p.side === 1), x, box.left, box.right);
    const side: -1 | 1 = up < down ? -1 : down < up ? 1 : prefer;
    const p: Placed = { x, left: box.left, right: box.right, anchor: flip ? "end" : "start", side, level: side === -1 ? up : down };
    all.push(p);
    out.set(e.id, p);
    prefer = side === -1 ? 1 : -1;
  }
  return out;
}

// ---------- helpers ----------

/** Lane and period labels are sentence-case sans at weight 600. */
const boldWidth = (label: string, px: number) => textWidth(label, px, "sans") * 1.08;

function showYears(b: TimelineBlock): boolean {
  if (b.events.some((e) => e.prec === "year")) return true;
  const days = [...b.events.map((e) => e.date), ...b.periods.flatMap((p) => [p.start, p.end - 1])];
  return ymd(Math.min(...days)).y !== ymd(Math.max(...days)).y;
}

function periodValue(p: TimelinePeriod): string {
  const a = dateText(p.start, p.startPrec, true), z = dateText(p.end - 1, p.endPrec, true);
  return a === z ? a : `${a} – ${z}`;
}

/** The era an event falls in: the first period that contains its date. */
const eraOf = (b: TimelineBlock, e: TimelineEvent) => b.periods.find((p) => e.date >= p.start && e.date < p.end);
const inside = (b: TimelineBlock, p: TimelinePeriod) => b.events.filter((e) => e.date >= p.start && e.date < p.end);
const coarse = (a: TimelineEvent, z: TimelineEvent) => a.prec === "year" || z.prec === "year";

// ---------- module ----------

export const blockModule: BlockModule<TimelineBlock> = {
  type: "timeline",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "timeline", line);
    allowKeys(data, BLOCK_KEYS, "timeline", line);
    const id = requireString(data, "id", "timeline", line);
    const where = `timeline "${id}"`;
    const rawEvents = list(data.events, `${where} events`, line);
    if (!rawEvents.length) throw new SpecError(`${where} needs at least one event.`, line);

    const drafts = rawEvents.map((item, i) => {
      const ew = `${where} event ${i + 1}`;
      if (!isObj(item)) throw new SpecError(`${ew} must be a map: { date, label, about }.`, line);
      allowKeys(item, EVENT_KEYS, ew, line);
      const label = requireString(item, "label", ew, line);
      const iw = `${where} event "${label}"`;
      if (item.date === undefined) throw new SpecError(`${iw} needs \`date\` (YYYY, YYYY-MM or YYYY-MM-DD).`, line);
      return {
        label,
        explicitId: optString(item, "id", iw, line),
        when: parseDay(item.date, `${iw} date`, line),
        lane: optString(item, "lane", iw, line) || undefined,
        about: optString(item, "about", iw, line),
        focal: optBool(item, "focal", iw, line),
        muted: optBool(item, "muted", iw, line),
      };
    });
    const laned = drafts.filter((d) => d.lane).length;
    if (laned && laned < drafts.length) {
      throw new SpecError(`${where}: ${laned} events have a \`lane\` and ${drafts.length - laned} do not; give every event a lane or none.`, line);
    }

    const rawPeriods = data.periods === undefined ? [] : list(data.periods, `${where} periods`, line);
    const pdrafts = rawPeriods.map((item, i) => {
      const pw = `${where} period ${i + 1}`;
      if (!isObj(item)) throw new SpecError(`${pw} must be a map: { label, start, end }.`, line);
      allowKeys(item, PERIOD_KEYS, pw, line);
      const label = requireString(item, "label", pw, line);
      const iw = `${where} period "${label}"`;
      if (item.start === undefined || item.end === undefined) throw new SpecError(`${iw} needs both \`start\` and \`end\`.`, line);
      const from = parseDay(item.start, `${iw} start`, line), to = parseDay(item.end, `${iw} end`, line);
      const end = endOf(to);
      if (end <= from.day) throw new SpecError(`${iw} ends before it starts.`, line);
      return { label, explicitId: optString(item, "id", iw, line), from, to, end, about: optString(item, "about", iw, line) };
    });

    // ids: explicit ones as written, the rest `${block}-${slug}`
    const taken = new Set<string>();
    for (const d of [...drafts, ...pdrafts]) {
      if (!d.explicitId) continue;
      if (taken.has(d.explicitId)) throw new SpecError(`${where}: id "${d.explicitId}" is used twice.`, line, "id-unique");
      taken.add(d.explicitId);
    }
    const events: TimelineEvent[] = drafts.map((d) => ({
      id: d.explicitId ?? idFrom(d.label, taken, `${id}-`),
      label: d.label, date: d.when.day, prec: d.when.prec, about: d.about, focal: d.focal, muted: d.muted,
    }));
    const periods: TimelinePeriod[] = pdrafts.map((d) => ({
      id: d.explicitId ?? idFrom(d.label, taken, `${id}-`),
      label: d.label, start: d.from.day, end: d.end, startPrec: d.from.prec, endPrec: d.to.prec, about: d.about,
    }));
    const lanes: TimelineLane[] = [];
    const laneByLabel = new Map<string, TimelineLane>();
    drafts.forEach((d, i) => {
      if (!d.lane) return;
      let lane = laneByLabel.get(d.lane);
      if (!lane) {
        lane = { id: idFrom(d.lane, taken, `${id}-`), label: d.lane, members: [] };
        laneByLabel.set(d.lane, lane);
        lanes.push(lane);
      }
      lane.members.push(events[i].id);
      events[i].lane = lane.id;
    });
    events.sort((a, b) => a.date - b.date);
    periods.sort((a, b) => a.start - b.start);

    // range: given, or the data plus a margin so edge dots do not sit on the frame
    const lo = Math.min(...events.map((e) => e.date), ...periods.map((p) => p.start));
    const hi = Math.max(...events.map((e) => e.date), ...periods.map((p) => p.end));
    let start: number, end: number;
    if (data.start !== undefined || data.end !== undefined) {
      start = data.start === undefined ? lo : parseDay(data.start, `${where} start`, line).day;
      end = data.end === undefined ? hi + 1 : endOf(parseDay(data.end, `${where} end`, line));
      if (end <= start) throw new SpecError(`${where}: \`end\` must come after \`start\`.`, line);
      for (const e of events) {
        if (e.date < start || e.date >= end) throw new SpecError(`${where}: event "${e.label}" falls outside \`start\`/\`end\`; widen the range or drop it.`, line);
      }
      for (const p of periods) {
        if (p.start < start || p.end > end) throw new SpecError(`${where}: period "${p.label}" falls outside \`start\`/\`end\`; widen the range or shorten it.`, line);
      }
    } else {
      const finest = events.some((e) => e.prec === "day") ? 3 : events.some((e) => e.prec === "month") ? 15 : 120;
      const margin = Math.max(Math.round((hi - lo) * 0.04), finest);
      start = lo - margin;
      end = hi + margin;
    }

    if (events.length > MAX_EVENTS) {
      const split = periods.length > 1 ? "one timeline per period" : "two timelines at a natural break";
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${events.length} events; keep it to ${MAX_EVENTS}. Split it into ${split}, or move minor events into the prose.`, line });
    }
    const focal = events.filter((e) => e.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} events focal; keep it to ${BUDGET.focal}, the turning point the prose is about.`, line });
    }

    // reference lines and bands run along the calendar
    const inRange = (d: number, what: string) => {
      if (d >= start && d < end) return true;
      ctx.warn({ rule: "spec", severity: "warn", message: `${where}: ${what} (${dateText(d, "day", true)}) is outside the timeline, so it is not drawn.`, line });
      return false;
    };
    const marks = parseMarks(data.marks, line).map((m, i) => {
      if (m.axis !== "x") throw new SpecError(`${where} marks item ${i + 1}: a timeline's reference lines are dates, so use {x: 2024-03, label: …}.`, line);
      return { at: markDay(m.at, `${where} marks item ${i + 1}`, line).day, label: m.label };
    }).filter((m, i) => inRange(m.at, `marks item ${i + 1}`));
    const bands = parseBands(data.bands, line).map((bd, i) => {
      if (bd.axis === "y") throw new SpecError(`${where} bands item ${i + 1}: a timeline's bands are date ranges, so drop \`axis: y\`.`, line);
      const from = markDay(bd.from, `${where} bands item ${i + 1} from`, line).day;
      const to = endOf(markDay(bd.to, `${where} bands item ${i + 1} to`, line));
      if (to <= from) throw new SpecError(`${where} bands item ${i + 1} ends before it starts.`, line);
      return { from: Math.max(from, start), to: Math.min(to, end), label: bd.label };
    }).filter((bd) => bd.to > bd.from);

    return { type: "timeline", id, title: optString(data, "title", where, line), line, start, end, events, periods, lanes, marks, bands, ...readingSpec(data, line) };
  },

  render(b, ctx) {
    const theme = ctx.theme;
    const pad = theme.grid.pad, px = theme.type.nodeSub, tag = theme.type.tag;
    const lh = Math.round(px * 1.35);
    const years = showYears(b);
    const laned = b.lanes.length > 0;
    const laneW = laned ? Math.min(LANE_MAX, Math.ceil(Math.max(...b.lanes.map((l) => boldWidth(l.label, tag))))) : 0;
    const x0 = pad + (laned ? laneW + 24 : 0) + 8, x1 = WIDTH - pad - 8;
    const x = linear([b.start, b.end], [x0, x1], { nice: false });
    const minX = laned ? x0 - 8 : pad / 2, maxX = WIDTH - pad / 2;
    const focalStem = b.events.some((e) => e.focal) ? FOCAL_STEM : 0;

    // label boxes: a date line over the wrapped label, both sans
    const labels = new Map<string, Label>();
    for (const e of b.events) {
      const lines = wrap(e.label, LABEL_MAX, px, "sans");
      const date = dateText(e.date, e.prec, years);
      labels.set(e.id, { lines, date, w: Math.max(textWidth(date, tag, "sans"), ...lines.map((l) => textWidth(l, px, "sans"))) });
    }
    const dateH = tag + 6;
    const slotH = dateH + Math.max(...[...labels.values()].map((l) => l.lines.length)) * lh;
    // levels sit far enough apart that a focal label, pushed out by its longer stem, never reaches the next level
    const levelH = slotH + 10 + focalStem;

    // period labels get their own strip on top, stacked when they would touch
    const top = pad / 2;
    const strip: { p: TimelinePeriod; a: number; z: number; left: number; w: number; level: number }[] = [];
    for (const p of b.periods) {
      const a = x(p.start), z = x(p.end), w = boldWidth(p.label, tag);
      const left = Math.max(minX, Math.min((a + z) / 2 - w / 2, maxX - w));
      let level = 0;
      while (strip.some((o) => o.level === level && o.left < left + w + GAP && left < o.left + o.w + GAP)) level++;
      strip.push({ p, a, z, left, w, level });
    }
    const stripH = strip.length ? (Math.max(...strip.map((s) => s.level)) + 1) * 18 + 6 : 0;

    // lanes, top to bottom; each sizes itself to its label levels
    const nav = new Map(b.events.map((e, i) => [e.id, i]));
    const lanes = laned ? b.lanes : [{ id: "", label: "", members: b.events.map((e) => e.id) }];
    const laneParts: string[] = [], eventParts: string[] = [];
    const anchors: Record<string, Frame> = {}, boxes: Frame[] = [];
    let y = top + stripH;
    for (const lane of lanes) {
      const events = laned ? b.events.filter((e) => e.lane === lane.id) : b.events;
      const placed = place(events, x, labels, minX, maxX);
      const reach = (side: -1 | 1) => {
        const own = events.filter((e) => placed.get(e.id)!.side === side);
        if (!own.length) return 0;
        const levels = Math.max(...own.map((e) => placed.get(e.id)!.level));
        return 14 + levels * levelH + slotH + (own.some((e) => e.focal) ? focalStem : 0);
      };
      const na = reach(-1), nb = reach(1);
      const axisY = y + (na ? 6 + na : 12);
      const bottom = axisY + (nb ? nb + 6 : 12);
      laneParts.push(`<line class="x-axis-line" x1="${num(x0 - 8)}" y1="${num(axisY)}" x2="${num(x1 + 8)}" y2="${num(axisY)}"/>`);
      if (laned) {
        const lines = wrap(lane.label, laneW / 1.08, tag, "sans");
        const texts = lines.map((s, i) => text(pad, axisY + (i - (lines.length - 1) / 2) * (tag + 4) + tag * 0.35, s, "x-timeline-lane-label")).join("");
        laneParts.push(`<g class="x-legend-item x-timeline-lane" data-id="${esc(lane.id)}" tabindex="0" role="button" aria-label="${esc(lane.label)}">${texts}</g>`);
      }
      for (const e of events) {
        const p = placed.get(e.id)!, l = labels.get(e.id)!;
        const cx = x(e.date), bh = dateH + l.lines.length * lh, r = e.focal ? FOCAL_DOT : DOT;
        const out = 14 + p.level * levelH + (e.focal ? focalStem : 0);
        const boxTop = p.side < 0 ? axisY - out - bh : axisY + out;
        const [ly1, ly2] = p.side < 0 ? [axisY - r - 2, boxTop + 2] : [axisY + r + 2, boxTop + bh - 2];
        const tx = p.anchor === "start" ? cx + 6 : cx - 6;
        const shape = `<line class="x-timeline-leader" x1="${num(cx)}" y1="${num(ly1)}" x2="${num(cx)}" y2="${num(ly2)}"/>` +
          text(tx, boxTop + tag, l.date, "x-value-label", p.anchor) +
          l.lines.map((s, i) => text(tx, boxTop + dateH + i * lh + px, s, "x-mark-label", p.anchor)).join("") +
          `<circle class="x-mark-shape" cx="${num(cx)}" cy="${num(axisY)}" r="${r}"/>`;
        const attrs = (e.muted ? ` data-muted="true"` : "") + ` data-at="${iso(e.date)}" data-nav="1,${nav.get(e.id)}"`;
        eventParts.push(mark({ id: e.id, label: e.label, value: dateText(e.date, e.prec, true), focal: e.focal, cls: "x-timeline-event", attrs }, shape));
        const box = { x: p.left, y: boxTop, w: p.right - p.left, h: bh };
        boxes.push(box, { x: cx - r, y: axisY - r, w: r * 2, h: r * 2 });
        anchors[e.id] = { x: Math.min(cx - r, box.x), y: Math.min(boxTop, axisY - r), w: Math.max(cx + r, box.x + box.w) - Math.min(cx - r, box.x), h: Math.max(boxTop + bh, axisY + r) - Math.min(boxTop, axisY - r) };
      }
      y = bottom + LANE_GAP;
    }
    const plotTop = top + stripH, plotBottom = y - LANE_GAP + 4;

    // periods: shaded bands behind everything; the label is the selectable part
    const periodParts = strip.map(({ p, a, z, left, w, level }, j) => {
      const band = `<rect class="x-mark-shape" x="${num(a + 1)}" y="${num(top)}" width="${num(Math.max(2, z - a - 2))}" height="${num(plotBottom - top)}"/>`;
      anchors[p.id] = { x: left, y: top + level * 18, w, h: 16 };
      boxes.push(anchors[p.id]);
      const attrs = ` data-at="${iso(p.start)}..${iso(p.end)}" data-nav="0,${j}"`;
      return mark({ id: p.id, label: p.label, value: periodValue(p), cls: "x-timeline-period", attrs }, band + text(left, top + 12 + level * 18, p.label, "x-timeline-period-label"));
    }).join("");

    const ticks = calendarTicks(b.start, b.end);
    const grid = ticks.map((t) => `<line class="x-grid-line" x1="${num(x(t.day))}" y1="${num(plotTop)}" x2="${num(x(t.day))}" y2="${num(plotBottom)}"/>`).join("");
    // the axis strip takes a drag: its x span maps linearly onto [data-min, data-max) (the client's brush)
    const brush = `<rect class="x-timeline-brush" data-brush="${esc(b.id)}" data-min="${iso(b.start)}" data-max="${iso(b.end)}" x="${num(x0)}" y="${num(plotBottom)}" width="${num(x1 - x0)}" height="${BRUSH_H}"/>`;
    const axis = `<g class="x-axis x-axis-x">${grid}${tickLabels(ticks, x, plotBottom + 14, tag, minX, maxX)}${brush}</g>`;
    const plot: Frame = { x: x0 - 8, y: plotTop, w: x1 - x0 + 16, h: plotBottom - plotTop };
    const refs = b.bands.map((bd) => refBand(plot, { x: [x(bd.from), x(bd.to)] }, bd.label, { px: tag })).join("") +
      b.marks.map((m) => refLine(plot, { x: x(m.at) }, m.label, { px: tag })).join("");

    const height = Math.ceil(plotBottom + BRUSH_H + pad / 2);
    const markers = notes(b, anchors, { obstacles: boxes, bounds: { x: 0, y: 0, w: WIDTH, h: height } });
    const first = b.events[0], last = b.events[b.events.length - 1];
    const lanesDesc = laned ? ` in ${b.lanes.length} lanes` : "";
    return svgFigure({
      id: b.id,
      kind: "timeline",
      title: b.title,
      label: "Timeline",
      desc: `${b.events.length} events from ${dateText(first.date, first.prec, true)} to ${dateText(last.date, last.prec, true)}${lanesDesc}.`,
      width: WIDTH,
      height,
      body: periodParts + refs + axis + laneParts.join("") + eventParts.join("") + markers,
    });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const n = b.events.length;
    b.events.forEach((e, i) => {
      const prev = b.events[i - 1], next = b.events[i + 1], era = eraOf(b, e);
      const date = dateText(e.date, e.prec, true);
      const facts: Fact[] = [];
      if (prev) facts.push({ k: "Since", v: `${gapText(prev.date, e.date, coarse(prev, e))} after ${prev.label}`, ref: prev.id, raw: e.date - prev.date });
      if (next) facts.push({ k: "Next", v: `${next.label}, ${gapText(e.date, next.date, coarse(e, next))} later`, ref: next.id, raw: next.date - e.date });
      if (era) facts.push({ k: "Era", v: era.label, ref: era.id });
      elements[e.id] = itemInfo({
        id: e.id, label: e.label, figure: b.id, kind: "event", value: date, about: e.about,
        related: [...(e.lane ? [e.lane] : []), ...(era ? [era.id] : [])],
        context: [prev?.id, next?.id].filter((k): k is string => !!k),
        pos: `${i + 1} of ${n}`,
        facts,
        say: `${e.label}, ${date}${prev ? `, ${gapText(prev.date, e.date, coarse(prev, e))} after ${prev.label}` : ""}`,
      });
    });
    b.periods.forEach((p, j) => {
      const own = inside(b, p);
      elements[p.id] = itemInfo({
        id: p.id, label: p.label, figure: b.id, kind: "period", value: periodValue(p), about: p.about,
        related: own.map((e) => e.id),
        pos: `${j + 1} of ${b.periods.length}`,
        facts: [
          { k: "Length", v: gapText(p.start, p.end, p.startPrec === "year" && p.endPrec === "year"), raw: p.end - p.start },
          { k: "Events", v: own.length ? `${own.length} · ${joinList(own.map((e) => e.label))}` : "none" },
        ],
        links: [{ rel: "Events", ids: own.map((e) => e.id) }],
        say: `${p.label}, ${periodValue(p)}, ${own.length} event${own.length === 1 ? "" : "s"}`,
      });
    });
    for (const l of b.lanes) {
      const own = b.events.filter((e) => e.lane === l.id);
      elements[l.id] = groupInfo({
        id: l.id, label: l.label, figure: b.id, members: l.members, kind: "lane",
        value: `${own.length} event${own.length === 1 ? "" : "s"}`,
        facts: [{ k: "From", v: `${own[0].label} · ${dateText(own[0].date, own[0].prec, true)}`, ref: own[0].id },
          { k: "To", v: `${own[own.length - 1].label} · ${dateText(own[own.length - 1].date, own[own.length - 1].prec, true)}`, ref: own[own.length - 1].id }],
        say: `${l.label} lane, ${own.length} events`,
      });
    }
    return { elements };
  },

  reading(b) {
    const parts = ["Each dot is an event on a calendar axis, so the space between two dots is the time between them."];
    if (b.periods.length) parts.push("Shaded bands are eras.");
    if (b.lanes.length) parts.push("Each row is a lane.");
    if (b.events.some((e) => e.focal)) parts.push("The highlighted event, on the longer stem, is the one the text is about.");
    return parts.join(" ");
  },

  table(b) {
    const years = showYears(b);
    const lanes = new Map(b.lanes.map((l) => [l.id, l.label]));
    const head = ["Date", "Event", ...(b.periods.length ? ["Era"] : []), ...(b.lanes.length ? ["Lane"] : [])];
    const rows = b.events.map((e) => [
      dateText(e.date, e.prec, years),
      e.label,
      ...(b.periods.length ? [eraOf(b, e)?.label ?? ""] : []),
      ...(b.lanes.length ? [lanes.get(e.lane ?? "") ?? ""] : []),
    ]);
    return { head, rows } satisfies DataTable;
  },
};
