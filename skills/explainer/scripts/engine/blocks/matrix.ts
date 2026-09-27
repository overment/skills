import { SpecError, type BlockModule, type CellValue, type ElementInfo, type Link, type MatrixBlock, type ReadingSpec } from "../types";
import { READING_KEYS, factList, readingSpec } from "../kit";
import { allowKeys, attr, esc, isObj, joinList, lookupLabel, optString, requireMap, requireString } from "./util";

/**
 * `linked` = the column id names a part of a diagram. Its header and cells then carry a matrix-local id
 * ("permissions.publish") that links to the part, so selecting a neighbouring part never lights this column.
 */
type Column = MatrixBlock["columns"][number] & { linked?: boolean };
type Matrix = MatrixBlock & ReadingSpec;

const MARKS: Record<string, string> = { yes: "✓", no: "·", partial: "◐" };
const WORDS: Record<string, string> = { yes: "allowed", no: "not allowed", partial: "partly allowed" };
const VERBS: Record<string, string> = { yes: "can", no: "cannot", partial: "can partly" };

/** The id of one cell: row, then column. */
const cellId = (row: string, col: string) => `${row}.${col}`;
/** The element id of a column: its own id, or matrix-local when it names a diagram part. */
const colId = (block: { id: string }, c: Column) => (c.linked ? `${block.id}.${c.id}` : c.id);

function cellValue(value: unknown, where: string, line: number): CellValue {
  if (value === true || value === "yes") return "yes";
  if (value == null || value === false || value === "no") return "no";
  if (value === "partial") return "partial";
  if (typeof value === "string" || typeof value === "number") return String(value);
  throw new SpecError(`${where} must be yes, no, partial or short text.`, line);
}

/** "Review queue can change the headline"; free text reads "Catalog · Read Product DB: later". */
function sentence(col: string, row: string, value: CellValue): string {
  const verb = VERBS[value];
  if (!verb) return `${col} · ${row}: ${value}`;
  const lower = /^[A-Z][a-z]/.test(row) ? row[0].toLowerCase() + row.slice(1) : row;
  return `${col} ${verb} ${lower}`;
}

function cell(block: Matrix, row: Matrix["rows"][number], col: Column): string {
  const value = row.cells[col.id] ?? "no";
  const mark = MARKS[value] ?? esc(value);
  return `<td class="x-cell"${attr("data-col", colId(block, col))}${attr("data-value", value)}>` +
    `<span class="x-mark"${attr("data-id", cellId(row.id, col.id))} role="img"${attr("aria-label", sentence(col.label, row.label, value))}>${mark}</span></td>`;
}

export const matrixModule: BlockModule<Matrix> = {
  type: "matrix",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "matrix", line);
    allowKeys(data, ["id", "title", "corner", "columns", "rows", ...READING_KEYS], "matrix", line);
    const id = requireString(data, "id", "matrix", line);
    const where = `matrix "${id}"`;

    if (!Array.isArray(data.columns) || data.columns.length === 0) {
      throw new SpecError(`${where} needs \`columns\`: a list of element ids or { id, label }.`, line);
    }
    const columns: Column[] = data.columns.map((c, i) => {
      const cw = `${where} column ${i + 1}`;
      const spec = isObj(c) ? c : { id: c };
      allowKeys(spec, ["id", "label"], cw, line);
      const cid = requireString(spec, "id", cw, line);
      const found = lookupLabel(ctx.doc, cid);
      return { id: cid, label: optString(spec, "label", cw, line) ?? found ?? cid, linked: found !== undefined };
    });
    const colIds = new Set<string>();
    for (const c of columns) {
      if (colIds.has(c.id)) throw new SpecError(`${where}: column "${c.id}" is listed twice.`, line, "id-unique");
      colIds.add(c.id);
    }

    if (!Array.isArray(data.rows) || data.rows.length === 0) {
      throw new SpecError(`${where} needs \`rows\`: a list of { id, label, cells }.`, line);
    }
    const rowIds = new Set<string>();
    const rows = data.rows.map((r, i) => {
      const rw = `${where} row ${i + 1}`;
      if (!isObj(r)) throw new SpecError(`${rw} must be a map: { id, label, cells }.`, line);
      allowKeys(r, ["id", "label", "about", "cells"], rw, line);
      const rid = requireString(r, "id", rw, line);
      if (rowIds.has(rid)) throw new SpecError(`${where}: row "${rid}" is listed twice.`, line, "id-unique");
      rowIds.add(rid);
      const named = `${where} row "${rid}"`;
      const label = requireString(r, "label", named, line);
      const about = optString(r, "about", named, line);
      const given = r.cells ?? {};
      if (!isObj(given)) throw new SpecError(`${named}: \`cells\` must be a map of column id → value.`, line);
      for (const key of Object.keys(given)) {
        if (!colIds.has(key)) {
          throw new SpecError(`${named}: cell "${key}" is not a column. Columns: ${[...colIds].join(", ")}.`, line, "ref-exists");
        }
      }
      const cells: Record<string, CellValue> = {};
      for (const c of columns) cells[c.id] = cellValue(given[c.id], `${named} cell "${c.id}"`, line);
      return { id: rid, label, about, cells };
    });

    return {
      type: "matrix",
      id,
      title: optString(data, "title", where, line),
      corner: optString(data, "corner", where, line),
      columns,
      rows,
      line,
      ...readingSpec(data, line),
    };
  },

  render(block) {
    const caption = block.title ? `<caption class="x-block-title">${esc(block.title)}</caption>` : "";
    const head = (block.columns as Column[])
      .map((c) => `<th scope="col"${attr("data-ref", colId(block, c))}${attr("data-col", colId(block, c))} tabindex="0">${esc(c.label)}</th>`)
      .join("");
    const body = block.rows
      .map((r) => `<tr${attr("data-ref", r.id)}><th scope="row" tabindex="0">${esc(r.label)}</th>${block.columns.map((c) => cell(block, r, c)).join("")}</tr>`)
      .join("");
    return `<table class="x-matrix"${attr("data-id", block.id)}>${caption}<thead><tr><th class="x-matrix-corner" scope="col">${esc(block.corner ?? "")}</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const cols = block.columns as Column[];
    const name = (c: Column) => c.label;
    const parts = (list: Column[]) => list.filter((c) => c.linked).map((c) => c.id);
    for (const r of block.rows) {
      const yes = cols.filter((c) => r.cells[c.id] === "yes");
      const partly = cols.filter((c) => r.cells[c.id] === "partial");
      const links: Link[] = [
        { rel: "Allowed in", ids: yes.map((c) => colId(block, c)) },
        { rel: "Partly in", ids: partly.map((c) => colId(block, c)) },
      ].filter((l) => l.ids.length);
      elements[r.id] = {
        id: r.id, type: "row", label: r.label, figure: block.id,
        ...(r.about ? { about: r.about } : {}),
        // The diagram parts that allow it light up with it.
        ...(parts([...yes, ...partly]).length ? { related: parts([...yes, ...partly]) } : {}),
        facts: factList([
          { k: "Allowed in", v: `${yes.length} of ${cols.length}` },
          partly.length ? { k: "Partly in", v: joinList(partly.map(name)) } : null,
        ]),
        ...(links.length ? { links } : {}),
        say: `${r.label}: ${yes.length ? `allowed in ${joinList(yes.map(name))}` : "allowed nowhere"}`,
      };
      for (const c of cols) {
        const value = r.cells[c.id] ?? "no";
        const text = sentence(c.label, r.label, value);
        elements[cellId(r.id, c.id)] = {
          id: cellId(r.id, c.id), type: "item", label: text, kind: "cell", figure: block.id,
          // a cell written as a word already ends its title ("Notion · See images: No"), so only keyword cells repeat it
          ...(WORDS[value] ? { value: WORDS[value] } : {}),
          // the row's `about` is the rule in words, so a cell's card explains itself
          ...(r.about ? { about: r.about } : {}),
          related: [colId(block, c), ...parts([c])],
          context: [r.id],
          say: text,
        };
      }
    }
    for (const c of cols) {
      const id = colId(block, c);
      const yes = block.rows.filter((r) => r.cells[c.id] === "yes");
      const cells = block.rows.map((r) => cellId(r.id, c.id));
      elements[id] = {
        id, type: "column", label: c.label, figure: block.id,
        members: cells,
        related: [...cells, ...parts([c])],
        facts: [{ k: "Allows", v: `${yes.length} of ${block.rows.length}` }],
        // The back-link pass gives the diagram part the inverse, so selecting the part lights only its own column.
        ...(c.linked ? { links: [{ rel: "In the diagram", ids: [c.id], inverse: block.title ? `Column in "${block.title}"` : "Column in the table" }] } : {}),
        say: `${c.label}: allows ${yes.length} of ${block.rows.length}`,
      };
    }
    return { elements };
  },

  reading(block) {
    const noun = block.corner?.toLowerCase();
    const rows = noun ? `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}` : "one item";
    const linked = (block.columns as Column[]).some((c) => c.linked);
    // only the symbols the table shows: cells written as words need no key
    const used = new Set(block.rows.flatMap((r) => (block.columns as Column[]).map((c) => r.cells[c.id] ?? "no")));
    const key = ([["yes", "✓ = yes"], ["partial", "◐ = partly"], ["no", "· = no"]] as const).filter(([v]) => used.has(v)).map(([, k]) => k).join(", ");
    return `Each row is ${rows} and each column ${linked ? "a part of the diagram above" : "one option"}${key ? `: ${key}` : ""}. Select a cell for the rule in words.`;
  },

  table(block) {
    return {
      head: [block.corner ?? "", ...block.columns.map((c) => c.label)],
      rows: block.rows.map((r) => [r.label, ...block.columns.map((c) => WORDS[r.cells[c.id] ?? "no"] ?? r.cells[c.id]!)]),
    };
  },
};
