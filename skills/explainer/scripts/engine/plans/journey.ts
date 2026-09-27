// Customer journey: stages across, rows of cards (doing, thinking, touchpoints), a sentiment strip and pain markers.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type Fact, type NoteSpec, type StoryStep } from "../types.ts";
import { READING_KEYS, esc, fmt, groupInfo, htmlFigure, idFrom, itemInfo, list, mark, num, number, ordinal, rank, readingSpec, trend } from "../kit.ts";
import { allowKeys, isObj, joinList, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";

interface JourneyStage { id: string; label: string; about?: string }
interface JourneyCell { id: string; label: string; about?: string; focal: boolean; muted: boolean }
interface JourneyRow { id: string; label: string; about?: string; cells: (JourneyCell | null)[] } // one per stage; null = empty
interface JourneyPoint { id: string; value: number; about?: string }
interface JourneyPain { id: string; stage: string; label: string; about?: string }

interface JourneyBlock {
  type: "journey";
  id: string;
  title?: string;
  line: number;
  stages: JourneyStage[];
  rows: JourneyRow[];
  sentiment?: { id: string; points: JourneyPoint[] }; // one point per stage, same order
  pains?: { id: string; items: JourneyPain[] };
  notes?: NoteSpec[];
  caveat?: string;
  story?: StoryStep[];
}

const BLOCK_KEYS = ["id", "title", "stages", "rows", "sentiment", "pains", ...READING_KEYS];
const STAGE_KEYS = ["id", "label", "about"];
const ROW_KEYS = ["id", "label", "about", "cells"];
const CELL_KEYS = ["id", "label", "about", "focal", "muted"];
const POINT_KEYS = ["value", "about"];
const PAIN_KEYS = ["id", "stage", "label", "about"];
const LIMITS = { stages: 6, rows: 4, pains: 3 };
/** Most stages the stylesheet can lay out (grid templates exist for 1–12 columns). */
const MAX_STAGES = 12;
/** Sentiment band: +2 sits at `top`, each step down is `step` px; value labels go above (≥ 0) or below (< 0) the point. */
const STRIP = { height: 120, top: 24, step: 18, r: 6 };

function fields(v: unknown, keys: string[], where: string, line: number): Fields {
  if (typeof v === "string") return { label: v };
  if (!isObj(v)) throw new SpecError(`${where} must be a map { ${keys.join(", ")} } or a label.`, line);
  allowKeys(v, keys, where, line);
  return v;
}

function idPool(block: string, line: number) {
  const taken = new Set<string>([block]);
  return {
    claim(f: Fields, where: string): void {
      const id = optString(f, "id", where, line);
      if (id === undefined) return;
      if (taken.has(id)) throw new SpecError(`${where}: id "${id}" is already used in this block.`, line, "id-unique");
      taken.add(id);
    },
    make(f: Fields, text: string, where: string): string {
      return optString(f, "id", where, line) ?? idFrom(text, taken, `${block}-`);
    },
  };
}

const optList = (v: unknown, what: string, line: number) => (v === undefined ? [] : list(v, what, line));

function signed(v: number): string {
  return v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(-v)}` : "0";
}

/** ≥ 1 feels good, ≤ −1 hurts; in between is neutral (text-dim), not a warning. */
function tone(v: number): "ok" | "neutral" | "danger" {
  return v >= 1 ? "ok" : v <= -1 ? "danger" : "neutral";
}

const CORNER = `<div class="x-plan-corner" aria-hidden="true"></div>`;
const EMPTY = `<div class="x-plan-cell" data-empty="true"></div>`;

/** A row label; `lane` is its marker lane, kept on the label's line. */
function rowHead(id: string, label: string, nav: string, lane: string, sub?: string): string {
  return mark(
    { id, label, cls: "x-board-head x-plan-rowhead", attrs: ` data-nav="${nav}"` },
    `<span class="x-plan-rowhead-line"><span class="x-mark-shape x-plan-rowhead-label">${esc(label)}</span>${lane}</span>${sub ? `<span class="x-plan-rowhead-sub">${esc(sub)}</span>` : ""}`,
    true,
  );
}

/** Numbered note markers, keyed by the HTML mark they sit on. A sentiment point hands its marker to its stage head. */
function noteMarks(notes: NoteSpec[] | undefined, drawn: Set<string>, alias: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  (notes ?? []).forEach((n, i) => {
    const on = n.on.find((id) => drawn.has(id)) ?? n.on.map((id) => alias.get(id)).find((id) => id && drawn.has(id));
    if (!on) return;
    out.set(on, (out.get(on) ?? "") + `<span class="x-note-marker x-plan-note" data-note="${i + 1}" data-for="${esc(n.on.join(" "))}" aria-hidden="true">${i + 1}</span>`);
  });
  return out;
}

/** "lowest of 5", "highest of 5", "2nd highest of 5". */
function standing(v: number, values: number[]): string {
  const low = rank(v, values, "asc"), high = rank(v, values, "desc");
  if (low.n === 1 && high.n === 1) return `the same at all ${values.length} stages`;
  if (low.n === 1) return `lowest of ${values.length}`;
  if (high.n === 1) return `highest of ${values.length}`;
  return `${ordinal(high.n)} highest of ${values.length}`;
}

/** Sentiment line across the stage columns. x in % of the strip, which spans exactly the stage columns (no column gap). */
function strip(stages: JourneyStage[], points: JourneyPoint[], nav: number): string {
  const n = stages.length;
  const x = (i: number) => `${num(((i + 0.5) / n) * 100)}%`;
  const y = (v: number) => STRIP.top + (2 - v) * STRIP.step;
  const hair = (v: number, cls: string) => `<line class="${cls}" x1="0" y1="${num(y(v))}" x2="100%" y2="${num(y(v))}"/>`;
  const parts = [hair(2, "x-journey-hair"), hair(-2, "x-journey-hair"), hair(0, "x-journey-zero")];
  for (let i = 1; i < n; i++) {
    parts.push(`<line class="x-journey-line" x1="${x(i - 1)}" y1="${num(y(points[i - 1].value))}" x2="${x(i)}" y2="${num(y(points[i].value))}"/>`);
  }
  points.forEach((p, i) => {
    const cy = y(p.value);
    const ly = p.value >= 0 ? cy - STRIP.r - 4 : cy + STRIP.r + 12;
    const value = signed(p.value);
    parts.push(mark(
      { id: p.id, label: `Sentiment at ${stages[i].label}`, value, cls: "x-journey-point", attrs: ` data-tone="${tone(p.value)}" data-nav="${nav},${i}"` },
      `<circle class="x-mark-shape" cx="${x(i)}" cy="${num(cy)}" r="${STRIP.r}"/>` +
        `<text class="x-value-label" x="${x(i)}" y="${num(ly)}" text-anchor="middle">${esc(value)}</text>`,
    ));
  });
  return `<div class="x-journey-strip"><svg class="x-journey-svg" xmlns="http://www.w3.org/2000/svg" width="100%" height="${STRIP.height}" role="group" aria-label="Sentiment by stage, from −2 to +2">${parts.join("")}</svg></div>`;
}

export const blockModule: BlockModule<JourneyBlock> = {
  type: "journey",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "journey", line);
    allowKeys(data, BLOCK_KEYS, "journey", line);
    const id = requireString(data, "id", "journey", line);
    const where = `journey "${id}"`;

    const stageF = list(data.stages, `${where} stages`, line).map((v, i) => fields(v, STAGE_KEYS, `${where} stage ${i + 1}`, line));
    if (!stageF.length) throw new SpecError(`${where} needs at least one stage.`, line);
    if (stageF.length > MAX_STAGES) {
      throw new SpecError(`${where} has ${stageF.length} stages; a journey board holds at most ${MAX_STAGES}. Split it at a hand-off into two journeys of up to ${LIMITS.stages} stages.`, line);
    }
    const n = stageF.length;

    const rowF = optList(data.rows, `${where} rows`, line).map((v, i) => fields(v, ROW_KEYS, `${where} row ${i + 1}`, line));
    const cellF = rowF.map((f, r) => {
      const rw = `${where} row ${r + 1}`;
      const cells = list(f.cells, `${rw} cells`, line);
      if (cells.length !== n) {
        throw new SpecError(`${rw} has ${cells.length} cells for ${n} stages; give one per stage and use ~ for a stage with nothing.`, line);
      }
      return cells.map((c, i) => (c === null || c === undefined || c === "" ? null : fields(c, CELL_KEYS, `${rw} cell ${i + 1}`, line)));
    });

    const pointF = data.sentiment === undefined ? undefined : list(data.sentiment, `${where} sentiment`, line).map((v, i) => {
      const pw = `${where} sentiment ${i + 1}`;
      const f: Fields = isObj(v) ? v : { value: v };
      if (isObj(v)) allowKeys(v, POINT_KEYS, pw, line);
      const value = number(f.value, pw, line);
      if (value < -2 || value > 2) throw new SpecError(`${pw} is ${value}; sentiment runs from -2 (frustrated) to 2 (delighted).`, line);
      return { value, about: optString(f, "about", pw, line) };
    });
    if (pointF && pointF.length !== n) {
      throw new SpecError(`${where} sentiment has ${pointF.length} values for ${n} stages; give exactly one per stage.`, line);
    }
    if (!rowF.length && !pointF) throw new SpecError(`${where} needs \`rows\` or \`sentiment\`; otherwise nothing sits under the stages.`, line);

    const painF = optList(data.pains, `${where} pains`, line).map((v, i) => fields(v, PAIN_KEYS, `${where} pain ${i + 1}`, line));

    const pool = idPool(id, line);
    stageF.forEach((f, i) => pool.claim(f, `${where} stage ${i + 1}`));
    rowF.forEach((f, r) => pool.claim(f, `${where} row ${r + 1}`));
    cellF.forEach((cells, r) => cells.forEach((c, i) => c && pool.claim(c, `${where} row ${r + 1} cell ${i + 1}`)));
    painF.forEach((f, i) => pool.claim(f, `${where} pain ${i + 1}`));

    const stages = stageF.map((f, i): JourneyStage => {
      const w = `${where} stage ${i + 1}`;
      const label = requireString(f, "label", w, line);
      return { id: pool.make(f, label, w), label, about: optString(f, "about", w, line) };
    });

    const rows = rowF.map((f, r): JourneyRow => {
      const rw = `${where} row ${r + 1}`;
      const label = requireString(f, "label", rw, line);
      const rowId = pool.make(f, label, rw);
      const cells = cellF[r].map((c, i): JourneyCell | null => {
        if (!c) return null;
        const cw = `${rw} cell ${i + 1}`;
        return {
          id: pool.make(c, `${label} ${stages[i].label}`, cw),
          label: requireString(c, "label", cw, line),
          about: optString(c, "about", cw, line),
          focal: optBool(c, "focal", cw, line),
          muted: optBool(c, "muted", cw, line),
        };
      });
      return { id: rowId, label, about: optString(f, "about", rw, line), cells };
    });

    const sentiment = pointF && {
      id: pool.make({}, "sentiment", where),
      points: pointF.map((p, i): JourneyPoint => ({ id: pool.make({}, `sentiment ${stages[i].label}`, where), value: p.value, about: p.about })),
    };

    const stageOf = (ref: string, w: string): string => {
      const s = stages.find((k) => k.id === ref) ?? stages.find((k) => k.label === ref);
      if (!s) throw new SpecError(`${w} points at stage "${ref}", which does not exist. Stages: ${joinList(stages.map((k) => k.label))}.`, line, "ref-exists");
      return s.id;
    };
    const pains = painF.length
      ? {
        id: pool.make({}, "pains", where),
        items: painF.map((f, i): JourneyPain => {
          const w = `${where} pain ${i + 1}`;
          const label = requireString(f, "label", w, line);
          const stage = stageOf(requireString(f, "stage", w, line), w);
          return { id: pool.make(f, `pain ${label}`, w), stage, label, about: optString(f, "about", w, line) };
        }),
      }
      : undefined;

    const budget = (message: string) => ctx.warn({ rule: "budget-nodes", severity: "warn", message, line });
    if (stages.length > LIMITS.stages) budget(`${where} has ${stages.length} stages; keep it to ${LIMITS.stages}. Merge stages the customer experiences as one, or split the journey at a hand-off (e.g. before and after purchase).`);
    if (rows.length > LIMITS.rows) budget(`${where} has ${rows.length} rows; keep it to ${LIMITS.rows}. Keep doing, thinking and touchpoint; move the rest to prose or a matrix.`);
    if (pains && pains.items.length > LIMITS.pains) budget(`${where} marks ${pains.items.length} pains; keep it to ${LIMITS.pains}. Keep the ones that cost the most customers and list the rest in prose.`);
    const focal = rows.flatMap((r) => r.cells).filter((c) => c?.focal).length;
    if (focal > BUDGET.focal) ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} cells focal; keep it to ${BUDGET.focal}.`, line });

    return { type: "journey", id, title: optString(data, "title", where, line), line, stages, rows, sentiment, pains, ...readingSpec(data, line) };
  },

  render(block) {
    const drawn = new Set([
      ...block.stages.map((st) => st.id), ...block.rows.flatMap((r) => [r.id, ...r.cells.flatMap((c) => (c ? [c.id] : []))]),
      ...(block.sentiment ? [block.sentiment.id] : []), ...(block.pains ? [block.pains.id, ...block.pains.items.map((p) => p.id)] : []),
    ]);
    const alias = new Map((block.sentiment?.points ?? []).map((p, i) => [p.id, block.stages[i].id]));
    const markers = noteMarks(block.notes, drawn, alias);
    // the marker lane: note markers and the docked card's pin; after a head's label, floated into a card's first line
    const note = (id: string) => `<span class="x-plan-lane" aria-hidden="true"><span class="x-plan-pin"></span>${markers.get(id) ?? ""}</span>`;
    const parts = [CORNER];
    block.stages.forEach((s, i) => {
      parts.push(mark({ id: s.id, label: s.label, cls: "x-board-head x-plan-head x-journey-stage", attrs: ` data-nav="0,${i}"` }, `<span class="x-mark-shape x-plan-head-label">${esc(s.label)}</span>${note(s.id)}`, true));
    });
    let r = 1;
    for (const row of block.rows) {
      parts.push(rowHead(row.id, row.label, `${r},-1`, note(row.id)));
      row.cells.forEach((c, i) => {
        if (!c) { parts.push(EMPTY); return; }
        const card = mark(
          { id: c.id, label: c.label, focal: c.focal, cls: "x-card x-plan-card", attrs: (c.muted ? ` data-muted="true"` : "") + ` data-nav="${r},${i}"` },
          `<span class="x-plan-line">${note(c.id)}<span class="x-mark-shape x-card-label">${esc(c.label)}</span></span>`,
          true,
        );
        parts.push(`<div class="x-plan-cell">${card}</div>`);
      });
      r++;
    }
    if (block.sentiment) {
      parts.push(rowHead(block.sentiment.id, "Sentiment", `${r},-1`, note(block.sentiment.id), "−2 to +2"));
      parts.push(strip(block.stages, block.sentiment.points, r++));
    }
    if (block.pains) {
      const pains = block.pains;
      parts.push(rowHead(pains.id, "Pains", `${r},-1`, note(pains.id)));
      block.stages.forEach((s, i) => {
        const chips = pains.items.filter((p) => p.stage === s.id).map((p) => mark(
          { id: p.id, label: p.label, cls: "x-plan-chip x-journey-pain", attrs: ` data-tone="danger" data-nav="${r},${i}"` },
          `<span class="x-mark-shape x-plan-dot"></span><span class="x-plan-chip-label">${esc(p.label)}</span>${note(p.id)}`,
          true,
        ));
        parts.push(chips.length ? `<div class="x-plan-cell">${chips.join("")}</div>` : EMPTY);
      });
    }
    return htmlFigure({
      id: block.id,
      kind: "journey",
      title: block.title,
      cls: "x-plan",
      label: `Customer journey across ${block.stages.length} stages: ${joinList(block.stages.map((s) => s.label))}`,
      body: `<div class="x-plan-grid x-journey" data-cols="${block.stages.length}">${parts.join("")}</div>`,
    });
  },

  model(block) {
    const figure = block.id;
    const elements: Record<string, ElementInfo> = {};
    const n = block.stages.length;
    const points = block.sentiment?.points ?? [];
    const values = points.map((p) => p.value);
    const painsAt = (sid: string) => (block.pains?.items ?? []).filter((p) => p.stage === sid);
    // everything drawn in a stage's column: its cells, its point and its pains
    const column = (i: number) => [
      ...block.rows.flatMap((r) => (r.cells[i] ? [r.cells[i]!.id] : [])),
      ...(points[i] ? [points[i].id] : []),
      ...painsAt(block.stages[i].id).map((p) => p.id),
    ];
    const pointFacts = (i: number): Fact[] => {
      const p = points[i];
      if (!p) return [];
      const prev = points[i - 1];
      return [
        { k: "Sentiment", v: `${signed(p.value)} · ${standing(p.value, values)}`, ref: p.id, raw: p.value },
        ...(prev ? [{ k: "Change", v: `${signed(p.value - prev.value)} from ${block.stages[i - 1].label}`, ref: prev.id, tone: trend(p.value - prev.value), raw: p.value - prev.value }] : []),
      ];
    };

    block.stages.forEach((s, i) => {
      const pains = painsAt(s.id);
      elements[s.id] = groupInfo({
        id: s.id, label: s.label, figure, members: column(i), kind: "stage", about: s.about,
        pos: `${i + 1} of ${n}`,
        facts: [...pointFacts(i), ...(pains.length ? [{ k: "Pains", v: joinList(pains.map((p) => p.label)), ref: pains[0].id }] : [])],
        // its rows as chip groups ("Doing · Requests a number transfer"), then its pains
        links: [
          ...block.rows.flatMap((r) => (r.cells[i] ? [{ rel: r.label, ids: [r.cells[i]!.id] }] : [])),
          { rel: "Pains", ids: pains.map((p) => p.id) },
        ],
        say: `${s.label}, stage ${i + 1} of ${n}${points[i] ? `, sentiment ${signed(points[i].value)}` : ""}${pains.length ? `, ${pains.length} pain${pains.length === 1 ? "" : "s"}` : ""}`,
      });
    });
    for (const row of block.rows) {
      const cells = row.cells.filter((c): c is JourneyCell => c !== null);
      elements[row.id] = groupInfo({
        id: row.id, label: row.label, figure, members: cells.map((c) => c.id), kind: "row", about: row.about,
        facts: [{ k: "Filled", v: `${cells.length} of ${n} stages` }],
        say: `${row.label} row, ${cells.length} of ${n} stages filled`,
      });
      row.cells.forEach((c, i) => {
        if (!c) return;
        const stage = block.stages[i];
        elements[c.id] = itemInfo({
          id: c.id, label: c.label, figure, kind: "card", about: c.about,
          related: [stage.id, row.id],
          context: column(i).filter((k) => k !== c.id),
          crumb: [stage.id],
          facts: [{ k: "Row", v: row.label, ref: row.id }, ...pointFacts(i)],
          say: `${row.label} at ${stage.label}: ${c.label}`,
        });
      });
    }
    if (block.sentiment) {
      const sid = block.sentiment.id;
      const low = points.reduce((a, p) => (p.value < a.value ? p : a), points[0]);
      const high = points.reduce((a, p) => (p.value > a.value ? p : a), points[0]);
      const at = (p: JourneyPoint) => block.stages[points.indexOf(p)].label;
      elements[sid] = groupInfo({
        id: sid, label: "Sentiment", figure, kind: "row",
        members: points.map((p) => p.id),
        about: "How the customer feels at each stage, from −2 (frustrated) to +2 (delighted).",
        facts: [{ k: "Lowest", v: `${at(low)} · ${signed(low.value)}`, ref: low.id }, { k: "Highest", v: `${at(high)} · ${signed(high.value)}`, ref: high.id }],
        links: [{ rel: "Stages", ids: block.stages.map((s) => s.id) }],
        say: `Sentiment, lowest at ${at(low)} (${signed(low.value)}), highest at ${at(high)} (${signed(high.value)})`,
      });
      points.forEach((p, i) => {
        const stage = block.stages[i];
        const pains = painsAt(stage.id);
        elements[p.id] = itemInfo({
          id: p.id, label: `Sentiment at ${stage.label}`, figure, kind: "point", value: signed(p.value), about: p.about,
          related: [stage.id, sid],
          context: column(i).filter((k) => k !== p.id),
          crumb: [stage.id],
          pos: `${i + 1} of ${n}`,
          facts: [
            { k: "Standing", v: standing(p.value, values), raw: p.value },
            ...pointFacts(i).slice(1),
            ...(pains.length ? [{ k: "Pains", v: joinList(pains.map((k) => k.label)), ref: pains[0].id }] : []),
          ],
          say: `Sentiment at ${stage.label}, ${signed(p.value)}, ${standing(p.value, values)}`,
        });
      });
    }
    if (block.pains) {
      const pid = block.pains.id;
      elements[pid] = groupInfo({
        id: pid, label: "Pains", figure, kind: "row",
        members: block.pains.items.map((p) => p.id),
        about: "Moments that cost the customer time, money or trust.",
        facts: [{ k: "Stages", v: joinList([...new Set(block.pains.items.map((p) => block.stages.find((s) => s.id === p.stage)!.label))]) }],
        say: `Pains, ${block.pains.items.length} in all`,
      });
      for (const p of block.pains.items) {
        const i = block.stages.findIndex((s) => s.id === p.stage), stage = block.stages[i];
        const point = points[i];
        elements[p.id] = itemInfo({
          id: p.id, label: p.label, figure, kind: "pain", about: p.about,
          related: [stage.id, pid, ...(point ? [point.id] : [])],
          context: column(i).filter((k) => k !== p.id && k !== point?.id),
          crumb: [stage.id],
          facts: [{ k: "Stage", v: stage.label, ref: stage.id }, ...(point ? [{ k: "Sentiment", v: `${signed(point.value)} · ${standing(point.value, values)}`, ref: point.id }] : [])],
          say: `Pain at ${stage.label}: ${p.label}`,
        });
      }
    }
    return { elements };
  },

  reading(block) {
    const parts = ["Stages run left to right in the order the customer lives them, and each row reads across them."];
    if (block.sentiment) parts.push("The line is how they feel, from −2 (frustrated) at the bottom to +2 (delighted) at the top.");
    if (block.pains) parts.push("Red chips are the pains at each stage.");
    return parts.join(" ");
  },

  table(block) {
    const head = ["Stage", ...block.rows.map((r) => r.label), ...(block.sentiment ? ["Sentiment"] : []), ...(block.pains ? ["Pains"] : [])];
    const rows = block.stages.map((s, i) => [
      s.label,
      ...block.rows.map((r) => r.cells[i]?.label ?? ""),
      ...(block.sentiment ? [signed(block.sentiment.points[i].value)] : []),
      ...(block.pains ? [block.pains.items.filter((p) => p.stage === s.id).map((p) => p.label).join(", ")] : []),
    ]);
    return { head, rows } satisfies DataTable;
  },
};
