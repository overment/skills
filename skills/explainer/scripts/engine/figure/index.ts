import {
  BUDGET, SpecError,
  type BlockModule, type DataTable, type DocModel, type EdgeKind, type EdgeSpec, type ElementInfo, type Fact, type FigureBlock,
  type GroupSpec, type Layout, type Link, type NodeKind, type NodeSpec, type RawBlock, type ReadingSpec, type RenderContext,
  type SceneSpec, type SequenceBlock,
} from "../types.ts";
import { READING_KEYS, factList, readingSpec } from "../kit.ts";
import { sequence, type Sequence } from "../blocks/sequence.ts";
import { cellRect, textWidth } from "./grid.ts";
import { EDGE_WORDS, edgeWord, lineKey, nodeWord, renderFigure } from "./render.ts";

/** A grid figure with the expanded-view keys (notes, caveat, story). */
export type Figure = FigureBlock & ReadingSpec;

type Obj = Record<string, unknown>;

const LAYOUTS: readonly Layout[] = ["flow", "layers", "hub", "states", "zones", "tree", "cycle", "sequence"];
const NODE_KINDS: readonly NodeKind[] = ["actor", "service", "store", "external", "boundary", "optional", "decision"];
const EDGE_KINDS: readonly EdgeKind[] = ["flow", "return", "async", "link"];
const GROUP_KINDS = ["zone", "trust"] as const;
/** The generic reach facts every node gets; layouts with a fact of their own (hub, tree, cycle…) drop them. */
const REACH = new Set(["Downstream", "Upstream", "In a loop with", "Leads out to", "Comes in from"]);
const FIGURE_KEYS = ["id", "layout", "title", "grid", "nodes", "edges", "groups", "scenes", "legend", ...READING_KEYS];
const SEQUENCE_KEYS = [...FIGURE_KEYS, "actors", "messages"];
const NODE_KEYS = ["label", "sub", "at", "span", "kind", "focal", "about", "tags"];
const EDGE_KEYS = ["from", "to", "label", "kind", "about"];
const GROUP_KEYS = ["label", "from", "to", "kind", "about"];
const SCENE_KEYS = ["title", "path", "notes"];
const FIGURE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const ELEMENT_ID = /^\w(?:[\w-]*\w)?$/;
const ARROW = /^(\S+?)\s*(-->|->|~>|=>)\s*(\S+)$/;
const ARROW_KINDS: Record<string, EdgeKind> = { "-->": "return", "->": "flow", "~>": "async", "=>": "link" };

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isSequence = (b: Figure | Sequence): b is Sequence => b.layout === "sequence";

function fail(message: string, line: number, rule = "spec"): never {
  throw new SpecError(message, line, rule);
}

function checkKeys(o: Obj, allowed: readonly string[], where: string, line: number) {
  for (const k of Object.keys(o)) {
    if (allowed.includes(k)) continue;
    // A sentence as a key means an unquoted comma split a value inside `{ … }`.
    const hint = k.includes(" ") ? ` It looks like text after a comma; wrap the text in quotes: about: "…, …".` : "";
    fail(`Unknown field "${k}" in ${where}. Allowed: ${allowed.join(", ")}.${hint}`, line);
  }
}

function text(v: unknown, what: string, line: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  fail(`${what} must be plain text.`, line);
}

function oneOf<T extends string>(v: unknown, list: readonly T[], what: string, line: number): T {
  if (typeof v !== "string" || !list.includes(v as T)) fail(`${what} must be one of: ${list.join(", ")}.`, line);
  return v as T;
}

function cellPair(v: unknown, what: string, line: number, min: number): [number, number] {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isInteger(n) && n >= min)) {
    fail(`${what} must be two whole numbers of at least ${min}, like [1, 2].`, line);
  }
  return [v[0] as number, v[1] as number];
}

function opt<T extends Obj>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function readNodes(v: unknown, line: number): NodeSpec[] {
  const entries: [string, unknown, boolean][] = [];
  if (Array.isArray(v)) {
    for (const item of v) {
      if (!isObj(item) || typeof item.id !== "string") fail("Each node in a list needs an id.", line);
      entries.push([item.id, item, true]);
    }
  } else if (isObj(v)) {
    for (const [id, fields] of Object.entries(v)) entries.push([id, fields, false]);
  } else {
    fail("Figure needs nodes: a map of id → { label, at } or a list with ids.", line);
  }
  if (!entries.length) fail("Figure needs at least one node.", line);
  const seen = new Set<string>();
  return entries.map(([id, f, listed]) => {
    if (!ELEMENT_ID.test(id)) fail(`Node id "${id}" may only use letters, digits, "-" and "_".`, line);
    if (seen.has(id)) fail(`Node id "${id}" is used twice.`, line, "id-unique");
    seen.add(id);
    if (!isObj(f)) fail(`Node "${id}" needs fields, like { label: Gateway, at: [0, 0] }.`, line);
    checkKeys(f, listed ? ["id", ...NODE_KEYS] : NODE_KEYS, `node "${id}"`, line);
    const label = text(f.label, `Node "${id}" label`, line);
    if (!label) fail(`Node "${id}" needs a label.`, line);
    if (f.at === undefined) fail(`Node "${id}" needs at: [col, row].`, line);
    const at = cellPair(f.at, `Node "${id}" at`, line, 0);
    const span: [number, number] =
      f.span === undefined ? [1, 1] :
      typeof f.span === "number" ? cellPair([f.span, 1], `Node "${id}" span`, line, 1) :
      cellPair(f.span, `Node "${id}" span`, line, 1);
    const kind = f.kind === undefined ? "service" : oneOf(f.kind, NODE_KINDS, `Node "${id}" kind`, line);
    if (f.focal !== undefined && typeof f.focal !== "boolean") fail(`Node "${id}" focal must be true or false.`, line);
    if (f.tags !== undefined && (!Array.isArray(f.tags) || !f.tags.every((t) => typeof t === "string"))) {
      fail(`Node "${id}" tags must be a list of words.`, line);
    }
    return {
      id, label, at, span, kind,
      focal: f.focal === true,
      tags: (f.tags as string[] | undefined) ?? [],
      ...opt({ sub: text(f.sub, `Node "${id}" sub`, line), about: text(f.about, `Node "${id}" about`, line) }),
    };
  });
}

function arrow(head: string, line: number): { from: string; to: string; kind: EdgeKind } {
  const m = head.trim().match(ARROW);
  if (!m) fail(`Cannot read connector "${head}". Write it like "a -> b: label" (arrows: -> --> ~> =>).`, line);
  return { from: m[1], to: m[3], kind: ARROW_KINDS[m[2]] };
}

function readEdge(item: unknown, line: number): Omit<EdgeSpec, "id"> {
  if (typeof item === "string") {
    const i = item.indexOf(":");
    const base = arrow(i < 0 ? item : item.slice(0, i), line);
    return { ...base, ...opt({ label: i < 0 ? undefined : text(item.slice(i + 1), "Connector label", line) }) };
  }
  if (isObj(item) && ("from" in item || "to" in item)) {
    checkKeys(item, EDGE_KEYS, "connector", line);
    const from = text(item.from, "Connector from", line), to = text(item.to, "Connector to", line);
    if (!from || !to) fail("A connector written as an object needs both from and to.", line);
    const kind = item.kind === undefined ? "flow" : oneOf(item.kind, EDGE_KINDS, "Connector kind", line);
    return { from, to, kind, ...opt({ label: text(item.label, "Connector label", line), about: text(item.about, "Connector about", line) }) };
  }
  if (isObj(item) && Object.keys(item).length === 1) {
    const [head, value] = Object.entries(item)[0];
    const base = arrow(head, line);
    if (isObj(value)) {
      checkKeys(value, ["label", "about"], `connector "${head}"`, line);
      return { ...base, ...opt({ label: text(value.label, "Connector label", line), about: text(value.about, "Connector about", line) }) };
    }
    return { ...base, ...opt({ label: text(value, "Connector label", line) }) };
  }
  fail(`Cannot read connector ${JSON.stringify(item)}. Write it like "a -> b: label".`, line);
}

function readEdges(v: unknown, nodeIds: Set<string>, fid: string, line: number): EdgeSpec[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(`edges must be a list, like "- a -> b: label".`, line);
  const counts = new Map<string, number>();
  return v.map((item) => {
    const e = readEdge(item, line);
    for (const end of [e.from, e.to]) {
      if (!nodeIds.has(end)) fail(`Connector ${e.from} -> ${e.to} points at "${end}", which is not a node in figure "${fid}".`, line, "ref-exists");
    }
    const base = `${e.from}->${e.to}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return { id: n === 1 ? base : `${base}#${n}`, ...e };
  });
}

function readGroups(v: unknown, nodeIds: Set<string>, line: number): GroupSpec[] {
  if (v === undefined || v === null) return [];
  if (!isObj(v)) fail("groups must be a map of id → { label, from, to }.", line);
  return Object.entries(v).map(([id, g]) => {
    if (!ELEMENT_ID.test(id)) fail(`Group id "${id}" may only use letters, digits, "-" and "_".`, line);
    if (nodeIds.has(id)) fail(`Group id "${id}" is already used by a node.`, line, "id-unique");
    if (!isObj(g)) fail(`Group "${id}" needs fields, like { label: Core, from: [1, 0], to: [2, 1] }.`, line);
    checkKeys(g, GROUP_KEYS, `group "${id}"`, line);
    const label = text(g.label, `Group "${id}" label`, line);
    if (!label) fail(`Group "${id}" needs a label.`, line);
    const a = cellPair(g.from, `Group "${id}" from`, line, 0);
    const b = cellPair(g.to, `Group "${id}" to`, line, 0);
    const kind = g.kind === undefined ? "zone" : oneOf(g.kind, GROUP_KINDS, `Group "${id}" kind`, line);
    return {
      id, label, kind,
      from: [Math.min(a[0], b[0]), Math.min(a[1], b[1])] as [number, number],
      to: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] as [number, number],
      ...opt({ about: text(g.about, `Group "${id}" about`, line) }),
    };
  });
}

function readScenes(v: unknown, nodeIds: Set<string>, line: number): SceneSpec[] {
  if (v === undefined || v === null) return [];
  if (!isObj(v)) fail("scenes must be a map of id → { title, path }.", line);
  return Object.entries(v).map(([id, s]) => {
    if (!ELEMENT_ID.test(id)) fail(`Scene id "${id}" may only use letters, digits, "-" and "_".`, line);
    if (!isObj(s)) fail(`Scene "${id}" needs a title and a path.`, line);
    checkKeys(s, SCENE_KEYS, `scene "${id}"`, line);
    const title = text(s.title, `Scene "${id}" title`, line);
    if (!title) fail(`Scene "${id}" needs a title.`, line);
    if (!Array.isArray(s.path) || !s.path.length) fail(`Scene "${id}" needs a path: a list of node ids.`, line);
    const path = s.path.map(String);
    for (const p of path) if (!nodeIds.has(p)) fail(`Scene "${id}" steps through "${p}", which is not a node.`, line, "ref-exists");
    const notes: Record<string, string> = {};
    if (s.notes !== undefined && s.notes !== null) {
      if (!isObj(s.notes)) fail(`Scene "${id}" notes must be a map of node id → note.`, line);
      for (const [k, note] of Object.entries(s.notes)) {
        if (!path.includes(k)) fail(`Scene "${id}" has a note for "${k}", which is not on its path.`, line, "ref-exists");
        notes[k] = text(note, `Scene "${id}" note`, line) ?? "";
      }
    }
    return { id, title, path, notes };
  });
}

function inferGrid(nodes: NodeSpec[], groups: GroupSpec[]): [number, number] {
  let cols = 1, rows = 1;
  for (const n of nodes) { cols = Math.max(cols, n.at[0] + n.span[0]); rows = Math.max(rows, n.at[1] + n.span[1]); }
  for (const g of groups) { cols = Math.max(cols, g.to[0] + 1); rows = Math.max(rows, g.to[1] + 1); }
  return [cols, rows];
}

function checkPlacement(nodes: NodeSpec[], groups: GroupSpec[], [cols, rows]: [number, number], line: number) {
  const taken = new Map<string, string>();
  for (const n of nodes) {
    if (n.at[0] + n.span[0] > cols || n.at[1] + n.span[1] > rows) {
      fail(`Node "${n.id}" at [${n.at.join(", ")}] sits outside the ${cols}×${rows} grid; move it or enlarge grid.`, line, "grid-bounds");
    }
    for (let c = n.at[0]; c < n.at[0] + n.span[0]; c++) {
      for (let r = n.at[1]; r < n.at[1] + n.span[1]; r++) {
        const other = taken.get(`${c},${r}`);
        if (other) fail(`Nodes "${other}" and "${n.id}" both occupy cell [${c}, ${r}]; move one of them.`, line, "grid-collision");
        taken.set(`${c},${r}`, n.id);
      }
    }
  }
  for (const g of groups) {
    if (g.to[0] >= cols || g.to[1] >= rows) fail(`Group "${g.id}" reaches past the ${cols}×${rows} grid.`, line, "grid-bounds");
  }
}

/** For each consecutive pair on the path: the first a->b edge, else the first b->a edge. */
function sceneEdges(path: string[], edges: EdgeSpec[]): { edges: string[]; missing: [string, string][] } {
  const out: string[] = [];
  const missing: [string, string][] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const e = edges.find((x) => x.from === a && x.to === b) ?? edges.find((x) => x.from === b && x.to === a);
    e ? out.push(e.id) : missing.push([a, b]);
  }
  return { edges: out, missing };
}

function budget(fig: Figure, ctx: RenderContext) {
  const warn = (rule: string, message: string, severity: "warn" | "error" = "warn") =>
    ctx.warn({ rule, severity, message, line: fig.line });
  if (fig.nodes.length > BUDGET.nodes) {
    warn("budget-nodes", `Figure "${fig.id}" has ${fig.nodes.length} nodes; keep it to ${BUDGET.nodes} and move the rest into a detail figure.`);
  }
  if (fig.edges.length > BUDGET.edges) {
    warn("budget-edges", `Figure "${fig.id}" has ${fig.edges.length} connectors; keep it to ${BUDGET.edges}.`);
  }
  const focal = fig.nodes.filter((n) => n.focal).length;
  if (focal > BUDGET.focal) warn("budget-focal", `Figure "${fig.id}" marks ${focal} nodes focal; mark at most ${BUDGET.focal}.`, "error");
  for (const n of fig.nodes) {
    // A diamond is only about half its cell wide where the label sits, and has no room for a second line.
    const w = cellRect(n.at, n.span, ctx.theme).w;
    const room = n.kind === "decision" ? w / 2 : w - 24;
    if (textWidth(n.label, ctx.theme.type.nodeLabel, "sans") > room) {
      warn("label-fit", `Label "${n.label}" is wider than its ${n.kind === "decision" ? "diamond" : "node"}; shorten it or widen the node with span: [${n.span[0] + 1}, ${n.span[1]}].`);
    }
    if (n.kind === "decision" && n.sub) warn("label-fit", `Decision "${n.id}" has a sub line, which crosses the diamond's outline; put it in about instead.`);
  }
  const ids = new Set([...fig.nodes.map((n) => n.id), ...fig.edges.map((e) => e.id), ...fig.groups.map((g) => g.id)]);
  for (const note of fig.notes ?? []) {
    for (const id of note.on) if (!ids.has(id)) warn("ref-exists", `A note in figure "${fig.id}" points at "${id}", which is not a node, connector or group in it.`);
  }
  for (const s of fig.scenes) {
    for (const [a, b] of sceneEdges(s.path, fig.edges).missing) {
      warn("ref-exists", `Scene "${s.id}" steps from "${a}" to "${b}" but no connector joins them; add one or change the path.`);
    }
  }
}

function normalize(raw: RawBlock, ctx: RenderContext): Figure | Sequence {
  const line = raw.line;
  const d = raw.data;
  if (!isObj(d)) fail("A figure needs YAML fields: id, nodes, edges.", line);
  const layout = d.layout === undefined ? "flow" : oneOf(d.layout, LAYOUTS, "layout", line);
  checkKeys(d, layout === "sequence" ? SEQUENCE_KEYS : FIGURE_KEYS, "figure", line);
  if (typeof d.id !== "string" || !FIGURE_ID.test(d.id)) {
    fail(`Figure needs an id made of lowercase letters, digits, "-" or "_", like "auth".`, line);
  }
  if (layout === "sequence") return sequence.normalize(raw, ctx);

  const id = d.id;
  const nodes = readNodes(d.nodes, line);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = readEdges(d.edges, nodeIds, id, line);
  const groups = readGroups(d.groups, nodeIds, line);
  const grid = d.grid === undefined ? inferGrid(nodes, groups) : cellPair(d.grid, "grid", line, 1);
  checkPlacement(nodes, groups, grid, line);
  const scenes = readScenes(d.scenes, nodeIds, line);
  if (d.legend !== undefined && typeof d.legend !== "boolean") fail("legend must be true or false.", line);
  const legend = (d.legend as boolean | undefined) ??
    (new Set(nodes.map((n) => n.kind)).size > 1 || new Set(edges.map((e) => e.kind)).size > 1 || nodes.some((n) => n.focal));

  const fig: Figure = {
    type: "figure", id, layout,
    ...opt({ title: text(d.title, "title", line) }),
    grid, nodes, edges, groups, scenes, legend, line,
    ...readingSpec(d, line),
  };
  budget(fig, ctx);
  return fig;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Card fields for one element; `related` joins the ids the client lights with it. */
type Card = { related?: string[]; facts?: (Fact | null)[]; links?: Link[]; context?: string[]; pos?: string; crumb?: string[]; kind?: string };

/**
 * Relations in reading order, what comes in before what goes out, in the author's words: "confirms ←" Payment provider,
 * "charges card →" Payment provider. An unlabelled connector gets a bare arrow, never an invented verb.
 * Connectors with the same words share a row.
 */
function verbLinks(outs: EdgeSpec[], ins: EdgeSpec[]): Link[] {
  const rows = new Map<string, string[]>();
  const put = (rel: string, id: string) => {
    const ids = rows.get(rel) ?? [];
    if (!ids.includes(id)) rows.set(rel, [...ids, id]);
  };
  for (const e of ins) put(e.label ? `${e.label} ←` : "←", e.from);
  for (const e of outs) put(e.label ? `${e.label} →` : "→", e.to);
  return [...rows].map(([rel, ids]) => ({ rel, ids }));
}

function layoutCards(block: Figure): Map<string, Card> {
  const node = new Map(block.nodes.map((n) => [n.id, n]));
  const label = (id: string) => node.get(id)?.label ?? id;
  const reading = (a: string, b: string) => {
    const p = node.get(a)!, q = node.get(b)!;
    return p.at[1] - q.at[1] || p.at[0] - q.at[0];
  };
  const edges = block.edges.filter((e) => e.from !== e.to);
  const outs = (id: string) => edges.filter((e) => e.from === id).sort((a, b) => reading(a.to, b.to));
  const ins = (id: string) => edges.filter((e) => e.to === id).sort((a, b) => reading(a.from, b.from));
  const walk = (id: string, next: (id: string) => string[]) => {
    const seen = new Set<string>();
    const queue = next(id);
    while (queue.length) {
      const n = queue.shift()!;
      if (n === id || seen.has(n)) continue;
      seen.add(n);
      queue.push(...next(n));
    }
    return seen;
  };
  const down = (id: string) => walk(id, (n) => outs(n).map((e) => e.to));
  const up = (id: string) => walk(id, (n) => ins(n).map((e) => e.from));
  const edgesAmong = (ids: Set<string>) => edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => e.id);
  const inside = (n: NodeSpec, g: GroupSpec) => n.at[0] >= g.from[0] && n.at[0] <= g.to[0] && n.at[1] >= g.from[1] && n.at[1] <= g.to[1];
  const zonesOf = (id: string) => block.groups.filter((g) => inside(node.get(id)!, g));
  const members = (g: GroupSpec) => new Set(block.nodes.filter((n) => inside(n, g)).map((n) => n.id));

  const groupBy = (list: EdgeSpec[], key: (e: EdgeSpec) => string) => {
    const out = new Map<string, EdgeSpec[]>();
    for (const e of list) out.set(key(e), [...(out.get(key(e)) ?? []), e]);
    return [...out];
  };

  const cards = new Map<string, Card>();
  const card = (id: string, c: Card) => {
    const prev = cards.get(id) ?? {};
    cards.set(id, {
      ...prev, ...c,
      related: [...(prev.related ?? []), ...(c.related ?? [])],
      // A layout's own facts are the point of the card; the generic reach counts come after them.
      facts: [...(c.facts ?? []), ...(prev.facts ?? [])],
      links: [...(prev.links ?? []), ...(c.links ?? [])],
      context: [...(prev.context ?? []), ...(c.context ?? [])],
    });
  };

  // Every node: relations in its own words and what it can reach, so "what breaks if this is down" has an answer.
  // A node on a cycle reaches every part of it both ways, so there it names the loop and counts only what lies outside.
  for (const n of block.nodes) {
    const d = down(n.id), u = up(n.id);
    const direct = new Set(outs(n.id).map((e) => e.to));
    const far = new Set([...d].filter((id) => !direct.has(id)));
    // a reply (`-->`) going back to its caller is a round trip, not a loop, so loops follow forward edges only
    const fwdUp = walk(n.id, (x) => ins(x).filter((e) => e.kind !== "return").map((e) => e.from));
    const loop = [...walk(n.id, (x) => outs(x).filter((e) => e.kind !== "return").map((e) => e.to))].filter((id) => fwdUp.has(id));
    const outside = (s: Set<string>) => [...s].filter((id) => !loop.includes(id)).length;
    card(n.id, {
      links: [...verbLinks(outs(n.id), ins(n.id)), ...(loop.length ? [{ rel: "In a loop with", ids: loop }] : [])],
      context: [...far, ...edgesAmong(new Set([...d]))],
      facts: loop.length
        ? [
          { k: "In a loop with", v: plural(loop.length, "part") },
          outside(d) ? { k: "Leads out to", v: plural(outside(d), "part") } : null,
          outside(u) ? { k: "Comes in from", v: plural(outside(u), "part") } : null,
        ]
        // a count that only repeats the relation chips below it says nothing: reach shows once it goes past them
        : [
          far.size ? { k: "Downstream", v: plural(d.size, "part") } : null,
          u.size > new Set(ins(n.id).map((e) => e.from)).size ? { k: "Upstream", v: plural(u.size, "part") } : null,
        ],
    });
  }

  // Edges: the reverse connector between the same pair, if there is one.
  for (const e of edges) {
    const back = edges.filter((x) => x.from === e.to && x.to === e.from).map((x) => x.id);
    if (back.length) card(e.id, { links: [{ rel: "Paired with", ids: back }] });
  }

  // Zones: the containing zone stays lit with a node; a zone lists what crosses its border.
  for (const g of block.groups) {
    const inner = members(g);
    const crossIn = edges.filter((e) => inner.has(e.to) && !inner.has(e.from));
    const crossOut = edges.filter((e) => inner.has(e.from) && !inner.has(e.to));
    card(g.id, {
      related: [...crossIn, ...crossOut].flatMap((e) => [e.id, inner.has(e.from) ? e.to : e.from]),
      context: edgesAmong(inner),
      // Chips name parts, not connectors: "Crossing in from API gateway" → Catalog, Cart, Orders.
      links: [
        ...groupBy(crossIn, (e) => e.from).map(([from, es]) => ({ rel: `Crossing in from ${label(from)}`, ids: es.map((e) => e.to) })),
        ...groupBy(crossOut, (e) => e.from).map(([from, es]) => ({ rel: `Crossing out from ${label(from)}`, ids: es.map((e) => e.to) })),
      ],
      facts: [
        { k: "Parts inside", v: String(inner.size) },
        crossIn.length ? null : { k: "Reachable from outside", v: "nothing" },
        { k: "Crossing edges", v: `${crossIn.length} in, ${crossOut.length} out` },
      ],
    });
    for (const id of inner) {
      const crossing = [...crossIn, ...crossOut].filter((e) => e.from === id || e.to === id).length;
      card(id, { context: [g.id], facts: [crossing && block.layout === "zones" ? { k: `Crosses ${g.label}`, v: plural(crossing, "connector") } : null] });
    }
  }
  for (const n of block.nodes) {
    const zones = zonesOf(n.id);
    if (zones.length) card(n.id, { crumb: zones.map((g) => g.id) });
  }

  if (block.layout === "hub" && block.nodes.length > 1) {
    const degree = (id: string) => outs(id).length + ins(id).length;
    const hub = [...block.nodes].sort((a, b) => degree(b.id) - degree(a.id) || Number(b.focal) - Number(a.focal))[0];
    const spokes = new Set([...outs(hub.id).map((e) => e.to), ...ins(hub.id).map((e) => e.from)]);
    card(hub.id, { pos: "hub", facts: [{ k: "Connected", v: `${spokes.size} of ${block.nodes.length - 1} parts` }] });
    // Everything reaches everything through the hub, so reach counts say nothing about it.
    cards.get(hub.id)!.facts = cards.get(hub.id)!.facts!.filter((f) => f && !REACH.has(f.k));
    for (const id of spokes) {
      const peers = [...spokes].filter((p) => p !== id).sort(reading);
      // Peers stay at rest rather than lit: lighting every satellite would leave nothing to dim.
      card(id, { context: peers, facts: [{ k: `Shares ${hub.label} with`, v: plural(peers.length, "other part") }] });
    }
  }

  if (block.layout === "layers") {
    const tiers = block.nodes.filter((n) => n.at[0] === 0).sort((a, b) => a.at[1] - b.at[1]);
    const tierIds = new Set(tiers.map((t) => t.id));
    tiers.forEach((t, i) => {
      const above = tiers.slice(0, i);
      const side = [...outs(t.id).map((e) => e.to), ...ins(t.id).map((e) => e.from)].filter((id) => !tierIds.has(id));
      const path = new Set([...above.map((a) => a.id), t.id]);
      card(t.id, {
        kind: "tier",
        pos: `${i + 1} of ${tiers.length}`,
        // Above / below / beside replace the arrows: in a stack the position is the relation.
        links: [
          { rel: "Above", ids: i ? [tiers[i - 1].id] : [] },
          { rel: "Below", ids: i < tiers.length - 1 ? [tiers[i + 1].id] : [] },
          { rel: "Side services", ids: side },
        ],
        context: [...above.map((a) => a.id), ...edgesAmong(path)],
        facts: [above.length ? { k: "Reached through", v: above.map((a) => a.label).join(" › ") } : { k: "Reached through", v: "nothing; requests start here" }],
      });
      const c = cards.get(t.id)!;
      c.links = c.links!.filter((l) => ["Above", "Below", "Side services"].includes(l.rel));
      c.facts = c.facts!.filter((f) => f && !REACH.has(f.k));
    });
    for (const n of block.nodes) {
      if (tierIds.has(n.id)) continue;
      const tier = tiers.find((t) => [...outs(n.id), ...ins(n.id)].some((e) => e.from === t.id || e.to === t.id));
      if (tier) card(n.id, { pos: `beside tier ${tiers.indexOf(tier) + 1}` });
    }
  }

  if (block.layout === "tree") {
    const parent = new Map(edges.map((e) => [e.to, e.from]));
    const levels = (id: string): string[] => (parent.has(id) ? [...levels(parent.get(id)!), parent.get(id)!] : []);
    const depth = Math.max(...block.nodes.map((n) => levels(n.id).length)) + 1;
    for (const n of block.nodes) {
      const ancestors = levels(n.id);
      const subtree = down(n.id);
      const kids = outs(n.id).map((e) => e.to);
      const chain = new Set([...ancestors, n.id]);
      card(n.id, {
        related: [...ancestors, ...subtree, ...edges.filter((e) => chain.has(e.to) && chain.has(e.from)).map((e) => e.id), ...edgesAmong(new Set([n.id, ...subtree]))],
        crumb: ancestors,
        pos: `level ${ancestors.length + 1} of ${depth}`,
        links: [{ rel: "Parent", ids: ancestors.slice(-1) }, { rel: kids.length === 1 ? "Child" : "Children", ids: kids }],
        facts: [
          { k: "Descendants", v: String(subtree.size) },
          ...(ancestors.length ? [] : kids.map((k) => ({ k: label(k), v: plural(down(k).size, "descendant"), ref: k }))),
        ],
      });
      const c = cards.get(n.id)!;
      c.links = c.links!.filter((l) => ["Parent", "Child", "Children"].includes(l.rel));
      c.context = [];
      c.facts = c.facts!.filter((f) => f && !REACH.has(f.k));
    }
  }

  if (block.layout === "cycle") {
    const scene = block.scenes[0]?.path;
    const order: string[] = [];
    if (scene) for (const id of scene) if (!order.includes(id)) order.push(id);
    for (let id: string | undefined = block.nodes[0]?.id; id && !order.includes(id); id = outs(id)[0]?.to) order.push(id);
    for (const n of block.nodes) if (!order.includes(n.id)) order.push(n.id);
    order.forEach((id, i) => {
      card(id, { pos: `${i + 1} / ${order.length}`, context: [] });
      const c = cards.get(id)!;
      c.context = [];
      c.facts = c.facts!.filter((f) => f && !REACH.has(f.k));
      // the whole figure is the loop, so naming it on every phase says nothing
      c.links = c.links?.filter((l) => l.rel !== "In a loop with");
    });
  }

  if (block.layout === "states") {
    for (const n of block.nodes) {
      const reach = down(n.id);
      const unreachable = block.nodes.filter((m) => m.id !== n.id && !reach.has(m.id)).sort((a, b) => reading(a.id, b.id));
      const c = cards.get(n.id)!;
      c.facts = [];
      // "Paths from here": every state still reachable stays at rest, so "can a paid order still be cancelled?" shows.
      card(n.id, {
        pos: !outs(n.id).length ? "final" : !ins(n.id).length ? "start" : undefined,
        context: [...reach],
        facts: [
          reach.size ? { k: "Can still reach", v: plural(reach.size, "state") } : null,
          reach.size && unreachable.length ? { k: "Can no longer reach", v: unreachable.map((m) => m.label).join(", ") } : null,
        ],
      });
    }
  }
  return cards;
}

function model(block: Figure | Sequence): Partial<DocModel> {
  if (isSequence(block)) return sequence.model(block);
  const fid = block.id;
  const layout = block.layout;
  const cards = layoutCards(block);
  const labels = new Map(block.nodes.map((n) => [n.id, n.label]));
  const elements: Record<string, ElementInfo> = {};
  const fill = (info: ElementInfo, c: Card | undefined, say: string): ElementInfo => {
    const facts = factList(c?.facts ?? []);
    const links = (c?.links ?? []).filter((l) => l.ids.length);
    const related = [...new Set(c?.related ?? [])].filter((id) => id !== info.id);
    const context = [...new Set(c?.context ?? [])].filter((id) => id !== info.id && !related.includes(id));
    return {
      ...info,
      ...(c?.kind ? { kind: c.kind } : {}),
      ...(related.length ? { related } : {}),
      ...(facts.length ? { facts } : {}),
      ...(links.length ? { links } : {}),
      ...(context.length ? { context } : {}),
      ...(c?.pos ? { pos: c.pos } : {}),
      ...(c?.crumb?.length ? { crumb: c.crumb } : {}),
      say,
    };
  };
  for (const n of block.nodes) {
    const c = cards.get(n.id);
    const kind = c?.kind ?? nodeWord(layout, n.kind);
    elements[n.id] = fill(
      { id: n.id, type: "node", label: n.label, kind, figure: fid, ...opt({ sub: n.sub, about: n.about }) },
      // the tooltip says what the box says (label, sub); a kind only when it isn't the default a reader would assume
      c, [n.label, n.sub, kind === nodeWord(layout, "service") ? "" : kind, c?.pos].filter(Boolean).join(", "),
    );
  }
  for (const e of block.edges) {
    // The card maps a raw kind to the legend's word; a layout with its own word (transition) passes the word.
    const word = edgeWord(layout, e.kind);
    const kind = word === EDGE_WORDS[e.kind] ? e.kind : word;
    // No invented label: the card titles an edge by its endpoints and names it by its kind.
    elements[e.id] = fill(
      { id: e.id, type: "edge", label: e.label ?? "", kind, figure: fid, from: e.from, to: e.to, ...opt({ about: e.about }) },
      cards.get(e.id), `${labels.get(e.from)} to ${labels.get(e.to)}${e.label ? `: ${e.label}` : ""}, ${word}`,
    );
  }
  for (const g of block.groups) {
    const members = block.nodes
      .filter((n) => n.at[0] >= g.from[0] && n.at[0] <= g.to[0] && n.at[1] >= g.from[1] && n.at[1] <= g.to[1])
      .map((n) => n.id);
    elements[g.id] = fill(
      { id: g.id, type: "group", label: g.label, kind: g.kind === "trust" ? "trust boundary" : "zone", figure: fid, members, ...opt({ about: g.about }) },
      cards.get(g.id), `${g.label}, ${plural(members.length, "part")}`,
    );
  }
  const scenes: DocModel["scenes"] = {};
  for (const s of block.scenes) scenes[s.id] = { ...s, figure: fid, edges: sceneEdges(s.path, block.edges).edges };
  return { elements, scenes };
}

const LAYOUT_READING: Record<Exclude<Layout, "sequence">, string> = {
  flow: "Boxes are parts and arrows show what each one hands to the next, left to right.",
  zones: "Shaded areas are zones and a dashed border is a trust boundary; the arrows that cross a border are the only ways in and out.",
  hub: "The part in the middle is the hub: every other part talks only to it, never to each other.",
  layers: "Tiers stack from the top (L1) down; a request goes down only as far as it must, and parts on the right serve the tier they connect to.",
  tree: "Each level (L1, L2…) breaks the part above it into smaller parts; a line means \"contains\".",
  cycle: "Phases run in order around the loop, and the last one feeds the first.",
  states: "Boxes are states and arrows are the events that move between them; the dot marks where it starts and a double border marks a final state.",
};

function reading(block: Figure | Sequence): string {
  if (isSequence(block)) return sequence.reading(block);
  const focal = block.nodes.filter((n) => n.focal).map((n) => n.label);
  return [
    // zones without a trust group have no dashed border to explain
    block.layout === "zones" && !block.groups.some((g) => g.kind === "trust")
      ? "Shaded areas are zones; the arrows that cross a border are the only ways in and out."
      : LAYOUT_READING[block.layout as Exclude<Layout, "sequence">],
    lineKey(block.layout, new Set(block.edges.map((e) => e.kind))),
    focal.length ? `Accent marks ${focal.join(" and ")}, the part this page is about.` : "",
  ].filter(Boolean).join(" ");
}

function table(block: Figure | Sequence): DataTable {
  if (isSequence(block)) return sequence.table(block);
  const label = new Map(block.nodes.map((n) => [n.id, n.label]));
  return {
    head: ["From", "To", "Label", "Kind"],
    rows: block.edges.map((e) => [label.get(e.from)!, label.get(e.to)!, e.label ?? "", edgeWord(block.layout, e.kind)]),
  };
}

export const figureModule: BlockModule<Figure | Sequence> = {
  type: "figure",
  normalize,
  render: (block, ctx) => (isSequence(block) ? sequence.render(block, ctx) : renderFigure(block, ctx)),
  model,
  reading,
  table,
};
