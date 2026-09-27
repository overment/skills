import {
  BUDGET, SpecError,
  type DataTable, type DocModel, type EdgeKind, type EdgeSpec, type ElementInfo, type Fact, type Link, type NodeKind, type NodeSpec,
  type RawBlock, type ReadingSpec, type RenderContext, type SceneSpec, type SequenceBlock, type Theme,
} from "../types";
import {
  allowKeys, attr, entries, esc, isObj, joinList, optBool, optString, requireMap, requireString, stringList, type Fields,
} from "./util";
import { READING_KEYS, factList, notes, readingSpec } from "../kit";
import { EDGE_WORDS, NODE_WORDS, defs, legendSvg, lineKey } from "../figure/render";
import { boldWidth, textWidth, type Rect } from "../figure/grid";

/** A sequence figure with the expanded-view keys (notes, caveat, story). */
export type Sequence = SequenceBlock & ReadingSpec;

// A decision branches a path in space; a sequence is ordered in time, so a branch belongs in a message label.
const NODE_KINDS: readonly string[] = ["actor", "service", "store", "external", "boundary", "optional"];
const EDGE_KINDS: readonly string[] = ["flow", "return", "async", "link"];
const ARROWS: Record<string, EdgeKind> = { "-->": "return", "->": "flow", "~>": "async", "=>": "link" };
const ARROW_RE = /^\s*(\S+?)\s*(-->|->|~>|=>)\s*(\S+?)\s*(?::\s*(.*?))?\s*$/;
const MAX_ACTORS = 5;

// Vertical rhythm in px: header box, first message offset, message pitch, lifeline tail, self loop, label box, legend strip.
const HEAD_H = 44, FIRST = 32, PITCH = 40, TAIL = 24, SELF_W = 32, SELF_H = 20, LABEL_H = 14, LABEL_GAP = 6;
/** Half an activation bar, and the clearance a label keeps from any lifeline or bar. */
const ACT = 5, CLEAR = 6;
/** Message numbers sit just past the sender's bar, above the arrow. */
const NUM_GAP = 8;
/** At most this wide, so the 256px card docks 16px to its right in the 1232px column. */
const MAX_W = 960;
/** The least room between two actor boxes when actors close up to fit MAX_W, and a label mask's side padding. */
const MIN_GAP = 24, MASK_PAD = 4;

const r1 = (v: number) => String(Math.round(v * 10) / 10);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Message = Omit<EdgeSpec, "id">;

function shorthand(text: string, label: string | undefined, where: string, line: number): Message {
  const m = ARROW_RE.exec(text);
  if (!m) throw new SpecError(`${where}: "${text}" is not "a -> b: label" (arrows: ->, -->, ~>, =>).`, line);
  return { from: m[1]!, to: m[3]!, label: label ?? (m[4] || undefined), kind: ARROWS[m[2]!]! };
}

function parseMessage(item: unknown, where: string, line: number): Message {
  if (typeof item === "string") return shorthand(item, undefined, where, line);
  if (!isObj(item)) throw new SpecError(`${where} must be "a -> b: label" or { from, to, label }.`, line);
  const keys = Object.keys(item);
  if (keys.length === 1 && ARROW_RE.test(keys[0]!)) {
    const value = item[keys[0]!];
    if (value != null && typeof value !== "string" && typeof value !== "number") {
      throw new SpecError(`${where}: the label after \`:\` must be text.`, line);
    }
    return shorthand(keys[0]!, value == null ? undefined : String(value).trim() || undefined, where, line);
  }
  allowKeys(item, ["from", "to", "label", "kind", "about"], where, line);
  const kind = optString(item, "kind", where, line) ?? "flow";
  if (!EDGE_KINDS.includes(kind)) throw new SpecError(`${where}: kind "${kind}" is not one of ${EDGE_KINDS.join(", ")}.`, line);
  return {
    from: requireString(item, "from", where, line),
    to: requireString(item, "to", where, line),
    label: optString(item, "label", where, line),
    kind: kind as EdgeKind,
    about: optString(item, "about", where, line),
  };
}

function actor(id: string, fields: Fields, index: number, where: string, line: number): NodeSpec {
  const aw = `${where} actor "${id}"`;
  allowKeys(fields, ["label", "sub", "kind", "focal", "about"], aw, line);
  const kind = optString(fields, "kind", aw, line) ?? (index === 0 ? "actor" : "service");
  if (kind === "decision") throw new SpecError(`${aw}: a sequence has no decision actors; name the branch in a message label, or draw it as a states figure.`, line);
  if (!NODE_KINDS.includes(kind)) throw new SpecError(`${aw}: kind "${kind}" is not one of ${NODE_KINDS.join(", ")}.`, line);
  return {
    id,
    label: requireString(fields, "label", aw, line),
    sub: optString(fields, "sub", aw, line),
    at: [index, 0],
    span: [1, 1],
    kind: kind as NodeKind,
    focal: optBool(fields, "focal", aw, line),
    about: optString(fields, "about", aw, line),
    tags: [],
  };
}

function scene(id: string, fields: Fields, known: Set<string>, where: string, line: number): SceneSpec {
  const sw = `${where} scene "${id}"`;
  allowKeys(fields, ["title", "path", "notes"], sw, line);
  const path = stringList(fields.path, `${sw} path`, line);
  if (!path.length) throw new SpecError(`${sw} needs a \`path\` of actor or message ids.`, line);
  for (const step of path) {
    if (!known.has(step)) throw new SpecError(`${sw}: "${step}" is not an actor or message id.`, line, "ref-exists");
  }
  const given = fields.notes ?? {};
  if (!isObj(given)) throw new SpecError(`${sw}: \`notes\` must be a map of id → note.`, line);
  const notes: Record<string, string> = {};
  for (const [key, note] of Object.entries(given)) {
    if (!path.includes(key)) throw new SpecError(`${sw}: note for "${key}", which is not on the path.`, line, "ref-exists");
    if (typeof note !== "string" && typeof note !== "number") throw new SpecError(`${sw}: note for "${key}" must be text.`, line);
    notes[key] = String(note);
  }
  return { id, title: optString(fields, "title", sw, line) ?? id, path, notes };
}

function normalize(raw: RawBlock, ctx: RenderContext): Sequence {
  const line = raw.line;
  const data = requireMap(raw.data, "figure", line);
  allowKeys(data, ["id", "layout", "title", "actors", "messages", "scenes", "legend", ...READING_KEYS], "sequence figure", line);
  const id = requireString(data, "id", "sequence figure", line);
  const where = `figure "${id}"`;
  if (data.layout != null && data.layout !== "sequence") throw new SpecError(`${where} is not a sequence layout.`, line);

  const actors = entries(data.actors, `${where} actors`, line).map(([aid, f], i) => actor(aid, f, i, where, line));
  if (!actors.length) throw new SpecError(`${where} needs \`actors\`.`, line);
  const ids = new Set<string>();
  for (const a of actors) {
    if (ids.has(a.id)) throw new SpecError(`${where}: actor "${a.id}" is listed twice.`, line, "id-unique");
    ids.add(a.id);
  }

  if (!Array.isArray(data.messages) || !data.messages.length) {
    throw new SpecError(`${where} needs \`messages\`: a list like "app -> gw: sends token".`, line);
  }
  const messages: EdgeSpec[] = data.messages.map((item, i) => {
    const mid = `m${i + 1}`;
    const spec = parseMessage(item, `${where} message ${i + 1}`, line);
    for (const end of [spec.from, spec.to]) {
      if (!ids.has(end)) {
        throw new SpecError(`${where} message ${i + 1}: "${end}" is not an actor. Actors: ${[...ids].join(", ")}.`, line, "ref-exists");
      }
    }
    if (ids.has(mid)) throw new SpecError(`${where}: actor id "${mid}" clashes with message ${i + 1}; rename the actor.`, line, "id-unique");
    return { id: mid, ...spec };
  });

  const known = new Set([...ids, ...messages.map((m) => m.id)]);
  const scenes = entries(data.scenes, `${where} scenes`, line).map(([sid, f]) => scene(sid, f, known, where, line));

  const kindsUsed = new Set(actors.map((a) => a.kind)).size > 1 || new Set(messages.map((m) => m.kind)).size > 1;
  const legend = optBool(data, "legend", where, line, kindsUsed);
  const reading = readingSpec(data, line);
  for (const note of reading.notes ?? []) {
    for (const target of note.on) {
      if (!known.has(target)) ctx.warn({ rule: "ref-exists", severity: "warn", message: `${where}: a note points at "${target}", which is not an actor or message id.`, line });
    }
  }

  if (actors.length > MAX_ACTORS) {
    ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${actors.length} actors; keep a sequence to ${MAX_ACTORS} or split it.`, line });
  }
  if (messages.length > BUDGET.edges) {
    ctx.warn({ rule: "budget-edges", severity: "warn", message: `${where} has ${messages.length} messages; keep it to ${BUDGET.edges} or split it.`, line });
  }
  const focal = actors.filter((a) => a.focal).length;
  if (focal > BUDGET.focal) {
    ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} actors focal; keep it to ${BUDGET.focal}.`, line });
  }
  const room = ctx.theme.grid.cell[0] - 24;
  for (const a of actors) {
    if (textWidth(a.label, ctx.theme.type.nodeLabel, "sans") > room || (a.sub && textWidth(a.sub, ctx.theme.type.nodeSub, "sans") > room)) {
      ctx.warn({ rule: "label-fit", severity: "warn", message: `${where}: actor "${a.id}" has a label wider than its box; shorten it.`, line });
    }
  }

  return { type: "figure", id, layout: "sequence", title: optString(data, "title", where, line), actors, messages, scenes, legend, line, ...reading };
}

/**
 * When each actor is busy: a run of consecutive messages it takes part in that starts with a message it receives.
 * The initiator's first send opens no bar; it is not answering anything.
 */
function activations(block: SequenceBlock): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  for (const a of block.actors) {
    const runs: [number, number][] = [];
    let start = -1;
    block.messages.forEach((m, k) => {
      const involved = m.from === a.id || m.to === a.id;
      if (!involved) {
        start = -1;
        return;
      }
      if (start < 0 && m.to === a.id && m.kind !== "return") {
        start = k;
        runs.push([k, k]);
      } else if (start >= 0) runs[runs.length - 1][1] = k;
    });
    out.set(a.id, runs);
  }
  return out;
}

function selfLoop(x: number, y: number): string {
  const r = 8, e = x + SELF_W;
  return `M${r1(x)},${r1(y)} H${r1(e - r)} Q${r1(e)},${r1(y)} ${r1(e)},${r1(y + r)} V${r1(y + SELF_H - r)} Q${r1(e)},${r1(y + SELF_H)} ${r1(e - r)},${r1(y + SELF_H)} H${r1(x + 2)}`;
}

function actorNode(a: NodeSpec, x: number, y: number, theme: Theme): string {
  const w = theme.grid.cell[0];
  const cx = r1(x + w / 2);
  const { nodeLabel, nodeSub } = theme.type;
  const top = y + (HEAD_H - (a.sub ? nodeLabel + 4 + nodeSub : nodeLabel)) / 2;
  const label = `<text class="x-node-label" x="${cx}" y="${r1(top + nodeLabel / 2)}" text-anchor="middle" dominant-baseline="central">${esc(a.label)}</text>`;
  const sub = a.sub
    ? `<text class="x-node-sub" x="${cx}" y="${r1(top + nodeLabel + 4 + nodeSub / 2)}" text-anchor="middle" dominant-baseline="central">${esc(a.sub)}</text>`
    : "";
  const aria = a.about ? `${a.label}. ${a.about}` : a.label;
  return `<g class="x-node"${attr("data-id", a.id)}${attr("data-kind", a.kind)} data-focal="${a.focal}" tabindex="0" role="button"${attr("aria-label", aria)}><rect class="x-node-box" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${HEAD_H}" rx="${theme.radius}"/>${label}${sub}</g>`;
}

const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function render(block: Sequence, ctx: RenderContext): string {
  const { theme } = ctx;
  const { pad } = theme.grid;
  const [cellW] = theme.grid.cell;
  const { unit } = theme.grid;
  const count = block.actors.length;
  // Actors close up (never below MIN_GAP apart) until the figure fits MAX_W.
  const fit = count > 1 ? Math.floor((MAX_W - 2 * pad - cellW) / (count - 1) / unit) * unit : Infinity;
  const pitchX = Math.max(cellW + MIN_GAP, Math.min(cellW + theme.grid.gap[0], fit));
  const fid = block.id;
  const lane = new Map(block.actors.map((a, i) => [a.id, pad + i * pitchX + cellW / 2]));
  const lanes = [...lane.values()];
  // Sans at the edge-label size: the mask pads the label at rest and still covers it when it turns semibold on selection.
  const labelW = (s: string) => Math.max(textWidth(s, theme.type.edgeLabel, "sans") + 2 * MASK_PAD, boldWidth(s, theme.type.edgeLabel) + 2);
  const tagPx = theme.type.tag;
  const n = block.messages.length;
  const yOf = (k: number) => pad + HEAD_H + FIRST + k * PITCH;
  const bars = activations(block);
  const busy = (id: string, k: number) => (bars.get(id) ?? []).some(([a, b]) => k >= a && k <= b);
  let right = pad + (count - 1) * pitchX + cellW;
  // A label right of the last lane stays inside the width the actors already need, or MAX_W.
  const limit = Math.max(MAX_W, right + pad) - pad;
  let bottom = pad + HEAD_H;
  const edges: string[] = [];
  const labels: string[] = [];
  const nums: string[] = [];
  const anchors: Record<string, Rect> = {};
  const obstacles: Rect[] = [];
  const warn = (message: string) => ctx.warn({ rule: "edge-label", severity: "warn", message, line: block.line });

  block.messages.forEach((m, k) => {
    const y = yOf(k);
    const sx = lane.get(m.from)!;
    const tx = lane.get(m.to)!;
    const self = m.from === m.to;
    const dir = tx >= sx ? 1 : -1;
    const x0 = sx + dir * (busy(m.from, k) ? ACT : 0);
    const x1 = tx - dir * ((busy(m.to, k) ? ACT : 0) + 2);
    const d = self ? selfLoop(sx + (busy(m.from, k) ? ACT : 0), y) : `M${r1(x0)},${r1(y)} H${r1(x1)}`;
    const marker = m.kind === "link" ? "arrow-link" : m.kind === "async" ? "arrow-open" : "arrow";
    bottom = y + (self ? SELF_H : 0);

    // The number sits past the sender's bar, on the side the arrow leaves toward.
    const num = String(k + 1);
    const nw = textWidth(num, tagPx, "sans");
    const nx = self ? sx + ACT + NUM_GAP : x0 + dir * NUM_GAP;
    const numBox: Rect = { x: dir > 0 || self ? nx : nx - nw, y: y - 4 - tagPx, w: nw, h: tagPx };
    nums.push(`<text class="x-seq-num"${attr("data-for", m.id)} x="${r1(nx)}" y="${r1(y - 4)}"${dir < 0 && !self ? ' text-anchor="end"' : ""}>${num}</text>`);
    obstacles.push(numBox);

    let box: Rect | null = null;
    if (m.label) {
      const w = labelW(m.label);
      if (self) {
        // Right of the loop when it clears the next lifeline, else left of the sender's lifeline.
        const next = lanes.find((x) => x > sx) ?? limit + CLEAR, prev = [...lanes].reverse().find((x) => x < sx) ?? -Infinity;
        const top = y + SELF_H / 2 - LABEL_H / 2;
        const rightX = sx + SELF_W + ACT + 6, leftX = sx - ACT - 6 - w;
        const fitsRight = rightX + w <= next - CLEAR, fitsLeft = leftX >= prev + CLEAR;
        if (!fitsRight && !fitsLeft) warn(`Message ${k + 1} label "${m.label}" is wider than the space beside its loop and crosses a lifeline; shorten it.`);
        box = { x: fitsRight || !fitsLeft ? rightX : leftX, y: top, w, h: LABEL_H };
      } else {
        // Between two neighbouring lifelines inside the span, nearest the middle; a label never sits on a lifeline.
        const lo = Math.min(sx, tx), hi = Math.max(sx, tx), mid = (lo + hi) / 2;
        const inside = lanes.filter((x) => x >= lo && x <= hi).sort((a, b) => a - b);
        const gaps = inside.slice(1).map((x, i) => [inside[i] + ACT + CLEAR, x - ACT - CLEAR] as const)
          .sort((a, b) => Math.abs((a[0] + a[1]) / 2 - mid) - Math.abs((b[0] + b[1]) / 2 - mid));
        const top = y - LABEL_GAP - LABEL_H;
        const spots = gaps.filter(([a, b]) => b - a >= w).flatMap(([a, b]) => {
          const c = (a + b) / 2 - w / 2;
          return [c, dir > 0 ? b - w : a, dir > 0 ? a : b - w].map((x) => ({ x, y: top, w, h: LABEL_H }));
        });
        box = spots.find((s) => !obstacles.some((o) => hit(s, o))) ?? spots[0] ?? null;
        if (!box) {
          const [a, b] = [...gaps].sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0] ?? [lo, hi];
          warn(`Message ${k + 1} label "${m.label}" is wider than the gap between lifelines and crosses one; shorten it or move the actors apart.`);
          box = { x: (a + b) / 2 - w / 2, y: top, w, h: LABEL_H };
        } else if (obstacles.some((o) => hit(box!, o))) box = { ...box, y: y + LABEL_GAP };
      }
      obstacles.push(box);
      right = Math.max(right, box.x + box.w);
      labels.push(
        `<g class="x-edge-label"${attr("data-for", m.id)}><rect class="x-edge-mask" x="${r1(box.x)}" y="${r1(box.y)}" width="${r1(box.w)}" height="${LABEL_H}" rx="2"/>` +
          `<text class="x-edge-text" x="${r1(box.x + box.w / 2)}" y="${r1(box.y + LABEL_H / 2)}" text-anchor="middle" dominant-baseline="central">${esc(m.label)}</text></g>`,
      );
    }
    const anchor = box ?? (self ? { x: sx + SELF_W, y: y + SELF_H / 2, w: 0, h: 0 } : { x: (x0 + x1) / 2, y, w: 0, h: 0 });
    anchors[m.id] = anchor;
    const from = block.actors.find((a) => a.id === m.from)!.label, to = block.actors.find((a) => a.id === m.to)!.label;
    const aria = `Message ${k + 1} of ${n}: ${from} to ${to}${m.label ? `, ${m.label}` : ""}`;
    edges.push(
      `<g class="x-edge"${attr("data-id", m.id)}${attr("data-from", m.from)}${attr("data-to", m.to)}${attr("data-kind", m.kind)} data-nav="${k},0" tabindex="0" role="button"${attr("aria-label", aria)}>` +
        `<path class="x-edge-line" d="${d}" marker-end="url(#${esc(fid)}-${marker})"/><path class="x-edge-hit" d="${d}"/>` +
        `<rect class="x-anchor" x="${r1(anchor.x)}" y="${r1(anchor.y)}" width="${r1(anchor.w)}" height="${r1(anchor.h)}"/></g>`,
    );
  });

  const lifeEnd = bottom + TAIL;
  const lifelines = block.actors
    .map((a) => {
      const x = r1(lane.get(a.id)!);
      return `<line class="x-lifeline"${attr("data-for", a.id)} x1="${x}" y1="${r1(pad + HEAD_H)}" x2="${x}" y2="${r1(lifeEnd)}"/>`;
    })
    .join("");
  const activation = block.actors
    .flatMap((a) => (bars.get(a.id) ?? []).map(([s, e]) => {
      const self = block.messages[e].from === block.messages[e].to;
      const y0 = yOf(s) - 8, y1 = yOf(e) + (self ? SELF_H : 0) + 8;
      return `<rect class="x-activation"${attr("data-for", a.id)} x="${r1(lane.get(a.id)! - ACT)}" y="${r1(y0)}" width="${ACT * 2}" height="${r1(y1 - y0)}"/>`;
    }))
    .join("");
  block.actors.forEach((a, i) => { anchors[a.id] = { x: pad + i * pitchX, y: pad, w: cellW, h: HEAD_H }; });
  const nodes = block.actors.map((a, i) => actorNode(a, pad + i * pitchX, pad, theme)).join("");

  const ruleY = lifeEnd + 16;
  const width = right + pad;
  const legend = block.legend
    ? legendSvg({
      nodeKinds: new Set(block.actors.map((a) => a.kind)),
      edgeKinds: new Set(block.messages.map((m) => m.kind)),
      focal: block.actors.some((a) => a.focal),
    }, theme, pad, width - pad, ruleY, "sequence")
    : null;
  const height = legend ? ruleY + legend.height : lifeEnd + pad;
  // Lifelines and arrows are lines: give them some thickness so a marker never sits on one.
  const lines: Rect[] = [
    ...lanes.map((x) => ({ x: x - 3, y: pad + HEAD_H, w: 6, h: lifeEnd - pad - HEAD_H })),
    ...block.messages.map((m, k) => ({ x: Math.min(lane.get(m.from)!, lane.get(m.to)!) - 3, y: yOf(k) - 3, w: Math.abs(lane.get(m.to)! - lane.get(m.from)!) + (m.from === m.to ? SELF_W : 0) + 6, h: 6 + (m.from === m.to ? SELF_H : 0) })),
  ];
  const markers = notes(block, anchors, { obstacles: [...obstacles, ...lines], bounds: { x: 0, y: 0, w: width, h: lifeEnd } });

  const names = joinList(block.actors.map((a) => a.label));
  const title = block.title ?? `Sequence between ${names}`;
  const desc = `Sequence of ${plural(n, "message")} between ${names}.`;
  const caption = block.title ? `<figcaption class="x-figure-title">${esc(block.title)}</figcaption>` : "";
  const f = esc(fid);

  return (
    `<figure class="x-figure"${attr("data-figure", fid)} data-layout="sequence">${caption}` +
    `<svg class="x-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(width)} ${r1(height)}" width="${r1(width)}" height="${r1(height)}" role="group" aria-label="${esc(title)}" aria-describedby="${f}-desc">` +
    `<desc id="${f}-desc">${esc(desc)}</desc>${defs(fid)}` +
    `${lifelines}${activation}${edges.join("")}${nums.join("")}${labels.join("")}${nodes}${legend?.svg ?? ""}${markers}</svg></figure>`
  );
}

/** Message ids on the path, plus the first unused message between consecutive actors (either direction). */
function sceneEdges(block: SequenceBlock, path: string[]): string[] {
  const actors = new Set(block.actors.map((a) => a.id));
  const out: string[] = [];
  path.forEach((step, i) => {
    if (!actors.has(step)) {
      if (!out.includes(step)) out.push(step);
      return;
    }
    const prev = path[i - 1];
    if (prev === undefined || !actors.has(prev)) return;
    const unused = (from: string, to: string) => block.messages.find((m) => m.from === from && m.to === to && !out.includes(m.id));
    const hit = unused(prev, step) ?? unused(step, prev);
    if (hit) out.push(hit.id);
  });
  return out;
}

/** "messages 2–3, 6–7": the runs an activation bar covers. */
function spans(runs: [number, number][]): string {
  return runs.map(([a, b]) => (a === b ? `${a + 1}` : `${a + 1}–${b + 1}`)).join(", ");
}

function model(block: Sequence): Partial<DocModel> {
  const elements: Record<string, ElementInfo> = {};
  const name = new Map(block.actors.map((a) => [a.id, a.label]));
  const msgs = block.messages;
  const n = msgs.length;
  const bars = activations(block);
  const cite = (j: number) => `message ${j + 1}${msgs[j].label ? ` · ${msgs[j].label}` : ""}`;
  for (const a of block.actors) {
    const mine = msgs.map((m, k) => [m, k] as const).filter(([m]) => m.from === a.id || m.to === a.id);
    const sent = mine.filter(([m]) => m.from === a.id).length, got = mine.filter(([m]) => m.to === a.id).length;
    // Its messages in time order, numbered, each with the other party: "2 ← Web app", "3 → Email provider".
    const links: Link[] = mine.map(([m, k]) => ({
      rel: m.from === m.to ? `${k + 1} ↻` : m.from === a.id ? `${k + 1} → ${name.get(m.to)}` : `${k + 1} ← ${name.get(m.from)}`,
      ids: [m.id],
    }));
    const facts: Fact[] = factList([
      { k: "Sends", v: plural(sent, "message") },
      { k: "Receives", v: plural(got, "message") },
      bars.get(a.id)!.length ? { k: "Busy during", v: `messages ${spans(bars.get(a.id)!)}` } : null,
    ]);
    elements[a.id] = {
      id: a.id, type: "node", label: a.label, kind: NODE_WORDS[a.kind], figure: block.id,
      ...(a.sub ? { sub: a.sub } : {}), ...(a.about ? { about: a.about } : {}),
      facts, ...(links.length ? { links } : {}),
      say: `${a.label}, ${NODE_WORDS[a.kind]}, in ${plural(mine.length, "message")}`,
    };
  }
  msgs.forEach((m, k) => {
    // A reply names the request it answers, and a request names the reply it gets.
    const reply = m.kind === "return" ? -1 : msgs.findIndex((r, j) => j > k && r.kind === "return" && r.from === m.to && r.to === m.from);
    const asked = m.kind !== "return" ? -1 : msgs.map((r, j) => [r, j] as const).filter(([r, j]) => j < k && r.kind !== "return" && r.from === m.to && r.to === m.from).pop()?.[1] ?? -1;
    elements[m.id] = {
      id: m.id,
      type: "edge",
      label: m.label ?? "",
      kind: "message",
      from: m.from,
      to: m.to,
      figure: block.id,
      ...(m.about ? { about: m.about } : {}),
      pos: `${k + 1} / ${n} · ${EDGE_WORDS[m.kind]}`,
      facts: factList([
        reply >= 0 ? { k: "Answered by", v: cite(reply), ref: msgs[reply].id } : null,
        asked >= 0 ? { k: "Answers", v: cite(asked), ref: msgs[asked].id } : null,
      ]),
      links: [
        ...(k > 0 ? [{ rel: "‹ Previous", ids: [msgs[k - 1].id] }] : []),
        ...(k < n - 1 ? [{ rel: "Next ›", ids: [msgs[k + 1].id] }] : []),
      ],
      say: `Message ${k + 1} of ${n}: ${name.get(m.from)} to ${name.get(m.to)}${m.label ? `, ${m.label}` : ""}`,
    };
    const info = elements[m.id];
    if (!info.facts?.length) delete info.facts;
    if (!info.links?.length) delete info.links;
  });
  const scenes: DocModel["scenes"] = {};
  for (const s of block.scenes) scenes[s.id] = { ...s, figure: block.id, edges: sceneEdges(block, s.path) };
  return { elements, scenes };
}

function reading(block: Sequence): string {
  const focal = block.actors.filter((a) => a.focal).map((a) => a.label);
  const bars = [...activations(block).values()].some((r) => r.length);
  return [
    "Time runs down the page: each arrow is one message, numbered in the order it is sent.",
    lineKey("sequence", new Set(block.messages.map((m) => m.kind))),
    bars ? "A bar on a lifeline shows when that part is busy handling a message." : "",
    focal.length ? `Accent marks ${joinList(focal)}, the part this page is about.` : "",
  ].filter(Boolean).join(" ");
}

function table(block: Sequence): DataTable {
  const name = new Map(block.actors.map((a) => [a.id, a.label]));
  return {
    head: ["#", "From", "To", "Message", "Kind"],
    rows: block.messages.map((m, k) => [String(k + 1), name.get(m.from)!, name.get(m.to)!, m.label ?? "", EDGE_WORDS[m.kind]]),
  };
}

export const sequence = { normalize, render, model, reading, table };
