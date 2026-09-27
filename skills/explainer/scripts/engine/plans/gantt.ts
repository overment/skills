// Gantt: tasks as bars on a calendar, grouped into phases, with `after` dependencies drawn as connectors.
// normalize runs the critical-path method: every linked task gets its float (slack) in days and a critical flag.
import { BUDGET, SpecError, type BandSpec, type BlockModule, type DataTable, type ElementInfo, type Fact, type NoteSpec, type RefMarkSpec, type StoryStep } from "../types.ts";
import {
  READING_KEYS, arrowDefs, esc, factList, fmt, groupInfo, idFrom, isObj, itemInfo, linear, list, mark, notes, num, number, orthoPath,
  parseBands, parseMarks, pct, readingSpec, refBand, refLine, svgFigure, text, textWidth, wrap, type Frame,
} from "../kit.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString, stringList } from "../blocks/util.ts";

const WIDTH = 960;
const MAX_TASKS = 14;
const COL_MAX = 240;   // widest label column before task labels wrap
const ROW_H = 32;      // task band; the bar is BAR_H inside it, so row boundaries are 8px gutters
const GROUP_H = 28;
const BAR_H = 16;
const DIAMOND = 7;     // milestone half-diagonal
const CLEAR = 5;       // connectors keep this far from bars they don't touch
const STUB = 8;        // straight run out of a predecessor before the first turn
const ENTRY = 10;      // straight run into a successor (holds the arrowhead)
const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BLOCK_KEYS = ["id", "title", "start", "end", "today", "tasks", "marks", "bands", ...READING_KEYS];
const TASK_KEYS = ["id", "label", "start", "end", "days", "group", "after", "progress", "milestone", "about", "focal", "muted"];

interface GanttTask {
  id: string;
  label: string;
  start: number;      // UTC day number (days since 1970-01-01)
  end: number;        // exclusive; equals start for milestones
  group?: string;     // group id
  after: string[];    // predecessor task ids
  next: string[];     // successor task ids
  progress?: number;  // share done, 0..1
  milestone: boolean;
  focal: boolean;
  muted: boolean;
  about?: string;
  float?: number;     // days it can slip before the finish moves; undefined = not linked
  critical: boolean;  // linked and no float
}

interface GanttGroup { id: string; label: string; members: string[] }

interface GanttBlock {
  type: "gantt";
  id: string;
  title?: string;
  line: number;
  start: number;      // first day shown
  end: number;        // exclusive
  today?: number;
  tasks: GanttTask[]; // display order: ungrouped first, then each group in order of first use
  groups: GanttGroup[];
  finish?: number;    // latest finish of the linked tasks (a milestone finishes on its day)
  critical: string[]; // critical task ids, in start order
  criticalId: string; // `<id>-critical`: selectable, lights the critical path
  todayId: string;    // `<id>-today`
  marks: { at: number; label?: string }[];
  bands: { from: number; to: number; label?: string }[];
  notes?: NoteSpec[];
  caveat?: string;
  story?: StoryStep[];
}

interface Row { y: number; h: number; lines: string[] }
interface Lane { top: number; bottom: number; xs: [number, number][] }
type Seg = [number, number, number, number];

// ---------- dates: UTC day numbers ----------

type Precision = "year" | "month" | "day";
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
  throw new SpecError(`${what} must be a date like 2026-03-04 (or 2026-03), got ${JSON.stringify(v)}.`, line);
}

/** Exclusive end of a date read as "through": that day, the whole month or the whole year. */
function endOf(v: Day): number {
  const { y, m } = ymd(v.day);
  return v.prec === "day" ? v.day + 1 : v.prec === "month" ? utcDay(y, m + 1, 1) : utcDay(y + 1, 0, 1);
}

function dayLabel(day: number, year = false): string {
  const { y, m, d } = ymd(day);
  return `${MONTHS[m]} ${d}${year ? `, ${y}` : ""}`;
}

function spanLabel(start: number, end: number, year: boolean): string {
  return end - start <= 1 ? dayLabel(start, year) : `${dayLabel(start, year)} – ${dayLabel(end - 1, year)}`;
}

const days = (n: number) => fmt(n, "d");

interface Tick { day: number; label: string }

/** Calendar ticks for [start, end]: days, Mondays, months, quarters or years, whichever suits the span. */
function calendarTicks(start: number, end: number): Tick[] {
  const span = end - start, out: Tick[] = [];
  const s = ymd(start);
  if (span <= 31) {
    for (let d = start; d <= end; d++) out.push({ day: d, label: dayLabel(d) });
  } else if (span <= 140) {
    const monday = start + ((8 - new Date(start * DAY_MS).getUTCDay()) % 7);
    for (let d = monday; d <= end; d += 7) out.push({ day: d, label: dayLabel(d) });
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

/** Tick labels left to right, skipping any that would touch the previous one or leave [minX, maxX]. */
function tickLabels(ticks: Tick[], at: (d: number) => number, y: number, px: number, minX: number, maxX: number, anchor: "start" | "middle"): string {
  const out: string[] = [];
  let last = -Infinity;
  for (const t of ticks) {
    const x = at(t.day), w = textWidth(t.label, px, "sans");
    const left = anchor === "start" ? x + 4 : x - w / 2;
    if (left < minX || left + w > maxX || left < last + 12) continue;
    out.push(text(anchor === "start" ? x + 4 : x, y, t.label, "x-tick-label", anchor));
    last = left + w;
  }
  return out.join("");
}

/** A `marks:`/`bands:` value on the calendar: a date, or a bare year the YAML read as a number. */
function markDay(v: number | string, what: string, line: number): Day {
  if (typeof v === "number" && !(Number.isInteger(v) && v >= 1000 && v <= 9999)) {
    throw new SpecError(`${what} runs along the calendar, so it takes a date like 2026-05-01, got ${v}.`, line);
  }
  if (v === "mean" || v === "median") throw new SpecError(`${what} runs along the calendar, so it takes a date, not ${v}.`, line);
  return parseDay(v, what, line);
}

// ---------- geometry ----------

/** Parts of [lo, hi] that no blocked interval covers. */
function freeSpans(blocked: [number, number][], lo: number, hi: number): [number, number][] {
  const out: [number, number][] = [];
  let at = lo;
  for (const [a, b] of [...blocked].sort((p, q) => p[0] - q[0])) {
    if (b <= at || a >= hi) { at = Math.max(at, Math.min(b, hi)); continue; }
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < hi) out.push([at, hi]);
  return out;
}

/** How far a dependency's vertical run may leave the gap between its two bars to find a free column. */
const DETOUR_MAX = 96;

/** The free x nearest to [lo, hi] (the leftmost one inside it when there is one). */
function pickX(free: [number, number][], lo: number, hi: number): { x: number; span: [number, number] } | undefined {
  const [tlo, thi] = lo <= hi ? [lo, hi] : [hi, lo];
  let best: { x: number; span: [number, number] } | undefined, bestD = Infinity;
  for (const span of free) {
    const [a, b] = span;
    const x = b < tlo ? b : a > thi ? a : Math.max(a, tlo);
    const d = x < tlo ? tlo - x : x > thi ? x - thi : 0;
    if (d < bestD) { best = { x, span }; bestD = d; }
  }
  return best;
}

/** Drops repeated points and the middle of straight runs. */
function simplify(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 0.05 && Math.abs(last[1] - p[1]) < 0.05) continue;
    const prev = out[out.length - 2];
    if (last && prev && ((Math.abs(prev[0] - last[0]) < 0.05 && Math.abs(last[0] - p[0]) < 0.05) || (Math.abs(prev[1] - last[1]) < 0.05 && Math.abs(last[1] - p[1]) < 0.05))) out.pop();
    out.push(p);
  }
  return out;
}

const segsOf = (pts: [number, number][]): Seg[] => pts.slice(1).map((p, i) => [pts[i][0], pts[i][1], p[0], p[1]]);

/** Does an axis-aligned segment touch the box (grown by `m`)? */
function segHits(s: Seg, b: Frame, m = 1): boolean {
  const [x1, y1, x2, y2] = s;
  return Math.max(x1, x2) >= b.x - m && Math.min(x1, x2) <= b.x + b.w + m && Math.max(y1, y2) >= b.y - m && Math.min(y1, y2) <= b.y + b.h + m;
}

const boxHits = (a: Frame, b: Frame) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---------- helpers ----------

/** Phase heads, key labels and milestone dates are sans; measured at weight 600, which they take when lit. */
const boldWidth = (label: string, px: number) => textWidth(label, px, "sans") * 1.08;
const reach = (t: GanttTask) => (t.milestone ? t.start + 1 : t.end);
const edgeId = (from: string, to: string) => `${from}->${to}`;
const crossesYear = (b: GanttBlock) => ymd(b.start).y !== ymd(b.end - 1).y;
const linked = (t: GanttTask) => t.after.length > 0 || t.next.length > 0;
/** Critical edge: both ends critical and the successor starts the moment the predecessor ends. */
const tight = (p: GanttTask, s: GanttTask) => p.critical && s.critical && s.start === p.end;

function taskValue(t: GanttTask, years: boolean, done = true): string {
  if (t.milestone) return dayLabel(t.start, years);
  const parts = [spanLabel(t.start, t.end, years), days(t.end - t.start)];
  if (done && t.progress !== undefined) parts.push(`${pct(t.progress * 100)} done`);
  return parts.join(" · ");
}

function slackText(t: GanttTask): string {
  if (t.float === undefined) return "not linked";
  if (t.float <= 0) return t.float < 0 ? `${days(t.float).replace(/^-/, "−")} · critical` : "0 d · critical";
  return days(t.float);
}

function groupRange(g: GanttGroup, byId: Map<string, GanttTask>): [number, number] {
  const ts = g.members.map((m) => byId.get(m)!);
  return [Math.min(...ts.map((t) => t.start)), Math.max(...ts.map(reach))];
}

function groupIndex(b: GanttBlock): Map<string, GanttGroup> {
  const out = new Map<string, GanttGroup>();
  for (const g of b.groups) for (const m of g.members) out.set(m, g);
  return out;
}

/** The milestone the linked work finishes on, when there is one: the reader's "launch". */
function finishMilestone(b: GanttBlock): GanttTask | undefined {
  if (b.finish === undefined) return undefined;
  return b.tasks.find((t) => t.milestone && linked(t) && t.start === b.finish);
}

/** Every task upstream (`after`) or downstream (`next`) of `id`, excluding it. */
function closure(byId: Map<string, GanttTask>, id: string, dir: "after" | "next"): Set<string> {
  const out = new Set<string>();
  const walk = (k: string) => {
    for (const j of byId.get(k)![dir]) if (!out.has(j)) { out.add(j); walk(j); }
  };
  walk(id);
  return out;
}

// ---------- module ----------

export const blockModule: BlockModule<GanttBlock> = {
  type: "gantt",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "gantt", line);
    allowKeys(data, BLOCK_KEYS, "gantt", line);
    const id = requireString(data, "id", "gantt", line);
    const where = `gantt "${id}"`;
    const rawTasks = list(data.tasks, `${where} tasks`, line);
    if (!rawTasks.length) throw new SpecError(`${where} needs at least one task.`, line);

    const drafts = rawTasks.map((item, i) => {
      const tw = `${where} task ${i + 1}`;
      if (!isObj(item)) throw new SpecError(`${tw} must be a map: { label, start, end | days }.`, line);
      allowKeys(item, TASK_KEYS, tw, line);
      const label = requireString(item, "label", tw, line);
      const iw = `${where} task "${label}"`;
      const milestone = optBool(item, "milestone", iw, line);
      const after = item.after === undefined ? [] : typeof item.after === "string" ? [item.after] : stringList(item.after, `${iw} after`, line);
      let progress: number | undefined;
      if (item.progress !== undefined) {
        if (milestone) throw new SpecError(`${iw} is a milestone and has no progress; drop \`progress\`.`, line);
        progress = number(item.progress, `${iw} progress`, line);
        if (progress < 0 || progress > 1) throw new SpecError(`${iw} progress must be a share from 0 to 1 (0.4 means 40% done), got ${progress}.`, line);
      }
      let dayCount: number | undefined;
      if (item.days !== undefined) {
        dayCount = number(item.days, `${iw} days`, line);
        if (!(dayCount > 0)) throw new SpecError(`${iw} days must be more than 0, got ${dayCount}.`, line);
      }
      if (milestone && (item.end !== undefined || dayCount !== undefined)) {
        throw new SpecError(`${iw} is a milestone: give it only \`start\` (or \`after\`), no \`end\` or \`days\`.`, line);
      }
      if (!milestone && item.end !== undefined && dayCount !== undefined) throw new SpecError(`${iw}: give either \`end\` or \`days\`, not both.`, line);
      if (!milestone && item.end === undefined && dayCount === undefined) throw new SpecError(`${iw} needs \`end\` (its last day) or \`days\` (its length).`, line);
      return {
        label,
        iw,
        explicitId: optString(item, "id", iw, line),
        start: item.start === undefined ? undefined : parseDay(item.start, `${iw} start`, line),
        end: item.end === undefined ? undefined : parseDay(item.end, `${iw} end`, line),
        days: dayCount,
        group: optString(item, "group", iw, line) || undefined,
        after,
        progress,
        milestone,
        focal: optBool(item, "focal", iw, line),
        muted: optBool(item, "muted", iw, line),
        about: optString(item, "about", iw, line),
      };
    });

    // ids: explicit ones as written, the rest `${block}-${slug}`; `-critical` and `-today` are the chart's own
    const taken = new Set<string>();
    for (const d of drafts) {
      if (!d.explicitId) continue;
      if (taken.has(d.explicitId)) throw new SpecError(`${where}: task id "${d.explicitId}" is used twice.`, line, "id-unique");
      taken.add(d.explicitId);
    }
    const criticalId = `${id}-critical`, todayId = `${id}-today`;
    for (const reserved of [criticalId, todayId]) {
      if (taken.has(reserved)) throw new SpecError(`${where}: id "${reserved}" is reserved for the chart's ${reserved === criticalId ? "critical path" : "today marker"}; rename the task.`, line, "id-unique");
      taken.add(reserved);
    }
    const ids = drafts.map((d) => d.explicitId ?? idFrom(d.label, taken, `${id}-`));

    // `after` resolves by id first, then by a label that only one task has
    const byRef = new Map<string, number>();
    ids.forEach((tid, i) => byRef.set(tid, i));
    const labelCount = new Map<string, number>();
    for (const d of drafts) labelCount.set(d.label, (labelCount.get(d.label) ?? 0) + 1);
    drafts.forEach((d, i) => { if (labelCount.get(d.label) === 1 && !byRef.has(d.label)) byRef.set(d.label, i); });
    const preds = drafts.map((d, i) => [...new Set(d.after.map((ref) => {
      const j = byRef.get(ref);
      if (j === undefined) throw new SpecError(`${d.iw} comes after "${ref}", which is not a task in this chart. Use a task id or label: ${ids.join(", ")}.`, line, "ref-exists");
      if (j === i) throw new SpecError(`${d.iw} cannot come after itself.`, line);
      return j;
    }))]);

    // dates (the forward pass): a task without `start` begins when its last predecessor ends
    const starts: number[] = [], ends: number[] = [];
    const state = drafts.map(() => 0); // 0 new, 1 visiting, 2 done
    const trail: number[] = [];
    const resolve = (i: number): void => {
      if (state[i] === 2) return;
      if (state[i] === 1) {
        const loop = [...trail.slice(trail.indexOf(i)), i].map((k) => drafts[k].label).join(" → ");
        throw new SpecError(`${where}: dependency loop ${loop}. Remove one \`after\`.`, line);
      }
      state[i] = 1;
      trail.push(i);
      for (const j of preds[i]) resolve(j);
      trail.pop();
      const d = drafts[i];
      const ready = preds[i].length ? Math.max(...preds[i].map((j) => ends[j])) : undefined;
      const start = d.start?.day ?? ready;
      if (start === undefined) throw new SpecError(`${d.iw} needs \`start\`, or \`after\` so it starts when its predecessors end.`, line);
      if (d.start && ready !== undefined && start < ready) {
        ctx.warn({ rule: "spec", severity: "warn", message: `${d.iw} starts ${dayLabel(start)} but waits for a task that ends ${dayLabel(ready - 1)}; move its start or drop the \`after\`.`, line });
      }
      let end: number;
      if (d.milestone) end = start;
      else if (d.days !== undefined) end = start + Math.ceil(d.days);
      else {
        end = endOf(d.end!);
        if (end <= start) throw new SpecError(`${d.iw} ends (${dayLabel(end - 1, true)}) before it starts (${dayLabel(start, true)}).`, line);
      }
      starts[i] = start;
      ends[i] = end;
      state[i] = 2;
    };
    drafts.forEach((_, i) => resolve(i));

    // rows: ungrouped tasks first, then each group in order of first use
    const sections = new Map<string, number[]>();
    drafts.forEach((d, i) => {
      const key = d.group ?? "";
      if (!sections.has(key)) sections.set(key, []);
      sections.get(key)!.push(i);
    });
    const keys = [...sections.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0));
    const groups: GanttGroup[] = [];
    const tasks: GanttTask[] = [];
    for (const key of keys) {
      const members = sections.get(key)!;
      let gid: string | undefined;
      if (key) {
        gid = idFrom(key, taken, `${id}-`);
        groups.push({ id: gid, label: key, members: members.map((i) => ids[i]) });
      }
      for (const i of members) {
        const d = drafts[i];
        tasks.push({
          id: ids[i], label: d.label, start: starts[i], end: ends[i], group: gid,
          after: preds[i].map((j) => ids[j]), next: [], progress: d.progress, milestone: d.milestone,
          focal: d.focal, muted: d.muted, about: d.about, critical: false,
        });
      }
    }

    // the backward pass: latest finish from the end of the linked work; float = latest finish − finish
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const t of tasks) for (const p of t.after) byId.get(p)!.next.push(t.id);
    const net = tasks.filter(linked);
    const finish = net.length ? Math.max(...net.map((t) => t.end)) : undefined;
    if (finish !== undefined) {
      const order: GanttTask[] = [], seen = new Set<string>();
      const visit = (t: GanttTask) => {
        if (seen.has(t.id)) return;
        seen.add(t.id);
        for (const p of t.after) visit(byId.get(p)!);
        order.push(t);
      };
      net.forEach(visit);
      const lateFinish = new Map<string, number>();
      for (const t of order.reverse()) {
        const lf = t.next.length ? Math.min(...t.next.map((s) => { const n = byId.get(s)!; return lateFinish.get(s)! - (n.end - n.start); })) : finish;
        lateFinish.set(t.id, lf);
        t.float = lf - t.end;
        t.critical = t.float <= 0;
      }
    }
    const critical = tasks.map((t, i) => ({ t, i })).filter(({ t }) => t.critical)
      .sort((a, b) => a.t.start - b.t.start || a.t.end - b.t.end || a.i - b.i).map(({ t }) => t.id);

    // range: given, or exactly the tasks
    const start = data.start === undefined ? Math.min(...tasks.map((t) => t.start)) : parseDay(data.start, `${where} start`, line).day;
    const end = data.end === undefined ? Math.max(...tasks.map(reach)) : endOf(parseDay(data.end, `${where} end`, line));
    if (end <= start) throw new SpecError(`${where}: \`end\` must come after \`start\`.`, line);
    for (const t of tasks) {
      if (t.start < start || reach(t) > end) {
        throw new SpecError(`${where}: task "${t.label}" (${spanLabel(t.start, reach(t), true)}) falls outside \`start\`/\`end\`; widen the range or drop it.`, line);
      }
    }

    let today: number | undefined;
    if (data.today !== undefined) {
      const d = parseDay(data.today, `${where} today`, line).day;
      if (d < start || d >= end) {
        ctx.warn({ rule: "spec", severity: "warn", message: `${where}: today (${dayLabel(d, true)}) is outside the chart, so no marker is drawn. Drop \`today\` or widen the range.`, line });
      } else today = d;
    }

    // reference lines and bands run along the calendar
    const inRange = (d: number, what: string) => {
      if (d >= start && d < end) return true;
      ctx.warn({ rule: "spec", severity: "warn", message: `${where}: ${what} (${dayLabel(d, true)}) is outside the chart, so it is not drawn.`, line });
      return false;
    };
    const marks = parseMarks(data.marks, line).map((m: RefMarkSpec, i) => {
      if (m.axis !== "x") throw new SpecError(`${where} marks item ${i + 1}: a gantt's reference lines are dates, so use {x: 2026-05-01, label: …}.`, line);
      return { at: markDay(m.at, `${where} marks item ${i + 1}`, line).day, label: m.label };
    }).filter((m, i) => inRange(m.at, `marks item ${i + 1}`));
    const bands = parseBands(data.bands, line).map((bd: BandSpec, i) => {
      if (bd.axis === "y") throw new SpecError(`${where} bands item ${i + 1}: a gantt's bands are date ranges, so drop \`axis: y\`.`, line);
      const from = markDay(bd.from, `${where} bands item ${i + 1} from`, line).day;
      const to = endOf(markDay(bd.to, `${where} bands item ${i + 1} to`, line));
      if (to <= from) throw new SpecError(`${where} bands item ${i + 1} ends before it starts.`, line);
      return { from: Math.max(from, start), to: Math.min(to, end), label: bd.label };
    }).filter((bd) => bd.to > bd.from);

    if (tasks.length > MAX_TASKS) {
      const split = groups.length > 1 ? `one gantt per group (${groups.map((g) => g.label).join(", ")})` : "one gantt per phase";
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${tasks.length} tasks; keep it to ${MAX_TASKS}. Split it into ${split}, or merge finished tasks into one bar.`, line });
    }
    const focal = tasks.filter((t) => t.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} tasks focal; keep it to ${BUDGET.focal}, usually the one on the critical path.`, line });
    }

    return {
      type: "gantt", id, title: optString(data, "title", where, line), line, start, end, today, tasks, groups,
      finish, critical, criticalId, todayId, marks, bands, ...readingSpec(data, line),
    };
  },

  render(b, ctx) {
    const theme = ctx.theme;
    const pad = theme.grid.pad, px = theme.type.nodeSub, tag = theme.type.tag;
    const lh = Math.round(px * 1.35), gh = tag + 4;
    const years = crossesYear(b);
    const want = Math.max(...b.tasks.map((t) => textWidth(t.label, px, "sans")), ...b.groups.map((g) => boldWidth(g.label, tag)));
    const col = Math.min(COL_MAX, Math.ceil(want));
    const x0 = pad + col + 24, limit = WIDTH - pad / 2;
    // a milestone's date sits right of its diamond, clear of the arrows coming in from the left: keep room for it
    let x1 = WIDTH - pad;
    for (const t of b.tasks) {
      const f = (t.start - b.start) / (b.end - b.start);
      if (!t.milestone || f <= 0) continue;
      const need = DIAMOND + 6 + boldWidth(dayLabel(t.start, years), tag);
      x1 = Math.min(x1, x0 + (limit - need - x0) / f);
    }
    x1 = Math.max(x1, (x0 + WIDTH) / 2);
    const x = linear([b.start, b.end], [x0, x1], { nice: false });
    const axisY = pad + tag + 10;

    // rows: a header per group, then its tasks; labels wrap inside the left column
    const groupOf = groupIndex(b);
    const byId = new Map(b.tasks.map((t) => [t.id, t]));
    const rows = new Map<string, Row>();
    const heads: { g: GanttGroup; row: Row }[] = [];
    const lanes: Lane[] = [];
    const laneOf = new Map<string, number>();
    let y = axisY + 6;
    let current: GanttGroup | undefined;
    for (const t of b.tasks) {
      const g = groupOf.get(t.id);
      if (g && g !== current) {
        const lines = wrap(g.label, col / 1.08, tag, "sans");
        const h = Math.max(GROUP_H, lines.length * gh + 12);
        heads.push({ g, row: { y, h, lines } });
        laneOf.set(g.id, lanes.length);
        lanes.push({ top: y, bottom: y + h, xs: [] });
        y += h;
      }
      current = g;
      const lines = wrap(t.label, col, px, "sans");
      const h = Math.max(ROW_H, lines.length * lh + 14);
      rows.set(t.id, { y, h, lines });
      laneOf.set(t.id, lanes.length);
      lanes.push({ top: y, bottom: y + h, xs: [] });
      y += h;
    }
    const bottom = y + 6;
    const mid = (r: Row) => r.y + r.h / 2;
    const lineY = (r: Row, i: number, step: number, size: number) => mid(r) + (i - (r.lines.length - 1) / 2) * step + size * 0.35;

    // what connectors and labels must stay off: bars, diamonds and phase spans
    const shapes = new Map<string, Frame>();
    for (const t of b.tasks) {
      const cy = mid(rows.get(t.id)!);
      const f = t.milestone
        ? { x: x(t.start) - DIAMOND, y: cy - DIAMOND, w: DIAMOND * 2, h: DIAMOND * 2 }
        : { x: x(t.start), y: cy - BAR_H / 2, w: Math.max(2, x(t.end) - x(t.start)), h: BAR_H };
      shapes.set(t.id, f);
      lanes[laneOf.get(t.id)!].xs.push([f.x - CLEAR, f.x + f.w + CLEAR]);
    }
    for (const { g, row } of heads) {
      const [lo, hi] = groupRange(g, byId);
      shapes.set(g.id, { x: x(lo), y: mid(row) - 2, w: Math.max(2, x(hi) - x(lo)), h: 4 });
      lanes[laneOf.get(g.id)!].xs.push([x(lo) - CLEAR, x(hi) + CLEAR]);
    }

    // calendar: faint gridlines down the plot, tick labels above it
    const ticks = calendarTicks(b.start, b.end);
    const grid = ticks.map((t) => `<line class="x-grid-line" x1="${num(x(t.day))}" y1="${num(axisY)}" x2="${num(x(t.day))}" y2="${num(bottom)}"/>`).join("");
    const axis = `<g class="x-axis x-axis-x">${grid}<line class="x-axis-line" x1="${num(x0)}" y1="${num(axisY)}" x2="${num(x1)}" y2="${num(axisY)}"/>` +
      `${tickLabels(ticks, x, axisY - 8, tag, x0, limit, "start")}</g>`;
    const plot: Frame = { x: x0, y: axisY, w: x1 - x0, h: bottom - axisY };
    const refs = b.bands.map((bd) => refBand(plot, { x: [x(bd.from), x(bd.to)] }, bd.label, { px: tag })).join("") +
      b.marks.map((m) => refLine(plot, { x: x(m.at) }, m.label, { px: tag })).join("");

    const groupMarks = heads.map(({ g, row }) => {
      const [lo, hi] = groupRange(g, byId), s = shapes.get(g.id)!;
      const label = row.lines.map((l, i) => text(pad, lineY(row, i, gh, tag), l, "x-gantt-group-label")).join("");
      const span = `<rect class="x-mark-shape x-gantt-span" x="${num(s.x)}" y="${num(s.y)}" width="${num(s.w)}" height="4" rx="2"/>`;
      return mark({ id: g.id, label: g.label, value: spanLabel(lo, hi, years), cls: "x-gantt-group", attrs: ` data-nav="${laneOf.get(g.id)},0"` }, label + span);
    }).join("");

    // dependencies: predecessor end → successor start. A vertical run never crosses a bar it doesn't join:
    // it takes the nearest free x, reached through the 8px gutters at the row boundaries when it has to.
    const minX = x0 - 14, maxX = WIDTH - 4;
    const verticals: { x: number; y1: number; y2: number; from: string; to: string }[] = [];
    const segs: Seg[] = [];
    const plain: string[] = [], crit: string[] = [];
    let blockedRoutes = 0;
    for (const s of b.tasks) {
      for (const pid of s.after) {
        const p = byId.get(pid)!, rp = rows.get(pid)!, rs = rows.get(s.id)!;
        const ia = laneOf.get(pid)!, ib = laneOf.get(s.id)!, down = ib > ia;
        const xa = p.milestone ? x(p.start) + DIAMOND : x(p.end), ya = mid(rp);
        const xb = s.milestone ? x(s.start) - DIAMOND : x(s.start), yb = mid(rs);
        const yg1 = down ? rp.y + rp.h : rp.y, yg2 = down ? rs.y : rs.y + rs.h;
        const blocked = lanes.slice(Math.min(ia, ib) + 1, Math.max(ia, ib)).flatMap((l) => l.xs);
        const lo = xa + STUB, hi = xb - ENTRY;
        let pick = pickX(freeSpans(blocked, minX, maxX), lo, hi);
        const off = (p: { x: number }) => Math.max(Math.min(lo, hi) - p.x, p.x - Math.max(lo, hi), 0);
        if (!pick) {
          blockedRoutes++;
          pick = { x: lo <= hi ? lo : hi, span: [minX, maxX] };
        } else if (off(pick) > DETOUR_MAX) {
          // A free column far from both bars sends the arrow on a long trip that crosses the whole chart and bunches
          // with every other detour there. Beyond DETOUR_MAX it runs straight down beside its own bars instead,
          // over the bars between on a halo of canvas, which reads as passing over them rather than joining them.
          pick = { x: lo <= hi ? lo : hi, span: [minX, maxX] };
        }
        const clash = (vx: number) => verticals.some((v) => v.from !== p.id && v.to !== s.id && Math.abs(v.x - vx) < 3 &&
          Math.min(v.y1, v.y2) < Math.max(ya, yb) && Math.min(ya, yb) < Math.max(v.y1, v.y2));
        let vx = pick.x;
        for (const d of [0, 6, -6, 12, -12]) {
          const c = pick.x + d;
          if (c >= pick.span[0] && c <= pick.span[1] && !clash(c)) { vx = c; break; }
        }
        const simple = lo <= hi && vx >= lo && vx <= hi;
        const pts = simplify(simple
          ? [[xa, ya], [vx, ya], [vx, yb], [xb, yb]]
          : [[xa, ya], [xa + STUB, ya], [xa + STUB, yg1], [vx, yg1], [vx, yg2], [xb - ENTRY, yg2], [xb - ENTRY, yb], [xb, yb]]);
        for (const sg of segsOf(pts)) {
          segs.push(sg);
          if (sg[0] === sg[2]) verticals.push({ x: sg[0], y1: sg[1], y2: sg[3], from: p.id, to: s.id });
        }
        const d = orthoPath(pts), hot = tight(p, s);
        (hot ? crit : plain).push(`<g class="x-edge x-gantt-edge${hot ? " x-gantt-crit" : ""}" data-id="${esc(edgeId(p.id, s.id))}" data-from="${esc(p.id)}" data-to="${esc(s.id)}" data-kind="flow"${hot ? ` data-critical="true"` : ""}>` +
          `<path class="x-gantt-halo" d="${d}"/><path class="x-edge-line" d="${d}" marker-end="url(#${esc(b.id)}-arrow)"/><path class="x-edge-hit" d="${d}"/></g>`);
      }
    }
    if (blockedRoutes) {
      ctx.warn({ rule: "route", severity: "warn", message: `gantt "${b.id}": ${blockedRoutes} ${blockedRoutes === 1 ? "connector has" : "connectors have"} no clear column between the bars, so ${blockedRoutes === 1 ? "it crosses" : "they cross"} a bar. Move the task next to what it waits for, or widen the range.`, line: b.line });
    }

    // milestone dates: the first spot that clears every connector, bar and earlier date
    const bounds: Frame = { x: x0 - 8, y: axisY + 2, w: WIDTH - 2 - (x0 - 8), h: bottom - axisY - 2 };
    const dateBoxes: Frame[] = [];
    const dates = new Map<string, string>();
    for (const t of b.tasks) {
      if (!t.milestone) continue;
      const cx = x(t.start), cy = mid(rows.get(t.id)!), date = dayLabel(t.start, years), w = boldWidth(date, tag);
      const up = cy - DIAMOND - 3, below = cy + DIAMOND + tag * 0.75 + 3;
      const cands: { x: number; y: number; anchor: "start" | "end" }[] = [
        { x: cx + DIAMOND + 6, y: cy + tag * 0.35, anchor: "start" },
        { x: cx - DIAMOND - 6, y: cy + tag * 0.35, anchor: "end" },
        { x: cx + 4, y: up, anchor: "start" },
        { x: cx + 4, y: below, anchor: "start" },
        { x: cx - 4, y: up, anchor: "end" },
        { x: cx - 4, y: below, anchor: "end" },
      ];
      let best = cands[0], bestBox: Frame | undefined, bestScore = Infinity;
      cands.forEach((c, i) => {
        const box = { x: c.anchor === "start" ? c.x : c.x - w, y: c.y - tag * 0.75, w, h: tag };
        let score = i;
        if (box.x < bounds.x || box.x + box.w > bounds.x + bounds.w || box.y < bounds.y || box.y + box.h > bounds.y + bounds.h) score += 1000;
        for (const sg of segs) if (segHits(sg, box, 2)) score += 100;
        for (const o of [...shapes.values(), ...dateBoxes]) if (boxHits(box, o)) score += 100;
        if (score < bestScore) { best = c; bestBox = box; bestScore = score; }
      });
      dateBoxes.push(bestBox!);
      dates.set(t.id, text(best.x, best.y, date, "x-value-label x-gantt-date", best.anchor));
    }

    const tracked = b.tasks.some((t) => t.progress !== undefined);
    let outlined = 0;
    const ghosts = new Map<string, Frame>();
    // vertical rules down the plot: today and the reference lines
    const rules = [...(b.today !== undefined ? [x(b.today + 0.5)] : []), ...b.marks.map((m) => x(m.at))];
    const taskMarks = b.tasks.map((t) => {
      const row = rows.get(t.id)!, cy = mid(row), f = shapes.get(t.id)!;
      const label = row.lines.map((l, i) => text(pad, lineY(row, i, lh, px), l, "x-mark-label")).join("");
      let shape: string;
      if (t.milestone) {
        const cx = x(t.start);
        shape = `<path class="x-mark-shape" d="M${num(cx)},${num(cy - DIAMOND)} L${num(cx + DIAMOND)},${num(cy)} L${num(cx)},${num(cy + DIAMOND)} L${num(cx - DIAMOND)},${num(cy)} Z"/>` + dates.get(t.id)!;
      } else {
        shape = `<rect class="x-mark-shape" x="${num(f.x)}" y="${num(f.y)}" width="${num(f.w)}" height="${BAR_H}" rx="${num(Math.min(theme.radius, BAR_H / 2))}"/>`;
        const pw = (f.w - 8) * (t.progress ?? 0);
        if (pw >= 1) shape += `<rect class="x-gantt-progress" x="${num(f.x + 4)}" y="${num(cy - 3)}" width="${num(pw)}" height="6" rx="2"/>`;
        shape += `<rect class="x-anchor" x="${num(f.x)}" y="${num(f.y)}" width="${num(Math.min(f.w, 24))}" height="${BAR_H}"/>`;
        // slack: how far the bar can slide before the finish moves (shown on selection, always in the full view).
        // One label form on every ghost, the days as the card and table write them ("6 d"); the key names the
        // dashed box. The label sits in the middle, or beside a rule that crosses the middle. A ghost with no clear
        // room for it stays unlabelled: the card has the number.
        if (t.float !== undefined && t.float > 0) {
          const gx = f.x + f.w, gw = x(t.end + t.float) - gx;
          const s = days(t.float), w = textWidth(s, tag, "sans");
          const cuts = rules.filter((rx) => rx > gx && rx < gx + gw);
          const at = [gx + gw / 2, ...cuts.flatMap((rx) => [(gx + rx) / 2, (rx + gx + gw) / 2])].find((lx) => {
            const box = { x: lx - w / 2, y: cy - tag * 0.5, w, h: tag };
            return box.x >= gx + 6 && box.x + w <= gx + gw - 6 && !segs.some((sg) => segHits(sg, box, 2)) &&
              !cuts.some((rx) => rx > box.x - 3 && rx < box.x + w + 3);
          });
          const note = at === undefined ? "" : text(at, cy + tag * 0.35, s, "x-gantt-slack-label", "middle");
          shape += `<g class="x-on-sel x-gantt-slack"><rect class="x-gantt-slack-box" x="${num(gx + 1)}" y="${num(f.y + 0.5)}" width="${num(Math.max(1, gw - 1))}" height="${BAR_H - 1}" rx="${num(Math.min(theme.radius, BAR_H / 2))}"/>${note}</g>`;
          ghosts.set(t.id, { x: gx, y: f.y, w: gw, h: BAR_H });
        }
      }
      const outline = tracked && !t.milestone && t.progress === undefined;
      if (outline) outlined++;
      const attrs = (t.muted ? ` data-muted="true"` : "") + (t.progress !== undefined ? ` data-progress="${Math.round(t.progress * 100)}"` : "") +
        (outline ? ` data-outline="true"` : "") + (t.critical ? ` data-critical="true"` : "") + ` data-nav="${laneOf.get(t.id)},0"`;
      return mark({ id: t.id, label: t.label, value: taskValue(t, years), focal: t.focal, cls: t.milestone ? "x-gantt-task x-gantt-milestone" : "x-gantt-task", attrs }, label + shape);
    }).join("");

    let today = "";
    if (b.today !== undefined) {
      const tx = x(b.today + 0.5);
      const rule = (cls: string) => `<line class="${cls}" x1="${num(tx)}" y1="${num(axisY)}" x2="${num(tx)}" y2="${num(bottom)}"/>`;
      today = mark({ id: b.todayId, label: "Today", value: dayLabel(b.today, years), cls: "x-gantt-today-mark" },
        rule("x-gantt-today-hit") + rule("x-mark-shape x-gantt-today") + text(tx, bottom + 14, "Today", "x-axis-label x-gantt-today-label", "middle"));
    }

    // key: what ink arrows, dashed boxes and outlines mean. The critical path entry is a mark: it selects the path
    // and gives its card somewhere to point (the client never anchors a card on a legend entry).
    const keys: string[] = [];
    const legendY = bottom + (b.today !== undefined ? 22 : 0) + 20;
    let lx = x0;
    const key = (swatch: string, label: string) => {
      const out = `${swatch}${text(lx + 22, legendY + tag * 0.35, label, "x-legend-label")}`;
      lx += 22 + boldWidth(label, tag) + 20;
      return out;
    };
    if (b.critical.length) {
      const path = b.critical.map((cid) => byId.get(cid)!.label).join(" → ");
      const body = key(`<rect class="x-gantt-key-hit" x="${num(lx - 4)}" y="${num(legendY - 9)}" width="${num(30 + boldWidth("Critical path", tag))}" height="18"/>` +
        `<line class="x-mark-shape x-gantt-key-line" x1="${num(lx)}" y1="${num(legendY)}" x2="${num(lx + 16)}" y2="${num(legendY)}"/>`, "Critical path");
      keys.push(mark({ id: b.criticalId, label: "Critical path", value: path, cls: "x-gantt-key x-gantt-crit-key" }, body));
    }
    if (ghosts.size) keys.push(`<g class="x-gantt-key" aria-hidden="true">${key(`<rect class="x-gantt-slack-box" x="${num(lx)}" y="${num(legendY - 5)}" width="16" height="10" rx="2"/>`, "Slack")}</g>`);
    if (outlined) keys.push(`<g class="x-gantt-key" aria-hidden="true">${key(`<rect class="x-gantt-key-outline" x="${num(lx)}" y="${num(legendY - 5)}" width="16" height="10" rx="2"/>`, "No progress yet")}</g>`);
    const legend = keys.length ? `<g class="x-gantt-legend">${keys.join("")}</g>` : "";

    const height = Math.ceil((keys.length ? legendY + tag : bottom + (b.today !== undefined ? 20 : 0)) + pad / 2);
    // a task's marker hangs off the bar and its slack ghost together, so it never lands on its own ghost
    const anchors: Record<string, Frame> = Object.fromEntries(shapes);
    for (const [id, g] of ghosts) anchors[id] = { ...anchors[id], w: g.x + g.w - anchors[id].x };
    const labelBoxes = b.tasks.map((t) => { const r = rows.get(t.id)!; return { x: pad, y: r.y, w: col, h: r.h }; });
    // markers show in the full view, where every slack ghost and its label are drawn too: keep off them, and off
    // the connectors and rules (as 2px strips, so a line counts as something to cover)
    const lines = [
      ...segs.map(([ax, ay, bx, by]) => ({ x: Math.min(ax, bx) - 1, y: Math.min(ay, by) - 1, w: Math.abs(bx - ax) + 2, h: Math.abs(by - ay) + 2 })),
      ...rules.map((rx) => ({ x: rx - 1, y: axisY, w: 2, h: bottom - axisY })),
    ];
    const markers = notes(b, anchors, { obstacles: [...labelBoxes, ...shapes.values(), ...dateBoxes, ...ghosts.values(), ...lines], bounds: { x: 0, y: 0, w: WIDTH, h: height } });

    const deps = plain.length + crit.length;
    const path = b.critical.length ? ` Critical path: ${b.critical.map((cid) => byId.get(cid)!.label).join(", ")}.` : "";
    return svgFigure({
      id: b.id,
      kind: "gantt",
      title: b.title,
      label: "Gantt chart",
      desc: `${b.tasks.length} tasks from ${dayLabel(b.start, true)} to ${dayLabel(b.end - 1, true)}${deps ? `, with ${deps} ${deps === 1 ? "dependency" : "dependencies"}` : ""}.${path}`,
      width: WIDTH,
      height,
      defs: deps ? arrowDefs(b.id) : undefined,
      // connectors over the bars: one that runs past a bar shows passing over it on its halo, never hidden beneath
      body: axis + refs + groupMarks + taskMarks + plain.join("") + crit.join("") + today + legend + markers,
    });
  },

  model(b) {
    const years = crossesYear(b);
    const byId = new Map(b.tasks.map((t) => [t.id, t]));
    const groupOf = groupIndex(b);
    const fin = finishMilestone(b);
    const names = (ids: string[]) => joinList(ids.map((i) => byId.get(i)!.label));
    const critEdges = b.tasks.flatMap((s) => s.after.filter((pid) => tight(byId.get(pid)!, s)).map((pid) => edgeId(pid, s.id)));
    const elements: Record<string, ElementInfo> = {};

    for (const t of b.tasks) {
      const g = groupOf.get(t.id);
      const facts: Fact[] = [{ k: "Slack", v: slackText(t), raw: t.float }];
      if (t.progress !== undefined) facts.push({ k: "Done", v: pct(t.progress * 100), raw: Math.round(t.progress * 100) });
      if (b.today !== undefined && !t.milestone && t.progress !== undefined && t.progress < 1) {
        if (b.today >= t.end) facts.push({ k: "Status", v: `late · was due ${dayLabel(t.end - 1, years)}`, tone: "down" });
        else if (b.today >= t.start) facts.push({ k: "Time gone", v: pct(((b.today - t.start) / (t.end - t.start)) * 100) });
        else facts.push({ k: "Starts", v: `in ${days(t.start - b.today)}` });
      }
      // the end date is in the value; the fact says how it sits against the finishing milestone
      if (fin && t !== fin && !t.milestone) {
        const gap = fin.start - (t.end - 1);
        facts.push({ k: "Ends", v: gap > 0 ? `${days(gap)} before ${fin.label}` : gap === 0 ? `on ${fin.label} day` : `${days(-gap)} after ${fin.label}`, ref: fin.id });
      }
      if (t === fin && b.critical.length) {
        facts.push({ k: "Critical path", v: `${b.critical.length} tasks · ${days(b.finish! - byId.get(b.critical[0])!.start)}`, ref: b.criticalId });
      }
      // the whole chain it sits in stays readable: everything upstream and downstream, and the arrows between them
      const chain = new Set([...closure(byId, t.id, "after"), ...closure(byId, t.id, "next")]);
      const direct = new Set([...t.after, ...t.next]);
      const inChain = (k: string) => k === t.id || chain.has(k);
      const context = [
        ...(t.critical ? [b.criticalId] : []),
        ...[...chain].filter((k) => !direct.has(k)),
        ...b.tasks.filter((s) => inChain(s.id)).flatMap((s) => s.after.filter(inChain).map((pid) => edgeId(pid, s.id)))
          .filter((e) => !e.startsWith(`${t.id}->`) && !e.endsWith(`->${t.id}`)),
      ];
      const slack = t.float === undefined ? "not linked to other tasks" : t.float <= 0 ? "no slack, on the critical path" : `${days(t.float)} of slack`;
      const info = itemInfo({
        id: t.id, label: t.label, figure: b.id, kind: t.milestone ? "milestone" : "task", value: taskValue(t, years, false),
        about: t.about, pos: t.critical ? "critical" : undefined, crumb: g ? [g.id] : undefined,
        facts: factList(facts),
        links: [{ rel: "Waits for", ids: t.after }, { rel: "Blocks", ids: t.next }],
        context,
        say: `${t.label}, ${taskValue(t, years)}, ${slack}`,
      });
      info.type = "node";
      elements[t.id] = info;
    }

    for (const g of b.groups) {
      const [lo, hi] = groupRange(g, byId);
      const members = g.members.map((m) => byId.get(m)!);
      const onPath = g.members.filter((m) => byId.get(m)!.critical);
      const tracked = members.filter((t) => t.progress !== undefined);
      const work = tracked.reduce((n, t) => n + (t.end - t.start), 0);
      const done = work ? tracked.reduce((n, t) => n + t.progress! * (t.end - t.start), 0) / work : undefined;
      elements[g.id] = groupInfo({
        id: g.id, label: g.label, figure: b.id, members: g.members, kind: "group", value: spanLabel(lo, hi, years),
        facts: [
          { k: "Tasks", v: String(members.length) },
          { k: "Length", v: days(hi - lo) },
          { k: "Critical", v: onPath.length ? names(onPath) : "none" },
          ...(done !== undefined ? [{ k: "Done", v: `${pct(done * 100)} of its planned days`, raw: Math.round(done * 100) }] : []),
        ],
        links: [{ rel: "On the critical path", ids: onPath }],
        say: `${g.label}, ${members.length} tasks, ${spanLabel(lo, hi, years)}`,
      });
    }

    for (const s of b.tasks) {
      for (const pid of s.after) {
        const p = byId.get(pid)!, eid = edgeId(pid, s.id), hot = tight(p, s), gap = s.start - p.end;
        elements[eid] = {
          id: eid, type: "edge", label: "", kind: "flow", figure: b.id, from: pid, to: s.id,
          facts: [{ k: "Wait", v: gap <= 0 ? "none: starts as soon as it can" : `${days(gap)} idle` }],
          ...(hot ? { pos: "critical" } : {}),
          say: `${s.label} waits for ${p.label}${hot ? ", on the critical path" : ""}`,
        };
      }
    }

    if (b.critical.length) {
      const first = byId.get(b.critical[0])!;
      const open = b.critical.filter((cid) => { const t = byId.get(cid)!; return !t.milestone && (t.progress ?? 0) < 1; });
      const path = b.critical.map((cid) => byId.get(cid)!.label).join(" → ");
      elements[b.criticalId] = groupInfo({
        id: b.criticalId, label: "Critical path", figure: b.id, members: [...b.critical, ...critEdges], kind: "path", value: path,
        facts: [
          { k: "Length", v: `${days(b.finish! - first.start)} · ${spanLabel(first.start, b.finish! + (fin ? 1 : 0), years)}` },
          { k: "Open", v: open.length ? names(open) : "none", ...(open.length ? { ref: open[0] } : {}) },
          { k: "Tasks", v: `${b.critical.length} of ${b.tasks.length}` },
        ],
        say: `Critical path: ${path}. No slack anywhere on it.`,
      });
    }

    if (b.today !== undefined) {
      const now = b.today;
      const late = b.tasks.filter((t) => !t.milestone && t.progress !== undefined && t.progress < 1 && t.end <= now);
      const busy = b.tasks.filter((t) => !t.milestone && t.start <= now && now < t.end && (t.progress ?? 0) < 1);
      const next = b.tasks.filter((t) => t.start > now).sort((p, q) => p.start - q.start)[0];
      const n = (k: number, w: string) => `${k} task${k === 1 ? "" : "s"} ${w}`;
      elements[b.todayId] = itemInfo({
        id: b.todayId, label: "Today", figure: b.id, kind: "today", value: dayLabel(now, years),
        related: [...late, ...busy].map((t) => t.id),
        facts: [
          { k: "Late", v: late.length ? names(late.map((t) => t.id)) : "none", ...(late.length ? { ref: late[0].id } : {}) },
          { k: "In progress", v: busy.length ? names(busy.map((t) => t.id)) : "none" },
          ...(next ? [{ k: "Starts next", v: `${next.label} · ${dayLabel(next.start, years)}`, ref: next.id }] : []),
        ],
        say: `${dayLabel(now, years)}: ${n(late.length, "late")}, ${busy.length} in progress`,
      });
    }
    return { elements };
  },

  reading(b) {
    const parts = ["Each bar runs from a task's first day to its last, and an arrow points from a task to the one that waits for it."];
    const more: string[] = [];
    if (b.critical.length) more.push("ink arrows are the critical path, where a day lost moves the finish");
    if (b.tasks.some((t) => !t.milestone && (t.float ?? 0) > 0)) more.push("a dashed box after a bar is how far it can slip before it does");
    if (b.tasks.some((t) => t.progress !== undefined)) more.push("a bar's dark core is the share done, and an outlined bar reports no progress yet");
    if (b.today !== undefined) more.push("the dashed rule is today");
    if (more.length) parts.push(`${more.join("; ").replace(/^./, (c) => c.toUpperCase())}.`);
    return parts.join(" ");
  },

  table(b) {
    const years = crossesYear(b);
    const byId = new Map(b.tasks.map((t) => [t.id, t]));
    const groupOf = groupIndex(b);
    const phases = b.groups.length > 0, tracked = b.tasks.some((t) => t.progress !== undefined);
    const head = ["Task", ...(phases ? ["Phase"] : []), "Start", "End", "Days", ...(tracked ? ["Done"] : []), "Waits for", "Slack"];
    const rows = b.tasks.map((t) => [
      t.label,
      ...(phases ? [groupOf.get(t.id)?.label ?? ""] : []),
      dayLabel(t.start, years),
      t.milestone ? dayLabel(t.start, years) : dayLabel(t.end - 1, years),
      t.milestone ? "0" : String(t.end - t.start),
      ...(tracked ? [t.progress === undefined ? "" : pct(t.progress * 100)] : []),
      t.after.map((p) => byId.get(p)!.label).join(", "),
      slackText(t),
    ]);
    return { head, rows } satisfies DataTable;
  },
};
