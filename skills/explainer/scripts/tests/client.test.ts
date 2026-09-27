import { describe, expect, test } from "bun:test";
import type { DocModel, ElementInfo } from "../engine/types.ts";
import {
  contextOf, isStateHash, navNeighbor, parseHash, pickNeighbor, refIds, related, sayLine, sceneFrame, serializeHash,
  storyFrame, toCsv, type State,
} from "../client/client.ts";
import { composite, contrast, DIM_MIN, pickInk, saturate, type Rgb, type Rgba } from "../client/ink.ts";
import { cardData, compareData, fmtDelta, parseNum, relationGroups } from "../client/popover.ts";

const node = (id: string, label: string, kind = "service"): ElementInfo => ({ id, type: "node", label, kind, figure: "auth" });
const edge = (from: string, to: string, kind = "flow", label = ""): ElementInfo => ({
  id: `${from}->${to}`, type: "edge", label, kind, figure: "auth", from, to,
});
const elements: ElementInfo[] = [
  node("app", "Web app", "actor"),
  node("gw", "Gateway"),
  node("orders", "Orders"),
  node("db", "Orders DB", "store"),
  node("pay", "Payments", "external"),
  edge("app", "gw", "flow", "sends token"),
  edge("gw", "orders"),
  edge("gw", "app", "return"),
  edge("orders", "db", "async"),
  edge("gw", "pay", "link"),
  { id: "core", type: "group", label: "Core services", kind: "zone", figure: "auth", members: ["gw", "orders", "db"] },
  { id: "read", type: "row", label: "Read orders", figure: "access" },
  {
    id: "stops", type: "item", label: "Stop presses", figure: "trace", value: "3 presses",
    links: [{ rel: "Explained by", ids: ["card-b", "card-c"] }], context: ["metric-copy"],
  },
  { id: "card-b", type: "item", label: "B · Cache the journal", figure: "change" },
  { id: "card-c", type: "item", label: "C · Debounce stop", figure: "change" },
  { id: "metric-copy", type: "row", label: "Journal copy", figure: "metrics" },
  { id: "mobile-4", type: "item", label: "Mobile, Apr", figure: "wau", value: "46k", facts: [{ k: "vs Mar", v: "+4k", raw: 4000 }] },
  { id: "web-4", type: "item", label: "Web, Apr", figure: "wau", value: "45k", facts: [{ k: "vs Mar", v: "+1k", raw: 1000 }] },
  { id: "bot", type: "node", label: "Bot answer", kind: "flow-node", figure: "tickets" },
  { id: "reopened", type: "node", label: "Reopened", kind: "flow-node", figure: "tickets" },
  { id: "bot->reopened", type: "edge", label: "Bot answer → Reopened", kind: "flow", figure: "tickets", from: "bot", to: "reopened", value: "800 · 30% of Bot answer", pos: "6 of 11" },
];
const model: DocModel = {
  elements: Object.fromEntries(elements.map((e) => [e.id, e])),
  scenes: {
    valid: {
      id: "valid", title: "A valid request", figure: "auth", path: ["app", "gw", "orders", "db"],
      notes: { gw: "Token checks out." }, edges: ["app->gw", "gw->orders", "orders->db"],
    },
    back: { id: "back", title: "Rejected", figure: "auth", path: ["gw", "app"], notes: {}, edges: ["app->gw", "gw->app"] },
    "wau-story": Object.assign(
      { id: "wau-story", title: "Walk through", figure: "wau", path: ["web-4", "mobile-4"], notes: {}, edges: [] },
      { story: [{ sel: "web-4", note: "Web holds." }, { sel: "mobile-4", cmp: "web-4", note: "Mobile passes it." }] },
    ),
  },
  glossary: {},
};
const base: State = { sel: null, cmp: null, hide: [], range: null, hover: null, scene: null, step: 0, theme: null, view: null };

describe("parseHash", () => {
  test("reads every field", () => {
    expect(parseHash("#sel=gw&cmp=db&hide=a,b&range=tl,3,9&scene=valid&step=2&theme=dark&view=bare&capture=1")).toEqual({
      sel: "gw", cmp: "db", hide: ["a", "b"], range: "tl,3,9", scene: "valid", step: 2, theme: "dark", view: "bare", capture: true,
    });
  });
  test("empty hash gives nothing", () => {
    expect(parseHash("")).toEqual({});
    expect(parseHash("#")).toEqual({});
  });
  test("ignores invalid values", () => {
    expect(parseHash("#theme=blue&step=-1&capture=0&view=wide&range=nope")).toEqual({});
    expect(parseHash("#step=1.5")).toEqual({});
  });
  test("decodes edge ids, leading # optional", () => {
    expect(parseHash("#sel=app-%3Egw%232").sel).toBe("app->gw#2");
    expect(parseHash("sel=gw").sel).toBe("gw");
  });
  test("a heading anchor carries no state", () => {
    expect(isStateHash("#how-it-works")).toBe(false);
    expect(isStateHash("")).toBe(false);
    expect(isStateHash("#theme=dark")).toBe(true);
    expect(isStateHash("#sel=gw")).toBe(true);
  });
});

describe("serializeHash", () => {
  test("default state is empty", () => {
    expect(serializeHash(base)).toBe("");
  });
  test("step only with a scene, and only when > 0", () => {
    expect(serializeHash({ ...base, sel: "gw", step: 3 })).toBe("#sel=gw");
    expect(serializeHash({ ...base, scene: "valid" })).toBe("#scene=valid");
  });
  test("full state in contract order, hover ignored, commas kept readable", () => {
    expect(serializeHash({ ...base, sel: "gw", cmp: "db", hide: ["a", "b"], range: "tl,3,9", hover: "db", scene: "valid", step: 2, theme: "dark", view: "full" }, true)).toBe(
      "#sel=gw&cmp=db&hide=a,b&range=tl,3,9&scene=valid&step=2&theme=dark&view=full&capture=1",
    );
  });
  test("round-trips", () => {
    const s: State = { ...base, sel: "app->gw#2", cmp: "db", hide: ["web"], scene: "valid", step: 1, theme: "light", view: "bare" };
    const { capture, ...back } = parseHash(serializeHash(s, true));
    expect(capture).toBe(true);
    expect({ ...base, ...back }).toEqual(s);
  });
});

describe("related and context", () => {
  test("node: incident edges and their other ends", () => {
    expect(related(model, "gw")).toEqual(new Set(["gw", "app->gw", "app", "gw->orders", "orders", "gw->app", "gw->pay", "pay"]));
  });
  test("edge: both endpoints", () => {
    expect(related(model, "orders->db")).toEqual(new Set(["orders->db", "orders", "db"]));
  });
  test("group: members and edges among them", () => {
    expect(related(model, "core")).toEqual(new Set(["core", "gw", "orders", "db", "gw->orders", "orders->db"]));
  });
  test("links are related; context is its own tier", () => {
    expect(related(model, "stops")).toEqual(new Set(["stops", "card-b", "card-c"]));
    expect(contextOf(model, "stops")).toEqual(["metric-copy"]);
    expect(contextOf(model, "gw")).toEqual([]);
  });
  test("rows and unknown ids relate only to themselves", () => {
    expect(related(model, "read")).toEqual(new Set(["read"]));
    expect(related(model, "nope")).toEqual(new Set(["nope"]));
  });
});

describe("sceneFrame", () => {
  test("first step", () => {
    expect(sceneFrame(model, "valid", 0)).toEqual({ active: "app", done: [], edges: [], note: null, count: "1 / 4" });
  });
  test("lights edges between visited nodes and shows the note", () => {
    expect(sceneFrame(model, "valid", 1)).toEqual({ active: "gw", done: ["app"], edges: ["app->gw"], note: "Token checks out.", count: "2 / 4" });
    expect(sceneFrame(model, "valid", 2).edges).toEqual(["app->gw", "gw->orders"]);
  });
  test("clamps the step", () => {
    const end = sceneFrame(model, "valid", 99);
    expect(end.active).toBe("db");
    expect(end.count).toBe("4 / 4");
    expect(sceneFrame(model, "valid", -3).active).toBe("app");
  });
  test("prefers the edge in path direction", () => {
    expect(sceneFrame(model, "back", 1).edges).toEqual(["gw->app"]);
  });
  test("unknown scene", () => {
    expect(sceneFrame(model, "nope", 0)).toEqual({ active: null, done: [], edges: [], note: null, count: "" });
  });
});

describe("storyFrame", () => {
  test("a story step selects, compares and carries its note", () => {
    expect(storyFrame(model, "wau-story", 0)).toEqual({ sel: "web-4", cmp: null, note: "Web holds.", count: "1 / 2" });
    expect(storyFrame(model, "wau-story", 9)).toEqual({ sel: "mobile-4", cmp: "web-4", note: "Mobile passes it.", count: "2 / 2" });
  });
  test("a path scene is not a story", () => {
    expect(storyFrame(model, "valid", 0)).toBeNull();
  });
});

describe("pickNeighbor", () => {
  const o = { x: 0, y: 0 };
  test("picks the nearest candidate inside the cone", () => {
    const c = [{ id: "a", x: 100, y: 0 }, { id: "b", x: 100, y: 100 }, { id: "c", x: 300, y: 10 }];
    expect(pickNeighbor(o, c, "right")).toBe("a");
  });
  test("45° candidates are outside the 60° cone", () => {
    expect(pickNeighbor(o, [{ id: "b", x: 100, y: 100 }], "down")).toBeNull();
  });
  test("nothing behind", () => {
    expect(pickNeighbor(o, [{ id: "a", x: 100, y: 0 }], "left")).toBeNull();
  });
});

describe("navNeighbor (data-nav=row,col)", () => {
  const grid = [
    { id: "a", nav: [0, 0] as [number, number] }, { id: "b", nav: [0, 1] as [number, number] }, { id: "c", nav: [0, 2] as [number, number] },
    { id: "d", nav: [1, 0] as [number, number] }, { id: "e", nav: [2, 1] as [number, number] },
  ];
  test("left and right stay in the row", () => {
    expect(navNeighbor([0, 0], grid, "right")).toBe("b");
    expect(navNeighbor([0, 2], grid, "right")).toBeNull();
    expect(navNeighbor([1, 0], grid, "right")).toBeNull();
    expect(navNeighbor([0, 2], grid, "left")).toBe("b");
  });
  test("up and down keep the column (skipping gaps), else go to the nearest row", () => {
    expect(navNeighbor([0, 0], grid, "down")).toBe("d");
    expect(navNeighbor([0, 1], grid, "down")).toBe("e");
    expect(navNeighbor([0, 2], grid, "down")).toBe("d");
    expect(navNeighbor([2, 1], grid, "up")).toBe("b");
    expect(navNeighbor([2, 1], grid.filter((x) => x.id !== "b"), "up")).toBe("d");
  });
});

describe("card: relations", () => {
  test("edges read in order: In holds 'Source → verb', Out holds 'verb → Target'; no invented rows", () => {
    expect(relationGroups(model, "gw")).toEqual([
      { rel: "In", chips: [{ id: "app", text: "Web app → sends token" }] },
      { rel: "Out", chips: [{ id: "orders", text: "Orders" }, { id: "app", text: "Web app" }, { id: "pay", text: "Payments" }] },
    ]);
    expect(relationGroups(model, "db")).toEqual([{ rel: "In", chips: [{ id: "orders", text: "Orders" }] }]);
    const words = JSON.stringify(relationGroups(model, "orders"));
    expect(words).not.toContain("leads to");
    expect(words).not.toContain("←");
  });
  test("an edge has no rows: its endpoints are the title", () => {
    expect(relationGroups(model, "app->gw")).toEqual([]);
  });
  test("engine links win, without the element itself", () => {
    expect(relationGroups(model, "stops")).toEqual([{ rel: "Explained by", chips: [{ id: "card-b", text: "B · Cache the journal" }, { id: "card-c", text: "C · Debounce stop" }] }]);
  });
  test("members named after their group drop the prefix; members the facts cite are not repeated", () => {
    const m: DocModel = {
      scenes: {}, glossary: {},
      elements: {
        mobile: { id: "mobile", type: "group", label: "Mobile", members: ["mobile-1", "mobile-2"] },
        "mobile-1": { id: "mobile-1", type: "item", label: "Mobile, Jan" },
        "mobile-2": { id: "mobile-2", type: "item", label: "Mobile · Feb" },
        web: { id: "web", type: "group", label: "Web", members: ["web-1"], facts: [{ k: "Peak", v: "47k", ref: "web-1" }] },
        "web-1": { id: "web-1", type: "item", label: "Web, Dec" },
      },
    };
    expect(relationGroups(m, "mobile")).toEqual([{ rel: "Contains", chips: [{ id: "mobile-1", text: "Jan" }, { id: "mobile-2", text: "Feb" }] }]);
    expect(relationGroups(m, "web")).toEqual([]);
  });

  test("a small group lists its members", () => {
    expect(relationGroups(model, "core").at(-1)).toEqual({ rel: "Contains", chips: [{ id: "gw", text: "Gateway" }, { id: "orders", text: "Orders" }, { id: "db", text: "Orders DB" }] });
  });
});

describe("card: content", () => {
  test("an edge shows its endpoints once and its value, never the title twice", () => {
    const d = cardData(model, "bot->reopened")!;
    expect(d.title).toBe("Bot answer → Reopened");
    expect(d.ends).toEqual([{ id: "bot", text: "Bot answer" }, { id: "reopened", text: "Reopened" }]);
    expect(d.value).toBe("800 · 30% of Bot answer");
    expect(d.eyebrow).toBe("Flow · 6 of 11");
  });
  test("eyebrow words match the legend", () => {
    expect(cardData(model, "db")!.eyebrow).toBe("Data store");
    expect(cardData(model, "app")!.eyebrow).toBe("Person");
    expect(cardData(model, "gw->pay")!.eyebrow).toBe("External call");
  });
  test("unknown id", () => {
    expect(cardData(model, "nope")).toBeNull();
  });
});

describe("compare", () => {
  test("A vs B with the difference", () => {
    const c = compareData(model, "mobile-4", "web-4")!;
    expect(c.rows[0]).toEqual({ k: "Value", a: "46k", b: "45k", d: "+1k" });
    expect(c.rows[1]).toEqual({ k: "vs Mar", a: "+4k", b: "+1k", d: "+3k" });
  });
  test("numbers read back from formatted values", () => {
    expect(parseNum("46k")).toBe(46000);
    expect(parseNum("−$1,234")).toBe(-1234);
    expect(parseNum("8.8%")).toBe(8.8);
    expect(parseNum("n/a")).toBeNull();
  });
  test("differences keep the style of the value", () => {
    expect(fmtDelta(1000, "46k")).toBe("+1k");
    expect(fmtDelta(-3190, "930 signups")).toBe("−3,190 signups");
    expect(fmtDelta(40, "$1,234")).toBe("+$40");
    expect(fmtDelta(2.5, "8.8%")).toBe("+2.5 pts");
    expect(fmtDelta(0, "12")).toBe("0");
    expect(fmtDelta(-3, "#1 of 7")).toBe("−3");
  });
});

describe("small helpers", () => {
  test("refIds splits 'a b' and 'a+b'", () => {
    expect(refIds("a b")).toEqual(["a", "b"]);
    expect(refIds("a+b")).toEqual(["a", "b"]);
    expect(refIds(null)).toEqual([]);
  });
  test("sayLine prefers the engine's say", () => {
    expect(sayLine({ id: "x", type: "item", label: "Newsletter", value: "930", say: "Newsletter, 930 signups, 5th of 7" })).toBe("Newsletter, 930 signups, 5th of 7");
    expect(sayLine(model.elements["mobile-4"])).toBe("Mobile, Apr · 46k · +4k");
  });
  test("toCsv quotes what needs it", () => {
    expect(toCsv([["Channel", "Signups"], ["Paid, search", "1,280"], ['Say "hi"', "3"]])).toBe('Channel,Signups\n"Paid, search","1,280"\n"Say ""hi""",3');
  });
});

test("bundles for the browser under 56 KB (card, placement, rings, keyboard, reading panel and callouts included)", async () => {
  const out = await Bun.build({
    entrypoints: [`${import.meta.dir}/../client/client.ts`],
    target: "browser",
    format: "iife",
    minify: true,
  });
  expect(out.success).toBe(true);
  const js = await out.outputs[0].text();
  expect(js.length).toBeLessThan(56 * 1024);
});

describe("dimmed label ink", () => {
  const white: Rgb = [255, 255, 255];
  test("saturate(0) is grey, saturate(1) changes nothing", () => {
    expect(saturate([200, 100, 50], 1).map(Math.round)).toEqual([200, 100, 50]);
    const g = saturate([200, 100, 50], 0).map(Math.round);
    expect(g[0]).toBe(g[1]);
    expect(g[1]).toBe(g[2]);
  });
  test("composite lays an alpha colour over a background", () => {
    expect(composite([0, 0, 0, 0.5], white).map(Math.round)).toEqual([128, 128, 128]);
    expect(contrast([0, 0, 0], white)).toBeCloseTo(21, 5);
  });
  test("the quietest ink that keeps 3.3:1 wins; the strongest when none does", () => {
    const faint: Rgba = [180, 180, 180, 1], mid: Rgba = [110, 110, 110, 1], ink: Rgba = [20, 20, 20, 1];
    expect(pickInk(white, [faint, mid, ink])).toBe(1);
    expect(pickInk([140, 140, 140], [faint, [150, 150, 150, 1]])).toBe(0);
    expect(pickInk([235, 235, 235], [faint, [60, 60, 60, 0.3], ink])).toBe(2);
    expect(DIM_MIN).toBeGreaterThan(3);
  });
});
