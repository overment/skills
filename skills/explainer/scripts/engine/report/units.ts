// Units for the report genre: clock times, offsets and anchored times on one ms scale; durations, sizes,
// percentages and ranges as quantities; before → after deltas with a tone. Pure functions, no DOM.
import { fmt } from "../kit.ts";
import { SpecError, type Tone } from "../types.ts";

const MINUS = "−";
const DAY = 86_400_000;

// ---------- durations ----------

const TIME_UNITS: Record<string, number> = {
  ns: 1e-6, "µs": 1e-3, us: 1e-3, ms: 1,
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hour: 3_600_000, hours: 3_600_000,
};
const SIZE_UNITS: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

const DUR_PART = /(\d+(?:\.\d+)?)\s*(ns|µs|us|ms|seconds?|secs?|s|minutes?|mins?|min|m|hours?|hr|h)(?![a-z])/gy;

/** "3.5 s", "800ms", "1m30s", "2 min" → ms. A bare number counts seconds. Undefined when it is not a duration. */
export function durationMs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v * 1000;
  if (typeof v !== "string") return undefined;
  const s = v.trim().replace(/^≈\s*/, "");
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s) * 1000;
  DUR_PART.lastIndex = 0;
  let total = 0, at = 0, parts = 0;
  while (at < s.length) {
    DUR_PART.lastIndex = at;
    const m = DUR_PART.exec(s);
    if (!m) return undefined;
    total += Number(m[1]) * TIME_UNITS[m[2]];
    at = DUR_PART.lastIndex;
    while (s[at] === " ") at++;
    parts++;
  }
  return parts ? total : undefined;
}

export function parseDuration(v: unknown, what: string, line: number): number {
  const ms = durationMs(v);
  if (ms === undefined || ms < 0) throw new SpecError(`${what} must be a duration like 3.5 s, 800 ms or 1m30s, got ${JSON.stringify(v)}.`, line);
  return ms;
}

/** Up to `digits` decimals, no trailing zeros: 3.5, 12, 0.8, 1,200. */
function short(v: number, digits = 1): string {
  return Number(v.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** 0.8 → "0.8 ms", 3500 → "3.5 s", 125000 → "2 min 5 s". */
export function fmtDuration(ms: number): string {
  const a = Math.abs(ms), sign = ms < 0 ? MINUS : "";
  if (a === 0) return "0 s";
  if (a < 1) return `${sign}${short(a, 2)} ms`;
  if (a < 1000) return `${sign}${short(a, a < 10 ? 1 : 0)} ms`;
  if (a < 100_000) return `${sign}${short(a / 1000)} s`;
  if (a < 3_600_000) {
    const m = Math.floor(a / 60_000), s = Math.round((a % 60_000) / 1000);
    return `${sign}${m} min${s ? ` ${s} s` : ""}`;
  }
  const h = Math.floor(a / 3_600_000), m = Math.round((a % 3_600_000) / 60_000);
  return `${sign}${h} h${m ? ` ${m} min` : ""}`;
}

/** Always signed: "+12 s", "+0.6 s", "−400 ms". */
export function fmtOffset(ms: number): string {
  if (Math.abs(ms) < 0.05) return "+0 s";
  return `${ms < 0 ? MINUS : "+"}${fmtDuration(Math.abs(ms))}`;
}

// ---------- clock times ----------

/** A time as written: absolute (clock or ISO), relative to t0, or relative to another event. */
export type TimeSpec =
  | { kind: "clock"; ms: number }                     // ms since midnight, "10:08:57.2"
  | { kind: "epoch"; ms: number; offset: number }     // ISO date-time; offset in minutes east of UTC
  | { kind: "rel"; ms: number }                       // "+13.2s" from t0
  | { kind: "ref"; id: string; ms: number };          // "e429+2s"

const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(Z|[+-]\d{2}:?\d{2})?$/;
const REF = /^([A-Za-z_][\w-]*?)\s*(?:([+-])\s*(.+))?$/;

export function parseTime(v: unknown, what: string, line: number): TimeSpec {
  const bad = () => new SpecError(`${what} must be a clock time (10:08:57.2), an offset (+13.2s), an event plus an offset (e429+2s) or an ISO date-time, got ${JSON.stringify(v)}.`, line);
  if (v instanceof Date && Number.isFinite(v.getTime())) return { kind: "epoch", ms: v.getTime(), offset: 0 };
  if (typeof v === "number" && Number.isFinite(v)) return { kind: "rel", ms: v * 1000 };
  if (typeof v !== "string" || !v.trim()) throw bad();
  const s = v.trim();
  let m = CLOCK.exec(s);
  if (m) {
    const h = Number(m[1]), min = Number(m[2]), sec = m[3] ? Number(m[3]) : 0;
    if (h > 23 || min > 59 || sec >= 60) throw bad();
    return { kind: "clock", ms: Math.round(((h * 60 + min) * 60 + sec) * 1000) };
  }
  m = ISO.exec(s);
  if (m) {
    const [, y, mo, d, h, min, sec, zone] = m;
    const offset = !zone || zone === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
    const utc = Date.UTC(+y, +mo - 1, +d, +h, +min, 0) + Math.round(Number(sec ?? 0) * 1000) - offset * 60_000;
    if (!Number.isFinite(utc)) throw bad();
    return { kind: "epoch", ms: utc, offset };
  }
  if (/^[+-]/.test(s)) {
    const ms = durationMs(s.slice(1).trim());
    if (ms === undefined) throw bad();
    return { kind: "rel", ms: s[0] === "-" ? -ms : ms };
  }
  m = REF.exec(s);
  if (m) {
    const [, id, sign, rest] = m;
    if (!sign) return { kind: "ref", id, ms: 0 };
    const ms = durationMs(rest);
    if (ms === undefined) throw bad();
    return { kind: "ref", id, ms: sign === "-" ? -ms : ms };
  }
  throw bad();
}

/** The t0 every time is measured from, and how to print a point on that scale as a clock time. */
export interface Clock {
  /** Absolute base: ms since midnight (clock) or epoch ms; undefined when every time is relative. */
  base?: { kind: "clock" | "epoch"; ms: number; offset: number };
  /** "10:08:57.2" for ms after t0, or undefined when there is no absolute base. */
  at(ms: number): string | undefined;
}

export function fmtClock(msOfDay: number, fraction: boolean): string {
  const t = ((Math.round(msOfDay) % DAY) + DAY) % DAY;
  const h = Math.floor(t / 3_600_000), m = Math.floor((t % 3_600_000) / 60_000), s = (t % 60_000) / 1000;
  const pad = (n: number) => String(n).padStart(2, "0");
  const sec = fraction ? `${pad(Math.floor(s))}.${Math.round((s % 1) * 10) % 10}` : pad(Math.floor(s));
  return `${pad(h)}:${pad(m)}:${sec}`;
}

/**
 * Resolves every spec to ms after t0. t0 is `start` when given, else the earliest absolute time, else 0.
 * Clock times next to an ISO t0 fall on t0's calendar day in t0's offset. Anchors resolve recursively.
 */
export function resolveTimes(specs: Map<string, TimeSpec>, start: TimeSpec | undefined, what: string, line: number): { times: Map<string, number>; clock: Clock } {
  const absolutes = [...specs.values(), ...(start ? [start] : [])].filter((s): s is Extract<TimeSpec, { kind: "clock" | "epoch" }> => s.kind === "clock" || s.kind === "epoch");
  const epoch = absolutes.find((s) => s.kind === "epoch") as Extract<TimeSpec, { kind: "epoch" }> | undefined;
  const offset = epoch?.offset ?? 0;
  // absolute ms on one axis: epoch when any ISO time is present, else ms since midnight
  const dayStart = epoch ? Math.floor((epoch.ms + offset * 60_000) / DAY) * DAY - offset * 60_000 : 0;
  const abs = (s: Extract<TimeSpec, { kind: "clock" | "epoch" }>) => (s.kind === "epoch" || !epoch ? s.ms : dayStart + s.ms);
  let base: Clock["base"];
  if (start && (start.kind === "clock" || start.kind === "epoch")) base = { kind: epoch ? "epoch" : "clock", ms: abs(start), offset };
  else if (absolutes.length) base = { kind: epoch ? "epoch" : "clock", ms: Math.min(...absolutes.map(abs)), offset };
  const shift = start && (start.kind === "rel" || start.kind === "ref") ? start.ms : 0;
  if (start?.kind === "ref") throw new SpecError(`${what}: \`start\` must be a clock time, an ISO date-time or an offset, not an event.`, line);

  const times = new Map<string, number>();
  const visiting = new Set<string>();
  const resolve = (id: string): number => {
    const known = times.get(id);
    if (known !== undefined) return known;
    const s = specs.get(id);
    if (!s) throw new SpecError(`${what}: time refers to "${id}", which is not an event in this block.`, line, "ref-exists");
    if (visiting.has(id)) throw new SpecError(`${what}: the time of "${id}" refers back to itself through other events.`, line);
    visiting.add(id);
    let t: number;
    if (s.kind === "ref") t = resolve(s.id) + s.ms;
    else if (s.kind === "rel") t = s.ms - shift;
    else {
      if (!base) throw new SpecError(`${what}: an absolute time needs an absolute \`start\`.`, line);
      t = abs(s) - base.ms;
    }
    visiting.delete(id);
    times.set(id, t);
    return t;
  };
  for (const id of specs.keys()) resolve(id);
  /** Only times with a fractional second print one. */
  const clock: Clock = {
    base,
    at: (ms) => {
      if (!base) return undefined;
      const t = base.ms + ms;
      const ofDay = base.kind === "epoch" ? t + base.offset * 60_000 : t;
      return fmtClock(ofDay, Math.round(t) % 1000 !== 0);
    },
  };
  return { times, clock };
}

// ---------- quantities ----------

export type Dim = "time" | "size" | "pct" | "count";

/** A value as written in a table cell. `lo`/`hi` are in base units (ms, bytes, %, count); equal for a single value. */
export interface Quantity { lo: number; hi: number; dim: Dim; unit: string; approx: boolean }

const NUM = String.raw`\d[\d,]*(?:\.\d+)?|\.\d+`;
const QTY = new RegExp(String.raw`^([≈~]\s*)?(${NUM})\s*(?:([a-zA-Zµ%]+)\s*)?(?:(?:–|—|-|to)\s*(${NUM})\s*)?([a-zA-Zµ%]+)?$`);

function unitScale(unit: string): { dim: Dim; k: number } | undefined {
  if (!unit) return { dim: "count", k: 1 };
  if (unit === "%") return { dim: "pct", k: 1 };
  if (unit in TIME_UNITS) return { dim: "time", k: TIME_UNITS[unit] };
  const up = unit.toUpperCase();
  if (up in SIZE_UNITS) return { dim: "size", k: SIZE_UNITS[up] };
  if (up === "KIB" || up === "MIB" || up === "GIB") return { dim: "size", k: SIZE_UNITS[up[0] + "B"] };
  return undefined;
}

/**
 * "0.73–1.72 s" → {lo: 730, hi: 1720, dim: "time"}, "1.4 ms", "12%", "4 KB", "307". Undefined for words
 * ("same frame") or unknown units, which the table shows as written with a neutral tone.
 */
export function parseQuantity(v: unknown): Quantity | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return { lo: v, hi: v, dim: "count", unit: "", approx: false };
  if (typeof v !== "string") return undefined;
  const m = QTY.exec(v.trim());
  if (!m) return undefined;
  const [, approx, a, unitA, b, unitB] = m;
  if (unitA && b && unitB && unitA !== unitB) {
    // "1 s–2 min": each end in its own unit
    const sa = unitScale(unitA), sb = unitScale(unitB);
    if (!sa || !sb || sa.dim !== sb.dim) return undefined;
    const lo = Number(a.replace(/,/g, "")) * sa.k, hi = Number(b.replace(/,/g, "")) * sb.k;
    return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), dim: sa.dim, unit: unitB, approx: !!approx };
  }
  const unit = unitB ?? unitA ?? "";
  if (unitA && !b && unitB) return undefined; // "3 s ms"
  const scale = unitScale(unit);
  if (!scale) return undefined;
  const lo = Number(a.replace(/,/g, "")) * scale.k;
  const hi = b ? Number(b.replace(/,/g, "")) * scale.k : lo;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), dim: scale.dim, unit, approx: !!approx };
}

// ---------- deltas ----------

export type Better = "lower" | "higher";

export interface Delta {
  /** after/before multiples compared end to end (lo with lo, hi with hi), as improvement factors ≥ 1 when better. */
  ratio?: [number, number];
  /** "≈900–2,150× faster", "12% lower", "no clear change", "—". */
  words: string;
  tone: { before: Tone; after: Tone };
  direction: "better" | "worse" | "same" | "unknown";
}

const NEUTRAL = { before: "neutral", after: "neutral" } as const;

/** Rounds a multiple for print: one decimal below 10, else to the nearest shared step of 5 × 10^(k−1). */
export function fmtRatioRange(lo: number, hi: number): string {
  if (hi < 10) {
    const a = short(lo), b = short(hi);
    return a === b ? a : `${a}–${b}`;
  }
  const k = Math.floor(Math.log10(Math.max(lo, 1)));
  const step = k >= 2 ? 5 * 10 ** (k - 1) : 1;
  const a = Math.max(step, Math.round(lo / step) * step), b = Math.max(a, Math.round(hi / step) * step);
  const approx = a !== lo || b !== hi ? "≈" : "";
  return a === b ? `${approx}${fmt(a, "int")}` : `${approx}${fmt(a, "int")}–${fmt(b, "int")}`;
}

function word(dim: Dim, down: boolean): string {
  if (dim === "time") return down ? "faster" : "slower";
  if (dim === "size") return down ? "smaller" : "larger";
  return down ? "lower" : "higher";
}

/**
 * Change from `before` to `after`. Ranges are compared end to end. A clear move in the `better`
 * direction tones before warn and after ok; a clear move the other way tones after danger.
 */
export function delta(before: Quantity | undefined, after: Quantity | undefined, better: Better | undefined): Delta {
  if (!before || !after || before.dim !== after.dim) return { words: "—", tone: NEUTRAL, direction: "unknown" };
  const down = after.hi < before.lo, up = after.lo > before.hi;
  if (!down && !up) {
    const same = after.lo === before.lo && after.hi === before.hi;
    return { words: same ? "no change" : "no clear change", tone: NEUTRAL, direction: "same" };
  }
  const improved = better === undefined ? undefined : (better === "lower") === down;
  const tone = improved === undefined ? NEUTRAL : improved ? { before: "warn", after: "ok" } as const : { before: "neutral", after: "danger" } as const;
  const direction = improved === undefined ? "unknown" : improved ? "better" : "worse";
  const w = word(before.dim, down);
  if (down && after.hi === 0) return { words: `${MINUS}100%, down to 0`, tone, direction };
  const lo = down ? before.lo / after.lo : after.lo / before.lo;
  const hi = down ? before.hi / after.hi : after.hi / before.hi;
  const ratio: [number, number] = [Math.min(lo, hi), Math.max(lo, hi)];
  if (Number.isFinite(ratio[1]) && ratio[1] >= 1.5) return { ratio, words: `${fmtRatioRange(ratio[0], ratio[1])}× ${w}`, tone, direction };
  const mid = (q: Quantity) => (q.lo + q.hi) / 2;
  const pct = Math.abs((mid(after) - mid(before)) / (mid(before) || 1)) * 100;
  return { ratio, words: `${short(pct, 0)}% ${w}`, tone, direction };
}
