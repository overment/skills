// Sankey: flows between nodes as filled bands. Columns follow the longest path from the sources and
// sinks sit in the last column. Node height ∝ throughput, vertical order from 4 barycenter sweeps.
// Color is origin: each source gets a palette slot, a node fed by one slot keeps it, merges go neutral.
// Labels stay off the bands: the first column's go in the left gutter, the last column's in the right
// gutter, and middle columns' sit in the gap above their node. Note markers go in the gaps between columns, on
// space no band, node or label covers.
import { BUDGET, SpecError, type BlockModule, type ElementInfo, type Fact, type Link, type ReadingSpec, type Theme } from "../types.ts";
import {
  NOTE_R, esc, fmt, format as readFormat, groupInfo, idFrom, isObj, list, mark, notes as noteMarkers, num, number, rank, readingSpec, seriesSlot,
  share, svgFigure, text, textWidth, type Format, type Frame,
} from "../kit.ts";
import { allowKeys, entries, joinList, optBool, optString, requireMap, requireString } from "../blocks/util.ts";

interface SankeyNode {
  id: string;
  label: string;
  about?: string;
  focal: boolean;
  muted: boolean;
}

interface SankeyLink {
  id: string;
  from: string;
  to: string;
  value: number;
  about?: string;
  focal: boolean;
  muted: boolean;
}

interface SankeyBlock extends ReadingSpec {
  type: "sankey";
  id: string;
  title?: string;
  line: number;
  format: Format;
  nodes: SankeyNode[];
  links: SankeyLink[];
  columns?: string[];     // optional stage names above the columns, left to right
}

type RawLink = Omit<SankeyLink, "id"> & { id?: string };
type Flow = { in: number; out: number; value: number };

const LIMITS = { columns: 4, nodes: 12, links: 16 } as const;
const NODE_KEYS = ["id", "label", "about", "focal", "muted"];
const LINK_KEYS = ["id", "from", "to", "value", "about", "focal", "muted"];
const SHORT = /^(.+?)\s*->\s*(.+?)\s*:\s*(\S.*)$/;

function textOf(v: unknown, what: string, where: string, line: number): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  throw new SpecError(`${where} needs \`${what}\` (text).`, line);
}

function parseLink(x: unknown, where: string, line: number): RawLink {
  if (typeof x === "string") {
    const m = SHORT.exec(x.trim());
    if (!m) throw new SpecError(`${where} must read "from -> to: value"; got "${x}".`, line);
    return { from: m[1].trim(), to: m[2].trim(), value: number(m[3].trim(), `${where} value`, line), focal: false, muted: false };
  }
  if (!isObj(x)) throw new SpecError(`${where} must be "from -> to: value" or a map { from, to, value, about }.`, line);
  const keys = Object.keys(x);
  // Unquoted shorthand: YAML reads `- a -> b: 120` as the one-key map { "a -> b": 120 }.
  if (keys.length === 1 && keys[0].includes("->")) {
    const k = keys[0], at = k.indexOf("->");
    const from = k.slice(0, at).trim(), to = k.slice(at + 2).trim();
    if (!from || !to) throw new SpecError(`${where} must read "from -> to: value"; got "${k}".`, line);
    return { from, to, value: number(x[k], `${where} value`, line), focal: false, muted: false };
  }
  allowKeys(x, LINK_KEYS, where, line);
  return {
    id: optString(x, "id", where, line),
    from: textOf(x.from, "from", where, line),
    to: textOf(x.to, "to", where, line),
    value: number(x.value, `${where} value`, line),
    about: optString(x, "about", where, line),
    focal: optBool(x, "focal", where, line),
    muted: optBool(x, "muted", where, line),
  };
}

function throughput(nodes: SankeyNode[], links: SankeyLink[]): Map<string, Flow> {
  const t = new Map<string, Flow>(nodes.map((n) => [n.id, { in: 0, out: 0, value: 0 }]));
  for (const l of links) { t.get(l.from)!.out += l.value; t.get(l.to)!.in += l.value; }
  for (const f of t.values()) f.value = Math.max(f.in, f.out);
  return t;
}

/** Longest path from the sources, sinks pushed to the last column. `order` is topological; shorter than nodes on a loop. */
function columnsOf(nodes: SankeyNode[], links: SankeyLink[]): { col: Map<string, number>; count: number; order: string[] } {
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const outs = new Map<string, SankeyLink[]>(nodes.map((n) => [n.id, []]));
  for (const l of links) { indeg.set(l.to, indeg.get(l.to)! + 1); outs.get(l.from)!.push(l); }
  const col = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const order = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    for (const l of outs.get(id)!) {
      col.set(l.to, Math.max(col.get(l.to)!, col.get(id)! + 1));
      indeg.set(l.to, indeg.get(l.to)! - 1);
      if (indeg.get(l.to) === 0) order.push(l.to);
    }
  }
  let last = 0;
  for (const c of col.values()) last = Math.max(last, c);
  for (const n of nodes) if (!outs.get(n.id)!.length) col.set(n.id, last);
  return { col, count: last + 1, order };
}

function linksBy(block: SankeyBlock, end: "from" | "to"): Map<string, SankeyLink[]> {
  const m = new Map<string, SankeyLink[]>(block.nodes.map((n) => [n.id, []]));
  for (const l of block.links) m.get(l[end])!.push(l);
  return m;
}

/** Palette slot per node; 0 = fed by several origins (neutral). */
function slots(order: string[], incoming: Map<string, SankeyLink[]>, theme: Theme): Map<string, number> {
  const out = new Map<string, number>();
  let k = 0;
  for (const id of order) {
    const ins = incoming.get(id)!;
    if (!ins.length) { out.set(id, seriesSlot(k++, theme)); continue; }
    const from = new Set(ins.map((l) => out.get(l.from)!));
    out.set(id, from.size === 1 ? [...from][0] : 0);
  }
  return out;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  const p = (part / whole) * 100;
  return fmt(p >= 10 ? Math.round(p) : Math.round(p * 10) / 10, "%");
}

export const blockModule: BlockModule<SankeyBlock> = {
  type: "sankey",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "sankey", line);
    allowKeys(data, ["id", "title", "format", "nodes", "links", "columns", "notes", "caveat", "story"], "sankey", line);
    const id = requireString(data, "id", "sankey", line);
    const where = `sankey "${id}"`;
    const format = readFormat(data.format, line);
    if (data.links === undefined) throw new SpecError(`${where} needs \`links\`: a list of "from -> to: value".`, line);
    const rawLinks = list(data.links, `${where} links`, line).map((x, i) => parseLink(x, `${where} link ${i + 1}`, line));
    if (!rawLinks.length) throw new SpecError(`${where} needs at least one link.`, line);

    const nodes: SankeyNode[] = [];
    const byId = new Map<string, SankeyNode>(), byLabel = new Map<string, SankeyNode>();
    const add = (n: SankeyNode) => {
      nodes.push(n);
      byId.set(n.id, n);
      if (!byLabel.has(n.label)) byLabel.set(n.label, n);
    };
    const given = data.nodes !== undefined;
    if (given) {
      for (const [nid, f] of entries(data.nodes, `${where} nodes`, line)) {
        const nw = `${where} node "${nid}"`;
        allowKeys(f, NODE_KEYS, nw, line);
        const label = f.label === undefined ? nid : textOf(f.label, "label", nw, line);
        if (byLabel.has(label)) ctx.warn({ rule: "label-duplicate", severity: "warn", message: `${where}: two nodes are labelled "${label}"; readers cannot tell them apart.`, line });
        add({ id: nid, label, about: optString(f, "about", nw, line), focal: optBool(f, "focal", nw, line), muted: optBool(f, "muted", nw, line) });
      }
    }
    const taken = new Set<string>([id, ...byId.keys()]);
    const resolve = (ref: string, lw: string): string => {
      const hit = byId.get(ref) ?? byLabel.get(ref);
      if (hit) return hit.id;
      if (given) throw new SpecError(`${lw} points at "${ref}", which is not in \`nodes\`. Known ids: ${[...byId.keys()].join(", ")}.`, line, "ref-exists");
      const n: SankeyNode = { id: idFrom(ref, taken, `${id}-`), label: ref, focal: false, muted: false };
      add(n);
      return n.id;
    };

    const pairs = new Set<string>();
    const links: SankeyLink[] = rawLinks.map((l, i) => {
      const lw = `${where} link ${i + 1}`;
      const from = resolve(l.from, lw), to = resolve(l.to, lw);
      if (from === to) throw new SpecError(`${lw} links "${l.from}" to itself; a sankey only flows forward.`, line);
      if (!(l.value > 0)) throw new SpecError(`${lw} value must be above 0; got ${l.value}. Drop links that carry nothing.`, line);
      const pair = `${from}->${to}`;
      if (pairs.has(pair)) throw new SpecError(`${where}: ${l.from} -> ${l.to} is listed twice; add the values into one link.`, line, "id-unique");
      pairs.add(pair);
      return { id: l.id ?? pair, from, to, value: l.value, about: l.about, focal: l.focal, muted: l.muted };
    });

    const ids = new Set<string>([id]);
    for (const x of [...nodes, ...links]) {
      if (ids.has(x.id)) throw new SpecError(`${where}: id "${x.id}" is used twice; nodes, links and the block need distinct ids.`, line, "id-unique");
      ids.add(x.id);
    }
    const linked = new Set(links.flatMap((l) => [l.from, l.to]));
    const lonely = nodes.find((n) => !linked.has(n.id));
    if (lonely) throw new SpecError(`${where}: node "${lonely.id}" is in no link; link it or remove it.`, line, "ref-exists");

    const { col, count, order } = columnsOf(nodes, links);
    if (order.length < nodes.length) {
      const done = new Set(order);
      const loop = nodes.filter((n) => !done.has(n.id)).map((n) => n.label);
      throw new SpecError(`${where}: links form a loop among ${joinList(loop)}; a sankey only flows forward. Remove the link that goes back.`, line);
    }

    const label = (nid: string) => byId.get(nid)!.label;
    if (count > LIMITS.columns) {
      const m = Math.floor(count / 2);
      const cut = nodes.filter((n) => col.get(n.id) === m).slice(0, 3).map((n) => n.label);
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${count} columns; keep it to 3–4. Split it into two sankeys at column ${m + 1} (${joinList(cut)}) so the second starts from those nodes, or merge pass-through steps.`, line });
    }
    if (nodes.length > LIMITS.nodes) {
      const t = throughput(nodes, links);
      const small = [...nodes].sort((a, b) => t.get(a.id)!.value - t.get(b.id)!.value).slice(0, 3).map((n) => n.label);
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${nodes.length} nodes; the budget is ${LIMITS.nodes}. Fold the smallest (${joinList(small)}) into one "Other" node.`, line });
    }
    if (links.length > LIMITS.links) {
      const small = [...links].sort((a, b) => a.value - b.value).slice(0, 3).map((l) => `${label(l.from)} → ${label(l.to)}`);
      ctx.warn({ rule: "budget-edges", severity: "warn", message: `${where} has ${links.length} links; the budget is ${LIMITS.links}. Merge the smallest (${joinList(small)}) into an "Other" flow, or split the diagram by source.`, line });
    }
    const focal = nodes.filter((n) => n.focal).length + links.filter((l) => l.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} nodes and links focal; keep it to ${BUDGET.focal}.`, line });
    }
    let columns: string[] | undefined;
    if (data.columns !== undefined) {
      columns = list(data.columns, `${where} columns`, line).map((c, i) => textOf(c, `columns item ${i + 1}`, where, line));
      if (columns.length !== count) {
        throw new SpecError(`${where} columns lists ${columns.length} names but the links make ${count} columns; name each column from left to right.`, line);
      }
    }
    return { type: "sankey", id, title: optString(data, "title", where, line), line, format, nodes, links, columns, ...readingSpec(data, line) };
  },

  render(block, ctx) {
    const { theme } = ctx;
    const W = 960, pad = theme.grid.pad, px = theme.type.nodeSub, tag = theme.type.tag;
    const nodeW = 12, lineH = Math.round(px * 1.3);
    const flow = throughput(block.nodes, block.links);
    const { col, count, order } = columnsOf(block.nodes, block.links);
    const incoming = linksBy(block, "to"), outgoing = linksBy(block, "from");
    const slot = slots(order, incoming, theme);
    const byId = new Map(block.nodes.map((n) => [n.id, n]));
    const index = new Map(block.links.map((l, i) => [l.id, i]));
    const valueOf = (id: string) => fmt(flow.get(id)!.value, block.format);
    const last = count - 1;
    const widthOf = (n: SankeyNode) => textWidth(n.label, px, "sans") + 4 + textWidth(valueOf(n.id), tag, "sans");
    const fit = (message: string) => ctx.warn({ rule: "label-fit", severity: "warn", message: `sankey "${block.id}": ${message}`, line: block.line });

    // Columns, gutters for the outer labels, a shared vertical scale, and stacking.
    const columns: SankeyNode[][] = Array.from({ length: count }, () => []);
    for (const n of block.nodes) columns[col.get(n.id)!].push(n);
    const middle = count > 2;
    const nodePad = middle ? Math.max(20, lineH + 10) : 20;
    const gutter = (c: SankeyNode[]) => Math.min(MAX_GUTTER, Math.max(0, ...c.map(widthOf))) + 10;
    const leftG = gutter(columns[0] ?? []), rightG = gutter(columns[last] ?? []);
    const headH = block.columns ? tag + 14 : 0;
    const top = pad / 2 + headH + (middle ? lineH + 4 : pad / 2);
    const plotH = Math.max(360, Math.max(...columns.map((c) => c.length)) * 48);
    const ky = Math.min(...columns.map((c) => (plotH - (c.length - 1) * nodePad) / c.reduce((s, n) => s + flow.get(n.id)!.value, 0)));
    const x0 = pad + leftG;
    const step = (W - pad - rightG - x0 - nodeW) / Math.max(1, count - 1);
    const pos = new Map<string, { x: number; y: number; h: number }>();
    const place = (c: number) => {
      const hs = columns[c].map((n) => Math.max(2, flow.get(n.id)!.value * ky));
      const total = hs.reduce((a, b) => a + b, 0) + (hs.length - 1) * nodePad;
      let y = top + Math.max(0, (plotH - total) / 2);
      columns[c].forEach((n, i) => { pos.set(n.id, { x: x0 + c * step, y, h: hs[i] }); y += hs[i] + nodePad; });
    };
    const mid = (id: string) => { const p = pos.get(id)!; return p.y + p.h / 2; };
    for (let c = 0; c < count; c++) place(c);

    // Barycenter: order each column by the value-weighted centre of its neighbours, forward then back.
    const sweep = (c: number, dir: "in" | "out") => {
      const keyed = columns[c].map((n, i) => {
        const ls = dir === "in" ? incoming.get(n.id)! : outgoing.get(n.id)!;
        let w = 0, s = 0;
        for (const l of ls) { w += l.value; s += l.value * mid(dir === "in" ? l.from : l.to); }
        return { n, i, key: w > 0 ? s / w : mid(n.id) };
      });
      keyed.sort((a, b) => a.key - b.key || a.i - b.i);
      columns[c] = keyed.map((k) => k.n);
      place(c);
    };
    for (let it = 0; it < 4; it++) {
      for (let c = 1; c < count; c++) sweep(c, "in");
      for (let c = count - 2; c >= 0; c--) sweep(c, "out");
    }

    // Band offsets inside each node, ordered by the other end to avoid crossings at the node.
    const sy = new Map<string, number>(), ty = new Map<string, number>();
    for (const n of block.nodes) {
      const p = pos.get(n.id)!;
      let y = p.y;
      for (const l of [...outgoing.get(n.id)!].sort((a, b) => mid(a.to) - mid(b.to) || index.get(a.id)! - index.get(b.id)!)) { sy.set(l.id, y); y += l.value * ky; }
      y = p.y;
      for (const l of [...incoming.get(n.id)!].sort((a, b) => mid(a.from) - mid(b.from) || index.get(a.id)! - index.get(b.id)!)) { ty.set(l.id, y); y += l.value * ky; }
    }

    const anchors: Record<string, Frame> = {};
    const labelBoxes: Frame[] = [];
    const bands = new Map<string, Band>();
    const links = [...block.links].sort((a, b) => b.value - a.value || index.get(a.id)! - index.get(b.id)!).map((l) => {
      const a = pos.get(l.from)!, b = pos.get(l.to)!;
      const w = Math.max(1, l.value * ky);
      if (l.value * ky < HAIRLINE) {
        ctx.warn({ rule: "budget-edges", severity: "warn", message: `sankey "${block.id}": ${byId.get(l.from)!.label} → ${byId.get(l.to)!.label} (${fmt(l.value, block.format)}) draws as a hairline; fold it into a larger flow or an "Other" node and name it in \`about\`.`, line: block.line });
      }
      const x0 = a.x + nodeW, x1 = b.x, xm = (x0 + x1) / 2;
      const y0 = sy.get(l.id)!, y1 = ty.get(l.id)!;
      anchors[l.id] = { x: xm - 4, y: (y0 + y1) / 2, w: 8, h: w };
      bands.set(l.id, { x0, x1, y0, y1, w });
      const d = `M${num(x0)},${num(y0)}C${num(xm)},${num(y0)} ${num(xm)},${num(y1)} ${num(x1)},${num(y1)}` +
        `L${num(x1)},${num(y1 + w)}C${num(xm)},${num(y1 + w)} ${num(xm)},${num(y0 + w)} ${num(x0)},${num(y0 + w)}Z`;
      const s = slot.get(l.from)!;
      const attrs = (s ? ` data-series="${s}"` : ` data-mix="true"`) + (l.focal ? ` data-focal="true"` : "") + (l.muted ? ` data-muted="true"` : "");
      const aria = `${byId.get(l.from)!.label} → ${byId.get(l.to)!.label}: ${fmt(l.value, block.format)}`;
      return `<g class="x-edge x-mark x-sankey-flow" data-id="${esc(l.id)}" data-from="${esc(l.from)}" data-to="${esc(l.to)}" data-kind="flow"${attrs} tabindex="0" role="button" aria-label="${esc(aria)}">` +
        `<path class="x-sankey-link x-mark-shape" d="${d}"/><path class="x-edge-hit" d="${d}"/></g>`;
    });

    const nodes = block.nodes.map((n) => {
      const p = pos.get(n.id)!, value = valueOf(n.id);
      const c = col.get(n.id)!;
      const lw = widthOf(n);
      // First column: left gutter. Last column: right gutter. Middle: centred in the gap above the node.
      const [lx, ly, anchor] = c === 0 ? [p.x - 6, p.y + p.h / 2 + px * 0.35, "end"]
        : c === last ? [p.x + nodeW + 6, p.y + p.h / 2 + px * 0.35, "start"]
        : [p.x + nodeW / 2, p.y - 6, "middle"];
      const bx = anchor === "end" ? lx - lw : anchor === "middle" ? lx - lw / 2 : lx;
      labelBoxes.push({ x: bx, y: ly - px, w: lw, h: px + 3 });
      anchors[n.id] = { x: p.x, y: p.y, w: nodeW, h: p.h };
      const label = `<text class="x-mark-label x-sankey-label" x="${num(lx)}" y="${num(ly)}"${anchor === "start" ? "" : ` text-anchor="${anchor}"`}>` +
        `${esc(n.label)} <tspan class="x-sankey-value">${esc(value)}</tspan></text>`;
      const s = slot.get(n.id)!;
      const rowAt = columns[c].indexOf(n);
      const attrs = (s ? "" : ` data-mix="true"`) + (n.muted ? ` data-muted="true"` : "") + ` data-nav="${rowAt},${c}"`;
      return mark({ id: n.id, label: n.label, value, series: s || undefined, focal: n.focal, cls: "x-sankey-node", attrs },
        `<rect class="x-mark-shape" x="${num(p.x)}" y="${num(p.y)}" width="${num(nodeW)}" height="${num(p.h)}"/>${label}`);
    });

    // Say so when a label cannot stay off the bands.
    for (const c of [0, last]) {
      for (const n of columns[c] ?? []) if (widthOf(n) + 10 > MAX_GUTTER) fit(`label "${n.label}" is wider than the ${c === 0 ? "left" : "right"} gutter; shorten it.`);
    }
    for (let c = 1; c < last; c++) {
      for (const n of columns[c]) if (widthOf(n) > 2 * (step - 16)) fit(`label "${n.label}" is wider than the space between columns; shorten it or drop a column.`);
    }

    // Optional stage names above the columns: selectable, the card lists that stage's split.
    const heads = (block.columns ?? []).map((name, c) => {
      const x = x0 + c * step;
      const [tx, anchor] = c === 0 ? [x, "start"] as const : c === last ? [x + nodeW, "end"] as const : [x + nodeW / 2, "middle"] as const;
      // the head is sentence-case sans at weight 600 (x-axis-label)
      const tw = textWidth(name, tag, "sans") * 1.08;
      const hx = anchor === "start" ? tx : anchor === "end" ? tx - tw : tx - tw / 2;
      const hit = { x: hx - 4, y: pad / 2 - 4, w: tw + 8, h: tag + 10 };
      labelBoxes.push(hit);
      anchors[headId(block, c)] = hit;
      return mark({ id: headId(block, c), label: name, cls: "x-grid-head x-sankey-head", attrs: ` data-nav="-1,${c}"` },
        `<rect class="x-mark-shape" x="${num(hit.x)}" y="${num(hit.y)}" width="${num(hit.w)}" height="${num(hit.h)}"/>` + text(tx, pad / 2 + tag, name, "x-axis-label", anchor));
    });

    const sources = block.nodes.filter((n) => !incoming.get(n.id)!.length);
    const sinks = block.nodes.filter((n) => !outgoing.get(n.id)!.length);
    const total = sources.reduce((s, n) => s + flow.get(n.id)!.out, 0);
    const height = top + plotH + pad;

    // Note markers: in the gaps between columns, never on a band, a node, a label or in the label gutters. Each note's
    // spot is the free one nearest its target; a zero-size anchor at the spot's lower-left corner makes it the first
    // place notes() tries, and the same obstacles keep notes() off the bands if no spot is free.
    const colL = x0, colR = x0 + last * step + nodeW;
    const obstacles: Frame[] = [
      ...labelBoxes,
      ...block.nodes.map((n) => anchors[n.id]),
      ...[...bands.values()].flatMap(bandCover),
      { x: 0, y: 0, w: colL, h: height },
      { x: colR, y: 0, w: W - colR, h: height },
      ...Array.from({ length: count }, (_, c) => ({ x: x0 + c * step, y: 0, w: nodeW, h: height })),
    ];
    const taken: Frame[] = [];
    const free = (cx: number, cy: number) => {
      const box = { x: cx - NOTE_R, y: cy - NOTE_R, w: NOTE_R * 2, h: NOTE_R * 2 };
      return box.x >= 0 && box.y >= 0 && box.x + box.w <= W && box.y + box.h <= height && ![...obstacles, ...taken].some((o) => hits(box, o));
    };
    const spots = { ...anchors };
    for (const note of block.notes ?? []) {
      const target = note.on.find((id) => anchors[id]);
      if (!target || spots[target] !== anchors[target]) continue;
      const band = bands.get(target);
      const spot = (band ? bandSpots(band) : frameSpots(anchors[target])).find(([cx, cy]) => free(cx, cy));
      if (!spot) continue;
      const [cx, cy] = spot;
      spots[target] = { x: cx - NOTE_R, y: cy + NOTE_R, w: 0, h: 0 };
      taken.push({ x: cx - NOTE_R, y: cy - NOTE_R, w: NOTE_R * 2, h: NOTE_R * 2 });
    }

    return svgFigure({
      id: block.id,
      kind: "sankey",
      title: block.title,
      label: `Flows from ${joinList(sources.map((n) => n.label))}`,
      desc: `${fmt(total, block.format)} flows from ${joinList(sources.map((n) => n.label))} to ${joinList(sinks.map((n) => n.label))} across ${count} columns.`,
      width: W,
      height,
      body: heads.join("") + `<g class="x-sankey-links">${links.join("")}</g><g class="x-sankey-nodes">${nodes.join("")}</g>` +
        noteMarkers(block, spots, { obstacles, bounds: { x: 0, y: 0, w: W, h: height } }),
    });
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const g = graph(block);
    const { flow, byId, ins, outs, down, up, col, count } = g;
    const val = (x: number) => fmt(x, block.format);
    const label = (id: string) => byId.get(id)!.label;
    const sources = block.nodes.filter((n) => !ins.get(n.id)!.length).map((n) => n.id);
    const sinks = block.nodes.filter((n) => !outs.get(n.id)!.length).map((n) => n.id);
    const all = sources.reduce((a, id) => a + flow.get(id)!.out, 0);
    const EST = { k: "≈", v: "proportional estimate" };

    for (const n of block.nodes) {
      const f = flow.get(n.id)!;
      const c = col.get(n.id)!;
      const facts: Fact[] = [{
        k: "Flow",
        v: f.in && f.out ? `in ${val(f.in)} · out ${val(f.out)}` : f.out ? `out ${val(f.out)}` : `in ${val(f.in)}`,
        raw: f.value,
      }];
      // Where this node's volume ends up (sinks) and where it comes from (sources). Anything past one hop is a
      // proportional estimate, because a sankey does not track which items took which path.
      const reach = (targets: string[], dir: "down" | "up") => targets
        .filter((t) => t !== n.id && (dir === "down" ? down.get(n.id)!.has(t) : up.get(n.id)!.has(t)))
        .map((t) => ({ t, ...(dir === "down" ? g.between(n.id, t) : g.between(t, n.id)) }))
        .sort((a, b) => b.amount - a.amount || a.t.localeCompare(b.t));
      const toSinks = reach(sinks, "down"), fromSources = reach(sources, "up");
      const base = (dir: "down" | "up") => (dir === "down" ? f.out : f.in);
      const row = (r: { t: string; amount: number; exact: boolean }, dir: "down" | "up"): Fact => ({
        k: dir === "down" ? `Reaches ${label(r.t)}` : `From ${label(r.t)}`,
        v: `${r.exact ? "" : "≈ "}${val(r.exact ? r.amount : roundEst(r.amount, f.value))} (${share(r.amount, base(dir))})`,
        ref: r.t,
        raw: r.amount,
      });
      // Four rows fit under Flow; three when one is an estimate, so the ≈ legend keeps its place.
      const both = [...toSinks.map((r) => ({ r, dir: "down" as const })), ...fromSources.map((r) => ({ r, dir: "up" as const }))];
      let take = both.slice(0, 4);
      if (take.some((x) => !x.r.exact)) take = both.slice(0, 3);
      const rows = take.map((x) => row(x.r, x.dir));
      facts.push(...rows);
      if (take.some((x) => !x.r.exact)) facts.push(EST);
      facts.push({ k: "Share of all", v: `${share(f.value, all)} of all flow`, raw: all ? (f.value / all) * 100 : 0 });
      const context = [...new Set([...down.get(n.id)!, ...up.get(n.id)!, ...g.linksWithin(n.id)])]
        .filter((id) => id !== n.id && !g.adjacent(n.id).has(id));
      const links: Link[] = [
        { rel: "Fed by", ids: ins.get(n.id)!.map((l) => l.from) },
        { rel: "Flows to", ids: outs.get(n.id)!.map((l) => l.to) },
      ];
      const say = [n.label, facts[0]!.v, ...rows.slice(0, 2).map((r) => `${r.k.charAt(0).toLowerCase()}${r.k.slice(1)} ${r.v}`)].join(", ");
      const info: ElementInfo = {
        id: n.id, type: "node", label: n.label, kind: "node", figure: block.id, value: val(f.value),
        facts: facts.slice(0, 5), links: links.filter((l) => l.ids.length),
        pos: block.columns?.[c] ?? `column ${c + 1} of ${count}`, say,
      };
      if (context.length) info.context = context;
      if (n.about) info.about = n.about;
      elements[n.id] = info;
    }

    const values = block.links.map((l) => l.value);
    for (const l of block.links) {
      const from = label(l.from), to = label(l.to);
      const out = flow.get(l.from)!.out, inn = flow.get(l.to)!.in;
      const facts: Fact[] = [
        { k: `Share of ${to}`, v: `${share(l.value, inn)} of ${val(inn)} in`, raw: inn ? (l.value / inn) * 100 : 0 },
        { k: `Share of ${from}`, v: `${share(l.value, out)} of ${val(out)} out`, raw: out ? (l.value / out) * 100 : 0 },
        { k: "Share of all", v: `${share(l.value, all)} of all flow`, raw: all ? (l.value / all) * 100 : 0 },
      ];
      // Tier 2: what feeds this band's source and where its target sends things.
      const context = [...new Set([...up.get(l.from)!, ...g.linksInto(l.from), ...down.get(l.to)!, ...g.linksOutOf(l.to)])]
        .filter((id) => id !== l.id && id !== l.from && id !== l.to);
      const info: ElementInfo = {
        id: l.id, type: "edge", label: `${from} → ${to}`, kind: "flow", figure: block.id, from: l.from, to: l.to,
        value: `${val(l.value)} · ${share(l.value, out)} of ${from}`,
        facts, links: [{ rel: "From", ids: [l.from] }, { rel: "To", ids: [l.to] }],
        pos: rank(l.value, values).text,
        say: `${from} to ${to}, ${val(l.value)}, ${share(l.value, out)} of ${from}, ${share(l.value, inn)} of ${to}`,
      };
      if (context.length) info.context = context;
      if (l.about) info.about = l.about;
      elements[l.id] = info;
    }

    // Stage names: the card lists the stage's split.
    (block.columns ?? []).forEach((name, c) => {
      const members = block.nodes.filter((n) => col.get(n.id) === c).sort((a, b) => flow.get(b.id)!.value - flow.get(a.id)!.value);
      const sum = members.reduce((a, n) => a + flow.get(n.id)!.value, 0);
      elements[headId(block, c)] = groupInfo({
        id: headId(block, c), label: name, figure: block.id, kind: "column", members: members.map((n) => n.id), value: val(sum),
        facts: members.map((n) => ({ k: n.label, v: `${val(flow.get(n.id)!.value)} (${share(flow.get(n.id)!.value, sum)})`, ref: n.id, raw: flow.get(n.id)!.value })),
        pos: `${c + 1} of ${count}`,
        say: `${name}: ${members.map((n) => `${n.label} ${share(flow.get(n.id)!.value, sum)}`).join(", ")}`,
      });
    });

    // Virtual path ids for prose: "<block>-path-<source>-<sink>" selects every band and node between the two.
    for (const s of sources) for (const t of sinks) {
      if (!down.get(s)!.has(t)) continue;
      const id = `${block.id}-path-${short(block, s)}-${short(block, t)}`;
      if (elements[id]) continue;
      const on = new Set([s, t, ...[...down.get(s)!].filter((x) => up.get(t)!.has(x))]);
      const bands = block.links.filter((l) => on.has(l.from) && on.has(l.to)).map((l) => l.id);
      const { amount, exact } = g.between(s, t);
      const est = exact ? val(amount) : `≈ ${val(roundEst(amount, flow.get(s)!.value))}`;
      const facts: Fact[] = [
        { k: "Flow", v: est, raw: amount },
        { k: `Share of ${label(s)}`, v: `${exact ? "" : "≈ "}${share(amount, flow.get(s)!.out)}`, raw: (amount / flow.get(s)!.out) * 100 },
        { k: `Share of ${label(t)}`, v: `${exact ? "" : "≈ "}${share(amount, flow.get(t)!.in)}`, raw: (amount / flow.get(t)!.in) * 100 },
      ];
      if (!exact) facts.push(EST);
      elements[id] = groupInfo({
        id, label: `${label(s)} → ${label(t)}`, figure: block.id, kind: "path", members: [...on, ...bands], value: est, facts,
        links: [{ rel: "From", ids: [s] }, { rel: "To", ids: [t] }],
        say: `${label(s)} to ${label(t)}, ${est}`,
      });
    }
    return { elements };
  },

  reading(block) {
    return `Band width = amount; each band runs from where it starts to where it ends, left to right. Colour = origin, and a node fed by several origins turns grey${block.columns ? `. Columns: ${block.columns.join(" → ")}` : ""}. Select a node to trace it end to end; totals past one hop are proportional estimates (≈).`;
  },

  table(block) {
    const byId = new Map(block.nodes.map((n) => [n.id, n.label]));
    const flow = throughput(block.nodes, block.links);
    return {
      head: ["From", "To", "Value", "Share of from"],
      rows: block.links.map((l) => [byId.get(l.from)!, byId.get(l.to)!, fmt(l.value, block.format), share(l.value, flow.get(l.from)!.out)]),
    };
  },
};

const MAX_GUTTER = 220;
const HAIRLINE = 1.5;
const SPOT_GAP = 4;   // clear space between a note marker and the band or node it points at

/** A band as drawn: top edge from (x0, y0) to (x1, y1), both control points at the middle x; `w` thick. */
interface Band { x0: number; x1: number; y0: number; y1: number; w: number }

/** Point on a band's top edge at curve parameter t. x and y both move monotonically with t. */
function edgeAt(b: Band, t: number): [number, number] {
  const u = 1 - t, xm = (b.x0 + b.x1) / 2;
  const x = u * u * u * b.x0 + 3 * u * t * xm + t * t * t * b.x1;
  const y = (u * u * u + 3 * u * u * t) * b.y0 + (3 * u * t * t + t * t * t) * b.y1;
  return [x, y];
}

/** Boxes that cover a band completely: the edge is monotone, so each slice's box holds the curve between samples. */
function bandCover(b: Band): Frame[] {
  const out: Frame[] = [];
  let [px, py] = edgeAt(b, 0);
  for (let i = 1; i <= 24; i++) {
    const [x, y] = edgeAt(b, i / 24);
    out.push({ x: px, y: Math.min(py, y), w: x - px, h: Math.abs(y - py) + b.w });
    [px, py] = [x, y];
  }
  return out;
}

/** The band's top edge at pixel x. */
function topAt(b: Band, x: number): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (edgeAt(b, m)[0] < x) lo = m; else hi = m;
  }
  return edgeAt(b, (lo + hi) / 2)[1];
}

/** Marker centres just above and below a band, from the middle of its run outwards. */
function bandSpots(b: Band): [number, number][] {
  const d = NOTE_R + SPOT_GAP, lo = b.x0 + d, hi = b.x1 - d;
  const out: [number, number][] = [];
  for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9, 0, 1]) {
    const x = lo + f * (hi - lo), top = topAt(b, x);
    out.push([x, top - d], [x, top + b.w + d]);
  }
  return out;
}

/** Marker centres off the corners of a node or head, stepping sideways (past a middle label) and then outwards. */
function frameSpots(f: Frame): [number, number][] {
  const d = NOTE_R + SPOT_GAP;
  const out: [number, number][] = [];
  for (let k = 0; k <= 96; k += 8) {
    const right = f.x + f.w + d + k, left = f.x - d - k, up = f.y - d, down = f.y + f.h + d;
    out.push([right, up], [left, up], [right, down], [left, down], [f.x + f.w / 2, up - k], [f.x + f.w / 2, down + k]);
  }
  return out;
}

function hits(a: Frame, b: Frame): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function headId(block: SankeyBlock, c: number): string {
  return `${block.id}-col-${idFrom(block.columns?.[c] ?? String(c + 1), new Set())}`;
}

/** A node id without the block prefix, for virtual path ids. */
function short(block: SankeyBlock, id: string): string {
  return id.startsWith(`${block.id}-`) ? id.slice(block.id.length + 1) : id;
}

/** Round an estimate to two significant digits of the node's own volume (3,000 → nearest 100). */
function roundEst(v: number, scale: number): number {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, scale))) - 1);
  return Math.round(v / step) * step;
}

/** Adjacency, closures and proportional path estimates, shared by model() and tests. */
function graph(block: SankeyBlock) {
  const flow = throughput(block.nodes, block.links);
  const byId = new Map(block.nodes.map((n) => [n.id, n]));
  const ins = linksBy(block, "to"), outs = linksBy(block, "from");
  const { col, count, order } = columnsOf(block.nodes, block.links);
  const closure = (start: string, next: (id: string) => string[]) => {
    const seen = new Set<string>();
    const stack = [...next(start)];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...next(id));
    }
    return seen;
  };
  const down = new Map(block.nodes.map((n) => [n.id, closure(n.id, (id) => outs.get(id)!.map((l) => l.to))]));
  const up = new Map(block.nodes.map((n) => [n.id, closure(n.id, (id) => ins.get(id)!.map((l) => l.from))]));
  // share[t] of each node's outflow that reaches t, splitting every node's inflow over its out-links by value.
  const reachShare = new Map<string, Map<string, number>>();
  for (const id of [...order].reverse()) {
    const m = new Map<string, number>();
    const out = flow.get(id)!.out;
    for (const l of outs.get(id)!) {
      const w = out ? l.value / out : 0;
      m.set(l.to, (m.get(l.to) ?? 0) + w);
      for (const [t, x] of reachShare.get(l.to) ?? []) m.set(t, (m.get(t) ?? 0) + w * x);
    }
    reachShare.set(id, m);
  }
  const direct = (a: string, b: string) => outs.get(a)!.find((l) => l.to === b);
  return {
    flow, byId, ins, outs, down, up, col, count,
    /** Amount from `a` that reaches `b`; exact when the only route is one direct band. */
    between(a: string, b: string): { amount: number; exact: boolean } {
      const d = direct(a, b);
      const multi = outs.get(a)!.some((l) => l.to !== b && down.get(l.to)!.has(b));
      if (d && !multi) return { amount: d.value, exact: true };
      return { amount: flow.get(a)!.out * (reachShare.get(a)!.get(b) ?? 0), exact: false };
    },
    /** Node and band ids one hop from `id`. */
    adjacent(id: string): Set<string> {
      const out = new Set<string>();
      for (const l of outs.get(id)!) out.add(l.id).add(l.to);
      for (const l of ins.get(id)!) out.add(l.id).add(l.from);
      return out;
    },
    /** Bands on any route through `id`: everything upstream feeding it and downstream from it. */
    linksWithin(id: string): string[] {
      const upSet = new Set([id, ...up.get(id)!]), downSet = new Set([id, ...down.get(id)!]);
      return block.links.filter((l) => (upSet.has(l.from) && upSet.has(l.to)) || (downSet.has(l.from) && downSet.has(l.to))).map((l) => l.id);
    },
    linksInto(id: string): string[] {
      const set = new Set([id, ...up.get(id)!]);
      return block.links.filter((l) => set.has(l.from) && set.has(l.to)).map((l) => l.id);
    },
    linksOutOf(id: string): string[] {
      const set = new Set([id, ...down.get(id)!]);
      return block.links.filter((l) => set.has(l.from) && set.has(l.to)).map((l) => l.id);
    },
  };
}
