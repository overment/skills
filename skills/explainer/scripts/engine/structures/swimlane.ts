// Swimlane: who does which step, in what order. Lanes are rows, steps sit in lane × column cells,
// and the links that cross lanes are the handoffs the diagram exists to show.
import { BUDGET, SpecError, type BlockModule, type DataTable, type Diagnostic, type ElementInfo, type Fact, type Link as CardLink, type ReadingSpec, type Theme } from "../types.ts";
import { READING_KEYS, arrowDefs, groupInfo, idFrom, isObj, list, mark, notes, num, number, onSel, orthoPath, readingSpec, svgFigure, text, textWidth, type Frame } from "../kit.ts";
import { allowKeys, esc, optBool, optString, requireMap, requireString } from "../blocks/util.ts";

type StepKind = "task" | "decision" | "event";
type LinkKind = "flow" | "return";
type Pt = [number, number];
type Side = "top" | "right" | "bottom" | "left";

interface Lane { id: string; label: string; about?: string }
interface Step { id: string; label: string; lane: string; col: number; kind: StepKind; about?: string; wait?: string; focal: boolean }
interface Link { id: string; from: string; to: string; kind: LinkKind; label?: string }
/** Every link from one lane into another, under one id prose can point at. */
interface Handoff { id: string; from: string; to: string; links: string[] }

interface SwimlaneBlock extends ReadingSpec {
  type: "swimlane";
  id: string;
  title?: string;
  line: number;
  lanes: Lane[];
  steps: Step[];
  links: Link[];
  handoffs: Handoff[];
}

interface Box { l: number; r: number; t: number; b: number; cx: number; cy: number; lane: number; col: number }
interface Rect { x: number; y: number; w: number; h: number }

const KINDS: readonly StepKind[] = ["task", "decision", "event"];
const CELL_W = 144, CELL_H = 56, COL_GAP = 56, LANE_PAD = 16, LANE_H = CELL_H + 2 * LANE_PAD;
const TRACKS = [LANE_PAD / 2, LANE_PAD / 4, (3 * LANE_PAD) / 4];
const MAX_LANES = 5, MAX_STEPS = 12, MAX_COLS = 5;
const LABEL_GAP = 3, CLEAR = 2;

/** Word-wrap into at most `maxLines`; the last kept line gets an ellipsis when text is cut. */
function fit(value: string, maxW: number, measure: (s: string) => number, maxLines: number): { lines: string[]; cut: boolean } {
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next) > maxW) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  const overflow = lines.length > maxLines;
  let cut = overflow;
  const out = lines.slice(0, maxLines).map((l, i, all) => {
    if (measure(l) <= maxW && !(overflow && i === all.length - 1)) return l;
    cut = true;
    let t = l;
    while (t.length > 1 && measure(`${t}…`) > maxW) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  });
  return { lines: out.length ? out : [""], cut };
}

/** `a -> b`, `a --> b: label`, or the YAML map form `- a -> b: label`. */
function parseLink(v: unknown, where: string, line: number): { from: string; to: string; kind: LinkKind; label?: string } {
  let spec: string | undefined;
  let label: string | undefined;
  if (typeof v === "string") spec = v;
  else if (isObj(v) && Object.keys(v).length === 1) {
    spec = Object.keys(v)[0];
    const val = v[spec];
    if (typeof val === "string" || typeof val === "number") label = String(val).trim() || undefined;
    else if (val !== null && val !== undefined) throw new SpecError(`${where}: the label after "${spec}:" must be text.`, line);
  }
  const m = spec === undefined ? null : /^\s*(\S+?)\s*(-->|->)\s*([^\s:]+)\s*(?::\s*(.*?))?\s*$/.exec(spec);
  if (!m) throw new SpecError(`${where} must read "a -> b" or "a -> b: label" (-> handoff, --> return).`, line);
  return { from: m[1], to: m[3], kind: m[2] === "-->" ? "return" : "flow", label: label ?? (m[4] || undefined) };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
/** Axis-aligned segment as a zero-width rect, so `overlaps` tests it against boxes. */
const segRect = (a: Pt, b: Pt): Rect => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) });
const touches = (r: Rect, s: Rect) => r.x <= s.x + s.w && s.x <= r.x + r.w && r.y <= s.y + s.h && s.y <= r.y + r.h;

interface EdgeLabel { x: number; y: number; anchor: "start" | "middle" | "end"; rect: Rect }
interface Layout {
  width: number;
  height: number;
  headW: number;
  laneY: (i: number) => number;
  boxes: Map<string, Box>;
  routes: Map<string, Pt[]>;
  labels: Map<string, EdgeLabel>;
  warnings: Diagnostic[];
}

function layout(block: SwimlaneBlock, theme: Theme): Layout {
  const pad = theme.grid.pad;
  const labelPx = theme.type.nodeLabel, edgePx = theme.type.edgeLabel;
  const where = `swimlane "${block.id}"`;
  const warnings: Diagnostic[] = [];
  const warn = (rule: string, message: string) => warnings.push({ rule, severity: "warn", message: `${where} ${message}`, line: block.line });
  const laneIndex = new Map(block.lanes.map((l, i) => [l.id, i]));
  const headW = Math.min(184, Math.max(112, ...block.lanes.map((l) => textWidth(l.label, labelPx, "sans") * 1.08 + 32)));
  const cols = Math.max(...block.steps.map((s) => s.col)) + 1;
  const colX = (c: number) => pad + headW + 24 + c * (CELL_W + COL_GAP);
  const width = colX(cols - 1) + CELL_W + 24 + pad;
  const laneY = (i: number) => pad + i * LANE_H;
  const height = laneY(block.lanes.length) + pad;
  if (cols > MAX_COLS) {
    warn("budget-nodes", `spans ${cols} columns; keep it to ${MAX_COLS} so it fits the page without scrolling. Give parallel steps the same col, or split the flow at a handoff.`);
  }

  const boxes = new Map<string, Box>();
  const busy = new Set<string>();
  for (const s of block.steps) {
    const lane = laneIndex.get(s.lane) ?? 0;
    const l = colX(s.col), t = laneY(lane) + LANE_PAD;
    boxes.set(s.id, { l, r: l + CELL_W, t, b: t + CELL_H, cx: l + CELL_W / 2, cy: t + CELL_H / 2, lane, col: s.col });
    busy.add(`${lane}:${s.col}`);
  }
  const free = (lane: number, from: number, to: number) => {
    for (let c = from; c <= to; c++) if (busy.has(`${lane}:${c}`)) return false;
    return true;
  };
  const clearBetween = (a: Box, b: Box, col: number) => {
    for (let l = Math.min(a.lane, b.lane) + 1; l < Math.max(a.lane, b.lane); l++) if (busy.has(`${l}:${col}`)) return false;
    return true;
  };

  // A decision sends each branch out of its own vertex: down-lane from the bottom, up-lane from the top.
  const exitOf = new Map<string, Side>();
  for (const s of block.steps.filter((x) => x.kind === "decision")) {
    const used = new Set<Side>();
    const a = boxes.get(s.id)!;
    for (const e of block.links.filter((l) => l.from === s.id)) {
      const b = boxes.get(e.to)!;
      const want: Side = b.lane > a.lane ? "bottom" : b.lane < a.lane ? "top" : b.col > a.col ? "right" : "bottom";
      const side = ([want, "right", "bottom", "top"] as Side[]).find((x) => !used.has(x)) ?? want;
      used.add(side);
      exitOf.set(e.id, side);
    }
  }

  // Runs through a lane's padding band or a column gap take the first free track, so parallel runs never merge.
  const taken = new Map<string, { lo: number; hi: number; k: number }[]>();
  const track = (key: string, lo: number, hi: number, offsets: number[]): number => {
    const used = taken.get(key) ?? [];
    const [a, b] = [Math.min(lo, hi), Math.max(lo, hi)];
    let k = offsets.findIndex((_, i) => used.every((u) => u.k !== i || u.hi + 4 < a || b + 4 < u.lo));
    if (k < 0) k = 0;
    used.push({ lo: a, hi: b, k });
    taken.set(key, used);
    return offsets[k];
  };
  const band = (lane: number, side: "top" | "bottom", x0: number, x1: number) =>
    side === "top" ? laneY(lane) + track(`${lane}:top`, x0, x1, TRACKS) : laneY(lane + 1) - track(`${lane}:bottom`, x0, x1, TRACKS);
  const gap = (x: number, y0: number, y1: number) => x + track(`gap:${Math.round(x)}`, y0, y1, [0, -6, 6]);

  const route = (e: Link): Pt[] => {
    const a = boxes.get(e.from)!, b = boxes.get(e.to)!;
    const down = b.lane > a.lane;
    const exit = exitOf.get(e.id);
    const intoL = b.l - COL_GAP / 2, intoR = b.r + COL_GAP / 2;
    if (exit === "top" || exit === "bottom") {
      const sy = exit === "bottom" ? a.b : a.t;
      const toward = (exit === "bottom") === down;
      if (a.lane !== b.lane && toward && clearBetween(a, b, a.col)) {
        if (b.col === a.col) return [[a.cx, sy], [b.cx, down ? b.t : b.b]];
        if (b.col > a.col && free(b.lane, a.col, b.col - 1)) return [[a.cx, sy], [a.cx, b.cy], [b.l, b.cy]];
        if (b.col < a.col && free(b.lane, b.col + 1, a.col)) return [[a.cx, sy], [a.cx, b.cy], [b.r, b.cy]];
      }
      if (a.lane === b.lane) {
        const y = band(a.lane, exit, a.cx, b.cx);
        return [[a.cx, sy], [a.cx, y], [b.cx, y], [b.cx, exit === "bottom" ? b.b : b.t]];
      }
      const fwd = b.col >= a.col;
      const y = band(a.lane, exit, a.cx, fwd ? intoL : intoR);
      const x = gap(fwd ? intoL : intoR, y, b.cy);
      return [[a.cx, sy], [a.cx, y], [x, y], [x, b.cy], [fwd ? b.l : b.r, b.cy]];
    }
    if (a.lane === b.lane) {
      if (b.col > a.col && free(a.lane, a.col + 1, b.col - 1)) return [[a.r, a.cy], [b.l, b.cy]];
      // detour through the lane padding: above when going forward, below when going back
      const forward = b.col > a.col;
      const y = band(a.lane, forward ? "top" : "bottom", a.cx, b.cx);
      return [[a.cx, forward ? a.t : a.b], [a.cx, y], [b.cx, y], [b.cx, forward ? b.t : b.b]];
    }
    if (b.col === a.col) {
      if (clearBetween(a, b, a.col)) return down ? [[a.cx, a.b], [b.cx, b.t]] : [[a.cx, a.t], [b.cx, b.b]];
      const x = gap(a.r + COL_GAP / 2, a.cy, b.cy);
      return [[a.r, a.cy], [x, a.cy], [x, b.cy], [b.r, b.cy]];
    }
    if (b.col > a.col) {
      if (free(b.lane, a.col + 1, b.col - 1)) {
        const x = gap(a.r + COL_GAP / 2, a.cy, b.cy);
        return [[a.r, a.cy], [x, a.cy], [x, b.cy], [b.l, b.cy]];
      }
      if (free(a.lane, a.col + 1, b.col - 1)) {
        const x = gap(intoL, a.cy, b.cy);
        return [[a.r, a.cy], [x, a.cy], [x, b.cy], [b.l, b.cy]];
      }
      // both lanes are busy on the way: cross over in the gap, run along the receiver's padding band
      const x0 = gap(a.r + COL_GAP / 2, a.cy, b.cy);
      const y = band(b.lane, down ? "top" : "bottom", x0, intoL);
      const x1 = gap(intoL, y, b.cy);
      return [[a.r, a.cy], [x0, a.cy], [x0, y], [x1, y], [x1, b.cy], [b.l, b.cy]];
    }
    // going back to another lane: out of the sender's facing side, along both lanes' padding bands, into the
    // receiver's facing side, so the return never shares a side with the forward links in and out of a step
    const ya = band(a.lane, down ? "bottom" : "top", a.cx, intoR);
    const x = gap(intoR, ya, b.cy);
    const yb = band(b.lane, down ? "top" : "bottom", x, b.cx);
    return [[a.cx, down ? a.b : a.t], [a.cx, ya], [x, ya], [x, yb], [b.cx, yb], [b.cx, down ? b.t : b.b]];
  };
  const routes = new Map(block.links.map((e) => [e.id, route(e)]));

  // Say so when a route still runs through a step or on top of another link.
  const segsOf = (pts: Pt[]) => pts.slice(1).map((p, i): [Pt, Pt] => [pts[i], p]);
  const stepName = new Map(block.steps.map((s) => [s.id, s.label]));
  for (const e of block.links) {
    const hit = block.steps.find((s) => s.id !== e.from && s.id !== e.to && segsOf(routes.get(e.id)!).some(([p, q]) => {
      const bx = boxes.get(s.id)!;
      return overlaps(segRect(p, q), { x: bx.l + 1, y: bx.t + 1, w: CELL_W - 2, h: CELL_H - 2 });
    }));
    if (hit) warn("route", `link "${e.id}" runs through step "${stepName.get(hit.id)}"; give one of them a different col.`);
  }
  block.links.forEach((e, i) => {
    for (const o of block.links.slice(i + 1)) {
      if (o.from === e.from || o.to === e.to) continue;
      const shared = segsOf(routes.get(e.id)!).some(([p, q]) => segsOf(routes.get(o.id)!).some(([r, s]) => {
        if (p[0] === q[0] && r[0] === s[0] && Math.abs(p[0] - r[0]) < 1) return Math.min(Math.max(p[1], q[1]), Math.max(r[1], s[1])) - Math.max(Math.min(p[1], q[1]), Math.min(r[1], s[1])) > 1;
        if (p[1] === q[1] && r[1] === s[1] && Math.abs(p[1] - r[1]) < 1) return Math.min(Math.max(p[0], q[0]), Math.max(r[0], s[0])) - Math.max(Math.min(p[0], q[0]), Math.min(r[0], s[0])) > 1;
        return false;
      }));
      if (shared) warn("route", `links "${e.id}" and "${o.id}" run on top of each other; move one of their steps to another col.`);
    }
  });

  // Labels rest on their own line: above its longest horizontal run, else beside a vertical one,
  // at the first spot that clears every step, lane rule, line, arrowhead and earlier label.
  const blockers: Rect[] = [
    ...[...boxes.values()].map((b) => ({ x: b.l, y: b.t, w: CELL_W, h: CELL_H })),
    ...block.lanes.map((_, i) => ({ x: pad + 4, y: laneY(i) + 4, w: headW - 8, h: LANE_H - 8 })),
    ...[...routes.values()].map((pts) => { const [x, y] = pts.at(-1)!; return { x: x - 5, y: y - 5, w: 10, h: 10 }; }),
  ];
  const lines: Rect[] = [
    ...block.lanes.slice(1).map((_, i) => segRect([pad, laneY(i + 1)], [width - pad, laneY(i + 1)])),
    segRect([pad, pad], [width - pad, pad]), segRect([pad, height - pad], [width - pad, height - pad]),
    segRect([pad, pad], [pad, height - pad]), segRect([width - pad, pad], [width - pad, height - pad]),
    ...[...routes.values()].flatMap((pts) => segsOf(pts).map(([p, q]) => segRect(p, q))),
  ];
  const labels = new Map<string, EdgeLabel>();
  const h = edgePx * 1.25;
  for (const e of block.links) {
    if (!e.label) continue;
    const w = textWidth(e.label, edgePx, "mono") + 2;
    const pts = routes.get(e.id)!;
    const runs = segsOf(pts).map(([p, q]) => ({ p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) })).sort((a, b) => b.len - a.len);
    const options: EdgeLabel[] = [];
    for (const { p, q } of runs.filter((r) => r.p[1] === r.q[1])) {
      const lo = Math.min(p[0], q[0]) + 2, hi = Math.max(p[0], q[0]) - 2, y = p[1];
      for (const x of [(lo + hi) / 2, lo + w / 2 + 4, hi - w / 2 - 4]) {
        if (x - w / 2 < lo || x + w / 2 > hi) continue;
        options.push({ x, y: y - LABEL_GAP - h * 0.22, anchor: "middle", rect: { x: x - w / 2, y: y - LABEL_GAP - h, w, h } });
        options.push({ x, y: y + LABEL_GAP + h * 0.78, anchor: "middle", rect: { x: x - w / 2, y: y + LABEL_GAP, w, h } });
      }
    }
    for (const { p, q } of runs.filter((r) => r.p[0] === r.q[0])) {
      const lo = Math.min(p[1], q[1]), hi = Math.max(p[1], q[1]), x = p[0];
      for (const y of [(lo + hi) / 2, (3 * lo + hi) / 4, (lo + 3 * hi) / 4]) {
        options.push({ x: x + LABEL_GAP + 1, y: y + h * 0.28, anchor: "start", rect: { x: x + LABEL_GAP + 1, y: y - h / 2, w, h } });
        options.push({ x: x - LABEL_GAP - 1, y: y + h * 0.28, anchor: "end", rect: { x: x - LABEL_GAP - 1 - w, y: y - h / 2, w, h } });
      }
    }
    const clear = (o: EdgeLabel) => {
      const g = grow(o.rect, CLEAR);
      return blockers.every((b) => !overlaps(g, b)) && lines.every((s) => !touches(g, s)) &&
        [...labels.values()].every((l) => !overlaps(g, l.rect)) && g.x >= 0 && g.x + g.w <= width && g.y >= 0 && g.y + g.h <= height;
    };
    const spot = options.find(clear);
    if (!spot) warn("edge-label", `label "${e.label}" on link "${e.id}" has no clear spot next to its line; move one of its steps to another col.`);
    const chosen = spot ?? options[0];
    if (chosen) labels.set(e.id, chosen);
  }

  return { width, height, headW, laneY, boxes, routes, labels, warnings };
}

/** Notes and story steps may only point at this block's own elements. */
function checkRefs(spec: ReadingSpec, known: Set<string>, where: string, line: number): void {
  const refs = [...(spec.notes ?? []).flatMap((n) => n.on), ...(spec.story ?? []).flatMap((s) => (s.cmp ? [s.sel, s.cmp] : [s.sel]))];
  const missing = refs.find((id) => !known.has(id));
  if (missing) throw new SpecError(`${where}: notes or story point at "${missing}", which is not an element of this block.`, line, "ref-exists");
}

export const blockModule: BlockModule<SwimlaneBlock> = {
  type: "swimlane",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "swimlane", line);
    allowKeys(data, ["id", "title", "lanes", "steps", "links", ...READING_KEYS], "swimlane", line);
    const id = requireString(data, "id", "swimlane", line);
    const where = `swimlane "${id}"`;
    const taken = new Set<string>();
    const claim = (given: string) => {
      if (taken.has(given)) throw new SpecError(`${where}: id "${given}" is used twice.`, line, "id-unique");
      taken.add(given);
    };

    const laneFields = list(data.lanes, `${where} lanes`, line).map((l, i) => {
      const lw = `${where} lane ${i + 1}`;
      const f = typeof l === "string" ? { label: l } : l;
      if (!isObj(f)) throw new SpecError(`${lw} must be a map: { id, label, about } or a bare label.`, line);
      allowKeys(f, ["id", "label", "about"], lw, line);
      const given = optString(f, "id", lw, line);
      if (given) claim(given);
      return { given, label: requireString(f, "label", lw, line), about: optString(f, "about", lw, line) };
    });
    if (!laneFields.length) throw new SpecError(`${where} needs at least one lane.`, line);
    const lanes: Lane[] = laneFields.map((l) => ({ id: l.given ?? idFrom(l.label, taken, `${id}-`), label: l.label, about: l.about }));

    const stepList = list(data.steps, `${where} steps`, line);
    if (!stepList.length) throw new SpecError(`${where} needs at least one step.`, line);
    const cells = new Map<string, string>();
    let prev = -1;
    const steps: Step[] = stepList.map((s, i) => {
      const sw = `${where} step ${i + 1}`;
      if (!isObj(s)) throw new SpecError(`${sw} must be a map: { id, label, lane }.`, line);
      allowKeys(s, ["id", "label", "lane", "col", "kind", "about", "wait", "focal"], sw, line);
      const sid = requireString(s, "id", sw, line);
      claim(sid);
      const ref = requireString(s, "lane", sw, line);
      const lane = lanes.find((l) => l.id === ref) ?? lanes.find((l) => l.label === ref);
      if (!lane) throw new SpecError(`${sw} ("${sid}") is in lane "${ref}", which is not listed; lanes are ${lanes.map((l) => l.id).join(", ")}.`, line, "ref-exists");
      let col = prev + 1;
      if (s.col !== undefined) {
        col = number(s.col, `${sw} col`, line);
        if (!Number.isInteger(col) || col < 0) throw new SpecError(`${sw} col must be a whole number from 0, got ${col}.`, line);
      }
      prev = col;
      const kind = (s.kind === undefined ? "task" : String(s.kind)) as StepKind;
      if (!KINDS.includes(kind)) throw new SpecError(`${sw} kind must be one of ${KINDS.join(", ")}.`, line);
      const cell = `${lane.id}:${col}`;
      const other = cells.get(cell);
      if (other) throw new SpecError(`${where}: steps "${other}" and "${sid}" share lane "${lane.label}" column ${col}; give one a different col.`, line, "grid-collision");
      cells.set(cell, sid);
      return {
        id: sid, label: requireString(s, "label", sw, line), lane: lane.id, col, kind,
        about: optString(s, "about", sw, line), wait: optString(s, "wait", sw, line), focal: optBool(s, "focal", sw, line),
      };
    });

    const stepIds = new Set(steps.map((s) => s.id));
    const count = new Map<string, number>();
    const links: Link[] = (data.links === undefined ? [] : list(data.links, `${where} links`, line)).map((v, i) => {
      const p = parseLink(v, `${where} link ${i + 1}`, line);
      for (const end of [p.from, p.to]) {
        if (!stepIds.has(end)) throw new SpecError(`${where} link "${p.from} -> ${p.to}" points at "${end}", which is not a step id.`, line, "ref-exists");
      }
      if (p.from === p.to) throw new SpecError(`${where} link "${p.from} -> ${p.to}" loops onto itself; drop it.`, line);
      if (p.label && (p.label.split(/\s+/).length > BUDGET.edgeLabelWords || p.label.length > BUDGET.edgeLabelChars)) {
        ctx.warn({ rule: "edge-label", severity: "warn", message: `${where} link "${p.from} -> ${p.to}" label "${p.label}" is long; use a verb of at most ${BUDGET.edgeLabelWords} words.`, line });
      }
      const base = `${p.from}->${p.to}`;
      const n = (count.get(base) ?? 0) + 1;
      count.set(base, n);
      return { id: n === 1 ? base : `${base}#${n}`, ...p };
    });

    // one id per lane-to-lane handoff, so prose can link "the handoff from Support to Finance"
    const laneOf = new Map(steps.map((s) => [s.id, s.lane]));
    const handoffs: Handoff[] = [];
    for (const l of links) {
      const from = laneOf.get(l.from)!, to = laneOf.get(l.to)!;
      if (from === to || l.kind === "return") continue;
      const h = handoffs.find((x) => x.from === from && x.to === to);
      if (h) h.links.push(l.id);
      else {
        const label = (lane: string) => lanes.find((x) => x.id === lane)!.label;
        handoffs.push({ id: idFrom(`${label(from)} to ${label(to)}`, taken, `${id}-`), from, to, links: [l.id] });
      }
    }

    if (lanes.length > MAX_LANES) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${lanes.length} lanes; keep it to ${MAX_LANES}. Merge lanes the reader never tells apart, or split into one swimlane per phase.`, line });
    }
    if (steps.length > MAX_STEPS) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${steps.length} steps; keep it to ${MAX_STEPS}. Split at a handoff: one swimlane up to it, a second one from it.`, line });
    }
    if (links.length > BUDGET.edges) {
      ctx.warn({ rule: "budget-edges", severity: "warn", message: `${where} has ${links.length} links; keep it to ${BUDGET.edges}. Keep the handoffs and the branches, drop links the column order already implies.`, line });
    }
    const focal = steps.filter((s) => s.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} steps focal; keep it to ${BUDGET.focal}.`, line });
    }
    const reading = readingSpec(data, line);
    checkRefs(reading, new Set([...lanes.map((l) => l.id), ...steps.map((s) => s.id), ...links.map((l) => l.id), ...handoffs.map((h) => h.id)]), where, line);
    return { type: "swimlane", id, title: optString(data, "title", where, line), line, lanes, steps, links, handoffs, ...reading };
  },

  render(block, ctx) {
    const { theme } = ctx;
    const pad = theme.grid.pad, radius = theme.radius;
    const labelPx = theme.type.nodeLabel, subPx = theme.type.nodeSub;
    const sans = (px: number) => (s: string) => textWidth(s, px, "sans") * 1.08;
    const L = layout(block, theme);
    L.warnings.forEach((d) => ctx.warn(d));
    const { width, height, headW, laneY, boxes } = L;

    const frame = `<rect class="x-swimlane-frame" x="${num(pad)}" y="${num(pad)}" width="${num(width - 2 * pad)}" height="${num(block.lanes.length * LANE_H)}" rx="${num(radius)}"/>` +
      block.lanes.slice(1).map((_, i) => `<line class="x-swimlane-rule" x1="${num(pad)}" y1="${num(laneY(i + 1))}" x2="${num(width - pad)}" y2="${num(laneY(i + 1))}"/>`).join("");

    const lanes = block.lanes.map((lane, i) => {
      const x = pad + 4, y = laneY(i) + 4, w = headW - 8, h = LANE_H - 8;
      const lh = Math.round(labelPx * 1.25);
      const { lines } = fit(lane.label, w - 20, sans(labelPx), 3);
      const y0 = y + h / 2 - ((lines.length - 1) * lh) / 2 + labelPx * 0.35;
      const band = onSel(`<rect class="x-swimlane-band" x="${num(pad + headW)}" y="${num(laneY(i))}" width="${num(width - 2 * pad - headW)}" height="${LANE_H}"/>`);
      const shape = band + `<rect class="x-mark-shape" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(radius)}"/>` +
        lines.map((t, k) => text(x + 12, y0 + k * lh, t, "x-lane-label")).join("");
      return mark({ id: lane.id, label: lane.label, cls: "x-swimlane-lane" }, shape);
    });

    const edges = block.links.map((e) => {
      const d = orthoPath(L.routes.get(e.id)!);
      return `<g class="x-edge" data-id="${esc(e.id)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-kind="${e.kind}">` +
        `<path class="x-edge-line" d="${d}" marker-end="url(#${esc(block.id)}-arrow)"/><path class="x-edge-hit" d="${d}"/></g>`;
    });
    const edgeLabels = block.links.flatMap((e) => {
      const l = L.labels.get(e.id);
      return l && e.label ? [`<g class="x-edge-label" data-for="${esc(e.id)}">${text(l.x, l.y, e.label, "x-edge-text", l.anchor)}</g>`] : [];
    });

    const lh = Math.round(subPx * 1.3);
    const steps = block.steps.map((s) => {
      const bx = boxes.get(s.id)!;
      const maxW = s.kind === "decision" ? CELL_W * 0.5 : CELL_W - 20;
      const { lines, cut } = fit(s.label, maxW, sans(subPx), 2);
      if (cut) {
        ctx.warn({ rule: "label-fit", severity: "warn", message: `swimlane "${block.id}" step "${s.id}": "${s.label}" does not fit its box; shorten the label and move the detail to about.`, line: block.line });
      }
      const shape = s.kind === "decision"
        ? `<path class="x-mark-shape" d="M${num(bx.cx)},${num(bx.t)} L${num(bx.r)},${num(bx.cy)} L${num(bx.cx)},${num(bx.b)} L${num(bx.l)},${num(bx.cy)} Z"/>`
        : `<rect class="x-mark-shape" x="${num(bx.l)}" y="${num(bx.t)}" width="${CELL_W}" height="${CELL_H}" rx="${num(s.kind === "event" ? CELL_H / 2 : radius)}"/>`;
      const y0 = bx.cy - ((lines.length - 1) * lh) / 2 + subPx * 0.35;
      const cls = s.focal ? "x-mark-label x-on-fill" : "x-mark-label";
      const labels = lines.map((t, k) => text(bx.cx, y0 + k * lh, t, cls, "middle")).join("");
      return mark({ id: s.id, label: s.label, focal: s.focal, cls: "x-swimlane-step", attrs: ` data-kind="${s.kind}"` }, shape + labels);
    });

    const anchors: Record<string, Frame> = {};
    for (const [id, b] of boxes) anchors[id] = { x: b.l, y: b.t, w: CELL_W, h: CELL_H };
    block.lanes.forEach((l, i) => { anchors[l.id] = { x: pad + 4, y: laneY(i) + 4, w: headW - 8, h: LANE_H - 8 }; });
    for (const [id, pts] of L.routes) {
      const l = L.labels.get(id);
      const [p, q] = pts.slice(1).map((pt, i): [Pt, Pt] => [pts[i], pt]).sort((a, b) => Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]) - Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]))[0];
      anchors[id] = l ? grow(l.rect, 4) : { x: (p[0] + q[0]) / 2 - 2, y: (p[1] + q[1]) / 2 - 2, w: 4, h: 4 };
    }
    for (const h of block.handoffs) anchors[h.id] = anchors[h.links[0]];
    const lineBoxes = [...L.routes.values()].flatMap((pts) => pts.slice(1).flatMap((q, i) => {
      const p = pts[i], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 3));
      return Array.from({ length: n + 1 }, (_, k) => ({ x: p[0] + ((q[0] - p[0]) * k) / n - 3, y: p[1] + ((q[1] - p[1]) * k) / n - 3, w: 6, h: 6 }));
    }));
    const markers = notes(block, anchors, {
      obstacles: [...[...boxes.values()].map((b) => ({ x: b.l, y: b.t, w: CELL_W, h: CELL_H })), ...[...L.labels.values()].map((l) => l.rect), ...lineBoxes,
        ...block.lanes.slice(1).map((_, i) => ({ x: pad, y: laneY(i + 1) - 2, w: width - 2 * pad, h: 4 }))],
      bounds: { x: 0, y: 0, w: width, h: height },
    });

    return svgFigure({
      id: block.id,
      kind: "swimlane",
      title: block.title,
      label: `Swimlane: ${block.lanes.map((l) => l.label).join(", ")}`,
      desc: `${block.lanes.length} lanes and ${block.steps.length} steps; arrows show each handoff from one lane to the next.`,
      width,
      height,
      defs: arrowDefs(block.id),
      body: frame + lanes.join("") + edges.join("") + steps.join("") + edgeLabels.join("") + markers,
    });
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const lane = new Map(block.lanes.map((l) => [l.id, l]));
    const step = new Map(block.steps.map((s) => [s.id, s]));
    const laneOf = (id: string) => step.get(id)!.lane;
    const handoffOf = (e: Link) => block.handoffs.find((h) => h.links.includes(e.id));
    const order = [...block.steps].sort((a, b) => a.col - b.col);
    const names = (ids: string[]) => ids.map((i) => step.get(i)?.label ?? lane.get(i)!.label).join(", ");
    const uniq = (ids: string[]) => [...new Set(ids)];

    for (const l of block.lanes) {
      const members = block.steps.filter((s) => s.lane === l.id).map((s) => s.id);
      const touching = block.links.filter((e) => laneOf(e.from) === l.id || laneOf(e.to) === l.id);
      const into = touching.filter((e) => laneOf(e.to) === l.id && laneOf(e.from) !== l.id);
      const out = touching.filter((e) => laneOf(e.from) === l.id && laneOf(e.to) !== l.id);
      const info = groupInfo({
        id: l.id, label: l.label, figure: block.id, kind: "lane", about: l.about, members,
        facts: [
          { k: "Steps", v: String(members.length) },
          // a count only adds something when one lane hands over more than once; otherwise the chips below say it
          into.length > uniq(into.map((e) => laneOf(e.from))).length ? { k: "Handoffs in", v: String(into.length) } : null,
          out.length > uniq(out.map((e) => laneOf(e.to))).length ? { k: "Handoffs out", v: String(out.length) } : null,
        ].filter((f): f is Fact => !!f),
        links: [
          { rel: "Steps", ids: members },
          { rel: "Receives from", ids: uniq(into.map((e) => laneOf(e.from))) },
          { rel: "Hands off to", ids: uniq(out.map((e) => laneOf(e.to))) },
        ],
        context: uniq(touching.flatMap((e) => [e.from, e.to]).filter((s) => laneOf(s) !== l.id)),
        say: `${l.label}: ${members.length} steps${into.length ? `, ${into.length} handoffs in` : ""}${out.length ? `, ${out.length} out` : ""}`,
      });
      info.related = touching.map((e) => e.id);
      elements[l.id] = info;
    }
    block.steps.forEach((s, i) => {
      const incoming = block.links.filter((e) => e.to === s.id);
      const outgoing = block.links.filter((e) => e.from === s.id);
      const from = incoming.find((e) => laneOf(e.from) !== s.lane && e.kind === "flow");
      const branches: CardLink[] = [];
      for (const e of outgoing) {
        const rel = e.label ? `If ${e.label}` : e.kind === "return" ? "Returns to" : "Then";
        const group = branches.find((b) => b.rel === rel);
        if (group) group.ids.push(e.to);
        else branches.push({ rel, ids: [e.to] });
      }
      const info: ElementInfo = { id: s.id, type: "node", label: s.label, kind: s.kind, figure: block.id, related: [s.lane] };
      if (s.about) info.about = s.about;
      info.facts = [
        { k: "Lane", v: lane.get(s.lane)!.label, ref: s.lane },
        from ? { k: "Handoff from", v: lane.get(laneOf(from.from))!.label, ref: handoffOf(from)!.id } : null,
        s.wait ? { k: "Wait before it", v: s.wait } : null,
        { k: "Order", v: `${order.indexOf(s) + 1} of ${block.steps.length}` },
      ].filter((f): f is Fact => !!f);
      info.links = [{ rel: "After", ids: incoming.map((e) => e.from) }, ...branches].filter((l) => l.ids.length);
      info.pos = `${i + 1} of ${block.steps.length}`;
      info.say = `${s.label}, ${lane.get(s.lane)!.label}${from ? `, handoff from ${lane.get(laneOf(from.from))!.label}` : ""}${s.wait ? `, waits ${s.wait}` : ""}`;
      elements[s.id] = info;
    });
    for (const e of block.links) {
      const a = step.get(e.from)!, b = step.get(e.to)!;
      const h = handoffOf(e);
      const info: ElementInfo = { id: e.id, type: "edge", label: e.label ?? `${a.label} → ${b.label}`, from: e.from, to: e.to, kind: e.kind, figure: block.id };
      info.facts = [
        a.lane === b.lane
          ? { k: "Within", v: lane.get(a.lane)!.label, ref: a.lane }
          : { k: "Crosses", v: `${lane.get(a.lane)!.label} → ${lane.get(b.lane)!.label}`, ref: h?.id ?? b.lane },
        b.wait ? { k: "Wait", v: b.wait } : null,
        e.kind === "return" ? { k: "Kind", v: "goes back" } : null,
      ].filter((f): f is Fact => !!f);
      info.context = uniq([a.lane, b.lane]);
      info.say = `${a.label} to ${b.label}${e.label ? `, ${e.label}` : ""}${a.lane !== b.lane ? `, handoff from ${lane.get(a.lane)!.label} to ${lane.get(b.lane)!.label}` : ""}`;
      elements[e.id] = info;
    }
    for (const h of block.handoffs) {
      const ends = uniq(h.links.flatMap((id) => { const e = block.links.find((l) => l.id === id)!; return [e.from, e.to]; }));
      const waits = h.links.map((id) => step.get(block.links.find((l) => l.id === id)!.to)!.wait).filter((w): w is string => !!w);
      elements[h.id] = groupInfo({
        id: h.id, label: `${lane.get(h.from)!.label} → ${lane.get(h.to)!.label}`, figure: block.id, kind: "handoff",
        members: [...h.links, ...ends],
        facts: [{ k: "Links", v: String(h.links.length) }, waits.length ? { k: "Wait", v: waits.join(", ") } : null].filter((f): f is Fact => !!f),
        links: [{ rel: "Steps", ids: ends }],
        context: [h.from, h.to],
        say: `Handoff from ${lane.get(h.from)!.label} to ${lane.get(h.to)!.label}: ${names(ends)}`,
      });
    }
    return { elements };
  },

  reading() {
    return "One lane per team or system; read left to right. Columns give the order of steps, not their duration. A line that crosses into another lane is a handoff, a diamond is a decision with labelled branches, and a pill starts or ends the flow.";
  },

  table(block): DataTable {
    const lane = new Map(block.lanes.map((l) => [l.id, l.label]));
    const label = new Map(block.steps.map((s) => [s.id, s.label]));
    return {
      head: ["Step", "Lane", "Kind", "Wait", "Next"],
      rows: [...block.steps].sort((a, b) => a.col - b.col).map((s) => [
        s.label, lane.get(s.lane)!, s.kind, s.wait ?? "",
        block.links.filter((e) => e.from === s.id).map((e) => `${label.get(e.to)}${e.label ? ` (${e.label})` : ""}`).join(", "),
      ]),
    };
  },
};
