// Checklist: numbered steps a reader can run ("do: expect"), each tickable in the reader's own browser,
// then an OPEN list of questions with an owner. Steps say which fix they verify and what they reproduce.
import { esc, itemInfo, readingSpec } from "../kit.ts";
import { allowKeys, entries, optBool, optString, requireMap, requireString } from "../blocks/util.ts";
import { SpecError, type BlockModule, type ElementInfo, type RawBlock, type ReadingSpec, type RenderContext } from "../types.ts";
import { checkRelations, panel, plain, registerCollect, relIds, reportIndex, RELS, tierFields, type Contribution, type Decl } from "./common.ts";

const MAX_STEPS = 8, MAX_OPEN = 5;
const BLOCK_KEYS = ["id", "title", "steps", "open", "notes", "caveat", "story"];
const STEP_KEYS = ["do", "expect", "code", "verifies", "reproduces", "done", "about"];
const OPEN_KEYS = ["text", "owner", "decision", "on", "about"];

export interface Step { id: string; n: number; do: string; expect?: string; code?: string; verifies: string[]; reproduces: string[]; done: boolean; about?: string }
export interface Question { id: string; n: number; text: string; owner?: string; decision: boolean; on: string[]; about?: string }

export interface ChecklistBlock extends ReadingSpec {
  type: "checklist";
  id: string;
  title?: string;
  line: number;
  steps: Step[];
  open: Question[];
  tiers: Record<string, ReturnType<typeof tierFields>>;
}

export function parseChecklist(raw: RawBlock, ctx: RenderContext): ChecklistBlock {
  const line = raw.line;
  const data = requireMap(raw.data, "checklist", line);
  allowKeys(data, BLOCK_KEYS, "checklist", line);
  const id = requireString(data, "id", "checklist", line);
  const where = `checklist "${id}"`;
  const stepsRaw = entries(data.steps, `${where} steps`, line);
  const openRaw = entries(data.open, `${where} open`, line);
  if (!stepsRaw.length && !openRaw.length) throw new SpecError(`${where} needs \`steps\` or \`open\`.`, line);
  if (stepsRaw.length > MAX_STEPS) ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} has ${stepsRaw.length} steps; keep it to ${MAX_STEPS}, one per claim a reader should check.` });
  if (openRaw.length > MAX_OPEN) ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} has ${openRaw.length} open questions; keep it to ${MAX_OPEN} and file the rest.` });
  const steps = stepsRaw.map(([sid, f], i): Step => {
    const w = `${where} step "${sid}"`;
    allowKeys(f, STEP_KEYS, w, line);
    return {
      id: sid, n: i + 1, do: requireString(f, "do", w, line), expect: optString(f, "expect", w, line), code: optString(f, "code", w, line),
      verifies: relIds(f.verifies, `${w} verifies`, line), reproduces: relIds(f.reproduces, `${w} reproduces`, line),
      done: optBool(f, "done", w, line), about: optString(f, "about", w, line),
    };
  });
  const open = openRaw.map(([qid, f], i): Question => {
    const w = `${where} open "${qid}"`;
    allowKeys(f, OPEN_KEYS, w, line);
    return {
      id: qid, n: i + 1, text: requireString(f, "text", w, line), owner: optString(f, "owner", w, line),
      decision: optBool(f, "decision", w, line), on: relIds(f.on, `${w} on`, line), about: optString(f, "about", w, line),
    };
  });
  return { type: "checklist", id, title: optString(data, "title", where, line), line, steps, open, tiers: {}, ...readingSpec(data, line) };
}

function decls(b: ChecklistBlock): Decl[] {
  return [
    ...b.steps.flatMap((s) => [{ from: s.id, rel: RELS.verifies, ids: s.verifies }, { from: s.id, rel: RELS.reproduces, ids: s.reproduces }]),
    ...b.open.map((q) => ({ from: q.id, rel: RELS.on, ids: q.on })),
  ];
}

const stepText = (s: Step) => plain(s.expect ? `${s.do}: ${s.expect}` : s.do);
const ownerText = (q: Question) => (q.owner ? `${q.owner}${q.decision ? " decides" : ""}: ` : "");

function contribution(b: ChecklistBlock): Contribution {
  return {
    elements: [
      ...b.steps.map((s) => ({ id: s.id, kind: "step" as const, label: `Step ${s.n}: ${plain(s.do)}` })),
      ...b.open.map((q) => ({ id: q.id, kind: "open" as const, label: `Open ${q.n}: ${plain(q.text)}` })),
    ],
    decls: decls(b),
    anchors: [],
  };
}

registerCollect("checklist", (raw, ctx) => contribution(parseChecklist(raw, ctx)));

export const checklistModule: BlockModule<ChecklistBlock> = {
  type: "checklist",

  normalize(raw, ctx) {
    const b = parseChecklist(raw, ctx);
    const index = reportIndex(ctx.doc, ctx, raw, contribution(b));
    for (const x of [...b.steps, ...b.open]) b.tiers[x.id] = tierFields(index, x.id);
    checkRelations(index, decls(b), `checklist "${b.id}"`, b.line, ctx);
    return b;
  },

  render(b, ctx) {
    const steps = b.steps.map((s) => {
      // the tick lives outside the mark, so ticking never selects; it is the reader's own and not in the URL
      const tick = s.done
        ? `<span class="x-check-tick" data-done="true"><span class="x-check-num" aria-label="done">✓</span></span>`
        : `<label class="x-check-tick"><input type="checkbox" aria-label="Mark step ${s.n} done"><span class="x-check-num">${s.n}</span></label>`;
      const body = ctx.inline(s.do) + (s.expect ? `: ${ctx.inline(s.expect)}` : "") + (s.code ? ` <code>${esc(s.code)}</code>` : "");
      return `<li class="x-check-item">${tick}<div class="x-mark x-check-step" data-id="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(`Step ${s.n}: ${stepText(s)}`)}">${body}</div></li>`;
    }).join("");
    const open = b.open.map((q) => {
      const owner = q.owner ? `<strong class="x-check-owner">${esc(ownerText(q).trim())}</strong> ` : "";
      return `<li class="x-check-item"><span class="x-check-tick"><span class="x-check-num">${q.n}</span></span><div class="x-mark x-check-q" data-id="${esc(q.id)}" tabindex="0" role="button" aria-label="${esc(`Open question ${q.n}: ${ownerText(q)}${plain(q.text)}`)}">${owner}${ctx.inline(q.text)}</div></li>`;
    }).join("");
    const body = (steps ? `<ol class="x-check-list">${steps}</ol>` : "") + (open ? `<p class="x-report-sub">Open</p><ol class="x-check-list x-check-open">${open}</ol>` : "");
    return panel({ id: b.id, kind: "checklist", title: b.title, label: "Checklist", body, ctx });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    for (const s of b.steps) {
      const t = b.tiers[s.id] ?? {};
      elements[s.id] = itemInfo({
        id: s.id, label: plain(s.do), figure: b.id, kind: "step", value: s.expect ? plain(s.expect) : undefined,
        sub: s.code, about: s.about, related: t.related, context: t.context, links: t.links,
        pos: `${s.n} of ${b.steps.length}`, say: `Step ${s.n}: ${stepText(s)}`,
      });
    }
    for (const q of b.open) {
      const t = b.tiers[q.id] ?? {};
      elements[q.id] = itemInfo({
        id: q.id, label: plain(q.text), figure: b.id, kind: q.decision ? "decision" : "open question", value: q.owner ? ownerText(q).replace(/: $/, "") : undefined,
        about: q.about, related: t.related, context: t.context, links: t.links,
        pos: `${q.n} of ${b.open.length}`, say: `Open question ${q.n}: ${ownerText(q)}${plain(q.text)}`,
      });
    }
    return { elements };
  },
};
