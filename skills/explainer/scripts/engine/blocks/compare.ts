import { BUDGET, SpecError, type BlockModule, type CompareBlock, type ElementInfo, type Fact, type ReadingSpec } from "../types";
import { READING_KEYS, delta, factList, ratio, readingSpec } from "../kit";
import { allowKeys, attr, esc, isObj, lookupLabel, optBool, optString, requireMap, requireString, slug, stringList } from "./util";

interface Dimension { id: string; label: string }
type Item = CompareBlock["items"][number] & { on: string[]; values: Record<string, string> };
/** Compare with aligned `dimensions:` rows and items linked to diagram parts through `on:`. */
type Compare = Omit<CompareBlock, "items"> & ReadingSpec & { dimensions: Dimension[]; items: Item[] };

const MAX_DIMENSIONS = 6;
const NUMBER = /(-?\d+(?:[.,]\d+)?)\s*([^\d\s]*)/;

/** Element id of a dimension row: the same id on every card, so selecting it lights the row across items. */
const rowId = (block: { id: string }, dim: Dimension) => `${block.id}-${dim.id}`;

function dimensions(raw: unknown, where: string, line: number): Dimension[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new SpecError(`${where} \`dimensions\` must be a list of names or { id, label }.`, line);
  if (raw.length > MAX_DIMENSIONS) throw new SpecError(`${where} has ${raw.length} dimensions; keep it to ${MAX_DIMENSIONS}, the ones the choice turns on.`, line);
  const seen = new Set<string>();
  return raw.map((d, i) => {
    const dw = `${where} dimension ${i + 1}`;
    const spec = isObj(d) ? d : { label: d };
    allowKeys(spec, ["id", "label"], dw, line);
    const label = requireString(spec, "label", dw, line);
    const id = optString(spec, "id", dw, line) ?? slug(label);
    if (seen.has(id)) throw new SpecError(`${where}: dimension "${id}" is listed twice.`, line, "id-unique");
    seen.add(id);
    return { id, label };
  });
}

/** Leading number and unit of a value ("up to 30 s" → 30, "s"), or null when it has none. */
function measure(text: string): { n: number; unit: string } | null {
  const m = NUMBER.exec(text);
  return m ? { n: Number(m[1].replace(",", ".")), unit: m[2] } : null;
}

export const compareModule: BlockModule<Compare> = {
  type: "compare",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "compare", line);
    allowKeys(data, ["id", "title", "dimensions", "items", ...READING_KEYS], "compare", line);
    const id = requireString(data, "id", "compare", line);
    const where = `compare "${id}"`;
    const dims = dimensions(data.dimensions, where, line);
    const list = data.items;
    if (!Array.isArray(list) || list.length < 2 || list.length > 4) {
      const got = Array.isArray(list) ? `got ${list.length}` : "none given";
      throw new SpecError(`${where} needs 2 to 4 \`items\`; ${got}.`, line);
    }
    const seen = new Set<string>();
    const items = list.map((item, i): Item => {
      const iw = `${where} item ${i + 1}`;
      if (!isObj(item)) throw new SpecError(`${iw} must be a map: { id, label, points }.`, line);
      allowKeys(item, ["id", "label", "points", "focal", "about", "on", "values"], iw, line);
      const iid = requireString(item, "id", iw, line);
      if (seen.has(iid)) throw new SpecError(`${where}: item "${iid}" is listed twice.`, line, "id-unique");
      seen.add(iid);
      const on = typeof item.on === "string" ? [item.on] : stringList(item.on, `${iw} on`, line);
      for (const target of on) {
        if (lookupLabel(ctx.doc, target) === undefined) {
          ctx.warn({ rule: "ref-exists", severity: "warn", message: `${iw} is linked to "${target}", which is not a part of any diagram in this document.`, line });
        }
      }
      const given = item.values ?? {};
      if (!isObj(given)) throw new SpecError(`${iw}: \`values\` must be a map of dimension → text.`, line);
      for (const key of Object.keys(given)) {
        if (!dims.some((d) => d.id === key)) {
          throw new SpecError(`${iw}: value "${key}" is not a dimension. Dimensions: ${dims.map((d) => d.id).join(", ") || "none"}.`, line, "ref-exists");
        }
      }
      const values: Record<string, string> = {};
      for (const d of dims) values[d.id] = optString(given, d.id, `${iw} value "${d.id}"`, line) ?? "—";
      return {
        id: iid,
        label: requireString(item, "label", iw, line),
        points: stringList(item.points, `${iw} points`, line),
        focal: optBool(item, "focal", iw, line),
        about: optString(item, "about", iw, line),
        on,
        values,
      };
    });
    for (const d of dims) {
      if (seen.has(rowId({ id }, d))) throw new SpecError(`${where}: dimension "${d.id}" makes the id "${rowId({ id }, d)}", which an item already uses.`, line, "id-unique");
    }
    const focal = items.filter((item) => item.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} items focal; keep it to ${BUDGET.focal}.`, line });
    }
    return { type: "compare", id, title: optString(data, "title", where, line), dimensions: dims, items, line, ...readingSpec(data, line) };
  },

  render(block, ctx) {
    const title = block.title ? `<p class="x-block-title">${esc(block.title)}</p>` : "";
    // Each card is header + one row per dimension + points, so the rows line up across cards (subgrid).
    const items = block.items
      .map((item) => {
        const rows = block.dimensions
          .map((d) => `<dl class="x-compare-row x-mark"${attr("data-id", rowId(block, d))}${attr("data-dim", d.id)}><dt>${esc(d.label)}</dt><dd>${esc(item.values[d.id])}</dd></dl>`)
          .join("");
        const points = `<ul class="x-compare-points">${item.points.map((p) => `<li>${ctx.inline(p)}</li>`).join("")}</ul>`;
        return `<article class="x-compare-item"${attr("data-ref", item.id)} data-focal="${item.focal}" tabindex="0"><h3 class="x-compare-label">${esc(item.label)}</h3>${rows}${points}</article>`;
      })
      .join("");
    return `${title}<div class="x-compare"${attr("data-id", block.id)} data-count="${block.items.length}" data-rows="${block.dimensions.length + 2}">${items}</div>`;
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const lead = block.items.find((i) => i.focal) ?? block.items[0];
    for (const item of block.items) {
      const others = block.items.filter((o) => o !== item);
      // Its row in each dimension next to the other cards' rows: "Latency: 1 s vs up to 30 s".
      const facts: Fact[] = block.dimensions.map((d) => ({ k: d.label, v: `${item.values[d.id]} vs ${others.map((o) => o.values[d.id]).join(" / ")}` }));
      elements[item.id] = {
        id: item.id, type: "item", label: item.label, figure: block.id,
        ...(item.about ? { about: item.about } : {}),
        ...(item.on.length ? { related: item.on, links: [{ rel: "In the diagram", ids: item.on, inverse: "Compared in" }] } : {}),
        ...(facts.length ? { facts: factList(facts) } : {}),
        say: `${item.label}${item.focal ? ", the recommended option" : ""}`,
      };
    }
    for (const d of block.dimensions) {
      const facts: (Fact | null)[] = block.items.map((i) => ({ k: i.label, v: i.values[d.id], ref: i.id }));
      // A difference only when every value is a number in the same unit.
      const ms = block.items.map((i) => measure(i.values[d.id]));
      if (ms.every((m) => m && m.unit === ms[0]!.unit)) {
        const a = measure(lead.values[d.id])!;
        for (const o of block.items.filter((i) => i !== lead)) {
          const b = measure(o.values[d.id])!;
          const hi = Math.max(a.n, b.n), lo = Math.min(a.n, b.n);
          facts.push({ k: `${lead.label} vs ${o.label}`, v: `${delta(a.n, b.n, a.unit || undefined)} · ${ratio(hi, lo)} ${a.n < b.n ? "lower" : "higher"}` });
        }
      }
      const id = rowId(block, d);
      elements[id] = {
        id, type: "item", label: d.label, kind: "dimension", figure: block.id,
        facts: factList(facts),
        say: `${d.label}: ${block.items.map((i) => `${i.label} ${i.values[d.id]}`).join(", ")}`,
      };
    }
    return { elements };
  },

  reading(block) {
    const focal = block.items.filter((i) => i.focal).map((i) => i.label);
    return [
      "Each card is one option.",
      block.dimensions.length ? "Rows line up across cards, so each dimension reads straight across; select a row to compare it." : "",
      focal.length ? `The accent card, ${focal.join(" and ")}, is the one this page argues for.` : "",
    ].filter(Boolean).join(" ");
  },

  table(block) {
    if (block.dimensions.length) {
      return { head: ["", ...block.items.map((i) => i.label)], rows: block.dimensions.map((d) => [d.label, ...block.items.map((i) => i.values[d.id])]) };
    }
    const depth = Math.max(...block.items.map((i) => i.points.length));
    return { head: block.items.map((i) => i.label), rows: Array.from({ length: depth }, (_, k) => block.items.map((i) => i.points[k] ?? "")) };
  },
};
