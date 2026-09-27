import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { textWidth } from "../engine/kit.ts";
import { blockModule as gantt } from "../engine/plans/gantt.ts";
import { blockModule as timeline } from "../engine/plans/timeline.ts";
import { loadTheme } from "../engine/theme.ts";
import { SpecError, type Diagnostic, type ElementInfo, type RawBlock, type RenderContext } from "../engine/types.ts";

const theme = await loadTheme();
const TEMPLATES = resolve(import.meta.dir, "../../templates");

/** The first fenced block of `type` in a template, read the way the parser reads it (without loading every block module). */
async function templateBlock(name: string, type: string): Promise<RawBlock> {
  const src = await Bun.file(`${TEMPLATES}/${name}.md`).text();
  const m = new RegExp("^```" + type + "\\n([\\s\\S]*?)^```", "m").exec(src)!;
  return { type, info: [], body: m[1], data: Bun.YAML.parse(m[1]), line: src.slice(0, m.index).split("\n").length };
}

// ---------- geometry helpers: boxes, orthogonal polylines, crossings ----------

interface Box { x: number; y: number; w: number; h: number }
type Pt = [number, number];

/** Every coordinate pair of a path, in order. orthoPath writes corners as Q control points, so this is the exact route. */
const pairs = (d: string): Pt[] => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

/** Does segment a→b pass through the inside of the box (shrunk by `inset`)? */
function crosses(a: Pt, b: Pt, box: Box, inset = 0.5): boolean {
  const x0 = box.x + inset, x1 = box.x + box.w - inset, y0 = box.y + inset, y1 = box.y + box.h - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
}

const ganttEdges = (html: string) =>
  [...html.matchAll(/<g class="x-edge[^"]*" data-id="[^"]+" data-from="([^"]+)" data-to="([^"]+)"[^>]*>(?:<path class="x-gantt-halo" d="[^"]+"\/>)?<path class="x-edge-line" d="([^"]+)"/g)]
    .map((m) => ({ from: m[1], to: m[2], pts: pairs(m[3]) }));

function dateBoxes(html: string): Box[] {
  const tag = theme.type.tag;
  return [...html.matchAll(/<text class="x-value-label x-gantt-date" x="([\d.-]+)" y="([\d.-]+)"( text-anchor="end")?>([^<]*)<\/text>/g)].map((m) => {
    const w = textWidth(m[4], tag, "sans") * 1.08, x = Number(m[1]);
    return { x: m[3] ? x - w : x, y: Number(m[2]) - tag * 0.75, w, h: tag };
  });
}

/** Milestone dates that touch any connector. */
function dateCrossings(html: string): number {
  let n = 0;
  for (const box of dateBoxes(html)) {
    const grown = { x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 };
    for (const e of ganttEdges(html)) for (let i = 1; i < e.pts.length; i++) if (crosses(e.pts[i - 1], e.pts[i], grown, 0)) n++;
  }
  return n;
}
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

function makeCtx(warnings: Diagnostic[] = []): RenderContext {
  return { theme, doc: { front: {}, segments: [] }, inline: (s: string) => s, warn: (d) => void warnings.push(d) };
}
const raw = (type: string, data: unknown): RawBlock => ({ type, info: [], body: "", data, line: 7 });

function specError(fn: () => unknown): SpecError {
  try { fn(); } catch (e) { if (e instanceof SpecError) return e; throw e; }
  throw new Error("expected a SpecError");
}

const unesc = (s: string) => s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const dataIds = (html: string) => [...html.matchAll(/data-id="([^"]*)"/g)].map((m) => unesc(m[1]));
const markBodies = (html: string) => [...html.matchAll(/<g class="x-mark[ "][^>]*>([\s\S]*?)<\/g>/g)].map((m) => m[1]);

function checkStructure(html: string, elements: Record<string, ElementInfo>, prefix: string) {
  const ids = dataIds(html);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    expect(id.startsWith(prefix)).toBe(true);
    expect(elements[id]).toBeDefined();
  }
  const marks = markBodies(html);
  expect(marks.length).toBeGreaterThan(0);
  for (const body of marks) expect(body).toContain("x-mark-shape");
  expect(html).not.toContain("style=");
  expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}(?![\w-])/);
  expect(html).not.toMatch(/rgba?\(/);
}

// ---------- gantt ----------

const plan = (): Record<string, any> => ({
  id: "plan",
  today: "2026-03-10",
  tasks: [
    { label: "Design", group: "Build", start: "2026-03-02", days: 5, progress: 1, about: "Screens agreed with the client team." },
    { label: "Backend", group: "Build", after: ["Design"], days: 10, progress: 0.4, focal: true, about: "Longest task; everything waits on it." },
    { id: "plan-web", label: "Web", group: "Build", start: "2026-03-09", end: "2026-03-20", about: "The customer pages." },
    { label: "Review", group: "Ship", after: ["Backend", "plan-web"], days: 5, about: "Outside review of the release." },
    { label: "Launch", group: "Ship", after: "Review", milestone: true, about: "Goes to every customer." },
  ],
});

describe("gantt", () => {
  test("normalizes dates, dependencies, groups and range", () => {
    const b = gantt.normalize(raw("gantt", plan()), makeCtx());
    const at = Object.fromEntries(b.tasks.map((t) => [t.label, t]));
    expect(at.Design.start).toBe(day("2026-03-02"));
    expect(at.Design.end).toBe(day("2026-03-07"));
    expect(at.Backend.start).toBe(day("2026-03-07"));
    expect(at.Web.end).toBe(day("2026-03-21")); // `end` is the last day, inclusive
    expect(at.Review.start).toBe(day("2026-03-21"));
    expect(at.Review.after).toEqual(["plan-backend", "plan-web"]);
    expect(at.Launch.milestone).toBe(true);
    expect(at.Launch.start).toBe(day("2026-03-26"));
    expect(b.tasks.map((t) => t.id)).toEqual(["plan-design", "plan-backend", "plan-web", "plan-review", "plan-launch"]);
    expect(b.groups.map((g) => [g.id, g.label])).toEqual([["plan-build", "Build"], ["plan-ship", "Ship"]]);
    expect(b.start).toBe(day("2026-03-02"));
    expect(b.end).toBe(day("2026-03-27"));
    expect(b.today).toBe(day("2026-03-10"));
  });

  test("throws SpecError for bad specs", () => {
    const bad = (patch: (d: Record<string, any>) => void) => {
      const d = plan();
      patch(d);
      return specError(() => gantt.normalize(raw("gantt", d), makeCtx()));
    };
    const unknown = bad((d) => { d.colour = "red"; });
    expect(unknown.message).toContain("tasks");
    expect(unknown.line).toBe(7);
    expect(bad((d) => { d.tasks = "Design"; }).line).toBe(7);
    expect(bad((d) => { d.tasks[0].start = "2026-02-30"; }).line).toBe(7);
    expect(bad((d) => { d.tasks[1].after = ["Nope"]; }).rule).toBe("ref-exists");
    expect(bad((d) => { d.tasks[0].after = ["Review"]; }).message).toContain("loop");
    expect(bad((d) => { d.tasks[2].end = "2026-03-01"; }).message).toContain("before it starts");
    expect(bad((d) => { d.tasks[0].end = "2026-03-09"; }).message).toContain("not both");
    expect(bad((d) => { d.tasks[0].progress = 40; }).message).toContain("0 to 1");
    expect(bad((d) => { d.tasks[4].days = 2; }).message).toContain("milestone");
    expect(bad((d) => { d.tasks[2].id = "plan-design"; d.tasks[0].id = "plan-design"; }).rule).toBe("id-unique");
  });

  test("warns over budget instead of throwing", () => {
    const warnings: Diagnostic[] = [];
    const tasks = Array.from({ length: 15 }, (_, i) => ({ label: `Task ${i + 1}`, start: "2026-01-05", days: 3, focal: i < 3 }));
    gantt.normalize(raw("gantt", { id: "big", tasks }), makeCtx(warnings));
    expect(warnings.map((w) => w.rule)).toEqual(["budget-nodes", "budget-focal"]);
  });

  test("renders prefixed marks, edges and a model entry for each", () => {
    const c = makeCtx();
    const b = gantt.normalize(raw("gantt", plan()), c);
    const html = gantt.render(b, c);
    const elements = gantt.model!(b).elements!;
    checkStructure(html, elements, "plan");
    expect(html).toContain('data-layout="gantt"');
    expect(html).toContain("x-gantt-today");
    expect(html).toContain("x-gantt-progress");
    expect(html.match(/<g class="x-edge[ "]/g)!.length).toBe(4);
    expect(elements["plan-design->plan-backend"]).toMatchObject({ type: "edge", from: "plan-design", to: "plan-backend" });
    for (const e of Object.values(elements).filter((e) => e.type === "edge")) {
      expect(elements[e.from!].type).toBe("node");
      expect(elements[e.to!].type).toBe("node");
    }
    expect(elements["plan-build"]).toMatchObject({ type: "group", members: ["plan-design", "plan-backend", "plan-web"] });
    expect(elements["plan-backend"].value).toBe("Mar 7 – Mar 16 · 10 d");
    expect(elements["plan-backend"].facts).toContainEqual({ k: "Done", v: "40%", raw: 40 });
    expect(elements["plan-backend"].say).toContain("40% done");
    expect(html).toMatch(/aria-label="Backend: Mar 7 – Mar 16 · 10 d · 40% done"/);
  });


  test("critical path: float in days from the template, and the path in start order", async () => {
    const b = gantt.normalize(await templateBlock("gantt", "gantt"), makeCtx());
    const at = Object.fromEntries(b.tasks.map((t) => [t.label, t]));
    expect(at["Security review"].float).toBe(0);
    expect(at["Private beta"].float).toBe(6);
    expect(at["Load test"].float).toBe(10);
    expect(at.Backend.float).toBe(6);
    expect(at["Mobile app"].float).toBe(6);
    expect(at["Public launch"].float).toBe(0);
    expect(at["Help center"].float).toBeUndefined(); // not linked
    expect(at["Support training"].critical).toBe(false);
    expect(b.critical).toEqual(["launch-api-design", "launch-web-app", "launch-security-review", "launch-public-launch"]);
    expect(b.finish).toBe(day("2026-05-23"));
  });

  test("the critical path is a selectable id; critical connectors are marked at rest", async () => {
    const c = makeCtx();
    const b = gantt.normalize(await templateBlock("gantt", "gantt"), c);
    const html = gantt.render(b, c);
    const el = gantt.model!(b).elements!;
    const crit = el["launch-critical"];
    expect(crit.type).toBe("group");
    expect(crit.value).toBe("API design → Web app → Security review → Public launch");
    expect(crit.members).toEqual([
      "launch-api-design", "launch-web-app", "launch-security-review", "launch-public-launch",
      "launch-api-design->launch-web-app", "launch-web-app->launch-security-review", "launch-security-review->launch-public-launch",
    ]);
    expect(html).toContain('data-id="launch-critical"');
    const critEdges = [...html.matchAll(/<g class="x-edge x-gantt-edge x-gantt-crit" data-id="([^"]+)"/g)].map((m) => m[1].replace(/&gt;/g, ">"));
    expect(critEdges.sort()).toEqual(crit.members!.filter((m) => m.includes("->")).sort());
  });

  test("task cards: slack, relations with real names, the chain as context, no invented edge labels", async () => {
    const b = gantt.normalize(await templateBlock("gantt", "gantt"), makeCtx());
    const el = gantt.model!(b).elements!;
    const sec = el["launch-security-review"];
    expect(sec.type).toBe("node");
    expect(sec.pos).toBe("critical");
    expect(sec.facts![0]).toEqual({ k: "Slack", v: "0 d · critical", raw: 0 });
    expect(sec.facts).toContainEqual({ k: "Done", v: "20%", raw: 20 });
    expect(sec.facts).toContainEqual({ k: "Ends", v: "1 d before Public launch", ref: "launch-public-launch" });
    expect(sec.links).toEqual([
      { rel: "Waits for", ids: ["launch-backend", "launch-web-app"] },
      { rel: "Blocks", ids: ["launch-public-launch"] },
    ]);
    expect(sec.context).toContain("launch-critical");
    expect(sec.context).toContain("launch-api-design");
    expect(sec.context).toContain("launch-api-design->launch-web-app");
    expect(sec.context).not.toContain("launch-backend"); // direct neighbours are related, not context
    expect(sec.crumb).toEqual(["launch-verify"]);
    expect(el["launch-private-beta"].facts![0]).toEqual({ k: "Slack", v: "6 d", raw: 6 });
    expect(el["launch-help-center"].facts![0]).toEqual({ k: "Slack", v: "not linked" });
    for (const e of Object.values(el).filter((x) => x.type === "edge")) expect(e.label).toBe("");
    const today = el["launch-today"];
    expect(today.say).toBe("Apr 20: 0 tasks late, 2 in progress");
    expect(today.related).toEqual(["launch-security-review", "launch-private-beta"]);
  });

  test("slack ghosts on linked tasks with float, outlines for tasks with no progress, anchors at the bar start", async () => {
    const c = makeCtx();
    const b = gantt.normalize(await templateBlock("gantt", "gantt"), c);
    const html = gantt.render(b, c);
    const body = (id: string) => new RegExp(`data-id="${id}"[^>]*>([\\s\\S]*?)(?=<g class="x-mark )`).exec(html)![1];
    expect(body("launch-private-beta")).toContain('class="x-on-sel x-gantt-slack"');
    expect(body("launch-private-beta")).toContain(">6 d<");
    expect(body("launch-load-test")).toContain(">10 d<");
    expect(body("launch-security-review")).not.toContain("x-gantt-slack");
    expect(body("launch-help-center")).not.toContain("x-gantt-slack");
    expect(html).toMatch(/data-id="launch-help-center"[^>]*data-outline="true"/);
    expect(html).not.toMatch(/data-id="launch-backend"[^>]*data-outline/);
    expect(body("launch-security-review")).toContain('class="x-anchor"');
    expect(html).toContain('data-id="launch-today"');
    expect(html).toMatch(/class="x-note-marker" data-note="1" data-for="launch-security-review"/);
  });

  test("slack labels: one form, the days alone, never under the today rule", async () => {
    const c = makeCtx();
    const html = gantt.render(gantt.normalize(await templateBlock("gantt", "gantt"), c), c);
    const labels = [...html.matchAll(/<text class="x-gantt-slack-label" x="([\d.-]+)"[^>]*>([^<]*)<\/text>/g)];
    expect(labels.map((m) => m[2])).toEqual(["6 d", "6 d", "10 d", "6 d"]);
    const today = Number(/<line class="x-gantt-today-hit" x1="([\d.-]+)"/.exec(html)![1]);
    for (const [, x, s] of labels) {
      const w = textWidth(s, theme.type.tag, "sans");
      expect(today < Number(x) - w / 2 - 2 || today > Number(x) + w / 2 + 2).toBe(true);
    }
  });

  test("note markers keep off slack ghosts, connectors and the today rule, all drawn in the full view", async () => {
    const c = makeCtx();
    const html = gantt.render(gantt.normalize(await templateBlock("gantt", "gantt"), c), c);
    const markers = [...html.matchAll(/<circle class="x-note-ring" cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/g)]
      .map((m) => ({ x: Number(m[1]) - Number(m[3]), y: Number(m[2]) - Number(m[3]), w: 2 * Number(m[3]), h: 2 * Number(m[3]) }));
    expect(markers.length).toBe(2);
    const ghosts = [...html.matchAll(/class="x-on-sel x-gantt-slack"><rect class="x-gantt-slack-box" x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }));
    expect(ghosts.length).toBe(4);
    const today = /<line class="x-gantt-today-hit" x1="([\d.-]+)" y1="([\d.-]+)" x2="[\d.-]+" y2="([\d.-]+)"/.exec(html)!.slice(1).map(Number);
    for (const box of markers) {
      for (const g of ghosts) expect(box.x < g.x + g.w && g.x < box.x + box.w && box.y < g.y + g.h && g.y < box.y + box.h).toBe(false);
      for (const e of ganttEdges(html)) for (let i = 1; i < e.pts.length; i++) expect(crosses(e.pts[i - 1], e.pts[i], box, 0)).toBe(false);
      expect(crosses([today[0], today[1]], [today[0], today[2]], box, 0)).toBe(false);
    }
  });

  test("connectors stay beside their own bars: over a bar they pass on a halo, drawn above the bars, never behind", async () => {
    const warnings: Diagnostic[] = [];
    const c = makeCtx(warnings);
    const html = gantt.render(gantt.normalize(await templateBlock("gantt", "gantt"), c), c);
    expect(ganttEdges(html).length).toBe(10);
    // every connector is drawn after the last bar, each on its own halo
    expect(html.lastIndexOf('class="x-mark x-gantt-task')).toBeLessThan(html.indexOf('class="x-edge x-gantt-edge'));
    expect(html.match(/class="x-gantt-halo"/g)!.length).toBe(10);
    // no vertical run leaves the gap between its two bars by more than DETOUR_MAX (96px): no trips across the chart
    for (const e of ganttEdges(html)) {
      const xs = e.pts.map(([x]) => x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(96 + 200);
    }
    const w = Number(/viewBox="0 0 ([\d.]+) /.exec(html)![1]);
    for (const e of ganttEdges(html)) for (const [x] of e.pts) expect(x >= 0 && x <= w).toBe(true);
    expect(warnings).toEqual([]); // no "route" warning: every connector found a clear column
  });

  test("milestone dates clear their connectors, at the end and at the start of the chart", async () => {
    const c = makeCtx();
    const html = gantt.render(gantt.normalize(await templateBlock("gantt", "gantt"), c), c);
    expect(dateBoxes(html).length).toBe(1);
    expect(dateCrossings(html)).toBe(0);
    // a kickoff milestone on the first day with work fanning out of it (the reviewer's "Mar 2" repro)
    const d = plan();
    d.tasks.unshift({ label: "Kickoff", group: "Build", start: "2026-03-02", milestone: true });
    d.tasks[1].after = ["Kickoff"];
    delete d.tasks[1].start;
    const k = makeCtx();
    const kick = gantt.render(gantt.normalize(raw("gantt", d), k), k);
    expect(dateBoxes(kick).length).toBe(2);
    expect(dateCrossings(kick)).toBe(0);
  });

  test("reading line and data table", async () => {
    const b = gantt.normalize(await templateBlock("gantt", "gantt"), makeCtx());
    expect(gantt.reading!(b)).toContain("critical path");
    const t = gantt.table!(b);
    expect(t.head).toEqual(["Task", "Phase", "Start", "End", "Days", "Done", "Waits for", "Slack"]);
    expect(t.rows.find((r) => r[0] === "Private beta")).toEqual(["Private beta", "Verify", "Apr 19", "May 16", "28", "5%", "Mobile app, Load test", "6 d"]);
    expect(b.caveat).toContain("planned dates");
    expect(b.notes!.map((n) => n.on)).toEqual([["launch-security-review"], ["launch-private-beta"]]);
  });

  test("reference lines and bands take dates; reserved ids are refused", () => {
    const d = plan();
    d.marks = [{ x: "2026-03-20", label: "Freeze" }];
    d.bands = [{ from: "2026-03-14", to: "2026-03-15", label: "Offsite" }];
    const c = makeCtx();
    const html = gantt.render(gantt.normalize(raw("gantt", d), c), c);
    expect(html).toContain(">Freeze<");
    expect(html).toContain("x-ref-band");
    const bad = plan();
    bad.marks = [{ y: 3 }];
    expect(specError(() => gantt.normalize(raw("gantt", bad), makeCtx())).message).toContain("dates");
    const clash = plan();
    clash.tasks[0].id = "plan-critical";
    expect(specError(() => gantt.normalize(raw("gantt", clash), makeCtx())).message).toContain("reserved");
  });

  test("is deterministic and escapes text", () => {
    const d = plan();
    d.tasks[0].label = "<script>alert(1)</script>";
    d.tasks[1].after = [];
    d.tasks[1].start = "2026-03-07";
    const one = gantt.render(gantt.normalize(raw("gantt", d), makeCtx()), makeCtx());
    const two = gantt.render(gantt.normalize(raw("gantt", d), makeCtx()), makeCtx());
    expect(one).toBe(two);
    expect(one).not.toContain("<script>");
    expect(one).toContain("&lt;script&gt;");
  });
});

// ---------- timeline ----------

const history = (): Record<string, any> => ({
  id: "hist",
  periods: [
    { label: "Early", start: "2019-01", end: "2020-12", about: "Two people and no revenue." },
    { label: "Growth", start: "2021-01", end: "2022-12", about: "Paid plans and the first hires." },
  ],
  events: [
    { date: 2019, label: "Founded", about: "Started as a side project." },
    { date: "2020-03", label: "First customer", about: "A design agency, still a customer." },
    { date: "2021-06-15", label: "Series A", focal: true, about: "Funded the first sales team." },
    { date: "2022-11", label: "Public API", about: "Partners could build on it." },
  ],
});

describe("timeline", () => {
  test("normalizes dates, precision, periods and ids", () => {
    const b = timeline.normalize(raw("timeline", history()), makeCtx());
    expect(b.events.map((e) => e.id)).toEqual(["hist-founded", "hist-first-customer", "hist-series-a", "hist-public-api"]);
    expect(b.events.map((e) => e.prec)).toEqual(["year", "month", "day", "month"]);
    expect(b.events[2].date).toBe(day("2021-06-15"));
    expect(b.periods[0]).toMatchObject({ id: "hist-early", start: day("2019-01-01"), end: day("2021-01-01") });
    expect(b.start).toBeLessThan(day("2019-01-01"));
    expect(b.end).toBeGreaterThan(day("2023-01-01"));
    expect(b.lanes).toEqual([]);
  });

  test("throws SpecError for bad specs", () => {
    const bad = (patch: (d: Record<string, any>) => void) => {
      const d = history();
      patch(d);
      return specError(() => timeline.normalize(raw("timeline", d), makeCtx()));
    };
    const unknown = bad((d) => { d.events[0].color = "red"; });
    expect(unknown.message).toContain("date");
    expect(unknown.line).toBe(7);
    expect(bad((d) => { d.events[1].date = "2021-13"; }).line).toBe(7);
    expect(bad((d) => { delete d.events[1].date; }).message).toContain("date");
    expect(bad((d) => { d.events[0].lane = "Company"; }).message).toContain("lane");
    expect(bad((d) => { d.periods[0].end = "2018-06"; }).message).toContain("before it starts");
    expect(bad((d) => { d.start = "2020"; }).message).toContain("outside");
    expect(bad((d) => { d.events = []; }).line).toBe(7);
  });

  test("warns over 12 events", () => {
    const warnings: Diagnostic[] = [];
    const events = Array.from({ length: 13 }, (_, i) => ({ date: 2000 + i, label: `Year ${i + 1}` }));
    timeline.normalize(raw("timeline", { id: "long", events }), makeCtx(warnings));
    expect(warnings.map((w) => w.rule)).toContain("budget-nodes");
  });

  test("renders prefixed marks with a model entry each; periods relate their events", () => {
    const c = makeCtx();
    const b = timeline.normalize(raw("timeline", history()), c);
    const html = timeline.render(b, c);
    const elements = timeline.model!(b).elements!;
    checkStructure(html, elements, "hist");
    expect(html).toContain('data-layout="timeline"');
    expect(elements["hist-early"].related).toEqual(["hist-founded", "hist-first-customer"]);
    expect(elements["hist-series-a"]).toMatchObject({ kind: "event", value: "Jun 15, 2021" });
  });

  test("lanes become selectable groups", () => {
    const d = history();
    d.events.forEach((e: Record<string, unknown>, i: number) => { e.lane = i % 2 ? "Product" : "Company"; });
    const c = makeCtx();
    const b = timeline.normalize(raw("timeline", d), c);
    const html = timeline.render(b, c);
    const elements = timeline.model!(b).elements!;
    checkStructure(html, elements, "hist");
    expect(elements["hist-company"]).toMatchObject({ type: "group", members: ["hist-founded", "hist-series-a"] });
    expect(elements["hist-founded"].related).toEqual(["hist-company", "hist-early"]);
    expect(html).toContain('data-id="hist-product"');
  });

  test("events relate their era, keep the neighbours in view and carry dates for the brush", async () => {
    const c = makeCtx();
    const b = timeline.normalize(await templateBlock("timeline", "timeline"), c);
    const html = timeline.render(b, c);
    const el = timeline.model!(b).elements!;
    const paid = el["history-paid-plans"];
    expect(paid.related).toEqual(["history-product"]);
    expect(paid.context).toEqual(["history-company-founded", "history-public-api"]);
    expect(paid.pos).toBe("4 of 8");
    expect(paid.facts).toEqual([
      { k: "Since", v: "5 months after Company founded", ref: "history-company-founded", raw: 151 },
      { k: "Next", v: "Public API, 15 months later", ref: "history-public-api", raw: 457 },
      { k: "Era", v: "Product", ref: "history-product" },
    ]);
    expect(el["history-product"].links).toEqual([{ rel: "Events", ids: ["history-company-founded", "history-paid-plans"] }]);
    expect(html).toMatch(/data-id="history-paid-plans"[^>]*data-at="2021-06-01" data-nav="1,3"/);
    expect(html).toMatch(/data-id="history-product"[^>]*data-at="2021-01-01\.\.2022-09-01" data-nav="0,1"/);
    expect(html).toMatch(/<rect class="x-timeline-brush" data-brush="history" data-min="[\d-]+" data-max="[\d-]+"/);
    expect(html).toMatch(/class="x-note-marker" data-note="1" data-for="history-public-api"/);
    expect(timeline.reading!(b)).toContain("space between two dots is the time between them");
    expect(timeline.table!(b).rows[4]).toEqual(["Sep 2022", "Public API", "Platform"]);
  });

  test("stems alternate sides and the focal event stands on a longer one", async () => {
    const c = makeCtx();
    const html = timeline.render(timeline.normalize(await templateBlock("timeline", "timeline"), c), c);
    const lengths = [...html.matchAll(/<g class="x-mark x-timeline-event" data-id="([^"]+)"([^>]*)><line class="x-timeline-leader" x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="([\d.]+)"/g)]
      .map((m) => ({ id: m[1], focal: m[2].includes('data-focal="true"'), len: Math.abs(Number(m[4]) - Number(m[3])), up: Number(m[4]) < Number(m[3]) }));
    expect(lengths.length).toBe(8);
    const focal = lengths.find((l) => l.focal)!;
    expect(focal.id).toBe("history-public-api");
    for (const l of lengths.filter((x) => !x.focal)) expect(focal.len).toBeGreaterThan(l.len);
    const sides = lengths.map((l) => l.up);
    for (let i = 1; i < sides.length; i++) expect(sides[i]).not.toBe(sides[i - 1]);
  });

  test("stacks crowded labels without overlaps", () => {
    const dates = ["2024-01-05", "2024-01-19", "2024-02-02", "2024-02-16", "2024-03-01", "2024-03-15", "2024-03-29", "2024-04-12", "2024-04-26", "2024-05-10"];
    const events = dates.map((date, i) => ({ date, label: `Release candidate ${i + 1}` }));
    const c = makeCtx();
    const html = timeline.render(timeline.normalize(raw("timeline", { id: "crowd", events }), c), c);
    const boxes = [...html.matchAll(/<text class="x-mark-label" x="([\d.-]+)" y="([\d.-]+)"( text-anchor="end")?>([^<]*)<\/text>/g)].map((m) => {
      const x = Number(m[1]), w = textWidth(m[4], theme.type.nodeSub, "sans");
      return { y: Number(m[2]), left: m[3] ? x - w : x, right: m[3] ? x : x + w };
    });
    expect(boxes.length).toBe(10);
    expect(new Set(boxes.map((bx) => bx.y)).size).toBeGreaterThan(2);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], z = boxes[j];
        if (a.y === z.y) expect(a.right <= z.left || z.right <= a.left).toBe(true);
      }
    }
    for (const bx of boxes) expect(bx.right).toBeLessThanOrEqual(960);
  });

  test("is deterministic and escapes text", () => {
    const d = history();
    d.events[0].label = "<script>alert(1)</script>";
    const one = timeline.render(timeline.normalize(raw("timeline", d), makeCtx()), makeCtx());
    const two = timeline.render(timeline.normalize(raw("timeline", d), makeCtx()), makeCtx());
    expect(one).toBe(two);
    expect(one).not.toContain("<script>");
    expect(one).toContain("&lt;script&gt;");
  });
});
