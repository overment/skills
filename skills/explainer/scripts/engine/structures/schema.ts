// schema: database tables on the figure grid. `physical` runs one connector per foreign key from the fk row to the row
// it references; `er` hides column types and joins tables from `relations` (or from the fk columns when omitted).
// Both draw crow's-foot ends: many or at most one at the referencing side, one or at most one at the referenced side.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type Fact, type Link, type ReadingSpec, type RenderContext, type Theme } from "../types.ts";
import { READING_KEYS, esc, factList, idFrom, isObj, itemInfo, list, mark, notes as noteMarkers, num, readingSpec, svgFigure, text, textWidth } from "../kit.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString } from "../blocks/util.ts";
import {
  bandPath, boxWidth, cell, cellsFor, checkRefs, columnWidth, count, edgePath, edgeSvg, fitText, inflate, joinDots, markerObstacles, overlaps, placeLabel,
  rectOf, routeBoxes, routeRows, runBoxes, spanOf, union, withColumn, type Pt, type Rect, type Route, type RowLink,
} from "./grid.ts";

type Card = "one" | "zero-one" | "many" | "one-many" | "zero-many";
type Mode = "physical" | "er";

interface SchemaColumn {
  id: string;
  name: string;
  type: string;                        // "" when omitted
  pk: boolean;
  fk?: { table: string; column: string; action?: string };
  null: boolean;
  unique: boolean;
  about?: string;
}

interface SchemaTable {
  id: string;
  name: string;
  at: Pt;
  span: Pt;                            // [cols, rows]; rows follow the column count
  columns: SchemaColumn[];
  about?: string;
  focal: boolean;
  muted: boolean;
}

interface SchemaRelation {
  id: string;
  from: string;                        // table id (the referencing table for fk relations)
  to: string;                          // table id
  label?: string;                      // drawn on the connector: the er label, or the fk's referential action
  title: string;                       // card title
  about: string;
  ends: [Card, Card];                  // cardinality at the from end and at the to end
  column?: string;                     // fk column the relation comes from
  target?: string;                     // column it references
  action?: string;                     // referential action, "cascade"
}

interface SchemaBlock extends ReadingSpec {
  type: "schema";
  id: string;
  title?: string;
  line: number;
  mode: Mode;
  grid: Pt;
  cell: number;                        // this figure's column width
  tables: SchemaTable[];
  relations: SchemaRelation[];
}

type DraftColumn = Omit<SchemaColumn, "id">;

const LIMIT = { tables: 6, columns: 8, relations: 8 } as const;
const HEAD = 34, ROW = 24, EDGE = 3, INSET = 10, CHIP_H = 18;
const TABLE_KEYS = ["at", "span", "columns", "about", "focal", "muted"];
const COLUMN_KEYS = ["name", "type", "pk", "fk", "null", "unique", "about"];
const ACTIONS = ["cascade", "restrict", "set-null", "set-default", "no-action"];
const CARDS = new Map<string, Card>([["1", "one"], ["0..1", "zero-one"], ["*", "many"], ["1..*", "one-many"], ["0..*", "zero-many"]]);
const CARD_WORDS: Record<Card, string> = {
  one: "exactly one", "zero-one": "at most one", many: "any number of", "one-many": "at least one", "zero-many": "any number of",
};
const RELATION = /^\s*([^\s:]+)\s+(1|0\.\.1|\*|1\.\.\*|0\.\.\*)\s*--\s*(1|0\.\.1|\*|1\.\.\*|0\.\.\*)\s+([^\s:]+)\s*(?::\s*(.*\S))?\s*$/;

/** Row centre of column i: below the head and its rule, in the middle of the 24px row. */
const rowY = (r: Rect, i: number) => r.y + HEAD + EDGE + i * ROW + ROW / 2;

export const blockModule: BlockModule<SchemaBlock> = {
  type: "schema",

  normalize(raw, ctx) {
    const line = raw.line;
    const theme = ctx.theme;
    const data = requireMap(raw.data, "schema", line);
    allowKeys(data, ["id", "title", "mode", "tables", "relations", ...READING_KEYS], "schema", line);
    const id = requireString(data, "id", "schema", line);
    const where = `schema "${id}"`;
    const modeRaw = data.mode ?? "physical";
    if (modeRaw !== "physical" && modeRaw !== "er") throw new SpecError(`${where}: mode must be physical or er, got ${JSON.stringify(modeRaw)}.`, line);
    const mode: Mode = modeRaw === "er" ? "er" : "physical";
    const tableMap = requireMap(data.tables, `${where} tables`, line);
    const names = Object.keys(tableMap);
    if (!names.length) throw new SpecError(`${where} needs at least one table under \`tables\`.`, line);

    const taken = new Set<string>();
    const drafted = names.map((name) => {
      const tw = `${where} table "${name}"`;
      const v = tableMap[name];
      if (!isObj(v)) throw new SpecError(`${tw} must be a map: { at: [col, row], columns: [...] }.`, line);
      allowKeys(v, TABLE_KEYS, tw, line);
      if (v.at === undefined) throw new SpecError(`${tw} needs \`at: [col, row]\`.`, line);
      const at = cell(v.at, `${tw} at`, line);
      const drafts = list(v.columns, `${tw} columns`, line).map((c, i) => parseColumn(c, `${tw} column ${i + 1}`, line));
      if (!drafts.length) throw new SpecError(`${tw} needs at least one column.`, line);
      const seen = new Set<string>();
      for (const c of drafts) {
        if (seen.has(c.name)) throw new SpecError(`${tw}: column "${c.name}" is listed twice.`, line, "id-unique");
        seen.add(c.name);
      }
      const tid = idFrom(name, taken, `${id}-`);
      const columns = drafts.map((c) => ({ id: idFrom(`${name}-${c.name}`, taken, `${id}-`), ...c }));
      const size = tableSize(name, columns, mode, theme);
      const span = spanOf(v.span, `${tw} span`, line);
      if (columns.length > LIMIT.columns) {
        ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${tw} shows ${columns.length} columns; keep it to ${LIMIT.columns}: the keys and the columns the story needs.`, line });
      }
      const table: SchemaTable = {
        id: tid, name, at, span: [span ?? 1, cellsFor(size.h, theme.grid.cell[1], theme.grid.gap[1])], columns,
        about: optString(v, "about", tw, line), focal: optBool(v, "focal", tw, line), muted: optBool(v, "muted", tw, line),
      };
      return { tw, size, span, table };
    });
    // Every table is as wide as the widest one that fits a column, so the figure stays within 960px.
    const cols = Math.max(...drafted.map((d) => d.table.at[0] + (d.span ?? 1)));
    const width = columnWidth(drafted.filter((d) => d.span === undefined).map((d) => d.size.w), cols, theme);
    const tables = drafted.map(({ tw, size, span, table }) => {
      const need = cellsFor(size.w, width, theme.grid.gap[0]);
      table.span[0] = span ?? Math.min(need, 3);
      if (need > table.span[0]) {
        ctx.warn({ rule: "label-fit", severity: "warn", message: `${tw} needs span: ${need} to show "${size.widest}" in full; widen it or shorten the name or type.`, line });
      }
      return table;
    });

    const byName = new Map(tables.map((t) => [t.name, t]));
    const target = (t: SchemaTable, c: SchemaColumn) => {
      const fk = c.fk as { table: string; column: string };
      const to = byName.get(fk.table);
      if (!to) throw new SpecError(`${where}: ${t.name}.${c.name} points at table "${fk.table}", which is not in tables (${names.join(", ")}).`, line, "ref-exists");
      const col = to.columns.find((x) => x.name === fk.column);
      if (!col) throw new SpecError(`${where}: ${t.name}.${c.name} points at ${fk.table}.${fk.column}, but ${fk.table} has no column "${fk.column}".`, line, "ref-exists");
      return { to, col };
    };
    const fks: { t: SchemaTable; c: SchemaColumn; to: SchemaTable; col: SchemaColumn }[] = [];
    for (const t of tables) for (const c of t.columns) if (c.fk) fks.push({ t, c, ...target(t, c) });

    const edgeIds = new Set<string>();
    const edgeId = (from: string, to: string) => {
      let e = `${from}->${to}`;
      for (let n = 2; edgeIds.has(e); n++) e = `${from}->${to}#${n}`;
      edgeIds.add(e);
      return e;
    };
    const fkEnds = (c: SchemaColumn): [Card, Card] => [c.unique ? "zero-one" : "many", c.null ? "zero-one" : "one"];

    const relations: SchemaRelation[] = [];
    if (mode === "physical") {
      if (data.relations !== undefined) throw new SpecError(`${where}: relations only apply to mode: er; physical mode draws one connector per \`fk\` column.`, line);
      for (const { t, c, to, col } of fks) {
        const action = c.fk?.action;
        relations.push({
          id: edgeId(t.id, to.id), from: t.id, to: to.id, label: action ? actionWords(action) : undefined, column: c.id, target: col.id, action,
          ends: fkEnds(c), title: `${t.name}.${c.name} → ${to.name}.${col.name}`,
          about: `Each ${t.name} row stores the ${col.name} of ${c.null ? "at most" : "exactly"} one ${to.name} row in ${c.name}.`,
        });
      }
    } else if (data.relations === undefined) {
      for (const { t, c, to, col } of fks) {
        const ends = fkEnds(c);
        relations.push({ id: edgeId(t.id, to.id), from: t.id, to: to.id, column: c.id, target: col.id, action: c.fk?.action, ends, title: `${t.name} → ${to.name}`, about: cardAbout(t.name, ends[0], to.name, ends[1]) });
      }
    } else {
      list(data.relations, `${where} relations`, line).forEach((item, i) => {
        const rw = `${where} relation ${i + 1}`;
        let spec: string;
        let about: string | undefined;
        if (typeof item === "string") spec = item;
        else if (isObj(item)) {
          allowKeys(item, ["rel", "about"], rw, line);
          spec = requireString(item, "rel", rw, line);
          about = optString(item, "about", rw, line);
        } else throw new SpecError(`${rw} must be a string like "users 1--* orders" or { rel, about }.`, line);
        const m = RELATION.exec(spec);
        if (!m) throw new SpecError(`${rw} "${spec}" must read "table 1--* table", with 1, 0..1, *, 1..* or 0..* at each end and an optional ": label".`, line);
        const [, a = "", ca = "", cb = "", b = "", label] = m;
        const ta = byName.get(a), tb = byName.get(b);
        if (!ta || !tb) throw new SpecError(`${rw} names table "${ta ? b : a}", which is not in tables (${names.join(", ")}).`, line, "ref-exists");
        checkLabel(label, rw, line, ctx);
        const ends: [Card, Card] = [CARDS.get(ca) as Card, CARDS.get(cb) as Card];
        relations.push({
          id: edgeId(ta.id, tb.id), from: ta.id, to: tb.id, label, ends,
          title: label ? `${a} ${label} ${b}` : `${a} ${ca}–${cb} ${b}`,
          about: about ?? cardAbout(a, ends[0], b, ends[1]),
        });
      });
    }

    for (let i = 0; i < tables.length; i++) {
      for (let j = i + 1; j < tables.length; j++) {
        const a = tables[i] as SchemaTable, b = tables[j] as SchemaTable;
        if (overlaps(a, b)) {
          throw new SpecError(`${where}: tables "${a.name}" and "${b.name}" overlap. "${a.name}" covers ${a.span[0]}×${a.span[1]} cells from [${a.at.join(", ")}] because of its width and ${a.columns.length} columns; move "${b.name}" to row ${a.at[1] + a.span[1]} or column ${a.at[0] + a.span[0]}.`, line, "grid-collision");
        }
      }
    }
    if (tables.length > LIMIT.tables) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${tables.length} tables; keep it to ${LIMIT.tables}. Split by area (e.g. one schema for ordering, one for billing) and connect them in prose.`, line });
    }
    if (relations.length > LIMIT.relations) {
      ctx.warn({ rule: "budget-edges", severity: "warn", message: `${where} draws ${relations.length} relations; keep it to ${LIMIT.relations}. Drop lookup tables or split the schema by area.`, line });
    }
    const focal = tables.filter((t) => t.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} tables focal; keep it to ${BUDGET.focal}.`, line });
    }
    const reading = readingSpec(data, line);
    checkRefs(reading, new Set([...tables.flatMap((t) => [t.id, ...t.columns.map((c) => c.id)]), ...relations.map((r) => r.id)]), where, line);
    const grid: Pt = [Math.max(...tables.map((t) => t.at[0] + t.span[0])), Math.max(...tables.map((t) => t.at[1] + t.span[1]))];
    return { type: "schema", id, title: optString(data, "title", where, line), line, mode, grid, cell: width, tables, relations, ...reading };
  },

  render(block, ctx) {
    const theme = ctx.theme, fid = block.id, pad = theme.grid.pad;
    const grid = withColumn(theme, block.cell);
    // A table is as tall as its rows and as wide as the figure's column; the grid span only reserves room for it.
    const rects = new Map(block.tables.map((t) => {
      const r = rectOf(t.at, t.span, grid), size = tableSize(t.name, t.columns, block.mode, theme);
      return [t.id, { ...r, w: boxWidth(t.span[0], size.w, grid), h: Math.min(r.h, size.h) }] as const;
    }));
    const boxes = block.tables.map((t) => ({ id: t.id, label: t.name, at: t.at, span: t.span }));
    const routes = block.mode === "physical" ? routeRows(block, boxes, rowLinks(block, rects), rects, grid) : routeBoxes(block, boxes, block.relations, rects, grid);
    for (const r of routes.values()) if (r.warn) ctx.warn({ rule: "route", severity: "warn", message: r.warn, line: block.line });

    // Labels sit beside a run, clear of every box; the canvas then grows to hold routes and labels on any side.
    const blocked = [...rects.values()].map((r) => inflate(r, 2));
    const labels = new Map<string, Rect>();
    for (const r of block.relations) {
      if (!r.label) continue;
      const pts = routes.get(r.id)?.points ?? [];
      const lines = block.relations.filter((o) => o !== r).flatMap((o) => runBoxes(routes.get(o.id)?.points ?? []));
      const box = placeLabel(r.label, pts, theme.type.edgeLabel, [...blocked, ...labels.values()], lines);
      if (box) labels.set(r.id, box);
      else ctx.warn({ rule: "edge-label", severity: "warn", message: `schema "${fid}": label "${r.label}" on ${r.title} has no room beside its connector; move the tables apart.`, line: block.line });
    }
    const ext = union([
      ...[...rects.values()].map((r) => inflate(r, pad)),
      ...[...routes.values()].flatMap((r) => r.points.map(([x, y]) => inflate({ x, y, w: 0, h: 0 }, pad / 2))),
      ...[...labels.values()].map((b) => inflate(b, pad / 2)),
    ]);
    const dx = -ext.x, dy = -ext.y;
    const at = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
    const shift = (p: Pt[]): Pt[] => p.map(([x, y]) => [x + dx, y + dy]);

    const drawn: Pt[][] = [];
    const edges = block.relations.map((r) => {
      const route = routes.get(r.id) as Route;
      const pts = shift(route.points);
      const d = edgePath(pts, drawn);
      drawn.push(pts);
      const box = labels.get(r.id);
      const label = box && r.label ? labelSvg(r.label, at(box), theme.type.edgeLabel) : "";
      const markers = { start: `${fid}-er-${r.ends[0]}`, end: `${fid}-er-${r.ends[1]}` };
      return edgeSvg(r, d, markers, false, joinDots(route.joins && shift(route.joins)) + label);
    }).join("");
    const tablesSvg = block.tables.map((t) => tableSvg(t, at(rects.get(t.id) as Rect), block.mode, theme)).join("");

    const anchors: Record<string, Rect> = {};
    for (const t of block.tables) {
      const r = at(rects.get(t.id) as Rect);
      anchors[t.id] = r;
      t.columns.forEach((c, i) => { anchors[c.id] = { x: r.x, y: rowY(r, i) - ROW / 2, w: r.w, h: ROW }; });
    }
    for (const r of block.relations) {
      const box = labels.get(r.id);
      anchors[r.id] = box ? at(box) : midFrame(shift(routes.get(r.id)?.points ?? []));
    }
    const width = ext.w, height = ext.h;
    const notes = noteMarkers(block, anchors, {
      // 6px round each table: a marker stays clear of the selection ring, drawn 3px outside a selected table.
      obstacles: [...block.tables.map((t) => inflate(anchors[t.id] as Rect, 6)), ...drawn.flatMap(markerObstacles), ...[...labels.values()].map(at)],
      bounds: { x: 0, y: 0, w: width, h: height },
    });
    const names = block.tables.map((t) => t.name);
    return svgFigure({
      id: fid,
      kind: "schema",
      title: block.title,
      label: `Database schema: ${joinList(names)}`,
      desc: `${count(names.length, "table")} (${joinList(names)}) linked by ${count(block.relations.length, block.mode === "er" ? "relation" : "foreign key")}.`,
      width,
      height,
      defs: erDefs(fid),
      body: `<g class="x-struct-edges">${edges}</g><g class="x-struct-boxes">${tablesSvg}</g>${notes}`,
    });
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const tableOf = new Map(block.tables.flatMap((t) => t.columns.map((c) => [c.id, t] as const)));
    const colName = (id?: string) => {
      const t = id ? tableOf.get(id) : undefined;
      return t ? `${t.name}.${t.columns.find((c) => c.id === id)?.name}` : "";
    };
    const out = new Map<string, SchemaRelation>();
    const refs = new Map<string, SchemaRelation[]>();
    for (const r of block.relations) {
      if (r.column) out.set(r.column, r);
      if (r.target) (refs.get(r.target) ?? refs.set(r.target, []).get(r.target) as SchemaRelation[]).push(r);
    }
    // Both sides of every relation: selecting either key shows the other, the connector and both tables.
    const sides = (r: SchemaRelation) => [r.id, r.from, r.to, ...(r.column ? [r.column] : []), ...(r.target ? [r.target] : [])];

    for (const t of block.tables) {
      const own = new Set(t.columns.map((c) => c.id));
      const outgoing = block.relations.filter((r) => r.from === t.id);
      const incoming = block.relations.filter((r) => r.to === t.id && r.from !== t.id);
      const references = outgoing.flatMap((r) => (r.target ? [r.target] : [r.to]));
      const referencedBy = incoming.flatMap((r) => (r.column ? [r.column] : [r.from]));
      const pks = t.columns.filter((c) => c.pk).length, fkn = t.columns.filter((c) => c.fk).length;
      const info: ElementInfo = {
        id: t.id, type: "node", label: t.name, kind: "table", figure: block.id, value: count(t.columns.length, "column"),
        related: [...new Set([...own, ...outgoing.flatMap(sides), ...incoming.flatMap(sides)])].filter((x) => x !== t.id),
      };
      if (t.about) info.about = t.about;
      const links: Link[] = [{ rel: "References", ids: references }, { rel: "Referenced by", ids: referencedBy }].filter((l) => l.ids.length);
      if (links.length) info.links = links;
      info.facts = factList([
        { k: "Keys", v: [pks && count(pks, "primary key"), fkn && count(fkn, "foreign key")].filter(Boolean).join(" · ") || "none" },
        { k: "References", v: joinList([...new Set(outgoing.map((r) => nameOf(block, r.to)))]) || "nothing" },
        { k: "Referenced by", v: joinList([...new Set(incoming.map((r) => nameOf(block, r.from)))]) || "nothing" },
      ]);
      info.say = `${t.name}, ${count(t.columns.length, "column")}${references.length ? `, references ${references.length}` : ""}${referencedBy.length ? `, referenced by ${referencedBy.length}` : ""}`;
      elements[t.id] = info;

      for (const c of t.columns) {
        const r = out.get(c.id);
        const ins = refs.get(c.id) ?? [];
        const related = [...new Set([t.id, ...(r ? sides(r) : []), ...ins.flatMap(sides)])].filter((x) => x !== c.id);
        const to = r ? nameOf(block, r.to) : "";
        const facts: Fact[] = [
          c.type ? { k: "Type", v: c.type } : null,
          r ? { k: "Cardinality", v: `${r.ends[0] === "many" ? "many" : "at most one"} ${t.name} per ${to} row` } : null,
          { k: "Null", v: c.pk || !c.null ? "not null" : "allowed" },
          { k: "Unique", v: c.pk || c.unique ? "yes" : "no" },
          r?.action ? { k: "On delete", v: actionWords(r.action) } : null,
          ins.length ? { k: "Referenced by", v: count(ins.length, "column") } : null,
        ].filter((f): f is Fact => !!f);
        const key = c.pk ? "PK" : "";
        const pos = r ? [key, `FK → ${colName(r.target) || to}`].filter(Boolean).join(" · ") : key;
        const say = [`${t.name}.${c.name}`, c.type, c.pk && "primary key", r && `references ${colName(r.target) || to}`, ins.length && `referenced by ${joinList(ins.map((i) => colName(i.column)))}`].filter(Boolean).join(", ");
        elements[c.id] = itemInfo({
          id: c.id, label: `${t.name}.${c.name}`, figure: block.id, kind: "column", value: columnValue(c), about: c.about, related,
          facts, pos, say, crumb: [t.id],
          links: [{ rel: "References", ids: r?.target ? [r.target] : [] }, { rel: "Referenced by", ids: ins.flatMap((i) => (i.column ? [i.column] : [])) }],
        });
      }
    }
    for (const r of block.relations) {
      const from = nameOf(block, r.from), to = nameOf(block, r.to);
      const e: ElementInfo = {
        id: r.id, type: "edge", label: r.title, kind: r.column && block.mode === "physical" ? "foreign key" : "relation", figure: block.id,
        from: r.from, to: r.to, about: r.about, related: [r.column, r.target].filter((x): x is string => !!x),
        facts: factList([
          { k: `Per ${to} row`, v: `${CARD_WORDS[r.ends[0]]} ${from} ${plural(r.ends[0])}` },
          { k: `Per ${from} row`, v: `${CARD_WORDS[r.ends[1]]} ${to} ${plural(r.ends[1])}` },
          !!r.action && { k: "On delete", v: actionWords(r.action as string) },
        ]),
      };
      const links: Link[] = [{ rel: "Foreign key", ids: r.column ? [r.column] : [] }, { rel: "References", ids: r.target ? [r.target] : [] }].filter((l) => l.ids.length);
      if (links.length) e.links = links;
      if (r.column && r.target) e.say = `${colName(r.column)} references ${colName(r.target)}`;
      elements[r.id] = e;
    }
    return { elements };
  },

  reading(block) {
    const ends = "A crow's foot marks the side with many rows, a single bar the side with exactly one, a ring an optional end.";
    return block.mode === "physical"
      ? `Each box is a table; its rows are columns with their type, PK and FK chips mark the keys. Each line runs from a foreign-key row to the row it references. ${ends}`
      : `Each box is a table and each line a relation between tables. ${ends}`;
  },

  table(block) {
    const target = new Map(block.relations.flatMap((r) => (r.column && r.target ? [[r.column, r.target] as const] : [])));
    const label = new Map(block.tables.flatMap((t) => t.columns.map((c) => [c.id, `${t.name}.${c.name}`] as const)));
    const out: DataTable = { head: ["Table", "Column", "Type", "Key", "References"], rows: [] };
    for (const t of block.tables) {
      for (const c of t.columns) {
        const ref = target.get(c.id);
        out.rows.push([t.name, c.name, c.type, keysOf(c).join(" "), ref ? label.get(ref) ?? "" : ""]);
      }
    }
    return out;
  },
};

// ---------- parsing ----------

function parseColumn(v: unknown, where: string, line: number): DraftColumn {
  if (typeof v === "string") return shorthand(v, undefined, where, line);
  if (isObj(v)) {
    const keys = Object.keys(v);
    // `- "user_id uuid fk users.id": about` — the shorthand as a key, its about as the value
    if (keys.length === 1 && /\s/.test(keys[0] as string)) {
      const key = keys[0] as string, about = v[key];
      if (typeof about !== "string") throw new SpecError(`${where}: "${key}: …" must map the column to a one-sentence about.`, line);
      return shorthand(key, about, where, line);
    }
    allowKeys(v, COLUMN_KEYS, where, line);
    const fk = optString(v, "fk", where, line);
    return {
      name: requireString(v, "name", where, line),
      type: optString(v, "type", where, line) ?? "",
      pk: optBool(v, "pk", where, line),
      fk: fk === undefined ? undefined : fkRef(fk, where, line),
      null: optBool(v, "null", where, line),
      unique: optBool(v, "unique", where, line),
      about: optString(v, "about", where, line),
    };
  }
  throw new SpecError(`${where} must be "name type [pk] [fk table.col [action]] [null] [unique]" or { name, type, pk, fk, null, unique, about }.`, line);
}

function shorthand(spec: string, about: string | undefined, where: string, line: number): DraftColumn {
  const words = spec.trim().split(/\s+/).filter(Boolean);
  const name = words.shift();
  if (!name) throw new SpecError(`${where} is empty; write "name type [pk] [fk table.col]".`, line);
  const col: DraftColumn = { name, type: "", pk: false, null: false, unique: false, about };
  const type: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string, lw = w.toLowerCase();
    if (lw === "pk") col.pk = true;
    else if (lw === "null") col.null = true;
    else if (lw === "unique") col.unique = true;
    else if (lw === "fk") {
      const target = words[++i];
      if (!target) throw new SpecError(`${where}: "fk" needs a target like users.id.`, line);
      const action = ACTIONS.includes((words[i + 1] ?? "").toLowerCase()) ? words[++i] : undefined;
      col.fk = fkRef(action ? `${target} ${action}` : target, where, line);
    } else type.push(w);
  }
  col.type = type.join(" ");
  return col;
}

/** "users.id" or "users.id cascade": the referenced column and an optional on-delete action. */
function fkRef(s: string, where: string, line: number): { table: string; column: string; action?: string } {
  const m = /^([^.\s]+)\.([^.\s]+)(?:\s+(\S+))?$/.exec(s.trim());
  if (!m) throw new SpecError(`${where}: fk target "${s}" must be table.column, e.g. users.id, optionally followed by ${ACTIONS.join(", ")}.`, line);
  const action = m[3]?.toLowerCase();
  if (action !== undefined && !ACTIONS.includes(action)) throw new SpecError(`${where}: fk action "${m[3]}" must be one of ${ACTIONS.join(", ")}.`, line);
  return action ? { table: m[1] as string, column: m[2] as string, action } : { table: m[1] as string, column: m[2] as string };
}

function checkLabel(label: string | undefined, where: string, line: number, ctx: RenderContext): void {
  if (!label) return;
  if (label.split(/\s+/).length > BUDGET.edgeLabelWords || label.length > BUDGET.edgeLabelChars) {
    ctx.warn({ rule: "edge-label", severity: "warn", message: `${where}: label "${label}" is over ${BUDGET.edgeLabelWords} words or ${BUDGET.edgeLabelChars} characters; use a short verb or drop it.`, line });
  }
}

function cardAbout(a: string, ea: Card, b: string, eb: Card): string {
  return `Each ${b} row links to ${CARD_WORDS[ea]} ${a} ${plural(ea)}; each ${a} row links to ${CARD_WORDS[eb]} ${b} ${plural(eb)}.`;
}

function plural(c: Card): string {
  return c === "one" || c === "zero-one" ? "row" : "rows";
}

function actionWords(action: string): string {
  return action.replace(/-/g, " ");
}

function columnValue(c: DraftColumn): string {
  return [c.type, c.pk && "primary key", c.fk && `→ ${c.fk.table}.${c.fk.column}`, c.unique && "unique", c.null && "nullable"].filter(Boolean).join(" · ");
}

function nameOf(block: SchemaBlock, id: string): string {
  return block.tables.find((t) => t.id === id)?.name ?? id;
}

/** Each foreign key as a row-to-row link, at the row centres of both columns. */
function rowLinks(block: SchemaBlock, rects: Map<string, Rect>): RowLink[] {
  const index = new Map(block.tables.flatMap((t) => t.columns.map((c, i) => [c.id, { t, i }] as const)));
  return block.relations.flatMap((r) => {
    const a = r.column ? index.get(r.column) : undefined, b = r.target ? index.get(r.target) : undefined;
    if (!a || !b) return [];
    return [{ id: r.id, from: r.from, to: r.to, fromY: rowY(rects.get(r.from) as Rect, a.i), toY: rowY(rects.get(r.to) as Rect, b.i), end: r.ends[1] }];
  });
}

// ---------- measuring and drawing ----------

function keysOf(c: DraftColumn): string[] {
  return [c.pk ? "PK" : "", c.fk ? "FK" : ""].filter(Boolean);
}

/** A key chip holds its 13/600 sans label with 4px either side. */
function chipWidth(k: string, theme: Theme): number {
  return Math.ceil(textWidth(k, theme.type.tag, "sans") * 1.08) + 8;
}

function chipsWidth(c: DraftColumn, theme: Theme): number {
  const keys = keysOf(c);
  return keys.length ? 2 + keys.reduce((s, k) => s + 4 + chipWidth(k, theme), 0) : 0;
}

function tableSize(name: string, columns: DraftColumn[], mode: Mode, theme: Theme): { w: number; h: number; widest: string } {
  const ty = theme.type;
  let w = 2 * INSET + textWidth(name, ty.nodeLabel, "sans") * 1.05, widest = name;
  for (const c of columns) {
    const typeW = mode === "physical" && c.type ? 12 + textWidth(c.type, ty.tag, "mono") : 0;
    const cw = 2 * INSET + textWidth(c.name, ty.nodeSub, "sans") + chipsWidth(c, theme) + typeW;
    if (cw > w) { w = cw; widest = c.name; }
  }
  return { w, h: HEAD + 2 * EDGE + columns.length * ROW, widest };
}

function tableSvg(t: SchemaTable, r: Rect, mode: Mode, theme: Theme): string {
  const ty = theme.type;
  const muted = t.muted ? ` data-muted="true"` : "";
  const box =
    `<rect class="x-mark-shape" x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" rx="${num(theme.radius)}"/>` +
    bandPath(r, HEAD, theme.radius) +
    text(r.x + INSET, r.y + HEAD / 2 + ty.nodeLabel * 0.35, fitText(t.name, r.w - 2 * INSET, ty.nodeLabel, "sans"), "x-struct-name") +
    `<line class="x-struct-rule" x1="${num(r.x)}" y1="${num(r.y + HEAD)}" x2="${num(r.x + r.w)}" y2="${num(r.y + HEAD)}"/>`;
  const head = mark({ id: t.id, label: t.name, value: count(t.columns.length, "column"), focal: t.focal, cls: "x-struct-box", attrs: muted }, box);
  const rows = t.columns.map((c, i) => columnSvg(t, c, i, r, mode, theme)).join("");
  return `<g class="x-struct-table">${head}${rows}</g>`;
}

function columnSvg(t: SchemaTable, c: SchemaColumn, i: number, r: Rect, mode: Mode, theme: Theme): string {
  const ty = theme.type;
  const mid = rowY(r, i), top = mid - ROW / 2;
  const inner = r.w - 2 * INSET;
  // The type takes what the name leaves, and never less than 45% of the row when both must be cut.
  const room = inner - textWidth(c.name, ty.nodeSub, "sans") - chipsWidth(c, theme) - 12;
  const type = mode === "physical" && c.type ? fitText(c.type, Math.max(room, inner * 0.45), ty.tag, "mono") : "";
  const typeW = type ? textWidth(type, ty.tag, "mono") + 12 : 0;
  const name = fitText(c.name, inner - typeW - chipsWidth(c, theme), ty.nodeSub, "sans");
  const parts = [
    // The whole row is the card's anchor: a column is not a bar whose value sits at the right end.
    `<rect class="x-mark-shape x-struct-row x-anchor" x="${num(r.x + 1)}" y="${num(top)}" width="${num(r.w - 2)}" height="${num(ROW)}"/>`,
    text(r.x + INSET, mid + ty.nodeSub * 0.35, name, "x-struct-member"),
  ];
  let x = r.x + INSET + textWidth(name, ty.nodeSub, "sans") + 2;
  for (const k of keysOf(c)) {
    const w = chipWidth(k, theme);
    x += 4;
    parts.push(
      `<rect class="x-struct-chip" data-key="${k.toLowerCase()}" x="${num(x)}" y="${num(mid - CHIP_H / 2)}" width="${num(w)}" height="${CHIP_H}" rx="4"/>`,
      text(x + w / 2, mid + ty.tag * 0.35, k, "x-struct-chip-label", "middle"),
    );
    x += w;
  }
  if (type) parts.push(text(r.x + r.w - INSET, mid + ty.tag * 0.35, type, "x-struct-type", "end"));
  const muted = t.muted ? ` data-muted="true"` : "";
  const keys = keysOf(c).map((k) => k.toLowerCase()).join(" ");
  return mark({ id: c.id, label: `${t.name}.${c.name}`, value: columnValue(c), cls: "x-struct-col", attrs: `${muted}${keys ? ` data-key="${keys}"` : ""}` }, parts.join(""));
}

function labelSvg(label: string, box: Rect, px: number): string {
  return text(box.x + box.w / 2, box.y + box.h / 2 + px * 0.35, label, "x-struct-label", "middle");
}

/** Where a connector without a label takes its note marker: the middle of its longest run. */
function midFrame(p: Pt[]): Rect {
  let best = 0, len = -1;
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i] as Pt, b = p[i + 1] as Pt, l = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (l > len) { len = l; best = i; }
  }
  const a = p[best] ?? [0, 0], b = p[best + 1] ?? a;
  return { x: (a[0] + b[0]) / 2 - 1, y: (a[1] + b[1]) / 2 - 1, w: 2, h: 2 };
}

/** Crow's-foot ends. orient auto-start-reverse lets one marker serve both ends; x grows toward the table. */
function erDefs(fid: string): string {
  const m = (card: Card, body: string) =>
    `<marker id="${esc(fid)}-er-${card}" viewBox="0 0 22 16" markerWidth="22" markerHeight="16" refX="21" refY="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse">${body}</marker>`;
  const bar = (x: number) => `<path class="x-struct-head x-open" d="M${x},2 L${x},14"/>`;
  const ring = (cx: number) => `<circle class="x-struct-head" cx="${cx}" cy="8" r="4"/>`;
  const foot = `<path class="x-struct-head x-open" d="M12,8 L21,1.5 M12,8 L21,14.5 M12,8 L21,8"/>`;
  return m("one", bar(12) + bar(16)) + m("zero-one", ring(7) + bar(16)) + m("many", foot) + m("one-many", bar(8) + foot) + m("zero-many", ring(6) + foot);
}
