import { safeMarkdown } from "./markdown.ts";
import { blockModules } from "./registry.ts";
import { esc, slug } from "./blocks/util.ts";
import {
  SpecError,
  type Block, type BlockModule, type Diagnostic, type DocModel, type ElementInfo, type NoteSpec,
  type ParsedDoc, type RawBlock, type RenderContext, type Segment, type StoryStep, type Theme,
} from "./types.ts";

export { blockModules };

export function registerBlock(mod: BlockModule<any>): void {
  blockModules[mod.type] = mod;
}

/** Markdown → HTML for one inline fragment; a lone wrapping <p> is dropped. */
export function inlineMarkdown(md: string): string {
  const html = safeMarkdown(md).trim();
  const inner = /^<p>([\s\S]*)<\/p>$/.exec(html)?.[1];
  return inner !== undefined && !/<\/?p[\s>]/.test(inner) ? inner : html;
}

export function renderDoc(doc: ParsedDoc, theme: Theme): { html: string; model: DocModel; diagnostics: Diagnostic[]; blocks: Block[] } {
  const diagnostics: Diagnostic[] = [];
  let line: number | undefined;
  const ctx: RenderContext = {
    theme,
    doc,
    inline: inlineMarkdown,
    warn: (d) => diagnostics.push(d.line === undefined && line !== undefined ? { ...d, line } : d),
  };
  const fail = (err: SpecError) => diagnostics.push({ rule: err.rule, severity: "error", message: err.message, line: err.line });

  const normalized = new Map<RawBlock, Block | SpecError>();
  const blocks: Block[] = [];
  for (const raw of walk(doc.segments)) {
    line = raw.line;
    const result = attempt(raw, () => moduleFor(raw.type).normalize(raw, ctx) as Block);
    normalized.set(raw, result);
    if (result instanceof SpecError) fail(result);
    else blocks.push(result);
  }
  line = undefined;

  const model = mergeModels(blocks, diagnostics);
  const prose = proseRenderer(model);
  const renderSegments = (segments: Segment[]): string => segments.map((seg) => {
    if (seg.kind === "markdown") return `<div class="x-prose">${prose(seg.text)}</div>`;
    if (seg.kind === "container") return container(seg, renderSegments(seg.children));
    const raw = seg.block;
    line = raw.line;
    const block = normalized.get(raw)!;
    if (block instanceof SpecError) return section(raw.type, undefined, errorBox(raw.type, block));
    const html = attempt(raw, () => moduleFor(raw.type).render(block, ctx));
    if (html instanceof SpecError) {
      fail(html);
      return section(raw.type, blockId(block), errorBox(raw.type, html));
    }
    const aside = reading(block, moduleFor(raw.type), ctx);
    return aside
      ? section(raw.type, blockId(block), `<div class="x-read-grid"><div class="x-read-main">${html}</div>${aside}</div>`, "x-read")
      : section(raw.type, blockId(block), html);
  }).join("\n");

  return { html: renderSegments(doc.segments), model, diagnostics, blocks };
}

function* walk(segments: Segment[]): Generator<RawBlock> {
  for (const seg of segments) {
    if (seg.kind === "block") yield seg.block;
    else if (seg.kind === "container") yield* walk(seg.children);
  }
}

function moduleFor(type: string): BlockModule<any> {
  const mod = blockModules[type];
  if (!mod) throw new SpecError(`There is no renderer for \`${type}\` blocks.`);
  return mod;
}

function attempt<T>(raw: RawBlock, fn: () => T): T | SpecError {
  try {
    return fn();
  } catch (e) {
    if (e instanceof SpecError) return e.line === undefined ? new SpecError(e.message, raw.line, e.rule) : e;
    return new SpecError(`The \`${raw.type}\` renderer failed: ${message(e)}`, raw.line);
  }
}

function mergeModels(blocks: Block[], diagnostics: Diagnostic[]): DocModel {
  const model: DocModel = { elements: {}, scenes: {}, glossary: {} };
  for (const block of blocks) {
    let part: Partial<DocModel> | undefined;
    try {
      part = blockModules[block.type]?.model?.(block);
    } catch (e) {
      diagnostics.push({ rule: "spec", severity: "error", message: `The \`${block.type}\` block model failed: ${message(e)}`, line: block.line });
      continue;
    }
    if (!part) continue;
    for (const [id, el] of Object.entries(part.elements ?? {})) {
      const prev = model.elements[id];
      // Matrix columns may name an existing element; the element's own info wins.
      if (prev && prev.type !== "column" && el.type !== "column") {
        diagnostics.push({ rule: "id-unique", severity: "error", line: block.line, message: `Id \`${id}\` is used by ${describe(prev)} and ${describe(el)}; ids must be unique across the document.` });
        continue;
      }
      // `about` is Markdown in every block. It is rendered here, once and safely, into aboutHtml, the only
      // HTML the card ever inserts; whatever an engine put in aboutHtml is replaced.
      if (!prev || prev.type === "column") {
        const { aboutHtml: _, ...rest } = el;
        model.elements[id] = rest.about ? { ...rest, aboutHtml: inlineMarkdown(rest.about) } : rest;
      }
    }
    for (const [id, scene] of Object.entries(part.scenes ?? {})) {
      if (model.scenes[id]) diagnostics.push({ rule: "id-unique", severity: "error", line: block.line, message: `Scene id \`${id}\` is used twice; rename one.` });
      else model.scenes[id] = scene;
    }
    Object.assign(model.glossary, part.glossary);
  }
  for (const block of blocks) {
    const story = (block as { story?: StoryStep[] }).story;
    const id = blockId(block);
    if (!id || !story?.length) continue;
    const sid = storyId(id);
    if (model.scenes[sid]) continue;
    const title = "title" in block && typeof block.title === "string" ? block.title : "Walk through";
    const scene = { id: sid, title, figure: id, path: story.map((st) => st.sel), notes: {}, edges: [], story };
    model.scenes[sid] = scene;
  }
  backLinks(model);
  return model;
}

/** Scene id of a block's `story:`. */
export const storyId = (blockId: string) => `${blockId}-story`;

/**
 * For every link with an `inverse`, each target gets {rel: inverse, ids: [source]} and keeps the source
 * and the source's other targets in its context, so selection reads across blocks of any type
 * (report event → the change that explains it → the metric that change moved).
 */
export function backLinks(model: DocModel): void {
  const pairs: [ElementInfo, string, string][] = [];
  for (const src of Object.values(model.elements)) {
    for (const l of src.links ?? []) if (l.inverse) for (const t of l.ids) if (t !== src.id) pairs.push([src, l.inverse, t]);
  }
  for (const [src, rel, t] of pairs) {
    const target = model.elements[t];
    if (!target) continue;
    const links = (target.links = target.links ? target.links.map((l) => ({ ...l, ids: [...l.ids] })) : []);
    let group = links.find((l) => l.rel === rel && !l.inverse);
    if (!group) links.push((group = { rel, ids: [] }));
    if (!group.ids.includes(src.id)) group.ids.push(src.id);
    const context = new Set(target.context ?? []);
    context.add(src.id);
    for (const l of src.links ?? []) for (const x of l.ids) if (x !== t) context.add(x);
    target.context = [...context];
  }
}

const describe = (el: ElementInfo) => `${el.type} "${el.label}"`;

function proseRenderer(model: DocModel): (md: string) => string {
  const headingIds = new Set<string>();
  const terms = Object.keys(model.glossary)
    .sort((a, b) => b.length - a.length)
    .map((term) => ({ term, pattern: termPattern(term) }));
  return (md) => wrapSentences(wrapTerms(linkRefs(headingAnchors(safeMarkdown(md), headingIds), model.elements), terms));
}

const HEADING = /<h([1-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g;

function headingAnchors(html: string, used: Set<string>): string {
  return html.replace(HEADING, (_all, level: string, attrs = "", inner: string) => {
    const given = /\sid="([^"]*)"/.exec(attrs)?.[1];
    const base = given ? decode(given) : slug(decode(inner.replace(/<[^>]*>/g, ""))) || "section";
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return `<h${level} id="${esc(id)}"${attrs.replace(/\sid="[^"]*"/, "")}>${inner}</h${level}>`;
  });
}

const LOCAL_LINK = /<a href="#([^"]*)"/g;

/** `#id` → a ref that selects id; `#a+b` → a ref that selects a and compares it with b ("Mobile passed web in April"). */
function linkRefs(html: string, elements: Record<string, ElementInfo>): string {
  return html.replace(LOCAL_LINK, (all, href: string) => {
    const id = hashId(href);
    if (Object.hasOwn(elements, id)) return `<a class="x-ref" data-ref="${esc(id)}" href="#sel=${encodeURIComponent(id)}"`;
    const [a, b, ...rest] = id.split("+");
    if (a && b && !rest.length && Object.hasOwn(elements, a) && Object.hasOwn(elements, b)) {
      return `<a class="x-ref" data-ref="${esc(a)}" data-cmp="${esc(b)}" href="${esc(`#sel=${encodeURIComponent(a)}&cmp=${encodeURIComponent(b)}`)}"`;
    }
    return all;
  });
}

const INLINE_TAGS = new Set(["a", "abbr", "b", "br", "cite", "code", "del", "dfn", "em", "i", "img", "ins", "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "u", "var"]);
const SENTENCE_END = /[.!?][)"'\u201d\u2019\]]*\s+(?=[\p{Lu}\p{N}"'(\[\u201c\u2018])/gu;

/**
 * Wraps every sentence that holds a ref in `<span class="x-sent" data-refs="a b">`, so selecting a mark lights
 * the claim about it, not just the linked noun. Sentences end at . ! ? outside inline tags; headings are skipped.
 */
export function wrapSentences(html: string): string {
  if (!html.includes('class="x-ref"')) return html;
  const tokens = html.split(/(<!--[\s\S]*?-->|<[^>]*>)/).filter(Boolean);
  const out: string[] = [];
  let run: string[] = [];
  let heading = 0;
  const flush = () => {
    if (run.length) out.push(heading ? run.join("") : sentences(run));
    run = [];
  };
  for (const tok of tokens) {
    const tag = /^<(\/?)([a-zA-Z][\w-]*)/.exec(tok);
    if (tag && !INLINE_TAGS.has(tag[2].toLowerCase())) {
      flush();
      if (/^h[1-6]$/i.test(tag[2])) heading += tag[1] ? -1 : 1;
      out.push(tok);
    } else run.push(tok);
  }
  flush();
  return out.join("");
}

function sentences(tokens: string[]): string {
  const parts: string[][] = [[]];
  let depth = 0;
  for (const tok of tokens) {
    const tag = /^<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>$/.exec(tok);
    if (tag) {
      if (!tag[3] && !["br", "img"].includes(tag[2].toLowerCase())) depth = Math.max(0, depth + (tag[1] ? -1 : 1));
      parts[parts.length - 1].push(tok);
      continue;
    }
    if (tok.startsWith("<") || depth) {
      parts[parts.length - 1].push(tok);
      continue;
    }
    let last = 0;
    for (const m of tok.matchAll(SENTENCE_END)) {
      const cut = m.index! + m[0].length;
      parts[parts.length - 1].push(tok.slice(last, cut));
      parts.push([]);
      last = cut;
    }
    parts[parts.length - 1].push(tok.slice(last));
  }
  return parts.map((p) => {
    const text = p.join("");
    const refs = [...text.matchAll(/<a class="x-ref" data-ref="([^"]*)"(?: data-cmp="([^"]*)")?/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean);
    if (!refs.length) return text;
    const lead = /^\s*/.exec(text)![0], trail = /\s*$/.exec(text)![0];
    return `${lead}<span class="x-sent" data-refs="${[...new Set(refs)].join(" ")}">${text.slice(lead.length, text.length - trail.length)}</span>${trail}`;
  }).join("");
}

/**
 * The expanded view's reading panel: the engine's "How to read" line, the numbered notes (the same numbers
 * as the markers kit.notes() draws), the caveat, and the data as a table with Copy CSV. Empty when a block has none.
 */
function reading(block: Block, mod: BlockModule<any>, ctx: RenderContext): string {
  const id = blockId(block);
  const b = block as { notes?: NoteSpec[]; caveat?: string; title?: string };
  let how = "", table: { head: string[]; rows: string[][] } | undefined;
  try {
    how = mod.reading?.(block)?.trim() ?? "";
    table = mod.table?.(block);
  } catch (e) {
    ctx.warn({ rule: "spec", severity: "warn", message: `The \`${block.type}\` reading panel failed: ${message(e)}`, line: block.line });
  }
  const notes = b.notes ?? [];
  if (!how && !notes.length && !b.caveat && !table?.rows.length) return "";
  const parts: string[] = [];
  if (how) parts.push(`<p class="x-reading-how"><span class="x-reading-k">How to read</span>${esc(how)}</p>`);
  if (notes.length) {
    const items = notes.map((n, i) =>
      `<li class="x-reading-note" data-note="${i + 1}"${n.on.length ? ` data-refs="${esc(n.on.join(" "))}"` : ""}><span class="x-reading-note-num" aria-hidden="true">${i + 1}</span><span class="x-reading-note-text">${ctx.inline(n.text)}</span></li>`);
    parts.push(`<ol class="x-reading-notes" aria-label="Notes">${items.join("")}</ol>`);
  }
  if (b.caveat) parts.push(`<p class="x-reading-caveat"><span class="x-reading-k">What this doesn't show</span>${ctx.inline(b.caveat)}</p>`);
  if (table?.rows.length) {
    const head = `<thead><tr>${table.head.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>`;
    const rows = table.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join("")}</tr>`).join("");
    parts.push(`<details class="x-data"><summary>Data</summary><table class="x-data-table">${head}<tbody>${rows}</tbody></table><button type="button" class="x-btn" data-action="csv">Copy CSV</button></details>`);
  }
  const label = b.title ? ` aria-label="${esc(`Reading notes: ${b.title}`)}"` : ' aria-label="Reading notes"';
  return `<aside class="x-reading"${id ? ` data-for="${esc(id)}"` : ""}${label}>${parts.join("")}</aside>`;
}

function hashId(href: string): string {
  const text = decode(href);
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const SKIP_TAGS = new Set(["a", "code", "pre", "kbd", "samp", "dfn", "script", "style", "h1", "h2", "h3", "h4", "h5", "h6"]);

function termPattern(term: string): RegExp {
  const words = term.trim().split(/\s+/).map((w) =>
    w.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}_&])${words.join("\\s+")}(?![\\p{L}\\p{N}_])`, "iu");
}

/** Wraps the first free occurrence of each term; text inside SKIP_TAGS and earlier wraps is never touched. */
function wrapTerms(html: string, terms: { term: string; pattern: RegExp }[]): string {
  if (!terms.length) return html;
  const pieces: { text: string; free: boolean }[] = [];
  let depth = 0;
  for (const token of html.split(/(<!--[\s\S]*?-->|<[^>]*>)/)) {
    if (!token) continue;
    if (token[0] !== "<") {
      pieces.push({ text: token, free: depth === 0 });
      continue;
    }
    const tag = /^<(\/?)([a-zA-Z][\w-]*)/.exec(token);
    if (tag && SKIP_TAGS.has(tag[2].toLowerCase())) depth = Math.max(0, depth + (tag[1] ? -1 : 1));
    pieces.push({ text: token, free: false });
  }
  for (const { term, pattern } of terms) {
    const i = pieces.findIndex((p) => p.free && pattern.test(p.text));
    if (i < 0) continue;
    const { text } = pieces[i];
    const m = pattern.exec(text)!;
    pieces.splice(i, 1,
      { text: text.slice(0, m.index), free: true },
      { text: `<dfn class="x-term" data-term="${esc(term)}" tabindex="0">${m[0]}</dfn>`, free: false },
      { text: text.slice(m.index + m[0].length), free: true });
  }
  return pieces.map((p) => p.text).join("");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, name: string) => ENTITIES[name]);

function container(seg: Extract<Segment, { kind: "container" }>, inner: string): string {
  if (seg.layout !== "split") return `<div class="x-${seg.layout}">${inner}</div>`;
  const cols = seg.args.length ? seg.args.join(" ") : `repeat(${seg.children.length || 1}, 1fr)`;
  return `<div class="x-split" style="--cols: ${esc(cols)}">${inner}</div>`;
}

function section(type: string, id: string | undefined, inner: string, cls = ""): string {
  return `<section class="x-block${cls ? ` ${cls}` : ""}" data-block="${esc(type)}"${id ? ` data-id="${esc(id)}"` : ""}>${inner}</section>`;
}

function errorBox(type: string, err: SpecError): string {
  const where = err.line ? ` · line ${err.line}` : "";
  return `<div class="x-error" role="alert"><p class="x-error-title">${esc(type)} block${where}</p><p class="x-error-message">${esc(err.message)}</p></div>`;
}

function blockId(block: Block): string | undefined {
  return "id" in block && typeof block.id === "string" ? block.id : undefined;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
