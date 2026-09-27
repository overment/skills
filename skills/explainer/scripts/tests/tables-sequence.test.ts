import { describe, expect, test } from "bun:test";
import { SpecError, type ColorTokens, type Diagnostic, type RawBlock, type RenderContext, type Segment, type Theme } from "../engine/types";
import { matrixModule } from "../engine/blocks/matrix";
import { compareModule } from "../engine/blocks/compare";
import { sequence } from "../engine/blocks/sequence";

const colors: ColorTokens = {
  bg: "#fff", surface: "#fff", "surface-2": "#f4f4f5", line: "#e4e4e7", "line-strong": "#a1a1aa",
  text: "#18181b", "text-dim": "#52525b", "text-faint": "#a1a1aa", accent: "#2563eb",
  ok: "#16a34a", warn: "#d97706", danger: "#dc2626", info: "#0284c7", link: "#7c3aed",
};

const theme: Theme = {
  name: "test",
  fonts: { sans: { family: "Sans", fallback: "sans-serif", faces: [] }, mono: { family: "Mono", fallback: "monospace", faces: [] } },
  colors: { light: colors, dark: colors },
  type: { caption: 12, ui: 13, body: 16, h2: 20, h1: 28, nodeLabel: 14, nodeSub: 11, edgeLabel: 11, tag: 10 },
  radius: 6,
  grid: { unit: 8, cell: [160, 64], gap: [104, 48], pad: 32 },
};

function setup(segments: Segment[] = []) {
  const warnings: Diagnostic[] = [];
  const ctx: RenderContext = { theme, doc: { front: {}, segments }, inline: (s) => s, warn: (d) => void warnings.push(d) };
  return { ctx, warnings };
}

const raw = (type: string, data: unknown, extra: Partial<RawBlock> = {}): RawBlock => ({ type, info: [], body: "", data, line: 3, ...extra });

function specError(fn: () => unknown): SpecError {
  try {
    fn();
  } catch (e) {
    if (e instanceof SpecError) return e;
    throw e;
  }
  throw new Error("expected a SpecError");
}

const figure = raw("figure", {
  id: "auth",
  layout: "flow",
  nodes: { gw: { label: "Gateway", at: [0, 0] }, orders: { label: "Orders", at: [1, 0] }, endpoint: { label: "Endpoint", at: [2, 0] } },
  groups: { core: { label: "Core", from: [0, 0], to: [1, 0] } },
  scenes: { valid: { title: "A valid request", path: ["gw", "orders"] }, denied: { title: "Denied", path: ["gw"] } },
});

const docSegments: Segment[] = [
  { kind: "markdown", text: "Intro", line: 1 },
  { kind: "container", layout: "split", args: ["2fr", "1fr"], line: 2, children: [{ kind: "block", block: figure }] },
];

describe("matrix", () => {
  const data = {
    id: "access",
    title: "Who can do what",
    corner: "Action",
    columns: ["gw", { id: "audit", label: "Audit log" }],
    rows: [
      { id: "read", label: "Read orders", cells: { gw: "yes", audit: true } },
      { id: "write", label: "Create order", about: "Needs a valid token.", cells: { gw: "partial", audit: "later" } },
      { id: "drop", label: "Delete", cells: { gw: false } },
    ],
  };

  test("looks up column labels through containers and renders selectable cells", () => {
    const { ctx } = setup(docSegments);
    const block = matrixModule.normalize(raw("matrix", data), ctx);
    expect(block.columns.map((c) => c.label)).toEqual(["Gateway", "Audit log"]);
    expect(block.rows[2]!.cells).toEqual({ gw: "no", audit: "no" });
    const html = matrixModule.render(block, ctx);
    expect(html).toStartWith('<table class="x-matrix" data-id="access"><caption class="x-block-title">Who can do what</caption>');
    expect(html).toContain('<th class="x-matrix-corner" scope="col">Action</th>');
    // A column that names a diagram part gets a matrix-local id, so a neighbour of that part never lights it.
    expect(html).toContain('<th scope="col" data-ref="access.gw" data-col="access.gw" tabindex="0">Gateway</th>');
    expect(html).toContain('<th scope="col" data-ref="audit" data-col="audit" tabindex="0">Audit log</th>');
    expect(html).toContain('<td class="x-cell" data-col="access.gw" data-value="yes"><span class="x-mark" data-id="read.gw" role="img" aria-label="Gateway can read orders">✓</span></td>');
    expect(html).toContain('data-value="partial"><span class="x-mark" data-id="write.gw" role="img" aria-label="Gateway can partly create order">◐</span>');
    expect(html).toContain('data-value="no"><span class="x-mark" data-id="drop.gw" role="img" aria-label="Gateway cannot delete">·</span>');
    expect(html).toContain('data-value="later"><span class="x-mark" data-id="write.audit" role="img" aria-label="Audit log · Create order: later">later</span>');
    expect(html).toContain('<tr data-ref="read"><th scope="row" tabindex="0">Read orders</th>');
  });

  test("falls back to the id and omits the caption", () => {
    const { ctx } = setup();
    const block = matrixModule.normalize(raw("matrix", { ...data, title: undefined }), ctx);
    expect(block.columns[0]!.label).toBe("gw");
    const html = matrixModule.render(block, ctx);
    expect(html).not.toContain("<caption");
    expect(html).toContain('data-ref="gw" data-col="gw"');
  });

  test("model: rows, cells in words, and columns that link back to their diagram part", () => {
    const { ctx } = setup(docSegments);
    const model = matrixModule.model!(matrixModule.normalize(raw("matrix", data), ctx));
    const els = model.elements!;
    expect(Object.keys(els).sort()).toEqual(["access.gw", "audit", "drop", "drop.audit", "drop.gw", "read", "read.audit", "read.gw", "write", "write.audit", "write.gw"]);
    expect(els.write).toMatchObject({ type: "row", label: "Create order", about: "Needs a valid token.", figure: "access", related: ["gw"] });
    expect(els.read!.facts).toEqual([{ k: "Allowed in", v: "2 of 2" }]);
    expect(els.read!.links).toEqual([{ rel: "Allowed in", ids: ["access.gw", "audit"] }]);
    expect(els["write.gw"]).toMatchObject({ type: "item", kind: "cell", label: "Gateway can partly create order", value: "partly allowed", related: ["access.gw", "gw"], context: ["write"] });
    expect(els["access.gw"]).toMatchObject({
      type: "column", label: "Gateway", members: ["read.gw", "write.gw", "drop.gw"],
      facts: [{ k: "Allows", v: "1 of 3" }],
      links: [{ rel: "In the diagram", ids: ["gw"], inverse: 'Column in "Who can do what"' }],
    });
    expect(els.audit).toMatchObject({ type: "column", label: "Audit log", facts: [{ k: "Allows", v: "1 of 3" }] });
    expect(els.audit!.links).toBeUndefined();
  });

  test("a part's neighbour never shares an id with the part's column", () => {
    const { ctx } = setup(docSegments);
    const html = matrixModule.render(matrixModule.normalize(raw("matrix", { id: "m", columns: ["gw", "orders"], rows: [{ id: "r", label: "R", cells: { gw: "yes" } }] }), ctx), ctx);
    expect(html).not.toMatch(/data-(ref|col)="(gw|orders)"/);
  });

  test("reading line and data table", () => {
    const { ctx } = setup(docSegments);
    const block = matrixModule.normalize(raw("matrix", data), ctx);
    expect(matrixModule.reading!(block)).toStartWith("Each row is an action and each column a part of the diagram above: ✓ = yes");
    expect(matrixModule.table!(block)).toEqual({
      head: ["Action", "Gateway", "Audit log"],
      rows: [["Read orders", "allowed", "allowed"], ["Create order", "partly allowed", "later"], ["Delete", "not allowed", "not allowed"]],
    });
  });

  test("rejects unknown cell columns and unknown fields; takes notes and a caveat", () => {
    const { ctx } = setup();
    const bad = specError(() => matrixModule.normalize(raw("matrix", { ...data, rows: [{ id: "x", label: "X", cells: { nope: "yes" } }] }), ctx));
    expect(bad.rule).toBe("ref-exists");
    expect(bad.line).toBe(3);
    const unknown = specError(() => matrixModule.normalize(raw("matrix", { ...data, colour: "red" }), ctx));
    expect(unknown.rule).toBe("spec");
    expect(unknown.message).toContain("Allowed: id, title, corner, columns, rows, notes, caveat, story");
    specError(() => matrixModule.normalize(raw("matrix", { columns: ["a"], rows: [] }), ctx));
    const noted = matrixModule.normalize(raw("matrix", { ...data, notes: [{ on: "read", text: "Everyone reads." }], caveat: "Admins are not shown." }), ctx);
    expect(noted.notes).toEqual([{ on: ["read"], text: "Everyone reads." }]);
    expect(noted.caveat).toBe("Admins are not shown.");
  });

  test("escapes markup in labels", () => {
    const { ctx } = setup();
    const block = matrixModule.normalize(raw("matrix", { id: "m", columns: ["a"], rows: [{ id: "r", label: "<script>alert(1)</script>" }] }), ctx);
    const html = matrixModule.render(block, ctx);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("compare", () => {
  const items = [
    { id: "before", label: "Before", points: ["Slow", "Manual"] },
    { id: "after", label: "After", points: ["Fast"], focal: true, about: "The new path." },
  ];

  test("renders items and model", () => {
    const { ctx, warnings } = setup();
    const block = compareModule.normalize(raw("compare", { id: "change", title: "Then and now", items }), ctx);
    const html = compareModule.render(block, ctx);
    expect(html).toStartWith('<p class="x-block-title">Then and now</p><div class="x-compare" data-id="change" data-count="2" data-rows="2">');
    expect(html).toContain('<article class="x-compare-item" data-ref="before" data-focal="false" tabindex="0"><h3 class="x-compare-label">Before</h3><ul class="x-compare-points"><li>Slow</li><li>Manual</li></ul></article>');
    expect(html).toContain('data-ref="after" data-focal="true"');
    expect(compareModule.model!(block).elements!.after).toMatchObject({ type: "item", about: "The new path.", figure: "change" });
    expect(compareModule.table!(block)).toEqual({ head: ["Before", "After"], rows: [["Slow", "Fast"], ["Manual", ""]] });
    expect(warnings).toEqual([]);
  });

  const dimensional = {
    id: "delivery",
    dimensions: [{ id: "delay", label: "Delay" }, "Needs"],
    items: [
      { id: "polling", label: "Polling", values: { delay: "up to 30 s", needs: "a timer" }, points: [] },
      { id: "webhooks", label: "Webhooks", focal: true, on: "endpoint", values: { delay: "about 1 s", needs: "a public endpoint" }, points: ["Signed"] },
    ],
  };

  test("dimensions render as aligned, selectable rows with the same id on every card", () => {
    const { ctx, warnings } = setup(docSegments);
    const block = compareModule.normalize(raw("compare", dimensional), ctx);
    expect(block.dimensions).toEqual([{ id: "delay", label: "Delay" }, { id: "needs", label: "Needs" }]);
    const html = compareModule.render(block, ctx);
    expect(html).toContain('data-count="2" data-rows="4"');
    expect(html.match(/<dl class="x-compare-row x-mark" data-id="delivery-delay" data-dim="delay">/g)!.length).toBe(2);
    expect(html).toContain("<dt>Delay</dt><dd>about 1 s</dd>");
    expect(warnings).toEqual([]);
  });

  test("model: paired rows per item, a delta per dimension, and a link to the diagram part", () => {
    const { ctx } = setup(docSegments);
    const els = compareModule.model!(compareModule.normalize(raw("compare", dimensional), ctx)).elements!;
    expect(els.webhooks).toMatchObject({
      related: ["endpoint"],
      links: [{ rel: "In the diagram", ids: ["endpoint"], inverse: "Compared in" }],
      facts: [{ k: "Delay", v: "about 1 s vs up to 30 s" }, { k: "Needs", v: "a public endpoint vs a timer" }],
    });
    expect(els["delivery-delay"]).toMatchObject({ kind: "dimension", label: "Delay" });
    expect(els["delivery-delay"]!.facts).toEqual([
      { k: "Polling", v: "up to 30 s", ref: "polling" },
      { k: "Webhooks", v: "about 1 s", ref: "webhooks" },
      { k: "Webhooks vs Polling", v: "−29 s · 30× lower" },
    ]);
    expect(els["delivery-needs"]!.facts!.map((f) => f.k)).toEqual(["Polling", "Webhooks"]);
  });

  test("warns on a link to no diagram part and rejects values for unknown dimensions", () => {
    const { ctx, warnings } = setup();
    compareModule.normalize(raw("compare", dimensional), ctx);
    expect(warnings.map((w) => w.rule)).toEqual(["ref-exists"]);
    const bad = specError(() => compareModule.normalize(raw("compare", { ...dimensional, items: [{ id: "a", label: "A", values: { speed: "1" } }, { id: "b", label: "B" }] }), ctx));
    expect(bad.rule).toBe("ref-exists");
  });

  test("warns on too many focal items", () => {
    const { ctx, warnings } = setup();
    const three = ["a", "b", "c"].map((id) => ({ id, label: id.toUpperCase(), points: [], focal: true }));
    compareModule.normalize(raw("compare", { id: "c", items: three }), ctx);
    expect(warnings.map((w) => w.rule)).toEqual(["budget-focal"]);
  });

  test("needs 2 to 4 items", () => {
    const { ctx } = setup();
    specError(() => compareModule.normalize(raw("compare", { id: "c", items: items.slice(0, 1) }), ctx));
    const five = ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id }));
    expect(specError(() => compareModule.normalize(raw("compare", { id: "c", items: five }), ctx)).message).toContain("got 5");
  });

  test("escapes labels", () => {
    const { ctx } = setup();
    const block = compareModule.normalize(raw("compare", { id: "c", dimensions: ["<b>"], items: [{ id: "a", label: "<script>", values: { b: "<i>" } }, { id: "b", label: "B" }] }), ctx);
    expect(compareModule.render(block, ctx)).not.toMatch(/<script>|<b>|<i>/);
  });
});

describe("sequence", () => {
  const data = {
    id: "login",
    layout: "sequence",
    title: "Signing in",
    actors: {
      app: { label: "Web app" },
      gw: { label: "Gateway", sub: ":443", focal: true, about: "Checks tokens." },
      db: { label: "Users DB", kind: "store" },
    },
    messages: [
      "app -> gw: sends token",
      { "gw -> db": "looks up" },
      "db --> gw",
      { from: "gw", to: "gw", label: "verifies" },
      "gw => app: redirect",
    ],
    scenes: { happy: { title: "Happy path", path: ["app", "gw", "db"], notes: { gw: "Checks it." } } },
  };
  const lifelines = (html: string) => [...html.matchAll(/class="x-lifeline" data-for="\w+" x1="([\d.]+)"/g)].map((m) => +m[1]);
  const masks = (html: string) =>
    [...html.matchAll(/class="x-edge-mask" x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)"/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3] }));

  test("normalizes every message form", () => {
    const block = sequence.normalize(raw("figure", data), setup().ctx);
    expect(block.actors.map((a) => [a.kind, a.at])).toEqual([["actor", [0, 0]], ["service", [1, 0]], ["store", [2, 0]]]);
    expect(block.messages.map((m) => [m.id, m.from, m.to, m.kind, m.label])).toEqual([
      ["m1", "app", "gw", "flow", "sends token"],
      ["m2", "gw", "db", "flow", "looks up"],
      ["m3", "db", "gw", "return", undefined],
      ["m4", "gw", "gw", "flow", "verifies"],
      ["m5", "gw", "app", "link", "redirect"],
    ]);
    expect(block.legend).toBe(true);
  });

  test("renders lifelines, activation bars, numbered focusable messages and paint order", () => {
    const { ctx } = setup();
    const html = sequence.render(sequence.normalize(raw("figure", data), ctx), ctx);
    expect(html).toStartWith('<figure class="x-figure" data-figure="login" data-layout="sequence"><figcaption class="x-figure-title">Signing in</figcaption><svg class="x-svg"');
    expect(html).toContain('role="group" aria-label="Signing in" aria-describedby="login-desc"><desc id="login-desc">Sequence of 5 messages between Web app, Gateway and Users DB.</desc><defs>');
    expect(html.match(/class="x-lifeline"/g)!.length).toBe(3);
    expect(html).toContain('<line class="x-lifeline" data-for="app" x1="112" y1="76" x2="112"');
    // Gateway is busy from the token it receives to the redirect it sends; the app only once it gets the redirect.
    expect(html).toContain('<rect class="x-activation" data-for="gw" x="371" y="100" width="10" height="176"/>');
    expect(html).toContain('<rect class="x-activation" data-for="app" x="107" y="260" width="10" height="16"/>');
    expect(html).not.toMatch(/x-activation" data-for="app" x="107" y="100"/);
    expect(html).toContain('<g class="x-edge" data-id="m1" data-from="app" data-to="gw" data-kind="flow" data-nav="0,0" tabindex="0" role="button" aria-label="Message 1 of 5: Web app to Gateway, sends token"><path class="x-edge-line" d="M112,108 H369" marker-end="url(#login-arrow)"/>');
    expect(html).toContain('marker-end="url(#login-arrow-link)"');
    expect(html).toContain('<text class="x-seq-num" data-for="m1" x="120" y="104">1</text>');
    expect(html).toContain('<text class="x-seq-num" data-for="m3" x="627" y="184" text-anchor="end">3</text>');
    expect(html).toContain('<g class="x-edge-label" data-for="m1"><rect class="x-edge-mask"');
    expect(html).toMatch(/data-id="m4"[^>]*><path class="x-edge-line" d="M381,228 H405 Q413,228 413,236 V240/);
    for (const id of ["login-arrow", "login-arrow-link", "login-arrow-open"]) expect(html).toContain(`<marker id="${id}"`);
    const order = ["x-lifeline", "x-activation", 'class="x-edge"', "x-seq-num", 'class="x-edge-label"', 'class="x-node"', 'class="x-legend"'].map((s) => html.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain('aria-label="Gateway. Checks tokens."');
  });

  test("async messages end in an open head", () => {
    const { ctx } = setup();
    const html = sequence.render(sequence.normalize(raw("figure", { id: "a", actors: { a: { label: "A" }, b: { label: "B" } }, messages: ["a ~> b: later"] }), ctx), ctx);
    expect(html).toContain('marker-end="url(#a-arrow-open)"');
    expect(html).toContain('<path class="x-arrowhead x-arrowhead-open" d="M1,1 L7,4 L1,7"/>');
  });

  test("a label never sits on a lifeline, even when its message spans a middle actor", () => {
    const { ctx, warnings } = setup();
    const spanning = { id: "s", actors: { a: { label: "A" }, b: { label: "B" }, c: { label: "C" } }, messages: ["a -> c: goes past B", "c --> a: back past B", "b -> b: thinks"] };
    const html = sequence.render(sequence.normalize(raw("figure", spanning), ctx), ctx);
    const xs = lifelines(html);
    for (const m of masks(html)) for (const x of xs) expect(x > m.x && x < m.x + m.w).toBe(false);
    expect(warnings).toEqual([]);
  });

  test("warns when a label is wider than the gap between lifelines", () => {
    const { ctx, warnings } = setup();
    const long = { id: "w", actors: { a: { label: "A" }, b: { label: "B" } }, messages: ["a -> b: sends a very long description of the request"] };
    sequence.render(sequence.normalize(raw("figure", long), ctx), ctx);
    expect(warnings.map((w) => w.rule)).toEqual(["edge-label"]);
    expect(warnings[0]!.message).toContain("wider than the gap between lifelines");
  });

  test("is deterministic", () => {
    const a = setup(), b = setup();
    expect(sequence.render(sequence.normalize(raw("figure", data), a.ctx), a.ctx)).toBe(
      sequence.render(sequence.normalize(raw("figure", data), b.ctx), b.ctx),
    );
  });

  test("model: messages in time order with prev/next, replies paired, actors listing their messages", () => {
    const model = sequence.model(sequence.normalize(raw("figure", data), setup().ctx));
    const els = model.elements!;
    expect(els.gw).toMatchObject({ type: "node", sub: ":443", kind: "service", figure: "login" });
    expect(els.m3).toMatchObject({ type: "edge", label: "", kind: "message", from: "db", to: "gw", pos: "3 / 5 · reply" });
    expect(els.m3!.facts).toEqual([{ k: "Answers", v: "message 2 · looks up", ref: "m2" }]);
    expect(els.m2!.facts).toEqual([{ k: "Answered by", v: "message 3", ref: "m3" }]);
    expect(els.m3!.links).toEqual([{ rel: "‹ Previous", ids: ["m2"] }, { rel: "Next ›", ids: ["m4"] }]);
    expect(els.m1!.links).toEqual([{ rel: "Next ›", ids: ["m2"] }]);
    expect(els.m5).toMatchObject({ pos: "5 / 5 · external call", say: "Message 5 of 5: Gateway to Web app, redirect" });
    expect(els.app!.links).toEqual([{ rel: "1 → Gateway", ids: ["m1"] }, { rel: "5 ← Gateway", ids: ["m5"] }]);
    expect(els.gw!.links!.map((l) => l.rel)).toEqual(["1 ← Web app", "2 → Users DB", "3 ← Users DB", "4 ↻", "5 → Web app"]);
    expect(els.gw!.facts).toEqual([{ k: "Sends", v: "3 messages" }, { k: "Receives", v: "3 messages" }, { k: "Busy during", v: "messages 1–5" }]);
    expect(model.scenes!.happy).toMatchObject({ figure: "login", edges: ["m1", "m2"], notes: { gw: "Checks it." } });
  });

  test("reading line and data table", () => {
    const block = sequence.normalize(raw("figure", data), setup().ctx);
    expect(sequence.reading(block)).toBe(
      "Time runs down the page: each arrow is one message, numbered in the order it is sent. Solid = flow, dashed = reply, blue = external call. " +
      "A bar on a lifeline shows when that part is busy handling a message. Accent marks Gateway, the part this page is about.",
    );
    expect(sequence.table(block).rows[2]).toEqual(["3", "Users DB", "Gateway", "", "reply"]);
  });

  test("rejects unknown actors, bad arrows, decision actors and bad scene paths", () => {
    const { ctx } = setup();
    expect(specError(() => sequence.normalize(raw("figure", { ...data, messages: ["app -> nope"] }), ctx)).rule).toBe("ref-exists");
    expect(specError(() => sequence.normalize(raw("figure", { ...data, messages: ["app to gw"] }), ctx)).rule).toBe("spec");
    expect(specError(() => sequence.normalize(raw("figure", { ...data, scenes: { s: { path: ["m9"] } } }), ctx)).rule).toBe("ref-exists");
    expect(specError(() => sequence.normalize(raw("figure", { ...data, actors: { x: { label: "X", kind: "decision" } }, messages: ["x -> x"] }), ctx)).message).toContain("states figure");
  });

  test("notes point at messages or actors; a stray target warns", () => {
    const { ctx, warnings } = setup();
    const block = sequence.normalize(raw("figure", { ...data, notes: [{ on: "m2", text: "The lookup." }, { on: "m9", text: "Nothing." }] }), ctx);
    expect(warnings.map((w) => w.rule)).toEqual(["ref-exists"]);
    const html = sequence.render(block, ctx);
    expect(html).toContain('<g class="x-note-marker" data-note="1" data-for="m2">');
    expect(html).not.toContain('data-note="2"');
  });

  test("warns over budget and on actor labels that don't fit", () => {
    const { ctx, warnings } = setup();
    const actors = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((id) => [id, { label: id.toUpperCase() }]));
    sequence.normalize(raw("figure", { id: "big", actors, messages: ["a -> f"] }), ctx);
    expect(warnings.map((w) => w.rule)).toEqual(["budget-nodes"]);
    const wide = setup();
    sequence.normalize(raw("figure", { id: "w", actors: { a: { label: "A very long actor name that overflows" } }, messages: ["a -> a"] }), wide.ctx);
    expect(wide.warnings.map((w) => w.rule)).toEqual(["label-fit"]);
  });

  test("escapes labels", () => {
    const { ctx } = setup();
    const block = sequence.normalize(raw("figure", { id: "x", actors: { a: { label: "<script>" } }, messages: ["a -> a: <b>"] }), ctx);
    expect(sequence.render(block, ctx)).not.toMatch(/<script>|<b>/);
  });
});

describe("sequence width", () => {
  const actors = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, { label: `Actor ${i + 1}` }]));
  const width = (html: string) => +/<svg [^>]*width="([\d.]+)"/.exec(html)![1];

  test("up to five actors fit 960px, so the card docks beside the figure in a 1232px column", () => {
    for (const n of [2, 3, 4, 5]) {
      const { ctx, warnings } = setup();
      const messages = Array.from({ length: n - 1 }, (_, i) => `a${i} -> a${i + 1}: hands over`);
      const html = sequence.render(sequence.normalize(raw("figure", { id: `s${n}`, actors: actors(n), messages }), ctx), ctx);
      expect(width(html)).toBeLessThanOrEqual(960);
      expect(warnings.filter((w) => w.rule === "edge-label")).toEqual([]);
    }
  });

  test("a self-loop label on the last actor stays inside the width", () => {
    const { ctx } = setup();
    const html = sequence.render(sequence.normalize(raw("figure", {
      id: "loop", actors: actors(4), messages: ["a0 -> a3: asks", "a3 -> a3: checks its own records"],
    }), ctx), ctx);
    expect(width(html)).toBeLessThanOrEqual(960);
  });
});
