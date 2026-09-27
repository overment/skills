import { describe, expect, test } from "bun:test";
import { SpecError, type ColorTokens, type Diagnostic, type ElementInfo, type FigureBlock, type RenderContext, type Theme } from "../engine/types.ts";
import { figureModule, type Figure } from "../engine/figure/index.ts";
import { boldWidth, cellRect, figureSize, labelCapacity, overlaps, segmentBox, textWidth, type Rect } from "../engine/figure/grid.ts";
import { routeEdges } from "../engine/figure/route.ts";
import { COLUMN, renderFigure } from "../engine/figure/render.ts";

const tokens: ColorTokens = {
  bg: "#fff", surface: "#fff", "surface-2": "#eee", line: "#ccc", "line-strong": "#999", text: "#111",
  "text-dim": "#555", "text-faint": "#888", accent: "#06f", ok: "#080", warn: "#a60", danger: "#c00", info: "#06c", link: "#60c",
};

const theme: Theme = {
  name: "test",
  fonts: { sans: { family: "Sans", fallback: "sans-serif", faces: [] }, mono: { family: "Mono", fallback: "monospace", faces: [] } },
  colors: { light: tokens, dark: tokens },
  type: { caption: 12, ui: 13, body: 16, h2: 20, h1: 28, nodeLabel: 14, nodeSub: 11, edgeLabel: 11, tag: 10 },
  radius: 6,
  grid: { unit: 8, cell: [160, 64], gap: [104, 48], pad: 32 },
};

function context() {
  const warnings: Diagnostic[] = [];
  const ctx: RenderContext = {
    theme,
    doc: { front: {}, segments: [] },
    inline: (md) => md,
    warn: (d) => { warnings.push(d); },
  };
  return { ctx, warnings };
}

function figure(data: unknown, ctx = context().ctx): Figure {
  return figureModule.normalize({ type: "figure", info: [], body: "", data, line: 1 }, ctx) as Figure;
}

const elementsOf = (f: FigureBlock): Record<string, ElementInfo> => figureModule.model!(f).elements!;
type Pt = [number, number];
const segs = (p: Pt[]) => p.slice(1).map((b, i) => [p[i], b] as const);
/** Perpendicular runs of two routes that cross strictly inside both. */
function crossCount(a: Pt[], b: Pt[]): number {
  let n = 0;
  for (const [p, q] of segs(a)) for (const [r, t] of segs(b)) {
    const [h, v] = p[1] === q[1] && r[0] === t[0] ? [[p, q], [r, t]] : r[1] === t[1] && p[0] === q[0] ? [[r, t], [p, q]] : [null, null];
    if (!h || !v) continue;
    const x = v[0][0], y = h[0][1];
    if (x > Math.min(h[0][0], h[1][0]) && x < Math.max(h[0][0], h[1][0]) && y > Math.min(v[0][1], v[1][1]) && y < Math.max(v[0][1], v[1][1])) n++;
  }
  return n;
}
const inflateBy = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
const rectsOf = (svg: string, cls: string): Rect[] =>
  [...svg.matchAll(new RegExp(`<rect class="${cls}" x="([-\\d.]+)" y="([-\\d.]+)" width="([-\\d.]+)" height="([-\\d.]+)"`, "g"))]
    .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
/** The drawn path of edge `id` ("a->b"; attributes carry it escaped). */
function pathOf(svg: string, id: string): string {
  const at = svg.indexOf(`data-id="${id.replace(">", "&gt;")}"`);
  return /<path class="x-edge-line" d="([^"]+)"/.exec(svg.slice(at))![1];
}

/** The store system map: zones, a focal gateway and the orders -> payments call that used to cross "writes". */
const storeMap = {
  id: "store-map", layout: "zones", grid: [5, 3],
  nodes: {
    shopper: { label: "Shopper", at: [0, 1], kind: "actor" }, gateway: { label: "API gateway", at: [1, 1], focal: true },
    catalog: { label: "Catalog", at: [2, 0] }, cart: { label: "Cart", at: [2, 1] }, orders: { label: "Orders", at: [2, 2] },
    products: { label: "Product DB", at: [3, 0], kind: "store" }, orderdb: { label: "Order DB", at: [3, 2], kind: "store" },
    payments: { label: "Payment provider", at: [4, 2], kind: "external" },
  },
  edges: ["shopper -> gateway: requests", "gateway -> catalog", "gateway -> cart", "gateway -> orders", "catalog -> products: reads", "cart -> orders: checks out", "orders -> orderdb: writes", "orders => payments: charges"],
  groups: { public: { label: "Public", from: [0, 1], to: [1, 1] }, private: { label: "Private network", from: [2, 0], to: [3, 2], kind: "trust" } },
};

const appTree = {
  id: "app-tree", layout: "tree", grid: [5, 3],
  nodes: {
    app: { label: "App", at: [2, 0] }, web: { label: "Web client", at: [0, 1] }, api: { label: "API", at: [2, 1] }, workers: { label: "Workers", at: [4, 1] },
    pages: { label: "Pages", at: [0, 2] }, auth: { label: "Auth", at: [2, 2] }, billing: { label: "Billing", at: [3, 2] }, emails: { label: "Emails", at: [4, 2] },
  },
  edges: ["app -> web", "app -> api", "app -> workers", "web -> pages", "api -> auth", "api -> billing", "workers -> emails"],
};

function specError(fn: () => unknown): SpecError {
  try { fn(); } catch (e) { if (e instanceof SpecError) return e; throw e; }
  throw new Error("expected a SpecError");
}

const row3 = { a: { label: "A", at: [0, 0] }, b: { label: "B", at: [1, 0] }, c: { label: "C", at: [2, 0] } };

describe("grid", () => {
  test("cell geometry and text estimates", () => {
    expect(cellRect([1, 1], [2, 1], theme)).toEqual({ x: 296, y: 144, w: 424, h: 64 });
    expect(figureSize([3, 2], theme)).toEqual({ w: 752, h: 240 });
    expect(textWidth("abc", 10, "mono")).toBeCloseTo(18);
    expect(labelCapacity(1, theme)).toBe(Math.floor(136 / 8.4));
  });
});

describe("normalize", () => {
  test("reads string, one-key map and object edge forms", () => {
    const data = Bun.YAML.parse(`
id: t
nodes:
  a: { label: A, at: [0, 0] }
  b: { label: B, at: [1, 0] }
  c: { label: C, at: [2, 0] }
edges:
  - a -> b
  - b --> a: rejects
  - { from: a, to: c, label: calls, kind: link }
  - "b ~> c: later"
  - a => c
`) as { edges: unknown[] };
    expect(data.edges[1]).toEqual({ "b --> a": "rejects" });
    const f = figure(data);
    expect(f.edges.map((e) => [e.id, e.from, e.to, e.kind, e.label ?? null])).toEqual([
      ["a->b", "a", "b", "flow", null],
      ["b->a", "b", "a", "return", "rejects"],
      ["a->c", "a", "c", "link", "calls"],
      ["b->c", "b", "c", "async", "later"],
      ["a->c#2", "a", "c", "link", null],
    ]);
  });

  test("repeated edges get #2 and #3", () => {
    const f = figure({ id: "t", nodes: row3, edges: ["a -> b", "a -> b: again", { from: "a", to: "b" }] });
    expect(f.edges.map((e) => e.id)).toEqual(["a->b", "a->b#2", "a->b#3"]);
  });

  test("overlapping nodes raise grid-collision naming both", () => {
    const err = specError(() => figure({ id: "t", nodes: { a: { label: "A", at: [0, 0] }, b: { label: "B", at: [0, 0] } } }));
    expect(err.rule).toBe("grid-collision");
    expect(err.message).toContain('"a"');
    expect(err.message).toContain('"b"');
  });

  test("nodes outside an explicit grid raise grid-bounds", () => {
    const err = specError(() => figure({ id: "t", grid: [2, 2], nodes: { a: { label: "A", at: [3, 0] } } }));
    expect(err.rule).toBe("grid-bounds");
  });

  test("unknown node refs raise ref-exists", () => {
    expect(specError(() => figure({ id: "t", nodes: row3, edges: ["a -> z"] })).rule).toBe("ref-exists");
  });

  test("unknown top-level keys list the allowed ones", () => {
    expect(specError(() => figure({ id: "t", nodes: row3, color: "red" })).message).toContain("Allowed: id, layout");
  });
});

describe("route", () => {
  for (const edges of [["a -> c"], ["a -> b", "b -> c", "a -> c"]]) {
    test(`skips the middle node (${edges.join(", ")})`, () => {
      const f = figure({
        id: "t", grid: [3, 3],
        nodes: { a: { label: "A", at: [0, 1] }, b: { label: "B", at: [1, 1] }, c: { label: "C", at: [2, 1] } },
        edges,
      });
      const route = routeEdges(f, theme).find((r) => r.id === "a->c")!;
      const middle = cellRect([1, 1], [1, 1], theme);
      expect(route.warn).toBeUndefined();
      for (let i = 0; i < route.points.length - 1; i++) {
        expect(overlaps(segmentBox(route.points[i], route.points[i + 1]), middle)).toBe(false);
      }
    });
  }

  test("fan-out attach points are distinct and at least 12px apart", () => {
    const f = figure({
      id: "t",
      nodes: {
        s: { label: "S", at: [0, 1] },
        t1: { label: "T1", at: [1, 0] }, t2: { label: "T2", at: [1, 1] }, t3: { label: "T3", at: [1, 2] },
      },
      edges: ["s -> t1", "s -> t2", "s -> t3"],
    });
    const ys = routeEdges(f, theme).map((r) => r.points[0][1]).sort((a, b) => a - b);
    expect(new Set(ys).size).toBe(3);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(12);
  });
});

const sampleFigure = {
    id: "sample",
    grid: [3, 2],
    nodes: {
      app: { label: "Web app", at: [0, 0], about: "What the user sees." },
      gw: { label: "Gateway", sub: ":443", at: [1, 0], focal: true },
      orders: { label: "Orders", at: [2, 0] },
      queue: { label: "Queue", at: [0, 1] },
      auth: { label: "Auth", at: [1, 1] },
      db: { label: "Orders DB", at: [2, 1], kind: "store" },
    },
    edges: [
      { "app -> gw": "sends token" },
      { "gw -> orders": "forwards" },
      { "gw -> auth": "verifies" },
      { "orders -> db": "writes" },
      { "orders ~> queue": "emits" },
      { "auth --> gw": "ok" },
    ],
};

describe("render", () => {
  const sample = sampleFigure;

  test("routes are orthogonal and clean for the sample", () => {
    const { ctx, warnings } = context();
    const f = figure(sample, ctx);
    for (const r of routeEdges(f, theme)) {
      expect(r.warn).toBeUndefined();
      for (let i = 0; i < r.points.length - 1; i++) {
        const [a, b] = [r.points[i], r.points[i + 1]];
        expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
      }
    }
    renderFigure(f, ctx);
    expect(warnings.filter((w) => w.rule === "route" || w.rule === "edge-label")).toEqual([]);
  });

  test("label masks never overlap node boxes", () => {
    const { ctx } = context();
    const svg = renderFigure(figure(sample, ctx), ctx);
    const rects = (cls: string): Rect[] =>
      [...svg.matchAll(new RegExp(`<rect class="${cls}" x="([-\\d.]+)" y="([-\\d.]+)" width="([-\\d.]+)" height="([-\\d.]+)"`, "g"))]
        .map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
    const masks = rects("x-edge-mask");
    const nodes = rects("x-node-box");
    expect(nodes.length).toBe(6);
    expect(masks.length).toBe(6);
    for (const m of masks) for (const n of nodes) expect(overlaps(m, n)).toBe(false);
  });

  test("rendering is deterministic", () => {
    const { ctx } = context();
    expect(renderFigure(figure(sample, ctx), ctx)).toBe(renderFigure(figure(sample, ctx), ctx));
  });

  test("svg is named by aria-label, never a root <title> (a native tooltip everywhere)", () => {
    const { ctx } = context();
    const svg = renderFigure(figure(sample, ctx), ctx);
    expect(svg).toMatch(/<svg [^>]*role="group"/);
    expect(svg).toMatch(/<svg [^>]*aria-label="[^"]+" aria-describedby="sample-desc">/);
    expect(svg).not.toContain("<title");
    expect(svg).toContain('<desc id="sample-desc">Diagram of 6 parts:');
  });
});

describe("router: review findings", () => {
  test("decision connectors leave from the diamond's vertices; off-row branches use the top and bottom vertex", () => {
    const { ctx, warnings } = context();
    const f = figure({
      id: "d", layout: "states", grid: [3, 3],
      nodes: { start: { label: "In", at: [0, 1] }, ok: { label: "Paid?", at: [1, 1], kind: "decision" }, yes: { label: "Ship", at: [2, 0] }, no: { label: "Retry", at: [2, 2] }, same: { label: "Hold", at: [2, 1] } },
      edges: ["start -> ok", "ok -> yes: yes", "ok -> no: no", "ok -> same: later"],
    }, ctx);
    const r = cellRect([1, 1], [1, 1], theme), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const route = (id: string) => routeEdges(f, theme).find((x) => x.id === id)!;
    expect(route("ok->yes").points[0]).toEqual([cx, r.y]);
    expect(route("ok->no").points[0]).toEqual([cx, r.y + r.h]);
    expect(route("ok->same").points[0]).toEqual([r.x + r.w, cy]);
    expect(route("start->ok").points.at(-1)).toEqual([r.x, cy]);
    renderFigure(f, ctx);
    expect(warnings.filter((w) => w.rule === "route")).toEqual([]);
  });

  test("a decision's label is measured against the diamond, and a sub line warns", () => {
    const { ctx, warnings } = context();
    figure({ id: "d", nodes: { q: { label: "Payment accepted?", sub: "card", at: [0, 0], kind: "decision" } } }, ctx);
    expect(warnings.map((w) => w.rule)).toEqual(["label-fit", "label-fit"]);
  });

  test("the legend draws a decision as a diamond", () => {
    const { ctx } = context();
    const svg = renderFigure(figure({ id: "d", nodes: { a: { label: "A", at: [0, 0] }, q: { label: "Ok?", at: [1, 0], kind: "decision" } }, edges: ["a -> q"] }, ctx), ctx);
    expect(svg).toMatch(/<g class="x-legend-item" data-kind="decision"><polygon class="x-legend-swatch"/);
  });

  test("slots follow the direction a route heads, and no two routes cross in the system map", () => {
    const { ctx, warnings } = context();
    const f = figure(storeMap, ctx);
    const routes = routeEdges(f, theme);
    for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) expect(crossCount(routes[i].points, routes[j].points)).toBe(0);
    const pay = routes.find((r) => r.id === "orders->payments")!.points, db = routes.find((r) => r.id === "orders->orderdb")!.points;
    // The route that detours up leaves from the upper slot; it stays inside the grid instead of the outer ring.
    expect(pay[0][1]).toBeLessThan(db[0][1]);
    expect(Math.max(...pay.map((p) => p[1]))).toBeLessThanOrEqual(cellRect([0, 2], [1, 1], theme).y + 64);
    renderFigure(f, ctx);
    expect(warnings.filter((w) => w.rule === "route" || w.rule === "edge-label")).toEqual([]);
  });

  test("routes share a gutter lane unless their runs overlap", () => {
    const f = figure(appTree);
    const routes = routeEdges(f, theme);
    const busY = (id: string) => routes.find((r) => r.id === id)!.points[1][1];
    expect(busY("app->web")).toBe(busY("app->workers"));
    const overlapping = figure({
      id: "o", grid: [2, 3],
      nodes: { a: { label: "A", at: [0, 0] }, b: { label: "B", at: [0, 1] }, x: { label: "X", at: [1, 1] }, y: { label: "Y", at: [1, 2] } },
      edges: ["a -> y", "b -> x"],
    });
    const xs = routeEdges(overlapping, theme).map((r) => r.points.filter((p) => p[0] > 200 && p[0] < 300).map((p) => p[0]));
    if (xs[0].length && xs[1].length) expect(Math.abs(xs[0][0] - xs[1][0])).toBeGreaterThanOrEqual(12);
  });

  test("a tree hangs children off one bus per parent, without arrowheads", () => {
    const { ctx } = context();
    const f = figure(appTree, ctx);
    const app = cellRect([2, 0], [1, 1], theme), web = cellRect([0, 1], [1, 1], theme);
    const route = routeEdges(f, theme).find((r) => r.id === "app->web")!.points;
    expect(route[0]).toEqual([app.x + app.w / 2, app.y + app.h]);
    expect(route.at(-1)).toEqual([web.x + web.w / 2, web.y]);
    const svg = renderFigure(f, ctx);
    expect(svg).not.toContain("marker-end");
    expect(svg).toContain('<text class="x-level-tag"');
    expect(svg).not.toMatch(/x-legend-item" data-kind="flow"/);
  });

  test("through-routes keep out of a node's reserved span even when its drawn box is shorter", () => {
    const f = figure({
      id: "s", grid: [3, 2],
      nodes: { x: { label: "X", at: [0, 0], span: [1, 2] }, c: { label: "C", at: [1, 0], span: [1, 2] }, y: { label: "Y", at: [2, 0], span: [1, 2] } },
      edges: ["y -> x"],
    });
    const span = cellRect([1, 0], [1, 2], theme);
    const boxes = new Map([["c", { ...span, h: 40 }]]);
    const route = routeEdges(f, theme, boxes).find((r) => r.id === "y->x")!;
    for (let i = 0; i < route.points.length - 1; i++) expect(overlaps(segmentBox(route.points[i], route.points[i + 1]), span)).toBe(false);
  });
});

describe("render: a line and its label belong to what they touch", () => {
  const threads = {
    id: "t", grid: [4, 3],
    nodes: {
      user: { label: "User", at: [0, 1], kind: "actor" }, main: { label: "Main thread", at: [1, 1], focal: true },
      auth: { label: "Auth audit", at: [2, 0] }, bill: { label: "Billing audit", at: [2, 1] }, srch: { label: "Search audit", at: [2, 2] },
      answer: { label: "Report", at: [3, 1] },
    },
    groups: { own: { label: "Separate threads", from: [2, 0], to: [2, 2] } },
    edges: ["user -> main", { "main -> auth": "spawn_subagent" }, "main -> bill", "main -> srch", { "auth --> main": "result" }, "main -> answer"],
  };
  test("a connector through a zone neither end is in warns, naming the zone", () => {
    const { ctx, warnings } = context();
    renderFigure(figure(threads, ctx), ctx);
    expect(warnings.some((w) => w.rule === "route" && w.message.includes('main -> answer runs through the "Separate threads" zone'))).toBe(true);
  });
  test("a label as close to another line as to its own warns; a reply beside its call does not", () => {
    const { ctx, warnings } = context();
    renderFigure(figure(threads, ctx), ctx);
    expect(warnings.some((w) => w.rule === "edge-label" && w.message.includes('"spawn_subagent"') && w.message.includes("wrong line"))).toBe(true);
    const pair = context();
    renderFigure(figure(sampleFigure, pair.ctx), pair.ctx);
    expect(pair.warnings.filter((w) => w.message.includes("wrong line"))).toEqual([]);
  });
});

describe("render: review findings", () => {
  const crossing = (edges: string[]) => ({
    id: "x", grid: [3, 3],
    nodes: { a: { label: "A", at: [0, 1] }, c: { label: "C", at: [2, 1] }, b: { label: "B", at: [1, 0] }, d: { label: "D", at: [1, 2] } },
    edges,
  });

  test("the hop goes on the less important connector, whichever is drawn first", () => {
    for (const edges of [["b ~> d", "a -> c"], ["a -> c", "b ~> d"]]) {
      const { ctx } = context();
      const svg = renderFigure(figure(crossing(edges)), ctx);
      expect(pathOf(svg, "b->d")).toContain(" A4,4 ");
      expect(pathOf(svg, "a->c")).not.toContain(" A");
    }
  });

  test("between equals the hop goes on the horizontal run, even when the vertical is drawn later", () => {
    const { ctx } = context();
    const svg = renderFigure(figure(crossing(["a -> c", "b -> d"])), ctx);
    expect(pathOf(svg, "a->c")).toContain(" A4,4 ");
    expect(pathOf(svg, "b->d")).not.toContain(" A");
  });

  test("label masks keep clear of other connectors and zone borders", () => {
    const { ctx } = context();
    const svg = renderFigure(figure(storeMap, ctx), ctx);
    const lines = [...svg.matchAll(/<path class="x-edge-line" d="([^"]+)"/g)].map((m) => m[1]);
    const points = lines.map((d) => [...d.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => [+m[1], +m[2]] as Pt));
    const masks = rectsOf(svg, "x-edge-mask");
    expect(masks.length).toBe(5);
    for (const m of masks) {
      const own = points.filter((p) => segs(p).some(([a, b]) => overlaps(inflateBy(m, 9), segmentBox(a, b))));
      // A mask sits beside its own line (8px) and touches nothing else.
      expect(own.length).toBeLessThanOrEqual(1);
    }
  });

  test("a label that can only cover another connector warns", () => {
    const { ctx, warnings } = context();
    renderFigure(figure(crossing(["a -> c: carries a much longer label than fits", "b ~> d"]), ctx), ctx);
    expect(warnings.some((w) => w.rule === "edge-label" && w.message.includes("on top of another connector"))).toBe(true);
  });

  test("edges carry no invented labels, and point the card at their label or midpoint", () => {
    const { ctx } = context();
    const f = figure(sampleFigure, ctx);
    const svg = renderFigure(f, ctx);
    expect(svg.match(/class="x-edge-label"/g)!.length).toBe(6);
    expect(elementsOf(f)["app->gw"]).toMatchObject({ label: "sends token", kind: "flow" });
    const bare = figure({ id: "b", nodes: row3, edges: ["a -> b"] });
    expect(elementsOf(bare)["a->b"]!.label).toBe("");
    expect(renderFigure(bare, ctx)).not.toContain("x-edge-label");
    expect(renderFigure(bare, ctx)).toMatch(/data-id="a-&gt;b"[^]*?<rect class="x-anchor" x="[\d.]+" y="[\d.]+" width="0" height="0"\/>/);
    expect(svg).toMatch(/data-id="app-&gt;gw"[^]*?<rect class="x-anchor" x="[\d.]+" y="[\d.]+" width="[1-9]/);
  });

  test("state machines get a start dot, final rings and their own legend words", () => {
    const { ctx } = context();
    const f = figure({
      id: "s", layout: "states", grid: [3, 2],
      nodes: { cart: { label: "Cart", at: [0, 0] }, paid: { label: "Paid", at: [1, 0] }, done: { label: "Done", at: [2, 0] }, gone: { label: "Gone", at: [1, 1] } },
      edges: ["cart -> paid: pays", "paid -> done: ships", "cart --> gone: drops"],
    }, ctx);
    const svg = renderFigure(f, ctx);
    expect(svg.match(/class="x-state-start"/g)!.length).toBe(1);
    expect(svg).toMatch(/data-id="done"[^>]*data-final="true"/);
    expect(svg).toMatch(/data-id="gone"[^>]*data-final="true"/);
    expect(svg).not.toMatch(/data-id="paid"[^>]*data-final/);
    expect(svg).toContain(">transition</text>");
    expect(svg).toContain(">exception</text>");
    expect(elementsOf(f)["cart->gone"]).toMatchObject({ kind: "exception" });
  });

  test("note markers sit on their targets; a note on nothing warns", () => {
    const { ctx, warnings } = context();
    const svg = renderFigure(figure({ ...sampleFigure, notes: [{ on: "gw", text: "The gate." }, { on: "app->gw", text: "The call." }, { on: "nope", text: "Lost." }] }, ctx), ctx);
    expect(warnings.map((w) => w.rule)).toEqual(["ref-exists"]);
    expect(svg).toContain('<g class="x-notes" data-for="sample" aria-hidden="true"><g class="x-note-marker" data-note="1" data-for="gw">');
    expect(svg).toContain('data-note="2" data-for="app-&gt;gw"');
    expect(svg.indexOf("x-notes")).toBeGreaterThan(svg.indexOf("x-legend"));
  });
});

describe("model: relations per layout", () => {
  test("tree: a node lights its ancestors and its whole subtree", () => {
    const els = elementsOf(figure(appTree));
    expect(new Set(els.api!.related)).toEqual(new Set(["app", "auth", "billing", "app->api", "api->auth", "api->billing"]));
    expect(els.api).toMatchObject({ crumb: ["app"], pos: "level 2 of 3", links: [{ rel: "Parent", ids: ["app"] }, { rel: "Children", ids: ["auth", "billing"] }] });
    expect(els.app!.facts).toEqual([
      { k: "Parts below it", v: "7" },
      { k: "Web client", v: "1 part below", ref: "web" },
      { k: "API", v: "2 parts below", ref: "api" },
      { k: "Workers", v: "1 part below", ref: "workers" },
    ]);
    expect(els.api!.context).toBeUndefined();
  });

  test("zones: a zone lights the connectors that cross its border and names the parts on each side", () => {
    const els = elementsOf(figure(storeMap));
    const crossing = ["gateway->catalog", "gateway->cart", "gateway->orders", "orders->payments"];
    for (const id of crossing) expect(els.private!.related).toContain(id);
    expect(els.private!.related).not.toContain("cart->orders");
    expect(els.private!.context).toEqual(expect.arrayContaining(["catalog->products", "cart->orders", "orders->orderdb"]));
    expect(els.private!.links).toEqual([
      { rel: "Crossing in from API gateway", ids: ["catalog", "cart", "orders"] },
      { rel: "Crossing out from Orders", ids: ["payments"] },
    ]);
    expect(els.private!.facts).toEqual([{ k: "Parts inside", v: "5" }, { k: "Connectors across its border", v: "3 in, 1 out" }]);
    expect(els.private!.kind).toBe("trust boundary");
    expect(els.orders).toMatchObject({ crumb: ["private"], kind: "service" });
    expect(els.orders!.context).toContain("private");
    expect(els.orders!.facts).toContainEqual({ k: "Crosses the Private network border", v: "2 connectors" });
  });

  test("flow: relations in reading order in the author's words, what comes in first", () => {
    const els = elementsOf(figure({
      id: "c", grid: [5, 2],
      nodes: { shop: { label: "Storefront", at: [1, 0] }, checkout: { label: "Checkout", at: [2, 0] }, pay: { label: "Payment provider", at: [4, 0], kind: "external" }, db: { label: "Orders DB", at: [2, 1], kind: "store" }, mail: { label: "Receipts", at: [3, 1] } },
      edges: ["shop -> checkout", "checkout => pay: charges card", "pay --> checkout: confirms", "checkout -> db: saves order", "checkout ~> mail: queues receipt"],
    }));
    expect(els.checkout!.links).toEqual([
      { rel: "From", ids: ["shop"] }, { rel: "confirms ←", ids: ["pay"] },
      { rel: "charges card →", ids: ["pay"] }, { rel: "saves order →", ids: ["db"] }, { rel: "queues receipt →", ids: ["mail"] },
    ]);
    expect(els.shop!.facts).toEqual([{ k: "Leads on to", v: "4 parts" }]);
    expect(els.shop!.context).toEqual(expect.arrayContaining(["pay", "db", "mail"]));
    expect(els["checkout->pay"]).toMatchObject({ kind: "link", links: [{ rel: "Paired with", ids: ["pay->checkout"] }] });
    expect(els.pay!.kind).toBe("external");
  });

  test("flow: a node on a loop names the loop and counts only what lies outside it; a reply is not a loop", () => {
    const els = elementsOf(figure({
      id: "l", grid: [5, 2],
      nodes: { user: { label: "User", at: [0, 0] }, ctx: { label: "Conversation", at: [1, 0] }, model: { label: "Model", at: [2, 0] }, check: { label: "Tool?", at: [3, 0], kind: "decision" }, done: { label: "Answer", at: [4, 0] }, tools: { label: "Tools", at: [3, 1] } },
      edges: ["user -> ctx", "ctx -> model", "model -> check", "check -> tools", "check -> done", "tools -> ctx", "done --> user: shows"],
    }));
    expect(els.model!.facts).toEqual([{ k: "In a loop with", v: "3 parts" }, { k: "Leads out to", v: "2 parts" }, { k: "Comes in from", v: "2 parts" }]);
    expect(els.model!.links).toContainEqual({ rel: "In a loop with", ids: expect.arrayContaining(["ctx", "check", "tools"]) });
    // done --> user closes a round trip through a reply, which does not make User part of a loop
    expect(els.user!.facts).toEqual([{ k: "Leads on to", v: "5 parts" }, { k: "Reached from", v: "5 parts" }]);
  });

  test("hub: satellites keep their peers at rest instead of lighting them", () => {
    const els = elementsOf(figure({
      id: "h", layout: "hub", grid: [3, 3],
      nodes: { mem: { label: "Memory", at: [1, 1], kind: "store" }, a: { label: "A", at: [0, 0] }, b: { label: "B", at: [2, 0] }, c: { label: "C", at: [0, 2] } },
      edges: ["a -> mem: writes", "mem -> b: feeds", "c -> mem: writes"],
    }));
    expect(els.mem).toMatchObject({ pos: "hub", facts: [{ k: "Connected", v: "3 of 3 parts" }], links: [{ rel: "writes ←", ids: ["a", "c"] }, { rel: "feeds →", ids: ["b"] }] });
    expect(els.a!.context).toEqual(expect.arrayContaining(["b", "c"]));
    expect(els.a!.links).toEqual([{ rel: "writes →", ids: ["mem"] }]);
    expect(els.a!.facts).toContainEqual({ k: "Shares Memory with", v: "2 other parts" });
  });

  test("layers: tiers count from the top and relate by position", () => {
    const els = elementsOf(figure({
      id: "l", layout: "layers", grid: [4, 3],
      nodes: { web: { label: "Browser", at: [0, 0], span: [3, 1] }, cache: { label: "Cache", at: [0, 1], span: [3, 1] }, app: { label: "App", at: [0, 2], span: [3, 1] }, img: { label: "Images", at: [3, 1], kind: "store" } },
      edges: ["web -> cache: requests", "cache -> app: misses", "cache -> img: fetches"],
    }));
    expect(els.cache).toMatchObject({
      kind: "tier", pos: "2 of 3",
      links: [{ rel: "Above", ids: ["web"] }, { rel: "Below", ids: ["app"] }, { rel: "Side services", ids: ["img"] }],
      facts: [{ k: "Reached through", v: "Browser" }],
    });
    expect(els.cache!.context).toEqual(expect.arrayContaining(["web", "web->cache"]));
    expect(els.img!.pos).toBe("beside tier 2");
  });

  test("cycle: phases are numbered in the order of the loop", () => {
    const els = elementsOf(figure({
      id: "c", layout: "cycle", grid: [2, 2],
      nodes: { ship: { label: "Ship", at: [0, 0] }, measure: { label: "Measure", at: [1, 0] }, learn: { label: "Learn", at: [1, 1] }, decide: { label: "Decide", at: [0, 1] } },
      edges: ["ship -> measure", "measure -> learn: spots trends", "learn -> decide", "decide -> ship"],
    }));
    expect(els.learn).toMatchObject({ kind: "phase", pos: "3 / 4", links: [{ rel: "spots trends ←", ids: ["measure"] }, { rel: "To", ids: ["decide"] }] });
    expect(els.learn!.facts).toBeUndefined();
  });

  test("states: what is still reachable stays at rest, and what no longer is gets named", () => {
    const els = elementsOf(figure({
      id: "s", layout: "states", grid: [4, 2],
      nodes: { cart: { label: "Cart", at: [0, 0] }, placed: { label: "Placed", at: [1, 0] }, paid: { label: "Paid", at: [2, 0] }, cancel: { label: "Cancelled", at: [2, 1] } },
      edges: ["cart -> placed: checks out", "placed -> paid: pays", "placed --> cancel: cancels"],
    }));
    expect(els.paid).toMatchObject({ kind: "state", pos: "final" });
    expect(els.cart!.pos).toBe("start");
    expect(new Set(els.placed!.context)).toEqual(new Set(["paid", "cancel"]));
    expect(els.placed!.facts).toEqual([{ k: "Can still reach", v: "2 states" }, { k: "Can no longer reach", v: "Cart" }]);
    expect(els["placed->paid"]).toMatchObject({ kind: "transition", say: "Placed to Paid: pays, transition" });
  });

  test("reading line and data table", () => {
    const f = figure(storeMap);
    expect(figureModule.reading!(f)).toBe(
      "Shaded areas are zones and a dashed border is a trust boundary; the arrows that cross a border are the only ways in and out. " +
      "Solid = flow, blue = external call. Accent marks API gateway, the part this page is about.",
    );
    expect(figureModule.table!(f).rows[7]).toEqual(["Orders", "Payment provider", "charges", "external call"]);
  });
});

describe("column fit", () => {
  const svgWidth = (svg: string) => +/<svg [^>]*width="([\d.]+)"/.exec(svg)![1];
  const row5 = {
    id: "row5", grid: [5, 1],
    nodes: Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`n${i}`, { label: `Step ${i + 1}`, at: [i, 0] }])),
    edges: ["n0 -> n1: sends", "n1 -> n2", "n2 -> n3", "n3 -> n4"],
  };

  test("five-column figures narrow their gutters to fit the column, with zones, level tags and labels intact", () => {
    for (const data of [row5, storeMap, appTree]) {
      const { ctx, warnings } = context();
      const svg = renderFigure(figure(data, ctx), ctx);
      expect(svgWidth(svg)).toBeLessThanOrEqual(COLUMN);
      expect(warnings.filter((w) => w.rule === "edge-label" || w.rule === "budget-nodes")).toEqual([]);
    }
  });

  test("a figure that already fits keeps the theme's gutters", () => {
    const { ctx } = context();
    const svg = renderFigure(figure({ id: "r3", nodes: row3, edges: ["a -> b", "b -> c"] }, ctx), ctx);
    const c = cellRect([2, 0], [1, 1], theme);
    expect(svg).toContain(`<rect class="x-node-box" x="${c.x}" y="${c.y}"`);
  });

  test("a figure too wide even with the narrowest gutters warns once", () => {
    const { ctx, warnings } = context();
    const nodes = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [`n${i}`, { label: `S${i}`, at: [i, 0] }]));
    renderFigure(figure({ id: "wide", grid: [7, 1], nodes, edges: [] }, ctx), ctx);
    expect(warnings.filter((w) => w.rule === "budget-nodes" && w.message.includes("column"))).toHaveLength(1);
  });

  test("level tags are measured as semibold sans", () => {
    const { ctx } = context();
    const svg = renderFigure(figure(appTree, ctx), ctx);
    const tagX = +/<text class="x-level-tag" x="([-\d.]+)"/.exec(svg)![1];
    const minX = +/viewBox="([-\d.]+) /.exec(svg)![1];
    expect(minX).toBeCloseTo(tagX - boldWidth("L1", theme.type.tag) - 16, 0);
  });

  test("a connector mask pads the sans label and covers it semibold", () => {
    const { ctx } = context();
    const svg = renderFigure(figure({ id: "m", nodes: row3, edges: ["a -> b: acknowledges"] }, ctx), ctx);
    const [mask] = rectsOf(svg, "x-edge-mask");
    const px = theme.type.edgeLabel;
    expect(mask.w).toBeCloseTo(Math.max(textWidth("acknowledges", px, "sans") + 8, boldWidth("acknowledges", px) + 2), 0);
  });
});
