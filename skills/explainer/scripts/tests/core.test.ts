import { describe, expect, test } from "bun:test";
import { inlineMarkdown, registerBlock, renderDoc } from "../engine/blocks.ts";
import { lint } from "../engine/lint.ts";
import { buildHtml } from "../engine/page.ts";
import { parseDoc } from "../engine/parse.ts";
import { blockModules } from "../engine/registry.ts";
import { reportModules } from "../engine/report/index.ts";
import { SpecError, type BlockModule, type RawBlock, type RenderContext, type Segment, type Theme } from "../engine/types.ts";

const lines = (...l: string[]) => l.join("\n");

function specError(fn: () => unknown): SpecError {
  try {
    fn();
  } catch (e) {
    if (e instanceof SpecError) return e;
    throw e;
  }
  throw new Error("expected a SpecError");
}

describe("parseDoc", () => {
  test("reads front matter and keeps source line numbers", () => {
    const doc = parseDoc(lines("---", "title: Hello", "mode: dark", "---", "", "Some text.", "", "```note warn loud", "Be **careful**.", "```", ""), "doc.md");
    expect(doc.front).toEqual({ title: "Hello", mode: "dark" });
    expect(doc.file).toBe("doc.md");
    expect(doc.segments).toEqual([
      { kind: "markdown", text: "Some text.", line: 6 },
      { kind: "block", block: { type: "note", info: ["warn", "loud"], body: "Be **careful**.", data: undefined, line: 8 } },
    ]);
  });

  test("parses YAML bodies in backtick, tilde and longer fences", () => {
    const doc = parseDoc(lines("````figure", "id: f", "note: |", "  ```", "  inner", "  ```", "````", "~~~matrix", "id: m", "~~~", "```detail", "```"));
    const blocks = doc.segments.map((s) => (s.kind === "block" ? s.block : undefined));
    expect(blocks.map((b) => [b?.type, b?.line])).toEqual([["figure", 1], ["matrix", 8], ["detail", 11]]);
    expect(blocks[0]?.data).toEqual({ id: "f", note: "```\ninner\n```\n" });
    expect(blocks[1]?.data).toEqual({ id: "m" });
    expect(blocks[2]?.data).toEqual({});
  });

  test("unknown fence languages stay markdown, and ::: inside them is ignored", () => {
    const doc = parseDoc(lines("Intro", "", "```ts", "::: split", "const a = 1;", "```", "", "End"));
    expect(doc.segments).toHaveLength(1);
    expect(doc.segments[0]).toMatchObject({ kind: "markdown", line: 1 });
    expect((doc.segments[0] as { text: string }).text).toContain("::: split");
  });

  test("containers keep args and nest one level", () => {
    const doc = parseDoc(lines("# Title", "", "::: split 2fr 1fr", "```matrix", "id: m", "```", "::: stack", "Side note.", ":::", ":::", "Tail"));
    expect(doc.segments).toEqual([
      { kind: "markdown", text: "# Title", line: 1 },
      {
        kind: "container", layout: "split", args: ["2fr", "1fr"], line: 3, children: [
          { kind: "block", block: { type: "matrix", info: [], body: "id: m", data: { id: "m" }, line: 4 } },
          { kind: "container", layout: "stack", args: [], line: 7, children: [{ kind: "markdown", text: "Side note.", line: 8 }] },
        ],
      },
      { kind: "markdown", text: "Tail", line: 11 },
    ]);
  });

  test("container mistakes are SpecErrors with the offending line", () => {
    expect(specError(() => parseDoc(lines("Text", "::: split", "More"))).line).toBe(2);
    expect(specError(() => parseDoc(lines("::: split", "::: stack", "::: stack", ":::", ":::", ":::"))).line).toBe(3);
    expect(specError(() => parseDoc(lines("Text", ":::"))).line).toBe(2);
    expect(specError(() => parseDoc(lines("::: grid", ":::"))).line).toBe(1);
  });

  test("invalid YAML and unclosed block fences are SpecErrors at the fence line", () => {
    const yaml = specError(() => parseDoc(lines("Intro", "", "```figure", "nodes: [a, b", "```")));
    expect([yaml.line, yaml.rule]).toEqual([3, "spec"]);
    expect(specError(() => parseDoc(lines("Intro", "```steps", "for: x"))).line).toBe(2);
  });
});

interface StubBlock { type: "stub"; id: string; nodes: string[]; terms: Record<string, string>; line: number }

const stub = {
  type: "stub",
  normalize(raw: RawBlock, ctx: RenderContext): StubBlock {
    const data = raw.data as { id: string; nodes?: string[]; terms?: Record<string, string>; fail?: string; warn?: string };
    if (data.fail) throw new SpecError(data.fail);
    if (data.warn) ctx.warn({ rule: "route", severity: "warn", message: data.warn });
    return { type: "stub", id: data.id, nodes: data.nodes ?? [], terms: data.terms ?? {}, line: raw.line };
  },
  render: (b: StubBlock) => `<p class="stub">${b.nodes.join(",")}</p>`,
  model: (b: StubBlock) => ({
    elements: Object.fromEntries(b.nodes.map((id) => [id, { id, type: "node", label: id.toUpperCase(), figure: b.id }])),
    glossary: b.terms,
  }),
} as unknown as BlockModule;
registerBlock(stub);

const theme = {} as Theme;
const md = (text: string, line = 1): Segment => ({ kind: "markdown", text, line });
const stubAt = (line: number, data: Record<string, unknown>): Segment => ({ kind: "block", block: { type: "stub", info: [], body: "", data, line } });
const render = (...segments: Segment[]) => renderDoc({ front: {}, segments }, theme);

describe("renderDoc", () => {
  test("wraps blocks in sections and merges their models", () => {
    const { html, model, blocks, diagnostics } = render(stubAt(1, { id: "s1", nodes: ["a", "b"] }));
    expect(html).toBe('<section class="x-block" data-block="stub" data-id="s1"><p class="stub">a,b</p></section>');
    expect(model.elements.a).toMatchObject({ type: "node", label: "A", figure: "s1" });
    expect(blocks).toHaveLength(1);
    expect(diagnostics).toEqual([]);
  });

  test("rewrites prose links to known element ids only", () => {
    const { html } = render(stubAt(1, { id: "s", nodes: ["a"] }), md("See [the A](#a) and [elsewhere](#elsewhere).", 3));
    expect(html).toContain('<div class="x-prose">');
    expect(html).toContain('<a class="x-ref" data-ref="a" href="#sel=a">the A</a>');
    expect(html).toContain('<a href="#elsewhere">elsewhere</a>');
  });

  test("wraps the first free glossary occurrence per segment, skipping code, links and headings", () => {
    const { html } = render(
      stubAt(1, { id: "s", nodes: ["a"], terms: { token: "A short-lived proof." } }),
      md("## Token basics\n\nUse `token` in code, see [token](#a), then a Token here, tokens, and token again.", 2),
      md("Another token.", 6),
    );
    expect(html.match(/<dfn /g)).toHaveLength(2);
    expect(html).toContain('<dfn class="x-term" data-term="token" tabindex="0">Token</dfn> here');
    expect(html).toContain('Another <dfn class="x-term" data-term="token" tabindex="0">token</dfn>.');
    expect(html).toContain("<code>token</code>");
    expect(html).toContain('<h2 id="token-basics">Token basics</h2>');
  });

  test("longer glossary terms win over the terms they contain", () => {
    const { html } = render(stubAt(1, { id: "s", terms: { token: "t", "session token": "s" } }), md("A session token is a token.", 2));
    expect(html).toContain('<dfn class="x-term" data-term="session token" tabindex="0">session token</dfn>');
    expect(html).toContain('a <dfn class="x-term" data-term="token" tabindex="0">token</dfn>.');
  });

  test("gives headings unique slug ids across the document", () => {
    const { html } = render(md("## Hello World\n\nText"), md("## Hello World", 5));
    expect(html).toContain('<h2 id="hello-world">');
    expect(html).toContain('<h2 id="hello-world-2">');
  });

  test("reports duplicate element ids across blocks", () => {
    const { diagnostics } = render(stubAt(1, { id: "s1", nodes: ["a"] }), stubAt(5, { id: "s2", nodes: ["a"] }));
    expect(diagnostics).toEqual([expect.objectContaining({ rule: "id-unique", severity: "error", line: 5 })]);
  });

  test("renders an error box for a failing block and keeps the rest", () => {
    const { html, diagnostics, blocks } = render(stubAt(3, { id: "bad", fail: "Nodes need a label." }), stubAt(8, { id: "ok", nodes: ["a"] }));
    expect(html).toContain('<div class="x-error" role="alert">');
    expect(html).toContain("Nodes need a label.");
    expect(html).toContain('<p class="stub">a</p>');
    expect(diagnostics).toEqual([{ rule: "spec", severity: "error", message: "Nodes need a label.", line: 3 }]);
    expect(blocks).toHaveLength(1);
  });

  test("fills the block line into warnings that have none", () => {
    const { diagnostics } = render(stubAt(4, { id: "s", warn: "Could not route." }));
    expect(diagnostics).toEqual([{ rule: "route", severity: "warn", message: "Could not route.", line: 4 }]);
  });

  test("renders containers with the split column template", () => {
    const { html } = render({ kind: "container", layout: "split", args: ["2fr", "1fr"], line: 1, children: [md("Left", 2), stubAt(3, { id: "s" })] });
    expect(html).toStartWith('<div class="x-split" style="--cols: 2fr 1fr"><div class="x-prose">');
    expect(html).toEndWith("</section></div>");
  });

  test("inlineMarkdown drops a single wrapping paragraph", () => {
    expect(inlineMarkdown("Hello **you**")).toBe("Hello <strong>you</strong>");
  });
});

describe("registry", () => {
  test("report modules register by type next to the built-in blocks", () => {
    expect(Array.isArray(reportModules)).toBe(true);
    for (const m of reportModules) expect(blockModules[m.type]).toBe(m);
    expect(blockModules.figure).toBeDefined();
  });
});

// ---------- expanded view, prose linking, back-links, security ----------

interface ReadBlock { type: "readstub"; id: string; title?: string; items: { id: string; focal?: boolean }[]; notes?: { on: string[]; text: string }[]; caveat?: string; story?: { sel: string; cmp?: string; note?: string }[]; links?: Record<string, { rel: string; ids: string[]; inverse?: string }[]>; abouts?: Record<string, string>; line: number }

const readStub = {
  type: "readstub",
  normalize: (raw: RawBlock) => ({ type: "readstub", line: raw.line, ...(raw.data as object) }) as ReadBlock,
  render: (b: ReadBlock) => `<figure class="x-figure" data-figure="${b.id}">${b.items.map((i) => `<g class="x-mark" data-id="${i.id}"></g>`).join("")}</figure>`,
  model: (b: ReadBlock) => ({
    elements: Object.fromEntries(b.items.map((i) => [i.id, {
      id: i.id, type: "item", label: i.id.toUpperCase(), figure: b.id,
      ...(b.links?.[i.id] ? { links: b.links[i.id] } : {}),
      ...(b.abouts?.[i.id] ? { about: b.abouts[i.id], aboutHtml: "<b>engine html</b>" } : {}),
    }])),
  }),
  reading: () => "Bar length = signups.",
  table: (b: ReadBlock) => ({ head: ["Item", "Value"], rows: b.items.map((i, n) => [i.id, String(n * 10)]) }),
} as unknown as BlockModule;
registerBlock(readStub);
const readAt = (line: number, data: Record<string, unknown>): Segment => ({ kind: "block", block: { type: "readstub", info: [], body: "", data, line } });

describe("reading panel", () => {
  test("wraps the figure with how-to-read, numbered notes, caveat and the data table", () => {
    const { html } = render(readAt(1, { id: "sig", items: [{ id: "a" }, { id: "b" }], notes: [{ on: ["a"], text: "The **big** one." }, { on: [], text: "Plain." }], caveat: "Last 90 days only." }));
    expect(html).toStartWith('<section class="x-block x-read" data-block="readstub" data-id="sig"><div class="x-read-grid"><div class="x-read-main"><figure');
    expect(html).toContain('<aside class="x-reading" data-for="sig" aria-label="Reading notes">');
    expect(html).toContain('<p class="x-reading-how"><span class="x-reading-k">How to read</span>Bar length = signups.</p>');
    expect(html).toContain('<li class="x-reading-note" data-note="1" data-refs="a"><span class="x-reading-note-num" aria-hidden="true">1</span><span class="x-reading-note-text">The <strong>big</strong> one.</span></li>');
    expect(html).toContain('<li class="x-reading-note" data-note="2"><span');
    expect(html).toContain("What this doesn't show</span>Last 90 days only.");
    expect(html).toContain('<details class="x-data"><summary>Data</summary><table class="x-data-table"><thead><tr><th scope="col">Item</th><th scope="col">Value</th></tr></thead><tbody><tr><th scope="row">a</th><td>0</td></tr>');
    expect(html).toContain('data-action="csv">Copy CSV</button></details></aside></div></section>');
  });

  test("blocks without reading, notes or data stay as they were", () => {
    const { html } = render(stubAt(1, { id: "s", nodes: ["a"] }));
    expect(html).not.toContain("x-read");
  });
});

describe("prose linked to marks", () => {
  test("a sentence with a ref is wrapped with its ids; other sentences are not", () => {
    const { html } = render(stubAt(1, { id: "s", nodes: ["a", "b"] }), md("Intro has 3 parts. Then [A](#a) feeds [B](#b) twice! Last.", 3));
    expect(html).toContain('<p>Intro has 3 parts. <span class="x-sent" data-refs="a b">Then <a class="x-ref" data-ref="a" href="#sel=a">A</a> feeds <a class="x-ref" data-ref="b" href="#sel=b">B</a> twice!</span> Last.</p>');
  });

  test("'#a+b' selects a and compares it with b", () => {
    const { html } = render(stubAt(1, { id: "s", nodes: ["a", "b"] }), md("[A passed B](#a+b) in April.", 3));
    expect(html).toContain('<a class="x-ref" data-ref="a" data-cmp="b" href="#sel=a&amp;cmp=b">A passed B</a>');
    expect(html).toContain('<span class="x-sent" data-refs="a b">');
  });

  test("headings are never wrapped; a '+' link to unknown ids stays a plain link", () => {
    const { html } = render(stubAt(1, { id: "s", nodes: ["a"] }), md("## About [A](#a)\n\nSee [x](#a+zz).", 3));
    expect(html).toContain('<h2 id="about-a">About <a class="x-ref" data-ref="a" href="#sel=a">A</a></h2>');
    expect(html).toContain('<a href="#a+zz">x</a>');
  });
});

describe("model: about, back-links, stories", () => {
  test("about stays text; aboutHtml is built here and replaces whatever the engine sent", () => {
    const { model } = render(readAt(1, { id: "f", items: [{ id: "a" }], abouts: { a: "Uses **tokens** <img src=x onerror=alert(1)> [x](javascript:alert(1))" } }));
    const a = model.elements.a;
    expect(a.about).toStartWith("Uses **tokens**");
    expect(a.aboutHtml).toContain("<strong>tokens</strong>");
    expect(a.aboutHtml).not.toContain("<img");
    expect(a.aboutHtml).not.toContain("javascript:");
    expect(a.aboutHtml).not.toContain("engine html");
  });

  test("inverse links write the reverse relation and the source's other targets as context", () => {
    const { model } = render(readAt(1, {
      id: "r", items: [{ id: "card" }, { id: "event" }, { id: "metric" }],
      links: { card: [{ rel: "Causes", ids: ["event"], inverse: "Explained by" }, { rel: "Moves", ids: ["metric"], inverse: "Changed by" }] },
    }));
    expect(model.elements.event.links).toEqual([{ rel: "Explained by", ids: ["card"] }]);
    expect(model.elements.event.context).toEqual(["card", "metric"]);
    expect(model.elements.metric.links).toEqual([{ rel: "Changed by", ids: ["card"] }]);
    expect(model.elements.card.links).toHaveLength(2);
  });

  test("a block's story becomes a scene the steps bar and the client can play", () => {
    const { model } = render(readAt(1, { id: "sig", title: "Signups", items: [{ id: "a" }, { id: "b" }], story: [{ sel: "a", note: "Start." }, { sel: "b", cmp: "a" }] }));
    expect(model.scenes["sig-story"]).toMatchObject({ id: "sig-story", title: "Signups", figure: "sig", path: ["a", "b"], story: [{ sel: "a", note: "Start." }, { sel: "b", cmp: "a" }] });
  });
});

describe("lint: expanded view", () => {
  const lintDoc = (...segments: Segment[]) => {
    const doc = { front: {}, segments };
    const { blocks, model } = renderDoc(doc, theme);
    return lint(doc, blocks, theme, Object.keys(model.elements));
  };
  const rules = (d: { rule: string }[]) => d.map((x) => x.rule);

  test("note-target: notes and story steps must point at existing ids", () => {
    const d = lintDoc(readAt(1, { id: "f", items: [{ id: "a" }], notes: [{ on: ["zz"], text: "Hm." }], story: [{ sel: "a", cmp: "yy" }] }));
    expect(d.filter((x) => x.rule === "note-target").map((x) => x.severity)).toEqual(["error", "error"]);
  });

  test("ref-focal: a focal nobody links to is a warning; a link or a note clears it", () => {
    const focal = { id: "f", items: [{ id: "a", focal: true }, { id: "b" }] };
    expect(rules(lintDoc(readAt(1, focal)))).toContain("ref-focal");
    expect(rules(lintDoc(md("See [the point](#a).", 1), readAt(3, focal)))).not.toContain("ref-focal");
    expect(rules(lintDoc(readAt(1, { ...focal, notes: [{ on: ["a"], text: "This one." }] })))).not.toContain("ref-focal");
  });

  test("claim-unlinked: a number next to a figure without a link", () => {
    const d = lintDoc(md("Organic search brought 4,120 signups. See [B](#b) for 930 more.", 1), readAt(3, { id: "f", items: [{ id: "a" }, { id: "b" }] }));
    const claims = d.filter((x) => x.rule === "claim-unlinked");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ severity: "warn", line: 1 });
    expect(claims[0].message).toContain("4,120");
    expect(rules(lintDoc(md("Far away prose with 12 things.", 1)))).not.toContain("claim-unlinked");
  });

  test("'#a+b' links resolve when both ids exist", () => {
    const d = lintDoc(md("[A vs B](#a+b) and [A vs Z](#a+zz).", 1), readAt(3, { id: "f", items: [{ id: "a" }, { id: "b" }] }));
    const refs = d.filter((x) => x.rule === "ref-exists");
    expect(refs).toHaveLength(1);
    expect(refs[0].message).toContain('"zz"');
  });
});

describe("whole page", () => {
  const page = (source: string) => buildHtml(source, "doc.md");

  test("raw HTML and script links in any Markdown text never reach the page as markup", async () => {
    const { html } = await page(lines(
      "---", "title: Safe", 'summary: "Hi <img src=x onerror=alert(1)>"', "---", "",
      "Text <script>alert(1)</script> and [a link](javascript:alert(2)).", "",
      "```note warn", "Careful <iframe src=x></iframe>", "```", "",
      "```figure", "id: f", "layout: flow", "nodes:",
      '  a: { label: A, at: [0, 0], about: "Runs <img src=x onerror=alert(3)> first." }', "```",
    ));
    const body = html.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<script type="application\/json"[\s\S]*?<\/script>/, "");
    expect(body).not.toMatch(/<(img|iframe|script)\b/i);
    expect(body).not.toContain("javascript:");
    const model = JSON.parse(/<script type="application\/json" id="x-model">([\s\S]*?)<\/script>/.exec(html)![1]);
    expect(model.elements.a.aboutHtml).not.toMatch(/<img/i);
  });

  test("front-matter mode and view hold without JavaScript", async () => {
    const { html } = await page(lines("---", "mode: dark", "view: bare", "---", "", "Hello."));
    expect(html).toMatch(/<html [^>]*data-view="bare"/);
    expect(html).toMatch(/<html [^>]*data-theme="dark"/);
    const auto = (await page("Hello.")).html;
    expect(auto).toMatch(/<html [^>]*data-view="full"/);
    expect(auto).not.toMatch(/<html [^>]*data-theme="/);
  });

  test("figures get no floating body-level panel; the card lives in the figure", async () => {
    const { html } = await page(lines("```figure", "id: f", "layout: flow", "nodes:", "  a: { label: A, at: [0, 0], about: Does a thing. }", "```"));
    expect(html).not.toContain('<aside class="x-detail" data-detail hidden');
  });
});
