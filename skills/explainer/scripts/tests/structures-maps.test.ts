import { describe, expect, test } from "bun:test";
import { loadTheme } from "../engine/theme.ts";
import { parseDoc } from "../engine/parse.ts";
import { textWidth } from "../engine/figure/grid.ts";
import { SpecError, type BlockModule, type Diagnostic, type ElementInfo, type RawBlock, type RenderContext } from "../engine/types.ts";
import { blockModule as swimlane } from "../engine/structures/swimlane.ts";
import { blockModule as fishbone } from "../engine/structures/fishbone.ts";
import { blockModule as wardley } from "../engine/structures/wardley.ts";
import { blockModule as nested } from "../engine/structures/nested.ts";

const theme = await loadTheme();
const LINE = 7;
type AnyModule = BlockModule<any>;
type Data = Record<string, unknown>;
type Pt = [number, number];

function makeCtx(warns: Diagnostic[] = []): RenderContext {
  return { theme, doc: { front: {}, segments: [] }, inline: (s: string) => s, warn: (d: Diagnostic) => { warns.push(d); } };
}
const raw = (type: string, data: unknown): RawBlock => ({ type, info: [], body: "", data, line: LINE });

function run(mod: AnyModule, data: unknown) {
  const warns: Diagnostic[] = [];
  const ctx = makeCtx(warns);
  const block = mod.normalize(raw(mod.type, data), ctx);
  const html = mod.render(block, ctx);
  const elements: Record<string, ElementInfo> = mod.model?.(block).elements ?? {};
  return { block, html, elements, warns };
}

/** The block of a shipped template, as the build would read it. */
async function template(name: string): Promise<unknown> {
  const doc = parseDoc(await Bun.file(new URL(`../../templates/${name}.md`, import.meta.url)).text());
  const seg = doc.segments.find((s) => s.kind === "block" && s.block.type === name);
  if (!seg || seg.kind !== "block") throw new Error(`no ${name} block in templates/${name}.md`);
  return seg.block.data;
}

function specError(fn: () => unknown): SpecError {
  try {
    fn();
  } catch (e) {
    if (e instanceof SpecError) return e;
    throw e;
  }
  throw new Error("expected a SpecError");
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Every mark with its whole inner markup, nested groups included. */
function marks(html: string) {
  return [...html.matchAll(/<g class="x-mark[^"]*" data-id="([^"]+)"[^>]*>/g)].map((m) => {
    let depth = 1, i = m.index! + m[0].length;
    const tags = /<g[\s>]|<\/g>/g;
    tags.lastIndex = i;
    for (let t = tags.exec(html); t && depth; t = tags.exec(html)) {
      depth += t[0] === "</g>" ? -1 : 1;
      i = t.index;
    }
    return { id: decode(m[1]), inner: html.slice(m.index! + m[0].length, i) };
  });
}

// ---------- geometry read back from the rendered SVG ----------

interface Box { x: number; y: number; w: number; h: number; text: string; cls: string }
interface Seg { a: Pt; b: Pt; cls: string }

/** Glyph boxes of every text, every stroked line or path as segments, every circle. */
function geometry(html: string) {
  const boxes: Box[] = [];
  for (const m of html.matchAll(/<text class="([^"]+)" x="([-\d.]+)" y="([-\d.]+)"(?: text-anchor="(\w+)")?([^>]*)>([^<]*)<\/text>/g)) {
    const [, cls, xs, ys, anchor = "start", extra, content] = m;
    if (/transform=/.test(extra)) continue;
    const t = decode(content);
    // Every label renders in sans; section tags (axis titles, stage labels, category chips, container heads) are 600.
    const tag = /x-axis-label|x-wardley-stage-label|x-fishbone-cat-label|x-nested-head/.test(cls);
    const small = tag || /x-edge-text|x-note-num/.test(cls);
    const px = /x-lane-label|x-fishbone-effect/.test(cls) ? theme.type.nodeLabel : /x-edge-text/.test(cls) ? theme.type.edgeLabel : small ? theme.type.tag : theme.type.nodeSub;
    const w = textWidth(t, px, "sans") * (tag ? 1.08 : 1);
    const x = Number(xs), y = Number(ys);
    boxes.push({ x: anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x, y: y - 0.72 * px, w, h: 0.94 * px, text: t, cls });
  }
  const segs: Seg[] = [];
  const hidden = /x-edge-hit|x-hit|x-wardley-casing|x-arrowhead|x-wardley-band|x-swimlane-band/;
  for (const m of html.matchAll(/<line class="([^"]+)" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) {
    if (!hidden.test(m[1])) segs.push({ a: [Number(m[2]), Number(m[3])], b: [Number(m[4]), Number(m[5])], cls: m[1] });
  }
  for (const m of html.matchAll(/<path class="([^"]+)" d="([^"]+)"/g)) {
    if (hidden.test(m[1])) continue;
    const pts: Pt[] = [];
    for (const c of m[2].matchAll(/([MLQA])([^MLQAZ]*)/g)) {
      const n = c[2].trim().split(/[\s,]+/).map(Number);
      if (c[1] === "A") pts.push([n[5], n[6]]);
      else for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
    }
    if (/Z\s*$/.test(m[2])) pts.push(pts[0]);
    for (let i = 1; i < pts.length; i++) segs.push({ a: pts[i - 1], b: pts[i], cls: m[1] });
  }
  const dots = [...html.matchAll(/<circle class="([^"]+)" cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)]
    .map((m) => ({ c: [Number(m[2]), Number(m[3])] as Pt, r: Number(m[4]), cls: m[1] }));
  return { boxes, segs, dots };
}

function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
const pointRectDist = (p: Pt, r: Box) => Math.hypot(Math.max(r.x - p[0], 0, p[0] - r.x - r.w), Math.max(r.y - p[1], 0, p[1] - r.y - r.h));
function segsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
function segHitsRect(r: Box, a: Pt, b: Pt): boolean {
  if (!pointRectDist(a, r) || !pointRectDist(b, r)) return true;
  const cs: Pt[] = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  return cs.some((c, i) => segsCross(a, b, c, cs[(i + 1) % 4]));
}

/** Every label that a line or a dot touches once the label's box is grown by 2px, plus note markers sitting on lines. */
function crossings(html: string): string[] {
  const g = geometry(html);
  const out: string[] = [];
  for (const b of g.boxes) {
    const grown = { ...b, x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 };
    for (const s of g.segs) if (segHitsRect(grown, s.a, s.b)) out.push(`"${b.text}" × ${s.cls}`);
    for (const d of g.dots) {
      if (/x-note/.test(b.cls) && /x-note/.test(d.cls)) continue;
      if (pointRectDist(d.c, grown) < d.r + 0.75) out.push(`"${b.text}" × ${d.cls}`);
    }
  }
  for (const d of g.dots.filter((x) => /x-note-ring/.test(x.cls))) {
    for (const s of g.segs) if (pointSegDist(d.c, s.a, s.b) < d.r + 1) out.push(`note marker × ${s.cls}`);
  }
  return out;
}

// ---------- fixtures ----------

const swimlaneData: Data = {
  id: "ops-flow",
  lanes: [{ label: "Customer", about: "Starts and ends the flow." }, { id: "support", label: "Support" }, "Finance"],
  steps: [
    { id: "ask", label: "Asks for refund", lane: "Customer", kind: "event", about: "Arrives through the help form." },
    { id: "check", label: "Checks the order", lane: "support" },
    { id: "ok", label: "Eligible?", lane: "support", kind: "decision" },
    { id: "refuse", label: "Explains refusal", lane: "support" },
    { id: "pay", label: "Pays out", lane: "Finance", col: 3, focal: true, wait: "5 days" },
    { id: "done", label: "Gets money", lane: "Customer", col: 4, kind: "event" },
  ],
  links: ["ask -> check", { "check -> ok": null }, { "ok -> pay": "yes" }, "ok -> refuse: no", "pay -> done", "refuse --> ask"],
};

const fishboneData: Data = {
  id: "late-orders",
  effect: { label: "Orders ship late", about: "One order in eight misses its dispatch day." },
  categories: [
    { label: "People", causes: ["New pickers", { label: "Short shifts", about: "Evening shift runs at half strength." }] },
    { label: "Process", about: "How work moves through the floor.", causes: [{ label: "Manual label printing", focal: true }, "Batch picking"] },
    { label: "Tools", causes: ["Slow scanner app"] },
  ],
};

const wardleyData: Data = {
  id: "maps",
  components: [
    { id: "user", label: "Customer", visibility: 0.95, evolution: 0.6, about: "The anchor: everything below serves this need." },
    { id: "app", label: "Ordering app", visibility: 0.8, evolution: 0.5 },
    { id: "recs", label: "Recommendations", visibility: 0.65, evolution: 0.2, focal: true, moving_to: 0.45 },
    { id: "pay", label: "Payments", visibility: 0.6, evolution: 0.85 },
    { label: "Cloud hosting", visibility: 0.1, evolution: 0.92 },
  ],
  links: ["user -> app", "app -> recs", "app -> pay", "recs -> Cloud hosting"],
};

/** 12 components and 14 links, the wardley budget, on a crowded plot. */
const wardleyStress: Data = {
  id: "learning",
  components: [
    { id: "learner", label: "Learner", visibility: 0.96, evolution: 0.55 },
    { id: "courses", label: "Course catalogue", visibility: 0.85, evolution: 0.45 },
    { id: "player", label: "Video player", visibility: 0.78, evolution: 0.7 },
    { id: "quiz", label: "Quizzes", visibility: 0.78, evolution: 0.28 },
    { id: "certs", label: "Certificates", visibility: 0.66, evolution: 0.6 },
    { id: "progress", label: "Progress tracking", visibility: 0.62, evolution: 0.38 },
    { id: "recs", label: "Recommendations", visibility: 0.58, evolution: 0.15, focal: true, moving_to: 0.3 },
    { id: "payments", label: "Payments", visibility: 0.52, evolution: 0.85, inertia: true },
    { id: "search", label: "Search", visibility: 0.45, evolution: 0.62 },
    { id: "cdn", label: "Video delivery", visibility: 0.35, evolution: 0.82 },
    { id: "data", label: "Learning data", visibility: 0.3, evolution: 0.42 },
    { id: "hosting", label: "Cloud hosting", visibility: 0.08, evolution: 0.92 },
  ],
  links: [
    "learner -> courses", "learner -> player", "learner -> certs", "courses -> quiz", "courses -> search", "courses -> payments", "courses -> recs",
    "player -> cdn", "quiz -> progress", "certs -> progress", "progress -> data", "recs -> data", "data -> hosting", "cdn -> hosting",
  ],
};

const nestedData: Data = {
  id: "org",
  root: {
    label: "Online store",
    about: "Everything the shop runs on.",
    children: [
      { label: "Storefront", children: ["Product pages", "Search", { label: "Cart", about: "Holds items until checkout." }] },
      { id: "checkout", label: "Checkout", children: [{ label: "Payment form", focal: true }, "Address check"] },
      "Reports",
    ],
  },
};

const EVIL = "<script>alert(1)</script>";
const cases: { name: string; mod: AnyModule; data: Data; evil: Data; prefix: string }[] = [
  { name: "swimlane", mod: swimlane, data: swimlaneData, prefix: "ops-flow-", evil: { id: "e1", lanes: [EVIL], steps: [{ id: "s1", label: EVIL, lane: EVIL }] } },
  { name: "fishbone", mod: fishbone, data: fishboneData, prefix: "late-orders-", evil: { id: "e2", effect: EVIL, categories: [{ label: EVIL, causes: [EVIL] }, { label: "B", causes: ["x"] }] } },
  { name: "wardley", mod: wardley, data: wardleyData, prefix: "maps-", evil: { id: "e3", components: [{ label: EVIL, visibility: 0.5, evolution: 0.5 }] } },
  { name: "nested", mod: nested, data: nestedData, prefix: "org-", evil: { id: "e4", root: { label: EVIL, children: [EVIL] } } },
];

// ---------- shared contract ----------

for (const c of cases) {
  describe(`${c.name}: contract`, () => {
    test("normalizes and renders the happy path without warnings", () => {
      const { block, warns } = run(c.mod, c.data);
      expect(block.type).toBe(c.name);
      expect(block.line).toBe(LINE);
      expect(warns).toEqual([]);
    });

    test("the shipped template builds without warnings and no label touches a line", async () => {
      const { html, warns } = run(c.mod, await template(c.name));
      expect(warns).toEqual([]);
      expect(crossings(html)).toEqual([]);
    });

    test("every mark has data-id, a painted shape and a model entry", () => {
      const { html, elements } = run(c.mod, c.data);
      const ms = marks(html);
      expect(ms.length).toBeGreaterThan(0);
      for (const m of ms) {
        expect(m.inner).toContain("x-mark-shape");
        expect(elements[m.id]).toBeDefined();
      }
    });

    test("ids are unique and every model entry is on the page or names marks that are", () => {
      const { html, elements } = run(c.mod, c.data);
      const ids = [...html.matchAll(/data-id="([^"]+)"/g)].map((m) => decode(m[1]));
      expect(new Set(ids).size).toBe(ids.length);
      for (const [key, el] of Object.entries(elements)) {
        if (el.kind === "handoff") for (const m of el.members!) expect(ids).toContain(m);
        else expect(ids).toContain(key);
      }
    });

    test("card relations only point at elements of the model", () => {
      const { elements } = run(c.mod, c.data);
      for (const el of Object.values(elements)) {
        for (const id of [...(el.related ?? []), ...(el.context ?? []), ...(el.crumb ?? []), ...(el.links ?? []).flatMap((l) => l.ids), ...(el.facts ?? []).flatMap((f) => (f.ref ? [f.ref] : []))]) {
          expect(elements[id]).toBeDefined();
        }
        expect((el.facts ?? []).length).toBeLessThanOrEqual(5);
        for (const l of el.links ?? []) expect(l.ids.length).toBeGreaterThan(0);
      }
    });

    test("auto ids carry the block id prefix", () => {
      const { elements } = run(c.mod, c.data);
      const auto = Object.keys(elements).filter((k) => k.startsWith(c.prefix));
      expect(auto.length).toBeGreaterThan(0);
    });

    test("rendering is deterministic", () => {
      expect(run(c.mod, c.data).html).toBe(run(c.mod, c.data).html);
    });

    test("no colors and no inline styles", () => {
      const { html } = run(c.mod, c.data);
      expect(html).not.toMatch(/style=/);
      expect(html).not.toMatch(/rgba?\(/);
      expect(html).not.toMatch(/(?<![\w-])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?![\w-])/);
    });

    test("labels are escaped", () => {
      const { html } = run(c.mod, c.evil);
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    test("unknown keys are a SpecError on the fence line", () => {
      const e = specError(() => c.mod.normalize(raw(c.name, { ...c.data, color: "red" }), makeCtx()));
      expect(e.line).toBe(LINE);
    });

    test("notes, caveat and story are accepted; a note puts a numbered marker on its target", () => {
      const first = Object.keys(run(c.mod, c.data).elements)[0];
      const { block, html } = run(c.mod, { ...c.data, notes: [{ on: first, text: "Look here." }, "A note without a marker."], caveat: "Not to scale.", story: [first] });
      expect(block.notes).toHaveLength(2);
      expect(block.caveat).toBe("Not to scale.");
      expect(html.match(/class="x-note-marker"/g)).toHaveLength(1);
      expect(html).toContain(`data-for="${first}"`);
    });

    test("a note or story step on an id outside the block is ref-exists", () => {
      expect(specError(() => c.mod.normalize(raw(c.name, { ...c.data, notes: [{ on: "elsewhere", text: "x" }] }), makeCtx())).rule).toBe("ref-exists");
      expect(specError(() => c.mod.normalize(raw(c.name, { ...c.data, story: ["elsewhere"] }), makeCtx())).rule).toBe("ref-exists");
    });

    test("reading and table describe the block", () => {
      const { block } = run(c.mod, c.data);
      expect(c.mod.reading!(block).length).toBeGreaterThan(40);
      const t = c.mod.table!(block);
      expect(t.rows.length).toBeGreaterThan(0);
      for (const r of t.rows) expect(r).toHaveLength(t.head.length);
    });
  });
}

// ---------- swimlane ----------

describe("swimlane", () => {
  const route = (html: string, id: string): Pt[] => {
    const d = new RegExp(`data-id="${id.replace(/[>-]/g, (c) => (c === ">" ? "&gt;" : c))}"[^>]*><path class="x-edge-line" d="([^"]+)"`).exec(html)![1];
    return [...d.matchAll(/([-\d.]+),([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  };
  const label = (html: string, id: string) => {
    const m = new RegExp(`<g class="x-edge-label" data-for="${id.replace(/>/g, "&gt;")}"><text class="x-edge-text" x="([-\\d.]+)" y="([-\\d.]+)"`).exec(html)!;
    return { x: Number(m[1]), y: Number(m[2]) };
  };

  test("columns default to sequential order", () => {
    const { block } = run(swimlane, swimlaneData);
    const col = (id: string) => block.steps.find((s: { id: string }) => s.id === id).col;
    expect([col("ask"), col("check"), col("ok"), col("refuse"), col("pay"), col("done")]).toEqual([0, 1, 2, 3, 3, 4]);
  });

  test("lanes are groups, steps are nodes, links are edges between nodes", () => {
    const { html, elements } = run(swimlane, swimlaneData);
    expect(elements["ops-flow-customer"].type).toBe("group");
    expect(elements["ops-flow-customer"].members).toEqual(["ask", "done"]);
    const edge = elements["ok->pay"];
    expect(edge.type).toBe("edge");
    expect(edge.label).toBe("yes");
    expect(elements[edge.from!].type).toBe("node");
    expect(elements[edge.to!].type).toBe("node");
    expect(elements["refuse->ask"].kind).toBe("return");
    expect(html).toContain('data-from="ok" data-to="pay"');
    expect(html).toContain('class="x-edge-hit"');
  });

  test("a lane relates every link with an end in it, handoffs in and out included", () => {
    const { elements } = run(swimlane, swimlaneData);
    expect(elements.support.related!.sort()).toEqual(["ask->check", "check->ok", "ok->pay", "ok->refuse", "refuse->ask"].sort());
    expect(elements.support.context!.sort()).toEqual(["ask", "pay"]);
    expect(elements.support.links).toContainEqual({ rel: "Hands off to", ids: ["ops-flow-finance", "ops-flow-customer"] });
  });

  test("each handoff gets an id prose can link, with its links and their ends as members", () => {
    const { elements } = run(swimlane, swimlaneData);
    const h = elements["ops-flow-support-to-finance"];
    expect(h.kind).toBe("handoff");
    expect(h.members).toEqual(["ok->pay", "ok", "pay"]);
    expect(h.facts).toContainEqual({ k: "Wait", v: "5 days" });
    expect(elements["ok->pay"].facts![0]).toEqual({ k: "Crosses", v: "Support → Finance", ref: "ops-flow-support-to-finance" });
    expect(elements.pay.facts).toContainEqual({ k: "Handoff from", v: "Support", ref: "ops-flow-support-to-finance" });
    expect(elements.pay.facts).toContainEqual({ k: "Wait before it", v: "5 days" });
    expect(elements.ok.links).toContainEqual({ rel: "If yes", ids: ["pay"] });
    expect(elements.ok.links).toContainEqual({ rel: "If no", ids: ["refuse"] });
  });

  test("decision branches leave from distinct vertices", async () => {
    for (const data of [swimlaneData, await template("swimlane")]) {
      const { block, html } = run(swimlane, data);
      for (const s of block.steps.filter((x: { kind: string }) => x.kind === "decision")) {
        const starts = block.links.filter((l: { from: string }) => l.from === s.id).map((l: { id: string }) => route(html, l.id)[0].join(","));
        expect(new Set(starts).size).toBe(starts.length);
      }
    }
  });

  test("a branch label rests on its own line: just above a horizontal run, inside it", async () => {
    const { block, html } = run(swimlane, await template("swimlane"));
    for (const l of block.links.filter((x: { label?: string }) => x.label)) {
      const pts = route(html, l.id), at = label(html, l.id);
      const w = textWidth(l.label, theme.type.edgeLabel, "mono");
      const run = pts.slice(1).map((p, i) => [pts[i], p]).find(([a, b]) => a[1] === b[1] && at.x - w / 2 >= Math.min(a[0], b[0]) && at.x + w / 2 <= Math.max(a[0], b[0]));
      expect(run).toBeDefined();
      const gap = run![0][1] - at.y;
      expect(gap).toBeGreaterThan(2);
      expect(gap).toBeLessThan(8);
    }
  });

  test("routes never run through a step, even when both lanes are busy on the way", () => {
    const busy = {
      id: "busy",
      lanes: ["A", "B"],
      steps: [
        { id: "a0", label: "Start", lane: "A", col: 0 }, { id: "a1", label: "A one", lane: "A", col: 1 }, { id: "a2", label: "A two", lane: "A", col: 2 },
        { id: "b1", label: "B one", lane: "B", col: 1 }, { id: "b2", label: "B two", lane: "B", col: 2 }, { id: "b3", label: "End", lane: "B", col: 3 },
      ],
      links: ["a0 -> b3", "a2 -> a0", "b3 -> a0", "a0 -> a2"],
    };
    const { html, warns } = run(swimlane, busy);
    expect(warns.filter((w) => w.rule === "route")).toEqual([]);
    expect(crossings(html)).toEqual([]);
    const boxes = [...html.matchAll(/<rect class="x-mark-shape" x="([-\d.]+)" y="([-\d.]+)" width="144" height="56"/g)].map((m) => ({ x: Number(m[1]) + 1, y: Number(m[2]) + 1, w: 142, h: 54, text: "", cls: "" }));
    for (const id of ["a0->b3", "a2->a0", "b3->a0", "a0->a2"]) {
      const pts = route(html, id);
      const [from, to] = id.split("->");
      const own = [from, to].map((s) => busy.steps.findIndex((x) => x.id === s));
      boxes.forEach((b, i) => {
        if (own.includes(i)) return;
        for (let k = 1; k < pts.length; k++) expect(segHitsRect(b, pts[k - 1], pts[k])).toBe(false);
      });
    }
  });

  test("more than five columns warns about width", () => {
    const steps = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, label: `Step ${i}`, lane: "A" }));
    const { warns } = run(swimlane, { id: "wide", lanes: ["A"], steps });
    expect(warns.some((w) => w.rule === "budget-nodes" && w.message.includes("6 columns"))).toBe(true);
  });

  test("missing lane and missing step are ref-exists errors", () => {
    const badLane = { ...swimlaneData, steps: [{ id: "x", label: "X", lane: "nowhere" }], links: [] };
    expect(specError(() => swimlane.normalize(raw("swimlane", badLane), makeCtx())).rule).toBe("ref-exists");
    const badLink = { ...swimlaneData, links: ["ask -> ghost"] };
    expect(specError(() => swimlane.normalize(raw("swimlane", badLink), makeCtx())).rule).toBe("ref-exists");
  });

  test("two steps in one cell is a grid-collision", () => {
    const data = { ...swimlaneData, steps: [{ id: "a", label: "A", lane: "support", col: 1 }, { id: "b", label: "B", lane: "support", col: 1 }], links: [] };
    expect(specError(() => swimlane.normalize(raw("swimlane", data), makeCtx())).rule).toBe("grid-collision");
  });

  test("over budget warns instead of throwing", () => {
    const lanes = ["A", "B", "C", "D", "E", "F"];
    const warns: Diagnostic[] = [];
    swimlane.normalize(raw("swimlane", { id: "big", lanes, steps: lanes.map((l, i) => ({ id: `s${i}`, label: l, lane: l })) }), makeCtx(warns));
    expect(warns.some((w) => w.rule === "budget-nodes")).toBe(true);
  });
});

// ---------- fishbone ----------

describe("fishbone", () => {
  const six: Data = {
    id: "six",
    effect: "Support tickets pile up",
    categories: ["Staffing", "Tooling", "Product", "Policy", "Customers", "Partners"].map((label, i) => ({
      label,
      causes: ["Too few agents on weekends", "Macros out of date", "Unclear refund rules"].slice(0, 1 + (i % 3)).map((x) => `${x} ${label.toLowerCase()}`),
    })),
  };

  test("effect is the focal head, categories group their causes", () => {
    const { html, elements } = run(fishbone, fishboneData);
    expect(html).toMatch(/data-id="late-orders-effect" data-focal="true"/);
    expect(elements["late-orders-people"].type).toBe("group");
    expect(elements["late-orders-people"].members).toEqual(["late-orders-new-pickers", "late-orders-short-shifts"]);
    expect(elements["late-orders-short-shifts"].related).toEqual(["late-orders-people", "late-orders-effect"]);
  });

  test("the effect is related to every category and cause", () => {
    const { elements } = run(fishbone, fishboneData);
    const causes = Object.values(elements).filter((e) => e.kind === "cause" || e.kind === "category").map((e) => e.id);
    expect(elements["late-orders-effect"].related!.sort()).toEqual(causes.sort());
    expect(elements["late-orders-process"].related).toEqual(["late-orders-effect"]);
  });

  test("a category card counts its causes and chips the other categories", () => {
    const { elements } = run(fishbone, fishboneData);
    const facts = elements["late-orders-process"].facts!;
    expect(facts[0]).toEqual({ k: "Causes", v: "2" });
    expect(facts).toContainEqual({ k: "Tools", v: "1 cause", ref: "late-orders-tools" });
    expect(elements["late-orders-manual-label-printing"].pos).toBe("root cause");
  });

  test("weights rank the causes on the effect's card", async () => {
    const { elements } = run(fishbone, await template("fishbone"));
    const effect = elements["late-shipping-effect"].facts!;
    expect(effect[0]).toEqual({ k: "1st", v: "Labels printed by hand · 18%", ref: "late-shipping-labels-printed-by-hand" });
    expect(elements["late-shipping-process"].facts).toContainEqual({ k: "Share", v: "45%" });
    const partial = run(fishbone, { ...fishboneData, categories: [{ label: "A", causes: [{ label: "x", weight: 2 }, "y"] }, { label: "B", causes: ["z"] }] });
    expect(partial.warns.some((w) => w.message.includes("weigh every cause or none"))).toBe(true);
  });

  test("bones are staggered and the spine starts just before the first tick", () => {
    const { html } = run(fishbone, six);
    const joints = [...html.matchAll(/<line class="x-fishbone-bone" x1="[-\d.]+" y1="[-\d.]+" x2="([-\d.]+)"/g)].map((m) => Number(m[1]));
    expect(new Set(joints).size).toBe(6);
    const spineX = Number(/<line class="x-fishbone-spine" x1="([-\d.]+)"/.exec(html)![1]);
    const tickEnds = [...html.matchAll(/<line class="x-mark-shape" x1="[-\d.]+" y1="[-\d.]+" x2="([-\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...tickEnds) - spineX).toBeCloseTo(16, 0);
  });

  test("no label touches a bone, tick or the spine, even with six categories", () => {
    for (const data of [fishboneData, six]) expect(crossings(run(fishbone, data).html)).toEqual([]);
  });

  test("fewer than two categories is a SpecError", () => {
    const data = { ...fishboneData, categories: [{ label: "Only", causes: ["x"] }] };
    expect(() => fishbone.normalize(raw("fishbone", data), makeCtx())).toThrow(SpecError);
  });

  test("more than three causes warns", () => {
    const warns: Diagnostic[] = [];
    fishbone.normalize(raw("fishbone", { ...fishboneData, categories: [{ label: "A", causes: ["a", "b", "c", "d"] }, { label: "B", causes: ["e"] }] }), makeCtx(warns));
    expect(warns.some((w) => w.rule === "budget-nodes")).toBe(true);
  });
});

// ---------- wardley ----------

describe("wardley", () => {
  /** Link ends that sit on one dot's rim, per dot centre. */
  const portsByDot = (html: string) => {
    const g = geometry(html);
    const dots = g.dots.filter((d) => d.cls === "x-mark-shape").map((d) => d.c);
    const ends = g.segs.filter((s) => s.cls === "x-edge-line").flatMap((s) => [s.a, s.b]);
    return dots.map((c) => ends.filter((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 10));
  };
  const minGap = (pts: Pt[]) => {
    let min = Infinity;
    pts.forEach((p, i) => pts.slice(i + 1).forEach((q) => { min = Math.min(min, Math.hypot(p[0] - q[0], p[1] - q[1])); }));
    return min;
  };

  test("links resolve by id or label; components are nodes with a stage value", () => {
    const { elements } = run(wardley, wardleyData);
    expect(elements["recs->maps-cloud-hosting"].type).toBe("edge");
    expect(elements.recs.type).toBe("node");
    expect(elements.recs.value).toBe("Genesis → Custom");
    expect(elements.pay.value).toBe("Commodity");
  });

  test("the template and a 12-component stress map: no label box grown by 2px touches a link or a dot", async () => {
    for (const data of [await template("wardley"), wardleyStress]) {
      const { html, warns } = run(wardley, data);
      expect(warns).toEqual([]);
      expect(crossings(html)).toEqual([]);
    }
  });

  test("link ends that share a dot sit at least 3px apart on its rim", async () => {
    for (const data of [await template("wardley"), wardleyStress]) {
      for (const ports of portsByDot(run(wardley, data).html)) if (ports.length > 1) expect(minGap(ports)).toBeGreaterThanOrEqual(3);
    }
  });

  test("links that arrive at one angle are spread apart instead of merging", () => {
    const bunched = {
      id: "fan",
      components: [
        { id: "a", label: "Alpha", visibility: 0.7, evolution: 0.2 },
        { id: "b", label: "Beta", visibility: 0.55, evolution: 0.4 },
        { id: "c", label: "Gamma", visibility: 0.38, evolution: 0.5 },
        { id: "h", label: "Hosting", visibility: 0.1, evolution: 0.93 },
      ],
      links: ["a -> h", "b -> h", "c -> h"],
    };
    const { html, warns } = run(wardley, bunched);
    const hosting = portsByDot(html).find((p) => p.length === 3)!;
    expect(minGap(hosting)).toBeGreaterThanOrEqual(3);
    expect(warns.filter((w) => w.rule === "link-bundle").length).toBeGreaterThan(0);
    expect(crossings(html)).toEqual([]);
  });

  test("lints: implied link, link near a dot, ghost on a stage boundary, moving left", () => {
    const { warns } = run(wardley, {
      id: "lint",
      components: [
        { id: "a", label: "Alpha", visibility: 0.9, evolution: 0.2 },
        { id: "b", label: "Beta", visibility: 0.5, evolution: 0.5, moving_to: 0.75 },
        { id: "c", label: "Gamma", visibility: 0.1, evolution: 0.8 },
        { id: "d", label: "Delta", visibility: 0.7, evolution: 0.6, moving_to: 0.4 },
      ],
      links: ["a -> b", "b -> c", "a -> c"],
    });
    const rules = (r: string) => warns.filter((w) => w.rule === r).map((w) => w.message);
    expect(rules("link-implied")).toEqual([`wardley "lint" link "a->c" is implied by a -> b -> c; drop it, the value chain already says it.`]);
    expect(rules("link-near-dot").some((m) => m.includes(`link "a->c"`) && m.includes(`"Beta"`))).toBe(true);
    expect(rules("move-boundary").some((m) => m.includes(`"Beta"`) && m.includes("0.70 or 0.80"))).toBe(true);
    expect(rules("move-left")).toHaveLength(1);
  });

  test("movement draws a cased dashed trail and a ghost filled with the page", () => {
    const { html } = run(wardley, wardleyData);
    expect(html).toContain("x-wardley-casing");
    expect(html).toContain("x-wardley-move");
    expect(html).toContain("x-wardley-ghost");
  });

  test("inertia draws a bar next to the dot and shows in the value", () => {
    const { html, elements } = run(wardley, wardleyStress);
    expect(html).toMatch(/data-id="payments"[^>]*data-inertia="true"[^>]*>[\s\S]*?x-wardley-inertia/);
    expect(elements.payments.value).toBe("Commodity · inertia");
  });

  test("axis words are horizontal and stage headers are selectable groups", () => {
    const { html, elements } = run(wardley, wardleyData);
    expect(html).not.toMatch(/rotate\(/);
    const product = elements["maps-stage-product"];
    expect(product.type).toBe("group");
    expect(product.members).toEqual(["user", "app"]);
    expect(elements["maps-stage-custom"].members).toEqual([]);
    expect(elements["maps-stage-custom"].facts).toContainEqual({ k: "Moving in", v: "Recommendations", ref: "recs" });
  });

  test("a component's card: needs and needed-by, and the value chain up to the user as context", async () => {
    const { elements } = run(wardley, await template("wardley"));
    const routing = elements.routing;
    expect(routing.links).toEqual([{ rel: "Needs", ids: ["maps", "hosting"] }, { rel: "Needed by", ids: ["ordering"] }]);
    expect(routing.context).toEqual(["customer", "customer->ordering", "ordering->routing", "delivery-map-stage-custom"]);
    expect(routing.facts).toContainEqual({ k: "Path to user", v: "Ordering app → Hungry customer" });
    expect(elements.recs.facts![0]).toEqual({ k: "Moving", v: "Genesis → Product", ref: "delivery-map-stage-product" });
    expect(elements["ordering->routing"].label).toBe("Ordering app needs Courier routing");
    expect(elements["ordering->routing"].facts).toEqual([{ k: "Stages", v: "Product → Custom" }]);
  });

  test("out-of-range position is a SpecError, unknown link end is ref-exists", () => {
    const bad = { ...wardleyData, components: [{ label: "X", visibility: 1.4, evolution: 0.2 }], links: [] };
    expect(() => wardley.normalize(raw("wardley", bad), makeCtx())).toThrow(SpecError);
    const badLink = { ...wardleyData, links: ["user -> nobody"] };
    expect(specError(() => wardley.normalize(raw("wardley", badLink), makeCtx())).rule).toBe("ref-exists");
  });
});

// ---------- nested ----------

describe("nested", () => {
  const rects = (html: string) => new Map([...html.matchAll(/data-id="([^"]+)"[^>]*><rect class="x-mark-shape" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)]
    .map((m) => [decode(m[1]), { x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]) }]));

  test("containers select their whole subtree; leaves keep their ancestors as context", () => {
    const { html, elements } = run(nested, nestedData);
    expect(elements["org-online-store"].members?.length).toBe(8);
    expect(elements.checkout.members).toEqual(["org-payment-form", "org-address-check"]);
    expect(elements["org-payment-form"].context).toEqual(["org-online-store", "checkout"]);
    expect(elements["org-payment-form"].crumb).toEqual(["org-online-store", "checkout"]);
    expect(elements["org-payment-form"].related).toBeUndefined();
    expect(html).toMatch(/class="x-mark x-nested-box" data-id="checkout"[^>]*data-depth="1"/);
  });

  test("a container card counts its parts and chips its children", async () => {
    const { elements } = run(nested, await template("nested"));
    const checkout = elements["store-parts-checkout"];
    expect(checkout.facts![0]).toEqual({ k: "Parts", v: "2 of 8 · 25%" });
    expect(checkout.links).toEqual([{ rel: "Contains", ids: ["store-parts-payment-form", "store-parts-address-check"] }]);
    expect(checkout.crumb).toEqual(["store-parts-online-store"]);
  });

  test("boxes keep their natural height and a container's leaves share one width", async () => {
    const r = rects(run(nested, await template("nested")).html);
    expect(r.get("store-parts-checkout")!.h).toBeLessThan(r.get("store-parts-storefront")!.h);
    expect(r.get("store-parts-checkout")!.y).toBe(r.get("store-parts-storefront")!.y);
    const widths = ["store-parts-product-pages", "store-parts-search", "store-parts-cart"].map((id) => r.get(id)!.w);
    expect(new Set(widths).size).toBe(1);
    expect(r.get("store-parts-cart")!.x).toBe(r.get("store-parts-product-pages")!.x);
  });

  test("a box without a label is a SpecError", () => {
    expect(() => nested.normalize(raw("nested", { id: "n", root: { children: ["a"] } }), makeCtx())).toThrow(SpecError);
  });

  test("more than 20 boxes or 4 levels warns", () => {
    const warns: Diagnostic[] = [];
    nested.normalize(raw("nested", { id: "wide", root: { label: "Root", children: Array.from({ length: 21 }, (_, i) => `Leaf ${i}`) } }), makeCtx(warns));
    nested.normalize(raw("nested", { id: "deep", root: { label: "A", children: [{ label: "B", children: [{ label: "C", children: [{ label: "D", children: ["E"] }] }] }] } }), makeCtx(warns));
    expect(warns.filter((w) => w.rule === "budget-nodes").length).toBe(2);
  });
});

describe("note markers and lanes", () => {
  test("fishbone: a marker on any cause or category stays off the bones and the spine", async () => {
    const tpl = await template("fishbone");
    const ids = Object.entries(run(fishbone, tpl).elements).filter(([, e]) => e.kind !== "effect").map(([id]) => id);
    for (let i = 0; i < ids.length; i += 4) {
      const data = { ...(tpl as Record<string, unknown>), notes: ids.slice(i, i + 4).map((id) => ({ on: id, text: "A note." })) };
      const { html } = run(fishbone, data);
      const markers = crossings(html).filter((c) => c.startsWith("note marker"));
      expect(markers).toEqual([]);
    }
  });

  test("wardley: with notes the plot leaves a 256px callout lane on the side of the first note", () => {
    const axis = (html: string) => Number(/<line class="x-axis-line" x1="([\d.]+)"/.exec(html)![1]);
    const right = (html: string) => Math.max(...[...html.matchAll(/<line class="x-axis-line" x1="[\d.]+" y1="[\d.]+" x2="([\d.]+)"/g)].map((m) => Number(m[1])));
    const bare = run(wardley, { ...wardleyData, notes: undefined }).html;
    const left = run(wardley, { ...wardleyData, notes: [{ on: "recs", text: "Moves toward product." }] }).html;
    const rightLane = run(wardley, { ...wardleyData, notes: [{ on: "pay", text: "Already bought." }] }).html;
    expect(axis(left) - axis(bare)).toBe(256);
    expect(right(left)).toBe(right(bare));
    expect(axis(rightLane)).toBe(axis(bare));
    expect(right(bare) - right(rightLane)).toBe(256);
  });
});
