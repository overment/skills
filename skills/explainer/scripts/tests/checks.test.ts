import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { auditStates, combos, formatResults, inspect, merge, parseShots, problemKey, type Findings } from "../commands/audit.ts";
import { captureHash, cropBox } from "../commands/shot.ts";
import { textWidth } from "../engine/figure/grid.ts";
import { lint } from "../engine/lint.ts";
import type { Block, Diagnostic, EdgeSpec, FigureBlock, NodeSpec, ParsedDoc, Segment, SequenceBlock, Theme } from "../engine/types.ts";
import { chromeAvailable, launchChrome } from "../lib/cdp.ts";
import { COMMANDS, commandTable, helpText, usage } from "../lib/commands.ts";
import {
  composite, contrastRatio, coverage, engineEllipses, geometryScript, overlapArea, polylineHitsRect, repeatsEndpoints,
  saturate, segmentHitsRect, strokeFootprint, type Geometry,
} from "../lib/geometry.ts";

const colors = {
  bg: "#ffffff", surface: "#fafafa", "surface-2": "#f0f0f0", line: "#e0e0e0", "line-strong": "#b0b0b0",
  text: "#111111", "text-dim": "#555555", "text-faint": "#999999", accent: "#3355ff",
  ok: "#118833", warn: "#aa6600", danger: "#cc2222", info: "#2266cc", link: "#7744cc",
};
const THEME: Theme = {
  name: "test",
  fonts: {
    sans: { family: "Test Sans", fallback: "sans-serif", faces: [] },
    mono: { family: "Test Mono", fallback: "monospace", faces: [] },
  },
  colors: { light: colors, dark: colors },
  type: { caption: 12, ui: 13, body: 16, h2: 22, h1: 32, nodeLabel: 14, nodeSub: 12, edgeLabel: 11, tag: 11 },
  radius: 6,
  grid: { unit: 8, cell: [160, 64], gap: [104, 48], pad: 32 },
};

const node = (id: string, over: Partial<NodeSpec> = {}): NodeSpec => ({
  id, label: `Part ${id}`, at: [0, 0], span: [1, 1], kind: "service", focal: false, about: "Handles work for the caller and answers within a second, so nothing upstream has to wait on it.", tags: [], ...over,
});
const edge = (from: string, to: string, over: Partial<EdgeSpec> = {}): EdgeSpec => ({ id: `${from}->${to}`, from, to, kind: "flow", ...over });
const figure = (over: Partial<FigureBlock> = {}): FigureBlock => ({
  type: "figure", id: "fig", layout: "flow", grid: [5, 3],
  nodes: [node("a"), node("b", { at: [2, 0] })], edges: [edge("a", "b")], groups: [], scenes: [], legend: false, line: 10, ...over,
});
const sequence = (over: Partial<SequenceBlock> = {}): SequenceBlock => ({
  type: "figure", id: "seq", layout: "sequence",
  actors: [node("x"), node("y", { at: [1, 0] })], messages: [edge("x", "y", { id: "m1", label: "asks" })], scenes: [], legend: false, line: 20, ...over,
});
const doc = (segments: Segment[] = []): ParsedDoc => ({ front: {}, segments });
const nodes = (n: number) => Array.from({ length: n }, (_, i) => node(`n${i}`, { at: [i % 5, Math.floor(i / 5)] }));
const rules = (list: Diagnostic[]) => list.map((d) => d.rule);
const check = (blocks: Block[], segments: Segment[] = []) => lint(doc(segments), blocks, THEME);

describe("lint", () => {
  test("a clean document has no diagnostics", () => {
    expect(check([figure(), sequence(), { type: "steps", for: "fig", line: 30 }])).toEqual([]);
  });

  test("about-thin: a few words only name the part; two or three sentences explain it", () => {
    const thin = figure({ nodes: [node("a", { about: "Stores orders." }), node("b")] });
    expect(rules(check([thin]))).toContain("about-thin");
    expect(rules(check([figure()]))).not.toContain("about-thin");
  });

  test("budget-nodes", () => {
    expect(rules(check([figure({ nodes: nodes(10), edges: [] })]))).toContain("budget-nodes");
    expect(rules(check([figure({ nodes: nodes(9), edges: [] })]))).not.toContain("budget-nodes");
  });

  test("budget-edges", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => edge("a", "b", { id: `a->b#${i}` }));
    expect(rules(check([figure({ edges: many(13) })]))).toContain("budget-edges");
    expect(rules(check([figure({ edges: many(12) })]))).not.toContain("budget-edges");
  });

  test("budget-focal is an error", () => {
    const focal = nodes(3).map((n) => ({ ...n, focal: true }));
    const found = check([figure({ nodes: focal, edges: [] })]).find((d) => d.rule === "budget-focal");
    expect(found?.severity).toBe("error");
    expect(rules(check([figure({ nodes: focal.slice(0, 2), edges: [] })]))).not.toContain("budget-focal");
  });

  test("label-fit", () => {
    const label = "Authorization gateway service";
    expect(textWidth(label, THEME.type.nodeLabel, "sans")).toBeGreaterThan(160 - 24);
    expect(textWidth(label, THEME.type.nodeLabel, "sans")).toBeLessThan(2 * 160 + 104 - 24);
    const wide = (span: [number, number]) => figure({ nodes: [node("a", { label, span }), node("b", { at: [3, 0] })] });
    expect(rules(check([wide([1, 1])]))).toContain("label-fit");
    expect(rules(check([wide([2, 1])]))).not.toContain("label-fit");
  });

  test("edge-label", () => {
    const labelled = (label: string) => figure({ edges: [edge("a", "b", { label })] });
    expect(rules(check([labelled("sends the signed token now")]))).toContain("edge-label");
    expect(rules(check([labelled("authorizationheader")]))).toContain("edge-label");
    expect(rules(check([labelled("sends token")]))).not.toContain("edge-label");
  });

  test("about-missing", () => {
    expect(rules(check([figure({ nodes: [node("a", { about: undefined }), node("b", { at: [2, 0] })] })]))).toContain("about-missing");
    expect(rules(check([figure()]))).not.toContain("about-missing");
  });

  test("about-repeats", () => {
    const fig = (about: string) => figure({ nodes: [node("a", { label: "Gateway", about }), node("b", { at: [2, 0] })] });
    expect(rules(check([fig("Gateway checks every token.")]))).toContain("about-repeats");
    expect(rules(check([fig("Checks every token.")]))).not.toContain("about-repeats");
  });

  test("sentence-long: a sentence over 25 words is flagged in explanations, notes and prose (ASD-STE100)", () => {
    const long = "This part reads every request, checks the token against the cache, writes a line to the audit log and then passes the request to the service behind it.";
    const split = "This part reads every request. It checks the token against the cache and writes a line to the audit log.";
    const withAbout = (about: string) => figure({ nodes: [node("a", { about }), node("b", { at: [2, 0] })] });
    expect(rules(check([withAbout(long)]))).toContain("sentence-long");
    expect(rules(check([withAbout(split)]))).not.toContain("sentence-long");
    expect(rules(check([figure({ notes: [{ on: ["a"], text: long }] })]))).toContain("sentence-long");
    expect(rules(check([figure()], [{ kind: "markdown", text: long, line: 1 }]))).toContain("sentence-long");
  });

  test("label-duplicate is case-insensitive", () => {
    const fig = (second: string) => figure({ nodes: [node("a", { label: "Orders" }), node("b", { at: [2, 0], label: second })] });
    expect(rules(check([fig("orders")]))).toContain("label-duplicate");
    expect(rules(check([fig("Payments")]))).not.toContain("label-duplicate");
  });

  test("ref-exists for prose links, with the link's line", () => {
    const text = "## Big picture\nSee [a](#a), [top](#big-picture) and [sel](#sel=a).\nThen [gone](#nope).\n```\n[code](#also-nope)\n```";
    const found = check([figure()], [{ kind: "markdown", text, line: 3 }]);
    expect(found).toEqual([{ rule: "ref-exists", severity: "error", message: expect.stringContaining("#nope"), line: 5 }]);
  });

  test("ref-exists looks inside containers", () => {
    const inner: Segment = { kind: "markdown", text: "[x](#missing)", line: 8 };
    const found = check([], [{ kind: "container", layout: "split", args: [], children: [inner], line: 7 }]);
    expect(found.map((d) => [d.rule, d.line])).toEqual([["ref-exists", 8]]);
  });

  test("ref-exists for steps", () => {
    expect(rules(check([figure(), { type: "steps", for: "missing", line: 30 }]))).toEqual(["ref-exists"]);
    expect(check([figure(), { type: "steps", for: "fig", line: 30 }])).toEqual([]);
  });

  test("sequence rules", () => {
    const actors = Array.from({ length: 6 }, (_, i) => node(`s${i}`, { at: [i, 0] }));
    expect(rules(check([sequence({ actors })]))).toContain("budget-nodes");
    expect(rules(check([sequence({ actors: [node("x", { about: undefined }), node("y")] })]))).toContain("about-missing");
    expect(rules(check([sequence({ messages: [edge("x", "y", { id: "m1", label: "asks for the latest order list" })] })]))).toContain("edge-label");
    const messages = Array.from({ length: 13 }, (_, i) => edge("x", "y", { id: `m${i + 1}` }));
    expect(rules(check([sequence({ messages })]))).toContain("budget-edges");
  });

  test("identical diagnostics are reported once", () => {
    const fig = figure({ nodes: [node("a", { about: undefined }), node("b", { at: [2, 0] })] });
    expect(check([fig, fig]).filter((d) => d.rule === "about-missing")).toHaveLength(1);
  });
});

describe("cdp", () => {
  test.skipIf(!chromeAvailable())(
    "launches, evaluates, screenshots and cleans up",
    async () => {
      const browser = await launchChrome();
      const profile = browser.profile;
      try {
        const page = await browser.newPage();
        expect(await page.evaluate<boolean>("1 + 1 === 2")).toBe(true);
        await page.goto(`data:text/html,${encodeURIComponent("<p style='font:40px sans-serif'>hello</p>")}`);
        const png = await page.screenshot();
        expect([png[0], png[1]]).toEqual([0x89, 0x50]);
      } finally {
        await browser.close();
      }
      expect(existsSync(profile)).toBe(false);
    },
    30_000,
  );
});

// ---------- WP2: capture and audit ----------

describe("geometry: segment × rect", () => {
  const box = { x: 10, y: 10, w: 20, h: 10 };
  test("a segment through the box hits it", () => {
    expect(segmentHitsRect(0, 15, 40, 15, box)).toBe(true);
    expect(segmentHitsRect(0, 0, 40, 30, box)).toBe(true); // diagonal
  });
  test("a segment that ends inside the box hits it", () => {
    expect(segmentHitsRect(0, 15, 12, 15, box)).toBe(true);
    expect(segmentHitsRect(15, 12, 16, 13, box)).toBe(true); // wholly inside
  });
  test("segments beside, above, or stopping short miss", () => {
    expect(segmentHitsRect(0, 5, 40, 5, box)).toBe(false);
    expect(segmentHitsRect(35, 0, 35, 40, box)).toBe(false);
    expect(segmentHitsRect(0, 15, 9, 15, box)).toBe(false);
    expect(segmentHitsRect(0, 0, 9, 40, box)).toBe(false);
  });
  test("the Courier routing case: a link into the dot crosses the label beside it", () => {
    // wardley template: label "Courier routing" at x 359–463, ink y 188–197; link ordering → routing
    const label = { x: 359, y: 188, w: 104, h: 9 };
    expect(segmentHitsRect(496.8, 108.2, 400.1, 205.2, label)).toBe(true);
    expect(segmentHitsRect(401.9, 212.2, 743.7, 315.1, label)).toBe(false); // routing → maps leaves below
  });
  test("touching an edge counts; empty boxes never hit", () => {
    expect(segmentHitsRect(0, 10, 40, 10, box)).toBe(true);
    expect(segmentHitsRect(0, 15, 40, 15, { x: 10, y: 10, w: 0, h: 10 })).toBe(false);
  });
  test("polylineHitsRect returns the first segment that hits", () => {
    expect(polylineHitsRect([[0, 0], [5, 0], [5, 15], [40, 15]], box)).toBe(2);
    expect(polylineHitsRect([[0, 0], [40, 0]], box)).toBe(-1);
  });
});

describe("geometry: occlusion", () => {
  test("overlapArea", () => {
    expect(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(25);
    expect(overlapArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(0);
  });
  test("coverage is the share of the parts' area the card hides", () => {
    const card = { x: 0, y: 0, w: 50, h: 50 };
    expect(coverage(card, [{ x: 0, y: 0, w: 100, h: 50 }])).toBe(0.5);
    expect(coverage(card, [{ x: 0, y: 0, w: 10, h: 10 }, { x: 200, y: 0, w: 10, h: 10 }])).toBe(0.5);
    expect(coverage(card, [])).toBe(0);
  });
  test("a stroke's footprint follows the line, not its bounding box", () => {
    const diagonal = strokeFootprint([[0, 0], [300, 300]], 4, 3);
    // A card in the empty corner of the diagonal's bounding box hides nothing of it.
    expect(coverage({ x: 200, y: 0, w: 100, h: 60 }, diagonal)).toBe(0);
    // A card on the middle of the line hides about a third of it.
    expect(coverage({ x: 100, y: 100, w: 100, h: 100 }, diagonal)).toBeCloseTo(1 / 3, 1);
  });
  test("25% of the related area is the limit audit reports against", () => {
    const related = [{ x: 0, y: 0, w: 100, h: 40 }]; // an edge label strip
    expect(coverage({ x: 0, y: 0, w: 25, h: 40 }, related)).toBe(0.25);
    expect(coverage({ x: 0, y: 0, w: 26, h: 40 }, related)).toBeGreaterThan(0.25);
  });
});

describe("geometry: colour", () => {
  test("WCAG contrast", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBe(1);
    expect(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2);
    expect(contrastRatio([0x95, 0x95, 0x95], [255, 255, 255])).toBeLessThan(3);
  });
  test("composite", () => {
    expect(composite([0, 0, 0, 0.5], [255, 255, 255])).toEqual([128, 128, 128]);
    expect(composite([10, 20, 30, 1], [255, 255, 255])).toEqual([10, 20, 30]);
    expect(composite([10, 20, 30, 0], [1, 2, 3])).toEqual([1, 2, 3]);
  });
  test("a dimmed label: #555 at 32% opacity on white fails 3:1, at 70% it passes", () => {
    const white: [number, number, number] = [255, 255, 255];
    expect(contrastRatio(composite([0x55, 0x55, 0x55, 0.32], white), white)).toBeLessThan(3);
    expect(contrastRatio(composite([0x55, 0x55, 0x55, 0.7], white), white)).toBeGreaterThan(3);
  });
  test("saturate", () => {
    expect(saturate([200, 80, 40], 1)).toEqual([200, 80, 40]);
    const [r, g, b] = saturate([200, 80, 40], 0);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(1);
    const grey = saturate([120, 120, 120], 0.3);
    expect(grey).toEqual([120, 120, 120]);
  });
});

describe("wording and ellipsis rules", () => {
  test("a row that names both ends repeats them", () => {
    expect(repeatsEndpoints("→ Security review → Public launch Public launch", "Security review", "Public launch")).toBe(true);
    expect(repeatsEndpoints("→ Chat → Bot answer  Bot answer", "Chat", "Bot answer")).toBe(true);
    expect(repeatsEndpoints("→ writes findings Shared memory", "Researcher", "Shared memory")).toBe(false);
    expect(repeatsEndpoints("Waits for Backend", "Security review", "Backend")).toBe(false);
  });
  test("names match whole: a source name inside the target's name is not a repeat", () => {
    expect(repeatsEndpoints("Extended by CardPayment", "Payment", "CardPayment")).toBe(false);
    expect(repeatsEndpoints("Stories Search by name", "Search", "Search by name")).toBe(false);
    expect(repeatsEndpoints("Stage Sentiment at Discover", "Discover", "Sentiment at Discover")).toBe(false);
    expect(repeatsEndpoints("Backend → Security review Backend", "Security review", "Backend")).toBe(true);
  });
  test("engine ellipsis: only a … the source doesn't contain", () => {
    const source = "label: Wait for it…\nabout: Loads the timestamp field";
    expect(engineEllipses(["Wait for it…", "timestamp…", "no dots"], source)).toEqual(["timestamp…"]);
    expect(engineEllipses(["He said: Wait for it… twice"], source)).toEqual([]);
    expect(engineEllipses(["Each level (L1, L2…) splits the one above"], source)).toEqual([]);
    expect(engineEllipses(["Loads the timest…"], source)).toEqual(["Loads the timest…"]);
  });
  test("geometryScript defines every helper and they call each other", () => {
    const g = new Function("window", `${geometryScript()}; return window.__xg;`)({}) as Geometry;
    expect(g.polylineHitsRect([[0, 5], [20, 5]], { x: 5, y: 0, w: 5, h: 10 })).toBe(0);
    expect(g.coverage({ x: 0, y: 0, w: 5, h: 5 }, [{ x: 0, y: 0, w: 10, h: 5 }])).toBe(0.5);
  });
});

describe("audit planning and report", () => {
  test("parseShots accepts strings, lists and maps", () => {
    expect(parseShots("sel=a&theme=dark").states).toEqual([{ label: "sel=a&theme=dark", hash: "sel=a&theme=dark" }]);
    expect(parseShots(["#sel=a", { state: "sel=b", name: "b selected" }]).states.map((s) => s.label)).toEqual(["sel=a", "b selected"]);
    expect(parseShots({ zoomed: "sel=c&view=full" }).states).toEqual([{ label: "zoomed", hash: "sel=c&view=full" }]);
    expect(parseShots([42]).errors).toHaveLength(1);
    expect(parseShots(undefined)).toEqual({ states: [], errors: [] });
  });
  test("states: rest, focal, the related pick and shots, without duplicates", () => {
    const states = auditStates({ focal: "gw", related: "db" }, [{ label: "x", hash: "sel=gw" }, { label: "y", hash: "sel=q" }]);
    expect(states.map((s) => s.hash)).toEqual(["", "sel=gw", "sel=db", "sel=q"]);
    expect(auditStates({ focal: null, related: null }).map((s) => s.label)).toEqual(["rest"]);
  });
  test("every state runs in light and dark, bare and full, unless it names its own", () => {
    expect(combos({ label: "rest", hash: "" }).map((c) => c.where)).toEqual(["light/bare", "light/full", "dark/bare", "dark/full"]);
    const fixed = combos({ label: "s", hash: "sel=a&theme=dark" });
    expect(fixed.map((c) => c.where)).toEqual(["dark/bare", "dark/full"]);
    expect(fixed[0].hash).toContain("capture=1");
  });
  test("merge folds problems across states and marks what could not run as skipped", () => {
    const rest = { label: "rest", hash: "" };
    const sel = { label: "sel=a", hash: "sel=a" };
    const f = (o: Findings) => o;
    const results = merge([
      { state: rest, where: "light/bare", all: 2, findings: f({ "label × line": { ran: true, problems: ["A crossed by b"] }, ring: { ran: false, problems: [], skip: "no ring layer" } }) },
      { state: rest, where: "dark/bare", all: 2, findings: f({ "label × line": { ran: true, problems: ["A crossed by b"] } }) },
      { state: sel, where: "dark/full", all: 4, findings: f({ "card covers related": { ran: true, problems: ["the card hides 31% of x"] } }) },
      { state: sel, where: "light/full", all: 4, findings: f({ "card covers related": { ran: true, problems: ["the card hides 30% of x"] } }) },
    ]);
    const by = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(by["label × line"].problems).toEqual([{ problem: "A crossed by b", where: ["rest"] }]);
    expect(by["card covers related"].problems).toHaveLength(1);
    expect(by["card covers related"].problems[0].where).toEqual(["sel=a (dark/full, light/full)"]);
    expect(by.ring.status).toBe("skip");
    const lines = formatResults(results);
    expect(lines).toContain("– ring: skipped, no ring layer");
    expect(lines.some((l) => l.startsWith("✓ ring"))).toBe(false);
    expect(lines.at(-1)).toBe("2 of 2 checks failed · 1 skipped");
    expect(problemKey("hides 95% of x")).toBe(problemKey("hides 94% of x"));
  });
});

describe("shot state", () => {
  test("captureHash keeps every state key, lets --view win, and adds capture=1 last", () => {
    const { hash, unknown } = captureHash("#sel=a->b&cmp=c&hide=s1,s2&range=0,3&view=bare&selected=x", "full");
    const p = new URLSearchParams(hash);
    expect(p.get("sel")).toBe("a->b");
    expect(p.get("cmp")).toBe("c");
    expect(p.get("hide")).toBe("s1,s2");
    expect(p.get("range")).toBe("0,3");
    expect(p.get("view")).toBe("full");
    expect(hash.endsWith("capture=1")).toBe(true);
    expect(unknown).toEqual(["selected"]);
  });
});

describe("command list", () => {
  test("every command has a module, and help and the SKILL table come from the same list", async () => {
    const names = Object.keys(COMMANDS).filter((n) => n !== "help");
    for (const name of names) expect(existsSync(join(import.meta.dir, "../commands", `${name}.ts`))).toBe(true);
    const table = commandTable().split("\n");
    expect(table.slice(2)).toHaveLength(Object.keys(COMMANDS).length);
    for (const c of Object.values(COMMANDS)) {
      expect(helpText()).toContain(c.usage);
      expect(table.some((row) => row.includes(c.usage.replace(/\|/g, "\\|")))).toBe(true);
    }
    expect(usage("shot")).toBe(`usage: explainer ${COMMANDS.shot.usage}`);
  });
});

const FIXTURE = `<!doctype html><html data-theme="light"><head><style>
:root { --x-bg: #ffffff; --x-accent: #d9480f; --x-text: #111111; }
body { margin: 0; background: #fff; font: 14px sans-serif; }
.x-content { width: 600px; margin: 0 auto; }
.x-figure { position: relative; margin: 0; }
.x-pop { position: absolute; left: 60px; top: 30px; width: 160px; height: 60px; background: #eee; }
.is-dimmed { opacity: .3; }
</style></head><body><main class="x-page"><div class="x-content">
<figure class="x-figure" data-figure="fig"><svg class="x-svg" viewBox="0 0 400 200" width="400" height="200">
<g class="x-edge" data-id="a->b"><path class="x-edge-line" d="M10,10 L390,190" stroke="#888" fill="none"/></g>
<g class="x-mark is-selected" data-id="b"><rect class="x-mark-shape" x="60" y="40" width="60" height="30" fill="#d9480f"/></g>
<g class="x-mark is-dimmed" data-id="c"><text class="x-mark-label" x="150" y="80">Crossed label</text></g>
<g class="x-mark" data-id="d"><text class="x-mark-label" x="360" y="20">Runs off the edge</text></g>
<g class="x-edge" data-id="b->d"><path class="x-edge-line" d="M200,150 L200,260" stroke="#888" fill="none"/></g>
</svg><div class="x-pop" data-for="fig">Card</div></figure>
<div class="x-block" data-id="wide" style="width: 900px">wide</div>
</div></main>
<script type="application/json" id="x-model">{"elements":{"a->b":{"id":"a->b","type":"edge","label":"","from":"a","to":"b"},"b":{"id":"b","type":"item","label":"B"},"c":{"id":"c","type":"item","label":"C"},"d":{"id":"d","type":"item","label":"D"}}}</script>
</body></html>`;

describe("audit in the page", () => {
  test.skipIf(!chromeAvailable())(
    "finds a crossed label, clipped text, a wide block, a covering card and dimmed text under 3:1",
    async () => {
      const browser = await launchChrome();
      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(`data:text/html,${encodeURIComponent(FIXTURE)}`);
        await page.evaluate(geometryScript());
        const found = await page.call(inspect, { sel: "b", source: "no ellipsis here" });
        expect(found["label × line"].problems).toContain("Crossed label crossed by a -> b");
        expect(found["text clipped"].problems.some((p) => p.includes("Runs off the edge") && p.includes("right edge"))).toBe(true);
        expect(found["figure wider than column"].problems.some((p) => p.startsWith("wide is 900px wide"))).toBe(true);
        expect(found["card covers selected"].problems[0]).toMatch(/^the card hides \d+% of B$/);
        expect(found["dimmed contrast"].problems.some((p) => p.startsWith('"Crossed label"'))).toBe(true);
        expect(found["line clipped"].problems).toHaveLength(1);
        expect(found["line clipped"].problems[0]).toMatch(/^b -> d runs outside fig \(at 200, 20\d\)$/);
        expect(found.ring.problems[0] ?? "").not.toContain("focal"); // b isn't focal, and there is no ring layer
        const box = await page.call(cropBox, "fig", 0, false);
        expect("error" in box ? box.error : box.width).toBeGreaterThanOrEqual(400);
      } finally {
        await browser.close();
      }
    },
    30_000,
  );
});

const LINE_RING = (halo: boolean) => `<!doctype html><html><head><style>
:root { --x-bg: #ffffff; --x-accent: #d9480f; } body { margin: 0; background: #fff; }
</style></head><body><div class="x-content"><figure class="x-figure" data-figure="f"><svg class="x-svg" viewBox="0 0 300 100" width="300" height="100">
<g class="x-mark is-selected" data-id="s" data-focal="true"><path class="x-series-line" d="M10,50 L290,50" stroke="#d9480f" stroke-width="2" fill="none"/></g>
<g class="x-sel-layer">${halo ? '<path class="x-sel-halo" d="M10,50 L290,50" stroke="#fff" stroke-width="8" fill="none"/>' : ""}
<path class="x-sel-ring x-sel-clone" d="M10,50 L290,50" stroke="#d9480f" stroke-width="3.5" fill="none"/>
<path class="x-sel-ring x-ring-hover" d="M10,50 L290,50" stroke="#eeeeee" fill="none"/></g>
</svg></figure></div>
<script type="application/json" id="x-model">{"elements":{"s":{"id":"s","type":"item","label":"Mobile"}}}</script></body></html>`;

describe("ring for a selected line", () => {
  test.skipIf(!chromeAvailable())(
    "a clone in the series' own hue over a bg halo passes; without the halo it fails",
    async () => {
      const browser = await launchChrome();
      try {
        const page = await browser.newPage();
        for (const [halo, expected] of [[true, []], [false, ["the selected line Mobile has no .x-sel-halo, so it doesn't stand off the lines it crosses"]]] as const) {
          await page.goto(`data:text/html,${encodeURIComponent(LINE_RING(halo))}`);
          await page.evaluate(geometryScript());
          const found = await page.call(inspect, { sel: "s", source: null });
          expect(found.ring.problems).toEqual([...expected]);
        }
      } finally {
        await browser.close();
      }
    },
    30_000,
  );
});

describe("cdp cleanup on signals", () => {
  for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]] as const) {
    test.skipIf(!chromeAvailable())(
      `${signal} kills Chrome and removes its profile`,
      async () => {
        const script = `import { launchChrome } from ${JSON.stringify(join(import.meta.dir, "../lib/cdp.ts"))};
const b = await launchChrome(); console.log(b.profile); await new Promise(() => {});`;
        const child = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "inherit" });
        const reader = child.stdout.getReader();
        let out = "";
        while (!out.includes("\n")) {
          const { value, done } = await reader.read();
          if (done) break;
          out += new TextDecoder().decode(value);
        }
        const profile = out.trim();
        expect(existsSync(profile)).toBe(true);
        child.kill(signal);
        expect(await child.exited).toBe(code);
        expect(existsSync(profile)).toBe(false);
      },
      30_000,
    );
  }
});
