// Venn: 2 or 3 sets as equal circles in the classic layout; every described overlap is its own selectable region.
import {
  BUDGET, SpecError, type BlockModule, type DataTable, type DocModel, type ElementInfo, type Fact, type RawBlock, type ReadingSpec, type RenderContext,
} from "../types.ts";
import {
  NOTE_R, READING_KEYS, esc, factList, fmtUnit, format, idFrom, isObj, itemInfo, list, mark, num, number, parseUnit, readingSpec, seriesSlot,
  share, svgFigure, text, textWidth, wrap, type Format, type Frame,
} from "../kit.ts";
import { allowKeys, entries, joinList, optBool, optString, requireMap, requireString, stringList, type Fields } from "../blocks/util.ts";

interface VennSet { id: string; label: string; size?: number; about?: string; focal: boolean; muted: boolean }

interface VennOverlap {
  id: string;
  sets: string[]; // set ids in declared set order; in a 3-set diagram a pair excludes the third set
  label?: string;
  size?: number;
  about?: string;
  focal: boolean;
}

interface VennBlock extends ReadingSpec {
  type: "venn";
  id: string;
  title?: string;
  line: number;
  format: Format;
  unit?: string;
  sets: VennSet[];
  overlaps: VennOverlap[];
}

interface Pt { x: number; y: number }
interface Geometry { r: number; c: Pt[]; out: Pt[]; height: number }
interface RawOverlap { names: string[]; fields: Fields; where: string }
type Line = { t: string; cls: string };

const GAP = 12;
const LABEL_MAX = 180;
const SYMBOL_UNIT = /^[$€£¥%]$/;
/** Left and right margin: the drawing starts at the column edge, and a selection ring (3px out, 2px wide) never clips. */
const EDGE = 8;
/** A region label keeps this far inside its outline, above, below and to the sides. */
const INSET = 6;
/** A note marker keeps this far off every outline, label and other marker. */
const CLEAR = 6;
/** Scan step for label bands and marker spots. */
const STEP = 2;

function labelOf(v: unknown, what: string, line: number): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  throw new SpecError(`${what} must be text.`, line);
}

function sizeOf(v: unknown, what: string, line: number): number | undefined {
  if (v === undefined) return undefined;
  const n = number(v, what, line);
  if (n < 0) throw new SpecError(`${what} must be 0 or more; got ${n}.`, line);
  return n;
}

function claimId(explicit: string | undefined, label: string, taken: Set<string>, prefix: string, where: string, line: number): string {
  if (explicit === undefined) return idFrom(label, taken, prefix);
  if (taken.has(explicit)) throw new SpecError(`${where}: id "${explicit}" is used twice.`, line, "id-unique");
  taken.add(explicit);
  return explicit;
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

// ---------- overlaps: { sets, label }, "a & b: label", { "a & b": label } or a map ----------

function splitNames(key: string): string[] {
  return key.split("&").map((s) => s.trim()).filter(Boolean);
}

function shorthand(key: string, value: unknown, where: string, line: number): RawOverlap {
  const names = splitNames(key);
  if (value === null || value === undefined) return { names, fields: {}, where };
  if (typeof value === "string" || typeof value === "number") return { names, fields: { label: String(value) }, where };
  if (isObj(value)) {
    if (Object.hasOwn(value, "sets")) throw new SpecError(`${where}: name the sets in the key ("${key}") or in \`sets\`, not both.`, line);
    return { names, fields: value, where };
  }
  throw new SpecError(`${where} must be a label or { label, about }.`, line);
}

function rawOverlaps(v: unknown, where: string, line: number): RawOverlap[] {
  if (v === undefined || v === null) return [];
  if (isObj(v)) return Object.entries(v).map(([k, val]) => shorthand(k, val, `${where} overlap "${k}"`, line));
  return list(v, `${where} overlaps`, line).map((item, i) => {
    const ow = `${where} overlap ${i + 1}`;
    if (typeof item === "string") {
      const cut = item.indexOf(":");
      const label = cut < 0 ? "" : item.slice(cut + 1).trim();
      return { names: splitNames(cut < 0 ? item : item.slice(0, cut)), fields: label ? { label } : {}, where: ow };
    }
    if (isObj(item)) {
      if (Object.hasOwn(item, "sets")) return { names: stringList(item.sets, `${ow} sets`, line), fields: item, where: ow };
      const keys = Object.keys(item);
      if (keys.length === 1 && keys[0].includes("&")) return shorthand(keys[0], item[keys[0]], ow, line);
    }
    throw new SpecError(`${ow} must be { sets: [a, b], label, about } or "a & b: label".`, line);
  });
}

// ---------- geometry ----------

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const pt = (p: Pt) => `${num(p.x)},${num(p.y)}`;
function unit(to: Pt, from: Pt): Pt {
  const d = dist(to, from) || 1;
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

/** Both crossing points of two circles of radius r. */
function cross(a: Pt, b: Pt, r: number): [Pt, Pt] {
  const d = dist(a, b);
  const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2));
  const m = mid(a, b), ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  return [{ x: m.x - uy * h, y: m.y + ux * h }, { x: m.x + uy * h, y: m.y - ux * h }];
}

/** Arc along circle (c, r) from `from` to `to`, going the way whose midpoint satisfies `keep`. */
function arcTo(from: Pt, to: Pt, c: Pt, r: number, keep: (p: Pt) => boolean): string {
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  let delta = Math.atan2(to.y - c.y, to.x - c.x) - a0;
  while (delta <= 0) delta += 2 * Math.PI;
  while (delta > 2 * Math.PI) delta -= 2 * Math.PI;
  const m = a0 + delta / 2;
  const forward = keep({ x: c.x + r * Math.cos(m), y: c.y + r * Math.sin(m) });
  const sweep = forward ? delta : 2 * Math.PI - delta;
  return `A${num(r)},${num(r)} 0 ${sweep > Math.PI ? 1 : 0} ${forward ? 1 : 0} ${pt(to)}`;
}

/** The classic layout around the vertical line x = cx; the crop picks cx so the leftmost ink sits at the column edge. */
function geometry(n: number, pad: number, below: number, cx: number): Geometry {
  if (n === 2) {
    const r = 150, cy = pad + r + GAP;
    return { r, c: [{ x: cx - r / 2, y: cy }, { x: cx + r / 2, y: cy }], out: [{ x: -1, y: 0 }, { x: 1, y: 0 }], height: cy + r + GAP + pad };
  }
  const r = 130, h = (r * Math.sqrt(3)) / 2, y0 = pad + r + GAP;
  const c = [{ x: cx - r / 2, y: y0 }, { x: cx + r / 2, y: y0 }, { x: cx, y: y0 + h }];
  const g = { x: cx, y: y0 + h / 3 };
  return { r, c, out: c.map((p) => unit(p, g)), height: y0 + h + r + GAP + below + pad };
}

/** Exact outline of the region inside exactly `members`, and its visual middle. */
function region(members: number[], g: Geometry): { d: string; at: Pt } {
  const { r, c } = g;
  const has = new Set(members);
  const arc = (from: Pt, to: Pt, on: number) =>
    arcTo(from, to, c[on], r, (p) => c.every((o, k) => k === on || (dist(p, o) < r) === has.has(k)));
  if (c.length === 2) {
    const [p, q] = cross(c[0], c[1], r);
    return { d: `M${pt(p)}${arc(p, q, 0)}${arc(q, p, 1)}Z`, at: mid(c[0], c[1]) };
  }
  const third = (i: number, j: number) => 3 - i - j;
  const near = (i: number, j: number, inner: boolean) => {
    const [p, q] = cross(c[i], c[j], r);
    const k = c[third(i, j)];
    return (dist(p, k) <= dist(q, k)) === inner ? p : q;
  };
  if (members.length === 3) {
    const ab = near(0, 1, true), bc = near(1, 2, true), ca = near(0, 2, true);
    const at = { x: (c[0].x + c[1].x + c[2].x) / 3, y: (c[0].y + c[1].y + c[2].y) / 3 };
    return { d: `M${pt(ab)}${arc(ab, bc, 1)}${arc(bc, ca, 2)}${arc(ca, ab, 0)}Z`, at };
  }
  const [i, j] = members;
  const k = third(i, j);
  const o = near(i, j, false), ik = near(i, k, true), jk = near(j, k, true);
  const toward = unit(mid(c[i], c[j]), c[k]);
  const edge = { x: c[k].x + toward.x * r, y: c[k].y + toward.y * r };
  return { d: `M${pt(o)}${arc(o, ik, i)}${arc(ik, jk, k)}${arc(jk, o, j)}Z`, at: mid(o, edge) };
}

/** The widest piece of the region inside exactly `members` along the horizontal line y, or null where it has none. */
function chord(members: number[], g: Geometry, y: number): [number, number] | null {
  let lo = -Infinity, hi = Infinity;
  for (const k of members) {
    const dy = y - g.c[k].y;
    if (Math.abs(dy) >= g.r) return null;
    const h = Math.sqrt(g.r * g.r - dy * dy);
    lo = Math.max(lo, g.c[k].x - h);
    hi = Math.min(hi, g.c[k].x + h);
  }
  let pieces: [number, number][] = lo < hi ? [[lo, hi]] : [];
  g.c.forEach((c, k) => {
    const dy = y - c.y;
    if (members.includes(k) || Math.abs(dy) >= g.r) return;
    const h = Math.sqrt(g.r * g.r - dy * dy);
    pieces = pieces.flatMap(([p, q]): [number, number][] => [[p, Math.min(q, c.x - h)], [Math.max(p, c.x + h), q]]).filter(([p, q]) => q > p);
  });
  return pieces.reduce<[number, number] | null>((best, p) => (!best || p[1] - p[0] > best[1] - best[0] ? p : best), null);
}

/**
 * Where a label block `h` tall reads best in a region: centred on its widest horizontal band. Every line the block
 * covers, plus the inset above and below it, must hold the band, so the text never runs into an outline.
 * Among equally wide bands the one nearest the region's middle wins. `room` is the width the text may use.
 */
function widest(members: number[], g: Geometry, h: number, near: number): { x: number; y: number; room: number } {
  const top = Math.max(...members.map((k) => g.c[k].y - g.r)), bottom = Math.min(...members.map((k) => g.c[k].y + g.r));
  let best = { x: g.c[members[0]].x, y: near, room: -Infinity };
  for (let y = top; y <= bottom; y += STEP) {
    const y0 = y - h / 2 - INSET, y1 = y + h / 2 + INSET;
    let lo = -Infinity, hi = Infinity;
    for (let t = y0; lo < hi; t = Math.min(t + STEP, y1)) {
      const ch = chord(members, g, t);
      if (!ch) { lo = hi = 0; break; }
      lo = Math.max(lo, ch[0]);
      hi = Math.min(hi, ch[1]);
      if (t >= y1) break;
    }
    const room = hi - lo - 2 * INSET;
    if (room > best.room + 0.5 || (room > best.room - 0.5 && Math.abs(y - near) < Math.abs(best.y - near))) best = { x: (lo + hi) / 2, y, room };
  }
  return best;
}

interface Target { box: Frame; members?: number[] }

const hits = (a: Frame, b: Frame, pad: number) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** Distance from p to the nearest point of box a (0 inside it). */
const reach = (p: Pt, a: Frame) => Math.hypot(Math.max(a.x - p.x, 0, p.x - a.x - a.w), Math.max(a.y - p.y, 0, p.y - a.y - a.h));

/**
 * Note markers (the same markup as kit.notes()) beside the label of each note's target, never on an outline or
 * any label. A region's marker stays inside its region, a set's outside every circle, each on the nearest clear
 * spot to its label, level with it where the distance ties. Where no such spot exists the region rule is dropped
 * first, then the outline rule; a marker never sits on a label or another marker while any spot is free.
 */
function vennNotes(b: VennBlock, g: Geometry, targets: Record<string, Target>, labels: Frame[], height: number): { svg: string; spots: Pt[] } {
  const placed: Pt[] = [];
  const parts: string[] = [];
  const ring = NOTE_R + CLEAR;
  const offRings = (p: Pt) => g.c.every((c) => Math.abs(dist(p, c) - g.r) >= ring);
  const inside = (p: Pt, members: number[]) => g.c.every((c, k) => (dist(p, c) < g.r) === members.includes(k));
  const free = (p: Pt) => {
    const box = { x: p.x - NOTE_R, y: p.y - NOTE_R, w: 2 * NOTE_R, h: 2 * NOTE_R };
    return box.y >= 0 && box.y + box.h <= height && labels.every((l) => !hits(box, l, CLEAR)) && placed.every((q) => dist(p, q) >= 2 * NOTE_R + CLEAR);
  };
  (b.notes ?? []).forEach((note, i) => {
    const id = note.on.find((x) => targets[x]);
    if (!id) return;
    const { box, members } = targets[id];
    const cy = box.y + box.h / 2;
    const tiers: ((p: Pt) => boolean)[] = [
      (p) => offRings(p) && inside(p, members ?? []),
      (p) => offRings(p),
      () => true,
    ];
    let spot: Pt | undefined;
    for (const ok of tiers) {
      let best = Infinity;
      for (let dx = -160; dx <= 160; dx += STEP) {
        for (let dy = -120; dy <= 120; dy += STEP) {
          const p = { x: box.x + box.w / 2 + dx, y: cy + dy };
          if (!free(p) || !ok(p)) continue;
          // nearest to the label (in 4px steps, so the scan grid never decides), then level with it, then to its right
          const score = Math.ceil(reach(p, box) / 4) * 1e6 + Math.abs(dy) * 1e3 - dx;
          if (score < best) { best = score; spot = p; }
        }
      }
      if (spot) break;
    }
    const p = spot ?? { x: box.x + box.w + ring, y: cy };
    placed.push(p);
    parts.push(`<g class="x-note-marker" data-note="${i + 1}" data-for="${esc(note.on.join(" "))}"><circle class="x-note-ring" cx="${num(p.x)}" cy="${num(p.y)}" r="${NOTE_R}"/>` +
      `${text(p.x, p.y + 13 * 0.35, String(i + 1), "x-note-num", "middle")}</g>`);
  });
  return { svg: parts.length ? `<g class="x-notes" data-for="${esc(b.id)}" aria-hidden="true">${parts.join("")}</g>` : "", spots: placed };
}

// ---------- module ----------

const labeler = (b: VennBlock) => (v: number) => fmtUnit(v, b.unit && SYMBOL_UNIT.test(b.unit) ? b.unit : undefined, b.format);

/** How an overlap reads from one of its sets: "∩ Engineering", or "all three" for the centre. */
function partners(b: VennBlock, o: VennOverlap, from: string): string {
  if (o.sets.length === b.sets.length && b.sets.length > 2) return b.sets.length === 3 ? "all three" : "all";
  return `∩ ${o.sets.filter((sid) => sid !== from).map((sid) => b.sets.find((s) => s.id === sid)?.label ?? sid).join(" ∩ ")}`;
}

/** Size of the part of a set outside every overlap, when the set and all its overlaps have sizes. */
function onlySize(b: VennBlock, set: VennSet): number | undefined {
  const mine = b.overlaps.filter((o) => o.sets.includes(set.id));
  if (set.size === undefined || mine.some((o) => o.size === undefined)) return undefined;
  const rest = set.size - mine.reduce((a, o) => a + (o.size ?? 0), 0);
  return rest >= 0 ? rest : undefined;
}

function overlapName(b: VennBlock, o: VennOverlap): string {
  return o.label ?? o.sets.map((sid) => b.sets.find((s) => s.id === sid)?.label ?? sid).join(" & ");
}

function normalize(raw: RawBlock, ctx: RenderContext): VennBlock {
  const line = raw.line;
  const data = requireMap(raw.data, "venn", line);
  allowKeys(data, ["id", "title", "format", "unit", "sets", "overlaps", ...READING_KEYS], "venn", line);
  const id = requireString(data, "id", "venn", line);
  const where = `venn "${id}"`;
  const pairs = entries(data.sets, `${where} sets`, line);
  if (pairs.length < 2 || pairs.length > 3) {
    const why = pairs.length > 3
      ? "Above 3, circles cannot show every overlap; use a matrix of who belongs where."
      : "One set has nothing to overlap with.";
    throw new SpecError(`${where} draws 2 or 3 \`sets\`; got ${pairs.length}. ${why}`, line);
  }
  const taken = new Set([id, `${id}-title`, `${id}-desc`]);
  const sets: VennSet[] = pairs.map(([sid, f]) => {
    const sw = `${where} set "${sid}"`;
    allowKeys(f, ["id", "label", "size", "about", "focal", "muted"], sw, line);
    if (taken.has(sid)) throw new SpecError(`${where}: set "${sid}" is listed twice.`, line, "id-unique");
    taken.add(sid);
    return {
      id: sid,
      label: labelOf(f.label, `${sw} label`, line),
      size: sizeOf(f.size, `${sw} size`, line),
      about: optString(f, "about", sw, line),
      focal: optBool(f, "focal", sw, line),
      muted: optBool(f, "muted", sw, line),
    };
  });

  const index = new Map(sets.map((s, i) => [s.id, i]));
  const known = sets.map((s) => s.id).join(", ");
  const combos = new Set<string>();
  const overlaps: VennOverlap[] = rawOverlaps(data.overlaps, where, line).map(({ names, fields, where: ow }) => {
    allowKeys(fields, ["id", "sets", "label", "size", "about", "focal"], ow, line);
    if (names.length < 2) throw new SpecError(`${ow} needs 2 or more set ids, e.g. "${sets[0].id} & ${sets[1].id}". Sets: ${known}.`, line);
    for (const nm of names) {
      if (!index.has(nm)) throw new SpecError(`${ow}: there is no set "${nm}". Sets: ${known}.`, line, "ref-exists");
    }
    if (new Set(names).size !== names.length) throw new SpecError(`${ow} lists the same set twice.`, line);
    const ordered = [...names].sort((a, c) => index.get(a)! - index.get(c)!);
    const key = ordered.join(" & ");
    if (combos.has(key)) throw new SpecError(`${where}: the overlap ${key} is described twice.`, line, "id-unique");
    combos.add(key);
    return {
      id: claimId(optString(fields, "id", ow, line), ordered.join("-"), taken, `${id}-`, where, line),
      sets: ordered,
      label: fields.label === undefined ? undefined : labelOf(fields.label, `${ow} label`, line),
      size: sizeOf(fields.size, `${ow} size`, line),
      about: optString(fields, "about", ow, line),
      focal: optBool(fields, "focal", ow, line),
    };
  });

  const focal = sets.filter((s) => s.focal).length + overlaps.filter((o) => o.focal).length;
  if (focal > BUDGET.focal) {
    ctx.warn({ rule: "budget-focal", severity: "warn", line, message: `${where} marks ${focal} sets or overlaps focal; keep it to ${BUDGET.focal}.` });
  }
  return {
    type: "venn", id, title: optString(data, "title", where, line), line, format: format(data.format, line), unit: parseUnit(data.unit, line),
    sets, overlaps, ...readingSpec(data, line),
  };
}

function render(b: VennBlock, ctx: RenderContext): string {
  const theme = ctx.theme;
  const px = theme.type.nodeSub;
  const lh = Math.round(Math.max(px, theme.type.tag) * 1.35);
  const cap = px * 0.72;
  const tall = (n: number) => (n ? (n - 1) * lh + cap : 0);
  const f = labeler(b);
  const pad = theme.grid.pad;

  const setLines: Line[][] = b.sets.map((s) => [
    ...wrap(s.label, LABEL_MAX, px, "sans").map((t) => ({ t, cls: "x-mark-label" })),
    ...(s.size === undefined ? [] : [{ t: f(s.size), cls: "x-value-label" }]),
  ]);
  const below = b.sets.length === 3 ? tall(setLines[2].length) : 0;
  const membersOf = (o: VennOverlap) => o.sets.map((sid) => b.sets.findIndex((s) => s.id === sid));

  // Each overlap label sits on the widest band of its region, wrapped to that band's width; found once around
  // x = 0, since cropping only slides the drawing sideways.
  const g0 = geometry(b.sets.length, pad, below, 0);
  const regionText = b.overlaps.map((o) => {
    const members = membersOf(o);
    const value: Line[] = o.size === undefined ? [] : [{ t: f(o.size), cls: "x-value-label" }];
    const near = region(members, g0).at.y;
    const fit = (words: string[]) => widest(members, g0, tall(words.length + value.length), near);
    let words = o.label ? [o.label] : [];
    let spot = fit(words);
    for (let pass = 0; pass < 3 && o.label; pass++) {
      const next = wrap(o.label, Math.max(1, spot.room), px, "sans");
      if (next.join("\n") === words.join("\n")) break;
      words = next;
      spot = fit(words);
    }
    const lines: Line[] = [...words.map((t) => ({ t, cls: "x-mark-label" })), ...value];
    if (words.length > 3 || lines.some((l) => textWidth(l.t, px, "sans") > spot.room)) {
      ctx.warn({ rule: "label-fit", severity: "warn", line: b.line, message: `venn "${b.id}": overlap label "${o.label}" does not fit its region; keep it to 1–2 short words and move the rest to \`about\`.` });
    }
    return { members, lines, spot };
  });

  // Drawn around cx; `lo`/`hi` are the ink's horizontal ends (circles, labels, note markers).
  const draw = (cx: number) => {
    const g = geometry(b.sets.length, pad, below, cx);
    const labels: Frame[] = [];
    const targets: Record<string, Target> = {};
    const setMarks = b.sets.map((s, i) => {
      const c = g.c[i], o = g.out[i];
      const circle = `cx="${num(c.x)}" cy="${num(c.y)}" r="${num(g.r)}"`;
      const name = outside(c.x + o.x * (g.r + GAP), c.y + o.y * (g.r + GAP), o.x, o.y, setLines[i], lh, cap, px);
      labels.push(name.box);
      targets[s.id] = { box: name.box };
      return mark({
        id: s.id, label: s.label, value: s.size === undefined ? undefined : f(s.size),
        series: seriesSlot(i, theme), focal: s.focal, cls: "x-venn-set", attrs: s.muted ? ` data-muted="true"` : "",
      }, `<circle class="x-mark-shape" ${circle}/><circle class="x-series-line x-venn-outline" ${circle}/>${name.svg}`);
    });
    const regionMarks = b.overlaps.map((o, k) => {
      const { members, lines, spot } = regionText[k];
      const x = cx + spot.x, first = spot.y - tall(lines.length) / 2 + cap;
      const w = Math.max(24, ...lines.map((l) => textWidth(l.t, px, "sans")));
      const box = { x: x - w / 2, y: first - cap, w, h: tall(lines.length) || cap };
      labels.push(box);
      targets[o.id] = { box, members };
      const shown = lines.map((l, j) => text(x, first + j * lh, l.t, l.cls, "middle")).join("");
      return mark({ id: o.id, label: overlapName(b, o), value: o.size === undefined ? undefined : f(o.size), focal: o.focal, cls: "x-venn-region" },
        `<path class="x-mark-shape" d="${region(members, g).d}"/>${shown}`);
    });
    const markers = vennNotes(b, g, targets, labels, g.height);
    const xs = [
      ...g.c.flatMap((c) => [c.x - g.r, c.x + g.r]),
      ...labels.flatMap((l) => [l.x, l.x + l.w]),
      ...markers.spots.flatMap((p) => [p.x - NOTE_R, p.x + NOTE_R]),
    ];
    const body = `<g class="x-venn-sets">${setMarks.join("")}</g><g class="x-venn-regions">${regionMarks.join("")}</g>${markers.svg}`;
    return { body, lo: Math.min(...xs), hi: Math.max(...xs), height: g.height };
  };
  // The drawing starts at the column edge, so a card docked beside it sits right next to the circles.
  const { body, hi, height } = draw(EDGE - draw(0).lo);

  const described = b.overlaps.length ? `, with ${b.overlaps.length} described overlap${b.overlaps.length > 1 ? "s" : ""}` : "";
  return svgFigure({
    id: b.id,
    kind: "venn",
    title: b.title,
    label: `Overlap of ${joinList(b.sets.map((s) => s.label))}`,
    desc: `Venn diagram of ${joinList(b.sets.map((s) => s.label))}${described}.`,
    width: Math.ceil(hi + EDGE),
    height,
    body,
  });
}

function model(b: VennBlock): Partial<DocModel> {
  const elements: Record<string, ElementInfo> = {};
  const f = labeler(b);
  const fu = (v: number) => fmtUnit(v, b.unit, b.format);
  const setOf = (sid: string) => b.sets.find((s) => s.id === sid)!;
  for (const s of b.sets) {
    const mine = b.overlaps.filter((o) => o.sets.includes(s.id)).sort((p, q) => p.sets.length - q.sets.length);
    const only = onlySize(b, s);
    elements[s.id] = itemInfo({
      id: s.id, label: s.label, figure: b.id, kind: "set",
      value: s.size === undefined ? undefined : fu(s.size), about: s.about,
      related: mine.map((o) => o.id),
      facts: factList([
        ...mine.map((o): Fact => ({ k: partners(b, o, s.id), v: overlapName(b, o), ref: o.id })),
        only !== undefined && { k: `only ${s.label}`, v: `${f(only)}${s.size ? ` (${share(only, s.size)})` : ""}`, raw: only },
      ]),
      say: `${s.label}${s.size === undefined ? "" : `, ${fu(s.size)}`}${mine.length ? `; overlaps: ${mine.map((o) => overlapName(b, o)).join(", ")}` : ""}`,
    });
  }
  for (const o of b.overlaps) {
    const inside = o.sets.map(setOf);
    const outside = b.sets.filter((s) => !o.sets.includes(s.id));
    elements[o.id] = itemInfo({
      id: o.id, label: overlapName(b, o), figure: b.id, kind: "overlap",
      sub: o.label ? inside.map((s) => s.label).join(" ∩ ") : undefined,
      value: o.size === undefined ? undefined : fu(o.size), about: o.about, related: o.sets,
      links: [{ rel: "In", ids: o.sets }, { rel: "Not in", ids: outside.map((s) => s.id) }],
      facts: factList(o.size === undefined ? [] : inside.map((s) => s.size ? { k: `share of ${s.label}`, v: share(o.size!, s.size), raw: (o.size! / s.size) * 100 } : false)),
      say: `${overlapName(b, o)}: in ${inside.map((s) => s.label).join(", ")}${outside.length ? `; not in ${outside.map((s) => s.label).join(", ")}` : ""}`,
    });
  }
  return { elements };
}

function reading(b: VennBlock): string {
  const sized = b.sets.some((s) => s.size !== undefined) || b.overlaps.some((o) => o.size !== undefined);
  const centre = b.sets.length === 3 ? " A pair's overlap leaves out the third circle; the middle is all three." : "";
  const focal = [...b.sets, ...b.overlaps].filter((x) => x.focal).map((x) => ("sets" in x ? overlapName(b, x) : x.label));
  return `Each circle is one group, and where circles overlap the work belongs to each of them.${centre} Circles are drawn the same size, so area means nothing${sized ? "; the numbers give the sizes" : ""}.` +
    (focal.length ? ` The accent marks ${focal.join(" and ")}.` : "");
}

function table(b: VennBlock): DataTable {
  const f = labeler(b);
  const sized = b.sets.some((s) => s.size !== undefined) || b.overlaps.some((o) => o.size !== undefined);
  const name = (sid: string) => b.sets.find((s) => s.id === sid)?.label ?? sid;
  return {
    head: ["Region", "In", "Not in", ...(sized ? ["Size"] : [])],
    rows: [
      ...b.sets.map((s) => [s.label, s.label, "", ...(sized ? [s.size === undefined ? "" : f(s.size)] : [])]),
      ...b.overlaps.map((o) => [
        overlapName(b, o), o.sets.map(name).join(", "), b.sets.filter((s) => !o.sets.includes(s.id)).map((s) => s.label).join(", "),
        ...(sized ? [o.size === undefined ? "" : f(o.size)] : []),
      ]),
    ],
  };
}

export const blockModule: BlockModule<VennBlock> = { type: "venn", normalize, render, model, reading, table };
