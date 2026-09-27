import type { Diagnostic, EdgeKind, EdgeSpec, FigureBlock, Layout, NodeKind, ReadingSpec, RenderContext, Theme } from "../types.ts";
import { notes } from "../kit.ts";
import { boldWidth, cellRect, groupRect, inflate, overlaps, segmentBox, textWidth, type Rect } from "./grid.ts";
import { routeEdges, type Point } from "./route.ts";

const LEGEND_H = 48;
const LEGEND_ROW = 20;
const MASK_H = 14;
const MASK_PAD = 4;
const LABEL_GAP = 8;
/** A label keeps this far from every other connector and border; the second pass settles for LABEL_NEAR. */
const LABEL_CLEAR = 8;
const LABEL_NEAR = 3;
const CORNER = 8;
const HOP = 4;
const HOP_MARGIN = CORNER + HOP + 2;
/** Space kept around the drawn content inside the SVG. */
const EDGE_PAD = 16;
const TAG_GAP = 16;
const START_R = 5;
const START_LEN = 24;
/** The page column at a 1280px window (design law S6). A grid figure narrows its column gutters to fit it. */
export const COLUMN = 1232;
/** The narrowest column gutter: four connector lanes, or a short label on a run across it. */
const MIN_GAP = 64;

export const NODE_WORDS: Record<NodeKind, string> = {
  actor: "person", service: "service", store: "data store", external: "external", boundary: "boundary", optional: "optional", decision: "decision",
};
export const EDGE_WORDS: Record<EdgeKind, string> = { flow: "flow", return: "reply", async: "async", link: "external call" };
const NODE_ORDER = Object.keys(NODE_WORDS) as NodeKind[];
const EDGE_ORDER = Object.keys(EDGE_WORDS) as EdgeKind[];
/** A hop goes on the less important of two crossing connectors. */
const WEIGHT: Record<EdgeKind, number> = { link: 3, flow: 3, return: 2, async: 1 };

/** The word the legend and the card use for a node kind: in a state machine a plain node is a state, in a cycle a phase. */
export function nodeWord(layout: Layout, kind: NodeKind): string {
  if (kind === "service" && layout === "states") return "state";
  if (kind === "service" && layout === "cycle") return "phase";
  return NODE_WORDS[kind];
}

/** In a state machine a connector is a transition, and the dashed kind marks an exception path rather than a reply. */
export function edgeWord(layout: Layout, kind: EdgeKind): string {
  if (layout === "states" && kind === "flow") return "transition";
  if (layout === "states" && kind === "return") return "exception";
  return EDGE_WORDS[kind];
}

/** "Solid = flow, dashed = reply" for the kinds in use, in the layout's own words. */
export function lineKey(layout: Layout, kinds: Set<EdgeKind>): string {
  const looks: Record<EdgeKind, string> = { flow: "solid", return: "dashed", async: "dotted with an open head", link: "blue" };
  const parts = (Object.keys(EDGE_WORDS) as EdgeKind[]).filter((k) => kinds.has(k)).map((k) => `${looks[k]} = ${edgeWord(layout, k)}`);
  if (parts.length < 2) return "";
  return `${parts[0][0].toUpperCase()}${parts.join(", ").slice(1)}.`;
}

interface Seg { a: Point; b: Point; i: number }

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function num(v: number): string {
  const r = Math.round(v * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
}

/**
 * Draws the figure; while it is wider than the column, narrows the column gutters and draws
 * again. Only the final drawing's warnings are reported.
 */
export function renderFigure(fig: FigureBlock & ReadingSpec, ctx: RenderContext): string {
  const { grid, type } = ctx.theme;
  const cols = fig.grid[0];
  let gap = grid.gap[0];
  for (;;) {
    const theme: Theme = gap === grid.gap[0] ? ctx.theme : { ...ctx.theme, grid: { ...grid, gap: [gap, grid.gap[1]] } };
    const warnings: Diagnostic[] = [];
    const out = draw(fig, { ...ctx, theme, warn: (d) => warnings.push(d) });
    const over = out.width - COLUMN;
    if (over > 0 && cols > 1 && gap > MIN_GAP) {
      // By the least even step, so every connector label that had room in a gutter keeps as much as it can.
      gap = Math.max(MIN_GAP, gap - 2 * Math.ceil(over / (cols - 1) / 2));
      continue;
    }
    for (const d of warnings) ctx.warn(d);
    if (over > 0) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", line: fig.line, message: `Figure "${fig.id}" is ${Math.ceil(out.width)}px wide even with narrow gutters, wider than the ${COLUMN}px column; use fewer columns or split it.` });
    }
    // A node spanning columns loses the narrowed part of each gutter it covers; normalize checked the full width.
    for (const n of fig.nodes) {
      if (gap === grid.gap[0] || n.span[0] < 2 || n.kind === "decision") continue;
      const need = textWidth(n.label, type.nodeLabel, "sans");
      if (need > cellRect(n.at, n.span, theme).w - 24 && need <= cellRect(n.at, n.span, ctx.theme).w - 24) {
        ctx.warn({ rule: "label-fit", severity: "warn", line: fig.line, message: `Label "${n.label}" is wider than its node once the gutters narrow to fit the column; shorten it or widen the node with span: [${n.span[0] + 1}, ${n.span[1]}].` });
      }
    }
    return out.html;
  }
}

function draw(fig: FigureBlock & ReadingSpec, ctx: RenderContext): { html: string; width: number } {
  const { theme } = ctx;
  const fid = fig.id;
  const rects = new Map(fig.nodes.map((n) => [n.id, cellRect(n.at, n.span, theme)]));
  const labels = new Map(fig.nodes.map((n) => [n.id, n.label]));
  const focal = new Set(fig.nodes.filter((n) => n.focal).map((n) => n.id));
  const routes = routeEdges(fig, theme);
  for (const r of routes) if (r.warn) ctx.warn({ rule: "route", severity: "warn", message: r.warn, line: fig.line });

  const nodeBoxes = [...rects.values()].map((r) => inflate(r, 2));
  const masks: Rect[] = [];
  const extent: Rect[] = [...rects.values()];
  const anchors: Record<string, Rect> = Object.fromEntries(rects);

  // Zones hug their cells; the label sits on the top border like a fieldset legend.
  const tagPx = theme.type.tag;
  const borders: Rect[] = [];
  const groupSvg = fig.groups.map((g) => {
    const r = groupRect(g.from, g.to, theme);
    extent.push(r);
    anchors[g.id] = r;
    borders.push({ ...r, h: 0 }, { ...r, y: r.y + r.h, h: 0 }, { ...r, w: 0 }, { ...r, x: r.x + r.w, w: 0 });
    // Group labels are section tags: as the author wrote them, 13/600 sans (base.css), never uppercased.
    const text = g.label;
    const lw = boldWidth(text, tagPx) + 2 * MASK_PAD;
    const mask: Rect = { x: r.x + 12, y: r.y - MASK_H / 2, w: lw, h: MASK_H };
    masks.push(mask);
    const box = `x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" rx="${num(theme.radius)}"`;
    return `<g class="x-group" data-id="${esc(g.id)}" data-kind="${g.kind}">` +
      `<rect class="x-group-box" ${box}/><rect class="x-group-hit" ${box}/>` +
      `<rect class="x-group-mask" x="${num(mask.x)}" y="${num(mask.y)}" width="${num(mask.w)}" height="${num(mask.h)}" rx="2"/>` +
      `<text class="x-group-label" x="${num(mask.x + MASK_PAD)}" y="${num(r.y + tagPx * 0.35)}">${esc(text)}</text></g>`;
  });

  // Level tags in the left margin for the stacked layouts: L1 at the top.
  const tags: string[] = [];
  if (fig.layout === "layers" || fig.layout === "tree") {
    const rows = [...new Set(fig.nodes.map((n) => n.at[1]))].sort((a, b) => a - b);
    const left = Math.min(...[...rects.values()].map((r) => r.x), ...routes.flatMap((r) => r.points.map((p) => p[0])));
    rows.forEach((row, i) => {
      const r = cellRect([0, row], [1, 1], theme);
      const label = `L${i + 1}`;
      const x = left - TAG_GAP;
      // 13/600 sans (figure.css), anchored at its right end.
      const w = boldWidth(label, tagPx);
      extent.push({ x: x - w, y: r.y, w, h: r.h });
      tags.push(`<text class="x-level-tag" x="${num(x)}" y="${num(r.y + r.h / 2 + tagPx * 0.35)}" text-anchor="end">${label}</text>`);
    });
  }

  const hops = hopsFor(fig.edges, routes.map((r) => r.points));
  const lines = routes.map((r) => segments(r.points).map((s) => segmentBox(s.a, s.b)));
  const boxes = new Map<string, Rect>();
  fig.edges.forEach((e, i) => {
    const pts = routes[i].points;
    if (pts.length < 2 || !e.label) return;
    const others = lines.filter((_, j) => j !== i).flat().concat(borders);
    const placed = placeLabel(e.label, pts, theme, nodeBoxes, masks, others);
    if (!placed) {
      ctx.warn({ rule: "edge-label", severity: "warn", line: fig.line, message: `Connector label "${e.label}" on ${e.from} -> ${e.to} has no room; shorten it or move the nodes apart.` });
      return;
    }
    if (placed.covers) {
      ctx.warn({ rule: "edge-label", severity: "warn", line: fig.line, message: `Connector label "${e.label}" on ${e.from} -> ${e.to} can only sit on top of another connector; move the nodes apart so both stay visible.` });
    }
    masks.push(placed.box);
    boxes.set(e.id, placed.box);
  });

  const tree = fig.layout === "tree";
  const edgeSvg: string[] = [];
  const labelSvg: string[] = [];
  fig.edges.forEach((e, i) => {
    const pts = routes[i].points;
    if (pts.length < 2) return;
    const d = pathD(pts, hops.get(i) ?? new Map());
    for (const s of segments(pts)) extent.push(segmentBox(s.a, s.b));
    const box = boxes.get(e.id);
    const anchor = box ?? midpoint(pts);
    anchors[e.id] = anchor;
    // Tree connectors only mean "contains", so they carry no arrowhead.
    const marker = tree ? "" : ` marker-end="url(#${esc(fid)}-${e.kind === "link" ? "arrow-link" : e.kind === "async" ? "arrow-open" : "arrow"})"`;
    edgeSvg.push(
      `<g class="x-edge" data-id="${esc(e.id)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-kind="${e.kind}">` +
      `<path class="x-edge-line" d="${d}"${marker}/><path class="x-edge-hit" d="${d}"/>` +
      `<rect class="x-anchor" x="${num(anchor.x)}" y="${num(anchor.y)}" width="${num(anchor.w)}" height="${num(anchor.h)}"/></g>`,
    );
    if (!box || !e.label) return;
    extent.push(box);
    labelSvg.push(
      `<g class="x-edge-label" data-for="${esc(e.id)}">` +
      `<rect class="x-edge-mask" x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" rx="2"/>` +
      `<text class="x-edge-text" x="${num(box.x + box.w / 2)}" y="${num(box.y + MASK_H / 2 + theme.type.edgeLabel * 0.35)}" text-anchor="middle">${esc(e.label)}</text></g>`,
    );
  });

  // State machines: a start dot points at each state nothing enters, and a final state gets an inner ring.
  const states = fig.layout === "states";
  const entered = new Set(fig.edges.filter((e) => e.from !== e.to).map((e) => e.to));
  const left = new Set(fig.edges.filter((e) => e.from !== e.to).map((e) => e.from));
  const starts: string[] = [];
  if (states) {
    for (const n of fig.nodes) {
      if (entered.has(n.id) || !left.has(n.id) || n.kind === "decision") continue;
      const r = rects.get(n.id)!;
      const cy = r.y + r.h / 2;
      const busy = routes.some((rt) => rt.points.some((p) => Math.abs(p[0] - r.x) < 0.5 && p[1] > r.y && p[1] < r.y + r.h));
      const [dot, tip]: [Point, Point] = busy ? [[r.x + r.w / 2, r.y - START_LEN], [r.x + r.w / 2, r.y]] : [[r.x - START_LEN, cy], [r.x, cy]];
      extent.push(inflate({ x: dot[0], y: dot[1], w: 0, h: 0 }, START_R));
      const from: Point = busy ? [dot[0], dot[1] + START_R] : [dot[0] + START_R, dot[1]];
      starts.push(`<g class="x-state-start" aria-hidden="true"><circle class="x-state-dot" cx="${num(dot[0])}" cy="${num(dot[1])}" r="${START_R}"/>` +
        `<path class="x-edge-line" d="M${num(from[0])},${num(from[1])} L${num(tip[0])},${num(tip[1])}" marker-end="url(#${esc(fid)}-arrow)"/></g>`);
    }
  }

  const nodeSvg = fig.nodes.map((n) => {
    const r = rects.get(n.id)!;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const aria = n.about ? `${n.label}. ${plain(n.about)}` : n.label;
    const final = states && entered.has(n.id) && !left.has(n.id) && n.kind !== "decision";
    return `<g class="x-node" data-id="${esc(n.id)}" data-kind="${n.kind}"${n.focal ? ' data-focal="true"' : ""}${final ? ' data-final="true"' : ""} tabindex="0" role="button" aria-label="${esc(aria)}">` +
      // A decision is a diamond inscribed in its cell; the router attaches its connectors at the vertices.
      (n.kind === "decision"
        ? `<polygon class="x-node-box" points="${num(cx)},${num(r.y)} ${num(r.x + r.w)},${num(cy)} ${num(cx)},${num(r.y + r.h)} ${num(r.x)},${num(cy)}"/>`
        : `<rect class="x-node-box" x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" rx="${num(theme.radius)}"/>`) +
      (final ? `<rect class="x-node-ring" x="${num(r.x + 3)}" y="${num(r.y + 3)}" width="${num(r.w - 6)}" height="${num(r.h - 6)}" rx="${num(Math.max(0, theme.radius - 3))}"/>` : "") +
      // label and sub are two 13px lines 20px apart, centred on the cell
      `<text class="x-node-label" x="${num(cx)}" y="${num(n.sub ? cy - 5 : cy + 4)}" text-anchor="middle">${esc(n.label)}</text>` +
      (n.sub ? `<text class="x-node-sub" x="${num(cx)}" y="${num(cy + 15)}" text-anchor="middle">${esc(n.sub)}</text>` : "") +
      `</g>`;
  });

  // The canvas is sized to what was drawn, so routes around the outside never collide with the legend.
  const box = inflate(union(extent), EDGE_PAD);
  const legend = fig.legend
    ? legendSvg({
      nodeKinds: new Set(fig.nodes.map((n) => n.kind)),
      // A tree line only means "contains"; its kind says nothing, so the legend leaves it out.
      edgeKinds: new Set(tree ? [] : fig.edges.map((e) => e.kind)),
      focal: fig.nodes.some((n) => n.focal),
    }, theme, box.x + EDGE_PAD, box.x + box.w - EDGE_PAD, box.y + box.h, fig.layout)
    : null;
  const W = box.w, H = box.h + (legend ? legend.height : 0);
  // A marker may sit on its target's corner but never on text or a line. Connectors are zero-width boxes,
  // so they count for the placer only once they have some thickness.
  const texts = fig.nodes.map((n) => {
    const r = rects.get(n.id)!;
    const w = Math.max(textWidth(n.label, theme.type.nodeLabel, "sans"), n.sub ? textWidth(n.sub, theme.type.nodeSub, "sans") : 0);
    return { x: r.x + (r.w - w) / 2, y: r.y + r.h / 2 - (n.sub ? 20 : 12), w, h: n.sub ? 40 : 20 };
  });
  const markers = notes(fig, anchors, { obstacles: [...masks, ...texts, ...lines.flat().map((l) => inflate(l, 3))], bounds: box });

  const named = (focal.size ? fig.nodes.filter((n) => n.focal) : fig.nodes.slice(0, 3)).map((n) => n.label);
  const title = fig.title ?? named.join(", ");
  const parts = fig.nodes.map((n) => n.label);
  let desc = `Diagram of ${parts.length} part${parts.length === 1 ? "" : "s"}: ${parts.join(", ")}.`;
  const conns = fig.edges.slice(0, 8).map((e) => `${labels.get(e.from)} to ${labels.get(e.to)}${e.label ? ` (${e.label})` : ""}`);
  if (conns.length) {
    const more = fig.edges.length - conns.length;
    desc += ` Connections: ${conns.join("; ")}${more > 0 ? `; and ${more} more` : ""}.`;
  }

  const svg = [
    `<svg class="x-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${num(box.x)} ${num(box.y)} ${num(W)} ${num(H)}" width="${num(W)}" height="${num(H)}" role="group" aria-label="${esc(title)}" aria-describedby="${fid}-desc">`,
    // the name is an aria-label, not a <title>: a root <title> shows as a native tooltip wherever the pointer rests
    `<desc id="${fid}-desc">${esc(desc)}</desc>`,
    defs(fid),
    ...groupSvg,
    ...tags,
    ...edgeSvg,
    ...starts,
    ...labelSvg,
    ...nodeSvg,
    legend?.svg ?? "",
    markers,
    `</svg>`,
  ].filter(Boolean).join("\n");

  const caption = fig.title ? `<figcaption class="x-figure-title">${esc(fig.title)}</figcaption>` : "";
  return { html: `<figure class="x-figure" data-figure="${fid}" data-layout="${fig.layout}">${caption}\n${svg}\n</figure>`, width: W };
}

function union(rs: Rect[]): Rect {
  const x1 = Math.min(...rs.map((r) => r.x)), y1 = Math.min(...rs.map((r) => r.y));
  const x2 = Math.max(...rs.map((r) => r.x + r.w)), y2 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Arrowheads: filled for calls and replies, blue for external calls, open for async. */
export function defs(fid: string): string {
  const marker = (id: string, cls: string, d: string) =>
    `<marker id="${esc(fid)}-${id}" viewBox="0 0 8 8" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path class="${cls}" d="${d}"/></marker>`;
  return `<defs>${marker("arrow", "x-arrowhead", "M0,0 L8,4 L0,8 z")}${marker("arrow-link", "x-arrowhead x-arrowhead-link", "M0,0 L8,4 L0,8 z")}` +
    `${marker("arrow-open", "x-arrowhead x-arrowhead-open", "M1,1 L7,4 L1,7")}</defs>`;
}

function segments(pts: Point[]): Seg[] {
  return pts.slice(1).map((b, i) => ({ a: pts[i], b, i }));
}

const dist = (a: Point, b: Point) => Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);

/** A zero-size box at the middle of the longest run: where the card points for an unlabelled connector. */
function midpoint(pts: Point[]): Rect {
  const s = segments(pts).sort((p, q) => dist(q.a, q.b) - dist(p.a, p.b))[0];
  return { x: (s.a[0] + s.b[0]) / 2, y: (s.a[1] + s.b[1]) / 2, w: 0, h: 0 };
}

/** Orthogonal polyline with rounded corners; `hops` maps a segment index to the positions along it that jump a crossing. */
export function pathD(pts: Point[], hops: Map<number, number[]>): string {
  const radius = (i: number) =>
    i <= 0 || i >= pts.length - 1 ? 0 : Math.min(CORNER, dist(pts[i - 1], pts[i]) / 2, dist(pts[i], pts[i + 1]) / 2);
  let d = `M${num(pts[0][0])},${num(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ux = Math.sign(b[0] - a[0]), uy = Math.sign(b[1] - a[1]);
    for (const v of hops.get(i) ?? []) {
      d += uy === 0
        ? ` L${num(v - HOP * ux)},${num(a[1])} A${HOP},${HOP} 0 0 ${ux > 0 ? 1 : 0} ${num(v + HOP * ux)},${num(a[1])}`
        : ` L${num(a[0])},${num(v - HOP * uy)} A${HOP},${HOP} 0 0 ${uy > 0 ? 1 : 0} ${num(a[0])},${num(v + HOP * uy)}`;
    }
    const r = radius(i + 1);
    d += ` L${num(b[0] - ux * r)},${num(b[1] - uy * r)}`;
    if (r > 0) {
      const c = pts[i + 2];
      d += ` Q${num(b[0])},${num(b[1])} ${num(b[0] + Math.sign(c[0] - b[0]) * r)},${num(b[1] + Math.sign(c[1] - b[1]) * r)}`;
    }
  }
  return d;
}

/**
 * Hops for every crossing, whichever connector was drawn first: the jump goes on the less important connector
 * (async, then reply), and on the horizontal run when both weigh the same. A crossing too close to a corner
 * for a jump there moves it to the other connector.
 */
function hopsFor(edges: EdgeSpec[], routes: Point[][]): Map<number, Map<number, number[]>> {
  const out = new Map<number, Map<number, number[]>>();
  const add = (edge: number, seg: number, v: number) => {
    const m = out.get(edge) ?? new Map<number, number[]>();
    m.set(seg, [...(m.get(seg) ?? []), v]);
    out.set(edge, m);
  };
  const room = (s: Seg, v: number) => {
    const k = s.a[1] === s.b[1] ? 0 : 1;
    return v > Math.min(s.a[k], s.b[k]) + HOP_MARGIN && v < Math.max(s.a[k], s.b[k]) - HOP_MARGIN;
  };
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      for (const s of segments(routes[i])) {
        for (const t of segments(routes[j])) {
          const hs = s.a[1] === s.b[1] && s.a[0] !== s.b[0], vs = s.a[0] === s.b[0] && s.a[1] !== s.b[1];
          const ht = t.a[1] === t.b[1] && t.a[0] !== t.b[0], vt = t.a[0] === t.b[0] && t.a[1] !== t.b[1];
          if (!((hs && vt) || (vs && ht))) continue;
          const [h, v] = hs ? [s, t] : [t, s];
          const x = v.a[0], y = h.a[1];
          if (!(x > Math.min(h.a[0], h.b[0]) + 1 && x < Math.max(h.a[0], h.b[0]) - 1 && y > Math.min(v.a[1], v.b[1]) + 1 && y < Math.max(v.a[1], v.b[1]) - 1)) continue;
          const wi = WEIGHT[edges[i].kind], wj = WEIGHT[edges[j].kind];
          const onI = wi !== wj ? wi < wj : hs;
          const first: [number, Seg, number] = onI ? [i, s, s === h ? x : y] : [j, t, t === h ? x : y];
          const second: [number, Seg, number] = onI ? [j, t, t === h ? x : y] : [i, s, s === h ? x : y];
          for (const [edge, seg, at] of [first, second]) if (room(seg, at)) { add(edge, seg.i, at); break; }
        }
      }
    }
  }
  for (const [edge, m] of out) {
    for (const [seg, vs] of m) {
      const s = segments(routes[edge])[seg];
      const k = s.a[1] === s.b[1] ? 0 : 1, dir = Math.sign(s.b[k] - s.a[k]);
      const kept: number[] = [];
      for (const v of vs.sort((p, q) => (p - q) * dir)) if (!kept.length || Math.abs(v - kept[kept.length - 1]) >= 2 * HOP + 2) kept.push(v);
      m.set(seg, kept);
    }
  }
  return out;
}

/**
 * Spots beside the connector's own runs: centred first, then slid toward either end. The first pass keeps
 * LABEL_CLEAR from every other connector and border, the second LABEL_NEAR; only then does a mask sit on a line
 * (`covers`), and the caller warns.
 */
function placeLabel(text: string, pts: Point[], theme: Theme, nodes: Rect[], masks: Rect[], lines: Rect[]): { box: Rect; covers: boolean } | null {
  // Sans at the edge-label size: the mask pads the label at rest and still covers it when it turns semibold on selection.
  const tw = textWidth(text, theme.type.edgeLabel, "sans");
  const w = Math.max(tw + 2 * MASK_PAD, boldWidth(text, theme.type.edgeLabel) + 2);
  const segs = segments(pts);
  const horizontal = segs.filter((s) => s.a[1] === s.b[1] && dist(s.a, s.b) >= tw + 16).sort((p, q) => dist(q.a, q.b) - dist(p.a, p.b));
  const vertical = segs.filter((s) => s.a[0] === s.b[0] && dist(s.a, s.b) >= MASK_H + 16).sort((p, q) => dist(q.a, q.b) - dist(p.a, p.b));
  const SLIDE = [0, -0.5, 0.5, -1, 1];
  const spots: Rect[] = [];
  for (const s of horizontal) {
    const cx = (s.a[0] + s.b[0]) / 2, y = s.a[1], room = Math.max(0, (dist(s.a, s.b) - w - 16) / 2);
    for (const f of SLIDE) {
      const x = cx + f * room - w / 2;
      spots.push({ x, y: y - LABEL_GAP - MASK_H, w, h: MASK_H }, { x, y: y + LABEL_GAP, w, h: MASK_H });
    }
  }
  for (const s of vertical) {
    const cy = (s.a[1] + s.b[1]) / 2, x = s.a[0], room = (dist(s.a, s.b) - MASK_H - 16) / 2;
    for (const f of SLIDE) {
      const y = cy + f * room - MASK_H / 2;
      spots.push({ x: x + LABEL_GAP, y, w, h: MASK_H }, { x: x - LABEL_GAP - w, y, w, h: MASK_H });
    }
  }
  const fits = (r: Rect) => !nodes.some((o) => overlaps(r, o)) && !masks.some((o) => overlaps(r, o));
  const clear = (d: number) => (r: Rect) => fits(r) && !lines.some((l) => overlaps(inflate(r, d), l));
  const box = spots.find(clear(LABEL_CLEAR)) ?? spots.find(clear(LABEL_NEAR));
  if (box) return { box, covers: false };
  const fallback = spots.find(fits);
  return fallback ? { box: fallback, covers: true } : null;
}

export interface LegendKinds { nodeKinds: Set<NodeKind>; edgeKinds: Set<EdgeKind>; focal: boolean }

/** Bottom strip listing only the kinds in use, in the words of the layout. Shared by every figure layout. */
export function legendSvg(used: LegendKinds, theme: Theme, left: number, right: number, top: number, layout: Layout = "flow"): { svg: string; height: number } {
  const px = theme.type.tag;
  const swatch = (x: number, cy: number) => `<rect class="x-legend-swatch" x="${num(x)}" y="${num(cy - 5)}" width="16" height="10" rx="2"/>`;
  const diamond = (x: number, cy: number) => `<polygon class="x-legend-swatch" points="${num(x + 8)},${num(cy - 6)} ${num(x + 16)},${num(cy)} ${num(x + 8)},${num(cy + 6)} ${num(x)},${num(cy)}"/>`;
  const line = (x: number, cy: number) => `<line class="x-legend-line" x1="${num(x)}" y1="${num(cy)}" x2="${num(x + 16)}" y2="${num(cy)}"/>`;
  const items: { kind: string; label: string; mark: (x: number, cy: number) => string }[] = [
    ...NODE_ORDER.filter((k) => used.nodeKinds.has(k)).map((k) => ({ kind: k, label: nodeWord(layout, k), mark: k === "decision" ? diamond : swatch })),
    ...(used.focal ? [{ kind: "focal", label: "focal", mark: swatch }] : []),
    ...EDGE_ORDER.filter((k) => used.edgeKinds.has(k)).map((k) => ({ kind: k, label: edgeWord(layout, k), mark: line })),
  ];
  const parts = [`<line class="x-legend-rule" x1="${num(left)}" y1="${num(top)}" x2="${num(right)}" y2="${num(top)}"/>`];
  let x = left, row = 0;
  for (const it of items) {
    const w = 22 + textWidth(it.label, px, "mono") * 1.08;
    if (x > left && x + w > right) { x = left; row++; }
    const cy = top + LEGEND_H / 2 + row * LEGEND_ROW;
    parts.push(`<g class="x-legend-item" data-kind="${it.kind}">${it.mark(x, cy)}<text class="x-legend-label" x="${num(x + 22)}" y="${num(cy + px * 0.35)}">${esc(it.label)}</text></g>`);
    x += w + 20;
  }
  return { svg: `<g class="x-legend">${parts.join("")}</g>`, height: LEGEND_H + row * LEGEND_ROW };
}

function plain(md: string): string {
  return md.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*`]/g, "");
}
