// Change: root cause → fix cards, letter-indexed, each with a WAS block and a NOW block in tone ink on
// tone tint. Cards declare what they explain (causes), what they moved (affects) and how to check (verify).
import { esc, itemInfo, readingSpec } from "../kit.ts";
import { allowKeys, entries, optBool, optString, requireMap, requireString } from "../blocks/util.ts";
import { SpecError, type BlockModule, type ElementInfo, type RawBlock, type ReadingSpec, type RenderContext, type Tone } from "../types.ts";
import { checkRelations, panel, plain, registerCollect, relIds, reportIndex, RELS, tierFields, type Contribution, type Decl } from "./common.ts";

const MAX_CARDS = 4;
const BLOCK_KEYS = ["id", "title", "items", "notes", "caveat", "story"];
const ITEM_KEYS = ["label", "was", "now", "about", "tone", "focal", "causes", "affects", "verify"];
const STATES = { fixed: "ok", partial: "warn", reverted: "danger" } as const satisfies Record<string, Tone>;
type State = keyof typeof STATES;

export interface ChangeItem {
  id: string;
  letter: string;
  label: string;
  was: string;
  now: string;
  about?: string;
  state: State;
  focal: boolean;
  causes: string[];
  affects: string[];
  verify: string[];
}

export interface ChangeBlock extends ReadingSpec {
  type: "change";
  id: string;
  title?: string;
  line: number;
  items: ChangeItem[];
  tiers: Record<string, ReturnType<typeof tierFields>>;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const fullLabel = (c: ChangeItem) => `${c.letter} · ${plain(c.label)}`;

export function parseChange(raw: RawBlock, ctx: RenderContext): ChangeBlock {
  const line = raw.line;
  const data = requireMap(raw.data, "change", line);
  allowKeys(data, BLOCK_KEYS, "change", line);
  const id = requireString(data, "id", "change", line);
  const where = `change "${id}"`;
  const rows = entries(data.items, `${where} items`, line);
  if (!rows.length) throw new SpecError(`${where} needs at least one item.`, line);
  if (rows.length > MAX_CARDS) ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} has ${rows.length} cards; keep it to ${MAX_CARDS}. Merge fixes that share a cause, or split the report.` });
  const items = rows.map(([cid, f], i): ChangeItem => {
    const w = `${where} item "${cid}"`;
    allowKeys(f, ITEM_KEYS, w, line);
    const tone = optString(f, "tone", w, line) ?? "fixed";
    if (!(tone in STATES)) throw new SpecError(`${w}: \`tone\` must be fixed, partial or reverted.`, line);
    return {
      id: cid, letter: LETTERS[i] ?? String(i + 1),
      label: requireString(f, "label", w, line),
      was: requireString(f, "was", w, line),
      now: requireString(f, "now", w, line),
      about: optString(f, "about", w, line),
      state: tone as State,
      focal: optBool(f, "focal", w, line),
      causes: relIds(f.causes, `${w} causes`, line),
      affects: relIds(f.affects, `${w} affects`, line),
      verify: relIds(f.verify, `${w} verify`, line),
    };
  });
  return { type: "change", id, title: optString(data, "title", where, line), line, items, tiers: {}, ...readingSpec(data, line) };
}

function decls(b: ChangeBlock): Decl[] {
  return b.items.flatMap((c) => [
    { from: c.id, rel: RELS.causes, ids: c.causes },
    { from: c.id, rel: RELS.affects, ids: c.affects },
    { from: c.id, rel: RELS.verify, ids: c.verify },
  ]);
}

function contribution(b: ChangeBlock): Contribution {
  return { elements: b.items.map((c) => ({ id: c.id, kind: "change", label: fullLabel(c) })), decls: decls(b), anchors: [] };
}

registerCollect("change", (raw, ctx) => contribution(parseChange(raw, ctx)));

export const changeModule: BlockModule<ChangeBlock> = {
  type: "change",

  normalize(raw, ctx) {
    const b = parseChange(raw, ctx);
    const index = reportIndex(ctx.doc, ctx, raw, contribution(b));
    for (const c of b.items) {
      b.tiers[c.id] = tierFields(index, c.id);
      // a cause may be written here (`causes`) or on the moment (`fix`); either way it reads "Seen at"
      if (!b.tiers[c.id].links?.some((l) => l.rel === RELS.causes.rel)) {
        ctx.warn({ rule: "ref-exists", severity: "warn", line: b.line, message: `change "${b.id}" card "${c.id}" explains no moment on the trace; add \`causes\` here or \`fix: ${c.id}\` on the event.` });
      }
    }
    checkRelations(index, decls(b), `change "${b.id}"`, b.line, ctx);
    return b;
  },

  render(b, ctx) {
    const cards = b.items.map((c) => {
      const state = c.state === "fixed" ? "" : `<span class="x-change-state" data-tone="${STATES[c.state]}">${c.state}</span>`;
      const focal = c.focal ? ` data-focal="true"` : "";
      return `<div class="x-mark x-card x-change-card" data-id="${esc(c.id)}"${focal} tabindex="0" role="button" aria-label="${esc(`${fullLabel(c)}. Was: ${plain(c.was)} Now: ${plain(c.now)}`)}">` +
        `<p class="x-change-head"><span class="x-change-letter" aria-hidden="true">${c.letter}</span><span class="x-change-label">${ctx.inline(c.label)}</span>${state}</p>` +
        `<p class="x-change-tag">Was</p><div class="x-change-block" data-tone="warn">${ctx.inline(c.was)}</div>` +
        `<p class="x-change-tag">Now</p><div class="x-change-block" data-tone="${STATES[c.state]}">${ctx.inline(c.now)}</div>` +
        `</div>`;
    }).join("");
    return panel({ id: b.id, kind: "change", title: b.title, label: "Root cause and fix", body: `<div class="x-change-grid">${cards}</div>`, ctx });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    b.items.forEach((c, i) => {
      const t = b.tiers[c.id] ?? {};
      elements[c.id] = itemInfo({
        id: c.id, label: fullLabel(c), figure: b.id, kind: "change", value: c.state,
        about: c.about ?? `**Now:** ${c.now}`,
        related: t.related, context: t.context, links: t.links,
        pos: `${c.letter} · ${i + 1} of ${b.items.length}`,
        say: `${fullLabel(c)}, ${c.state}. Now: ${plain(c.now)}`,
      });
    });
    return { elements };
  },
};
