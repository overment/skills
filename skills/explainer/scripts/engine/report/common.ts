// Shared by the report blocks: the panel frame, tones, relation keys, and the page-wide relation index
// that tells each element which counterparts in the other panels light with it.
import { esc, isObj } from "../kit.ts";
import { rawBlocks } from "../blocks/util.ts";
import { SpecError, type Link, type ParsedDoc, type RawBlock, type RenderContext, type Tone } from "../types.ts";

export const REPORT_TYPES = ["meta", "events", "change", "metrics", "checklist"] as const;

// ---------- text ----------

/** Plain text of a short Markdown fragment, for labels, aria and the card title. */
export function plain(md: string): string {
  return md.replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
}

// ---------- tones ----------

const TONE_WORDS: Record<string, Tone> = {
  ok: "ok", good: "ok", pass: "ok", fixed: "ok", done: "ok",
  warn: "warn", warning: "warn", slow: "warn", partial: "warn", risk: "warn",
  danger: "danger", bad: "danger", fail: "danger", error: "danger", reverted: "danger",
  neutral: "neutral", none: "neutral", info: "neutral",
};

export function parseTone(v: unknown, what: string, line: number): Tone | undefined {
  if (v == null) return undefined;
  const t = typeof v === "string" ? TONE_WORDS[v.trim().toLowerCase()] : undefined;
  if (!t) throw new SpecError(`${what}: \`tone\` must be ok, warn, danger or neutral (or pass, fail, fixed, partial, reverted), got ${JSON.stringify(v)}.`, line);
  return t;
}

// ---------- panel ----------

/**
 * Report panel: a figure with the panel frame, a sans title (kept in bare view: it names what the panel
 * measures) and the body. The figure is a board, so the card and dimming treat it like any other block.
 */
export function panel(o: { id: string; kind: string; title?: string; label: string; body: string; ctx: RenderContext; frame?: boolean }): string {
  const title = o.title ? `<h3 class="x-report-title">${o.ctx.inline(o.title)}</h3>` : "";
  const cls = `x-figure x-board x-report x-report-${o.kind}${o.frame === false ? "" : " x-report-panel"}`;
  return `<figure class="${cls}" data-figure="${esc(o.id)}" data-layout="${esc(o.kind)}" role="group" aria-label="${esc(plain(o.title ?? o.label))}">${title}${o.body}</figure>`;
}

// ---------- relations ----------

/** A declared relation key: the card row it reads as, and the row its targets get back. */
export interface RelKey { key: string; rel: string; inverse: string }

export const RELS = {
  causes: { key: "causes", rel: "Seen at", inverse: "Explained by" },
  affects: { key: "affects", rel: "Moved", inverse: "Changed by" },
  verify: { key: "verify", rel: "Check with", inverse: "Verifies" },
  measures: { key: "measures", rel: "Observed at", inverse: "Measured by" },
  verifies: { key: "verifies", rel: "Verifies", inverse: "Check with" },
  reproduces: { key: "reproduces", rel: "Reproduces", inverse: "Reproduced by" },
  on: { key: "on", rel: "About", inverse: "Open question" },
  proves: { key: "proves", rel: "Proves", inverse: "Proven by" },
  refs: { key: "refs", rel: "Evidence", inverse: "Cited by" },
  // no reverse row: a cluster's value already lists its bars
  partOf: { key: "partOf", rel: "Part of", inverse: "" },
  // written on a moment in the trace; each reads as the relation declared from the other end
  fix: { key: "fix", rel: "Explained by", inverse: "Seen at" },
  metric: { key: "metric", rel: "Measured by", inverse: "Observed at" },
  check: { key: "check", rel: "Reproduced by", inverse: "Reproduces" },
} as const satisfies Record<string, RelKey>;

export type ElKind = "event" | "span" | "cluster" | "item" | "change" | "row" | "proof" | "step" | "open" | "chip";
const TIMED = new Set<ElKind>(["event", "span", "cluster", "item"]);

export interface Decl { from: string; rel: RelKey; ids: string[] }

/** `causes: [a, b]` or `causes: a` → ids. */
export function relIds(v: unknown, what: string, line: number): string[] {
  if (v == null) return [];
  const out = typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : Array.isArray(v) ? v : null;
  if (!out || !out.every((x) => typeof x === "string" && x.trim())) throw new SpecError(`${what} must be an id or a list of ids.`, line);
  return out.map((x) => (x as string).trim());
}

/** What each report block contributes to the index. `parent` ties a cluster's bar to its cluster. */
export interface Contribution { elements: { id: string; kind: ElKind; label: string; parent?: string }[]; decls: Decl[]; anchors: [string, string][] }

/** The kinds a trace key may point at, and the relation it becomes when written from that end. */
const FROM_TRACE: Record<string, Partial<Record<ElKind, RelKey>>> = {
  fix: { change: RELS.causes },
  metric: { row: RELS.measures },
  check: { step: RELS.reproduces, open: RELS.on },
};

interface Triple { from: string; rel: RelKey; to: string }

/**
 * Every relation in one direction, so a pair written from either end (a card's `causes` and an event's
 * `fix`, a card's `verify` and a step's `verifies`) is one relation and one group of chips after the
 * back-link pass. Targets of the wrong kind are dropped here and reported by checkRelations.
 */
function canonical(decls: Decl[], kinds: Map<string, ElKind>): Triple[] {
  const out: Triple[] = [];
  const seen = new Set<string>();
  const put = (from: string, rel: RelKey, to: string) => {
    const k = `${from}\u0000${rel.key}\u0000${to}`;
    if (from !== to && kinds.has(from) && kinds.has(to) && !seen.has(k)) { seen.add(k); out.push({ from, rel, to }); }
  };
  for (const d of decls) for (const to of d.ids) {
    const flip = FROM_TRACE[d.rel.key];
    if (flip) {
      const rel = flip[kinds.get(to)!];
      if (rel) put(to, rel, d.from);
    } else if (d.rel.key === "verify") put(to, RELS.verifies, d.from);
    else put(d.from, d.rel, to);
  }
  return out;
}

export type Collect = (raw: RawBlock, ctx: RenderContext) => Contribution;

/** Tiers for one element: `related` lights with it, `context` stays at rest, `links` are its own declared rows. */
export interface Tiers { related: string[]; context: string[]; links: Link[] }

export interface Index {
  kinds: Map<string, ElKind>;
  labels: Map<string, string>;
  tiers(id: string): Tiers;
  /** Declared targets that are no report element, or the wrong kind for a trace key. */
  dangling(decls: Decl[]): { from: string; key: string; id: string; why: "missing" | "kind" }[];
  /** Does the element relate to anything outside its own cluster? */
  linked(id: string): boolean;
}

const collectors = new Map<string, Collect>();
export function registerCollect(type: string, fn: Collect): void {
  collectors.set(type, fn);
}

const cache = new WeakMap<ParsedDoc, { raws: Set<RawBlock>; parts: Contribution[]; index: Index }>();

/**
 * The page-wide index, built once per document from every report block (a block that fails to parse
 * contributes nothing; its own normalize reports the error). Ids are page-global. A block rendered
 * outside its document (tests, previews) is added on top of what the document holds.
 */
export function reportIndex(doc: ParsedDoc, ctx: RenderContext, raw?: RawBlock, own?: Contribution): Index {
  let hit = cache.get(doc);
  if (!hit) {
    const quiet: RenderContext = { ...ctx, warn: () => {} };
    const raws = new Set<RawBlock>(), parts: Contribution[] = [];
    for (const r of rawBlocks(doc)) {
      const fn = collectors.get(r.type);
      if (!fn || (r.data !== undefined && !isObj(r.data))) continue;
      raws.add(r);
      try {
        parts.push(fn(r, quiet));
      } catch {
        /* reported by the block itself */
      }
    }
    hit = { raws, parts, index: buildIndex(parts) };
    cache.set(doc, hit);
  }
  return raw && own && !hit.raws.has(raw) ? buildIndex([...hit.parts, own]) : hit.index;
}

export function buildIndex(parts: Contribution[]): Index {
  const kinds = new Map<string, ElKind>(), labels = new Map<string, string>(), parents = new Map<string, string>();
  for (const p of parts) for (const e of p.elements) {
    if (!kinds.has(e.id)) kinds.set(e.id, e.kind);
    if (!labels.has(e.id)) labels.set(e.id, e.label);
    if (e.parent) parents.set(e.id, e.parent);
  }
  const decls = parts.flatMap((p) => p.decls);
  const triples = canonical([...decls, ...[...parents].map(([id, parent]) => ({ from: id, rel: RELS.partOf, ids: [parent] }))], kinds);
  const near = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (near.get(a) ?? near.set(a, new Set()).get(a)!).add(b);
    (near.get(b) ?? near.set(b, new Set()).get(b)!).add(a);
  };
  for (const t of triples) link(t.from, t.to);
  const anchored = new Map<string, Set<string>>();
  for (const p of parts) for (const [a, b] of p.anchors) {
    if (a === b) continue;
    (anchored.get(a) ?? anchored.set(a, new Set()).get(a)!).add(b);
    (anchored.get(b) ?? anchored.set(b, new Set()).get(b)!).add(a);
  }
  const N = (id: string) => [...(near.get(id) ?? [])];
  const kind = (id: string) => kinds.get(id);

  const core = (id: string) => {
    const k = kind(id);
    const related = new Set(N(id));
    const context = new Set<string>();
    for (const c of N(id).filter((n) => kind(n) === "change")) {
      for (const n of N(c)) {
        if (n === id) continue;
        // From a moment in the trace, a fix reaches the rows it moved; its other causes and checks are context.
        if (k && TIMED.has(k) && kind(n) === "row") related.add(n);
        else context.add(n);
      }
    }
    if (k === "change") for (const n of N(id)) for (const m of N(n)) if (m !== id) context.add(m);
    for (const a of anchored.get(id) ?? []) context.add(a);
    return { related, context };
  };

  const tiers = (id: string): Tiers => {
    const { related, context } = core(id);
    // a cluster's bar lights everything its cluster does; its sibling bars stay at rest
    const parent = parents.get(id);
    if (parent) {
      const up = core(parent);
      const siblings = [...parents].filter(([, p]) => p === parent).map(([child]) => child);
      up.related.forEach((r) => { if (!siblings.includes(r)) related.add(r); });
      up.context.forEach((c) => context.add(c));
      siblings.forEach((c) => context.add(c));
    }
    related.delete(id);
    for (const r of related) context.delete(r);
    context.delete(id);
    const links: Link[] = [];
    for (const t of triples.filter((x) => x.from === id)) {
      const prev = links.find((l) => l.rel === t.rel.rel);
      if (prev) prev.ids.push(t.to);
      else links.push(t.rel.inverse ? { rel: t.rel.rel, ids: [t.to], inverse: t.rel.inverse } : { rel: t.rel.rel, ids: [t.to] });
    }
    return { related: order([...related]), context: order([...context]), links };
  };
  // document order, so the model is deterministic
  const pos = new Map([...kinds.keys()].map((id, i) => [id, i]));
  const order = (ids: string[]) => ids.sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));

  type Miss = { from: string; key: string; id: string; why: "missing" | "kind" };
  const dangling = (ds: Decl[]): Miss[] => ds.flatMap((d) => d.ids.flatMap((id): Miss[] => {
    const k = kinds.get(id);
    const flip = FROM_TRACE[d.rel.key];
    if (!k) return [{ from: d.from, key: d.rel.key, id, why: "missing" }];
    if (flip && !flip[k]) return [{ from: d.from, key: d.rel.key, id, why: "kind" }];
    return [];
  }));
  const linked = (id: string) => N(id).some((n) => parents.get(id) !== n && parents.get(n) !== id);
  return { kinds, labels, tiers, dangling, linked };
}

/** Errors for relation ids that name nothing on the page. */
export function checkRelations(index: Index, decls: Decl[], where: string, line: number, ctx: RenderContext): void {
  const want: Record<string, string> = { fix: "a change card", metric: "a metrics row", check: "a checklist step or open question" };
  for (const d of index.dangling(decls)) {
    const message = d.why === "kind"
      ? `${where}: "${d.from}" \`${d.key}\` points at "${d.id}", which is not ${want[d.key]}.`
      : `${where}: "${d.from}" \`${d.key}\` points at "${d.id}", which is no event, card, row or step on this page.`;
    ctx.warn({ rule: "ref-exists", severity: "error", line, message });
  }
}

/** Fields every report element carries into the model from its tiers. */
export function tierFields(index: Index, id: string): { related?: string[]; context?: string[]; links?: Link[] } {
  const t = index.tiers(id);
  return { related: t.related.length ? t.related : undefined, context: t.context.length ? t.context : undefined, links: t.links.length ? t.links : undefined };
}
