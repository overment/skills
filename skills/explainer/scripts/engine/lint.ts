import { labelCapacity, textWidth } from "./figure/grid.ts";
import { slug } from "./blocks/util.ts";
import { contextRefs } from "./blocks/context.ts";
import {
  BUDGET,
  type Block,
  type Diagnostic,
  type EdgeSpec,
  type FigureBlock,
  type LintRule,
  type NodeSpec,
  type ParsedDoc,
  type Segment,
  type SequenceBlock,
  type Theme,
} from "./types.ts";

const SEQUENCE_BUDGET = { actors: 5, messages: 12 } as const;

type Emit = (rule: LintRule, severity: Diagnostic["severity"], message: string, line?: number) => void;

/** `known`: element ids the build produced (every block type's model), so prose links to any mark resolve. */
export function lint(doc: ParsedDoc, blocks: Block[], theme: Theme, known: Iterable<string> = []): Diagnostic[] {
  const found: Diagnostic[] = [];
  const seen = new Set<string>();
  const emit: Emit = (rule, severity, message, line) => {
    const key = [rule, severity, line, message].join("\u0000");
    if (seen.has(key)) return;
    seen.add(key);
    found.push(line === undefined ? { rule, severity, message } : { rule, severity, message, line });
  };
  for (const block of blocks) {
    if (block.type !== "figure") continue;
    if (isSequence(block)) lintSequence(block, emit);
    else lintFigure(block, theme, emit);
  }
  const ids = lintRefs(doc, blocks, emit, known);
  lintReading(doc, blocks, ids, emit);
  lintSentences(doc, blocks, emit);
  return found;
}

function isSequence(block: FigureBlock | SequenceBlock): block is SequenceBlock {
  return block.layout === "sequence";
}

function lintFigure(fig: FigureBlock, theme: Theme, emit: Emit) {
  const where = `Figure "${fig.id}"`;
  if (fig.nodes.length > BUDGET.nodes)
    emit("budget-nodes", "warn", `${where} has ${fig.nodes.length} nodes (budget ${BUDGET.nodes}); split it into an overview and a detail figure.`, fig.line);
  if (fig.edges.length > BUDGET.edges)
    emit("budget-edges", "warn", `${where} has ${fig.edges.length} connectors (budget ${BUDGET.edges}); drop the ones the reader does not need or split the figure.`, fig.line);
  const focal = fig.nodes.filter((n) => n.focal);
  if (focal.length > BUDGET.focal)
    emit("budget-focal", "error", `${where} marks ${focal.length} nodes focal (${focal.map((n) => n.id).join(", ")}); keep at most ${BUDGET.focal}.`, fig.line);

  const [cellW] = theme.grid.cell;
  const [gapX] = theme.grid.gap;
  const labels = new Map<string, string>();
  for (const node of fig.nodes) {
    const cols = node.span[0];
    // A decision diamond has about half its cell width at the label's baseline.
    const diamond = node.kind === "decision";
    const room = (cols * cellW + (cols - 1) * gapX) / (diamond ? 2 : 1) - 24;
    if (textWidth(node.label, theme.type.nodeLabel, "sans") > room)
      emit("label-fit", "warn", `Node "${node.id}" label "${node.label}" is too wide for ${diamond ? "a decision diamond" : cols === 1 ? "one column" : `${cols} columns`} (about ${diamond ? Math.floor(labelCapacity(cols, theme) / 2) : labelCapacity(cols, theme)} characters fit); shorten it${diamond ? "" : " or widen its span"}.`, fig.line);
    aboutRules(node, "Node", fig.line, emit);
    const key = node.label.trim().toLowerCase();
    const first = labels.get(key);
    if (first) emit("label-duplicate", "warn", `Nodes "${first}" and "${node.id}" in figure "${fig.id}" share the label "${node.label}"; make each label distinct.`, fig.line);
    else labels.set(key, node.id);
  }
  for (const edge of fig.edges) edgeLabel(edge, "Connector", fig.line, emit);
}

function lintSequence(seq: SequenceBlock, emit: Emit) {
  const where = `Sequence "${seq.id}"`;
  if (seq.actors.length > SEQUENCE_BUDGET.actors)
    emit("budget-nodes", "warn", `${where} has ${seq.actors.length} actors (budget ${SEQUENCE_BUDGET.actors}); merge actors or split the sequence.`, seq.line);
  if (seq.messages.length > SEQUENCE_BUDGET.messages)
    emit("budget-edges", "warn", `${where} has ${seq.messages.length} messages (budget ${SEQUENCE_BUDGET.messages}); split it into two sequences.`, seq.line);
  for (const actor of seq.actors) aboutRules(actor, "Actor", seq.line, emit);
  for (const message of seq.messages) edgeLabel(message, "Message", seq.line, emit);
}

/** Fewer words than this and an `about` only names the part again. */
const ABOUT_MIN_WORDS = 12;

function aboutRules(node: NodeSpec, what: string, line: number, emit: Emit) {
  const about = node.about?.trim();
  if (!about) {
    emit("about-missing", "warn", `${what} "${node.id}" has no \`about\`; say what it does, why it is there and what to watch.`, line);
    return;
  }
  const label = node.label.trim().toLowerCase();
  if (label && about.toLowerCase().startsWith(label))
    emit("about-repeats", "warn", `${what} "${node.id}" \`about\` starts by repeating its label; start with what it does.`, line);
  // A part of a system is what a new reader clicks to understand; a few words name it again rather than explain it.
  const words = about.split(/\s+/).length;
  if (words < ABOUT_MIN_WORDS)
    emit("about-thin", "warn", `${what} "${node.id}" \`about\` has ${words} words; add why it is there or what to watch (a constraint, a failure, a number), in two or three short sentences.`, line);
}

function edgeLabel(edge: EdgeSpec, what: string, line: number, emit: Emit) {
  const label = edge.label?.trim();
  if (!label) return;
  const words = label.split(/\s+/).length;
  if (words > BUDGET.edgeLabelWords || label.length > BUDGET.edgeLabelChars)
    emit("edge-label", "warn", `${what} "${edge.id}" label "${label}" has ${words} words and ${label.length} characters; keep it to ${BUDGET.edgeLabelWords} words and ${BUDGET.edgeLabelChars} characters.`, line);
}

function lintRefs(doc: ParsedDoc, blocks: Block[], emit: Emit, known: Iterable<string>): Set<string> {
  const ids = new Set<string>(known);
  for (const block of blocks) if ("id" in block && typeof block.id === "string") ids.add(block.id);
  const figures = new Set<string>();
  for (const block of blocks) {
    if (block.type === "figure") {
      figures.add(block.id);
      const parts = isSequence(block) ? [...block.actors, ...block.messages] : [...block.nodes, ...block.edges, ...block.groups];
      for (const id of [block.id, ...parts.map((p) => p.id)]) ids.add(id);
    } else if (block.type === "matrix") {
      for (const id of [block.id, ...block.columns.map((c) => c.id), ...block.rows.map((r) => r.id)]) ids.add(id);
    } else if (block.type === "compare") {
      for (const id of [block.id, ...block.items.map((i) => i.id)]) ids.add(id);
    }
  }
  const prose = markdownSegments(doc.segments);
  const headings = new Set(prose.flatMap((seg) => headingSlugs(seg.text)));
  for (const seg of prose) {
    for (const { id, offset } of links(seg.text)) {
      if (id.includes("=") || ids.has(id) || headings.has(id)) continue;
      const parts = id.split("+");
      if (parts.length === 2 && parts.every((p) => ids.has(p))) continue;
      emit("ref-exists", "error", parts.length === 2
        ? `Link "#${id}" compares ${parts.filter((p) => !ids.has(p)).map((p) => `"${p}"`).join(" and ")}, which ${parts.filter((p) => !ids.has(p)).length > 1 ? "are" : "is"} not an element; use existing ids.`
        : `Link "#${id}" points at no element or heading; use an existing id.`, seg.line + offset);
    }
  }
  const storied = new Set(blocks.filter((b) => (b as { story?: unknown[] }).story?.length).map((b) => (b as { id?: string }).id));
  for (const block of blocks) {
    if (block.type === "steps" && !figures.has(block.for) && !storied.has(block.for))
      emit("ref-exists", "error", `Steps block points at "${block.for}", which is neither a figure nor a block with \`story:\`.`, block.line);
    for (const ref of contextRefs(block as Parameters<typeof contextRefs>[0]))
      if (!ids.has(ref.id)) emit("ref-exists", "error", `Context call "${ref.from}" points at message "${ref.id}", which is not an element; use a sequence message id (m1, m2, …) or an edge id.`, ref.line);
    const target = block.type === "context" ? (block as { for?: string }).for : undefined;
    if (target && !figures.has(target)) emit("ref-exists", "error", `Context block points at "${target}" with \`for\`, which is not a figure.`, block.line);
  }
  return ids;
}

/** Ids of focal elements in a normalized block: any object with `focal: true` and an `id`, prefixed like the model when needed. */
function focalIds(block: Block, ids: Set<string>): string[] {
  const out = new Set<string>();
  const own = (block as { id?: string }).id;
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const o = v as Record<string, unknown>;
    if (o.focal === true && typeof o.id === "string") {
      const id = ids.has(o.id) ? o.id : own && ids.has(`${own}-${o.id}`) ? `${own}-${o.id}` : null;
      if (id) out.add(id);
    }
    for (const x of Object.values(o)) if (x && typeof x === "object") walk(x, depth + 1);
  };
  walk(block, 0);
  return [...out];
}

const QUIET = new Set(["note", "glossary", "steps", "widget", "detail"]);

function lintReading(doc: ParsedDoc, blocks: Block[], ids: Set<string>, emit: Emit) {
  const linked = new Set<string>();
  for (const seg of markdownSegments(doc.segments)) for (const { id } of links(seg.text)) id.split("+").forEach((x) => linked.add(x));
  for (const block of blocks) {
    const b = block as { id?: string; notes?: { on: string[] }[]; story?: { sel: string; cmp?: string }[] };
    const where = b.id ? `"${b.id}"` : `the ${block.type} block`;
    for (const [i, n] of (b.notes ?? []).entries()) {
      n.on.forEach((x) => linked.add(x));
      const missing = n.on.filter((x) => !ids.has(x));
      if (missing.length) emit("note-target", "error", `Note ${i + 1} in ${where} points at ${missing.map((x) => `"${x}"`).join(", ")}, which ${missing.length > 1 ? "don't" : "doesn't"} exist; use an element id from that block.`, block.line);
    }
    for (const [i, st] of (b.story ?? []).entries()) {
      linked.add(st.sel);
      const missing = [st.sel, st.cmp].filter((x): x is string => !!x && !ids.has(x));
      if (missing.length) emit("note-target", "error", `Story step ${i + 1} in ${where} selects ${missing.map((x) => `"${x}"`).join(", ")}, which ${missing.length > 1 ? "don't" : "doesn't"} exist.`, block.line);
    }
  }
  for (const block of blocks) {
    if (QUIET.has(block.type)) continue;
    for (const id of focalIds(block, ids)) {
      if (!linked.has(id))
        emit("ref-focal", "warn", `Focal element "${id}" is the point of its figure, but no prose link or note points at it; link the claim to it, e.g. [the claim](#${id}).`, block.line);
    }
  }
  lintClaims(doc.segments, emit);
}

/** Sentences with a number in prose right before or after a block, with no link in them. */
function lintClaims(segments: Segment[], emit: Emit) {
  segments.forEach((seg, i) => {
    if (seg.kind === "container") return lintClaims(seg.children, emit);
    if (seg.kind !== "markdown") return;
    const near = [segments[i - 1], segments[i + 1]].some((s) => s?.kind === "block" && !QUIET.has(s.block.type));
    if (!near) return;
    for (const { line, offset } of proseLines(seg.text)) {
      if (/^\s*(#|```|~~~|\||>)/.test(line)) continue;
      const bare = line.replace(/`[^`]*`/g, "");
      for (const sentence of bare.split(/(?<=[.!?])\s+/)) {
        if (!/\d/.test(sentence) || /\]\(#/.test(sentence)) continue;
        const text = sentence.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_]/g, "").trim();
        if (/\d/.test(text) && text.length > 12)
          emit("claim-unlinked", "warn", `"${text.length > 70 ? `${text.slice(0, 69)}…` : text}" states a number next to a figure without linking the marks that prove it; wrap the claim in [a link](#id).`, seg.line + offset);
      }
    }
  });
}

/** ASD-STE100 allows 20 words in an instruction and 25 in a description; one limit keeps the check simple. */
const STE_SENTENCE_WORDS = 25;

/** String fields that hold sentences the author writes for readers. A context block's message `text` is quoted model input, not prose. */
const PROSE_KEYS = new Set(["about", "caveat", "note", "markdown"]);

function lintSentences(doc: ParsedDoc, blocks: Block[], emit: Emit) {
  const measure = (text: string, line: number) => {
    for (const sentence of sentences(text)) {
      const words = sentence.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      if (words > STE_SENTENCE_WORDS)
        emit("sentence-long", "warn", `"${sentence.length > 70 ? `${sentence.slice(0, 69)}…` : sentence}" has ${words} words; split it so each sentence carries one fact or one instruction (at most ${STE_SENTENCE_WORDS}; ASD-STE100 keeps instructions to 20).`, line);
    }
  };
  for (const block of blocks) for (const text of authoredText(block)) measure(text, block.line);
  for (const seg of markdownSegments(doc.segments))
    for (const { line, offset } of proseLines(seg.text)) if (!/^\s*\|/.test(line)) measure(line, seg.line + offset);
}

/** Every sentence the author wrote inside a block: explanations, notes, step notes, caveats, points and definitions. */
function authoredText(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || !value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) authoredText(item, out, depth + 1);
    return out;
  }
  const strings = (v: unknown) => (Array.isArray(v) ? v : Object.values(v as object)).flatMap((x) =>
    typeof x === "string" ? [x] : x && typeof x === "object" && typeof (x as { text?: unknown }).text === "string" ? [(x as { text: string }).text] : []);
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") {
      if (PROSE_KEYS.has(key)) out.push(v);
    } else if (v && typeof v === "object" && ["notes", "points", "terms"].includes(key)) {
      // Reading notes ({ on, text }), scene notes (node id → line), compare points and glossary definitions.
      out.push(...strings(v));
    } else authoredText(v, out, depth + 1);
  }
  return out;
}

function sentences(text: string): string[] {
  const plain = text.replace(/`[^`]*`/g, "x").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_]/g, "");
  return plain.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function markdownSegments(segments: Segment[]): { text: string; line: number }[] {
  return segments.flatMap((seg) =>
    seg.kind === "markdown" ? [seg] : seg.kind === "container" ? markdownSegments(seg.children) : [],
  );
}

/** Lines outside fenced code, with their 0-based offset inside the segment. */
function proseLines(text: string): { line: string; offset: number }[] {
  const out: { line: string; offset: number }[] = [];
  let fence = "";
  text.split("\n").forEach((line, offset) => {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (mark) {
      if (!fence) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = "";
      return;
    }
    if (!fence) out.push({ line, offset });
  });
  return out;
}

function headingSlugs(text: string): string[] {
  return proseLines(text).flatMap(({ line }) => {
    const title = line.match(/^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/)?.[1];
    return title ? [slug(title.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, ""))] : [];
  });
}

function links(text: string): { id: string; offset: number }[] {
  return proseLines(text).flatMap(({ line, offset }) =>
    [...line.replace(/`[^`]*`/g, "").matchAll(/\]\(#([^)\s]+)/g)].map((m) => ({ id: m[1]!, offset })),
  );
}
