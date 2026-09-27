import { describe, expect, test } from "bun:test";
import { loadTheme } from "../engine/theme.ts";
import { SpecError, type Diagnostic, type RawBlock, type RenderContext } from "../engine/types.ts";
import { contextModule as context } from "../engine/blocks/context.ts";
import { buildHtml } from "../engine/page.ts";
import { collect } from "../commands/check.ts";

const theme = await loadTheme();
const ctxOf = (warnings: Diagnostic[]): RenderContext => ({ theme, doc: { front: {}, segments: [] }, inline: (s: string) => s, warn: (d) => { warnings.push(d); } });
const raw = (data: unknown): RawBlock => ({ type: "context", info: [], body: "", data, line: 3 });

const items = [
  { id: "sys", role: "system", text: "Instructions and tools", tokens: 900 },
  { id: "ask", role: "user", text: "Where is my order?", tokens: 10 },
  { call: "c1", message: "m2", reply: "find_order()" },
  { id: "req", role: "assistant", text: "find_order()", tokens: 15 },
  { id: "res", role: "tool", text: "Shipped Tuesday", tokens: 8 },
  { call: "c2", message: "m6", reply: "It shipped on Tuesday.", final: true },
];

function run(data: unknown) {
  const warnings: Diagnostic[] = [];
  const ctx = ctxOf(warnings);
  const block = context.normalize(raw(data), ctx);
  return { block, html: context.render(block, ctx), model: context.model!(block), warnings };
}

function specError(fn: () => unknown): SpecError {
  try { fn(); } catch (e) { if (e instanceof SpecError) return e; throw e; }
  throw new Error("expected a SpecError");
}

describe("context block", () => {
  test("a call sends every message above it; labels default to Call N", () => {
    const { block } = run({ id: "ctx", items });
    expect(block.calls.map((c) => [c.id, c.label, c.sends, c.final])).toEqual([["c1", "Call 1", 2, false], ["c2", "Call 2", 4, true]]);
    expect(block.messages.map((m) => [m.id, m.first])).toEqual([["sys", 0], ["ask", 0], ["req", 1], ["res", 1]]);
  });

  test("rejects bad shapes: unknown role, a call before any message, trailing messages, repeated ids", () => {
    const warnings: Diagnostic[] = [];
    const n = (data: unknown) => () => context.normalize(raw(data), ctxOf(warnings));
    expect(specError(n({ id: "x", items: [{ id: "a", role: "robot", text: "hi" }, { call: "c", reply: "ok" }] })).message).toContain('role "robot"');
    expect(specError(n({ id: "x", items: [{ call: "c", reply: "ok" }] })).message).toContain("sends nothing");
    expect(specError(n({ id: "x", items: [{ id: "a", role: "user", text: "hi" }, { call: "c", reply: "ok" }, { id: "b", role: "tool", text: "x" }] })).message).toContain("must end with a call");
    const dup = specError(n({ id: "x", items: [{ id: "a", role: "user", text: "hi" }, { call: "a", reply: "ok" }] }));
    expect(dup.rule).toBe("id-unique");
  });

  test("warns on a final that is not last, partial tokens, and a call that adds nothing", () => {
    const { warnings } = run({ id: "ctx", items: [
      { id: "a", role: "user", text: "hi", tokens: 3 },
      { call: "c1", reply: "x", final: true },
      { id: "b", role: "tool", text: "y" },
      { call: "c2", reply: "z" },
      { call: "c3", reply: "w" },
    ] });
    const text = warnings.map((w) => w.message).join("\n");
    expect(text).toContain("only the last call");
    expect(text).toContain("`tokens` on every message");
    expect(text).toContain("sends the same messages");
  });

  test("draws a staircase: new chips once, carried copies after, replies in the next row", () => {
    const { html } = run({ id: "ctx", items });
    // sys and ask are new in call 1 and carried in call 2; req and res are new in call 2
    expect(html.match(/x-context-msg is-new" data-id="sys"/g)!.length).toBe(1);
    expect(html.match(/x-context-msg is-carried" data-id="sys"/g)!.length).toBe(1);
    expect(html.match(/data-id="req"/g)!.length).toBe(1);
    // only the first copy is focusable
    expect(html).toMatch(/data-id="sys"[^>]*tabindex="0"/);
    expect(html).toMatch(/is-carried" data-id="sys" aria-hidden="true"/);
    // call 1's reply sits in row 2, the row where call 2's first new message is drawn
    const y = (re: RegExp) => Number(re.exec(html)![1]);
    const reply1 = y(/data-id="c1"[\s\S]*?x-context-reply" x="[\d.]+" y="([\d.]+)"/);
    const req = y(/data-id="req"[\s\S]*?x-context-chip" x="[\d.]+" y="([\d.]+)"/);
    expect(reply1).toBe(req);
    expect(html).toContain('class="x-context-reply is-final"');
    expect(html).toContain(">Answer<");
    expect(html).toContain(">Tool call<");
  });

  test("footers count messages and, with tokens on every message, tokens sent", () => {
    const { html } = run({ id: "ctx", items });
    expect(html).toContain(">2 messages · 910 tokens<");
    expect(html).toContain(">4 messages · 933 tokens<");
    const bare = run({ id: "ctx", items: items.map(({ tokens: _t, ...rest }: Record<string, unknown>) => rest) });
    expect(bare.html).toContain(">2 messages<");
  });

  test("the figure stays 960px wide so the card docks beside it", () => {
    const { html } = run({ id: "ctx", items });
    expect(html).toMatch(/viewBox="0 0 960 /);
  });

  test("note markers use the kit markup: in a message's first chip, in a call's head", () => {
    const { html } = run({ id: "ctx", items, notes: [{ on: "res", text: "a result" }, { on: "c2", text: "the end" }] });
    expect(html).toContain('<g class="x-notes" data-for="ctx" aria-hidden="true">');
    expect(html).toContain('data-note="1" data-for="res"');
    expect(html).toContain('data-note="2" data-for="c2"');
  });

  test("model: message facts, call facts, links to the sequence message and between calls", () => {
    const { model } = run({ id: "ctx", items });
    const res = model.elements!.res;
    expect(res.pos).toBe("4 of 4 · Tool");
    expect(res.facts!.map((f) => [f.k, f.v])).toEqual([["First sent in", "Call 2"], ["Sent in", "1 of 2 calls"], ["Tokens", "8"]]);
    const c2 = model.elements!.c2;
    expect(c2.related).toEqual(["sys", "ask", "req", "res"]);
    expect(c2.facts!.map((f) => [f.k, f.v])).toEqual([["Messages sent", "4"], ["New since Call 1", "2"], ["Reply", "Answer, the loop ends"], ["Tokens sent", "933"]]);
    expect(c2.links).toContainEqual({ rel: "Sent as", ids: ["m6"], inverse: "Sends context" });
    expect(c2.links).toContainEqual({ rel: "‹ Previous call", ids: ["c1"] });
  });

  test("table: one column per call with new/sent, plus the replies", () => {
    const { block } = run({ id: "ctx", items });
    const t = context.table!(block);
    expect(t.head).toEqual(["Message", "Role", "Call 1", "Call 2", "Tokens"]);
    expect(t.rows[0]).toEqual(["Instructions and tools", "System", "new", "sent", "900"]);
    expect(t.rows[2]).toEqual(["find_order()", "Assistant", "", "new", "15"]);
    expect(t.rows[4]).toEqual(["Reply", "", "find_order()", "It shipped on Tuesday. (answer)", ""]);
  });
});

describe("context block in a document", () => {
  const doc = (message: string) => [
    "---", "title: t", "---", "",
    "```figure", "id: seq", "layout: sequence",
    "actors:", "  user: { label: User, about: \"asks\" }", "  code: { label: Code, about: \"runs\" }", "  model: { label: Model, about: \"replies\" }",
    "messages:", "  - user -> code: asks", "  - code -> model: sends call 1", "  - model --> code: answers",
    "```", "",
    "```context", "id: ctx", "for: seq", "items:",
    "  - { id: ask, role: user, text: Hello }",
    `  - { call: c1, message: ${message}, reply: Hi, final: true }`,
    "```", "",
  ].join("\n");

  test("a call's message links to the sequence and back", async () => {
    const out = await buildHtml(doc("m2"), "t.md");
    expect(out.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(out.html).toContain('"Sends context"');
  });

  test("a call pointing at a missing message is an error", async () => {
    const found = await collect(doc("m9"), "t.md");
    expect(found.map((d) => d.message).join("\n")).toContain('points at message "m9"');
  });
});
