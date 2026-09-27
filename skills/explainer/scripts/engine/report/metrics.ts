// Metrics: a before/after table. Values keep the author's text but are parsed (numbers, units, ranges) so
// the tone and the change column come from `better`; words stay neutral unless toned. A PROOF sub-table
// lists what was run, each status as a symbol plus a word.
import { esc, idFrom, isObj, itemInfo, list, num, readingSpec } from "../kit.ts";
import { allowKeys, entries, optString, requireMap, requireString } from "../blocks/util.ts";
import { SpecError, type BlockModule, type ElementInfo, type Fact, type RawBlock, type ReadingSpec, type RenderContext, type Tone } from "../types.ts";
import { checkRelations, panel, parseTone, plain, registerCollect, relIds, reportIndex, RELS, tierFields, type Contribution, type Decl } from "./common.ts";
import { delta, parseQuantity, type Better, type Delta, type Quantity } from "./units.ts";

const MAX_ROWS = 8;
const BLOCK_KEYS = ["id", "title", "better", "columns", "corner", "change", "bars", "rows", "proof", "notes", "caveat", "story"];
const ROW_KEYS = ["label", "before", "after", "unit", "better", "measures", "about", "tone"];
const CELL_KEYS = ["text", "tone"];
const PROOF_KEYS = ["id", "label", "value", "status", "about", "proves"];
const STATUS = {
  pass: { sym: "✓", word: "pass", tone: "ok" },
  fail: { sym: "×", word: "fail", tone: "danger" },
  known: { sym: "◐", word: "known", tone: "warn" },
  skip: { sym: "—", word: "not run", tone: "neutral" },
} as const satisfies Record<string, { sym: string; word: string; tone: Tone }>;
type Status = keyof typeof STATUS;
const STATUS_WORDS: Record<string, Status> = { pass: "pass", passed: "pass", ok: "pass", fail: "fail", failed: "fail", known: "known", partial: "known", skip: "skip", skipped: "skip", "not run": "skip" };

export interface Cell { text: string; q?: Quantity; tone: Tone; toneSet: boolean }
export interface MetricRow { id: string; label: string; before: Cell; after: Cell; better?: Better; measures: string[]; about?: string; delta: Delta }
export interface ProofRow { id: string; label: string; value: string; status: Status; about?: string; proves: string[] }

export interface MetricsBlock extends ReadingSpec {
  type: "metrics";
  id: string;
  title?: string;
  line: number;
  better?: Better;
  columns: [string, string];
  corner: string;
  change?: string;              // header of the change column; undefined hides it
  bars: boolean;
  rows: MetricRow[];
  proof: ProofRow[];
  tiers: Record<string, ReturnType<typeof tierFields>>;
}

function better(v: unknown, what: string, line: number): Better | undefined {
  if (v == null) return undefined;
  if (v === "lower" || v === "higher") return v;
  throw new SpecError(`${what}: \`better\` must be lower or higher.`, line);
}

function cell(v: unknown, unit: string | undefined, what: string, line: number): Cell {
  let textValue: string, tone: Tone | undefined;
  if (isObj(v)) {
    allowKeys(v, CELL_KEYS, what, line);
    textValue = requireString(v, "text", what, line);
    tone = parseTone(v.tone, what, line);
  } else if (typeof v === "string" || typeof v === "number") textValue = String(v).trim();
  else throw new SpecError(`${what} must be a value like "0.8 ms", "3.3–6.1 s" or words, or {text, tone}.`, line);
  if (!textValue) throw new SpecError(`${what} is empty.`, line);
  // a bare number takes the row's unit, and shows it
  if (unit && /^[\d.,–—\s-]+$/.test(textValue)) textValue = `${textValue} ${unit}`;
  return { text: textValue, q: parseQuantity(textValue), tone: tone ?? "neutral", toneSet: tone !== undefined };
}

export function parseMetrics(raw: RawBlock, ctx: RenderContext): MetricsBlock {
  const line = raw.line;
  const data = requireMap(raw.data, "metrics", line);
  allowKeys(data, BLOCK_KEYS, "metrics", line);
  const id = requireString(data, "id", "metrics", line);
  const where = `metrics "${id}"`;
  const blockBetter = better(data.better, where, line);
  const cols = data.columns == null ? ["Before", "After"] : list(data.columns, `${where} columns`, line).map(String);
  if (cols.length !== 2) throw new SpecError(`${where}: \`columns\` names the two value columns, e.g. [Before, After].`, line);
  const rowsRaw = entries(data.rows, `${where} rows`, line);
  if (!rowsRaw.length && data.proof == null) throw new SpecError(`${where} needs \`rows\` or \`proof\`.`, line);
  if (rowsRaw.length > MAX_ROWS) ctx.warn({ rule: "budget-nodes", severity: "warn", line, message: `${where} has ${rowsRaw.length} rows; keep it to ${MAX_ROWS}, the ones the cards claim to move.` });

  const rows = rowsRaw.map(([rid, f]): MetricRow => {
    const w = `${where} row "${rid}"`;
    allowKeys(f, ROW_KEYS, w, line);
    const unit = optString(f, "unit", w, line);
    if (f.before == null || f.after == null) throw new SpecError(`${w} needs \`before\` and \`after\` (words are fine: "not re-measured").`, line);
    const before = cell(f.before, unit, `${w} before`, line), after = cell(f.after, unit, `${w} after`, line);
    const rowBetter = better(f.better, w, line) ?? blockBetter;
    const rowTone = f.tone == null ? undefined : parseTone(f.tone, w, line);
    if (rowTone) for (const c of [before, after]) if (!c.toneSet) { c.tone = rowTone; c.toneSet = true; }
    let d = delta(before.q, after.q, rowBetter);
    if (d.direction !== "unknown" && d.direction !== "same") {
      if (!before.toneSet) before.tone = d.tone.before;
      if (!after.toneSet) after.tone = d.tone.after;
    } else if (d.words === "—" && (before.toneSet || after.toneSet)) {
      // words on both sides: an authored tone pair still says which way it went, so tone is never hue alone
      const good = after.tone === "ok" && before.tone !== "ok", bad = after.tone === "danger";
      if (good || bad) d = { ...d, words: good ? "better" : "worse", direction: good ? "better" : "worse" };
    }
    if (before.q && after.q && before.q.dim === after.q.dim && !rowBetter) {
      ctx.warn({ rule: "spec", severity: "warn", line, message: `${w} compares two numbers but neither it nor the block says \`better: lower|higher\`; the change stays untoned.` });
    }
    const about = optString(f, "about", w, line);
    if (!about) ctx.warn({ rule: "about-missing", severity: "warn", line, message: `${w} has no \`about\`; say how it was measured (tool, runs, machine).` });
    return { id: rid, label: requireString(f, "label", w, line), before, after, better: rowBetter, measures: relIds(f.measures, `${w} measures`, line), about, delta: d };
  });

  const taken = new Set(rows.map((r) => r.id));
  const proof = (data.proof == null ? [] : list(data.proof, `${where} proof`, line)).map((it, i): ProofRow => {
    const w = `${where} proof item ${i + 1}`;
    const f = requireMap(it, w, line);
    allowKeys(f, PROOF_KEYS, w, line);
    const label = requireString(f, "label", w, line);
    const status = STATUS_WORDS[String(f.status ?? "").trim().toLowerCase()];
    if (!status) throw new SpecError(`${w}: \`status\` must be pass, fail, known or skip.`, line);
    const explicit = optString(f, "id", w, line);
    if (explicit && taken.has(explicit)) throw new SpecError(`${where}: id "${explicit}" is used twice.`, line, "id-unique");
    if (explicit) taken.add(explicit);
    return { id: explicit ?? idFrom(label, taken, `${id}-`), label, value: optString(f, "value", w, line) ?? "", status, about: optString(f, "about", w, line), proves: relIds(f.proves, `${w} proves`, line) };
  });

  const change = data.change === false ? undefined : typeof data.change === "string" ? data.change : "Change";
  const bars = data.bars == null ? false : data.bars === "log" || data.bars === true;
  if (data.bars != null && data.bars !== "log" && data.bars !== "off" && typeof data.bars !== "boolean") throw new SpecError(`${where}: \`bars\` must be log or off.`, line);
  return {
    type: "metrics", id, title: optString(data, "title", where, line), line, better: blockBetter,
    columns: [cols[0], cols[1]], corner: optString(data, "corner", where, line) ?? "Where", change, bars,
    rows, proof, tiers: {}, ...readingSpec(data, line),
  };
}

function decls(b: MetricsBlock): Decl[] {
  return [
    ...b.rows.map((r) => ({ from: r.id, rel: RELS.measures, ids: r.measures })),
    ...b.proof.map((p) => ({ from: p.id, rel: RELS.proves, ids: p.proves })),
  ];
}

function contribution(b: MetricsBlock): Contribution {
  return {
    elements: [...b.rows.map((r) => ({ id: r.id, kind: "row" as const, label: plain(r.label) })), ...b.proof.map((p) => ({ id: p.id, kind: "proof" as const, label: plain(p.label) }))],
    decls: decls(b),
    anchors: [],
  };
}

registerCollect("metrics", (raw, ctx) => contribution(parseMetrics(raw, ctx)));

const tone = (t: Tone) => (t === "neutral" ? "" : ` data-tone="${t}"`);

/** before → after on one log scale shared by every row of the same kind. */
function logBars(b: MetricsBlock): Map<string, string> {
  const out = new Map<string, string>();
  const rows = b.rows.filter((r) => r.before.q && r.after.q && r.before.q.dim === r.after.q.dim && r.before.q.hi > 0 && r.after.q.hi > 0);
  const W = 88, H = 12;
  for (const dim of new Set(rows.map((r) => r.before.q!.dim))) {
    const same = rows.filter((r) => r.before.q!.dim === dim);
    const vals = same.flatMap((r) => [r.before.q!.hi, r.after.q!.hi, r.before.q!.lo, r.after.q!.lo]).filter((v) => v > 0);
    const lo = Math.log10(Math.min(...vals)) - 0.3, hi = Math.log10(Math.max(...vals));
    const w = (v: number) => Math.max(2, ((Math.log10(v) - lo) / Math.max(0.1, hi - lo)) * W);
    for (const r of same) {
      out.set(r.id, `<svg class="x-metric-bars" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">` +
        `<rect class="x-metric-bar"${tone(r.before.tone)} x="0" y="1" width="${num(w(r.before.q!.hi))}" height="4" rx="1"/>` +
        `<rect class="x-metric-bar"${tone(r.after.tone)} x="0" y="7" width="${num(w(r.after.q!.hi))}" height="4" rx="1"/></svg>`);
    }
  }
  return out;
}

export const metricsModule: BlockModule<MetricsBlock> = {
  type: "metrics",

  normalize(raw, ctx) {
    const b = parseMetrics(raw, ctx);
    const index = reportIndex(ctx.doc, ctx, raw, contribution(b));
    for (const r of [...b.rows, ...b.proof]) b.tiers[r.id] = tierFields(index, r.id);
    checkRelations(index, decls(b), `metrics "${b.id}"`, b.line, ctx);
    return b;
  },

  render(b, ctx) {
    const bars = b.bars ? logBars(b) : new Map<string, string>();
    const rule = b.better ? `${b.better === "lower" ? "Lower" : "Higher"} is better. Ranges are compared end to end: low with low, high with high.` : "Ranges are compared end to end: low with low, high with high.";
    const head = `<thead><tr><th scope="col">${esc(b.corner)}</th><th scope="col">${esc(b.columns[0])}</th><th scope="col">${esc(b.columns[1])}</th>` +
      (b.change ? `<th scope="col" title="${esc(rule)}">${esc(b.change)}</th>` : "") + `</tr></thead>`;
    // numbers set in the sans with tabular figures, like every number on the page; mono is for code (backticks in a proof value)
    const cellHtml = (c: Cell) => `<td class="x-metric-cell"${tone(c.tone)}>${esc(c.text)}</td>`;
    const rows = b.rows.map((r) =>
      `<tr class="x-mark x-metric-row" data-id="${esc(r.id)}" tabindex="0" role="button" aria-label="${esc(`${plain(r.label)}: ${r.before.text} → ${r.after.text}${r.delta.words !== "—" ? `, ${r.delta.words}` : ""}`)}">` +
      `<th scope="row">${ctx.inline(r.label)}</th>${cellHtml(r.before)}${cellHtml(r.after)}` +
      (b.change ? `<td class="x-metric-delta"${r.delta.direction === "better" ? tone("ok") : r.delta.direction === "worse" ? tone("danger") : ""}>${bars.get(r.id) ?? ""}<span>${esc(r.delta.words)}</span></td>` : "") +
      `</tr>`).join("");
    const table = b.rows.length ? `<table class="x-metrics">${head}<tbody>${rows}</tbody></table>` : "";
    const proof = b.proof.length
      ? `<p class="x-report-sub">Proof</p><table class="x-metrics x-proof"><tbody>${b.proof.map((p) => {
        const s = STATUS[p.status];
        return `<tr class="x-mark x-proof-row" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(`${plain(p.label)}: ${s.word}${p.value ? `, ${p.value}` : ""}`)}">` +
          `<th scope="row">${ctx.inline(p.label)}</th><td class="x-proof-status"${tone(s.tone)}><span aria-hidden="true">${s.sym}</span> ${s.word}</td>` +
          `<td class="x-proof-value">${ctx.inline(p.value)}</td></tr>`;
      }).join("")}</tbody></table>`
      : "";
    return panel({ id: b.id, kind: "metrics", title: b.title, label: "Before and after", body: table + proof, ctx });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    b.rows.forEach((r, i) => {
      const t = b.tiers[r.id] ?? {};
      const value = `${r.before.text} → ${r.after.text}${r.delta.words !== "—" ? ` · ${r.delta.words}` : ""}`;
      const facts: Fact[] = [
        { k: b.columns[0], v: r.before.text },
        { k: b.columns[1], v: r.after.text },
      ];
      if (r.delta.words !== "—") facts.push({ k: "Change", v: r.delta.words, tone: r.delta.direction === "better" ? "down" : r.delta.direction === "worse" ? "up" : "flat" });
      if (r.better) facts.push({ k: "Better", v: r.better });
      elements[r.id] = itemInfo({
        id: r.id, label: plain(r.label), figure: b.id, kind: "metric", value, about: r.about,
        related: t.related, context: t.context, links: t.links, facts,
        pos: `${i + 1} of ${b.rows.length}`, say: `${plain(r.label)}, ${value}`,
      });
    });
    b.proof.forEach((p) => {
      const t = b.tiers[p.id] ?? {};
      const s = STATUS[p.status];
      elements[p.id] = itemInfo({
        id: p.id, label: plain(p.label), figure: b.id, kind: "proof", value: `${s.sym} ${s.word}`, sub: p.value ? plain(p.value) : undefined, about: p.about,
        related: t.related, context: t.context, links: t.links, say: `${plain(p.label)}, ${s.word}${p.value ? `, ${plain(p.value)}` : ""}`,
      });
    });
    return { elements };
  },
};
