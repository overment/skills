import { SpecError, type ParsedDoc, type RawBlock, type Segment } from "../types";

export type Fields = Record<string, unknown>;

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(text: unknown): string {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}

/** ` name="value"` with the value escaped; nothing for null/undefined/false, bare name for true. */
export function attr(name: string, value: unknown): string {
  if (value === undefined || value === null || value === false) return "";
  if (value === true) return ` ${name}`;
  return ` ${name}="${esc(value)}"`;
}

export function isObj(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function slug(text: string): string {
  return text
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "A", "A and B", "A, B and C". */
export function joinList(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function requireMap(value: unknown, where: string, line?: number): Fields {
  if (!isObj(value)) throw new SpecError(`${where} must be a YAML map of fields.`, line);
  return value;
}

export function allowKeys(obj: Fields, allowed: string[], where: string, line?: number): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new SpecError(`${where}: unknown field \`${key}\`. Allowed: ${allowed.join(", ")}.`, line);
    }
  }
}

export function optString(obj: Fields, key: string, where: string, line?: number): string | undefined {
  const value = obj[key];
  if (value == null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  throw new SpecError(`${where}: \`${key}\` must be text.`, line);
}

export function requireString(obj: Fields, key: string, where: string, line?: number): string {
  const value = optString(obj, key, where, line);
  if (value === undefined) throw new SpecError(`${where} needs \`${key}\`.`, line);
  return value;
}

export function optBool(obj: Fields, key: string, where: string, line?: number, fallback = false): boolean {
  const value = obj[key];
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;
  throw new SpecError(`${where}: \`${key}\` must be true or false.`, line);
}

export function stringList(value: unknown, where: string, line?: number): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new SpecError(`${where} must be a list.`, line);
  return value.map((item, i) => {
    if (typeof item === "string" || typeof item === "number") return String(item);
    throw new SpecError(`${where} item ${i + 1} must be text.`, line);
  });
}

/** Map (id → fields) or list (items with `id`) → [id, fields]. A bare text value is shorthand for `{ label }`. */
export function entries(value: unknown, where: string, line?: number): [string, Fields][] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((item, i): [string, Fields] => {
      if (!isObj(item) || item.id == null || item.id === "") {
        throw new SpecError(`${where} item ${i + 1} needs an \`id\`.`, line);
      }
      const { id, ...rest } = item;
      return [String(id), rest];
    });
  }
  if (isObj(value)) {
    return Object.entries(value).map(([id, fields]): [string, Fields] => {
      if (isObj(fields)) return [id, fields];
      if (typeof fields === "string" || typeof fields === "number") return [id, { label: String(fields) }];
      if (fields == null) return [id, {}];
      throw new SpecError(`${where} "${id}" must be a map of fields.`, line);
    });
  }
  throw new SpecError(`${where} must be a map (id → fields) or a list of items with \`id\`.`, line);
}

export function rawBlocks(doc: ParsedDoc): RawBlock[] {
  const out: RawBlock[] = [];
  const walk = (segments: Segment[]) => {
    for (const segment of segments) {
      if (segment.kind === "block") out.push(segment.block);
      else if (segment.kind === "container") walk(segment.children);
    }
  };
  walk(doc.segments);
  return out;
}

/** Raw figure blocks anywhere in the doc (containers included), optionally only the one with `id`. */
export function findFigureRaw(doc: ParsedDoc, id?: string): RawBlock[] {
  return rawBlocks(doc).filter(
    (b) => b.type === "figure" && isObj(b.data) && (id === undefined || (b.data.id != null && String(b.data.id) === id)),
  );
}

function looseEntries(value: unknown): [string, Fields][] {
  try {
    return entries(value, "");
  } catch {
    return [];
  }
}

/** Label of the node, actor or group `id` in any figure; the id itself when it exists without a label. */
export function lookupLabel(doc: ParsedDoc, id: string): string | undefined {
  for (const figure of findFigureRaw(doc)) {
    const data = figure.data as Fields;
    for (const key of ["nodes", "actors", "groups"]) {
      const found = looseEntries(data[key]).find(([eid]) => eid === id);
      if (!found) continue;
      const label = found[1].label;
      return typeof label === "string" || typeof label === "number" ? String(label) : id;
    }
  }
  return undefined;
}
