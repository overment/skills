import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderDoc } from "../engine/blocks.ts";
import { textWidth } from "../engine/kit.ts";
import { parseDoc } from "../engine/parse.ts";
import { eventsModule, placeLabels, relTicks, timeScale, WIDTH, type Box, type LabelReq } from "../engine/report/events.ts";
import { metricsModule } from "../engine/report/metrics.ts";
import { delta, durationMs, fmtDuration, fmtOffset, fmtRatioRange, parseQuantity, parseTime, resolveTimes, type TimeSpec } from "../engine/report/units.ts";
import { loadTheme } from "../engine/theme.ts";
import { SpecError, type Diagnostic, type RawBlock, type RenderContext } from "../engine/types.ts";

const theme = await loadTheme();
const TEMPLATE = resolve(import.meta.dir, "../../templates/report.md");

function makeCtx(warnings: Diagnostic[] = []): RenderContext {
  return { theme, doc: { front: {}, segments: [] }, inline: (s: string) => s, warn: (d) => void warnings.push(d) };
}
const raw = (type: string, data: unknown): RawBlock => ({ type, info: [], body: "", data, line: 3 });

function specError(fn: () => unknown): SpecError {
  try { fn(); } catch (e) { if (e instanceof SpecError) return e; throw e; }
  throw new Error("expected a SpecError");
}

function render(source: string) {
  return renderDoc(parseDoc(source, "doc.md"), theme);
}

// ---------- units ----------

describe("units: times", () => {
  test("clock, offset, anchored and ISO forms", () => {
    expect(parseTime("10:08:57.2", "at", 1)).toEqual({ kind: "clock", ms: 36_537_200 });
    expect(parseTime("10:08", "at", 1)).toEqual({ kind: "clock", ms: 36_480_000 });
    expect(parseTime("+13.2s", "at", 1)).toEqual({ kind: "rel", ms: 13_200 });
    expect(parseTime("-400ms", "at", 1)).toEqual({ kind: "rel", ms: -400 });
    expect(parseTime("e429+2s", "at", 1)).toEqual({ kind: "ref", id: "e429", ms: 2000 });
    expect(parseTime("e429", "at", 1)).toEqual({ kind: "ref", id: "e429", ms: 0 });
    expect(parseTime("2026-09-26T10:08:44+02:00", "at", 1)).toEqual({ kind: "epoch", ms: Date.UTC(2026, 8, 26, 8, 8, 44), offset: 120 });
    expect(parseTime(12, "at", 1)).toEqual({ kind: "rel", ms: 12_000 });
    for (const bad of ["25:00", "10:61", "+soon", "", "a b"]) expect(specError(() => parseTime(bad, "at", 4)).line).toBe(4);
  });

  test("durations", () => {
    expect(durationMs("3.5 s")).toBe(3500);
    expect(durationMs("800ms")).toBe(800);
    expect(durationMs("1m30s")).toBe(90_000);
    expect(durationMs("2 min")).toBe(120_000);
    expect(durationMs(4)).toBe(4000);
    expect(durationMs("fast")).toBeUndefined();
    expect(fmtDuration(0.8)).toBe("0.8 ms");
    expect(fmtDuration(3500)).toBe("3.5 s");
    expect(fmtDuration(12_000)).toBe("12 s");
    expect(fmtDuration(125_000)).toBe("2 min 5 s");
    expect(fmtOffset(21_300)).toBe("+21.3 s");
    expect(fmtOffset(-400)).toBe("−400 ms");
  });

  test("resolves anchors, offsets and clocks against t0", () => {
    const specs = new Map<string, TimeSpec>([
      ["sent", parseTime("10:08:44", "", 1)],
      ["e429", parseTime("10:08:56", "", 1)],
      ["retry", parseTime("e429+2s", "", 1)],
      ["late", parseTime("retry+0.5s", "", 1)],
    ]);
    const { times, clock } = resolveTimes(specs, undefined, "events", 1);
    expect([...times.entries()]).toEqual([["sent", 0], ["e429", 12_000], ["retry", 14_000], ["late", 14_500]]);
    expect(clock.at(0)).toBe("10:08:44");
    expect(clock.at(21_300)).toBe("10:09:05.3");
    const rel = resolveTimes(new Map([["a", parseTime("+1s", "", 1)]]), undefined, "events", 1);
    expect(rel.clock.at(1000)).toBeUndefined();
  });

  test("clock times beside an ISO t0 land on its day and offset", () => {
    const specs = new Map<string, TimeSpec>([["b", parseTime("10:08:50", "", 1)]]);
    const { times, clock } = resolveTimes(specs, parseTime("2026-09-26T10:08:44+02:00", "", 1), "events", 1);
    expect(times.get("b")).toBe(6000);
    expect(clock.at(6000)).toBe("10:08:50");
  });

  test("unknown and circular anchors are errors", () => {
    expect(specError(() => resolveTimes(new Map([["a", parseTime("zz+1s", "", 1)]]), undefined, "events", 2)).rule).toBe("ref-exists");
    const loop = new Map<string, TimeSpec>([["a", parseTime("b+1s", "", 1)], ["b", parseTime("a+1s", "", 1)]]);
    expect(specError(() => resolveTimes(loop, undefined, "events", 2)).message).toContain("refers back to itself");
  });
});

describe("units: quantities and deltas", () => {
  test("parses numbers, units and ranges; words stay undefined", () => {
    expect(parseQuantity("0.73–1.72 s")).toEqual({ lo: 730, hi: 1720, dim: "time", unit: "s", approx: false });
    expect(parseQuantity("1.4 ms")).toMatchObject({ lo: 1.4, hi: 1.4, dim: "time" });
    expect(parseQuantity("3.3-6.1 s")).toMatchObject({ lo: 3300, hi: 6100 });
    expect(parseQuantity("12%")).toMatchObject({ lo: 12, dim: "pct" });
    expect(parseQuantity("4 KB")).toMatchObject({ lo: 4096, dim: "size" });
    expect(parseQuantity("1,200")).toMatchObject({ lo: 1200, dim: "count" });
    expect(parseQuantity("1 s–2 min")).toMatchObject({ lo: 1000, hi: 120_000 });
    expect(parseQuantity("≈10 s")).toMatchObject({ lo: 10_000, approx: true });
    expect(parseQuantity("same frame")).toBeUndefined();
    expect(parseQuantity("3 parsecs")).toBeUndefined();
  });

  test("delta compares ranges end to end and tones by `better`", () => {
    const d = delta(parseQuantity("0.73–1.72 s"), parseQuantity("0.8 ms"), "lower");
    expect(d.ratio![0]).toBeCloseTo(912.5);
    expect(d.ratio![1]).toBeCloseTo(2150);
    expect(d.words).toBe("≈900–2,150× faster");
    expect(d.tone).toEqual({ before: "warn", after: "ok" });
    expect(d.direction).toBe("better");
    const worse = delta(parseQuantity("20 ms"), parseQuantity("90 ms"), "lower");
    expect(worse).toMatchObject({ words: "4.5× slower", tone: { before: "neutral", after: "danger" }, direction: "worse" });
    expect(delta(parseQuantity("100"), parseQuantity("112"), "higher")).toMatchObject({ words: "12% higher", direction: "better" });
    expect(delta(parseQuantity("1–3 s"), parseQuantity("2 s"), "lower")).toMatchObject({ words: "no clear change", direction: "same" });
    expect(delta(parseQuantity("1 s"), parseQuantity("0.1 s"), undefined)).toMatchObject({ tone: { before: "neutral", after: "neutral" } });
    expect(delta(parseQuantity("1 s"), parseQuantity("4 KB"), "lower").words).toBe("—");
    expect(delta(parseQuantity("1 s"), undefined, "lower").words).toBe("—");
  });

  test("ratio ranges round to a shared step", () => {
    expect(fmtRatioRange(912.5, 2150)).toBe("≈900–2,150");
    expect(fmtRatioRange(335.7, 657.1)).toBe("≈350–650");
    expect(fmtRatioRange(2.25, 4.5)).toBe("2.3–4.5");
    expect(fmtRatioRange(12, 12)).toBe("12");
  });
});

// ---------- scale and placement ----------

describe("events: scale", () => {
  test("a long empty gap collapses into one break; the rest stays proportional", () => {
    const x = timeScale([[0, 0], [1000, 1000], [30_000, 31_000]], [0, 31_000], [0, 1000]);
    expect(x.breaks).toHaveLength(1);
    expect(x.breaks[0].x1 - x.breaks[0].x0).toBeCloseTo(36);
    expect(x(0)).toBe(0);
    expect(x(31_000)).toBeCloseTo(1000);
    const samples = [0, 500, 1000, 5000, 20_000, 29_000, 30_500, 31_000].map(x);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    // equal durations on either side of the break get equal widths
    expect(x(1000) - x(0)).toBeCloseTo(x(31_000) - x(30_000), 5);
    expect(x.skipped).toBeGreaterThan(25_000);
  });

  test("even spacing, short gaps and `compress: off` stay linear", () => {
    expect(timeScale([[0, 0], [5000, 5000], [9000, 10_000]], [0, 10_000], [0, 1000]).breaks).toHaveLength(0);
    expect(timeScale([[0, 0], [1000, 1000], [2000, 2000], [2600, 2600]], [0, 2600], [0, 1000]).breaks).toHaveLength(0);
    const off = timeScale([[0, 0], [30_000, 31_000]], [0, 31_000], [0, 1000], false);
    expect(off.breaks).toHaveLength(0);
    expect(off(15_500)).toBeCloseTo(500);
  });

  test("relative ticks are round multiples from t0", () => {
    expect(relTicks([0, 35_000], 35_000)).toEqual([0, 5000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000]);
    expect(relTicks([-2000, 9000], 11_000)).toEqual([-2000, 0, 2000, 4000, 6000, 8000]);
  });
});

describe("events: label placement", () => {
  const req = (id: string, x: number, w = 120, prefer: "above" | "below" = "below"): LabelReq => ({ id, x, w, h: 32, prefer, y0: { above: -9, below: 11 } });
  const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  test("labels at the edges re-anchor inward and stay inside the figure", () => {
    const { placed, failed } = placeLabels([req("left", 2), req("right", WIDTH - 2, 180), req("mid", WIDTH / 2)], []);
    expect(failed).toEqual([]);
    for (const p of placed) {
      expect(p.box.x).toBeGreaterThanOrEqual(0);
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(WIDTH);
    }
  });

  test("crowded labels never overlap each other or the obstacles", () => {
    const obstacles: Box[] = [{ x: 380, y: 12, w: 200, h: 30 }];
    const reqs = Array.from({ length: 9 }, (_, i) => req(`e${i}`, 360 + i * 14, 110, i % 2 ? "above" : "below"));
    const { placed, failed } = placeLabels(reqs, obstacles);
    expect(placed.length + failed.length).toBe(9);
    for (const [i, a] of placed.entries()) {
      for (const o of obstacles) expect(overlaps(a.box, o)).toBe(false);
      for (const b of placed.slice(i + 1)) expect(overlaps(a.box, b.box)).toBe(false);
    }
  });
});

// ---------- blocks ----------

const trace = (patch: Record<string, unknown> = {}) => ({
  id: "t",
  events: {
    first: { at: "10:00:00", label: "Request sent at the very left edge of the trace" },
    err: { at: "10:00:12", label: "HTTP 429", sub: "painted as final", tone: "warn" },
    retry: { at: "err+2s", label: "silent retry", sub: "turn still running", tone: "warn" },
    tail: { at: "10:00:40", label: "Last event sitting on the right edge" },
  },
  spans: { prep: { from: "10:00:00.4", to: "10:00:11", label: "preparing" } },
  clusters: { presses: { label: "3 presses", tone: "warn", items: [{ at: "10:00:30", dur: "3.5 s" }, { at: "10:00:31", dur: "6.3 s" }] } },
  ...patch,
});

describe("events block", () => {
  test("normalizes times, sorts events and derives the axis ends", () => {
    const b = eventsModule.normalize(raw("events", trace()), makeCtx());
    expect(b.events.map((e) => [e.id, e.at])).toEqual([["first", 0], ["err", 12_000], ["retry", 14_000], ["tail", 40_000]]);
    expect(b.spans[0]).toMatchObject({ from: 400, to: 11_000 });
    expect(b.clusters[0].items.map((i) => [i.at, i.dur])).toEqual([[30_000, 3500], [31_000, 6300]]);
    expect(b.ends).toEqual(["10:00:00", "10:00:40"]);
    expect(b.anchors).toEqual([["retry", "err"]]);
  });

  test("renders every text inside the viewBox, with no ellipsis and a duration on every bar", () => {
    const b = eventsModule.normalize(raw("events", trace()), makeCtx());
    const html = eventsModule.render(b, makeCtx());
    expect(html).not.toContain("…");
    expect(html).not.toMatch(/style=|#[0-9a-fA-F]{6}\b/);
    const texts = [...html.matchAll(/<text class="([^"]*)" x="([-\d.]+)" y="[-\d.]+"(?: text-anchor="(middle|end)")?[^>]*>([^<]*)<\/text>/g)];
    expect(texts.length).toBeGreaterThan(8);
    for (const [, cls, xs, anchor, content] of texts) {
      // every word on the trace is sans; ticks at the tag size, durations, readouts and breaks at nodeSub
      const px = /tick/.test(cls) ? theme.type.tag : /dur|readout|break/.test(cls) ? theme.type.nodeSub : theme.type.caption;
      const w = textWidth(content, px, "sans");
      const left = Number(xs) - (anchor === "end" ? w : anchor === "middle" ? w / 2 : 0);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + w).toBeLessThanOrEqual(WIDTH);
    }
    expect(html).toContain(">3.5 s<");
    expect(html).toContain(">6.3 s<");
    expect(html).toContain("x-rep-break");
    expect(html).toMatch(/>\/\/ [\d.]+ s</);
  });

  test("text that needs more than two lines becomes a numbered marker with a warning", () => {
    const warnings: Diagnostic[] = [];
    const long = "a very long label that keeps going well past two lines of thirty two characters each and more";
    const b = eventsModule.normalize(raw("events", trace({ events: { only: { at: "+0s", label: long } } , spans: undefined, clusters: undefined })), makeCtx(warnings));
    const html = eventsModule.render(b, makeCtx(warnings));
    expect(warnings.map((w) => w.rule)).toContain("label-fit");
    expect(html).toContain("x-note-marker");
    expect(html).toContain("x-rep-fallback-list");
    expect(html).not.toContain("…");
  });

  test("model: facts, bars as their own moments, and the reading line", () => {
    const b = eventsModule.normalize(raw("events", trace()), makeCtx());
    const m = eventsModule.model!(b).elements!;
    expect(m.presses.value).toBe("3.5 / 6.3 s");
    expect(m.presses.facts?.map((f) => [f.k, f.v])).toEqual([["First", "10:00:30 · +30 s"], ["Total", "9.8 s"], ["Mean", "4.9 s"], ["Since previous", "+16 s"]]);
    expect(m["presses-2"]).toMatchObject({ label: "2nd of 3 presses", value: "6.3 s", pos: "2 of 2", kind: "repeat" });
    expect(m["presses-2"].facts?.find((f) => f.k === "After the previous")).toMatchObject({ v: "+1 s", ref: "presses-1" });
    expect(m.retry.value).toBe("10:00:14 · +14 s");
    expect(m.retry.facts?.find((f) => f.k === "Since previous")).toMatchObject({ v: "+2 s", ref: "err" });
    expect(eventsModule.reading!(b)).toMatch(/^Spacing is proportional to time; \/\/ skips [\d.]+ s with no events\./);
    expect(eventsModule.table!(b).rows[0]).toEqual(["10:00:00", "+0 s", "Request sent at the very left edge of the trace", ""]);
    expect(eventsModule.table!(b).rows.map((r) => r[2])).toContain("2nd of 3 presses");
  });

  test("each bar of a cluster is a mark of its own, drawn after the cluster so a click lands on it", () => {
    const b = eventsModule.normalize(raw("events", trace()), makeCtx());
    const html = eventsModule.render(b, makeCtx());
    const order = [...html.matchAll(/<g class="x-mark x-rep-(\w+)" data-id="([^"]+)"/g)].map((x) => `${x[1]}:${x[2]}`);
    expect(order.indexOf("cluster:presses")).toBeLessThan(order.indexOf("item:presses-1"));
    expect(order).toContain("item:presses-2");
  });

  test("notes become numbered boxes on bands above and below the trace, matched by kit markers", () => {
    const warnings: Diagnostic[] = [];
    const b = eventsModule.normalize(raw("events", trace({
      events: {
        first: { at: "10:00:00", label: "sent", note: "The turn starts." },
        err: { at: "10:00:12", label: "HTTP 429", note: "The provider said 429 and the app painted it as final." },
      },
    })), makeCtx(warnings));
    expect(b.annotate).toEqual(["first", "err"]);
    const html = eventsModule.render(b, makeCtx(warnings));
    const bands = [...html.matchAll(/<svg class="x-svg x-rep-annot" data-band="(top|bottom)" [^>]*viewBox="0 0 1024 ([\d.]+)"/g)];
    expect(bands.map((x) => x[1])).toEqual(["bottom"]); // both labels sit below the axis
    expect([...html.matchAll(/class="x-rep-annot-note x-ref" data-note="(\d)" data-ref="(\w+)"/g)].map((x) => [x[1], x[2]])).toEqual([["1", "first"], ["2", "err"]]);
    expect([...html.matchAll(/class="x-note-marker" data-note="(\d)" data-for="(\w+)"/g)].map((x) => [x[1], x[2]])).toEqual([["1", "first"], ["2", "err"]]);
    expect(html).not.toContain("…");
    expect(eventsModule.model!(b).elements!.err.facts?.[0]).toEqual({ k: "Note", v: "2" });
    // off, a list, and a note that can't fit
    expect(eventsModule.normalize(raw("events", trace({ annotate: "off" })), makeCtx()).annotate).toEqual([]);
    expect(eventsModule.normalize(raw("events", trace({ annotate: ["err", "presses"], events: { err: { at: "+1s", label: "x", about: "why" } }, clusters: { presses: { label: "p", about: "why", items: [{ at: "+2s", dur: "1 s" }] } } })), makeCtx()).annotate).toEqual(["err", "presses"]);
    expect(specError(() => eventsModule.normalize(raw("events", trace({ annotate: ["presses-2"] })), makeCtx())).message).toContain("no `note` or `about`");
    expect(specError(() => eventsModule.normalize(raw("events", trace({ annotate: ["nope"] })), makeCtx())).rule).toBe("ref-exists");
    const long = eventsModule.normalize(raw("events", trace({ events: { a: { at: "+1s", label: "x", note: "word ".repeat(80) } } })), makeCtx());
    const w2: Diagnostic[] = [];
    expect(eventsModule.render(long, makeCtx(w2))).not.toContain("x-rep-annot-note");
    expect(w2.map((w) => w.rule)).toContain("label-fit");
  });

  test("bad specs throw SpecError on the block line", () => {
    const bad = (patch: Record<string, unknown>) => specError(() => eventsModule.normalize(raw("events", trace(patch)), makeCtx()));
    expect(bad({ colour: "red" }).message).toContain("unknown field `colour`");
    expect(bad({ events: { a: { label: "no time" } } }).message).toContain("needs `at`");
    expect(bad({ events: { a: { at: "+1s", label: "x", tone: "purple" } } }).message).toContain("tone");
    expect(bad({ spans: { s: { from: "+5s", to: "+1s", label: "back" } } }).message).toContain("ends before it starts");
    expect(bad({ end: "09:00:00" }).message).toContain("`end` comes before");
  });
});

describe("metrics block", () => {
  const data = () => ({
    id: "m", better: "lower",
    rows: {
      a: { label: "Copy", before: "0.73–1.72 s", after: "0.8 ms", about: "bench" },
      b: { label: "Busy", before: { text: "3.3–6.1 s", tone: "warn" }, after: "not re-measured", about: "log" },
      c: { label: "UI", before: { text: "after reread", tone: "warn" }, after: { text: "same frame", tone: "ok" }, about: "trace" },
      d: { label: "Unit", before: 12, after: 3, unit: "ms", about: "bench" },
    },
    proof: [{ label: "Review", status: "pass", value: "PASS" }, { label: "Not run", status: "skip", value: "native app" }],
  });

  test("tones come from `better`; words stay neutral unless toned", () => {
    const b = metricsModule.normalize(raw("metrics", data()), makeCtx());
    const [a, busy, ui, unit] = b.rows;
    expect([a.before.tone, a.after.tone, a.delta.words]).toEqual(["warn", "ok", "≈900–2,150× faster"]);
    expect([busy.before.tone, busy.after.tone, busy.delta.words]).toEqual(["warn", "neutral", "—"]);
    expect([ui.delta.words, ui.delta.direction]).toEqual(["better", "better"]);
    expect([unit.before.text, unit.after.text, unit.delta.words]).toEqual(["12 ms", "3 ms", "4× faster"]);
    expect(b.proof.map((p) => p.id)).toEqual(["m-review", "m-not-run"]);
    const html = metricsModule.render(b, makeCtx());
    expect(html).toContain("✓</span> pass");
    expect(html).toContain("—</span> not run");
    expect(metricsModule.model!(b).elements!.a.value).toBe("0.73–1.72 s → 0.8 ms · ≈900–2,150× faster");
  });

  test("numbers without `better` and rows without a method warn", () => {
    const warnings: Diagnostic[] = [];
    metricsModule.normalize(raw("metrics", { id: "m", rows: { a: { label: "x", before: "1 s", after: "2 s" } } }), makeCtx(warnings));
    expect(warnings.map((w) => w.rule).sort()).toEqual(["about-missing", "spec"]);
  });
});

// ---------- the page: relations across panels ----------

const source = await Bun.file(TEMPLATE).text();

describe("report template", () => {
  test("builds with no diagnostics and page-global ids", () => {
    const { diagnostics, model } = render(source);
    expect(diagnostics).toEqual([]);
    for (const id of ["commit", "sent", "e429", "retry", "title", "prep", "stops", "c-429", "c-runtime", "c-ui", "busy", "copy-first", "copy-repeat", "ui-feedback", "latency-review", "proof-landed", "step-hammer", "step-429", "q-5xx"]) {
      expect(model.elements[id]).toBeDefined();
    }
  });

  test("every moment on the trace explains itself and points at a card, row or step", () => {
    const { model } = render(source);
    for (const id of ["sent", "e429", "retry", "title", "prep", "stops"]) {
      expect(model.elements[id].about).toBeTruthy();
      expect(model.elements[id].related?.length).toBeGreaterThan(0);
    }
  });

  test("an event lights the fixes that explain it, the rows they moved and the steps that reproduce it", () => {
    const { model } = render(source);
    const stops = model.elements.stops;
    expect(stops.related).toEqual(["stops-1", "stops-2", "stops-3", "c-runtime", "c-ui", "copy-first", "copy-repeat", "ui-feedback", "step-hammer"]);
    for (const off of ["c-429", "busy", "step-429"]) expect(stops.related).not.toContain(off);
    const e429 = model.elements.e429;
    expect(e429.related).toEqual(["c-429", "step-429"]);
    expect(e429.context).toEqual(expect.arrayContaining(["retry", "title"]));
    expect(model.elements["copy-repeat"].related).toEqual(["stops", "stops-2", "stops-3", "c-runtime"]);
    expect(model.elements["copy-repeat"].value).toBe("0.73–1.72 s → 0.8 ms · ≈900–2,150× faster");
    // a single press lights its own row, its cluster, and everything the cluster lights; its siblings rest
    const third = model.elements["stops-3"];
    expect(third.related).toEqual(expect.arrayContaining(["stops", "copy-repeat", "ui-feedback", "c-runtime", "c-ui", "step-hammer"]));
    expect(third.context).toEqual(expect.arrayContaining(["stops-1", "stops-2"]));
  });

  test("a relation written from the trace reads as one written from the card, row or step", () => {
    const { model } = render(source);
    expect(model.elements["c-runtime"].links?.filter((l) => l.inverse)).toEqual([
      { rel: "Seen at", ids: ["stops"], inverse: "Explained by" },
      { rel: "Moved", ids: ["copy-first", "copy-repeat"], inverse: "Changed by" },
    ]);
    // `verify` on the card and `verifies` on a step read as one group
    expect(model.elements["c-runtime"].links?.filter((l) => l.rel === "Check with")).toEqual([{ rel: "Check with", ids: ["step-early", "step-tool", "step-hammer"] }]);
    expect(model.elements["step-early"].links).toContainEqual({ rel: "Verifies", ids: ["c-runtime"], inverse: "Check with" });
    const back = (id: string, rel: string) => model.elements[id].links?.filter((l) => l.rel === rel).flatMap((l) => l.ids);
    expect(back("stops", "Explained by")).toEqual(["c-runtime", "c-ui"]);
    expect(back("stops", "Measured by")).toEqual(["copy-first", "copy-repeat", "ui-feedback"]);
    expect(back("e429", "Reproduced by")).toEqual(["step-429"]);
    expect(back("prep", "Open question")).toEqual(["q-prep"]);
    expect(back("stops-3", "Part of")).toEqual(["stops"]);
    expect(back("copy-repeat", "Changed by")).toEqual(["c-runtime"]);
    expect(back("proof-landed", "Cited by")).toEqual(["commit"]);
  });

  test("cluster facts list the durations with total and mean", () => {
    const { model } = render(source);
    const stops = model.elements.stops;
    expect(stops.value).toBe("3.5 / 6.3 / 11.8 s");
    expect(stops.facts?.map((f) => `${f.k}: ${f.v}`)).toEqual(["First: 10:09:05.3 · +21.3 s", "Total: 21.6 s", "Mean: 7.2 s", "Since previous: +6.6 s"]);
  });

  test("rendering is deterministic and never ellipsises", () => {
    const a = render(source), b = render(source);
    expect(a.html).toBe(b.html);
    expect(JSON.stringify(a.model)).toBe(JSON.stringify(b.model));
    expect(a.html).not.toContain("…");
  });

  test("dangling relations, wrong kinds, fixes without a cause and bare moments are reported", () => {
    const doc = [
      "```change", "id: fx", "items:", "  a: { label: L, was: W, now: N, affects: nowhere }", "```",
      "```events", "id: tr", "events:", "  e: { at: +0s, label: E, fix: r }", "  f: { at: +1s, label: F }", "```",
      "```metrics", "id: latency", "better: lower", "rows:", "  r: { label: R, before: 1 s, after: 1 ms, about: bench }", "```",
    ].join("\n");
    const found = render(doc).diagnostics.map((d) => [d.rule, d.severity, d.message.replace(/".*$/, "")]);
    const messages = render(doc).diagnostics.map((d) => d.message);
    expect(found).toContainEqual(["ref-exists", "error", expect.anything()]);
    expect(messages.some((m) => m.includes("not a change card"))).toBe(true);
    expect(messages.some((m) => m.includes("explains no moment"))).toBe(true);
    expect(messages.some((m) => m.includes("\"f\" points at no card"))).toBe(true);
    expect(messages.some((m) => m.includes("\"f\" has no `about`"))).toBe(true);
  });
});
