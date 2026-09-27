import { describe, expect, test } from "bun:test";
import { SpecError, type ColorTokens, type Diagnostic, type RawBlock, type RenderContext, type Segment, type Theme } from "../engine/types";
import { stepsModule } from "../engine/blocks/steps";
import { noteModule } from "../engine/blocks/note";
import { glossaryModule } from "../engine/blocks/glossary";
import { widgetCode, widgetModule } from "../engine/blocks/widget";
import { detailModule } from "../engine/blocks/detail";
import { esc, findFigureRaw, lookupLabel, slug } from "../engine/blocks/util";

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
  nodes: { gw: { label: "Gateway", at: [0, 0] }, orders: { label: "Orders", at: [1, 0] } },
  groups: { core: { label: "Core", from: [0, 0], to: [1, 0] } },
  scenes: { valid: { title: "A valid request", path: ["gw", "orders"] }, denied: { title: "Denied", path: ["gw"] } },
});

const docSegments: Segment[] = [
  { kind: "markdown", text: "Intro", line: 1 },
  { kind: "container", layout: "split", args: ["2fr", "1fr"], line: 2, children: [{ kind: "block", block: figure }] },
];

describe("util", () => {
  test("escapes all five characters", () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
  test("finds figures inside containers and looks up labels", () => {
    const doc = { front: {}, segments: docSegments };
    expect(findFigureRaw(doc).length).toBe(1);
    expect(findFigureRaw(doc, "nope")).toEqual([]);
    expect(lookupLabel(doc, "gw")).toBe("Gateway");
    expect(lookupLabel(doc, "core")).toBe("Core");
    expect(lookupLabel(doc, "missing")).toBeUndefined();
  });
  test("slugs", () => {
    expect(slug("Zażółć token!")).toBe("zazolc-token");
    expect(slug("Access Token")).toBe("access-token");
  });
});

describe("steps", () => {
  test("renders controls and scene titles from the figure", () => {
    const { ctx } = setup(docSegments);
    const block = stepsModule.normalize(raw("steps", { for: "auth" }), ctx);
    expect(block.scenes).toBeUndefined();
    const html = stepsModule.render(block, ctx);
    expect(html).toStartWith('<div class="x-steps" data-for="auth"><div class="x-steps-bar">');
    expect(html).toContain('data-action="prev" aria-label="Previous step"');
    expect(html).toContain('<span class="x-steps-count" aria-live="polite"></span>');
    expect(html).toContain('<button type="button" class="x-scene" data-scene="valid">A valid request</button>');
    expect(html).toContain('data-scene="denied">Denied</button>');
    expect(html).toEndWith('<p class="x-steps-note" aria-live="polite"></p></div>');
  });

  test("keeps the chosen subset and order", () => {
    const { ctx } = setup(docSegments);
    const html = stepsModule.render(stepsModule.normalize(raw("steps", { for: "auth", scenes: ["denied"] }), ctx), ctx);
    expect(html).not.toContain('data-scene="valid"');
  });

  test("steps through any block's story", () => {
    const storied = raw("bar", { id: "sig", title: "Signups", story: [{ sel: "a" }, { sel: "b" }] });
    const { ctx } = setup([{ kind: "block", block: storied }]);
    const html = stepsModule.render(stepsModule.normalize(raw("steps", { for: "sig" }), ctx), ctx);
    expect(html).toContain('<button type="button" class="x-scene" data-scene="sig-story">Signups</button>');
    expect(html).toContain('<span class="x-steps-keys" aria-hidden="true">');
  });

  test("rejects unknown figures and scenes", () => {
    const { ctx } = setup(docSegments);
    expect(specError(() => stepsModule.normalize(raw("steps", { for: "nope" }), ctx)).rule).toBe("ref-exists");
    expect(specError(() => stepsModule.normalize(raw("steps", { for: "auth", scenes: ["x"] }), ctx)).rule).toBe("ref-exists");
  });
});

describe("note", () => {
  test("renders markdown with its tone", () => {
    const { ctx } = setup();
    const block = noteModule.normalize(raw("note", undefined, { info: ["warn"], body: "Tokens expire after **15 minutes**." }), ctx);
    const html = noteModule.render(block, ctx);
    expect(html).toStartWith('<aside class="x-note" data-tone="warn" role="note">');
    expect(html).toContain("<strong>15 minutes</strong>");
  });

  test("defaults to info and rejects unknown tones", () => {
    const { ctx } = setup();
    expect(noteModule.normalize(raw("note", undefined, { body: "Hi" }), ctx).tone).toBe("info");
    specError(() => noteModule.normalize(raw("note", undefined, { info: ["loud"], body: "Hi" }), ctx));
  });
});

describe("glossary", () => {
  test("renders terms and model", () => {
    const { ctx } = setup();
    const block = glossaryModule.normalize(raw("glossary", { token: "A short-lived string.", "Access Key": "A long one." }), ctx);
    const html = glossaryModule.render(block, ctx);
    expect(html).toBe('<dl class="x-glossary"><dt id="term-token">token</dt><dd>A short-lived string.</dd><dt id="term-access-key">Access Key</dt><dd>A long one.</dd></dl>');
    expect(glossaryModule.model!(block)).toEqual({ glossary: { token: "A short-lived string.", "Access Key": "A long one." } });
  });

  test("rejects lists and empty definitions", () => {
    const { ctx } = setup();
    specError(() => glossaryModule.normalize(raw("glossary", ["token"]), ctx));
    specError(() => glossaryModule.normalize(raw("glossary", { token: "" }), ctx));
  });
});

describe("widget", () => {
  test("renders a mount point and wraps the code", () => {
    const { ctx } = setup();
    const block = widgetModule.normalize(raw("widget", undefined, { info: ["cost-slider"], body: "el.textContent = '1';" }), ctx);
    expect(widgetModule.render(block, ctx)).toBe('<div class="x-widget" data-widget="cost-slider"></div>');
    expect(widgetCode(block)).toBe(`explainer.register("cost-slider", (el, api) => {\nel.textContent = '1';\n});`);
  });

  test("a name is defined once per document", () => {
    const a = raw("widget", undefined, { info: ["dup"], body: "x", line: 2 });
    const b = raw("widget", undefined, { info: ["dup"], body: "y", line: 9 });
    const { ctx } = setup([{ kind: "block", block: a }, { kind: "block", block: b }]);
    expect(widgetModule.normalize(a, ctx).name).toBe("dup");
    const e = specError(() => widgetModule.normalize(b, ctx));
    expect([e.rule, e.line]).toEqual(["id-unique", 9]);
  });

  test("rejects bad names", () => {
    const { ctx } = setup();
    specError(() => widgetModule.normalize(raw("widget", undefined, { info: ["Bad Name"], body: "x" }), ctx));
    specError(() => widgetModule.normalize(raw("widget", undefined, { body: "x" }), ctx));
  });
});

describe("detail", () => {
  test("renders the inline panel", () => {
    const { ctx } = setup();
    const block = detailModule.normalize(raw("detail", null), ctx);
    expect(detailModule.render(block, ctx)).toBe(
      '<aside class="x-detail" data-detail data-placement="inline" aria-live="polite"><p class="x-detail-empty">Select any part to see what it does.</p></aside>',
    );
  });

  test("rejects fields", () => {
    specError(() => detailModule.normalize(raw("detail", { title: "x" }), setup().ctx));
  });
});
