import { describe, expect, test } from "bun:test";
import { loadTheme } from "../engine/theme.ts";
import { SpecError, type BlockModule, type Diagnostic, type ElementInfo, type RawBlock, type RenderContext } from "../engine/types.ts";
import { blockModule as line } from "../engine/charts/line.ts";
import { blockModule as slope } from "../engine/charts/slope.ts";
import { blockModule as bump } from "../engine/charts/bump.ts";
import { blockModule as scatter } from "../engine/charts/scatter.ts";
import { fmt, fmtTicks } from "../engine/kit.ts";

const theme = await loadTheme();
const EVIL = "<script>alert(1)</script>";

function makeCtx(warnings: Diagnostic[] = []): RenderContext {
  return { theme, doc: { front: {}, segments: [] }, inline: (s: string) => s, warn: (d) => { warnings.push(d); } };
}

const raw = (type: string, data: unknown, at = 7): RawBlock => ({ type, info: [], body: "", data, line: at });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = BlockModule<any>;

function build(mod: Mod, data: unknown, warnings: Diagnostic[] = []) {
  const ctx = makeCtx(warnings);
  const block = mod.normalize(raw(mod.type, data), ctx);
  const html = mod.render(block, ctx);
  const elements: Record<string, ElementInfo> = mod.model!(block).elements ?? {};
  return { block, html, elements };
}

function specError(fn: () => unknown): SpecError {
  try { fn(); } catch (e) { if (e instanceof SpecError) return e; throw e; }
  throw new Error("expected a SpecError");
}

const MARK = /<g class="x-mark(?: [^"]*)?" data-id="([^"]*)"[^>]*>([\s\S]*?)<\/g>/g;

function checkShared(mod: Mod, data: () => Record<string, unknown>, blockId: string) {
  const { html, elements } = build(mod, data());
  const marks = [...html.matchAll(MARK)];
  expect(marks.length).toBeGreaterThan(0);
  const ids = marks.map((m) => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [, id, inner] of marks) {
    expect(id.startsWith(`${blockId}-`)).toBe(true);
    expect(inner).toContain("x-mark-shape");
    expect(elements[id]).toBeDefined();
  }
  expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(html).not.toMatch(/rgba?\(/);
  expect(html).not.toContain("style=");
  expect(build(mod, data()).html).toBe(html);
}

// ---------- fixtures ----------

const lineData = () => ({
  id: "visits",
  categories: ["2025-01-06", "2025-01-13", "2025-01-27", "2025-02-03"],
  y: { title: "Visits" },
  series: [
    { label: "Web", values: [120, 140, 180, 210], focal: true, about: "Visits from browsers." },
    { label: "App", values: { "2025-01-06": 80, "2025-02-03": 95 }, about: "Visits from the mobile app." },
  ],
});

const slopeData = () => ({
  id: "channels",
  columns: [2023, 2025],
  data: [
    { label: "Phone", from: 18400, to: 9200, about: "Callers moved to chat once it answered faster." },
    { label: "Chat", from: 7600, to: 21300, focal: true, about: "Now the default way to reach support." },
    { label: "Email", from: 12100, to: 10800, about: "Mostly invoices and account changes." },
  ],
});

const bumpData = () => ({
  id: "stores",
  categories: ["Q1", "Q2", "Q3"],
  series: [
    { label: "Berlin", ranks: [1, 2, 3], about: "Lost footfall after the mall closed." },
    { label: "Lisbon", ranks: [2, 1, 1], about: "Tourist season carried it to the top." },
    { label: "Warsaw", ranks: [3, 3, 2], focal: true, about: "Climbed after the second floor opened." },
  ],
});

const scatterData = () => ({
  id: "queues",
  x: { title: "First reply", format: "h" },
  y: { title: "Satisfaction", format: "%" },
  guides: { x: 4, y: 85 },
  data: [
    { label: "Billing", x: 0.5, y: 91, group: "Chat", about: "Short questions with known answers." },
    { label: "API", x: 6, y: 78, group: "Email", about: "Needs an engineer for most replies." },
    { label: "Weekend", x: 2, y: 68, group: "Email", focal: true, about: "Fast replies, but a small team can rarely solve the problem." },
    { label: "Returns", x: 1.2, y: 88, group: "Chat", about: "Scripted flow with a label printer." },
  ],
});

const withEvil = {
  line: () => { const d = lineData(); d.series[0].label = EVIL; return d; },
  slope: () => { const d = slopeData(); d.data[0].label = EVIL; return d; },
  bump: () => { const d = bumpData(); d.series[0].label = EVIL; return d; },
  scatter: () => { const d = scatterData(); d.data[0].label = EVIL; return d; },
};

// ---------- shared contract ----------

describe("shared contract", () => {
  const cases: [string, Mod, () => Record<string, unknown>, string][] = [
    ["line", line, lineData, "visits"],
    ["slope", slope, slopeData, "channels"],
    ["bump", bump, bumpData, "stores"],
    ["scatter", scatter, scatterData, "queues"],
  ];
  for (const [name, mod, data, id] of cases) {
    test(`${name}: marks, model, ids, determinism, no colors`, () => checkShared(mod, data, id));
    test(`${name}: escapes labels`, () => {
      const { html } = build(mod, withEvil[name as keyof typeof withEvil]());
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  }

  test("ids stay unique across two blocks with the same labels", () => {
    const a = build(line, { ...lineData(), id: "a" }).elements;
    const b = build(line, { ...lineData(), id: "b" }).elements;
    const shared = Object.keys(a).filter((k) => k in b);
    expect(shared).toEqual([]);
  });
});

// ---------- line ----------

describe("line", () => {
  test("normalize: ids, dates and gaps", () => {
    const { block } = build(line, lineData());
    expect(block.series[0].id).toBe("visits-web");
    expect(block.series[0].points).toEqual(["visits-web-0", "visits-web-1", "visits-web-2", "visits-web-3"]);
    expect(block.series[1].points).toEqual(["visits-app-0", "", "", "visits-app-3"]);
    expect(block.labels[0]).toBe("Jan 6");
    expect(block.times).toBeDefined();
  });

  test("dates use a time scale", () => {
    const { html } = build(line, lineData());
    const cx = (i: number) => Number(new RegExp(`data-id="visits-web-${i}"[^>]*><circle class="x-point x-mark-shape" cx="([\\d.]+)"`).exec(html)![1]);
    // 7 days, then 14 days: the second gap is twice the first.
    expect(Math.abs(cx(2) - cx(1) - 2 * (cx(1) - cx(0)))).toBeLessThan(0.5);
  });

  test("accepts YAML Date objects", () => {
    const d = { ...lineData(), categories: [0, 7, 21, 28].map((k) => new Date(Date.UTC(2025, 0, 6 + k))) };
    expect(build(line, d).block.labels).toEqual(["Jan 6", "Jan 13", "Jan 27", "Feb 3"]);
  });

  test("direct labels up to 3 series, legend above", () => {
    expect(build(line, lineData()).html).toContain("x-end-label");
    const many = { ...lineData(), series: ["A", "B", "C", "D"].map((label, i) => ({ label, values: [i, i + 1, i + 2, i + 3], about: "x" })) };
    const { html } = build(line, many);
    expect(html).not.toContain("x-end-label");
    expect(html).toContain(`class="x-legend-item" data-series="1" data-id="visits-a"`);
  });

  test("area and stack", () => {
    const one = { ...lineData(), area: true, series: [lineData().series[0]] };
    expect(build(line, one).html).toContain("x-series-area");
    const stacked = build(line, { ...lineData(), stack: true }).html;
    expect(stacked).toContain("x-stacked");
  });

  test("spec errors", () => {
    expect(specError(() => build(line, { ...lineData(), colour: "red" }))).toBeInstanceOf(SpecError);
    const short = specError(() => build(line, { ...lineData(), series: [{ label: "Web", values: [1, 2] }] }));
    expect(short.line).toBe(7);
    const ref = specError(() => build(line, { ...lineData(), series: [{ label: "Web", values: { "2030-01-01": 3 } }] }));
    expect(ref.rule).toBe("ref-exists");
    const neg = { ...lineData(), stack: true, series: [{ label: "Web", values: [1, -2, 3, 4] }] };
    expect(specError(() => build(line, neg))).toBeInstanceOf(SpecError);
  });

  test("budget warning", () => {
    const warnings: Diagnostic[] = [];
    const six = { ...lineData(), series: Array.from({ length: 6 }, (_, i) => ({ label: `S${i}`, values: [1, 2, 3, 4], about: "x" })) };
    build(line, six, warnings);
    expect(warnings.some((w) => w.rule === "budget-nodes")).toBe(true);
  });
});

// ---------- slope ----------

describe("slope", () => {
  test("normalize and model", () => {
    const { block, elements } = build(slope, slopeData());
    expect(block.columns).toEqual(["2023", "2025"]);
    expect(elements["channels-chat"].value).toBe("7,600 → 21k (+180%)");
  });

  test("tone: change marks rises and falls", () => {
    const d = slopeData();
    d.data[1].focal = false;
    const { html } = build(slope, { ...d, tone: "change" });
    expect(html).toContain(`data-tone="ok"`);
    expect(html).toContain(`data-tone="danger"`);
    expect(build(slope, slopeData()).html).not.toContain("data-tone");
  });

  test("tone never overrides focal or muted, so a line and its dots agree", () => {
    const d = slopeData();
    Object.assign(d.data[0], { muted: true });
    const { html } = build(slope, { ...d, tone: "change" });
    const toneOf = (id: string) => new RegExp(`data-id="${id}"[^>]*>`).exec(html)![0].match(/data-tone="(\w+)"/)?.[1];
    expect(toneOf("channels-chat")).toBeUndefined();  // focal: accent
    expect(toneOf("channels-phone")).toBeUndefined(); // muted: gray context
    expect(toneOf("channels-email")).toBe("danger");
  });

  test("labels keep at least 14px apart", () => {
    const d = { id: "tie", columns: ["A", "B"], data: ["One", "Two", "Three"].map((label) => ({ label, from: 5, to: 5, about: "x" })) };
    const { html } = build(slope, d);
    const ys = [...html.matchAll(/<text class="x-mark-label" x="[^"]+" y="([^"]+)" text-anchor="end">/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
    expect(ys.length).toBe(3);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(13.9);
  });

  test("spec errors", () => {
    expect(specError(() => build(slope, { ...slopeData(), columns: [1, 2, 3] }))).toBeInstanceOf(SpecError);
    const bad = { ...slopeData(), data: [{ label: "Phone", from: "abc", to: 1 }, { label: "Chat", from: 1, to: 2 }] };
    expect(specError(() => build(slope, bad)).line).toBe(7);
    expect(specError(() => build(slope, { ...slopeData(), tone: "mood" }))).toBeInstanceOf(SpecError);
  });
});

// ---------- bump ----------

describe("bump", () => {
  test("normalize, rank numbers and movement", () => {
    const { block, html, elements } = build(bump, bumpData());
    expect(block.series[2].points).toEqual(["stores-warsaw-0", "stores-warsaw-1", "stores-warsaw-2"]);
    expect(html).toContain(`x-bump-rank" x=`);
    expect(elements["stores-warsaw-2"].value).toBe("Rank 2, up 1");
    expect(elements["stores-warsaw"].type).toBe("group");
    expect(elements["stores-warsaw"].members).toEqual(block.series[2].points);
  });

  test("spec errors", () => {
    const zero = { ...bumpData(), series: [{ label: "A", ranks: [0, 1, 2] }, { label: "B", ranks: [1, 2, 3] }] };
    expect(specError(() => build(bump, zero))).toBeInstanceOf(SpecError);
    const half = { ...bumpData(), series: [{ label: "A", ranks: [1.5, 1, 2] }, { label: "B", ranks: [1, 2, 3] }] };
    expect(specError(() => build(bump, half))).toBeInstanceOf(SpecError);
    expect(specError(() => build(bump, { ...bumpData(), extra: 1 }))).toBeInstanceOf(SpecError);
  });

  test("warns on shared ranks", () => {
    const warnings: Diagnostic[] = [];
    build(bump, { ...bumpData(), series: [{ label: "A", ranks: [1, 1, 2], about: "x" }, { label: "B", ranks: [1, 2, 1], about: "x" }] }, warnings);
    expect(warnings.some((w) => w.message.includes("both rank 1"))).toBe(true);
  });
});

// ---------- scatter ----------

describe("scatter", () => {
  test("groups get a selectable legend and a group model entry", () => {
    const { html, elements } = build(scatter, scatterData());
    expect(html).toContain(`data-id="queues-chat"`);
    expect(elements["queues-chat"].type).toBe("group");
    expect(elements["queues-chat"].members).toEqual(["queues-billing", "queues-returns"]);
    expect(elements["queues-weekend"].related).toEqual(["queues-email"]);
    expect((html.match(/x-guide-line/g) ?? []).length).toBe(2);
  });

  test("bubbles draw largest first", () => {
    const d = scatterData();
    d.data.forEach((p, i) => Object.assign(p, { size: [10, 400, 40, 90][i] }));
    const { html } = build(scatter, d);
    const radii = [...html.matchAll(/class="x-point x-bubble x-mark-shape" cx="[^"]+" cy="[^"]+" r="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(radii.length).toBe(4);
    expect([...radii].sort((a, b) => b - a)).toEqual(radii);
    expect(Math.max(...radii)).toBe(28);
    expect(html).toContain("x-size-key");
  });

  test("spec errors", () => {
    const d = scatterData();
    Object.assign(d.data[0], { size: 5 });
    expect(specError(() => build(scatter, d)).message).toContain("size");
    expect(specError(() => build(scatter, { ...scatterData(), labels: "some" }))).toBeInstanceOf(SpecError);
    expect(specError(() => build(scatter, { ...scatterData(), z: {} }))).toBeInstanceOf(SpecError);
  });

  test("budget warning over 60 points", () => {
    const warnings: Diagnostic[] = [];
    const data = Array.from({ length: 61 }, (_, i) => ({ label: `P${i}`, x: i, y: i % 7, about: "x" }));
    build(scatter, { id: "many", data }, warnings);
    expect(warnings.some((w) => w.rule === "budget-nodes")).toBe(true);
  });
});

// ---------- review findings ----------

describe("format k", () => {
  test("k from 1,000 up, never mixed with grouped digits", () => {
    expect(fmt(7600, "k")).toBe("7.6k");
    expect(fmt(5000, "k")).toBe("5k");
    expect(fmt(21300, "k")).toBe("21k");
    expect(fmt(9960, "k")).toBe("10k");
    expect(fmt(1_250_000, "k")).toBe("1.3M");
    expect(fmt(950, "k")).toBe("950");
  });

  test("ticks share one unit and never repeat", () => {
    expect(fmtTicks([0, 5000, 10000, 15000], "k")).toEqual(["0", "5k", "10k", "15k"]);
    expect(fmtTicks([12000, 12500, 13000], "k")).toEqual(["12k", "12.5k", "13k"]);
    expect(fmtTicks([0, 500, 1000], "k")).toEqual(["0", "0.5k", "1k"]);
    expect(fmtTicks([0, 5000, 10000], "auto")).toEqual(["0", "5,000", "10k"]);
  });

  test("slope values and line ticks use it", () => {
    expect(build(slope, { ...slopeData(), format: "k" }).elements["channels-chat"].value).toBe("7.6k → 21k (+180%)");
    const { html } = build(line, { ...lineData(), format: "k", series: [{ label: "Web", values: [2000, 6000, 9000, 14000], about: "x" }] });
    const ticks = [...html.matchAll(/<text class="x-tick-label" x="[^"]+" y="[^"]+" text-anchor="end">([^<]+)</g)].map((m) => m[1]);
    expect(ticks.length).toBeGreaterThan(2);
    for (const t of ticks) expect(t).toMatch(/^(0|[\d.]+k)$/);
  });
});

describe("stacked line gaps", () => {
  const stacked = () => ({
    id: "mix",
    stack: true,
    categories: ["Q1", "Q2", "Q3", "Q4"],
    series: [
      { label: "Base", values: [10, null, 12, 13], about: "x" },
      { label: "Top", values: [5, 6, 7, 8] as (number | null)[], about: "x" },
    ],
  });

  test("a gap breaks its band and every band above it instead of reading as zero", () => {
    const warnings: Diagnostic[] = [];
    const { block, html, elements } = build(line, stacked(), warnings);
    expect(block.series[0].points).toEqual(["mix-base-0", "", "mix-base-2", "mix-base-3"]);
    expect(block.series[1].points).toEqual(["mix-top-0", "", "mix-top-2", "mix-top-3"]);
    expect(elements["mix-top-1"]).toBeUndefined();
    expect(warnings.some((w) => w.message.includes("Top at Q2"))).toBe(true);
    // Each series draws two runs (Q1, then Q3–Q4): two area pieces and a line with two moves.
    const top = new RegExp(`data-id="mix-top"[^>]*>([\\s\\S]*?)</g>`).exec(html)![1];
    expect((top.match(/x-series-area x-stacked/g) ?? []).length).toBe(2);
    expect((/class="x-series-line x-mark-shape" d="([^"]+)"/.exec(top)![1].match(/M/g) ?? []).length).toBe(2);
  });

  test("a series that sits only on gaps is a spec error", () => {
    const d = stacked();
    d.series[0].values = [10, null, null, null];
    d.series[1].values = [null, 6, 7, 8];
    expect(specError(() => build(line, d)).message).toContain("no part of its band");
  });

  test("gaps without stack still just break the line", () => {
    const warnings: Diagnostic[] = [];
    const { block } = build(line, { ...stacked(), stack: false }, warnings);
    expect(block.series[1].points.every(Boolean)).toBe(true);
    expect(warnings.some((w) => w.message.includes("breaks its band"))).toBe(false);
  });
});

describe("bump muted ranks", () => {
  test("muted dots give their rank digits the text ink", async () => {
    const css = await Bun.file(new URL("../styles/blocks/charts-lines.css", import.meta.url)).text();
    expect(css).toMatch(/\[data-layout="bump"\] \.x-mark\[data-muted="true"\] \.x-bump-rank \{ fill: var\(--x-text\); \}/);
    // A selected series (muted or pale at rest) is cloned from its computed stroke: its hue pulled toward the text ink.
    expect(css).toMatch(/:is\(\.is-selected, \.is-cmp\):not\(\[data-focal="true"\]\) \.x-series-line\.x-mark-shape \{\s*stroke: color-mix\(in oklab, var\(--x-hue\) 70%, var\(--x-text\)\);/);
    const d = bumpData();
    Object.assign(d.series[0], { muted: true });
    const { html } = build(bump, d);
    expect(html).toMatch(/data-id="stores-berlin-0"[^>]*data-muted="true"[^>]*>[\s\S]*?x-bump-rank/);
  });
});

// ---------- per type: shared keys, cards, reading, table ----------

describe("line per type", () => {
  test("marks, bands, unit and notes", () => {
    const d = {
      ...lineData(), unit: "visits",
      marks: [{ y: 150, label: "Goal" }, { x: "2025-01-27", label: "Launch" }],
      bands: [{ from: 100, to: 130, label: "Normal" }],
      notes: [{ on: "visits-web-3", text: "Best week." }, "Plain note."],
      caveat: "Bots are filtered out.",
    };
    const { block, html, elements } = build(line, d);
    expect((html.match(/class="x-ref-line"/g) ?? []).length).toBe(2);
    expect(html).not.toContain(`class="x-ref"`); // the prose link class, which the client dims and hit-tests
    expect(html).toContain("x-ref-band");
    expect(html).toContain(`data-note="1" data-for="visits-web-3"`);
    expect(html).not.toContain(`data-note="2"`);
    expect(block.caveat).toBe("Bots are filtered out.");
    expect(elements["visits-web-3"].value).toBe("210 visits");
    expect(html).toContain(">Visits</text>"); // the y title wins over the word unit
  });

  test("mark and note targets are checked", () => {
    expect(specError(() => build(line, { ...lineData(), marks: [{ x: "2030-01-01" }] })).rule).toBe("ref-exists");
    expect(specError(() => build(line, { ...lineData(), marks: [{ y: "high" }] }))).toBeInstanceOf(SpecError);
    expect(specError(() => build(line, { ...lineData(), notes: [{ on: "nope", text: "x" }] })).rule).toBe("ref-exists");
    expect(specError(() => build(line, { ...lineData(), story: ["visits-web", { sel: "gone" }] })).rule).toBe("ref-exists");
    const cats = { ...lineData(), categories: ["a", "b", "c", "d"], series: [{ label: "Web", values: [1, 2, 3, 4], about: "x" }] };
    expect(() => build(line, { ...cats, marks: [{ x: "c" }, { y: "mean" }] })).not.toThrow();
  });

  test("series and point cards", () => {
    const { elements } = build(line, lineData());
    const web = elements["visits-web"];
    expect(web.pos).toBe("1 of 2");
    expect(web.value).toBe("210 at Feb 3");
    expect(web.facts?.[0]).toEqual({ k: "Since Jan 6", v: "+90 (+75%)", tone: "up" });
    expect(web.say).toBe("Web, 210 at Feb 3, +90 (+75%) since Jan 6, 1st of 2");
    const pt = elements["visits-web-2"];
    expect(pt.pos).toBe("3 of 4");
    expect(pt.context).toEqual(["visits-web-0", "visits-web-1", "visits-web-3"]);
    expect(pt.facts?.[0]).toMatchObject({ k: "vs Jan 13", v: "+40 (+29%)", tone: "up", ref: "visits-web-1" });
    expect(elements["visits-app-3"].facts?.[0].k).toBe("vs Jan 6");
  });

  test("reading and table", () => {
    const { block } = build(line, lineData());
    expect(line.reading!(block)).toBe("Each line is one series from Jan 6 to Feb 3; higher means more visits. The accent line is Web; breaks are missing values.");
    expect(line.table!(block)).toEqual({
      head: ["Date", "Web", "App"],
      rows: [["2025-01-06", "120", "80"], ["2025-01-13", "140", ""], ["2025-01-27", "180", ""], ["2025-02-03", "210", "95"]],
    });
  });
});

describe("slope per type", () => {
  test("cards, reading, table and notes", () => {
    const { block, html, elements } = build(slope, { ...slopeData(), notes: [{ on: "channels-chat", text: "Chat overtook phone." }] });
    const chat = elements["channels-chat"];
    expect(chat.pos).toBe("1 of 3");
    expect(chat.facts?.map((f) => f.k)).toEqual(["Change", "Rank", "2023", "2025"]);
    expect(chat.facts?.[1].v).toBe("3rd → 1st of 3 (up 2)");
    expect(chat.say).toBe("Chat, 7,600 in 2023 to 21k in 2025, +14k, 1st of 3 in 2025");
    expect(html).toContain(`data-note="1" data-for="channels-chat"`);
    expect(slope.reading!(block)).toContain("The accent line is Chat.");
    expect(slope.table!(block).rows[1]).toEqual(["Chat", "7,600", "21,300", "+13,700"]);
    expect(specError(() => build(slope, { ...slopeData(), story: ["nope"] })).rule).toBe("ref-exists");
  });

  test("percent values change by points", () => {
    const d = { id: "share", columns: ["A", "B"], format: "%", data: [{ label: "X", from: 40, to: 46, about: "x" }, { label: "Y", from: 60, to: 54, about: "x" }] };
    expect(build(slope, d).elements["share-x"].value).toBe("40% → 46% (+6 pts)");
  });
});

describe("bump per type", () => {
  test("cards, reading and table", () => {
    const { block, elements } = build(bump, bumpData());
    const warsaw = elements["stores-warsaw"];
    expect(warsaw.pos).toBe("2 of 3");
    expect(warsaw.facts?.[0]).toEqual({ k: "Q1 → Q3", v: "3rd → 2nd (up 1)", tone: "up" });
    expect(warsaw.say).toBe("Warsaw, 2nd in Q3, up 1 since Q1");
    const dot = elements["stores-berlin-2"];
    expect(dot.pos).toBe("3 of 3");
    expect(dot.facts?.[1]).toMatchObject({ k: "vs Q2", v: "down 1", tone: "down" });
    expect(dot.context).toEqual(["stores-berlin-0", "stores-berlin-1"]);
    expect(bump.reading!(block)).toContain("lines that cross swapped places");
    expect(bump.table!(block)).toEqual({ head: ["Series", "Q1", "Q2", "Q3"], rows: [["Berlin", "1", "2", "3"], ["Lisbon", "2", "1", "1"], ["Warsaw", "3", "3", "2"]] });
  });

  test("notes place a marker on a dot", () => {
    const { html } = build(bump, { ...bumpData(), notes: [{ on: "stores-warsaw-2", text: "Second floor opened." }] });
    expect(html).toContain(`data-note="1" data-for="stores-warsaw-2"`);
  });
});

describe("scatter per type", () => {
  test("marks at mean, bands, unit and notes", () => {
    const d = { ...scatterData(), marks: [{ y: "mean", label: "Average" }], bands: [{ from: 80, to: 90, label: "Target" }], notes: [{ on: "queues-weekend", text: "Small team." }] };
    const { html } = build(scatter, d);
    expect(html).toContain(">Average<");
    expect(html).toContain("x-ref-band");
    expect(html).toContain(`data-note="1" data-for="queues-weekend"`);
    expect(specError(() => build(scatter, { ...scatterData(), bands: [{ from: "low", to: 3 }] }))).toBeInstanceOf(SpecError);
    const money = build(scatter, { ...scatterData(), unit: "$", y: { title: "Revenue" } });
    expect(money.elements["queues-api"].value).toContain("Revenue $78");
  });

  test("cards, reading and table", () => {
    const { block, elements } = build(scatter, scatterData());
    const w = elements["queues-weekend"];
    expect(w.pos).toBe("4 of 4");
    expect(w.context).toEqual(["queues-api"]);
    expect(w.facts?.find((f) => f.k === "vs Satisfaction guide")).toEqual({ k: "vs Satisfaction guide", v: "−17%", tone: "down" });
    expect(w.facts?.at(-1)).toEqual({ k: "Group", v: "Email", ref: "queues-email" });
    expect(elements["queues-chat"].value).toBe("2 points");
    expect(scatter.reading!(block)).toBe("Each dot is one item: across is first reply, up is satisfaction; color is the group. The accent dot is Weekend; dashed rules and shaded ranges are references.");
    expect(scatter.table!(block).head).toEqual(["Item", "First reply", "Satisfaction", "Group"]);
    expect(scatter.table!(block).rows[0]).toEqual(["Billing", "0.50 h", "91%", "Chat"]);
  });
});
