import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { blockModule as kanban } from "../engine/plans/kanban.ts";
import { blockModule as journey } from "../engine/plans/journey.ts";
import { blockModule as storymap } from "../engine/plans/storymap.ts";
import { loadTheme } from "../engine/theme.ts";
import { SpecError, type BlockModule, type Diagnostic, type ElementInfo, type RawBlock, type RenderContext } from "../engine/types.ts";

const theme = await loadTheme();
const LINE = 7;
const ROOT = resolve(import.meta.dir, "../..");

/** A template's first fenced block of `type`, as YAML data (the way the parser reads it). */
async function templateData(name: string, type: string): Promise<Record<string, unknown>> {
  const src = await Bun.file(`${ROOT}/templates/${name}.md`).text();
  return Bun.YAML.parse(new RegExp("^```" + type + "\\n([\\s\\S]*?)^```", "m").exec(src)![1]) as Record<string, unknown>;
}
// deno-lint-ignore no-explicit-any
type AnyModule = BlockModule<any>;

function ctx(warnings: Diagnostic[] = []): RenderContext {
  return { theme, doc: { front: {}, segments: [] }, inline: (s: string) => s, warn: (d) => void warnings.push(d) };
}
const raw = (type: string, data: unknown): RawBlock => ({ type, info: [], body: "", data, line: LINE });
const clone = <T>(v: T): T => structuredClone(v);

function build(mod: AnyModule, data: unknown, warnings: Diagnostic[] = []) {
  const c = ctx(warnings);
  const block = mod.normalize(raw(mod.type, data), c);
  const html = mod.render(block, c);
  const elements = (mod.model?.(block).elements ?? {}) as Record<string, ElementInfo>;
  return { block, html, elements };
}

function specError(fn: () => unknown): SpecError {
  try { fn(); } catch (e) { if (e instanceof SpecError) return e; throw e; }
  throw new Error("expected a SpecError");
}

const markIds = (html: string) => [...html.matchAll(/class="x-mark(?: [^"]*)?" data-id="([^"]+)"/g)].map((m) => m[1]);

/** The contract every board shares: ids, shapes, model, determinism, no colors. */
function contract(mod: AnyModule, data: unknown, blockId: string) {
  test("marks are unique, prefixed, painted and modelled", () => {
    const { html, elements } = build(mod, data);
    const ids = markIds(html);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith(`${blockId}-`)).toBe(true);
    expect(html.split("x-mark-shape").length - 1).toBe(ids.length);
    for (const id of ids) expect(elements[id]).toBeDefined();
    for (const info of Object.values(elements)) {
      expect(info.figure).toBe(blockId);
      for (const ref of [...(info.members ?? []), ...(info.related ?? [])]) expect(elements[ref]).toBeDefined();
    }
  });

  test("output is deterministic", () => {
    expect(build(mod, clone(data)).html).toBe(build(mod, clone(data)).html);
  });

  test("no colors and no inline styles", () => {
    const { html } = build(mod, data);
    expect(html).not.toContain("style=");
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(html).not.toMatch(/rgb\(/);
  });

  test("unknown block key is a SpecError on the fence line", () => {
    const e = specError(() => build(mod, { ...clone(data as object), colour: "red" }));
    expect(e.line).toBe(LINE);
    expect(e.message).toContain("colour");
  });
}

// ---------- kanban ----------

const board = {
  id: "sprint",
  title: "Sprint 12",
  columns: [
    { label: "To do", about: "Not started." },
    { label: "Doing", limit: 2, about: "In flight." },
    { label: "Done", about: "Shipped." },
  ],
  cards: [
    { label: "Search filters", column: "To do", tags: ["search"], owner: "web", about: "Narrow results by diet." },
    { label: "Stock sync", column: "Doing", about: "Every five minutes." },
    { label: "Password reset", column: "Doing", blocked: true, focal: true, about: "Waiting on security." },
    { label: "Gift cards", column: "Doing", about: "Balance check." },
    { label: "Address lookup", column: "Done", about: "Fewer typos." },
  ],
};

describe("kanban", () => {
  contract(kanban, board, "sprint");

  test("normalizes columns and cards", () => {
    const { block } = build(kanban, board);
    expect(block.columns.map((c: { id: string }) => c.id)).toEqual(["sprint-to-do", "sprint-doing", "sprint-done"]);
    expect(block.columns[1].limit).toBe(2);
    expect(block.cards[0].column).toBe("sprint-to-do");
    expect(block.cards[2].blocked).toBe(true);
  });

  test("over-limit header carries data-tone warn and the count", () => {
    const { html, elements } = build(kanban, board);
    expect(html).toMatch(/data-id="sprint-doing"[^>]*data-tone="warn"/);
    expect(html).not.toMatch(/data-id="sprint-to-do"[^>]*data-tone=/);
    expect(html).toContain(">3 / 2<");
    expect(elements["sprint-doing"].type).toBe("group");
    expect(elements["sprint-doing"].members).toEqual(["sprint-stock-sync", "sprint-password-reset", "sprint-gift-cards"]);
    expect(elements["sprint-doing"].value).toContain("1 over");
  });

  test("blocked card shows a danger dot and the word blocked; tags are chips that are marks", () => {
    const { html, elements } = build(kanban, board);
    expect(html).toContain(`<span class="x-plan-dot" data-tone="danger"></span>blocked`);
    expect(html).toContain(`<span class="x-mark x-plan-chip x-kanban-tag" data-id="sprint-tag-search"><span class="x-mark-shape x-plan-chip-label">search</span><span class="x-plan-lane" aria-hidden="true"><span class="x-plan-pin"></span></span></span>`);
    expect(elements["sprint-password-reset"].related).toEqual(["sprint-doing"]);
    expect(elements["sprint-password-reset"].value).toBe("blocked");
    expect(html).toMatch(/data-id="sprint-password-reset"[^>]*data-blocked="true" data-nav="2,1"/);
  });

  test("a tag selects its cards across columns; a card keeps same-tag cards as context", async () => {
    const { html, elements } = build(kanban, await templateData("kanban", "kanban"));
    const checkout = elements["sprint-board-tag-checkout"];
    expect(checkout).toMatchObject({ type: "group", kind: "tag", value: "4 cards" });
    expect(checkout.members).toEqual([
      "sprint-board-saved-payment-methods", "sprint-board-delivery-slot-picker", "sprint-board-gift-card-balance", "sprint-board-address-autocomplete",
    ]);
    expect(checkout.facts).toEqual([{ k: "Columns", v: "To do 1 · In progress 1 · Review 1 · Done 1" }]);
    expect(html.match(/data-id="sprint-board-tag-checkout"/g)!.length).toBe(4);
    const gift = elements["sprint-board-gift-card-balance"];
    expect(gift.related).toEqual(["sprint-board-review", "sprint-board-tag-checkout"]);
    expect(gift.context).toEqual(["sprint-board-saved-payment-methods", "sprint-board-delivery-slot-picker", "sprint-board-address-autocomplete"]);
    expect(gift.facts).toContainEqual({ k: "Tag", v: "checkout: 4 cards", ref: "sprint-board-tag-checkout", raw: 4 });
  });

  test("column facts: load against the limit, blocked cards, owner mix; card facts: age and blocked reason", async () => {
    const { html, elements } = build(kanban, await templateData("kanban", "kanban"));
    const review = elements["sprint-board-review"];
    expect(review.pos).toBe("3 of 4");
    expect(review.facts).toEqual([
      { k: "Load", v: "4 / 3 · 1 over the limit", raw: 4, tone: "up" },
      { k: "Blocked", v: "Password reset by SMS", ref: "sprint-board-password-reset-by-sms" },
      { k: "Owners", v: "backend 2 · web 2" },
    ]);
    expect(html).toMatch(/data-id="sprint-board-review"[^>]*aria-label="Review: 4 cards · limit 3, 1 over, 1 blocked"/);
    const reset = elements["sprint-board-password-reset-by-sms"];
    expect(reset.facts!.slice(0, 3)).toEqual([
      { k: "Column", v: "Review · 4 / 3", ref: "sprint-board-review" },
      { k: "In column", v: "9 days", raw: 9 },
      { k: "Blocked", v: "Security sign-off, no date yet", tone: "down" },
    ]);
    expect(html).toMatch(/class="x-note-marker x-plan-note" data-note="2" data-for="sprint-board-password-reset-by-sms"/);
    // markers get a lane inside the mark: after a head's count, and floated into a card's first line ahead of its title
    expect(html).toMatch(/data-id="sprint-board-review"[^>]*><span class="x-mark-shape x-plan-head-label">Review<\/span><span class="x-kanban-facts">.*?<span class="x-plan-count">4 \/ 3<\/span><\/span><span class="x-plan-lane" aria-hidden="true"><span class="x-plan-pin"><\/span><span class="x-note-marker x-plan-note" data-note="1"/);
    expect(html).toMatch(/data-id="sprint-board-password-reset-by-sms"[^>]*><span class="x-plan-line"><span class="x-plan-lane" aria-hidden="true"><span class="x-plan-pin"><\/span><span class="x-note-marker x-plan-note" data-note="2"[^>]*>2<\/span><\/span><span class="x-mark-shape x-card-label">Password reset by SMS</);
    // a tag repeats across cards, so only its first chip holds the pin slot
    expect(html.match(/data-id="sprint-board-tag-checkout"/g)!.length).toBe(4);
    expect(html.match(/data-id="sprint-board-tag-checkout"><span class="x-mark-shape x-plan-chip-label">checkout<\/span><span class="x-plan-lane"/g)!.length).toBe(1);
    expect(kanban.reading!(build(kanban, board).block)).toContain("limit");
    expect(kanban.table!(build(kanban, board).block).rows[2]).toEqual(["Password reset", "Doing", "", "", "yes"]);
  });

  test("escapes labels", () => {
    const data = clone(board);
    data.cards[0].label = "<script>alert(1)</script>";
    const { html } = build(kanban, data);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("errors: missing column, bad limit, duplicate id, unknown card key", () => {
    const missing = clone(board);
    missing.cards[0].column = "Review";
    expect(specError(() => build(kanban, missing)).rule).toBe("ref-exists");

    const limit = clone(board) as { columns: Record<string, unknown>[] };
    limit.columns[1].limit = "many";
    expect(specError(() => build(kanban, limit)).line).toBe(LINE);

    const dup = clone(board) as { columns: Record<string, unknown>[] };
    dup.columns[0].id = "x";
    dup.columns[1].id = "x";
    expect(specError(() => build(kanban, dup)).rule).toBe("id-unique");

    const key = clone(board) as { cards: Record<string, unknown>[] };
    key.cards[0].points = 3;
    expect(specError(() => build(kanban, key)).message).toContain("points");
  });

  test("budget: too many columns and too many cards in one column warn", () => {
    const data = clone(board) as { columns: Record<string, unknown>[]; cards: Record<string, unknown>[] };
    data.columns.push({ label: "A" }, { label: "B" }, { label: "C" });
    for (let i = 0; i < 4; i++) data.cards.push({ label: `Extra ${i}`, column: "Done" });
    const warnings: Diagnostic[] = [];
    build(kanban, data, warnings);
    const messages = warnings.filter((w) => w.rule === "budget-nodes").map((w) => w.message);
    expect(messages.some((m) => m.includes("6 columns"))).toBe(true);
    expect(messages.some((m) => m.includes(`"Done" holds 5`))).toBe(false);
    data.cards.push({ label: "One more", column: "Done" });
    const more: Diagnostic[] = [];
    build(kanban, data, more);
    expect(more.some((w) => w.message.includes(`"Done" holds 6`))).toBe(true);
  });
});

// ---------- journey ----------

const trip = {
  id: "switch",
  stages: [
    { label: "Discover", about: "Hears about the plan." },
    { label: "Compare", about: "Weighs price and coverage." },
    { label: "Sign up", about: "Orders online." },
  ],
  rows: [
    { label: "Doing", cells: ["Sees an ad", "Reads reviews", { label: "Fills the form", focal: true, about: "Six minutes." }] },
    { label: "Thinking", cells: ["Is it cheaper?", null, "Hope this is quick"] },
  ],
  sentiment: [1, 0, { value: -2, about: "The form times out." }],
  pains: [{ stage: "Sign up", label: "Form times out", about: "Loses everything typed." }],
};

describe("journey", () => {
  contract(journey, trip, "switch");

  test("normalizes stages, cells, sentiment and pains", () => {
    const { block, html } = build(journey, trip);
    expect(block.stages.map((s: { id: string }) => s.id)).toEqual(["switch-discover", "switch-compare", "switch-sign-up"]);
    expect(block.rows[0].cells[0].id).toBe("switch-doing-discover");
    expect(block.rows[1].cells[1]).toBeNull();
    expect(block.sentiment.points.map((p: { value: number }) => p.value)).toEqual([1, 0, -2]);
    expect(block.pains.items[0].stage).toBe("switch-sign-up");
    // 3 stages + 2 rows + 5 cells + sentiment head + 3 points + pains head + 1 pain
    expect(markIds(html).length).toBe(16);
  });

  test("sentiment points carry tones by value; pains are danger chips", () => {
    const { html } = build(journey, trip);
    expect(html).toMatch(/data-id="switch-sentiment-discover"[^>]*data-tone="ok"/);
    expect(html).toMatch(/data-id="switch-sentiment-compare"[^>]*data-tone="neutral"/);
    expect(html).toMatch(/data-id="switch-sentiment-sign-up"[^>]*data-tone="danger"/);
    expect(html).toMatch(/data-id="switch-pain-form-times-out"[^>]*data-tone="danger"/);
    expect(html).toContain(">−2<");
  });

  test("a stage lights its cells, point and pains", () => {
    const { elements } = build(journey, trip);
    expect(elements["switch-sign-up"].members).toEqual([
      "switch-doing-sign-up", "switch-thinking-sign-up", "switch-sentiment-sign-up", "switch-pain-form-times-out",
    ]);
    expect(elements["switch-doing-discover"].related).toEqual(["switch-discover", "switch-doing"]);
  });

  test("a sentiment point keeps its whole stage column in view and says where it stands", async () => {
    const { html, elements } = build(journey, await templateData("journey", "journey"));
    const point = elements["switch-plan-sentiment-set-up"];
    expect(point.related).toEqual(["switch-plan-set-up", "switch-plan-sentiment"]);
    expect(point.context).toEqual([
      "switch-plan-doing-set-up", "switch-plan-thinking-set-up", "switch-plan-touchpoint-set-up", "switch-plan-pain-transfer-code-needed",
    ]);
    expect(point.facts).toEqual([
      { k: "Standing", v: "lowest of 5", raw: -2 },
      { k: "Change", v: "−3 from Sign up", ref: "switch-plan-sentiment-sign-up", tone: "down", raw: -3 },
      { k: "Pains", v: "Transfer code needed", ref: "switch-plan-pain-transfer-code-needed" },
    ]);
    const pain = elements["switch-plan-pain-transfer-code-needed"];
    expect(pain.related).toEqual(["switch-plan-set-up", "switch-plan-pains", "switch-plan-sentiment-set-up"]);
    expect(elements["switch-plan-set-up"].links).toEqual([
      { rel: "Doing", ids: ["switch-plan-doing-set-up"] },
      { rel: "Thinking", ids: ["switch-plan-thinking-set-up"] },
      { rel: "Touchpoint", ids: ["switch-plan-touchpoint-set-up"] },
      { rel: "Pains", ids: ["switch-plan-pain-transfer-code-needed"] },
    ]);
    // the sentiment band: taller, with +2 / −2 hairlines and a dashed zero
    expect(html).toContain('height="120"');
    expect(html.match(/class="x-journey-hair"/g)!.length).toBe(2);
    expect(html).toContain('class="x-journey-zero"');
    // note 1 targets the focal cell first; note 2 targets a point, so it sits on that stage's head
    expect(html).toMatch(/data-id="switch-plan-doing-set-up"[^>]*>[^]*?data-note="1"/);
    expect(html).toMatch(/data-id="switch-plan-first-bill"[^>]*><span class="x-mark-shape x-plan-head-label">First bill<\/span><span class="x-plan-lane" aria-hidden="true"><span class="x-plan-pin"><\/span><span class="x-note-marker x-plan-note" data-note="2"/);
    expect(html).toMatch(/data-id="switch-plan-doing-set-up"[^>]*><span class="x-plan-line"><span class="x-plan-lane" aria-hidden="true"><span class="x-plan-pin"><\/span><span class="x-note-marker x-plan-note" data-note="1"[^>]*>1<\/span><\/span><span class="x-mark-shape x-card-label">/);
    // a row label keeps its lane on the label's line, above the sub line
    expect(html).toMatch(/data-id="switch-plan-sentiment"[^>]*><span class="x-plan-rowhead-line"><span class="x-mark-shape x-plan-rowhead-label">Sentiment<\/span><span class="x-plan-lane"[^>]*><span class="x-plan-pin"><\/span><\/span><\/span><span class="x-plan-rowhead-sub">/);
    expect(journey.table!(build(journey, trip).block)).toEqual({
      head: ["Stage", "Doing", "Thinking", "Sentiment", "Pains"],
      rows: [["Discover", "Sees an ad", "Is it cheaper?", "+1", ""], ["Compare", "Reads reviews", "", "0", ""], ["Sign up", "Fills the form", "Hope this is quick", "−2", "Form times out"]],
    });
  });

  test("escapes cell labels", () => {
    const data = clone(trip) as { rows: { cells: unknown[] }[] };
    data.rows[0].cells[0] = "<script>alert(1)</script>";
    const { html } = build(journey, data);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("errors: cell count, sentiment range, pain stage, unknown row key", () => {
    const cells = clone(trip) as { rows: { cells: unknown[] }[] };
    cells.rows[0].cells.pop();
    expect(specError(() => build(journey, cells)).message).toContain("2 cells for 3 stages");

    const range = clone(trip) as { sentiment: unknown[] };
    range.sentiment[0] = 3;
    expect(specError(() => build(journey, range)).line).toBe(LINE);

    const pain = clone(trip);
    pain.pains[0].stage = "Pay";
    expect(specError(() => build(journey, pain)).rule).toBe("ref-exists");

    const key = clone(trip) as { rows: Record<string, unknown>[] };
    key.rows[0].mood = "happy";
    expect(specError(() => build(journey, key)).message).toContain("mood");
  });

  test("budget: more than 6 stages warns", () => {
    const stages = ["A", "B", "C", "D", "E", "F", "G"];
    const data = { id: "long", stages, rows: [{ label: "Doing", cells: stages.map((s) => `Do ${s}`) }] };
    const warnings: Diagnostic[] = [];
    build(journey, data, warnings);
    expect(warnings.some((w) => w.rule === "budget-nodes" && w.message.includes("7 stages"))).toBe(true);
  });
});

// ---------- storymap ----------

const map = {
  id: "shop",
  activities: [
    { label: "Find", about: "Getting to the right product.", steps: ["Search", { label: "Browse", about: "Aisles." }] },
    { label: "Buy", about: "Paying for the basket.", steps: ["Pay"] },
  ],
  releases: [
    { label: "MVP", about: "Order end to end.", stories: { Search: ["By name"], Browse: ["Aisles"], Pay: [{ label: "Card", focal: true, about: "Cards only." }] } },
    { label: "Next", stories: { Search: ["Filters", "Voice"] } },
  ],
};

describe("storymap", () => {
  contract(storymap, map, "shop");

  test("normalizes activities, steps, releases and stories", () => {
    const { block } = build(storymap, map);
    expect(block.steps.map((s: { id: string }) => s.id)).toEqual(["shop-search", "shop-browse", "shop-pay"]);
    expect(block.activities[0].steps).toEqual(["shop-search", "shop-browse"]);
    expect(block.stories.map((s: { id: string }) => s.id)).toEqual(["shop-by-name", "shop-aisles", "shop-card", "shop-filters", "shop-voice"]);
  });

  test("activity spans its steps; release and step light their stories", () => {
    const { html, elements } = build(storymap, map);
    expect(html).toMatch(/data-id="shop-find"[^>]*data-span="2"/);
    expect(html).not.toMatch(/data-id="shop-buy"[^>]*data-span=/);
    expect(elements["shop-mvp"].members).toEqual(["shop-by-name", "shop-aisles", "shop-card"]);
    expect(elements["shop-search"].members).toEqual(["shop-by-name", "shop-filters", "shop-voice"]);
    expect(elements["shop-find"].members).toContain("shop-browse");
    expect(elements["shop-card"].related).toEqual(["shop-pay", "shop-mvp"]);
  });

  test("releases report coverage and the steps they leave empty; the first one ends at the release cut", async () => {
    const { html, elements } = build(storymap, map);
    expect(elements["shop-mvp"].value).toBe("3 stories · covers 3 of 3 steps");
    expect(elements["shop-next"].value).toBe("2 stories · covers 1 of 3 steps");
    expect(elements["shop-next"].links).toEqual([{ rel: "Leaves empty", ids: ["shop-browse", "shop-pay"] }]);
    expect(elements["shop-mvp"].links ?? []).toEqual([]); // nothing left empty, no chips
    expect(html.match(/x-storymap-cut"/g)!.length).toBe(1);
    expect(html.indexOf("x-storymap-cut")).toBeGreaterThan(html.indexOf('data-id="shop-card"'));
    expect(html.indexOf("x-storymap-cut")).toBeLessThan(html.indexOf('data-id="shop-filters"'));
    expect(html).toMatch(/<div class="x-storymap-row" data-release="shop-next">[^]*?data-empty="true"><span class="x-on-sel x-storymap-gap">no story<\/span>/);
    const card = elements["shop-card"];
    expect(card.crumb).toEqual(["shop-buy", "shop-pay"]);
    expect(card.facts![0]).toEqual({ k: "Release", v: "MVP", ref: "shop-mvp" });
    expect(elements["shop-filters"].context).toEqual(["shop-by-name", "shop-voice"]);
    expect(elements["shop-search"].links).toEqual([{ rel: "MVP", ids: ["shop-by-name"] }, { rel: "Next", ids: ["shop-filters", "shop-voice"] }]);
    expect(elements["shop-find"].facts).toEqual([
      { k: "Steps", v: "Search and Browse" },
      { k: "MVP", v: "2 stories", ref: "shop-mvp", raw: 2 },
      { k: "Next", v: "2 stories", ref: "shop-next", raw: 2 },
    ]);
  });

  test("the template fits: 8 steps take the narrow columns and warn nothing; 9 steps and a gappy first release warn", async () => {
    const warnings: Diagnostic[] = [];
    const { html, elements } = build(storymap, await templateData("storymap", "storymap"), warnings);
    expect(warnings).toEqual([]);
    expect(html).toContain('data-cols="8"');
    expect(elements["grocery-map-mvp"].value).toBe("8 stories · covers 8 of 8 steps");
    expect(html).toMatch(/data-id="grocery-map-mvp"[^>]*><span class="x-plan-rowhead-line"><span class="x-mark-shape x-plan-rowhead-label">MVP<\/span><span class="x-plan-lane" aria-hidden="true"><span class="x-plan-pin"><\/span><span class="x-note-marker x-plan-note" data-note="1"/);
    expect(html).toMatch(/data-id="grocery-map-same-day-slots"[^>]*><span class="x-plan-line"><span class="x-plan-lane" aria-hidden="true"><span class="x-plan-pin"><\/span><span class="x-note-marker x-plan-note" data-note="2"[^>]*>2<\/span><\/span><span class="x-mark-shape x-card-label">Same-day slots</);
    const wide = { id: "wide", activities: [{ label: "All", steps: Array.from({ length: 9 }, (_, i) => `Step ${i}`) }], releases: [{ label: "One", stories: { "Step 0": ["A"] } }, { label: "Two" }] };
    const more: Diagnostic[] = [];
    build(storymap, wide, more);
    expect(more.some((w) => w.rule === "budget-nodes" && w.message.includes("9 steps"))).toBe(true);
    expect(more.some((w) => w.message.includes("not a slice through every step"))).toBe(true);
  });

  test("escapes story labels", () => {
    const data = clone(map) as { releases: { stories: Record<string, unknown[]> }[] };
    data.releases[0].stories.Search = ["<script>alert(1)</script>"];
    const { html } = build(storymap, data);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("errors: unknown step, duplicate step label, too many steps, unknown release key", () => {
    const step = clone(map) as { releases: { stories: Record<string, unknown[]> }[] };
    step.releases[1].stories.Checkout = ["Guest checkout"];
    expect(specError(() => build(storymap, step)).rule).toBe("ref-exists");

    const dup = clone(map) as { activities: { steps: unknown[] }[] };
    dup.activities[1].steps.push("Search");
    expect(specError(() => build(storymap, dup)).message).toContain(`"Search"`);

    const wide = { id: "wide", activities: [{ label: "All", steps: Array.from({ length: 13 }, (_, i) => `Step ${i}`) }], releases: [{ label: "One" }] };
    expect(specError(() => build(storymap, wide)).message).toContain("13 steps");

    const key = clone(map) as { releases: Record<string, unknown>[] };
    key.releases[0].date = "2026-10-01";
    expect(specError(() => build(storymap, key)).message).toContain("date");
  });

  test("budget: more than 3 releases warns", () => {
    const data = clone(map) as { releases: Record<string, unknown>[] };
    data.releases.push({ label: "Later" }, { label: "Someday" });
    const warnings: Diagnostic[] = [];
    build(storymap, data, warnings);
    expect(warnings.some((w) => w.rule === "budget-nodes" && w.message.includes("4 releases"))).toBe(true);
  });
});

// ---------- styles: guards for the board review findings ----------

describe("plans-boards.css", () => {
  const css = Bun.file(`${ROOT}/scripts/styles/blocks/plans-boards.css`).text();

  test("restates the board type scale over base.css's matrix .x-mark rule", async () => {
    const text = await css;
    expect(text).toContain(".x-plan .x-mark { min-width: 0; font-size: var(--x-fs-ui); line-height: 1.35; }");
    expect(text).toContain(".x-plan .x-board-head { font-size: var(--x-fs-tag); line-height: 1.3; }");
  });

  test("dark lanes differ from the card surface; selection is ink; blocked is an inset bar; rows share lanes", async () => {
    const text = await css;
    expect(text).toMatch(/\[data-theme="dark"\] \.x-kanban-col \{ background: var\(--x-bg\); border-color: var\(--x-line\); \}/);
    expect(text).toContain("outline: 2px solid var(--x-sel-ring, var(--x-text));");
    expect(text).toContain("box-shadow: inset 3px 0 0 var(--x-danger);");
    expect(text).toContain("grid-template-rows: subgrid;");
    expect(text).not.toContain("overflow-wrap: anywhere; }");
  });

  test("markers sit in a lane, never on a border; the pin shares it; related chips step up to line-strong", async () => {
    const text = await css;
    const note = text.match(/\.x-plan-note,\s*\.x-plan-pin \{[^}]*\}/)![0];
    expect(note).not.toMatch(/position: absolute|top:|left:/);
    expect(text).toContain(".x-plan-card > .x-plan-line > .x-plan-lane { float: right;");
    expect(text).toMatch(/\.x-stage\.is-dock-below [^{]*> \.x-plan-pin \{ display: grid; place-items: center; \}/);
    expect(text).not.toContain('content: "1"');
    expect(text).not.toContain("x-leader-num");
    expect(text).toContain(".x-plan-chip.x-mark.is-related { border-color: var(--x-line-strong); color: var(--x-text); }");
  });
});
