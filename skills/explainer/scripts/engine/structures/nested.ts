// Nested: what contains what. Boxes inside boxes, packed in rows; a container selects its whole subtree.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type Fact, type ReadingSpec } from "../types.ts";
import { READING_KEYS, groupInfo, idFrom, isObj, itemInfo, list, mark, notes, num, readingSpec, share, svgFigure, text, textWidth, type Frame } from "../kit.ts";
import { allowKeys, optBool, optString, requireMap, requireString } from "../blocks/util.ts";

interface Box { id: string; label: string; about?: string; focal: boolean; muted: boolean; depth: number; children: Box[] }

interface NestedBlock extends ReadingSpec {
  type: "nested";
  id: string;
  title?: string;
  line: number;
  root: Box;
}

interface Placed { box: Box; x: number; y: number; w: number; h: number }

const PAD = 16, HEAD = 22, GAP = 12, LEAF_H = 44, LEAF_MAX = 240;
const MAX_BOXES = 20, MAX_DEPTH = 4, HARD_DEPTH = 8;

function walk(b: Box, visit: (b: Box, ancestors: Box[]) => void, ancestors: Box[] = []): void {
  visit(b, ancestors);
  for (const c of b.children) walk(c, visit, [...ancestors, b]);
}

/** Word-wrap into at most `maxLines`; the last kept line gets an ellipsis when text is cut. */
function fit(value: string, maxW: number, measure: (s: string) => number, maxLines: number): { lines: string[]; cut: boolean } {
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next) > maxW) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  const overflow = lines.length > maxLines;
  let cut = overflow;
  const out = lines.slice(0, maxLines).map((l, i, all) => {
    if (measure(l) <= maxW && !(overflow && i === all.length - 1)) return l;
    cut = true;
    let t = l;
    while (t.length > 1 && measure(`${t}…`) > maxW) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  });
  return { lines: out.length ? out : [""], cut };
}

/** Notes and story steps may only point at this block's own elements. */
function checkRefs(spec: ReadingSpec, known: Set<string>, where: string, line: number): void {
  const refs = [...(spec.notes ?? []).flatMap((n) => n.on), ...(spec.story ?? []).flatMap((s) => (s.cmp ? [s.sel, s.cmp] : [s.sel]))];
  const missing = refs.find((id) => !known.has(id));
  if (missing) throw new SpecError(`${where}: notes or story point at "${missing}", which is not an element of this block.`, line, "ref-exists");
}

export const blockModule: BlockModule<NestedBlock> = {
  type: "nested",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "nested", line);
    allowKeys(data, ["id", "title", "root", ...READING_KEYS], "nested", line);
    const id = requireString(data, "id", "nested", line);
    const where = `nested "${id}"`;
    const taken = new Set<string>();

    const read = (v: unknown, depth: number, path: string): Box => {
      if (depth >= HARD_DEPTH) throw new SpecError(`${path} is nested ${depth + 1} levels deep; flatten it to ${MAX_DEPTH}.`, line);
      const f = typeof v === "string" ? { label: v } : v;
      if (!isObj(f)) throw new SpecError(`${path} must be a map: { label, about, children } or a bare label.`, line);
      allowKeys(f, ["id", "label", "about", "focal", "muted", "children"], path, line);
      const label = requireString(f, "label", path, line);
      const given = optString(f, "id", path, line);
      if (given) {
        if (taken.has(given)) throw new SpecError(`${where}: id "${given}" is used twice.`, line, "id-unique");
        taken.add(given);
      }
      const kids = f.children === undefined ? [] : list(f.children, `${path} children`, line);
      return {
        id: given ?? "",
        label,
        about: optString(f, "about", path, line),
        focal: optBool(f, "focal", path, line),
        muted: optBool(f, "muted", path, line),
        depth,
        children: kids.map((c, i) => read(c, depth + 1, `${where} child ${i + 1} of "${label}"`)),
      };
    };
    if (data.root === undefined) throw new SpecError(`${where} needs \`root\`: { label, children }.`, line);
    const root = read(data.root, 0, `${where} root`);

    let boxes = 0, levels = 0, focal = 0;
    walk(root, (b) => {
      if (!b.id) b.id = idFrom(b.label, taken, `${id}-`);
      boxes++;
      levels = Math.max(levels, b.depth + 1);
      if (b.focal) focal++;
    });
    if (boxes > MAX_BOXES) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${boxes} boxes; keep it to ${MAX_BOXES}. Show the top two levels here and give each large container its own nested block.`, line });
    }
    if (levels > MAX_DEPTH) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} is ${levels} levels deep; keep it to ${MAX_DEPTH}. Move the deepest level into a second nested block.`, line });
    }
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} boxes focal; keep it to ${BUDGET.focal}.`, line });
    }
    const reading = readingSpec(data, line);
    const known = new Set<string>();
    walk(root, (b) => known.add(b.id));
    checkRefs(reading, known, where, line);
    return { type: "nested", id, title: optString(data, "title", where, line), line, root, ...reading };
  },

  render(block, ctx) {
    const { theme } = ctx;
    const pad = theme.grid.pad, radius = theme.radius;
    const px = theme.type.nodeSub, lh = Math.round(px * 1.3), tag = theme.type.tag;
    const sans = (s: string) => textWidth(s, px, "sans") * 1.08;
    // container heads: sentence-case 13/600 sans
    const head600 = (s: string) => textWidth(s, tag, "sans") * 1.08;
    const width = 960;
    const leaf = (b: Box) => !b.children.length;

    // One leaf width per container: the widest leaf label sets it, and leaves never stretch to fill a row.
    const leafNeed = (b: Box) => Math.min(220, Math.max(96, sans(b.label) + 28));
    const leafBase = (b: Box) => Math.max(0, ...b.children.filter(leaf).map(leafNeed));
    const minCache = new Map<Box, number>();
    const minW = (b: Box): number => {
      let w = minCache.get(b);
      if (w === undefined) {
        w = leaf(b)
          ? leafNeed(b)
          : Math.max(Math.min(280, head600(b.label) + 24), ...b.children.map((c) => (leaf(c) ? leafBase(b) : minW(c)) + 2 * PAD));
        minCache.set(b, w);
      }
      return w;
    };

    // Greedy rows in source order. Spare width goes to the containers in a row; a container of leaves only
    // shares its width out as equal columns, so a leaf that wraps to a new row keeps its siblings' width.
    const rowsOf = (b: Box, inner: number): { box: Box; w: number }[][] => {
      const rows: { box: Box; w: number }[][] = [];
      let row: { box: Box; w: number }[] = [], used = 0;
      for (const c of b.children) {
        const w = leaf(c) ? leafBase(b) : minW(c);
        if (row.length && used + GAP + w > inner) {
          rows.push(row);
          row = [];
          used = 0;
        }
        used += (row.length ? GAP : 0) + w;
        row.push({ box: c, w });
      }
      if (row.length) rows.push(row);
      if (b.children.every(leaf)) {
        const cols = rows[0].length;
        const lw = Math.min(Math.max(leafBase(b), LEAF_MAX), (inner - GAP * (cols - 1)) / cols);
        return rows.map((r) => r.map((c) => ({ box: c.box, w: lw })));
      }
      return rows.map((r) => {
        const boxes = r.filter((c) => !leaf(c.box));
        const spare = Math.max(0, inner - r.reduce((sum, c) => sum + c.w, 0) - GAP * (r.length - 1));
        return r.map((c) => ({ box: c.box, w: leaf(c.box) ? c.w : Math.min(inner, c.w + spare / boxes.length) }));
      });
    };

    const leafLines = (b: Box, w: number) => fit(b.label, w - 20, sans, 3);
    const leafH = (b: Box, w: number) => Math.max(LEAF_H, leafLines(b, w).lines.length * lh + 20);
    // leaves in one container share a height, containers keep their own
    const heightIn = (rows: { box: Box; w: number }[][]) => {
      const leaves = rows.flat().filter((c) => leaf(c.box));
      const lhMax = Math.max(0, ...leaves.map((c) => leafH(c.box, c.w)));
      return (c: { box: Box; w: number }) => (leaf(c.box) ? lhMax : measure(c.box, c.w));
    };
    const measure = (b: Box, w: number): number => {
      if (leaf(b)) return leafH(b, w);
      const rows = rowsOf(b, w - 2 * PAD);
      const h = heightIn(rows);
      return PAD + HEAD + rows.reduce((sum, r) => sum + Math.max(...r.map(h)), 0) + GAP * (rows.length - 1) + PAD;
    };

    const placed: Placed[] = [];
    const place = (b: Box, x: number, y: number, w: number, h: number): void => {
      placed.push({ box: b, x, y, w, h });
      if (leaf(b)) return;
      const rows = rowsOf(b, w - 2 * PAD);
      const height = heightIn(rows);
      let cy = y + PAD + HEAD;
      for (const row of rows) {
        let cx = x + PAD;
        for (const c of row) {
          place(c.box, cx, cy, c.w, height(c));
          cx += c.w + GAP;
        }
        cy += Math.max(...row.map(height)) + GAP;
      }
    };
    const rootW = width - 2 * pad;
    const rootH = measure(block.root, rootW);
    place(block.root, pad, pad, rootW, rootH);

    // Flat, parents first: inner boxes paint on top and each box dims on its own.
    const anchors: Record<string, Frame> = {};
    const labels: Frame[] = [];
    const body = placed.map(({ box, x, y, w, h }) => {
      anchors[box.id] = { x, y, w, h };
      const rect = `<rect class="x-mark-shape" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="${num(radius)}"/>`;
      const attrs = ` data-depth="${Math.min(3, box.depth)}"${box.muted ? ` data-muted="true"` : ""}`;
      if (!leaf(box)) {
        const head = fit(box.label, w - 24, head600, 1).lines[0];
        labels.push({ x: x + 12, y: y + 12, w: head600(head), h: 16 });
        return mark({ id: box.id, label: box.label, focal: box.focal, cls: "x-nested-box", attrs }, rect + text(x + 12, y + 24, head, "x-nested-head"));
      }
      const { lines, cut } = leafLines(box, w);
      if (cut) {
        ctx.warn({ rule: "label-fit", severity: "warn", message: `nested "${block.id}": "${box.label}" does not fit its box; shorten it and move the detail to about.`, line: block.line });
      }
      const y0 = y + h / 2 - ((lines.length - 1) * lh) / 2 + px * 0.35;
      const tw = Math.max(...lines.map(sans));
      labels.push({ x: x + w / 2 - tw / 2, y: y0 - px, w: tw, h: (lines.length - 1) * lh + px * 1.3 });
      const cls = box.focal ? "x-mark-label x-on-fill" : "x-mark-label";
      return mark({ id: box.id, label: box.label, focal: box.focal, cls: "x-nested-leaf", attrs }, rect + lines.map((t, i) => text(x + w / 2, y0 + i * lh, t, cls, "middle")).join(""));
    });
    const markers = notes(block, anchors, { obstacles: labels, bounds: { x: 0, y: 0, w: width, h: rootH + 2 * pad } });

    return svgFigure({
      id: block.id,
      kind: "nested",
      title: block.title,
      label: `What ${block.root.label} contains`,
      desc: `${placed.length} boxes; each box sits inside the part that contains it.`,
      width,
      height: rootH + 2 * pad,
      body: body.join("") + markers,
    });
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const leaves = (b: Box): Box[] => (b.children.length ? b.children.flatMap(leaves) : [b]);
    const total = leaves(block.root).length;
    const depthBelow = (b: Box): number => (b.children.length ? 1 + Math.max(...b.children.map(depthBelow)) : 0);
    walk(block.root, (b, ancestors) => {
      const up = ancestors.map((a) => a.id);
      const parent = ancestors.at(-1);
      const siblings = parent ? parent.children.filter((c) => c !== b) : [];
      const path = ancestors.map((a) => a.label).join(" › ") || undefined;
      const pos = parent ? `${parent.children.indexOf(b) + 1} of ${parent.children.length}` : undefined;
      if (b.children.length) {
        const members: string[] = [];
        walk(b, (d) => { if (d !== b) members.push(d.id); });
        const parts = leaves(b).length;
        const info = groupInfo({
          id: b.id, label: b.label, figure: block.id, members, kind: "container", about: b.about,
          facts: [
            { k: "Parts", v: parent ? `${parts} of ${total} · ${share(parts, total)}` : String(parts) },
            parent ? { k: "Inside", v: parent.label, ref: parent.id } : null,
            depthBelow(b) > 1 ? { k: "Levels below", v: String(depthBelow(b)) } : null,
          ].filter((f): f is Fact => !!f),
          links: [{ rel: "Contains", ids: b.children.map((c) => c.id) }],
          context: up, crumb: up, pos,
          say: `${b.label}${path ? `, in ${path}` : ""}: ${parts} parts`,
        });
        elements[b.id] = info;
      } else {
        elements[b.id] = itemInfo({
          id: b.id, label: b.label, figure: block.id, kind: "part", about: b.about,
          facts: parent ? [{ k: "Inside", v: path!, ref: parent.id }] : [],
          links: [{ rel: "Next to", ids: siblings.map((c) => c.id) }],
          context: up, crumb: up, pos,
          say: `${b.label}${path ? `, in ${path}` : ""}`,
        });
      }
    });
    return { elements };
  },

  reading() {
    return "Each box sits inside the part that contains it, and each level is tinted one step further from the page. Box size follows how many parts a box holds, not how important it is.";
  },

  table(block): DataTable {
    const rows: string[][] = [];
    walk(block.root, (b, ancestors) => { if (!b.children.length) rows.push([b.label, ancestors.map((a) => a.label).join(" › ")]); });
    return { head: ["Part", "Inside"], rows };
  },
};
