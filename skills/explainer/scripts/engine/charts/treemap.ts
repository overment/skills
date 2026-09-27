// Treemap: area ∝ value, squarified. With groups: one outer box + label strip per group, one palette slot per group.
// Without groups: one color, lightness by value.
import { SpecError, type BlockModule, type ElementInfo, type Fact, type ReadingSpec } from "../types.ts";
import {
  fmt, format as parseFormat, groupInfo, idFrom, isObj, itemInfo, mark, NOTE_R, notes as noteMarkers, num, number, rank, readingSpec, seriesSlot,
  share, svgFigure, text, textWidth, type Format, type Frame,
} from "../kit.ts";
import { allowKeys, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";
import { markInk } from "./ink.ts";

interface TreeItem { id: string; label: string; value: number; group?: string; about?: string; focal: boolean; muted: boolean; level: number }
interface TreeGroup { id: string; label: string; about?: string; total: number; slot: number; items: TreeItem[] }

interface TreemapBlock extends ReadingSpec {
  type: "treemap";
  id: string;
  title?: string;
  line: number;
  format: Format;
  items: TreeItem[];   // source order
  groups: TreeGroup[]; // largest total first; empty = single level
  total: number;
}

interface Rect { x: number; y: number; w: number; h: number }

const W = 960, PLOT_H = 400, MAX_TILES = 30, MAX_GROUPS = 6;

function labelOf(v: unknown, what: string, line: number): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  throw new SpecError(`${what} must be a text label, got ${JSON.stringify(v)}.`, line);
}

function aboutMap(v: unknown, known: string[], what: string, of: string, line: number): Map<string, string> {
  const out = new Map<string, string>();
  if (v === undefined || v === null) return out;
  if (!isObj(v)) throw new SpecError(`${what} must be a map of name: one or two sentences.`, line);
  for (const [k, about] of Object.entries(v)) {
    if (!known.includes(k)) throw new SpecError(`${what}: "${k}" is not one of ${of} (${known.join(", ") || "none"}).`, line, "ref-exists");
    if (typeof about !== "string") throw new SpecError(`${what}.${k} must be text.`, line);
    out.set(k, about);
  }
  return out;
}

function itemsOf(v: unknown, where: string, line: number): Fields[] {
  if (Array.isArray(v)) {
    return v.map((it, i) => {
      if (!isObj(it)) throw new SpecError(`${where} data item ${i + 1} must be a map: { label, value }.`, line);
      return it;
    });
  }
  if (isObj(v)) return Object.entries(v).map(([label, val]) => (isObj(val) ? { label, ...val } : { label, value: val }));
  throw new SpecError(`${where} needs \`data\`: a list of { label, value } or a map of label: value.`, line);
}

/** Levels 1–6 by rank (0 is too close to the page to read as a tile). */
function rankLevels(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n < 2 || sorted[0] === sorted[n - 1]) return values.map(() => 4);
  return values.map((v) => {
    let below = 0, same = 0;
    for (const s of sorted) {
      if (s < v) below++;
      else if (s === v) same++;
    }
    return 1 + Math.min(5, Math.floor(((below + (same - 1) / 2) / (n - 1)) * 6));
  });
}

function worst(areas: number[], i: number, j: number, sum: number, side: number): number {
  let max = 0, min = Infinity;
  for (let k = i; k < j; k++) {
    max = Math.max(max, areas[k] ?? 0);
    min = Math.min(min, areas[k] ?? 0);
  }
  const s2 = sum * sum, w2 = side * side;
  return Math.max((w2 * max) / s2, s2 / (w2 * min));
}

/** Squarified treemap (Bruls, Huizing, van Wijk). `values` sorted descending, all > 0. Deterministic. */
function squarify(values: number[], r: Rect): Rect[] {
  const total = values.reduce((a, v) => a + v, 0);
  if (!values.length || r.w <= 0 || r.h <= 0 || total <= 0) return values.map(() => ({ x: r.x, y: r.y, w: 0, h: 0 }));
  const scale = (r.w * r.h) / total;
  const areas = values.map((v) => v * scale);
  const out: Rect[] = [];
  let { x, y, w, h } = r;
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    let j = i + 1;
    let sum = areas[i] ?? 0;
    let current = worst(areas, i, j, sum, side);
    while (j < areas.length) {
      const nextSum = sum + (areas[j] ?? 0);
      const next = worst(areas, i, j + 1, nextSum, side);
      if (next > current) break;
      sum = nextSum;
      current = next;
      j++;
    }
    const last = j === areas.length;
    if (w >= h) {
      // a column on the left, tiles stacked top to bottom
      const colW = last ? w : sum / h;
      let yy = y;
      for (let k = i; k < j; k++) {
        const th = k === j - 1 ? y + h - yy : (areas[k] ?? 0) / colW;
        out.push({ x, y: yy, w: colW, h: th });
        yy += th;
      }
      x += colW;
      w -= colW;
    } else {
      // a row on top, tiles left to right
      const rowH = last ? h : sum / w;
      let xx = x;
      for (let k = i; k < j; k++) {
        const tw = k === j - 1 ? x + w - xx : (areas[k] ?? 0) / rowH;
        out.push({ x: xx, y, w: tw, h: rowH });
        xx += tw;
      }
      y += rowH;
      h -= rowH;
    }
    i = j;
  }
  return out;
}

function inset(r: Rect, d: number): Rect {
  return { x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) };
}

function box(r: Rect): string {
  return `x="${num(r.x)}" y="${num(r.y)}" width="${num(Math.max(0, r.w))}" height="${num(Math.max(0, r.h))}"`;
}

function fit(s: string, max: number, px: number, font: "sans" | "mono"): string {
  if (textWidth(s, px, font) <= max) return s;
  const chars = Array.from(s);
  for (let n = chars.length - 1; n > 0; n--) {
    const cut = `${chars.slice(0, n).join("").trimEnd()}…`;
    if (textWidth(cut, px, font) <= max) return cut;
  }
  return "";
}

/** Largest first; ties keep source order (Array.prototype.sort is stable). */
function byValue(items: TreeItem[]): TreeItem[] {
  return [...items].sort((a, b) => b.value - a.value);
}

export const blockModule: BlockModule<TreemapBlock> = {
  type: "treemap",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "treemap", line);
    allowKeys(data, ["id", "title", "format", "data", "groupAbout", "notes", "caveat", "story"], "treemap", line);
    const id = requireString(data, "id", "treemap", line);
    const where = `treemap "${id}"`;
    const title = optString(data, "title", where, line);
    const format = parseFormat(data.format, line);
    const src = itemsOf(data.data, where, line);
    if (!src.length) throw new SpecError(`${where} needs at least one item in \`data\`.`, line);

    const parsed = src.map((it, i) => {
      const iw = `${where} item ${i + 1}`;
      allowKeys(it, ["id", "label", "value", "group", "about", "focal", "muted"], iw, line);
      const label = labelOf(it.label, `${iw} label`, line);
      const value = number(it.value, `${where} "${label}" value`, line);
      if (value <= 0) throw new SpecError(`${where} "${label}" value must be above 0; a treemap cannot draw ${value}.`, line);
      return {
        custom: it.id === undefined ? undefined : labelOf(it.id, `${iw} id`, line),
        label,
        value,
        group: it.group === undefined || it.group === null ? undefined : labelOf(it.group, `${iw} group`, line),
        about: optString(it, "about", iw, line),
        focal: optBool(it, "focal", iw, line),
        muted: optBool(it, "muted", iw, line),
      };
    });

    const grouped = parsed.filter((p) => p.group !== undefined).length;
    if (grouped && grouped < parsed.length) {
      throw new SpecError(`${where}: give every item a \`group\` or none; ${parsed.length - grouped} of ${parsed.length} have none.`, line);
    }

    const taken = new Set<string>();
    for (const p of parsed) {
      if (!p.custom) continue;
      if (taken.has(p.custom)) throw new SpecError(`${where}: id "${p.custom}" is used twice.`, line, "id-unique");
      taken.add(p.custom);
    }
    const items: TreeItem[] = parsed.map((p) => ({
      id: p.custom ?? idFrom(p.label, taken, `${id}-`),
      label: p.label, value: p.value, group: p.group, about: p.about, focal: p.focal, muted: p.muted, level: 0,
    }));

    const names: string[] = [];
    const members = new Map<string, TreeItem[]>();
    for (const it of items) {
      if (it.group === undefined) continue;
      if (!members.has(it.group)) {
        members.set(it.group, []);
        names.push(it.group);
      }
      members.get(it.group)?.push(it);
    }
    const groupAbout = aboutMap(data.groupAbout, names, `${where} groupAbout`, "the groups", line);
    const groups: TreeGroup[] = names
      .map((name, i) => ({ name, i, total: (members.get(name) ?? []).reduce((a, it) => a + it.value, 0) }))
      .sort((a, b) => b.total - a.total || a.i - b.i)
      .map((g, gi) => ({
        id: idFrom(g.name, taken, `${id}-group-`),
        label: g.name,
        about: groupAbout.get(g.name),
        total: g.total,
        slot: seriesSlot(gi, ctx.theme),
        items: members.get(g.name) ?? [],
      }));

    if (!groups.length) {
      const levels = rankLevels(items.map((it) => it.value));
      items.forEach((it, k) => { it.level = levels[k] ?? 4; });
    }

    if (items.length > MAX_TILES) {
      ctx.warn({
        rule: "budget-nodes",
        severity: "warn",
        message: `${where} has ${items.length} tiles; keep it to ${MAX_TILES}. Merge the smallest into one "Other" tile or draw one treemap per group.`,
        line,
      });
    }
    if (groups.length > MAX_GROUPS) {
      const small = groups.slice(MAX_GROUPS - 1).map((g) => g.label);
      ctx.warn({
        rule: "budget-nodes",
        severity: "warn",
        message: `${where} has ${groups.length} groups; keep it to ${MAX_GROUPS}. Past 8 the palette repeats, so group colours stop meaning anything. Fold the smallest (${small.join(", ")}) into one "Other" group.`,
        line,
      });
    }
    const focal = items.filter((it) => it.focal).length;
    if (focal > 2) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} tiles focal; keep it to 2.`, line });
    }

    return { type: "treemap", id, title, line, format, items, groups, total: items.reduce((a, it) => a + it.value, 0), ...readingSpec(data, line) };
  },

  render(b, ctx) {
    const theme = ctx.theme;
    const pad = theme.grid.pad, px = theme.type.nodeSub, tag = theme.type.tag;
    const plot: Rect = { x: pad, y: pad / 2, w: W - 2 * pad, h: PLOT_H };
    const grouped = b.groups.length > 0;
    const parts: string[] = [];
    const anchors: Record<string, Frame> = {};
    const labelBoxes: Frame[] = [];

    const tile = (it: TreeItem, r: Rect, slot: number): string => {
      const value = fmt(it.value, b.format);
      anchors[it.id] = r;
      // Text sits on the fill; data-ink picks text or surface for this fill in each theme (charts-grids.css).
      const level = !grouped && !it.focal && !it.muted ? it.level : undefined;
      const ink = markInk(theme, { focal: it.focal, muted: it.muted, level, slot: grouped ? slot : 1 });
      const onFill = ink || it.focal || (grouped && !it.muted) ? " x-on-fill" : "";
      let labels = "";
      if (r.w >= textWidth(it.label, px, "sans") + 12 && r.h >= px + 12) {
        const ly = r.y + 6 + px * 0.9;
        labels += text(r.x + 6, ly, it.label, `x-mark-label${onFill}`);
        let lw = textWidth(it.label, px, "sans"), lh = px;
        if (r.w >= textWidth(value, tag, "sans") + 12 && r.h >= px + tag + 18) {
          labels += text(r.x + 6, ly + tag + 5, value, `x-mark-label x-tree-value${onFill}`);
          lw = Math.max(lw, textWidth(value, tag, "sans"));
          lh += tag + 5;
        }
        labelBoxes.push({ x: r.x + 6, y: r.y + 6, w: lw, h: lh });
      }
      const attrs = (level === undefined ? "" : ` data-level="${level}"`) + ink + (it.muted ? ` data-muted="true"` : "");
      return mark(
        { id: it.id, label: it.label, value, series: grouped ? slot : undefined, focal: it.focal, cls: "x-tile", attrs },
        `<rect class="x-mark-shape" ${box(r)}/>${labels}`,
      );
    };
    const tiles = (items: TreeItem[], area: Rect, slot: number): string => {
      const sorted = byValue(items);
      const rects = squarify(sorted.map((it) => it.value), area);
      return sorted.map((it, k) => tile(it, inset(rects[k] ?? { x: area.x, y: area.y, w: 0, h: 0 }, 1), slot)).join("");
    };

    if (grouped) {
      const stripH = tag + 12;
      const outer = squarify(b.groups.map((g) => g.total), plot);
      b.groups.forEach((g, gi) => {
        const gb = inset(outer[gi] ?? { x: plot.x, y: plot.y, w: 0, h: 0 }, 2);
        const strip = gb.h >= stripH + 16 && gb.w >= 32;
        const inner = strip ? { x: gb.x + 2, y: gb.y + stripH, w: Math.max(0, gb.w - 4), h: Math.max(0, gb.h - stripH - 2) } : inset(gb, 2);
        anchors[g.id] = gb;
        // The group is one mark whose shape is the whole frame: selection rings the group, the strip and the
        // gaps around its tiles are its hit area, and a group too small for a strip is still selectable.
        let head = "";
        if (strip) {
          const total = fmt(g.total, b.format);
          const avail = gb.w - 12;
          const by = gb.y + stripH / 2 + tag * 0.35;
          const full = textWidth(g.label, tag, "sans") + textWidth(total, tag, "sans") + 10 <= avail;
          const lab = full ? g.label : fit(g.label, avail, tag, "sans");
          head = (lab ? text(gb.x + 6, by, lab, "x-tree-group-label") : "") +
            (full ? text(gb.x + gb.w - 6, by, total, "x-value-label", "end") : "");
          labelBoxes.push({ x: gb.x, y: gb.y, w: gb.w, h: stripH });
        }
        parts.push(mark(
          { id: g.id, label: g.label, value: fmt(g.total, b.format), cls: "x-grid-head x-tree-head" },
          `<rect class="x-mark-shape x-tree-group" ${box(gb)}/>${head}`,
        ));
        parts.push(tiles(g.items, inner, g.slot));
      });
    } else {
      parts.push(tiles(b.items, plot, 0));
    }
    // tiles fill the plot edge to edge, so a note marker needs a lane under it or it lands on a neighbouring tile
    const height = PLOT_H + pad + (b.notes?.length ? 2 * NOTE_R + 8 : 0);
    parts.push(noteMarkers(b, anchors, { obstacles: labelBoxes, bounds: { x: 0, y: 0, w: W, h: height } }));

    const desc = `Each tile's area is proportional to its value; together they add up to ${fmt(b.total, b.format)}` +
      (grouped ? `, in ${b.groups.length} groups.` : ".");
    return svgFigure({
      id: b.id,
      kind: "treemap",
      title: b.title,
      label: `Treemap of ${b.items.length} items`,
      desc,
      width: W,
      height,
      body: parts.join(""),
    });
  },

  model(b) {
    const elements: Record<string, ElementInfo> = {};
    const val = (x: number) => fmt(x, b.format);
    const values = b.items.map((it) => it.value);
    const totals = b.groups.map((g) => g.total);
    const groupOf = new Map<string, TreeGroup>();
    for (const g of b.groups) {
      const members = byValue(g.items);
      const top = members[0];
      const facts: Fact[] = [
        { k: "Share of total", v: share(g.total, b.total), raw: (g.total / b.total) * 100 },
        { k: "Tiles", v: String(g.items.length) },
      ];
      if (top) facts.push({ k: "Largest", v: `${top.label} · ${val(top.value)} (${share(top.value, g.total)})`, ref: top.id, raw: top.value });
      if (b.groups.length > 1) facts.push({ k: "Rank", v: `${rank(g.total, totals).nth} groups` });
      elements[g.id] = groupInfo({
        id: g.id, label: g.label, figure: b.id, kind: "group", about: g.about, members: g.items.map((it) => it.id),
        value: val(g.total), facts, pos: rank(g.total, totals).text,
        links: [{ rel: "Tiles", ids: members.map((it) => it.id) }],
        say: `${g.label}, ${val(g.total)}, ${share(g.total, b.total)} of total, ${g.items.length} tiles${top ? `, largest ${top.label}` : ""}`,
      });
      for (const it of g.items) groupOf.set(it.id, g);
    }
    for (const it of b.items) {
      const g = groupOf.get(it.id);
      const r = rank(it.value, values);
      const facts: Fact[] = [];
      if (g) facts.push({ k: "Share of group", v: `${share(it.value, g.total)} of ${g.label}`, raw: (it.value / g.total) * 100 });
      facts.push({ k: "Share of total", v: `${share(it.value, b.total)} of total`, raw: (it.value / b.total) * 100 });
      facts.push({ k: "Rank", v: r.nth });
      if (g) {
        const top = byValue(g.items)[0];
        if (top && top.id !== it.id) facts.push({ k: `Largest in ${g.label}`, v: `${top.label} · ${val(top.value)}`, ref: top.id, raw: top.value });
      }
      elements[it.id] = itemInfo({
        id: it.id, label: it.label, figure: b.id, kind: "tile",
        value: val(it.value), about: it.about,
        related: g ? [g.id] : undefined,
        context: g ? g.items.filter((x) => x.id !== it.id).map((x) => x.id) : undefined,
        crumb: g ? [g.id] : undefined,
        facts, pos: r.text,
        links: g ? [{ rel: "Group", ids: [g.id] }] : undefined,
        say: `${it.label}, ${val(it.value)}${g ? `, ${share(it.value, g.total)} of ${g.label}` : ""}, ${share(it.value, b.total)} of total`,
      });
    }
    return { elements };
  },

  reading(b) {
    return b.groups.length
      ? `Tile area = value, largest first. Colour = group; each group's total is on its strip, and a tile's share of its group is in its card.`
      : `Tile area = value, largest first; the stronger the shade, the higher the rank.`;
  },

  table(b) {
    const grouped = b.groups.length > 0;
    const rows = grouped
      ? b.groups.flatMap((g) => byValue(g.items).map((it) => [g.label, it.label, fmt(it.value, b.format), share(it.value, g.total), share(it.value, b.total)]))
      : byValue(b.items).map((it) => [it.label, fmt(it.value, b.format), share(it.value, b.total)]);
    return { head: grouped ? ["Group", "Item", "Value", "Share of group", "Share of total"] : ["Item", "Value", "Share of total"], rows };
  },
};
