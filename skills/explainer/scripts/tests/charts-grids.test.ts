import { describe, expect, test } from "bun:test";
import { SpecError, type BlockModule, type Diagnostic, type RawBlock, type RenderContext } from "../engine/types.ts";
import { loadTheme } from "../engine/theme.ts";
import { blockModule as heatmap } from "../engine/charts/heatmap.ts";
import { blockModule as treemap } from "../engine/charts/treemap.ts";
import { blockModule as marimekko } from "../engine/charts/marimekko.ts";
import { mixOklab, rampInk, seriesInk, accentInk } from "../engine/charts/ink.ts";

const theme = await loadTheme();
const warnings: Diagnostic[] = [];
const ctx: RenderContext = {
  theme,
  doc: { front: {}, segments: [] },
  inline: (s: string) => s,
  warn: (d) => { warnings.push(d); },
};
const raw = (type: string, data: unknown, line = 5): RawBlock => ({ type, info: [], body: "", data, line });

function specError(fn: () => unknown): SpecError {
  try {
    fn();
  } catch (e) {
    if (e instanceof SpecError) return e;
    throw e;
  }
  throw new Error("expected a SpecError");
}

function marks(html: string): { id: string; head: string; inner: string }[] {
  const out: { id: string; head: string; inner: string }[] = [];
  for (const m of html.matchAll(/(<g class="x-mark[^"]*" data-id="([^"]+)"[^>]*>)([\s\S]*?)<\/g>/g)) {
    out.push({ head: m[1] ?? "", id: m[2] ?? "", inner: m[3] ?? "" });
  }
  return out;
}

function rectOf(inner: string): { x: number; y: number; w: number; h: number } {
  const m = inner.match(/<rect class="x-mark-shape" x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/);
  if (!m) throw new Error(`no shape rect in ${inner}`);
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
}

// deno-lint-ignore no-explicit-any
function contract(mod: BlockModule<any>, data: unknown, prefix: string) {
  const block = mod.normalize(raw(mod.type, data), ctx);
  const html = mod.render(block, ctx);
  const ms = marks(html);
  expect(ms.length).toBeGreaterThan(0);
  const ids = ms.map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
  const model = mod.model?.(block) ?? {};
  for (const m of ms) {
    expect(m.id.startsWith(`${prefix}-`)).toBe(true);
    expect(m.inner).toContain("x-mark-shape");
    expect(model.elements?.[m.id]).toBeDefined();
  }
  expect(html).not.toMatch(/style=/);
  expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(html).not.toMatch(/rgba?\(/);
  // determinism: same input, byte-identical output
  expect(mod.render(mod.normalize(raw(mod.type, data), ctx), ctx)).toBe(html);
  expect(JSON.stringify(mod.model?.(mod.normalize(raw(mod.type, data), ctx)))).toBe(JSON.stringify(model));
  return { block, html, ms, model };
}

// ---------- heatmap ----------

const heat = {
  id: "load",
  format: "int",
  rows: ["Mon", "Tue", "Wed"],
  columns: ["Morning", "Noon", "Evening"],
  values: [[10, 40, 20], [5, null, 30], [60, 25, 15]],
  rowAbout: { Mon: "Starts the week with the backlog." },
};

describe("heatmap", () => {
  test("normalizes rows, columns, levels and prefixed ids", () => {
    const b = heatmap.normalize(raw("heatmap", heat), ctx);
    expect(b.rows.map((r) => r.id)).toEqual(["load-row-mon", "load-row-tue", "load-row-wed"]);
    expect(b.columns[0]?.id).toBe("load-col-morning");
    expect(b.cells[1]?.[1]).toBeNull();
    expect(b.cells[1]?.[0]?.level).toBe(0); // min
    expect(b.cells[2]?.[0]?.level).toBe(6); // max
    expect(b.range).toEqual([5, 60]);
    expect(b.rows[0]?.about).toBe("Starts the week with the backlog.");
  });

  test("linear scale spreads levels by value", () => {
    const b = heatmap.normalize(raw("heatmap", { ...heat, scale: "linear" }), ctx);
    expect(b.cells[1]?.[0]?.level).toBe(0);
    expect(b.cells[2]?.[0]?.level).toBe(6);
    expect(b.cells[0]?.[0]?.level).toBe(0); // 10 is close to the min on a linear scale
  });

  test("marks, groups, empty cells, legend", () => {
    const { html, ms, model } = contract(heatmap, heat, "load");
    expect(ms.length).toBe(8 + 3 + 3); // cells with values + rows + columns
    expect((html.match(/x-heat-empty/g) ?? []).length).toBe(1);
    expect((html.match(/class="x-ramp-swatch"/g) ?? []).length).toBe(7);
    expect(model.elements?.["load-row-tue"]?.members).toEqual(["load-tue-morning", "load-tue-evening"]);
    expect(model.elements?.["load-mon-noon"]?.related).toEqual(["load-row-mon", "load-col-noon"]);
    expect(model.elements?.["load-mon-noon"]?.value).toBe("40");
    expect(html).toContain('data-level="6"');
    expect(html).toContain(">40</text>");
  });

  test("a cell is a crosshair: heads related, the rest of its row and column context", () => {
    const { model } = contract(heatmap, heat, "load");
    const cell = model.elements?.["load-mon-noon"];
    // tue-noon is empty, so the column adds only wed-noon
    expect(cell?.context).toEqual(["load-mon-morning", "load-mon-evening", "load-wed-noon"]);
    expect(cell?.crumb).toEqual(["load-row-mon"]);
    expect(cell?.links).toEqual([{ rel: "Row", ids: ["load-row-mon"] }, { rel: "Column", ids: ["load-col-noon"] }]);
  });

  test("cell and head facts: rank, share of row, vs column average, neighbour chips", () => {
    const { model } = contract(heatmap, heat, "load");
    const facts = model.elements?.["load-mon-noon"]?.facts ?? [];
    expect(facts[0]).toEqual({ k: "Rank", v: "2nd of 8" });
    expect(facts[1]?.v).toBe("57% of Mon (70)");
    expect(facts[2]).toMatchObject({ k: "vs Noon average", v: "1.2× (33)", tone: "up" });
    expect(facts.find((f) => f.ref === "load-wed-noon")?.v).toBe("Wed · 25");
    expect(facts.find((f) => f.ref === "load-mon-morning")?.k).toBe("Mon low");
    expect(facts.length).toBeLessThanOrEqual(5);
    expect(model.elements?.["load-wed-morning"]?.facts?.[0]?.v).toBe("highest of 8");
    expect(model.elements?.["load-tue-morning"]?.facts?.[0]?.v).toBe("lowest of 8");
    expect(model.elements?.["load-mon-noon"]?.pos).toBe("2 of 8");
    expect(model.elements?.["load-mon-noon"]?.say).toContain("57% of Mon");
    const tue = model.elements?.["load-row-tue"];
    expect(tue?.value).toBe("35");
    expect(tue?.facts?.find((f) => f.k === "Peak")).toMatchObject({ v: "Evening · 30", ref: "load-tue-evening" });
  });

  test("on-fill ink per ramp level, arrow order, scale in the legend, theme-neutral desc", () => {
    const { html } = contract(heatmap, heat, "load");
    // 25 sits on level 4: dark text in light mode (the old rule flipped it to white at 2.8:1)
    expect(html).toMatch(/data-id="load-wed-noon"[^>]*data-level="4" data-ink="t[a-z]"/);
    expect(html).toMatch(/data-id="load-wed-morning"[^>]*data-ink="ss" data-nav="2,0"/);
    expect(html).toContain('data-nav="-1,1"');
    expect(html).toContain('class="x-mark-label x-on-fill"');
    expect(html).toContain(">quantile bins</text>");
    expect(html).toContain("(faintest)");
    expect(html).not.toContain("lightest");
    const linear = heatmap.render(heatmap.normalize(raw("heatmap", { ...heat, scale: "linear" }), ctx), ctx);
    expect(linear).toContain(">linear steps</text>");
  });

  test("reading line, data table and note markers", () => {
    const b = heatmap.normalize(raw("heatmap", { ...heat, unit: "tickets", notes: [{ on: "load-wed-morning", text: "The peak." }], caveat: "Counts only." }), ctx);
    expect(heatmap.reading?.(b)).toContain("counts tickets");
    expect(heatmap.reading?.(b)).toContain("quantile bins");
    expect(heatmap.table?.(b)).toEqual({
      head: ["", "Morning", "Noon", "Evening"],
      rows: [["Mon", "10", "40", "20"], ["Tue", "5", "—", "30"], ["Wed", "60", "25", "15"]],
    });
    expect(b.caveat).toBe("Counts only.");
    expect(heatmap.render(b, ctx)).toContain('class="x-note-marker" data-note="1" data-for="load-wed-morning"');
  });

  test("spec errors", () => {
    expect(specError(() => heatmap.normalize(raw("heatmap", { ...heat, colour: "red" }), ctx)).line).toBe(5);
    expect(() => heatmap.normalize(raw("heatmap", { ...heat, values: [[1, 2, 3]] }), ctx)).toThrow(SpecError);
    expect(() => heatmap.normalize(raw("heatmap", { ...heat, values: [[1, 2], [1, 2, 3], [1, 2, 3]] }), ctx)).toThrow(SpecError);
    expect(() => heatmap.normalize(raw("heatmap", { ...heat, values: [["lots", 2, 3], [1, 2, 3], [1, 2, 3]] }), ctx)).toThrow(SpecError);
    expect(() => heatmap.normalize(raw("heatmap", { ...heat, scale: "log" }), ctx)).toThrow(SpecError);
    expect(specError(() => heatmap.normalize(raw("heatmap", { ...heat, rowAbout: { Fri: "x" } }), ctx)).rule).toBe("ref-exists");
  });

  test("budget warning over 12 × 16", () => {
    warnings.length = 0;
    const rows = Array.from({ length: 13 }, (_, i) => `R${i}`);
    heatmap.normalize(raw("heatmap", { id: "big", rows, columns: ["a", "b"], values: rows.map(() => [1, 2]) }), ctx);
    expect(warnings.some((w) => w.rule === "budget-nodes")).toBe(true);
  });

  test("escapes labels", () => {
    const html = heatmap.render(heatmap.normalize(raw("heatmap", { ...heat, rows: ["<script>alert(1)</script>", "Tue", "Wed"], rowAbout: undefined }), ctx), ctx);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ---------- treemap ----------

const tree = {
  id: "spend",
  format: "$",
  data: [
    { label: "API", value: 400, group: "Compute", focal: true, about: "Serves every request." },
    { label: "Batch", value: 200, group: "Compute" },
    { label: "Database", value: 300, group: "Data" },
    { label: "Backups", value: 50, group: "Data" },
    { label: "Egress", value: 100, group: "Network" },
  ],
  groupAbout: { Data: "Everything stored." },
};

describe("treemap", () => {
  test("normalizes groups by total with one palette slot each", () => {
    const b = treemap.normalize(raw("treemap", tree), ctx);
    expect(b.groups.map((g) => g.label)).toEqual(["Compute", "Data", "Network"]);
    expect(b.groups.map((g) => g.slot)).toEqual([1, 2, 3]);
    expect(b.groups[0]?.id).toBe("spend-group-compute");
    expect(b.items[0]?.id).toBe("spend-api");
    expect(b.total).toBe(1050);
  });

  test("marks, group heads and model", () => {
    const { html, ms, model } = contract(treemap, tree, "spend");
    expect(ms.filter((m) => m.head.includes("x-tile")).length).toBe(5);
    expect(model.elements?.["spend-group-compute"]?.members).toEqual(["spend-api", "spend-batch"]);
    expect(model.elements?.["spend-api"]?.related).toEqual(["spend-group-compute"]);
    expect(html).toContain('data-focal="true"');
    // the frame is the group mark's own shape, so selection rings the whole group
    expect(html).toMatch(/data-id="spend-group-data"[^>]*><rect class="x-mark-shape x-tree-group"/);
  });

  test("tiles: siblings are context, share of the group and of the total", () => {
    const { model } = contract(treemap, tree, "spend");
    const db = model.elements?.["spend-database"];
    expect(db?.context).toEqual(["spend-backups"]);
    expect(db?.crumb).toEqual(["spend-group-data"]);
    expect(db?.facts?.map((f) => f.v).slice(0, 3)).toEqual(["86% of Data", "29% of total", "2nd of 5"]);
    expect(model.elements?.["spend-backups"]?.facts?.find((f) => f.ref === "spend-database")?.k).toBe("Largest in Data");
    expect(db?.sub).toBeUndefined();
    const group = model.elements?.["spend-group-compute"];
    expect(group?.value).toBe("$600");
    expect(group?.facts?.map((f) => f.v)).toEqual(["57%", "2", "API · $400 (67%)", "1st of 3 groups"]);
    expect(group?.facts?.[2]?.ref).toBe("spend-api");
  });

  test("a group too small for its strip is still a selectable mark", () => {
    const { ms } = contract(treemap, { id: "tiny", data: [{ label: "Big", value: 10000, group: "A" }, { label: "Small", value: 3, group: "B" }] }, "tiny");
    expect(ms.map((m) => m.id)).toContain("tiny-group-b");
  });

  test("on-fill ink per palette slot and for the focal accent", () => {
    const { html } = contract(treemap, tree, "spend");
    // slot 2 (Data, green) needs black ink in light mode, where neither text nor surface reaches AA, and surface in dark
    expect(html).toMatch(/data-id="spend-database" data-series="2"[^>]*data-ink="ks"/);
    expect(html).toMatch(/data-id="spend-api" data-series="1" data-focal="true"[^>]*data-ink="ss"/);
  });

  test("more than 6 groups warns", () => {
    warnings.length = 0;
    treemap.normalize(raw("treemap", { id: "g", data: Array.from({ length: 7 }, (_, i) => ({ label: `T${i}`, value: 10 - i, group: `G${i}` })) }), ctx);
    expect(warnings.some((w) => w.rule === "budget-nodes" && w.message.includes("7 groups"))).toBe(true);
  });

  test("map shorthand and single-level levels", () => {
    const b = treemap.normalize(raw("treemap", { id: "flat", data: { A: 300, B: 100 } }), ctx);
    expect(b.groups).toEqual([]);
    expect(b.items.map((i) => i.level)).toEqual([6, 1]);
    const html = treemap.render(b, ctx);
    const [a, bb] = marks(html).map((m) => rectOf(m.inner));
    if (!a || !bb) throw new Error("two tiles expected");
    const ratio = ((a.w + 2) * (a.h + 2)) / ((bb.w + 2) * (bb.h + 2));
    expect(Math.abs(ratio - 3)).toBeLessThan(0.05);
  });

  test("squarified tiles stay in bounds and never overlap", () => {
    const values = [90, 70, 55, 40, 33, 20, 18, 12, 9, 6, 4, 2];
    const b = treemap.normalize(raw("treemap", { id: "many", data: values.map((v, i) => ({ label: `T${i}`, value: v })) }), ctx);
    const rects = marks(treemap.render(b, ctx)).map((m) => rectOf(m.inner));
    expect(rects.length).toBe(values.length);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(960.1);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const p = rects[i]!, q = rects[j]!;
        const ox = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
        const oy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
        expect(ox > 0.2 && oy > 0.2).toBe(false);
      }
    }
  });

  test("spec errors and budget", () => {
    expect(() => treemap.normalize(raw("treemap", { id: "x", data: [{ label: "A", value: 0 }] }), ctx)).toThrow(SpecError);
    expect(() => treemap.normalize(raw("treemap", { id: "x", data: [{ label: "A", value: "abc" }] }), ctx)).toThrow(SpecError);
    expect(() => treemap.normalize(raw("treemap", { id: "x", data: [{ label: "A", value: 1, group: "G" }, { label: "B", value: 2 }] }), ctx)).toThrow(SpecError);
    expect(specError(() => treemap.normalize(raw("treemap", { ...tree, extra: 1 }), ctx)).line).toBe(5);
    expect(specError(() => treemap.normalize(raw("treemap", { ...tree, groupAbout: { Storage: "x" } }), ctx)).rule).toBe("ref-exists");
    warnings.length = 0;
    treemap.normalize(raw("treemap", { id: "big", data: Array.from({ length: 31 }, (_, i) => ({ label: `T${i}`, value: i + 1 })) }), ctx);
    expect(warnings.some((w) => w.rule === "budget-nodes")).toBe(true);
  });

  test("escapes labels", () => {
    const html = treemap.render(treemap.normalize(raw("treemap", { id: "esc", data: { "<script>alert(1)</script>": 10, B: 5 } }), ctx), ctx);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ---------- marimekko ----------

const mekko = {
  id: "sales",
  format: "$",
  data: [
    { label: "North", width: 50, segments: { Retail: 60, Online: 40 } },
    { label: "Europe", width: 150, segments: { Retail: 30, Online: 50, Wholesale: 20 }, about: "The largest market." },
    { label: "South", width: 100, segments: { Online: { value: 70, focal: true, about: "Mostly mobile." }, Retail: 30 } },
  ],
  segmentAbout: { Online: "Web and app orders." },
};

describe("marimekko", () => {
  test("sorts columns by width and segments by total area", () => {
    const b = marimekko.normalize(raw("marimekko", mekko), ctx);
    expect(b.columns.map((c) => c.label)).toEqual(["Europe", "South", "North"]);
    expect(b.series.map((s) => s.name)).toEqual(["Online", "Retail", "Wholesale"]);
    expect(b.series.map((s) => s.slot)).toEqual([1, 2, 3]);
    for (const c of b.columns) expect(Math.abs(c.segments.reduce((a, s) => a + s.share, 0) - 1)).toBeLessThan(1e-9);
    expect(b.columns[0]?.id).toBe("sales-europe");
  });

  test("sort: false keeps the given order", () => {
    const b = marimekko.normalize(raw("marimekko", { ...mekko, sort: false }), ctx);
    expect(b.columns.map((c) => c.label)).toEqual(["North", "Europe", "South"]);
  });

  test("marks, consistent series slots, proportional widths, selectable legend", () => {
    const { block, html, ms, model } = contract(marimekko, mekko, "sales");
    const slots = new Map<string, Set<string>>();
    for (const m of html.matchAll(/<g class="x-mark x-segment" data-id="([^"]+)" data-series="(\d)"/g)) {
      const name = block.columns.flatMap((c) => c.segments).find((s) => s.id === m[1])?.name ?? "";
      if (!slots.has(name)) slots.set(name, new Set());
      slots.get(name)?.add(m[2] ?? "");
    }
    for (const set of slots.values()) expect(set.size).toBe(1);

    const width = (colIndex: number) => {
      const segId = block.columns[colIndex]?.segments[0]?.id;
      const m = ms.find((x) => x.id === segId);
      if (!m) throw new Error("segment mark missing");
      return rectOf(m.inner).w + 2;
    };
    expect(Math.abs(width(0) / width(1) - 1.5)).toBeLessThan(0.02);

    for (const s of block.series) {
      expect(html).toContain(`class="x-legend-item" data-series="${s.slot}" data-id="${s.id}"`);
      expect(model.elements?.[s.id]?.members?.length).toBeGreaterThan(0);
    }
    expect(model.elements?.["sales-europe"]?.members?.length).toBe(3);
    expect(html).toContain(">50%</text>");
    expect(html).toContain('data-focal="true"');
  });

  test("a segment is a cross: its column and its segment name are context", () => {
    const { model } = contract(marimekko, mekko, "sales");
    const seg = model.elements?.["sales-europe-online"];
    expect(seg?.related).toEqual(["sales-europe", "sales-series-online"]);
    expect(seg?.context).toEqual(["sales-europe-retail", "sales-europe-wholesale", "sales-south-online", "sales-north-online"]);
    expect(seg?.value).toBe("$75");
    expect(seg?.facts?.[0]?.v).toBe("50% of Europe");
    expect(seg?.facts?.[1]?.v).toMatch(/^4[56]% of all Online$/);
    expect(seg?.facts?.[2]?.v).toBe("25% of total");
    expect(seg?.facts?.[3]).toMatchObject({ k: "Highest Online", v: "South 70%", ref: "sales-south-online" });
    expect(model.elements?.["sales-europe"]?.facts?.[0]).toMatchObject({ k: "Share of total", v: "50%" });
    expect(model.elements?.["sales-series-online"]?.facts?.find((f) => f.ref === "sales-south-online")?.v).toBe("70% · $70");
    expect(marimekko.table?.(marimekko.normalize(raw("marimekko", mekko), ctx))?.rows[0]).toEqual(["Europe", "$150", "50%", "30%", "20%"]);
  });

  test("spec errors and budget", () => {
    const col = (segments: unknown) => ({ ...mekko, data: [{ label: "A", width: 10, segments }] });
    expect(() => marimekko.normalize(raw("marimekko", col({ Retail: -5 })), ctx)).toThrow(SpecError);
    expect(() => marimekko.normalize(raw("marimekko", col([40, 60])), ctx)).toThrow(SpecError);
    expect(() => marimekko.normalize(raw("marimekko", col({ Retail: { value: 4, colour: "x" } })), ctx)).toThrow(SpecError);
    expect(() => marimekko.normalize(raw("marimekko", col({ Retail: 0 })), ctx)).toThrow(SpecError);
    expect(specError(() => marimekko.normalize(raw("marimekko", { ...mekko, segmentAbout: { Phone: "x" } }), ctx)).rule).toBe("ref-exists");
    expect(specError(() => marimekko.normalize(raw("marimekko", { ...mekko, legend: true }), ctx)).line).toBe(5);
    warnings.length = 0;
    marimekko.normalize(raw("marimekko", { id: "big", data: Array.from({ length: 7 }, (_, i) => ({ label: `C${i}`, width: 1, segments: { A: 1 } })) }), ctx);
    expect(warnings.some((w) => w.rule === "budget-nodes")).toBe(true);
  });

  test("escapes labels", () => {
    const html = marimekko.render(marimekko.normalize(raw("marimekko", { id: "esc", data: [{ label: "<script>alert(1)</script>", width: 1, segments: { A: 1 } }] }), ctx), ctx);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ---------- on-fill ink ----------

describe("on-fill ink", () => {
  test("oklab mix matches the ramp's end points", () => {
    expect(mixOklab("#3E6F92", "#FFFFFF", 1)).toBe("#3e6f92");
    expect(mixOklab("#3E6F92", "#FFFFFF", 0)).toBe("#ffffff");
    expect(mixOklab("oklch(50% 0.1 200)", "#FFFFFF", 0.5)).toBeNull();
  });

  test("default theme: each ramp level and slot gets the ink that reaches AA", () => {
    // light letter first, dark second; k/w when neither text nor surface reaches 4.5:1
    expect([0, 1, 2, 3, 4, 5, 6].map((l) => rampInk(theme, l))).toEqual(
      [" data-ink=\"tt\"", " data-ink=\"tt\"", " data-ink=\"tt\"", " data-ink=\"tt\"", " data-ink=\"tw\"", " data-ink=\"ks\"", " data-ink=\"ss\""],
    );
    expect(seriesInk(theme, 2)).toBe(' data-ink="ks"');
    expect(seriesInk(theme, 4)).toBe(' data-ink="ts"');
    expect(accentInk(theme)).toBe(' data-ink="ss"');
  });
});
