import { describe, expect, test } from "bun:test";
import { textWidth } from "../engine/kit.ts";
import { loadTheme } from "../engine/theme.ts";
import { SpecError, type BlockModule, type Diagnostic, type ElementInfo, type RawBlock, type RenderContext } from "../engine/types.ts";
import { blockModule as funnel } from "../engine/charts/funnel.ts";
import { blockModule as pyramid } from "../engine/charts/pyramid.ts";
import { blockModule as sankey } from "../engine/charts/sankey.ts";

const theme = await loadTheme();
const LINE = 3;

type AnyModule = BlockModule<any>;

function ctx(warns: Diagnostic[] = []): RenderContext {
  return { theme, doc: { front: {}, segments: [] }, inline: (s: string) => s, warn: (d) => { warns.push(d); } };
}

function raw(type: string, data: unknown): RawBlock {
  return { type, info: [], body: "", data, line: LINE };
}

function unesc(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function build(mod: AnyModule, data: unknown, warns: Diagnostic[] = []) {
  const block = mod.normalize(raw(mod.type, data), ctx(warns));
  const html = mod.render(block, ctx(warns));
  const elements: Record<string, ElementInfo> = mod.model?.(block).elements ?? {};
  return { block, html, elements };
}

interface Mark { id: string; cls: string; attrs: string; inner: string }

function marks(html: string): Mark[] {
  const out: Mark[] = [];
  for (const m of html.matchAll(/<(g|div) class="([^"]*)"([^>]*)>/g)) {
    const [whole, tag = "", cls = "", attrs = ""] = m;
    if (!cls.split(" ").includes("x-mark")) continue;
    const rest = html.slice((m.index ?? 0) + whole.length);
    out.push({ id: unesc(/data-id="([^"]*)"/.exec(attrs)?.[1] ?? ""), cls, attrs, inner: rest.slice(0, rest.indexOf(`</${tag}>`)) });
  }
  return out;
}

function attrOf(attrs: string, name: string): string {
  return unesc(new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? "");
}

function specError(fn: () => unknown): SpecError {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(SpecError);
  const e = caught as SpecError;
  expect(e.line).toBe(LINE);
  return e;
}

const FUNNEL = {
  id: "trial",
  format: "int",
  data: [
    { label: "Started trial", value: 1000, about: "Everyone who signed up." },
    { label: "Verified", value: 900 },
    { label: "Connected", value: 300 },
    { label: "Paid", value: 150 },
  ],
};

const PYRAMID = {
  id: "tests",
  data: [
    { label: "End-to-end", value: 40, about: "Slow browser runs." },
    { label: "Integration", value: 350 },
    { label: "Unit", value: 2400, focal: true },
  ],
};

const SANKEY = {
  id: "tickets",
  links: [
    "Email -> Agent: 300",
    "Chat -> Bot: 500",
    "Chat -> Agent: 100",
    "Bot -> Solved: 400",
    "Bot -> Reopened: 100",
    "Agent -> Solved: 380",
    "Agent -> Reopened: 20",
  ],
};

const CASES: [string, AnyModule, Record<string, unknown>][] = [
  ["funnel", funnel, FUNNEL],
  ["pyramid", pyramid, PYRAMID],
  ["sankey", sankey, SANKEY],
];

for (const [name, mod, data] of CASES) {
  describe(`${name} contract`, () => {
    test("type matches the fence", () => {
      expect(mod.type).toBe(name);
    });

    test("every mark has a unique, block-prefixed id and a painted shape", () => {
      const ms = marks(build(mod, data).html);
      expect(ms.length).toBeGreaterThan(0);
      const ids = ms.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const m of ms) {
        expect(m.id.startsWith(`${data.id}-`)).toBe(true);
        expect(m.inner).toContain("x-mark-shape");
      }
    });

    test("every mark has a model entry", () => {
      const { html, elements } = build(mod, data);
      for (const m of marks(html)) {
        expect(elements[m.id]).toBeDefined();
        expect(elements[m.id].figure).toBe(data.id as string);
      }
    });

    test("two blocks with the same labels get disjoint ids", () => {
      const a = marks(build(mod, data).html).map((m) => m.id);
      const b = marks(build(mod, { ...data, id: "other" }).html).map((m) => m.id);
      expect(a.filter((x) => b.includes(x))).toEqual([]);
    });

    test("output is deterministic", () => {
      const one = build(mod, data), two = build(mod, data);
      expect(one.html).toBe(two.html);
      expect(JSON.stringify(one.elements)).toBe(JSON.stringify(two.elements));
    });

    test("no colors and no inline styles", () => {
      const { html } = build(mod, data);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/rgba?\(/);
      expect(html).not.toContain("style=");
    });

    test("accessible svg figure", () => {
      const { html } = build(mod, data);
      expect(html).toContain(`data-layout="${name}"`);
      expect(html).toContain('role="group"');
      expect(html).toContain(`aria-describedby="${data.id}-desc"`);
      // no root <title>: browsers show it as a tooltip wherever the pointer rests
      expect(html).not.toContain(`<title id="${data.id}-title">`);
    });

    test("an unknown key is a SpecError at the fence line", () => {
      const e = specError(() => mod.normalize(raw(name, { ...data, colour: "red" }), ctx()));
      expect(e.message).toContain("title");
    });
  });
}

describe("funnel", () => {
  test("normalizes stages in order with prefixed ids", () => {
    const b = funnel.normalize(raw("funnel", FUNNEL), ctx()) as any;
    expect(b.stages.map((s: any) => s.id)).toEqual(["trial-started-trial", "trial-verified", "trial-connected", "trial-paid"]);
    expect(b.stages.map((s: any) => s.value)).toEqual([1000, 900, 300, 150]);
    expect(b.format).toBe("int");
  });

  test("map shorthand label: value", () => {
    const b = funnel.normalize(raw("funnel", { id: "f", data: { Visits: 100, Signups: "40" } }), ctx()) as any;
    expect(b.stages.map((s: any) => [s.label, s.value])).toEqual([["Visits", 100], ["Signups", 40]]);
  });

  test("the biggest relative drop is focal when none is given", () => {
    const focal = marks(build(funnel, FUNNEL).html).filter((m) => m.attrs.includes('data-focal="true"')).map((m) => m.id);
    expect(focal).toEqual(["trial-connected"]);
  });

  test("an explicit focal turns the automatic one off", () => {
    const data = { ...FUNNEL, data: FUNNEL.data.map((d) => (d.label === "Paid" ? { ...d, focal: true } : d)) };
    const focal = marks(build(funnel, data).html).filter((m) => m.attrs.includes('data-focal="true"')).map((m) => m.id);
    expect(focal).toEqual(["trial-paid"]);
  });

  test("step conversion labels and model values", () => {
    const { html, elements } = build(funnel, FUNNEL);
    for (const r of ["→ 90%", "→ 33%", "→ 50%", "Conversion"]) expect(html).toContain(r);
    expect(elements["trial-connected"].value).toBe("300");
    expect(elements["trial-started-trial"].about).toBe("Everyone who signed up.");
  });

  test("stage facts: step conversion with the loss, share of the top, share of all drop-off", () => {
    const { elements } = build(funnel, FUNNEL);
    const facts = elements["trial-connected"].facts ?? [];
    expect(facts.map((f) => f.v)).toEqual(["71% of all drop-off", "33% of Verified (−600)", "30% of Started trial", "1st of 3 steps"]);
    expect(elements["trial-verified"].facts?.map((f) => f.k)).toEqual(["Drop-off share", "Step conversion", "Drop rank"]);
    expect(elements["trial-started-trial"].facts?.[0]).toMatchObject({ k: "Reach the end", v: "15% (150)", ref: "trial-paid" });
    expect(elements["trial-started-trial"].facts?.[1]?.ref).toBe("trial-connected");
    expect(elements["trial-connected"].pos).toBe("3 of 4");
    expect(elements["trial-connected"].say).toBe("Connected, 300, 33% of Verified, 71% of all drop-off");
  });

  test("the previous and the first stage are related, so both denominators stay lit", () => {
    const { elements } = build(funnel, FUNNEL);
    expect(elements["trial-connected"].related).toEqual(["trial-verified", "trial-started-trial"]);
    expect(elements["trial-verified"].related).toEqual(["trial-started-trial"]);
    expect(elements["trial-started-trial"].related).toBeUndefined();
  });

  test("a selected stage shows a bracket from the first stage with the share of the top", () => {
    const ms = marks(build(funnel, FUNNEL).html);
    const connected = ms.find((m) => m.id === "trial-connected")!;
    expect(connected.inner).toContain('<g class="x-on-sel"><path class="x-funnel-bracket"');
    expect(connected.inner).toContain(">30% from top</text>");
    expect(ms.find((m) => m.id === "trial-verified")!.inner).not.toContain("x-on-sel");
  });

  test("the value on the bar takes the ink for its fill", () => {
    const ms = marks(build(funnel, FUNNEL).html);
    expect(attrOf(ms.find((m) => m.id === "trial-connected")!.attrs, "data-ink")).toBe("ss"); // accent
    expect(attrOf(ms.find((m) => m.id === "trial-started-trial")!.attrs, "data-ink")).toBe("ss"); // series 1
  });

  test("focal: false on the block turns the automatic focal off", () => {
    const { html } = build(funnel, { ...FUNNEL, focal: false });
    expect(html).not.toContain('data-focal="true"');
  });

  test("a stage larger than the one above warns", () => {
    const warns: Diagnostic[] = [];
    funnel.normalize(raw("funnel", { id: "f", data: { Visits: 100, Signups: 120 } }), ctx(warns));
    expect(warns.find((d) => d.message.includes('"Signups" (120) is larger than "Visits" (100)'))?.severity).toBe("warn");
  });

  test("explicit ids are kept; duplicates are rejected", () => {
    const data = { id: "f", data: [{ id: "top", label: "A", value: 10 }, { label: "B", value: 5 }] };
    expect(marks(build(funnel, data).html).map((m) => m.id)).toEqual(["top", "f-b"]);
    const dup = { id: "f", data: [{ id: "x", label: "A", value: 10 }, { id: "x", label: "B", value: 5 }] };
    expect(specError(() => funnel.normalize(raw("funnel", dup), ctx())).rule).toBe("id-unique");
  });

  test("bad input is a SpecError", () => {
    const two = (v: unknown) => ({ id: "f", data: [{ label: "A", value: v }, { label: "B", value: 1 }] });
    specError(() => funnel.normalize(raw("funnel", two("many")), ctx()));
    specError(() => funnel.normalize(raw("funnel", two(-4)), ctx()));
    specError(() => funnel.normalize(raw("funnel", { id: "f", data: [{ label: "A", value: 1 }] }), ctx()));
    specError(() => funnel.normalize(raw("funnel", { id: "f" }), ctx()));
    specError(() => funnel.normalize(raw("funnel", { id: "f", data: [{ label: "A", value: 1, colour: "x" }, { label: "B", value: 1 }] }), ctx()));
    specError(() => funnel.normalize(raw("funnel", { ...FUNNEL, format: "percent" }), ctx()));
  });

  test("over 7 stages warns with a split point", () => {
    const warns: Diagnostic[] = [];
    const data = Array.from({ length: 8 }, (_, i) => ({ label: `Step ${i + 1}`, value: 100 - i * 10 }));
    funnel.normalize(raw("funnel", { id: "f", data }), ctx(warns));
    const w = warns.find((d) => d.rule === "budget-nodes");
    expect(w?.message).toContain("1–4 and 4–8");
    expect(w?.line).toBe(LINE);
  });

  test("labels are escaped", () => {
    const { html } = build(funnel, { id: "f", data: [{ label: "<script>alert(1)</script>", value: 10 }, { label: "B", value: 5 }] });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("pyramid", () => {
  test("normalizes levels top to bottom", () => {
    const b = pyramid.normalize(raw("pyramid", PYRAMID), ctx()) as any;
    expect(b.levels.map((l: any) => l.id)).toEqual(["tests-end-to-end", "tests-integration", "tests-unit"]);
    expect(b.levels[2].focal).toBe(true);
  });

  test("map shorthand: number is value, text is about", () => {
    const b = pyramid.normalize(raw("pyramid", { id: "p", data: { Vision: "Why we exist.", Goals: 3, Tasks: null } }), ctx()) as any;
    expect(b.levels[0].about).toBe("Why we exist.");
    expect(b.levels[1].value).toBe(3);
    expect(b.levels[2].value).toBeUndefined();
  });

  test("rank ramp falls and width grows toward the base", () => {
    const { html } = build(pyramid, PYRAMID);
    const levels = marks(html).map((m) => Number(attrOf(m.attrs, "data-level")));
    expect(levels[0]).toBe(6);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeLessThan(levels[i - 1]);
    const widths = [...html.matchAll(/<polygon class="x-mark-shape" points="([^"]+)"/g)].map((m) => {
      const [a, b] = (m[1] ?? "").split(" ").map((p) => Number(p.split(",")[0]));
      return b - a;
    });
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
  });

  test("values sit beside their level and reach the model", () => {
    const { html, elements } = build(pyramid, PYRAMID);
    expect(html).toContain(">2,400<");
    expect(elements["tests-unit"].value).toBe("2,400");
    expect(elements["tests-unit"].pos).toBe("3 of 3");
  });

  test("level facts: share of all, ratios to its neighbours, the far end on the focal level", () => {
    const { elements } = build(pyramid, PYRAMID);
    const mid = elements["tests-integration"];
    expect(mid.related).toEqual(["tests-end-to-end", "tests-unit"]);
    expect(mid.facts?.[0]?.v).toBe("13% of all");
    expect(mid.facts?.[1]).toMatchObject({ k: "Level above", ref: "tests-end-to-end" });
    expect(mid.facts?.[1]?.v).toMatch(/× End-to-end$/);
    expect(mid.facts?.[2]).toMatchObject({ k: "Level below", v: "Unit is 6.9×", ref: "tests-unit" });
    expect(elements["tests-unit"].facts?.find((f) => f.k === "vs the top")).toMatchObject({ v: "60× the top", ref: "tests-end-to-end" });
    expect(elements["tests-end-to-end"].related).toEqual(["tests-integration"]);
  });

  test("labels inside a level take the ink for its ramp step (level 4 stays dark text in light mode)", () => {
    const ms = marks(build(pyramid, PYRAMID).html);
    const mid = ms.find((m) => m.id === "tests-integration")!;
    expect(attrOf(mid.attrs, "data-level")).toBe("4");
    expect(attrOf(mid.attrs, "data-ink")[0]).toBe("t");
    expect(attrOf(ms.find((m) => m.id === "tests-unit")!.attrs, "data-ink")).toBe("ss");
    expect(mid.inner).toContain('class="x-mark-label x-on-fill"');
  });

  test("bad input is a SpecError", () => {
    specError(() => pyramid.normalize(raw("pyramid", { id: "p", data: [{ label: "A", value: "lots" }, { label: "B" }] }), ctx()));
    specError(() => pyramid.normalize(raw("pyramid", { id: "p", data: [{ about: "no label" }, { label: "B" }] }), ctx()));
    specError(() => pyramid.normalize(raw("pyramid", { id: "p", data: [{ label: "A" }] }), ctx()));
  });

  test("over 6 levels warns", () => {
    const warns: Diagnostic[] = [];
    const data = Array.from({ length: 7 }, (_, i) => ({ label: `Level ${i + 1}` }));
    pyramid.normalize(raw("pyramid", { id: "p", data }), ctx(warns));
    expect(warns.some((d) => d.rule === "budget-nodes")).toBe(true);
  });

  test("labels are escaped", () => {
    const { html } = build(pyramid, { id: "p", data: [{ label: "<script>alert(1)</script>" }, { label: "Base" }] });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("sankey", () => {
  const rectOf = (html: string, id: string) => {
    const m = new RegExp(`data-id="${id}"[^>]*><rect class="x-mark-shape" x="([-\\d.]+)" y="([-\\d.]+)"`).exec(html);
    return { x: Number(m?.[1]), y: Number(m?.[2]) };
  };

  test("shorthand links infer prefixed nodes", () => {
    const b = sankey.normalize(raw("sankey", SANKEY), ctx()) as any;
    expect(b.nodes.map((n: any) => n.id)).toEqual(["tickets-email", "tickets-agent", "tickets-chat", "tickets-bot", "tickets-solved", "tickets-reopened"]);
    expect(b.links[0]).toMatchObject({ id: "tickets-email->tickets-agent", from: "tickets-email", to: "tickets-agent", value: 300 });
  });

  test("unquoted shorthand (a one-key YAML map) works too", () => {
    const b = sankey.normalize(raw("sankey", { id: "s", links: [{ "A -> B": "1,200" }] }), ctx()) as any;
    expect(b.links[0].value).toBe(1200);
  });

  test("declared nodes keep their ids and resolve by id or label", () => {
    const data = { id: "s", nodes: { a: "Alpha", b: { label: "Beta", about: "Second." } }, links: ["a -> Beta: 3"] };
    const { elements } = build(sankey, data);
    expect(elements.a.type).toBe("node");
    expect(elements.b.about).toBe("Second.");
    expect(elements["a->b"]).toMatchObject({ type: "edge", from: "a", to: "b" });
  });

  test("unknown refs, loops, self links and empty links are SpecErrors", () => {
    const e = specError(() => sankey.normalize(raw("sankey", { id: "s", nodes: { a: "A", b: "B" }, links: ["a -> zz: 3"] }), ctx()));
    expect(e.rule).toBe("ref-exists");
    specError(() => sankey.normalize(raw("sankey", { id: "s", links: ["A -> B: 1", "B -> C: 1", "C -> A: 1"] }), ctx()));
    specError(() => sankey.normalize(raw("sankey", { id: "s", links: ["A -> A: 1"] }), ctx()));
    specError(() => sankey.normalize(raw("sankey", { id: "s", links: ["A -> B: 0"] }), ctx()));
    specError(() => sankey.normalize(raw("sankey", { id: "s", links: ["A -> B: many"] }), ctx()));
    specError(() => sankey.normalize(raw("sankey", { id: "s", links: ["A to B"] }), ctx()));
    specError(() => sankey.normalize(raw("sankey", { id: "s", links: ["A -> B: 1", "A -> B: 2"] }), ctx()));
    specError(() => sankey.normalize(raw("sankey", { id: "s", links: [] }), ctx()));
  });

  test("columns follow the longest path and sinks sit in the last column", () => {
    const { html } = build(sankey, { ...SANKEY, links: [...SANKEY.links, "Chat -> Spam: 10"] });
    const x = (n: string) => rectOf(html, `tickets-${n}`).x;
    expect(x("email")).toBe(x("chat"));
    expect(x("bot")).toBeGreaterThan(x("chat"));
    expect(x("solved")).toBeGreaterThan(x("bot"));
    expect(x("spam")).toBe(x("solved"));
  });

  test("barycenter ordering removes a crossing", () => {
    const data = { id: "s", nodes: { a: "A", b: "B", x: "X", y: "Y" }, links: ["a -> y: 10", "b -> x: 10"] };
    const { html } = build(sankey, data);
    expect(rectOf(html, "y").y).toBeLessThan(rectOf(html, "x").y);
  });

  test("links are edges between node marks and carry the source color", () => {
    const { html, elements } = build(sankey, SANKEY);
    const flows = marks(html).filter((m) => m.cls.split(" ").includes("x-edge"));
    expect(flows.length).toBe(SANKEY.links.length);
    for (const f of flows) {
      expect(attrOf(f.attrs, "data-kind")).toBe("flow");
      expect(f.inner).toContain('class="x-edge-hit"');
      const info = elements[f.id];
      expect(info.type).toBe("edge");
      expect(elements[attrOf(f.attrs, "data-from")].type).toBe("node");
      expect(elements[attrOf(f.attrs, "data-to")].type).toBe("node");
    }
    const chatBot = flows.find((f) => f.id === "tickets-chat->tickets-bot")!;
    expect(attrOf(chatBot.attrs, "data-series")).toBe("2");
    const agentSolved = flows.find((f) => f.id === "tickets-agent->tickets-solved")!;
    expect(agentSolved.attrs).toContain('data-mix="true"');
    expect(elements["tickets-bot->tickets-reopened"].value).toBe("100 · 20% of Bot");
    expect(elements["tickets-agent"].facts?.[0]?.v).toBe("in 400 · out 400");
  });

  test("selecting chat traces it end to end: adjacent bands related, reachable bands context", () => {
    const { elements } = build(sankey, SANKEY);
    const chat = elements["tickets-chat"];
    expect(new Set(chat.context)).toEqual(new Set([
      "tickets-solved", "tickets-reopened",
      "tickets-bot->tickets-solved", "tickets-bot->tickets-reopened", "tickets-agent->tickets-solved", "tickets-agent->tickets-reopened",
    ]));
    // adjacent ids come from the edges (client related()), never from context; unrelated email stays out
    for (const id of ["tickets-bot", "tickets-chat->tickets-bot", "tickets-email", "tickets-email->tickets-agent"]) expect(chat.context).not.toContain(id);
    expect(chat.links).toEqual([{ rel: "Flows to", ids: ["tickets-bot", "tickets-agent"] }]);
  });

  test("node facts: flow, where it ends up (≈ past one hop), share of all", () => {
    const { elements } = build(sankey, SANKEY);
    const chat = elements["tickets-chat"].facts ?? [];
    expect(chat[0]).toMatchObject({ k: "Flow", v: "out 600" });
    expect(chat[1]).toMatchObject({ k: "Reaches Solved", v: "≈ 500 (83%)", ref: "tickets-solved" });
    expect(chat[2]).toMatchObject({ k: "Reaches Reopened", ref: "tickets-reopened" });
    expect(chat[2]?.v.startsWith("≈ ")).toBe(true);
    expect(chat[3]).toEqual({ k: "≈", v: "proportional estimate" });
    // one hop is exact
    const bot = elements["tickets-bot"].facts ?? [];
    expect(bot.find((f) => f.k === "Reaches Solved")?.v).toBe("400 (80%)");
    expect(bot.find((f) => f.k === "From Chat")?.v).toBe("500 (100%)");
    expect(bot.some((f) => f.k === "≈")).toBe(false);
  });

  test("link facts: value, share of both ends; upstream of from and downstream of to are context", () => {
    const { elements } = build(sankey, SANKEY);
    const link = elements["tickets-bot->tickets-reopened"];
    expect(link.label).toBe("Bot → Reopened");
    expect(link.facts?.[0]).toMatchObject({ k: "Share of Reopened", v: "83% of 120 in" });
    expect(link.facts?.[1]).toMatchObject({ k: "Share of Bot", v: "20% of 500 out" });
    expect(new Set(link.context)).toEqual(new Set(["tickets-chat", "tickets-chat->tickets-bot"]));
    expect(link.links).toEqual([{ rel: "From", ids: ["tickets-bot"] }, { rel: "To", ids: ["tickets-reopened"] }]);
  });

  test("virtual path ids select every band between a source and a sink", () => {
    const { elements } = build(sankey, SANKEY);
    const path = elements["tickets-path-chat-solved"];
    expect(path.type).toBe("group");
    expect(path.members).toEqual(expect.arrayContaining(["tickets-chat->tickets-bot", "tickets-bot->tickets-solved", "tickets-agent->tickets-solved"]));
    expect(path.members).not.toContain("tickets-email->tickets-agent");
    expect(path.value).toBe("≈ 500");
    expect(elements["tickets-path-email-solved"]).toBeDefined();
    expect(elements["tickets-path-chat-email"]).toBeUndefined();
    // declared node ids are used as they are
    expect(build(sankey, { id: "s", nodes: { a: "A", b: "B" }, links: ["a -> b: 3"] }).elements["s-path-a-b"]?.value).toBe("3");
  });

  test("labels sit in the gutters and above middle nodes, never on the bands", () => {
    const { html } = build(sankey, SANKEY);
    const node = (id: string) => {
      const m = new RegExp(`data-id="${id}"[^>]*><rect class="x-mark-shape" x="([-\\d.]+)" y="([-\\d.]+)" width="([-\\d.]+)" height="([-\\d.]+)"/><text class="x-mark-label x-sankey-label" x="([-\\d.]+)" y="([-\\d.]+)"( text-anchor="(\\w+)")?`).exec(html)!;
      return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), lx: Number(m[5]), ly: Number(m[6]), anchor: m[8] ?? "start" };
    };
    const email = node("tickets-email");
    expect(email.anchor).toBe("end");
    expect(email.lx).toBeLessThan(email.x);
    const solved = node("tickets-solved");
    expect(solved.anchor).toBe("start");
    expect(solved.lx).toBeGreaterThan(solved.x + solved.w);
    const bot = node("tickets-bot");
    expect(bot.anchor).toBe("middle");
    expect(bot.ly).toBeLessThan(bot.y);
    // no band starts left of the first column or ends right of the last
    const bands = [...html.matchAll(/class="x-sankey-link x-mark-shape" d="M([-\d.]+),[^C]*C[^ ]* [^ ]* ([-\d.]+),/g)];
    expect(bands.length).toBe(SANKEY.links.length);
    for (const d of bands) {
      expect(Number(d[1])).toBeGreaterThanOrEqual(email.x + email.w);
      expect(Number(d[2])).toBeLessThanOrEqual(solved.x);
    }
  });

  test("columns names the stages: selectable heads whose card lists the split", () => {
    const data = { ...SANKEY, columns: ["Channel", "First answer", "Outcome"] };
    const { html, elements } = build(sankey, data);
    expect(marks(html).map((m) => m.id)).toContain("tickets-col-first-answer");
    const head = elements["tickets-col-outcome"];
    expect(head.members).toEqual(["tickets-solved", "tickets-reopened"]);
    expect(head.facts?.[0]).toMatchObject({ k: "Solved", v: "780 (87%)", ref: "tickets-solved" });
    expect(elements["tickets-chat"].pos).toBe("Channel");
    const e = specError(() => sankey.normalize(raw("sankey", { ...SANKEY, columns: ["A", "B"] }), ctx()));
    expect(e.message).toContain("3 columns");
    // heads render as sentence-case sans at weight 600, and their hit box is measured that way
    const hit = /data-id="tickets-col-first-answer"[^>]*><rect class="x-mark-shape" x="[-\d.]+" y="[-\d.]+" width="([-\d.]+)"/.exec(html)!;
    expect(Number(hit[1])).toBeCloseTo(textWidth("First answer", theme.type.tag, "sans") * 1.08 + 8, 1);
    expect(html).toContain(">First answer</text>");
  });

  test("note markers sit in the gaps between columns, never on a band, a node or a label", () => {
    const r = 10, px = theme.type.nodeSub, tag = theme.type.tag;
    const sets = [
      ["tickets-bot->tickets-reopened", "tickets-agent", "tickets-reopened", "tickets-chat"],
      ["tickets-chat->tickets-agent", "tickets-agent->tickets-solved", "tickets-bot", "tickets-col-outcome"],
    ];
    for (const on of sets) {
      const data = { ...SANKEY, columns: ["Channel", "First answer", "Outcome"], notes: on.map((id) => ({ on: id, text: "A note." })) };
      const { html } = build(sankey, data);
      const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const nodes = [...html.matchAll(/<g class="x-mark x-sankey-node"[^>]*><rect class="x-mark-shape" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)]
        .map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
      const labels = [...html.matchAll(/<text class="x-mark-label x-sankey-label" x="([-\d.]+)" y="([-\d.]+)"(?: text-anchor="(\w+)")?>([^<]*) <tspan class="x-sankey-value">([^<]*)</g)].map((m) => {
        const w = textWidth(unesc(m[4]), px, "sans") + 4 + textWidth(m[5], tag, "sans"), x = Number(m[1]);
        return { x: m[3] === "end" ? x - w : m[3] === "middle" ? x - w / 2 : x, y: Number(m[2]) - px, w, h: px + 3 };
      });
      const heads = [...html.matchAll(/x-sankey-head"[^>]*><rect class="x-mark-shape" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)]
        .map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
      const bands = [...html.matchAll(/class="x-sankey-link x-mark-shape" d="M([-\d.]+),([-\d.]+)C[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+ ([-\d.]+),([-\d.]+)L[-\d.]+,([-\d.]+)/g)]
        .map((m) => ({ x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[3]), y1: Number(m[4]), w: Number(m[5]) - Number(m[4]) }));
      const cols = [...new Set(nodes.map((n) => n.x))].sort((a, b) => a - b), nodeW = nodes[0].w;
      const markers = [...html.matchAll(/<circle class="x-note-ring" cx="([-\d.]+)" cy="([-\d.]+)"/g)].map((m) => ({ x: Number(m[1]) - r, y: Number(m[2]) - r, w: 2 * r, h: 2 * r }));
      expect(markers.length).toBe(on.length);
      for (const box of markers) {
        expect(cols.slice(1).some((c, i) => box.x >= cols[i] + nodeW && box.x + box.w <= c)).toBe(true);
        for (const o of [...nodes, ...labels, ...heads]) expect(hit(box, o)).toBe(false);
        // the band's top edge is the cubic (x0,y0) (xm,y0) (xm,y1) (x1,y1); it is w thick all the way
        for (const b of bands) {
          for (let i = 0; i <= 400; i++) {
            const t = i / 400, u = 1 - t, xm = (b.x0 + b.x1) / 2;
            const x = u * u * u * b.x0 + 3 * u * t * xm + t * t * t * b.x1;
            const y = (u * u * u + 3 * u * u * t) * b.y0 + (3 * u * t * t + t * t * t) * b.y1;
            if (x > box.x && x < box.x + box.w) expect(y < box.y + box.h && y + b.w > box.y).toBe(false);
          }
        }
      }
    }
  });

  test("a band thinner than 1.5px warns", () => {
    const warns: Diagnostic[] = [];
    build(sankey, { id: "s", links: ["A -> B: 5000", "A -> C: 1"] }, warns);
    expect(warns.some((d) => d.rule === "budget-edges" && d.message.includes("A → C (1) draws as a hairline"))).toBe(true);
  });

  test("reading line and data table", () => {
    const b = sankey.normalize(raw("sankey", SANKEY), ctx()) as any;
    expect(sankey.reading?.(b)).toContain("proportional estimates");
    expect(sankey.table?.(b)?.rows[1]).toEqual(["Chat", "Bot", "500", "83%"]);
  });

  test("budgets warn with a concrete fix", () => {
    const warns: Diagnostic[] = [];
    sankey.normalize(raw("sankey", { id: "s", links: ["A -> B: 1", "B -> C: 1", "C -> D: 1", "D -> E: 1", "E -> F: 1"] }), ctx(warns));
    expect(warns.some((d) => d.rule === "budget-nodes" && d.message.includes("columns"))).toBe(true);
    const star: Diagnostic[] = [];
    sankey.normalize(raw("sankey", { id: "s", links: Array.from({ length: 17 }, (_, i) => `Hub -> N${i + 1}: ${i + 1}`) }), ctx(star));
    expect(star.some((d) => d.rule === "budget-nodes" && d.message.includes('"Other" node'))).toBe(true);
    expect(star.some((d) => d.rule === "budget-edges")).toBe(true);
  });

  test("labels are escaped", () => {
    const { html } = build(sankey, { id: "s", links: ["<script>x</script> -> B: 5"] });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
