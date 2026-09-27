import { describe, expect, test } from "bun:test";
import { blockModule as bar } from "../engine/charts/bar.ts";
import { blockModule as beeswarm } from "../engine/charts/beeswarm.ts";
import { blockModule as dumbbell } from "../engine/charts/dumbbell.ts";
import { blockModule as waterfall } from "../engine/charts/waterfall.ts";
import { loadTheme } from "../engine/theme.ts";
import { SpecError, type BlockModule, type Diagnostic, type ElementInfo, type RawBlock, type RenderContext } from "../engine/types.ts";

const theme = await loadTheme();
// deno-lint-ignore no-explicit-any
type AnyModule = BlockModule<any>;

function context(warnings: Diagnostic[] = []): RenderContext {
  return { theme, doc: { front: {}, segments: [] }, inline: (s: string) => s, warn: (d: Diagnostic) => void warnings.push(d) };
}

const raw = (type: string, data: unknown): RawBlock => ({ type, info: [], body: "", data, line: 7 });

function build(mod: AnyModule, data: unknown, warnings: Diagnostic[] = []) {
  const ctx = context(warnings);
  const block = mod.normalize(raw(mod.type, data), ctx);
  return { block, html: mod.render(block, ctx), model: mod.model?.(block) ?? {} };
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

function marksIn(html: string): { id: string; body: string }[] {
  const starts = [...html.matchAll(/<(?:g|div) class="x-mark[ "][^>]*?data-id="([^"]+)"[^>]*>/g)];
  return starts.map((m, i) => ({ id: m[1], body: html.slice(m.index! + m[0].length, i + 1 < starts.length ? starts[i + 1].index! : html.length) }));
}

/** The shared contract: prefixed unique ids, painted shapes, model entries, determinism, no colors. */
function contract(mod: AnyModule, data: { id: string } & Record<string, unknown>) {
  const { html, model, block } = build(mod, data);
  const marks = marksIn(html);
  expect(marks.length).toBeGreaterThan(0);
  const ids = marks.map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const m of marks) {
    expect(m.id.startsWith(`${data.id}-`)).toBe(true);
    expect(m.body).toContain("x-mark-shape");
  }
  const elements = model.elements ?? {};
  for (const [, id] of html.matchAll(/data-id="([^"]+)"/g)) expect(elements[id]).toBeDefined();
  for (const el of Object.values(elements)) {
    expect(el.figure).toBe(data.id);
    if (el.type === "item") expect(ids).toContain(el.id);
  }
  expect(build(mod, data).html).toBe(html);
  expect(html).not.toMatch(/(?<!&)#[0-9a-fA-F]{3,8}\b/);
  expect(html).not.toContain("style=");
  expect(html).not.toContain("rgb(");
  return { html, model, marks, block };
}

function escapes(mod: AnyModule, data: unknown) {
  const { html } = build(mod, data);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
}

const XSS = "<script>alert(1)</script>";

// ---------- bar ----------

const signups = {
  id: "signups",
  format: "int",
  axis: "Signups",
  data: [
    { label: "Referrals", value: 1480, about: "Partner links." },
    { label: "Organic search", value: 4120, focal: true },
    { label: "Paid search", value: 1210 },
  ],
};
const revenue = {
  id: "rev",
  stack: true,
  categories: ["Q1", "Q2", "Q3"],
  series: [
    { label: "North", values: [12, 15, 9] },
    { label: "South", values: { Q1: 7, Q3: 11 } },
  ],
};
const visits = {
  id: "visits",
  categories: ["Mon", "Tue", "Wed"],
  series: [
    { label: "Web", values: [120, 140, 90] },
    { label: "App", values: [80, 95, 60], focal: true },
  ],
};

describe("bar", () => {
  test("single series sorts by value and picks the orientation", () => {
    const { block } = build(bar, signups);
    expect(block.items.map((i: { label: string }) => i.label)).toEqual(["Organic search", "Referrals", "Paid search"]);
    expect(block.orient).toBe("horizontal");
    const short = build(bar, { id: "v", data: { A: 3, B: 5, C: 1 } }).block;
    expect(short.orient).toBe("vertical");
    expect(short.items.map((i: { label: string }) => i.label)).toEqual(["B", "A", "C"]);
  });

  test("single series: contract, value labels, no legend", () => {
    const { html } = contract(bar, signups);
    expect(html).toContain("4,120");
    expect(html).not.toContain("x-legend");
    expect(html).toContain(`data-focal="true"`);
  });

  test("stacked series: groups, selectable legend, gaps", () => {
    const { html, model } = contract(bar, revenue);
    expect(model.elements!["rev-north"].members).toEqual(["rev-north-q1", "rev-north-q2", "rev-north-q3"]);
    expect(model.elements!["rev-south"].members).toEqual(["rev-south-q1", "rev-south-q3"]);
    expect(model.elements!["rev-north-q1"].related).toEqual(["rev-north"]);
    expect(html).toMatch(/class="x-legend-item"[^>]*data-id="rev-north"/);
  });

  test("grouped vertical series flag the focal series on the legend", () => {
    const { html, block } = contract(bar, visits);
    expect(block.orient).toBe("vertical");
    expect(html).toContain(`data-id="visits-app" data-focal="true"`);
  });

  test("negative values render around a zero baseline", () => {
    contract(bar, { id: "margin", format: "%", data: { Hardware: -4, Services: 12, Licences: 31 } });
    contract(bar, { id: "margin-v", orient: "vertical", format: "%", data: { Hardware: -4, Services: 12, Licences: 31 } });
  });

  test("spec errors", () => {
    expect(specError(() => build(bar, { ...signups, colour: "red" })).line).toBe(7);
    expect(() => build(bar, { id: "x", data: [{ label: "A", value: "lots" }] })).toThrow(SpecError);
    expect(() => build(bar, { ...revenue, data: { A: 1 } })).toThrow(SpecError);
    const ref = specError(() => build(bar, { id: "x", categories: ["Q1"], series: [{ label: "N", values: { Q9: 1 } }] }));
    expect(ref.rule).toBe("ref-exists");
    expect(() => build(bar, { id: "x", categories: ["Q1", "Q2"], series: [{ label: "N", values: [1] }] })).toThrow(SpecError);
  });

  test("budget warning over 12 bars", () => {
    const warnings: Diagnostic[] = [];
    build(bar, { id: "many", data: Array.from({ length: 13 }, (_, i) => ({ label: `Item ${i}`, value: i })) }, warnings);
    expect(warnings.some((w) => w.rule === "budget-nodes")).toBe(true);
  });

  test("escapes labels", () => {
    escapes(bar, { id: "x", data: [{ label: XSS, value: 1 }] });
    escapes(bar, { id: "y", categories: [XSS], series: [{ label: XSS, values: [1] }] });
  });
});

// ---------- waterfall ----------

const arr = {
  id: "arr",
  format: "$",
  data: [
    { label: "Start", value: 4200 },
    { label: "New", value: 1600 },
    { label: "Churn", value: -1100 },
    { label: "End", total: true },
  ],
};

describe("waterfall", () => {
  test("running totals", () => {
    const { block } = build(waterfall, arr);
    expect(block.steps.map((s: { level: number }) => s.level)).toEqual([4200, 5800, 4700, 4700]);
    expect(block.steps.map((s: { kind: string }) => s.kind)).toEqual(["start", "delta", "delta", "total"]);
  });

  test("contract, sign by fill weight, signed labels and step lines", () => {
    const { html, model } = contract(waterfall, arr);
    // sign is fill weight (tinted up, hollow down), never ok/danger hue, so the accent stays unambiguous
    expect(html).not.toContain("data-tone");
    expect(html).toMatch(/data-id="arr-new"[^>]*data-sign="up"/);
    expect(html).toMatch(/data-id="arr-churn"[^>]*data-sign="down"/);
    expect(html).toMatch(/data-id="arr-start" data-series="1"[^>]*data-sign="total"/);
    expect(html).toContain("+$1,600");
    expect(html).toContain("−$1,100");
    expect(html.match(/x-grid-line x-waterfall-step/g)?.length).toBe(3);
    expect(model.elements!["arr-churn"].kind).toBe("decrease");
  });

  test("spec errors", () => {
    expect(() => build(waterfall, { id: "x", data: [{ label: "Start", value: 1 }] })).toThrow(SpecError);
    const mismatch = { ...arr, data: [...arr.data.slice(0, 3), { label: "End", total: true, value: 5000 }] };
    expect(() => build(waterfall, mismatch)).toThrow(SpecError);
    expect(() => build(waterfall, { ...arr, stack: true })).toThrow(SpecError);
  });

  test("budget warning over 8 bars", () => {
    const warnings: Diagnostic[] = [];
    build(waterfall, { id: "w", data: Array.from({ length: 9 }, (_, i) => ({ label: `Step ${i}`, value: i + 1 })) }, warnings);
    expect(warnings.some((w) => w.rule === "budget-nodes")).toBe(true);
  });

  test("escapes labels", () => escapes(waterfall, { id: "x", data: [{ label: "Start", value: 1 }, { label: XSS, value: 2 }] }));
});

// ---------- dumbbell ----------

const pages = {
  id: "load",
  format: "1",
  columns: ["Before", "After"],
  data: [
    { label: "Home", from: 2.8, to: 1.9 },
    { label: "Product", from: 4.6, to: 2.1 },
    { label: "Checkout", from: 2.2, to: 2.4 },
  ],
};

describe("dumbbell", () => {
  test("sorts by size of change", () => {
    const { block } = build(dumbbell, pages);
    expect(block.rows.map((r: { label: string }) => r.label)).toEqual(["Product", "Home", "Checkout"]);
  });

  test("contract: one mark per row with both dots", () => {
    const { marks, model } = contract(dumbbell, pages);
    expect(marks.length).toBe(3);
    for (const m of marks) expect(m.body.match(/x-dumbbell-dot/g)?.length).toBe(2);
    expect(model.elements!["load-product"].value).toBe("4.6 → 2.1");
  });

  test("map shorthand", () => {
    expect(build(dumbbell, { id: "m", data: { Home: [2.8, 1.9] } }).block.rows[0].to).toBe(1.9);
  });

  test("spec errors", () => {
    expect(() => build(dumbbell, { id: "x", data: [{ label: "A", from: 1 }] })).toThrow(SpecError);
    expect(() => build(dumbbell, { ...pages, columns: ["A", "B", "C"] })).toThrow(SpecError);
    expect(() => build(dumbbell, { ...pages, sort: "size" })).toThrow(SpecError);
  });

  test("escapes labels", () => escapes(dumbbell, { id: "x", columns: [XSS, "B"], data: [{ label: XSS, from: 1, to: 2 }] }));
});

// ---------- beeswarm ----------

const tickets = {
  id: "reply",
  format: "h",
  data: Array.from({ length: 30 }, (_, i) => ({ label: `Ticket ${i + 1}`, value: ((i * 7) % 11) + (i % 3) * 0.5, group: i % 2 ? "Team" : "Free" })),
};

describe("beeswarm", () => {
  test("contract and groups", () => {
    const { model } = contract(beeswarm, tickets);
    expect(model.elements!["reply-free"].members?.length).toBe(15);
    expect(model.elements!["reply-ticket-1"].related).toEqual(["reply-free"]);
  });

  test("dodge keeps dots apart", () => {
    const { html } = build(beeswarm, tickets);
    const dots = [...html.matchAll(/<circle class="x-mark-shape x-swarm-dot" cx="([\d.-]+)" cy="([\d.-]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(dots.length).toBe(30);
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        expect(Math.hypot(dots[i][0] - dots[j][0], dots[i][1] - dots[j][1])).toBeGreaterThanOrEqual(10.5);
      }
    }
  });

  test("single row without groups", () => {
    contract(beeswarm, { id: "one", data: { A: 1, B: 1, C: 1, D: 2 } });
  });

  test("spec errors", () => {
    expect(() => build(beeswarm, { id: "x", data: [{ label: "A", value: 1, group: "G" }, { label: "B", value: 2 }] })).toThrow(SpecError);
    expect(() => build(beeswarm, { id: "x", data: [{ label: "A", value: "fast" }] })).toThrow(SpecError);
  });

  test("budget warning over 80 dots", () => {
    const warnings: Diagnostic[] = [];
    build(beeswarm, { id: "b", data: Array.from({ length: 81 }, (_, i) => ({ label: `P${i}`, value: i % 17 })) }, warnings);
    expect(warnings.some((w) => w.rule === "budget-nodes")).toBe(true);
  });

  test("escapes labels", () => escapes(beeswarm, { id: "x", data: [{ label: XSS, value: 1, group: XSS, focal: true }] }));
});

// ---------- templates: the facts a click shows, asserted exactly ----------

/** The first `type` block of templates/<type>.md, parsed the way the page parses it. */
async function template(mod: AnyModule) {
  const src = await Bun.file(`${import.meta.dir}/../../templates/${mod.type}.md`).text();
  const m = src.match(new RegExp("^```" + mod.type + "\\n([\\s\\S]*?)^```", "m"));
  if (!m) throw new Error(`templates/${mod.type}.md has no ${mod.type} block`);
  return build(mod, Bun.YAML.parse(m[1]));
}

const facts = (el: ElementInfo | undefined) => Object.fromEntries((el?.facts ?? []).map((f) => [f.k, f.v]));
const refs = (el: ElementInfo | undefined) => (el?.facts ?? []).filter((f) => f.ref).map((f) => f.ref);

/** The children a mark shows only while selected. */
function onSelOf(html: string, id: string): string {
  const body = marksIn(html).find((m) => m.id === id)?.body ?? "";
  return [...body.matchAll(/<g class="x-on-sel[^"]*">([\s\S]*?)<\/g>/g)].map((m) => m[1]).join("");
}

describe("bar: template", () => {
  test("newsletter: rank, share, gap to the focal bar and to the average", async () => {
    const { model } = await template(bar);
    const el = model.elements!["signup-sources-newsletter"];
    expect(el.value).toBe("930 signups");
    expect(el.pos).toBe("5 of 7");
    expect(facts(el)).toEqual({
      rank: "#5 of 7",
      share: "8.8% of total (10,560)",
      "vs Organic search": "−3,190 (0.2×)",
      "vs average": "−579",
    });
    expect(refs(el)).toEqual(["signup-sources-organic-search"]);
    expect(el.say).toBe("Newsletter, 930 signups, 5th of 7, 8.8% of total");
  });

  test("the focal bar compares with the runner-up", async () => {
    const { model } = await template(bar);
    expect(facts(model.elements!["signup-sources-organic-search"])["vs Direct"]).toBe("+2,470 (2.5×)");
  });

  test("selection draws a rule at the value and every other bar's signed difference", async () => {
    const { html, block } = await template(bar);
    const sel = onSelOf(html, "signup-sources-newsletter");
    expect(sel).toContain(`class="x-ref-rule x-sel-rule"`);
    const deltas = [...sel.matchAll(/x-delta-label"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(deltas).toEqual(["+3,190", "+720", "+550", "+280", "−70", "−620"]);
    expect(block.items.length - 1).toBe(deltas.length);
    // the bar's own value label is a direct child, so CSS can swap it for the difference
    expect(html).toMatch(/data-id="signup-sources-direct"[^>]*data-delta="true"/);
  });

  test("notes place one marker per note; reading and table", async () => {
    const { html, block } = await template(bar);
    expect(html.match(/class="x-note-marker"/g)?.length).toBe(2);
    expect(html).toContain(`data-for="signup-sources-organic-search signup-sources-paid-search signup-sources-social-ads"`);
    expect(block.caveat).toMatch(/^Last-touch attribution/);
    expect(bar.reading!(block)).toBe("Each bar is one category; its length is signups, last 90 days, from zero, largest first. The accent marks Organic search, the one the text is about. Select a bar to see the others as differences from it.");
    const t = bar.table!(block);
    expect(t.head).toEqual(["Category", "Signups, last 90 days", "Share"]);
    expect(t.rows[4]).toEqual(["Newsletter", "930", "8.8%"]);
  });
});

describe("bar: series, marks, ids", () => {
  test("grouped cells compare with the other series; stacked cells give their shares", () => {
    const grouped = build(bar, visits).model.elements!;
    expect(facts(grouped["visits-app-mon"])).toEqual({ "vs Web": "−40 (0.7×)", "rank in App": "#2 of 3" });
    expect(grouped["visits-app-mon"].context).toEqual(["visits-web-mon"]);
    expect(facts(grouped["visits-web"])).toEqual({ share: "60% of all", largest: "Tue · 140", smallest: "Wed · 90" });
    const stacked = build(bar, revenue).model.elements!;
    expect(facts(stacked["rev-north-q1"])).toEqual({ "share of Q1": "63%", "share of North": "33%", "Q1 total": "19" });
  });

  test("marks and bands draw on the value axis; mean resolves; dates are refused", () => {
    const { html } = build(bar, { ...signups, marks: [{ x: "mean", label: "average" }, { x: 3000 }], bands: [{ from: 1000, to: 1500, label: "target" }] });
    expect(html.match(/<g class="x-ref-line" data-axis="x">/g)?.length).toBe(2);
    expect(html).toContain(`<g class="x-ref-band" data-axis="x">`);
    expect(html).toContain(">average<");
    expect(html).toContain(">3,000<");
    const vertical = build(bar, { id: "v", data: { A: 3, B: 5, C: 1 }, marks: [{ y: 2 }] }).html;
    expect(vertical).toContain(`<g class="x-ref-line" data-axis="y">`);
    expect(() => build(bar, { ...signups, marks: [{ x: "2026-01-01" }] })).toThrow(SpecError);
  });

  test("the figure's <title> and <desc> ids are never handed to a bar", () => {
    for (const mod of [bar, waterfall, dumbbell, beeswarm]) {
      const data = mod === waterfall
        ? { id: "s", data: [{ label: "Start", value: 1 }, { label: "Title", value: 2 }, { label: "Desc", value: 1 }] }
        : mod === dumbbell
          ? { id: "s", data: [{ label: "Title", from: 1, to: 2 }, { label: "Desc", from: 2, to: 1 }] }
          : { id: "s", data: [{ label: "Title", value: 1 }, { label: "Desc", value: 2 }] };
      const { model } = build(mod, data);
      expect(model.elements!["s-title"]).toBeUndefined();
      expect(model.elements!["s-desc"]).toBeUndefined();
      expect(model.elements!["s-title-2"]).toBeDefined();
    }
  });

  test("unit: word units stay off the bars, symbol units stay on them", () => {
    expect(build(bar, { ...signups, unit: "signups" }).html).not.toContain("signups<");
    expect(build(bar, { id: "p", unit: "%", data: { A: 12, B: 30 } }).html).toContain(">30%<");
  });
});

describe("waterfall: template", () => {
  test("churn: levels, share of gross losses, what it cancels, rank", async () => {
    const { model } = await template(waterfall);
    const el = model.elements!["arr-bridge-churn"];
    expect(el.pos).toBe("2 of 5");
    expect(facts(el)).toEqual({
      level: "$6.2M → $5.1M",
      share: "73% of gross losses ($1.5M)",
      "vs New customers": "cancels 69%",
      rank: "2 of 5 changes by size",
    });
    expect(el.related).toEqual(["arr-bridge-decreases"]);
  });

  test("the end total reconciles, term by term", async () => {
    const { model } = await template(waterfall);
    const el = model.elements!["arr-bridge-end-of-year"];
    expect(facts(el)["net"]).toBe("+$900k (+21%) vs Start of year");
    expect(facts(el)["adds up ($M)"]).toBe("4.2 + 1.6 + 0.6 + 0.2 − 0.4 − 1.1 = 5.1");
    expect(el.links).toEqual([{ rel: "Adds up from", ids: ["arr-bridge-start-of-year", "arr-bridge-new-customers", "arr-bridge-expansion", "arr-bridge-price-change", "arr-bridge-contraction", "arr-bridge-churn"] }]);
  });

  test("selection prints the levels on the solid connectors in and out", async () => {
    const { html } = await template(waterfall);
    const sel = onSelOf(html, "arr-bridge-churn");
    expect(sel.match(/x-waterfall-link/g)?.length).toBe(2);
    expect([...sel.matchAll(/x-level-label"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(["$6.2M", "$5.1M"]);
  });

  test("legend: total, increase, decrease and focal; increases and decreases are selectable groups", async () => {
    const { html, model } = await template(waterfall);
    for (const sign of ["total", "up", "down", "focal"]) expect(html).toContain(`data-sign="${sign}"`);
    expect(model.elements!["arr-bridge-increases"].members).toEqual(["arr-bridge-new-customers", "arr-bridge-expansion", "arr-bridge-price-change"]);
    expect(model.elements!["arr-bridge-decreases"].value).toBe("−$1.5M");
  });

  test("reading line carries the reconciliation; marks must be on y", async () => {
    const { block } = await template(waterfall);
    expect(waterfall.reading!(block)).toContain("It adds up: 4.2 + 1.6 + 0.6 + 0.2 − 0.4 − 1.1 = 5.1 ($M).");
    expect(waterfall.table!(block).rows[5]).toEqual(["Churn", "−$1.1M", "$5.1M"]);
    expect(() => build(waterfall, { ...arr, marks: [{ x: 1 }] })).toThrow(SpecError);
    expect(build(waterfall, { ...arr, marks: [{ y: 5000, label: "plan" }] }).html).toContain(">plan<");
  });
});

describe("dumbbell: template", () => {
  test("checkout: change with percent, rank by gain, median change, verdict", async () => {
    const { model } = await template(dumbbell);
    const el = model.elements!["page-load-checkout"];
    expect(el.value).toBe("2.2 → 1.8 s");
    expect(el.pos).toBe("6 of 7");
    expect(facts(el)).toEqual({
      change: "−0.4 s (−18%)",
      rank: "6 of 7 by gain",
      "median change": "−0.9 s",
      "lower is better": "better by 0.4 s",
    });
  });

  test("hollow first end, solid second end, direction arrow; change printed on selection", async () => {
    const { html } = await template(dumbbell);
    const product = marksIn(html).find((m) => m.id === "page-load-product")!.body;
    expect(product).toContain("x-dumbbell-from");
    expect(product).toContain("x-dumbbell-to");
    expect(product).toContain("x-dumbbell-arrow");
    const sel = onSelOf(html, "page-load-checkout");
    expect(sel).toContain("x-dumbbell-band");
    expect(sel).toContain(">−0.4 (−18%)<");
    expect(html).toContain("sorted by size of change");
  });

  test("legend ends are groups with their mean, shown as a rule on selection", async () => {
    const { html, model } = await template(dumbbell);
    expect(model.elements!["page-load-before"].value).toBe("mean 3.1 s");
    expect(model.elements!["page-load-after"].members?.length).toBe(7);
    expect(html).toMatch(/data-id="page-load-before" data-end="from"[\s\S]*?x-on-sel[\s\S]*?mean 3\.1/);
  });

  test("better must be lower or higher", () => {
    expect(() => build(dumbbell, { ...pages, better: "faster" })).toThrow(SpecError);
  });
});

describe("beeswarm: template", () => {
  test("a group card: n, median, range, middle half, share under the target", async () => {
    const { model } = await template(beeswarm);
    expect(facts(model.elements!["first-reply-team"])).toEqual({
      n: "8", median: "3.5 h", range: "1.2–7.5 h", "middle half": "2.5–4.8 h", "under 2 h target": "1 of 8",
    });
    expect(facts(model.elements!["first-reply-enterprise"])["under 2 h target"]).toBe("7 of 8");
  });

  test("a dot card: place in its group, group median, overall place, neighbours as chips", async () => {
    const { model } = await template(beeswarm);
    const el = model.elements!["first-reply-ticket-4102"];
    expect(facts(el)).toEqual({
      "in Enterprise": "lowest of 8",
      "Enterprise median": "1.2 h",
      overall: "lowest of 24",
      "next higher": "Ticket 4117 · 0.6 h",
    });
    expect(el.context?.length).toBe(7);
    expect(facts(model.elements!["first-reply-ticket-4163"])["in Enterprise"]).toBe("highest of 8");
  });

  test("the group row is a mark; its median and middle half show on selection; the 2 h mark is drawn", async () => {
    const { html } = await template(beeswarm);
    const team = marksIn(html).find((m) => m.id === "first-reply-team")!.body;
    expect(team).toContain("x-swarm-stats");
    expect(team).toContain("x-swarm-median");
    expect(html).toContain(">2 h target<");
    expect(onSelOf(html, "first-reply-ticket-4102")).toContain(">Ticket 4102 · 0.4 h<");
    expect(() => build(beeswarm, { ...tickets, marks: [{ y: 2 }] })).toThrow(SpecError);
  });
});

describe("reading and table for every bar-family block", () => {
  test("each template has a how-to-read line, a data table and two note markers", async () => {
    for (const mod of [bar, waterfall, dumbbell, beeswarm]) {
      const { block, html } = await template(mod);
      expect(mod.reading!(block).length).toBeGreaterThan(40);
      const t = mod.table!(block);
      expect(t.rows.length).toBeGreaterThan(0);
      for (const row of t.rows) expect(row.length).toBe(t.head.length);
      expect(html.match(/class="x-note-marker"/g)?.length).toBe(2);
      expect(block.caveat).toBeTruthy();
    }
  });
});
