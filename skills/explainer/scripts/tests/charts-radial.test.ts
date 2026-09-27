import { describe, expect, test } from "bun:test";
import { loadTheme } from "../engine/theme.ts";
import { SpecError, type BlockModule, type Diagnostic, type ElementInfo, type RawBlock, type RenderContext } from "../engine/types.ts";
import { blockModule as radar } from "../engine/charts/radar.ts";
import { blockModule as polar, polarLayout } from "../engine/charts/polar.ts";
import { NOTE_R, textWidth } from "../engine/kit.ts";
import { blockModule as venn } from "../engine/charts/venn.ts";
import { blockModule as quadrant } from "../engine/charts/quadrant.ts";
import { blockModule as pyramid } from "../engine/charts/pyramid.ts";
import { blockModule as funnel } from "../engine/charts/funnel.ts";
import { blockModule as slope } from "../engine/charts/slope.ts";

const theme = await loadTheme();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = BlockModule<any>;

function makeCtx(warnings: Diagnostic[]): RenderContext {
  return { theme, doc: { front: {}, segments: [] }, inline: (s: string) => s, warn: (d) => { warnings.push(d); } };
}
const raw = (type: string, data: unknown): RawBlock => ({ type, info: [], body: "", data, line: 7 });

function run(mod: AnyModule, data: unknown) {
  const warnings: Diagnostic[] = [];
  const ctx = makeCtx(warnings);
  const block = mod.normalize(raw(mod.type, data), ctx);
  const html = mod.render(block, ctx);
  const model = mod.model?.(block) ?? {};
  return { block, html, model, warnings };
}

/** Selectable marks; the radar's area layer mirrors a series id with aria-hidden and no tab stop, so it is skipped. */
function marks(html: string) {
  return [...html.matchAll(/<g class="x-mark[^"]*" data-id="([^"]+)"([^>]*)>([\s\S]*?)<\/g>/g)]
    .filter((m) => !m[2].includes(`aria-hidden="true"`))
    .map((m) => ({ id: m[1], body: m[3] }));
}

function specError(fn: () => unknown): SpecError {
  try { fn(); } catch (e) { if (e instanceof SpecError) return e; throw e; }
  throw new Error("expected a SpecError");
}

const EVIL = "<script>alert(1)</script>";
const EXPLICIT = new Set(["pm", "ds", "en"]);

const cases: { name: string; mod: AnyModule; data: (label?: string) => Record<string, unknown> }[] = [
  {
    name: "radar", mod: radar, data: (label = "Plan A") => ({
      id: "fit", max: 10, axes: ["Speed", "Cost", "Reach", "Trust"],
      series: [
        { label, values: [3, 4, 5, 2], about: "Cheap and wide." },
        { label: "Plan B", values: { Speed: 5, Cost: 2, Reach: 3, Trust: 4 }, focal: true, about: "Fast and trusted." },
      ],
    }),
  },
  {
    name: "polar", mod: polar, data: (label = "Mon") => ({
      id: "week", format: "int",
      data: [{ label, value: 12, focal: true, about: "Monday peak." }, { label: "Tue", value: 8 }, { label: "Wed", value: 7 }, { label: "Thu", value: 9 }, { label: "Fri", value: 5 }],
    }),
  },
  {
    name: "venn", mod: venn, data: (label = "Product") => ({
      id: "roles",
      sets: [{ id: "pm", label, about: "Owns the problem." }, { id: "ds", label: "Design" }, { id: "en", label: "Engineering" }],
      overlaps: [
        { sets: ["pm", "ds"], label: "Discovery" },
        { "ds & en": "Design system" },
        "pm & en: Roadmap",
        { sets: ["pm", "ds", "en"], label: "Prototyping", focal: true },
      ],
    }),
  },
  {
    name: "quadrant", mod: quadrant, data: (label = "Saved searches") => ({
      id: "backlog",
      x: { low: "Low effort", high: "High effort", title: "Effort" },
      y: { low: "Low impact", high: "High impact", title: "Impact" },
      quadrants: ["Quick wins", "Big bets", "Fill-ins", "Money pits"],
      data: [
        { label, x: 0.2, y: 0.8, focal: true, about: "A week of work." },
        { label: "SSO", x: 0.8, y: 0.85 },
        { label: "Dark mode", x: 0.3, y: 0.3 },
        { label: "Offline", x: 0.85, y: 0.2 },
      ],
    }),
  },
];

describe("radial charts: shared contract", () => {
  for (const { name, mod, data } of cases) {
    test(`${name}: marks carry unique prefixed ids, a painted shape and a model entry`, () => {
      const { block, html, model } = run(mod, data());
      const found = marks(html);
      expect(found.length).toBeGreaterThan(0);
      expect(new Set(found.map((m) => m.id)).size).toBe(found.length);
      for (const m of found) {
        expect(m.body).toContain("x-mark-shape");
        expect(EXPLICIT.has(m.id) || m.id.startsWith(`${block.id}-`)).toBe(true);
        expect(model.elements?.[m.id]).toBeDefined();
        expect(model.elements?.[m.id].figure).toBe(block.id);
      }
    });

    test(`${name}: output is deterministic`, () => {
      expect(run(mod, data()).html).toBe(run(mod, data()).html);
    });

    test(`${name}: no colors and no inline styles`, () => {
      const { html } = run(mod, data());
      expect(html).not.toMatch(/(?<!&)#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/rgba?\(/);
      expect(html).not.toContain("style=");
    });

    test(`${name}: labels are escaped`, () => {
      const { html } = run(mod, data(EVIL));
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    test(`${name}: unknown keys throw a SpecError at the fence line`, () => {
      const e = specError(() => run(mod, { ...data(), colour: "red" }));
      expect(e.line).toBe(7);
    });
  }
});

describe("radar", () => {
  test("normalizes list and map values in axis order", () => {
    const { block } = run(radar, cases[0].data());
    expect(block.series[1].values).toEqual([5, 2, 3, 4]);
    expect(block.series[0].id).toBe("fit-plan-a");
    expect(block.shared).toBe(true);
  });

  test("fewer than 3 axes is a SpecError", () => {
    specError(() => run(radar, { id: "r", axes: ["A", "B"], series: [{ label: "S", values: [1, 2] }] }));
  });

  test("a value keyed by an unknown axis is ref-exists", () => {
    const e = specError(() => run(radar, { id: "r", axes: ["A", "B", "C"], series: [{ label: "S", values: { A: 1, B: 2, D: 3 } }] }));
    expect(e.rule).toBe("ref-exists");
  });

  test("series legend is selectable and flags the focal series", () => {
    const { html } = run(radar, cases[0].data());
    expect(html).toContain(`data-id="fit-plan-b" data-focal="true"`);
    expect(html).toMatch(/class="x-legend-item"[^>]*data-id="fit-plan-a"/);
  });

  test("more than 5 series warns", () => {
    const series = Array.from({ length: 6 }, (_, i) => ({ label: `S${i}`, values: [1, 2, 3] }));
    const { warnings } = run(radar, { id: "r", axes: ["A", "B", "C"], series });
    expect(warnings.some((w) => w.rule === "budget-nodes")).toBe(true);
  });
});

describe("polar", () => {
  test("map shorthand keeps order and draws one sector per category", () => {
    const { block, html } = run(polar, { id: "w", data: { Mon: 3, Tue: 5, Wed: 4 } });
    expect(block.items.map((i: { label: string }) => i.label)).toEqual(["Mon", "Tue", "Wed"]);
    expect(html.match(/x-polar-bar/g)?.length).toBe(3);
  });

  test("negative values are a SpecError", () => {
    specError(() => run(polar, { id: "w", data: { Mon: 3, Tue: -1, Wed: 4 } }));
  });

  test("more than 8 categories warns", () => {
    const data = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`C${i}`, i + 1]));
    expect(run(polar, { id: "w", data }).warnings.some((w) => w.rule === "budget-nodes")).toBe(true);
  });

  test("focal category carries the accent flag", () => {
    expect(run(polar, cases[1].data()).html).toContain(`data-id="week-mon" data-focal="true"`);
  });
});

describe("venn", () => {
  test("all overlap forms normalize to region marks with arc paths", () => {
    const { block, html, model } = run(venn, cases[2].data());
    expect(block.overlaps.map((o: { id: string }) => o.id)).toEqual(["roles-pm-ds", "roles-ds-en", "roles-pm-en", "roles-pm-ds-en"]);
    const regions = marks(html).filter((m) => m.id.startsWith("roles-"));
    expect(regions).toHaveLength(4);
    for (const r of regions) expect(r.body).toMatch(/<path class="x-mark-shape" d="M[^"]*A/);
    expect(model.elements?.pm.related).toContain("roles-pm-ds-en");
    expect(model.elements?.["roles-pm-ds"].related).toEqual(["pm", "ds"]);
  });

  test("an overlap naming a missing set is ref-exists", () => {
    const e = specError(() => run(venn, { id: "v", sets: [{ id: "a", label: "A" }, { id: "b", label: "B" }], overlaps: ["a & z: Both"] }));
    expect(e.rule).toBe("ref-exists");
  });

  test("four sets is a SpecError", () => {
    const sets = ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase() }));
    specError(() => run(venn, { id: "v", sets }));
  });

  test("the same overlap twice is id-unique", () => {
    const e = specError(() => run(venn, { id: "v", sets: [{ id: "a", label: "A" }, { id: "b", label: "B" }], overlaps: ["a & b: One", "b & a: Two"] }));
    expect(e.rule).toBe("id-unique");
  });
});

describe("quadrant", () => {
  const axes = { x: { low: "Low effort", high: "High effort" }, y: { low: "Low impact", high: "High impact" } };

  test("positions outside 0..1 are a SpecError", () => {
    specError(() => run(quadrant, { id: "q", ...axes, data: [{ label: "A", x: 1.2, y: 0.5 }] }));
  });

  test("quadrants needs exactly 4 labels", () => {
    specError(() => run(quadrant, { id: "q", ...axes, quadrants: ["A", "B", "C"], data: [{ label: "A", x: 0.2, y: 0.5 }] }));
  });

  test("quadrants are groups of their points", () => {
    const { model } = run(quadrant, cases[3].data());
    expect(model.elements?.["backlog-top-left"].members).toEqual(["backlog-saved-searches"]);
    expect(model.elements?.["backlog-saved-searches"].related).toEqual(["backlog-top-left"]);
  });

  test("close points put their labels on different sides", () => {
    const { html, warnings } = run(quadrant, { id: "q", ...axes, data: [{ label: "Alpha", x: 0.4, y: 0.6 }, { label: "Beta", x: 0.42, y: 0.6 }] });
    expect(warnings.filter((w) => w.rule === "label-fit")).toHaveLength(0);
    expect(html.match(/<text class="x-mark-label"[^>]*>Alpha<\/text>/)![0]).toContain(`text-anchor="end"`);
  });
});

// ---------- templates: the facts a click shows, asserted exactly ----------

async function template(mod: AnyModule) {
  const src = await Bun.file(`${import.meta.dir}/../../templates/${mod.type}.md`).text();
  const m = src.match(new RegExp("^```" + mod.type + "\\n([\\s\\S]*?)^```", "m"));
  if (!m) throw new Error(`templates/${mod.type}.md has no ${mod.type} block`);
  return run(mod, Bun.YAML.parse(m[1]));
}

const facts = (el: ElementInfo | undefined) => Object.fromEntries((el?.facts ?? []).map((f) => [f.k, f.v]));

describe("radar: template", () => {
  test("an axis is a mark: every series' value there, with the gap to the focal series", async () => {
    const { model, html } = await template(radar);
    const el = model.elements!["onboarding-axis-clarity"];
    expect(el.kind).toBe("axis");
    expect(el.value).toBe("New flow 8 · Current flow 6");
    expect(facts(el)).toEqual({ "New flow": "8 of 10", "Current flow": "6 (−2 vs New flow)" });
    // nothing dims: both series are related, the other axes stay at rest
    expect(el.related).toEqual(["onboarding-current-flow", "onboarding-new-flow"]);
    expect(el.context?.length).toBe(4);
    const axis = marks(html).find((m) => m.id === "onboarding-axis-clarity")!;
    expect(axis.body).toContain("x-radar-axis-hit");
    expect(facts(model.elements!["onboarding-axis-trust"])["Current flow"]).toBe("7 (tie with New flow)");
  });

  test("a series compares with the other one axis by axis", async () => {
    const { model } = await template(radar);
    const el = model.elements!["onboarding-new-flow"];
    expect(facts(el)).toEqual({
      "vs Current flow": "higher on 4 of 5, tie on Trust",
      "Self-serve": "7 (+4)", Speed: "7 (+3)", Completion: "8 (+3)", Clarity: "8 (+2)",
    });
  });

  test("every area is painted before any outline", async () => {
    const { html } = await template(radar);
    const lastArea = html.lastIndexOf("x-radar-area");
    const firstLine = html.indexOf(`class="x-series-line"`);
    expect(lastArea).toBeGreaterThan(0);
    expect(lastArea).toBeLessThan(firstLine);
    // the area layer mirrors the series id without a tab stop
    expect(html).toMatch(/class="x-mark x-radar-series x-radar-fill" data-id="onboarding-new-flow"[^>]*aria-hidden="true"/);
  });
});

describe("polar: template and ring labels", () => {
  test("monday: rank, share of the week, the mean, the runner-up", async () => {
    const { model } = await template(polar);
    const el = model.elements!["tickets-by-day-monday"];
    expect(el.value).toBe("412 tickets");
    expect(el.pos).toBe("1 of 7");
    expect(facts(el)).toEqual({
      rank: "#1 of 7",
      share: "24% of the week",
      "vs mean": "1.7× the mean (240)",
      "vs Tuesday": "+94 (+30%)",
      "vs Sunday": "+308 (+296%)",
    });
    expect(facts(model.elements!["tickets-by-day-thursday"])["vs Monday"]).toBe("−158 (−38%)");
  });

  test("the mean ring is shown on selection", async () => {
    const { html } = await template(polar);
    expect(marks(html).find((m) => m.id === "tickets-by-day-monday")!.body).toContain("x-polar-mean");
    expect(html).toContain(">mean 240<");
  });

  // Ring labels used to sit on the seam between the last and first step and cover both bars; months with a winter peak were the worst case.
  const months = {
    id: "m", format: "int",
    data: [1800, 1500, 900, 600, 400, 300, 280, 320, 500, 800, 1200, 1700].map((value, i) => ({ label: `M${i + 1}`, value, focal: i === 0 })),
  };
  for (const [name, data] of [["template", null], ["12 months with a winter peak", months]] as const) {
    test(`ring labels clear every sector: ${name}`, async () => {
      const { html, block } = data ? run(polar, data) : await template(polar);
      const base = html.match(/class="x-axis-line x-polar-base" cx="([\d.]+)" cy="([\d.]+)"/)!;
      const cx = Number(base[1]), cy = Number(base[2]);
      const sectors = [...html.matchAll(/class="x-mark-shape x-polar-bar" d="M([\d.-]+),([\d.-]+)A([\d.]+),[\d.]+ 0 \d 1 ([\d.-]+),([\d.-]+)L([\d.-]+),([\d.-]+)/g)].map((m) => {
        const n = m.slice(1).map(Number);
        const ang = (x: number, y: number) => Math.atan2(y - cy, x - cx);
        return { a0: ang(n[0], n[1]), a1: ang(n[3], n[4]), r1: n[2], r0: Math.hypot(n[5] - cx, n[6] - cy) };
      });
      const inside = (x: number, y: number) => sectors.some((sct) => {
        const r = Math.hypot(x - cx, y - cy), a = Math.atan2(y - cy, x - cx);
        const within = sct.a0 <= sct.a1 ? a >= sct.a0 && a <= sct.a1 : a >= sct.a0 || a <= sct.a1;
        return r >= sct.r0 && r <= sct.r1 && within;
      });
      const ticks = [...html.matchAll(/<text class="x-tick-label x-polar-tick" x="([\d.]+)" y="([\d.]+)" text-anchor="middle"[^>]*>([^<]+)</g)];
      expect(ticks.length).toBeGreaterThan(0);
      for (const [, x, y, label] of ticks) {
        const w = textWidth(label, theme.type.tag, "mono");
        for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) {
          expect(inside(Number(x) - w / 2 + (w * i) / 4, Number(y) - 8 + j * 5)).toBe(false);
        }
      }
      const { seam, labelled, rings } = polarLayout(block, theme.type.tag);
      expect(seam).toBeLessThanOrEqual((24 * Math.PI) / 180 + 1e-9);
      expect(labelled[labelled.length - 1]).toBe(rings[rings.length - 1]);
    });
  }

  test("cycle names the whole; without it the share is of the total", () => {
    const { model } = run(polar, { id: "w", data: { Mon: 3, Tue: 1, Wed: 4 } });
    expect(facts(model.elements!["w-mon"]).share).toBe("38% of the total");
  });
});

describe("venn: template", () => {
  test("a set lists its overlaps as chips", async () => {
    const { model } = await template(venn);
    const el = model.elements!.design;
    expect(el.facts).toEqual([
      { k: "∩ Product", v: "Discovery", ref: "team-overlap-product-design" },
      { k: "∩ Engineering", v: "Design system", ref: "team-overlap-design-engineering" },
      { k: "all three", v: "Prototyping", ref: "team-overlap-product-design-engineering" },
    ]);
  });

  test("a region says which sets it is in and which it is not", async () => {
    const { model } = await template(venn);
    expect(model.elements!["team-overlap-product-design"].links).toEqual([{ rel: "In", ids: ["product", "design"] }, { rel: "Not in", ids: ["engineering"] }]);
    expect(model.elements!["team-overlap-product-design-engineering"].links).toEqual([{ rel: "In", ids: ["product", "design", "engineering"] }]);
  });

  test("with sizes: each region's share of its sets and the part only in one set", () => {
    const { model } = run(venn, {
      id: "v", sets: [{ id: "a", label: "A", size: 100 }, { id: "b", label: "B", size: 50 }], overlaps: [{ sets: ["a", "b"], label: "Both", size: 20 }],
    });
    expect(facts(model.elements!["v-a-b"])).toEqual({ "share of A": "20%", "share of B": "40%" });
    expect(facts(model.elements!.a)["only A"]).toBe("80 (80%)");
  });
});

describe("quadrant: template", () => {
  test("a point: both judgements, its quadrant, and its three nearest items in the axes' words", async () => {
    const { model } = await template(quadrant);
    const el = model.elements!["backlog-offline-mode"];
    expect(el.value).toBe("Effort 0.88 · Impact 0.20");
    expect(el.pos).toBe("Money pits");
    expect(el.facts).toEqual([
      { k: "Custom reports", v: "less effort, more impact", ref: "backlog-custom-reports" },
      { k: "Bulk edit", v: "less effort, more impact", ref: "backlog-bulk-edit" },
      { k: "Dark mode", v: "less effort, more impact", ref: "backlog-dark-mode" },
    ]);
    expect(el.context).toEqual(["backlog-custom-reports"]);
    expect(facts(model.elements!["backlog-saved-searches"])["CSV export"]).toBe("similar effort, less impact");
  });

  test("a quadrant: its items from the corner inwards, and its about", async () => {
    const { model } = await template(quadrant);
    const el = model.elements!["backlog-bottom-right"];
    expect(el.value).toBe("2 items");
    expect(el.links).toEqual([{ rel: "Items, most extreme first", ids: ["backlog-offline-mode", "backlog-custom-reports"] }]);
    expect(el.about).toBe("Costly and minor: drop them or find a cheaper version.");
  });

  test("named quadrants are picked by their name, so a click on empty plot space clears", async () => {
    const { html } = await template(quadrant);
    expect(html.match(/x-quadrant-cell"[^>]*data-named="true"/g)?.length).toBe(4);
    expect(html.match(/>0\.5</g)?.length).toBe(2);
  });

  test("every point label stays inside the plot", async () => {
    for (const data of [null, cases[3].data()]) {
      const { html } = data ? run(quadrant, data) : await template(quadrant);
      const cells = [...html.matchAll(/x-quadrant-cell[^>]*>(?:<g[^>]*>)?<rect class="x-mark-shape" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
      const x0 = Math.min(...cells.map((c) => c[0])), y0 = Math.min(...cells.map((c) => c[1]));
      const x1 = Math.max(...cells.map((c) => c[0] + c[2])), y1 = Math.max(...cells.map((c) => c[1] + c[3]));
      const labels = [...html.matchAll(/class="x-mark x-point"[\s\S]*?<text class="x-mark-label" x="([\d.]+)" y="([\d.]+)"( text-anchor="(\w+)")?>([^<]+)</g)];
      expect(labels.length).toBeGreaterThan(3);
      for (const [, x, y, , anchor, label] of labels) {
        const w = textWidth(label, theme.type.nodeSub, "sans");
        const left = anchor === "end" ? Number(x) - w : anchor === "middle" ? Number(x) - w / 2 : Number(x);
        expect(left).toBeGreaterThanOrEqual(x0);
        expect(left + w).toBeLessThanOrEqual(x1);
        expect(Number(y) - theme.type.nodeSub).toBeGreaterThanOrEqual(y0);
        expect(Number(y)).toBeLessThanOrEqual(y1);
      }
    }
  });
});

describe("reading and table for every radial block", () => {
  test("each template has a how-to-read line, a data table, two note markers and a caveat", async () => {
    for (const mod of [radar, polar, venn, quadrant]) {
      const { block, html } = await template(mod);
      expect(mod.reading!(block).length).toBeGreaterThan(40);
      const t = mod.table!(block);
      expect(t.rows.length).toBeGreaterThan(0);
      for (const row of t.rows) expect(row.length).toBe(t.head.length);
      expect(html.match(/class="x-note-marker"/g)?.length).toBe(2);
      expect(block.caveat).toBeTruthy();
    }
  });

  test("the figure's <title> and <desc> ids are never handed to an element", () => {
    const { model } = run(polar, { id: "s", data: { Title: 1, Desc: 2, Other: 3 } });
    expect(model.elements!["s-title"]).toBeUndefined();
    expect(model.elements!["s-title-2"]).toBeDefined();
  });
});

// ---------- the column edge: every drawing starts where the prose does, so the docked card sits beside it ----------

/** Horizontal ends of everything drawn: text (by anchor and estimated width), circles, rects and path/polygon points. */
function ink(html: string): { lo: number; hi: number; width: number } {
  const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
  const width = Number(/viewBox="0 0 ([\d.]+) /.exec(svg)![1]);
  const xs: number[] = [];
  for (const m of svg.matchAll(/<text class="[^"]*" x="([-\d.]+)" y="[-\d.]+"(?: text-anchor="(\w+)")?[^>]*>([^<]*)<\/text>/g)) {
    const x = Number(m[1]), w = textWidth(m[3], theme.type.nodeSub, "sans");
    const left = m[2] === "end" ? x - w : m[2] === "middle" ? x - w / 2 : x;
    xs.push(left, left + w);
  }
  for (const m of svg.matchAll(/<circle [^>]*cx="([-\d.]+)" cy="[-\d.]+" r="([\d.]+)"/g)) xs.push(Number(m[1]) - Number(m[2]), Number(m[1]) + Number(m[2]));
  for (const m of svg.matchAll(/<rect [^>]*x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)"/g)) xs.push(Number(m[1]), Number(m[1]) + Number(m[2]));
  for (const m of svg.matchAll(/ (?:points|d)="([^"]+)"/g)) {
    for (const p of m[1].replace(/A[\d.]+,[\d.]+ [\d.]+ \d \d /g, "A").matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) xs.push(Number(p[1]));
  }
  return { lo: Math.min(...xs), hi: Math.max(...xs), width };
}

describe("every drawing starts at the column edge", () => {
  for (const mod of [venn, radar, polar, pyramid, funnel, slope]) {
    test(`${mod.type}: cropped to what it draws, never centred`, async () => {
      const { html } = await template(mod);
      const { lo, hi, width } = ink(html);
      expect(lo).toBeGreaterThanOrEqual(4);
      expect(lo).toBeLessThanOrEqual(24);
      expect(hi).toBeLessThanOrEqual(width);
      expect(width - hi).toBeLessThanOrEqual(24);
    });
  }
});

// ---------- venn: markers off every ring and label, region labels on the widest chord ----------

interface Circle { x: number; y: number; r: number }

function vennParts(html: string, block: { sets: { id: string }[]; overlaps: { id: string; sets: string[] }[] }) {
  const all = marks(html);
  const circles = block.sets.map((s) => {
    const m = /<circle class="x-mark-shape" cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/.exec(all.find((k) => k.id === s.id)!.body)!;
    return { x: Number(m[1]), y: Number(m[2]), r: Number(m[3]) };
  });
  const cap = theme.type.nodeSub * 0.72;
  const texts = [...html.matchAll(/<text class="(x-mark-label|x-value-label)" x="([-\d.]+)" y="([-\d.]+)"(?: text-anchor="(\w+)")?>([^<]*)</g)].map((m) => {
    const x = Number(m[2]), y = Number(m[3]), w = textWidth(m[5], theme.type.nodeSub, "sans");
    return { x: m[4] === "end" ? x - w : m[4] === "middle" ? x - w / 2 : x, y: y - cap, w, h: cap, t: m[5] };
  });
  const regions = block.overlaps.map((o) => {
    const lines = [...all.find((k) => k.id === o.id)!.body.matchAll(/<text class="[^"]*" x="([-\d.]+)" y="([-\d.]+)" text-anchor="middle">([^<]*)</g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: textWidth(m[3], theme.type.nodeSub, "sans") }));
    return { id: o.id, members: o.sets.map((sid) => block.sets.findIndex((s) => s.id === sid)), lines };
  });
  const markers = [...html.matchAll(/data-for="([^"]+)"><circle class="x-note-ring" cx="([-\d.]+)" cy="([-\d.]+)"/g)]
    .map((m) => ({ on: m[1].split(" ")[0], x: Number(m[2]), y: Number(m[3]) }));
  return { circles, texts, regions, markers, cap };
}

/** The widest piece of the region inside exactly `members` on the line y. */
function chordAt(circles: Circle[], members: number[], y: number): [number, number] | null {
  let lo = -Infinity, hi = Infinity;
  for (const k of members) {
    const c = circles[k], dy = y - c.y;
    if (Math.abs(dy) >= c.r) return null;
    const h = Math.sqrt(c.r ** 2 - dy ** 2);
    lo = Math.max(lo, c.x - h);
    hi = Math.min(hi, c.x + h);
  }
  let pieces: [number, number][] = lo < hi ? [[lo, hi]] : [];
  circles.forEach((c, k) => {
    const dy = y - c.y;
    if (members.includes(k) || Math.abs(dy) >= c.r) return;
    const h = Math.sqrt(c.r ** 2 - dy ** 2);
    pieces = pieces.flatMap(([p, q]): [number, number][] => [[p, Math.min(q, c.x - h)], [Math.max(p, c.x + h), q]]).filter(([p, q]) => q > p);
  });
  return pieces.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0] ?? null;
}

const vennCases: Record<string, unknown>[] = [
  {
    id: "two",
    notes: [{ on: "pm", text: "Set." }, { on: "two-pm-eng", text: "Overlap." }, { on: "eng", text: "Other set." }],
    sets: [{ id: "pm", label: "Product management", size: 40 }, { id: "eng", label: "Engineering", size: 55 }],
    overlaps: [{ sets: ["pm", "eng"], label: "Roadmap planning", size: 12 }],
  },
  {
    id: "three",
    notes: [{ on: "a", text: "Set." }, { on: "c", text: "Bottom set." }, { on: "three-a-c", text: "Pair." }, { on: "three-a-b-c", text: "Centre." }],
    sets: [{ id: "a", label: "Research", size: 120 }, { id: "b", label: "Design", size: 90 }, { id: "c", label: "Engineering", size: 200 }],
    overlaps: [
      { sets: ["a", "b"], label: "Discovery", size: 30 }, { sets: ["b", "c"], label: "Design system", size: 25 },
      { sets: ["a", "c"], label: "Data pipelines", size: 18 }, { sets: ["a", "b", "c"], label: "Prototyping", size: 9 },
    ],
  },
  {
    id: "rest",
    notes: [{ on: "b", text: "Set." }, { on: "rest-a-b", text: "Pair." }, { on: "rest-b-c", text: "Pair." }, { on: "rest-a-b-c", text: "Centre." }],
    sets: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
    overlaps: ["a & b: Discovery", "b & c: Design system", "a & c: Roadmap", "a & b & c: Prototyping"],
  },
];

describe("venn: note markers and region labels", () => {
  const all = async () => [await template(venn), ...vennCases.map((d) => run(venn, d))];

  test("a note marker never sits on a ring or a label, and stays with its target", async () => {
    for (const { html, block } of await all()) {
      const { circles, texts, regions, markers } = vennParts(html, block);
      expect(markers.length).toBe(block.notes.filter((n: { on: string[] }) => n.on.length).length);
      for (const m of markers) {
        for (const c of circles) expect(Math.abs(Math.hypot(m.x - c.x, m.y - c.y) - c.r)).toBeGreaterThanOrEqual(NOTE_R + 4);
        for (const t of texts) {
          const apart = m.x + NOTE_R + 2 <= t.x || t.x + t.w + 2 <= m.x - NOTE_R || m.y + NOTE_R + 2 <= t.y || t.y + t.h + 2 <= m.y - NOTE_R;
          expect(apart).toBe(true);
        }
        // a region's marker sits inside that region; a set's outside every circle
        const reg = regions.find((r) => r.id === m.on);
        circles.forEach((c, k) => expect(Math.hypot(m.x - c.x, m.y - c.y) < c.r).toBe(!!reg?.members.includes(k)));
      }
      for (let i = 0; i < markers.length; i++) {
        for (let j = i + 1; j < markers.length; j++) expect(Math.hypot(markers[i].x - markers[j].x, markers[i].y - markers[j].y)).toBeGreaterThan(2 * NOTE_R);
      }
    }
  });

  test("a region label sits on its widest chord, clear of every outline", async () => {
    for (const { html, block } of await all()) {
      const { circles, regions, cap } = vennParts(html, block);
      for (const r of regions) {
        expect(r.lines.length).toBeGreaterThan(0);
        const top = r.lines[0].y - cap, bottom = r.lines[r.lines.length - 1].y, mid = (top + bottom) / 2;
        // every line of the label fits the region at its height, with room to spare on both sides
        for (const l of r.lines) {
          for (const y of [l.y - cap, l.y]) {
            const ch = chordAt(circles, r.members, y)!;
            expect(ch).not.toBeNull();
            expect(l.x - l.w / 2).toBeGreaterThanOrEqual(ch[0] + 4);
            expect(l.x + l.w / 2).toBeLessThanOrEqual(ch[1] - 4);
          }
        }
        // the span every line of the label's band shares; for one line this is the chord through it
        const band = (y0: number, y1: number): [number, number] => {
          let lo = -Infinity, hi = Infinity;
          for (let y = y0; y <= y1; y += 1) {
            const ch = chordAt(circles, r.members, y);
            if (!ch) return [0, 0];
            lo = Math.max(lo, ch[0]);
            hi = Math.min(hi, ch[1]);
          }
          return [lo, Math.max(lo, hi)];
        };
        // the label's band includes the 6px it keeps clear above and below
        const here = band(top - 6, bottom + 6);
        expect(Math.abs((here[0] + here[1]) / 2 - r.lines[0].x)).toBeLessThanOrEqual(4);
        // no band of the same height anywhere in the region is wider (1px scan here, 2px in the engine)
        let widest = 0;
        for (let y = 0; y < 1000; y += 1) {
          const [lo, hi] = band(y, y + bottom - top + 12);
          widest = Math.max(widest, hi - lo);
        }
        expect(here[1] - here[0]).toBeGreaterThanOrEqual(widest - 3);
      }
    }
  });
});
