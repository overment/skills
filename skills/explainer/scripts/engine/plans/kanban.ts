// Kanban: work in columns with WIP limits. Column headers are selectable groups; cards are marks; a tag chip selects every card with that tag.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type Fact, type NoteSpec, type StoryStep } from "../types.ts";
import { READING_KEYS, esc, groupInfo, htmlFigure, idFrom, itemInfo, list, mark, number, readingSpec } from "../kit.ts";
import { allowKeys, isObj, joinList, optBool, optString, requireMap, requireString, stringList, type Fields } from "../blocks/util.ts";

interface KanbanColumn { id: string; label: string; limit?: number; about?: string }

interface KanbanCard {
  id: string;
  label: string;
  column: string; // column id
  tags: string[];
  owner?: string;
  age?: number;   // days in this column
  blocked: boolean;
  reason?: string; // why it is blocked
  focal: boolean;
  muted: boolean;
  about?: string;
}

interface KanbanTag { id: string; label: string; cards: string[] }

interface KanbanBlock {
  type: "kanban";
  id: string;
  title?: string;
  line: number;
  columns: KanbanColumn[];
  cards: KanbanCard[];
  tags: KanbanTag[]; // in order of first use
  notes?: NoteSpec[];
  caveat?: string;
  story?: StoryStep[];
}

const BLOCK_KEYS = ["id", "title", "columns", "cards", ...READING_KEYS];
const COLUMN_KEYS = ["id", "label", "limit", "about"];
const CARD_KEYS = ["id", "label", "column", "tags", "owner", "age", "blocked", "about", "focal", "muted"];
const LIMITS = { columns: 5, cards: 16, perColumn: 5 };

/** A list entry as fields: a map with only `keys`, or bare text as shorthand for `{ label }`. */
function fields(v: unknown, keys: string[], where: string, line: number): Fields {
  if (typeof v === "string") return { label: v };
  if (!isObj(v)) throw new SpecError(`${where} must be a map { ${keys.join(", ")} } or a label.`, line);
  allowKeys(v, keys, where, line);
  return v;
}

/** Explicit ids are claimed first so auto ids (`<block>-<slug>`) never take them. */
function idPool(block: string, line: number) {
  const taken = new Set<string>([block]);
  return {
    taken,
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

/** Header count ("3 / 4") and the sentence the card shows. */
function load(col: KanbanColumn, n: number): { short: string; value: string; over: number } {
  const cards = `${n} card${n === 1 ? "" : "s"}`;
  if (col.limit === undefined) return { short: String(n), value: cards, over: 0 };
  const over = Math.max(0, n - col.limit);
  return { short: `${n} / ${col.limit}`, value: `${cards} · limit ${col.limit}${over ? `, ${over} over` : ""}`, over };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Numbered note markers, keyed by the mark they sit on: the first id of each note that this board draws. */
function noteMarks(notes: NoteSpec[] | undefined, drawn: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  (notes ?? []).forEach((n, i) => {
    const on = n.on.find((id) => drawn.has(id));
    if (!on) return;
    out.set(on, (out.get(on) ?? "") + `<span class="x-note-marker x-plan-note" data-note="${i + 1}" data-for="${esc(n.on.join(" "))}" aria-hidden="true">${i + 1}</span>`);
  });
  return out;
}

export const blockModule: BlockModule<KanbanBlock> = {
  type: "kanban",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "kanban", line);
    allowKeys(data, BLOCK_KEYS, "kanban", line);
    const id = requireString(data, "id", "kanban", line);
    const where = `kanban "${id}"`;

    const colF = list(data.columns, `${where} columns`, line).map((v, i) => fields(v, COLUMN_KEYS, `${where} column ${i + 1}`, line));
    if (!colF.length) throw new SpecError(`${where} needs at least one column.`, line);
    const cardF = (data.cards === undefined ? [] : list(data.cards, `${where} cards`, line))
      .map((v, i) => fields(v, CARD_KEYS, `${where} card ${i + 1}`, line));

    const pool = idPool(id, line);
    colF.forEach((f, i) => pool.claim(f, `${where} column ${i + 1}`));
    cardF.forEach((f, i) => pool.claim(f, `${where} card ${i + 1}`));

    const columns = colF.map((f, i): KanbanColumn => {
      const w = `${where} column ${i + 1}`;
      const label = requireString(f, "label", w, line);
      const col: KanbanColumn = { id: pool.make(f, label, w), label };
      if (f.limit !== undefined) {
        const limit = number(f.limit, `${w} limit`, line);
        if (!Number.isInteger(limit) || limit < 1) throw new SpecError(`${w} limit must be a whole number of 1 or more, got ${limit}.`, line);
        col.limit = limit;
      }
      const about = optString(f, "about", w, line);
      if (about !== undefined) col.about = about;
      return col;
    });

    // Cards name their column by id or by label; ids win.
    const byRef = new Map<string, KanbanColumn>();
    for (const c of columns) byRef.set(c.id, c);
    for (const c of columns) {
      const seen = byRef.get(c.label);
      if (!seen) byRef.set(c.label, c);
      else if (seen !== c) ctx.warn({ rule: "label-duplicate", severity: "warn", message: `${where} has two columns labelled "${c.label}"; rename one, or its cards land in the first.`, line });
    }

    const cards = cardF.map((f, i): KanbanCard => {
      const w = `${where} card ${i + 1}`;
      const label = requireString(f, "label", w, line);
      const ref = requireString(f, "column", w, line);
      const column = byRef.get(ref);
      if (!column) {
        throw new SpecError(`${w} ("${label}") is in column "${ref}", which does not exist. Columns: ${joinList(columns.map((c) => c.label))}.`, line, "ref-exists");
      }
      // blocked: true, or the reason as text
      const blockedRaw = f.blocked;
      let blocked = false, reason: string | undefined;
      if (typeof blockedRaw === "string" && blockedRaw.trim()) { blocked = true; reason = blockedRaw.trim(); }
      else blocked = optBool(f, "blocked", w, line);
      let age: number | undefined;
      if (f.age !== undefined) {
        age = number(f.age, `${w} age`, line);
        if (!Number.isInteger(age) || age < 0) throw new SpecError(`${w} age is the whole days the card has sat in its column, got ${age}.`, line);
      }
      return {
        id: pool.make(f, label, w),
        label,
        column: column.id,
        tags: f.tags === undefined ? [] : [...new Set(stringList(f.tags, `${w} tags`, line))],
        owner: optString(f, "owner", w, line),
        age,
        blocked,
        reason,
        focal: optBool(f, "focal", w, line),
        muted: optBool(f, "muted", w, line),
        about: optString(f, "about", w, line),
      };
    });

    // tags: one selectable id per distinct tag, `<block>-tag-<slug>`
    const tags: KanbanTag[] = [];
    for (const c of cards) {
      for (const t of c.tags) {
        let tag = tags.find((k) => k.label === t);
        if (!tag) tags.push(tag = { id: idFrom(`tag ${t}`, pool.taken, `${id}-`), label: t, cards: [] });
        tag.cards.push(c.id);
      }
    }

    const budget = (message: string) => ctx.warn({ rule: "budget-nodes", severity: "warn", message, line });
    if (columns.length > LIMITS.columns) {
      budget(`${where} has ${columns.length} columns; keep it to ${LIMITS.columns}. Merge neighbouring stages (e.g. "Review" and "QA") or split the flow into two boards.`);
    }
    if (cards.length > LIMITS.cards) {
      budget(`${where} has ${cards.length} cards; keep it to ${LIMITS.cards}. Keep the cards the story is about and move the rest to a second board, e.g. one per team.`);
    }
    for (const c of columns) {
      const n = cards.filter((k) => k.column === c.id).length;
      if (n > LIMITS.perColumn) budget(`${where} column "${c.label}" holds ${n} cards; keep it to ${LIMITS.perColumn}. Merge related cards into one, or move the rest to a follow-up board.`);
    }
    const focal = cards.filter((c) => c.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} cards focal; keep it to ${BUDGET.focal}.`, line });
    }

    return { type: "kanban", id, title: optString(data, "title", where, line), line, columns, cards, tags, ...readingSpec(data, line) };
  },

  render(block) {
    const tagId = new Map(block.tags.map((t) => [t.label, t.id]));
    const markers = noteMarks(block.notes, new Set([...block.columns.map((c) => c.id), ...block.cards.map((c) => c.id)]));
    // the marker lane: note markers and the docked card's pin; a head lists it after the count, a card floats it into its first line
    const lane = (id: string) => `<span class="x-plan-lane" aria-hidden="true"><span class="x-plan-pin"></span>${markers.get(id) ?? ""}</span>`;
    // a tag is drawn as one chip per card; only its first chip holds the pin, so a selected tag shows one
    const pinned = new Set<string>();
    const chipLane = (id: string) => (pinned.has(id) ? "" : (pinned.add(id), lane(id)));
    const columns = block.columns.map((col, ci) => {
      const cards = block.cards.filter((c) => c.column === col.id);
      const l = load(col, cards.length);
      const blocked = cards.filter((c) => c.blocked).length;
      const flag = blocked ? `<span class="x-kanban-flag"><span class="x-plan-dot" data-tone="danger"></span>${blocked}</span>` : "";
      const head = mark(
        {
          id: col.id, label: col.label, value: l.value + (blocked ? `, ${blocked} blocked` : ""), cls: "x-board-head x-plan-head x-kanban-head",
          attrs: (l.over ? ` data-tone="warn"` : "") + ` data-nav="0,${ci}"`,
        },
        `<span class="x-mark-shape x-plan-head-label">${esc(col.label)}</span><span class="x-kanban-facts">${flag}<span class="x-plan-count">${esc(l.short)}</span></span>${lane(col.id)}`,
        true,
      );
      const body = cards.map((c, ri) => {
        // chips are marks too, but not tab stops: the card's facts reach every tag from the keyboard
        const chips = c.tags.length
          ? `<span class="x-plan-tags">${c.tags.map((t) => `<span class="x-mark x-plan-chip x-kanban-tag" data-id="${esc(tagId.get(t)!)}"><span class="x-mark-shape x-plan-chip-label">${esc(t)}</span>${chipLane(tagId.get(t)!)}</span>`).join("")}</span>`
          : "";
        const meta =
          (c.owner ? `<span class="x-plan-owner">${esc(c.owner)}</span>` : "") +
          (c.blocked ? `<span class="x-plan-blocked"><span class="x-plan-dot" data-tone="danger"></span>blocked</span>` : "");
        const attrs = (c.muted ? ` data-muted="true"` : "") + (c.blocked ? ` data-blocked="true"` : "") + ` data-nav="${ri + 1},${ci}"`;
        return mark(
          { id: c.id, label: c.label, value: c.blocked ? (c.reason ? `blocked: ${c.reason}` : "blocked") : undefined, focal: c.focal, cls: "x-card x-plan-card", attrs },
          `<span class="x-plan-line">${lane(c.id)}<span class="x-mark-shape x-card-label">${esc(c.label)}</span></span>${chips}${meta ? `<span class="x-card-meta">${meta}</span>` : ""}`,
          true,
        );
      }).join("");
      return `<div class="x-kanban-col" role="group" aria-label="${esc(col.label)}">${head}<div class="x-kanban-cards">${body}</div></div>`;
    });
    return htmlFigure({
      id: block.id,
      kind: "kanban",
      title: block.title,
      cls: "x-plan",
      label: `Kanban board: ${joinList(block.columns.map((c) => c.label))}`,
      body: `<div class="x-kanban" data-cols="${block.columns.length}">${columns.join("")}</div>`,
    });
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const label = new Map(block.cards.map((c) => [c.id, c.label]));
    const names = (ids: string[]) => joinList(ids.map((i) => label.get(i)!));
    const tagOf = new Map(block.tags.map((t) => [t.label, t]));
    const n = block.columns.length;
    block.columns.forEach((col, ci) => {
      const own = block.cards.filter((c) => c.column === col.id);
      const l = load(col, own.length);
      const blocked = own.filter((c) => c.blocked).map((c) => c.id);
      const owners = new Map<string, number>();
      for (const c of own) if (c.owner) owners.set(c.owner, (owners.get(c.owner) ?? 0) + 1);
      const facts: Fact[] = [
        { k: "Load", v: col.limit === undefined ? plural(own.length, "card") : `${own.length} / ${col.limit}${l.over ? ` · ${l.over} over the limit` : ""}`, raw: own.length, ...(l.over ? { tone: "up" as const } : {}) },
        { k: "Blocked", v: blocked.length ? names(blocked) : "none", ...(blocked.length ? { ref: blocked[0] } : {}) },
      ];
      if (owners.size) facts.push({ k: "Owners", v: [...owners].map(([o, k]) => `${o} ${k}`).join(" · ") });
      elements[col.id] = groupInfo({
        id: col.id, label: col.label, figure: block.id, members: own.map((c) => c.id), kind: "column", about: col.about,
        value: l.value, pos: `${ci + 1} of ${n}`, facts,
        say: `${col.label}, ${l.value}${blocked.length ? `, ${blocked.length} blocked` : ""}`,
      });
    });
    for (const c of block.cards) {
      const col = block.columns.find((k) => k.id === c.column)!;
      const inCol = block.cards.filter((k) => k.column === col.id).length;
      const tags = c.tags.map((t) => tagOf.get(t)!);
      const facts: Fact[] = [{ k: "Column", v: col.limit === undefined ? col.label : `${col.label} · ${inCol} / ${col.limit}`, ref: col.id }];
      if (c.age !== undefined) facts.push({ k: "In column", v: plural(c.age, "day"), raw: c.age });
      if (c.blocked) facts.push({ k: "Blocked", v: c.reason ?? "yes", tone: "down" });
      for (const t of tags) facts.push({ k: "Tag", v: `${t.label}: ${plural(t.cards.length, "card")}`, ref: t.id, raw: t.cards.length });
      if (c.owner) facts.push({ k: "Owner", v: c.owner });
      elements[c.id] = itemInfo({
        id: c.id,
        label: c.label,
        figure: block.id,
        kind: "card",
        value: c.blocked ? "blocked" : undefined,
        about: c.about,
        related: [c.column, ...tags.map((t) => t.id)],
        context: [...new Set(tags.flatMap((t) => t.cards))].filter((k) => k !== c.id),
        facts,
        say: `${c.label}, in ${col.label}${c.blocked ? `, blocked${c.reason ? `: ${c.reason}` : ""}` : ""}${c.tags.length ? `, tagged ${joinList(c.tags)}` : ""}`,
      });
    }
    for (const t of block.tags) {
      const cols = block.columns.map((col) => [col.label, t.cards.filter((k) => block.cards.find((c) => c.id === k)!.column === col.id).length] as const).filter(([, k]) => k);
      elements[t.id] = groupInfo({
        id: t.id, label: t.label, figure: block.id, members: t.cards, kind: "tag", value: plural(t.cards.length, "card"),
        facts: [{ k: "Columns", v: cols.map(([l, k]) => `${l} ${k}`).join(" · ") }],
        say: `Tag ${t.label}, ${plural(t.cards.length, "card")}`,
      });
    }
    return { elements };
  },

  reading(block) {
    const parts = ["Each column is a stage, left to right, and each card is one piece of work in it."];
    if (block.columns.some((c) => c.limit !== undefined)) parts.push("A count like 4 / 3 is the cards in the column against its limit; over the limit, the stage is the bottleneck.");
    if (block.cards.some((c) => c.blocked)) parts.push("A red bar on a card's left edge means it is blocked.");
    return parts.join(" ");
  },

  table(block) {
    const col = new Map(block.columns.map((c) => [c.id, c.label]));
    return {
      head: ["Card", "Column", "Tags", "Owner", "Blocked"],
      rows: block.cards.map((c) => [c.label, col.get(c.column)!, c.tags.join(", "), c.owner ?? "", c.blocked ? c.reason ?? "yes" : ""]),
    } satisfies DataTable;
  },
};
