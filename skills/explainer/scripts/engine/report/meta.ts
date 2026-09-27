// Meta: the line under the title. Mono chips (build, branch, commit, caveats) and a one-line status that
// carries a symbol and words, never hue alone. A chip with an id is selectable; a hash chip copies on click.
import { esc, itemInfo, list } from "../kit.ts";
import { allowKeys, isObj, optString, requireMap, requireString } from "../blocks/util.ts";
import { SpecError, type BlockModule, type ElementInfo, type RawBlock, type RenderContext, type Tone } from "../types.ts";
import { checkRelations, panel, parseTone, plain, registerCollect, relIds, reportIndex, RELS, tierFields, type Contribution, type Decl } from "./common.ts";

const BLOCK_KEYS = ["id", "chips", "status"];
const CHIP_KEYS = ["id", "label", "tone", "about", "copy", "refs"];
const STATUS_KEYS = ["text", "tone"];
const MAX_CHIPS = 5;
export const TONE_SYMBOL: Record<Tone, string> = { ok: "✓", warn: "▲", danger: "×", neutral: "" };
const TONE_WORD: Record<Tone, string> = { ok: "good", warn: "caution", danger: "problem", neutral: "" };
const HASH = /\b[0-9a-f]{7,40}\b/;

export interface Chip { id?: string; label: string; tone: Tone; about?: string; copy?: string; refs: string[] }
export interface MetaBlock { type: "meta"; id: string; line: number; chips: Chip[]; status?: { text: string; tone: Tone }; tiers: Record<string, ReturnType<typeof tierFields>> }

export function parseMeta(raw: RawBlock, ctx: RenderContext): MetaBlock {
  const line = raw.line;
  const data = requireMap(raw.data, "meta", line);
  allowKeys(data, BLOCK_KEYS, "meta", line);
  const id = optString(data, "id", "meta", line) ?? "meta";
  const where = `meta "${id}"`;
  const chips = (data.chips == null ? [] : list(data.chips, `${where} chips`, line)).map((c, i): Chip => {
    const w = `${where} chip ${i + 1}`;
    if (typeof c === "string" || typeof c === "number") {
      const label = String(c).trim();
      return { label, tone: "neutral", copy: HASH.exec(label)?.[0], refs: [] };
    }
    if (!isObj(c)) throw new SpecError(`${w} must be text or {label, tone, id, about}.`, line);
    allowKeys(c, CHIP_KEYS, w, line);
    const label = requireString(c, "label", w, line);
    const copy = c.copy === false ? undefined : typeof c.copy === "string" ? c.copy : HASH.exec(label)?.[0] ?? (c.copy === true ? label : undefined);
    const chipId = optString(c, "id", w, line);
    const refs = relIds(c.refs, `${w} refs`, line);
    if (refs.length && !chipId) throw new SpecError(`${w} has \`refs\` but no \`id\`; give it an id so it can be selected.`, line);
    return { id: chipId, label, tone: parseTone(c.tone, w, line) ?? "neutral", about: optString(c, "about", w, line), copy, refs };
  });
  if (chips.length > MAX_CHIPS) ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} has ${chips.length} chips; keep it to ${MAX_CHIPS}: where it ran, which build, and the one caveat that matters.` });
  let status: MetaBlock["status"];
  if (typeof data.status === "string") status = { text: data.status.trim(), tone: "neutral" };
  else if (isObj(data.status)) {
    allowKeys(data.status, STATUS_KEYS, `${where} status`, line);
    status = { text: requireString(data.status, "text", `${where} status`, line), tone: parseTone(data.status.tone, `${where} status`, line) ?? "neutral" };
  } else if (data.status != null) throw new SpecError(`${where}: \`status\` must be text or {text, tone}.`, line);
  if (!chips.length && !status) throw new SpecError(`${where} needs \`chips\` or \`status\`.`, line);
  return { type: "meta", id, line, chips, status, tiers: {} };
}

function decls(b: MetaBlock): Decl[] {
  return b.chips.filter((c) => c.id).map((c) => ({ from: c.id!, rel: RELS.refs, ids: c.refs }));
}

function contribution(b: MetaBlock): Contribution {
  return { elements: b.chips.filter((c) => c.id).map((c) => ({ id: c.id!, kind: "chip" as const, label: plain(c.label) })), decls: decls(b), anchors: [] };
}

registerCollect("meta", (raw, ctx) => contribution(parseMeta(raw, ctx)));

// a rejected write (no permission, no focus) must not surface as an error
const COPY = `navigator.clipboard&&navigator.clipboard.writeText(this.dataset.copy).catch(function(){})`;

export const metaModule: BlockModule<MetaBlock> = {
  type: "meta",

  normalize(raw, ctx) {
    const b = parseMeta(raw, ctx);
    const index = reportIndex(ctx.doc, ctx, raw, contribution(b));
    for (const c of b.chips) if (c.id) b.tiers[c.id] = tierFields(index, c.id);
    checkRelations(index, decls(b), `meta "${b.id}"`, b.line, ctx);
    return b;
  },

  render(b, ctx) {
    const chips = b.chips.map((c) => {
      const tone = c.tone === "neutral" ? "" : ` data-tone="${c.tone}"`;
      // the symbol carries the tone for readers who can't tell the hue, and names it for screen readers
      const sym = TONE_SYMBOL[c.tone] ? `<span class="x-meta-sym" role="img" aria-label="${TONE_WORD[c.tone]}">${TONE_SYMBOL[c.tone]}</span>` : "";
      const copy = c.copy ? ` data-copy="${esc(c.copy)}" title="Click to copy ${esc(c.copy)}" onclick="${COPY}"` : "";
      const inner = `${sym}${esc(c.label)}`;
      const aria = c.tone === "neutral" ? plain(c.label) : `${TONE_WORD[c.tone]}: ${plain(c.label)}`;
      if (c.id) return `<li><span class="x-mark x-meta-chip" data-id="${esc(c.id)}"${tone}${copy} tabindex="0" role="button" aria-label="${esc(aria)}">${inner}</span></li>`;
      if (c.copy) return `<li><button type="button" class="x-meta-chip x-meta-copy"${tone}${copy}>${inner}</button></li>`;
      return `<li><span class="x-meta-chip"${tone}>${inner}</span></li>`;
    }).join("");
    const s = b.status;
    const status = s
      ? `<p class="x-meta-status"${s.tone === "neutral" ? "" : ` data-tone="${s.tone}"`}>${TONE_SYMBOL[s.tone] ? `<span class="x-meta-sym" role="img" aria-label="${TONE_WORD[s.tone]}">${TONE_SYMBOL[s.tone]}</span>` : ""}${ctx.inline(s.text)}</p>`
      : "";
    return panel({ id: b.id, kind: "meta", label: "Report status", body: `<div class="x-meta-row">${chips ? `<ul class="x-meta-chips">${chips}</ul>` : ""}${status}</div>`, ctx, frame: false });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    for (const c of b.chips) {
      if (!c.id) continue;
      const t = b.tiers[c.id] ?? {};
      elements[c.id] = itemInfo({
        id: c.id, label: plain(c.label), figure: b.id, kind: "chip", value: c.tone === "neutral" ? undefined : c.tone, about: c.about,
        related: t.related, context: t.context, links: t.links, say: plain(c.label),
      });
    }
    return { elements };
  },
};
