/// <reference lib="dom" />
import { parseArgs } from "node:util";
import { parseDoc } from "../engine/parse.ts";
import type { CommandRun, FrontMatter } from "../engine/types.ts";
import { withBrowser, type Browser, type Page } from "../lib/cdp.ts";
import { usage } from "../lib/commands.ts";
import { geometryScript, type Geometry } from "../lib/geometry.ts";
import { captureHash, display, openInput, openState, type PageFile } from "./shot.ts";

const USAGE = usage("audit");
const VIEWPORT = { width: 1280, height: 900, scale: 1 };
const THEMES = ["light", "dark"] as const;
const VIEWS = ["bare", "full"] as const;

/** Every check, in report order, with what it looks for. references/capture.md lists the same. */
export const CHECKS: [name: string, about: string][] = [
  ["ready", 'html[data-ready] becomes "1" in every state'],
  ["console", "no console errors or uncaught exceptions"],
  ["overflow", "no label is wider than the box or shape it sits in"],
  ["text clipped", "no <text> runs outside its svg, and no text is cut off or ellipsised by an overflow box"],
  ["engine ellipsis", "no '…' that the Markdown source doesn't contain"],
  ["masks", "no connector label (or its backing) covers a node, mark, table or class box"],
  ["line clipped", "every connector and series line stays inside its svg"],
  ["label × line", "no <text> is crossed by a connector, series line or structure path it doesn't belong to"],
  ["label overlap", "no two labels in a figure draw over each other"],
  ["callout × line", "no in-graph callout sits on a connector, and no callout's leader crosses a connector it isn't about"],
  ["text size", "no visible text renders below 13px, diagram labels (after scaling) included"],
  ["figure wider than column", "no figure, stage or block is wider than the page column"],
  ["interaction", "clicking one element of each selectable type selects it, lights or dims the rest, and opens its card (a connector with nothing to add opens none); Esc clears"],
  ["card covers selected", "the open card hides none of the selected element"],
  ["card covers related", "the open card hides at most 25% of what the selection lights up"],
  ["related undimmed", "nothing related to (or in context of) the selection is dimmed"],
  ["dimmed contrast", "dimmed text keeps 3:1 against what is behind it"],
  ["ring", "the selection shows an ink ring (or outline) at 3:1, distinct from the focal accent"],
  ["relation wording", "no relation row in the card repeats both of its endpoints"],
  ["contrast", "theme text tokens reach 4.5:1 (faint 3:1, tone inks 4.5:1 on their tints) in light and dark"],
  ["no-js", "without JavaScript every figure renders and nothing is hidden"],
];

export interface Outcome { problems: string[]; ran: boolean; skip?: string }
export type Findings = Record<string, Outcome>;
export interface AuditState { label: string; hash: string }
interface Located { problem: string; where: string[] }
export interface CheckResult { name: string; status: "pass" | "fail" | "skip"; problems: Located[]; note?: string }

// ---------- pure planning and reporting ----------

/**
 * Front-matter `shots:` as audit states. Accepts a hash string, a list of hash strings, a list of
 * `{ state, name }` (or `hash`/`label`), or a map of name → hash.
 */
export function parseShots(value: unknown): { states: AuditState[]; errors: string[] } {
  const states: AuditState[] = [];
  const errors: string[] = [];
  const add = (hash: unknown, label?: unknown) => {
    if (typeof hash !== "string" || !hash.trim()) return errors.push(`shots: ${JSON.stringify(hash)} is not a state like "sel=id&theme=dark"`);
    const clean = hash.trim().replace(/^#/, "");
    states.push({ label: typeof label === "string" && label.trim() ? label.trim() : clean, hash: clean });
  };
  if (value == null) return { states, errors };
  if (typeof value === "string") add(value);
  else if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        add(o.state ?? o.hash, o.name ?? o.label);
      } else add(item);
    }
  } else if (typeof value === "object") {
    for (const [name, hash] of Object.entries(value as Record<string, unknown>)) add(hash, name);
  } else add(value);
  return { states, errors };
}

/** The states audit visits: rest, the first focal id, the first non-focal id with relations, then shots. */
export function auditStates(picks: { focal: string | null; related: string | null }, shots: AuditState[] = []): AuditState[] {
  const out: AuditState[] = [{ label: "rest", hash: "" }];
  if (picks.focal) out.push({ label: `sel=${picks.focal} (focal)`, hash: `sel=${picks.focal}` });
  if (picks.related && picks.related !== picks.focal) out.push({ label: `sel=${picks.related}`, hash: `sel=${picks.related}` });
  for (const s of shots) if (!out.some((o) => o.hash === s.hash)) out.push(s);
  return out;
}

/** Theme × view combinations for a state. A state that names its theme or view keeps it. */
export function combos(state: AuditState): { theme: string; view: string; hash: string; where: string }[] {
  const params = new URLSearchParams(state.hash);
  const themes = params.get("theme") ? [params.get("theme")!] : [...THEMES];
  const views = params.get("view") ? [params.get("view")!] : [...VIEWS];
  return themes.flatMap((theme) =>
    views.map((view) => {
      const p = new URLSearchParams(state.hash);
      p.set("theme", theme);
      p.set("view", view);
      return { theme, view, hash: captureHash(p.toString()).hash, where: `${theme}/${view}` };
    }),
  );
}

/** Problems that differ only in their numbers ("hides 95%" vs "hides 94%") are the same problem. */
export const problemKey = (problem: string) => problem.replace(/\d+(\.\d+)?/g, "#");

/** Folds per-state findings into one result per check, remembering where each problem showed. */
export function merge(runs: { state: AuditState; where: string; all: number; findings: Findings }[]): CheckResult[] {
  const byCheck = new Map<string, { ran: boolean; skip?: string; problems: Map<string, { text: string; states: Map<string, { wheres: Set<string>; all: number }> }> }>();
  for (const { state, where, all, findings } of runs) {
    for (const [name, o] of Object.entries(findings)) {
      const entry = byCheck.get(name) ?? { ran: false, problems: new Map() };
      byCheck.set(name, entry);
      entry.ran ||= o.ran;
      if (!o.ran) entry.skip ??= o.skip;
      for (const problem of o.problems) {
        const key = problemKey(problem);
        const found = entry.problems.get(key) ?? { text: problem, states: new Map() };
        entry.problems.set(key, found);
        const states = found.states;
        const at = states.get(state.label) ?? { wheres: new Set<string>(), all };
        states.set(state.label, at);
        if (where) at.wheres.add(where);
      }
    }
  }
  const order = CHECKS.map(([n]) => n);
  return [...byCheck.entries()]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([name, e]): CheckResult => {
      const problems = [...e.problems.values()].map(({ text: problem, states }) => ({
        problem,
        where: [...states.entries()].map(([label, at]) =>
          at.wheres.size && at.wheres.size < at.all ? `${label} (${[...at.wheres].join(", ")})` : label,
        ),
      }));
      if (problems.length) return { name, status: "fail", problems };
      if (!e.ran) return { name, status: "skip", problems, note: e.skip ?? "nothing to test" };
      return { name, status: "pass", problems };
    });
}

export function formatResults(results: CheckResult[]): string[] {
  const lines: string[] = [];
  const at = (p: Located) => (p.where.length && !(p.where.length === 1 && p.where[0] === "")) ? `  [${p.where.join("; ")}]` : "";
  for (const r of results) {
    if (r.status === "pass") lines.push(`✓ ${r.name}`);
    else if (r.status === "skip") lines.push(`– ${r.name}: skipped, ${r.note}`);
    else {
      const [first, ...rest] = r.problems;
      lines.push(`✗ ${r.name}: ${first.problem}${at(first)}`);
      for (const p of rest.slice(0, 11)) lines.push(`    ${p.problem}${at(p)}`);
      if (rest.length > 11) lines.push(`    … and ${rest.length - 11} more`);
    }
  }
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const ran = results.length - skipped;
  lines.push(
    failed
      ? `${failed} of ${ran} checks failed${skipped ? ` · ${skipped} skipped` : ""}`
      : `✓ all ${ran} checks passed${skipped ? ` · ${skipped} skipped` : ""}`,
  );
  return lines;
}

// ---------- command ----------

export const run: CommandRun = async (argv) => {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { state: { type: "string", multiple: true }, json: { type: "boolean" } } });
  } catch (err) {
    console.error(`audit: ${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  const inputs = args.positionals;
  if (!inputs.length) {
    console.error(USAGE);
    return 2;
  }
  const extra = (args.values.state ?? []).map((s) => ({ label: s.replace(/^#/, ""), hash: s.replace(/^#/, "") }));
  let failed = false;
  const report: Record<string, CheckResult[]> = {};
  try {
    await withBrowser(async (browser) => {
      for (const input of inputs) {
        let file: PageFile | undefined;
        try {
          file = await openInput(input);
          const results = await auditFile(browser, file, extra);
          report[display(input)] = results;
          failed ||= results.some((r) => r.status === "fail");
          if (!args.values.json) {
            if (inputs.length > 1) console.log(`\n${display(input)}`);
            for (const line of formatResults(results)) console.log(line);
          }
        } catch (err) {
          failed = true;
          console.error(`audit: ${input}: ${(err as Error).message}`);
        } finally {
          await file?.cleanup();
        }
      }
    });
  } catch (err) {
    console.error(`audit: ${(err as Error).message}`);
    return 1;
  }
  if (args.values.json) console.log(JSON.stringify(report, null, 2));
  return failed ? 1 : 0;
};

async function auditFile(browser: Browser, file: PageFile, extra: AuditState[]): Promise<CheckResult[]> {
  const shots = parseShots(file.source ? (parseDoc(file.source).front as FrontMatter & { shots?: unknown }).shots : undefined);
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const runs: Parameters<typeof merge>[0] = [];
  const note = (name: string, o: Outcome, state: AuditState = { label: "", hash: "" }) =>
    runs.push({ state, where: "", all: 1, findings: { [name]: o } });

  const load = async (hash: string): Promise<string | null> => {
    try {
      await openState(page, file.url(hash));
      await page.evaluate(geometryScript());
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  };

  // Where to look: the first focal id and the first non-focal id that has relations.
  const first = await load(captureHash("theme=light&view=full").hash);
  if (first) {
    note("ready", { ran: true, problems: [`html[data-ready] never became "1": ${first}`] });
    return merge(runs);
  }
  const picks = await page.call(pickStates);
  const states = auditStates(picks, [...shots.states, ...extra]);
  if (shots.errors.length) note("ready", { ran: true, problems: shots.errors });

  const ready: string[] = [];
  for (const state of states) {
    const list = combos(state);
    for (const c of list) {
      const failure = await load(c.hash);
      if (failure) {
        ready.push(`${state.label} ${c.where}: ${failure}`);
        continue;
      }
      const sel = new URLSearchParams(state.hash).get("sel");
      const findings = await page.call(inspect, { sel, source: file.source });
      runs.push({ state, where: c.where, all: list.length, findings });
      if (!state.hash && c.view === "full") {
        runs.push({ state: { label: "", hash: "" }, where: "", all: 1, findings: { contrast: await tokenContrast(page, c.theme) } });
      }
    }
  }
  note("ready", { ran: true, problems: ready });

  const clicked = await load(captureHash("theme=light&view=full").hash);
  note("interaction", clicked ? { ran: true, problems: [clicked] } : await page.call(interact));
  note("console", { ran: true, problems: [...new Set(page.consoleErrors())] });
  await page.close().catch(() => {});

  const bare = await browser.newPage();
  await bare.setScriptDisabled(true);
  await bare.setViewport(VIEWPORT);
  await bare.goto(file.url());
  note("no-js", { ran: true, problems: await bare.call(noScriptProblems) });
  await bare.close().catch(() => {});
  return merge(runs);
}

async function tokenContrast(page: Page, mode: string): Promise<Outcome> {
  const names = ["text", "text-dim", "text-faint", "bg", "surface", "ok-ink", "ok-tint", "warn-ink", "warn-tint", "danger-ink", "danger-tint"];
  const colors = await page.call(readColors, names);
  const G = await import("../lib/geometry.ts");
  const problems: string[] = [];
  const pair = (fg: string, bg: string, min: number, optional = false) => {
    const a = colors[fg], b = colors[bg];
    if (!a || !b) {
      if (!optional) problems.push(`${mode}: --x-${a ? bg : fg} does not resolve to a colour`);
      return;
    }
    const ratio = G.contrastRatio(a as [number, number, number], b as [number, number, number]);
    if (ratio < min) problems.push(`${mode}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
  };
  for (const fg of ["text", "text-dim"]) for (const bg of ["bg", "surface"]) pair(fg, bg, 4.5);
  pair("text-faint", "bg", 3);
  for (const tone of ["ok", "warn", "danger"]) pair(`${tone}-ink`, `${tone}-tint`, 4.5, true);
  return { ran: true, problems };
}

// ---------- the functions below run in the page ----------

/** The first focal id, and the first non-focal id (nodes and marks before edges) that has relations. */
export function pickStates(): { focal: string | null; related: string | null } {
  const model = JSON.parse(document.getElementById("x-model")?.textContent || "{}");
  const els: Record<string, any> = model.elements ?? {};
  const order: string[] = [];
  for (const el of document.querySelectorAll("[data-id]")) {
    const id = el.getAttribute("data-id")!;
    if (els[id] && !order.includes(id)) order.push(id);
  }
  const focal = (id: string) => !!document.querySelector(`[data-id="${CSS.escape(id)}"][data-focal="true"]`);
  const edges = Object.values(els).filter((e: any) => e.type === "edge");
  const degree = (id: string) => {
    const e = els[id];
    const links = (e.links ?? []).reduce((n: number, l: any) => n + (l.ids?.length ?? 0), 0);
    const touching = edges.filter((x: any) => x.from === id || x.to === id).length;
    return (e.related?.length ?? 0) + (e.context?.length ?? 0) + links + touching + (e.members?.length ?? 0) + (e.from ? 1 : 0) + (e.to ? 1 : 0);
  };
  const candidates = order.filter((id) => !focal(id) && degree(id) > 0);
  return {
    focal: order.find(focal) ?? null,
    related: candidates.find((id) => els[id].type !== "edge") ?? candidates[0] ?? null,
  };
}

/** Every geometric and state check for the page as it is now. `sel` is the selected id, if any. */
export function inspect(opts: { sel: string | null; source: string | null }): Findings {
  const G = (window as unknown as { __xg: Geometry }).__xg;
  type R = { x: number; y: number; w: number; h: number };
  const out: Findings = {};
  const put = (name: string, problems: string[], ran = true, skip?: string) => {
    out[name] = { problems: [...new Set(problems)], ran, ...(skip ? { skip } : {}) };
  };
  const model = JSON.parse(document.getElementById("x-model")?.textContent || "{}");
  const els: Record<string, any> = model.elements ?? {};
  const html = document.documentElement;
  const rect = (el: Element): R => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const opacity = (el: Element | null) => {
    let o = 1;
    for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity || "1");
    return o;
  };
  const shown = (el: Element) => {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && opacity(el) > 0.01;
  };
  const words = (el: Element | string, max = 48) => {
    const t = (typeof el === "string" ? el : el.textContent ?? "").replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };
  const ownerId = (el: Element) => {
    const host = el.closest("[data-for],[data-id]");
    return host?.getAttribute("data-for") ?? host?.getAttribute("data-id") ?? null;
  };
  const name = (id: string | null | undefined) => {
    if (!id) return "?";
    const e = els[id];
    if (e?.type === "edge" || (!e && id.includes("->"))) return id.replace(/->/g, " -> ");
    return e?.label || id;
  };
  const figureOf = (el: Element) => el.closest("[data-figure]")?.getAttribute("data-figure") ?? el.closest(".x-block")?.getAttribute("data-id") ?? "page";
  const HIT = '[class*="-hit"], .x-edge-hit, .x-line-hit, .x-hit';
  const texts = [...document.querySelectorAll<SVGTextElement>("svg text")].filter((t) => !t.closest("defs, marker, symbol, mask, clipPath") && shown(t) && t.textContent?.trim());

  // colour parsing through a canvas, so every CSS colour syntax (color-mix, oklab…) resolves
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const cache = new Map<string, [number, number, number, number]>();
  const rgba = (css: string): [number, number, number, number] => {
    const hit = cache.get(css);
    if (hit) return hit;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const out: [number, number, number, number] = [r!, g!, b!, a! / 255];
    cache.set(css, out);
    return out;
  };
  const token = (n: string) => {
    const probe = document.createElement("i");
    probe.style.color = `var(--x-${n}, transparent)`;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return rgba(c);
  };
  const pageBg = (() => {
    const b = rgba(getComputedStyle(document.body).backgroundColor);
    const h = rgba(getComputedStyle(html).backgroundColor);
    const t = token("bg");
    return (b[3] > 0.5 ? b : h[3] > 0.5 ? h : t[3] > 0 ? t : [255, 255, 255, 1]).slice(0, 3) as [number, number, number];
  })();
  const accent = token("accent");
  const same = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 12;
  const saturation = (el: Element | null) => {
    let s = 1;
    for (let e = el; e; e = e.parentElement) {
      const m = /saturate\(([\d.]+)\)/.exec(getComputedStyle(e).filter);
      if (m) s *= parseFloat(m[1]);
    }
    return s;
  };
  const paint = (el: Element, color: string, own = 1): [number, number, number, number] => {
    const c = rgba(color);
    const s = saturation(el);
    const rgb = s < 1 ? G.saturate([c[0], c[1], c[2]], s) : [c[0], c[1], c[2]];
    return [rgb[0], rgb[1], rgb[2], c[3] * own * opacity(el)];
  };

  // polylines of a stroked shape, in client coordinates, split where the path jumps (a new subpath)
  const polylines = (g: SVGGeometryElement): number[][][] => {
    const ctm = g.getScreenCTM();
    if (!ctm) return [];
    const at = (x: number, y: number) => {
      const p = new DOMPoint(x, y).matrixTransform(ctm);
      return [p.x, p.y];
    };
    if (g instanceof SVGLineElement) return [[at(g.x1.baseVal.value, g.y1.baseVal.value), at(g.x2.baseVal.value, g.y2.baseVal.value)]];
    let len = 0;
    try {
      len = g.getTotalLength();
    } catch {
      return [];
    }
    if (!len) return [];
    const n = Math.min(800, Math.max(2, Math.ceil(len / 2)));
    const step = len / n;
    const lines: number[][][] = [];
    let cur: number[][] = [];
    let prev: DOMPoint | null = null;
    for (let i = 0; i <= n; i++) {
      const p = g.getPointAtLength(step * i);
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) > step * 1.5 + 1) {
        if (cur.length > 1) lines.push(cur);
        cur = [];
      }
      cur.push(at(p.x, p.y));
      prev = p;
    }
    if (cur.length > 1) lines.push(cur);
    return lines;
  };
  const strokeWidth = (g: SVGGeometryElement) => {
    const w = parseFloat(getComputedStyle(g).strokeWidth) || 1;
    const ctm = g.getScreenCTM();
    return ctm ? w * Math.hypot(ctm.a, ctm.b) : w;
  };
  // What an element occupies on screen: boxes for fills and text, squares along bare strokes.
  const footprint = (el: Element): R[] => {
    if (!(el instanceof SVGElement)) return shown(el) ? [rect(el)] : [];
    const shapes =
      el instanceof SVGGeometryElement || el instanceof SVGTextElement
        ? [el]
        : [...el.querySelectorAll<SVGGraphicsElement>("rect, circle, ellipse, path, line, polyline, polygon, text")];
    const parts: R[] = [];
    for (const s of shapes) {
      if (s.matches(`${HIT}, .x-edge-mask, .x-group-mask`) || s.closest("defs, marker") || !shown(s)) continue;
      if (s instanceof SVGTextElement) {
        parts.push(rect(s));
        continue;
      }
      const style = getComputedStyle(s);
      const filled = !(s instanceof SVGLineElement) && style.fill !== "none" && rgba(style.fill)[3] * parseFloat(style.fillOpacity || "1") > 0.05;
      if (filled) parts.push(rect(s));
      else if (style.stroke !== "none" && s instanceof SVGGeometryElement) {
        for (const line of polylines(s)) parts.push(...G.strokeFootprint(line, strokeWidth(s) + 2, 3));
      }
    }
    return parts;
  };
  const byId = (id: string) =>
    [...document.querySelectorAll("[data-id],[data-for],[data-ref],[data-col]")].filter((el) =>
      ["data-id", "data-for", "data-ref", "data-col"].some((a) => el.getAttribute(a) === id),
    );

  // ---- overflow: a label wider than the box it sits in ----
  {
    const problems: string[] = [];
    let ran = false;
    for (const mark of document.querySelectorAll<SVGGElement>("svg [data-id]:not(.x-edge)")) {
      const boxes = [...mark.querySelectorAll<SVGGraphicsElement>("rect.x-node-box, rect.x-mark-shape")].filter((b) => b.closest("[data-id]") === mark && shown(b));
      if (!boxes.length) continue;
      for (const t of mark.querySelectorAll<SVGTextElement>("text")) {
        if (t.closest("[data-id]") !== mark || !shown(t)) continue;
        const tr = rect(t);
        const cx = tr.x + tr.w / 2, cy = tr.y + tr.h / 2;
        const box = boxes.find((b) => {
          const r = rect(b);
          return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
        });
        if (!box) continue;
        ran = true;
        const br = rect(box);
        const pad = box.matches(".x-node-box") ? 3.5 : 1;
        if (tr.x < br.x + pad - 0.5 || tr.x + tr.w > br.x + br.w - pad + 0.5)
          problems.push(`${name(mark.getAttribute("data-id"))}: "${words(t)}" is ${Math.round(tr.w)}px wide, the box leaves ${Math.round(br.w - 2 * pad)}px`);
      }
    }
    put("overflow", problems, ran, "no label sits inside a box");
  }

  // ---- text clipped: outside its svg, cut by an overflow box, or ellipsised by CSS ----
  {
    const problems: string[] = [];
    const clips = (el: Element) => {
      const list: Element[] = [];
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (/hidden|clip/.test(s.overflowX) || /hidden|clip/.test(s.overflowY)) list.push(e);
      }
      return list;
    };
    for (const t of texts) {
      const svg = (t.closest("svg.x-svg") ?? t.ownerSVGElement) as SVGSVGElement | null;
      if (!svg) continue;
      const tr = rect(t), sr = rect(svg);
      const past = [
        [sr.x - tr.x, "left"],
        [tr.x + tr.w - (sr.x + sr.w), "right"],
        [sr.y - tr.y, "top"],
        [tr.y + tr.h - (sr.y + sr.h), "bottom"],
      ].filter(([d]) => (d as number) > 1) as [number, string][];
      for (const [d, side] of past) problems.push(`"${words(t)}" runs ${Math.round(d)}px past the ${side} edge of ${figureOf(svg)}`);
      for (const box of clips(svg)) {
        const s = getComputedStyle(box), br = rect(box);
        const cutX = /hidden|clip/.test(s.overflowX) && (tr.x < br.x - 1 || tr.x + tr.w > br.x + br.w + 1);
        const cutY = /hidden|clip/.test(s.overflowY) && (tr.y < br.y - 1 || tr.y + tr.h > br.y + br.h + 1);
        if (cutX || cutY) problems.push(`"${words(t)}" is cut off by ${box.localName}.${[...box.classList].join(".") || "(no class)"}`);
      }
    }
    const scope = ".x-content, .x-pop, .x-detail, .x-reading";
    for (const el of document.querySelectorAll<HTMLElement>(`:is(${scope}) *`)) {
      if (el instanceof SVGElement || el.closest("svg") || !shown(el)) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim());
      if (!own) continue;
      const s = getComputedStyle(el);
      const wide = el.scrollWidth > el.clientWidth + 1, tall = el.scrollHeight > el.clientHeight + 1;
      if (s.textOverflow === "ellipsis" && wide) problems.push(`"${words(el)}" is truncated with … (${el.scrollWidth}px of text in ${el.clientWidth}px)`);
      else if ((/hidden|clip/.test(s.overflowX) && wide) || (/hidden|clip/.test(s.overflowY) && tall)) problems.push(`"${words(el)}" is cut off by its box`);
      else if (s.webkitLineClamp && s.webkitLineClamp !== "none" && tall) problems.push(`"${words(el)}" is clamped to ${s.webkitLineClamp} line(s)`);
    }
    put("text clipped", problems, true);
  }

  // ---- engine ellipsis: a "…" the author never wrote ----
  if (opts.source === null) put("engine ellipsis", [], false, "no Markdown source (the input is .html)");
  else {
    const strings: string[] = texts.map((t) => t.textContent ?? "");
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || parent.closest("svg, script, style, .x-tip, #x-model") || !/…|\.\.\./.test(n.textContent ?? "") || !shown(parent)) continue;
      strings.push(n.textContent ?? "");
    }
    put("engine ellipsis", G.engineEllipses(strings, opts.source).map((s) => `"${words(s, 60)}" has a … that is not in the source`), true);
  }

  // ---- masks: a connector label's backing over a node or mark ----
  {
    const problems: string[] = [];
    let ran = false;
    for (const svg of document.querySelectorAll("svg.x-svg")) {
      const boxes = [...svg.querySelectorAll<SVGGraphicsElement>(".x-node-box, rect.x-mark-shape")].filter(shown);
      for (const mask of svg.querySelectorAll<SVGGraphicsElement>(".x-edge-mask")) {
        const m = rect(mask);
        if (!m.w || !m.h || !shown(mask)) continue;
        ran = true;
        const edge = mask.closest(".x-edge-label")?.getAttribute("data-for");
        for (const box of boxes) {
          const b = rect(box);
          if (b.x <= m.x && b.y <= m.y && b.x + b.w >= m.x + m.w && b.y + b.h >= m.y + m.h) continue; // the label sits inside a region
          const dx = Math.min(m.x + m.w, b.x + b.w) - Math.max(m.x, b.x);
          const dy = Math.min(m.y + m.h, b.y + b.h) - Math.max(m.y, b.y);
          if (dx > 0.5 && dy > 0.5) problems.push(`label of ${name(edge)} covers ${name(ownerId(box))}`);
        }
      }
    }
    // Structure connectors (schema, uml) carry bare text: actions, names and multiplicities.
    for (const svg of document.querySelectorAll("svg.x-svg")) {
      const boxes = [...svg.querySelectorAll<SVGGElement>(".x-struct-box")].flatMap((b) => {
        const shape = [...b.querySelectorAll<SVGGraphicsElement>(".x-mark-shape")].find((r) => r.closest(".x-struct-box") === b && !r.closest(".x-struct-col"));
        return shape && shown(shape) ? [{ id: b.getAttribute("data-id"), r: rect(shape) }] : [];
      });
      for (const t of svg.querySelectorAll<SVGTextElement>(".x-struct-label, .x-struct-mult")) {
        if (!shown(t)) continue;
        ran = true;
        const r = rect(t);
        const glyphs = { x: r.x + 1, y: r.y + r.h * 0.2, w: Math.max(0, r.w - 2), h: r.h * 0.6 };
        for (const b of boxes) if (G.overlapArea(glyphs, b.r) > 0.5) problems.push(`"${words(t)}" on ${name(ownerId(t))} covers ${name(b.id)}`);
      }
    }
    put("masks", problems, ran, "no connector labels");
  }

  // ---- line clipped: a connector or series line leaving its svg ----
  {
    const problems: string[] = [];
    let ran = false;
    for (const svg of document.querySelectorAll<SVGSVGElement>("svg.x-svg")) {
      const box = rect(svg);
      for (const l of svg.querySelectorAll<SVGGeometryElement>(".x-edge-line, .x-series-line")) {
        if (!shown(l) || l.closest(".x-sel-layer")) continue;
        ran = true;
        const pad = strokeWidth(l) / 2 + 1;
        const out = polylines(l).flat().find(([x, y]) => x < box.x - pad || x > box.x + box.w + pad || y < box.y - pad || y > box.y + box.h + pad);
        if (out) {
          const who = ownerId(l);
          problems.push(`${who ? name(who) : `a .${l.getAttribute("class")?.split(" ")[0]}`} runs outside ${figureOf(svg)} (at ${Math.round(out[0] - box.x)}, ${Math.round(out[1] - box.y)})`);
        }
      }
    }
    put("line clipped", problems, ran, "no connectors or series lines");
  }

  // ---- label × line: text crossed by a line that isn't its own ----
  {
    const LINES = ".x-edge-line, .x-series-line, .x-fishbone-bone, .x-fishbone-spine, .x-journey-line, .x-wardley-move, [class*='x-struct']:is(path, line, polyline)";
    const problems: string[] = [];
    let ran = false;
    // A label drawn inside its own mark's shape (a rank number on a bump dot) sits on the lines
    // that mark belongs to by design.
    const onOwnDot = (t: SVGTextElement, lineOwner: string | null) => {
      const mark = t.closest("[data-id]");
      const id = mark?.getAttribute("data-id");
      if (!mark || !id || !lineOwner || !(els[id]?.related?.includes(lineOwner) || els[lineOwner]?.related?.includes(id))) return false;
      const r = rect(t);
      const c = new DOMPoint(r.x + r.w / 2, r.y + r.h / 2);
      return [...mark.querySelectorAll<SVGGeometryElement>("circle, rect, ellipse, path")].some((s) => {
        const inv = s.getScreenCTM()?.inverse();
        return !s.matches(HIT) && getComputedStyle(s).fill !== "none" && !!inv && s.isPointInFill(c.matrixTransform(inv));
      });
    };
    // The line is hidden where the label is when an opaque shape painted after it covers the glyphs.
    const covered = (t: SVGTextElement, line: Element, box: R) => {
      const corners = [
        [box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h],
      ].map(([x, y]) => new DOMPoint(x, y));
      const svg = t.closest("svg")!;
      for (const s of svg.querySelectorAll<SVGGeometryElement>("rect, circle, ellipse, path, polygon")) {
        if (!(line.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (!(s.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) || s.matches(HIT) || !shown(s)) continue;
        const style = getComputedStyle(s);
        if (style.fill === "none" || rgba(style.fill)[3] * parseFloat(style.fillOpacity || "1") * opacity(s) < 0.9) continue;
        const inv = s.getScreenCTM()?.inverse();
        if (inv && corners.every((c) => s.isPointInFill(c.matrixTransform(inv)))) return true;
      }
      return false;
    };
    for (const svg of document.querySelectorAll("svg.x-svg")) {
      const lines = [...svg.querySelectorAll<SVGGeometryElement>(LINES)]
        .filter((l) => shown(l) && getComputedStyle(l).stroke !== "none")
        .map((l) => ({ el: l, owner: ownerId(l), host: l.closest("[data-id]"), polys: polylines(l), half: strokeWidth(l) / 2 }));
      if (!lines.length) continue;
      for (const t of texts) {
        if (t.ownerSVGElement !== svg && t.closest("svg.x-svg") !== svg) continue;
        ran = true;
        const r = rect(t);
        // Glyph ink, not the line box: trim the ascender/descender space.
        const box = { x: r.x + 1, y: r.y + r.h * 0.2, w: Math.max(0, r.w - 2), h: r.h * 0.6 };
        const own = ownerId(t);
        // A note marker's number belongs to the elements it annotates (data-for lists them).
        const marks = t.closest(".x-note-marker")?.getAttribute("data-for")?.split(/\s+/) ?? [];
        for (const l of lines) {
          if ((own && l.owner === own) || (l.owner && marks.includes(l.owner)) || (l.host && l.host.contains(t)) || onOwnDot(t, l.owner)) continue;
          const b = { x: box.x - l.half, y: box.y - l.half, w: box.w + 2 * l.half, h: box.h + 2 * l.half };
          if (l.polys.some((p) => G.polylineHitsRect(p, b) >= 0) && !covered(t, l.el, box)) {
            const line = l.owner ? name(l.owner) : `.${l.el.getAttribute("class")?.split(" ")[0]}`;
            problems.push(`${words(t)} crossed by ${line}`);
          }
        }
      }
    }
    put("label × line", problems, ran, "no connectors, series lines or structure paths");
  }

  // ---- label overlap: two labels drawn over each other ----
  {
    const problems: string[] = [];
    let ran = false;
    const ink = (t: Element) => {
      const r = rect(t);
      return { x: r.x + 1, y: r.y + r.h * 0.2, w: Math.max(0, r.w - 2), h: r.h * 0.6 };
    };
    for (const svg of document.querySelectorAll("svg.x-svg")) {
      const list = texts.filter((t) => t.closest("svg.x-svg") === svg).map((t) => ({ t, box: ink(t), text: words(t) }));
      if (list.length > 1) ran = true;
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const shared = G.overlapArea(a.box, b.box);
          if (!shared) continue;
          // A halo drawn as a second copy of the same text underneath is one label.
          if (a.text === b.text && Math.abs(a.box.x - b.box.x) < 2 && Math.abs(a.box.y - b.box.y) < 2) continue;
          if (shared / Math.min(a.box.w * a.box.h || 1, b.box.w * b.box.h || 1) < 0.15) continue;
          problems.push(`"${a.text}" and "${b.text}" overlap`);
        }
    }
    put("label overlap", problems, ran, "fewer than two labels");
  }

  // ---- callout × line: an in-graph callout on a connector, or its leader across one it isn't about ----
  {
    const problems: string[] = [];
    let ran = false;
    const side = (p: number[], q: number[], r: number[]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    const cross = (a: number[], b: number[], c: number[], d: number[]) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
    for (const stage of document.querySelectorAll(".x-stage")) {
      const callouts = [...stage.querySelectorAll<HTMLElement>(".x-callout")].filter((c) => shown(c) && !c.classList.contains("is-covered"));
      const wires = [...stage.querySelectorAll<SVGGeometryElement>(".x-edge-line")].filter((l) => shown(l)).map((l) => ({ id: ownerId(l), polys: polylines(l) }));
      if (!callouts.length || !wires.length) continue;
      ran = true;
      for (const c of callouts) {
        const n = c.dataset.note ?? "?";
        const refs = (c.dataset.refs ?? "").split(/\s+/).filter(Boolean);
        const box = rect(c);
        for (const w of wires) if (w.polys.some((p) => G.polylineHitsRect(p, box) >= 0)) problems.push(`callout ${n} sits on ${name(w.id)}`);
        const line = stage.querySelector<SVGLineElement>(`.x-callout-line[data-note="${n}"]`);
        if (!line || !shown(line) || line.classList.contains("is-covered")) continue;
        const [a, z] = polylines(line)[0] ?? [];
        if (!a || !z) continue;
        // the leader's last 4px touch its target, where that target's own connectors attach
        const len = Math.hypot(z[0] - a[0], z[1] - a[1]) || 1;
        const b = [z[0] - ((z[0] - a[0]) * 4) / len, z[1] - ((z[1] - a[1]) * 4) / len];
        for (const w of wires) {
          if (w.id && refs.includes(w.id)) continue;
          if (w.polys.some((p) => p.some((q, i) => i > 0 && cross(a, b, p[i - 1], q)))) problems.push(`callout ${n}'s leader crosses ${name(w.id)}`);
        }
      }
    }
    put("callout × line", problems, ran, "no in-graph callouts beside connectors");
  }

  // ---- text size: nothing renders below the minimum, svg text measured after the figure's scale ----
  {
    const MIN = 13;
    const problems: string[] = [];
    for (const t of texts) {
      const ctm = t.getScreenCTM();
      const px = parseFloat(getComputedStyle(t).fontSize) * (ctm ? Math.hypot(ctm.a, ctm.b) : 1);
      if (px < MIN - 0.25) problems.push(`"${words(t)}" in ${figureOf(t.closest("svg") ?? t)} renders at ${px.toFixed(1)}px`);
    }
    const scope = ".x-content, .x-pop, .x-detail, .x-reading, .x-callouts";
    for (const el of document.querySelectorAll<HTMLElement>(`:is(${scope}) *`)) {
      if (el instanceof SVGElement || el.closest("svg") || !shown(el)) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < MIN - 0.25) problems.push(`"${words(el)}" renders at ${px.toFixed(1)}px`);
    }
    put("text size", problems.slice(0, 12).concat(problems.length > 12 ? [`…and ${problems.length - 12} more`] : []), true);
  }

  // ---- figure wider than column ----
  {
    const problems: string[] = [];
    const column = document.querySelector<HTMLElement>(".x-content") ?? document.querySelector<HTMLElement>(".x-page");
    if (!column) put("figure wider than column", [], false, "no .x-content column");
    else {
      const cs = getComputedStyle(column);
      const width = column.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      // A child can overflow while its parents report their own width (a board grid wider than the stage).
      const reach = (el: HTMLElement) => {
        const left = el.getBoundingClientRect().left;
        let w = Math.max(el.scrollWidth, el.getBoundingClientRect().width);
        for (const d of el.querySelectorAll<HTMLElement>("*")) {
          if (d.closest("svg") || !d.getClientRects().length) continue;
          const r = d.getBoundingClientRect();
          w = Math.max(w, r.right - left, r.left - left + d.scrollWidth);
        }
        return Math.round(w);
      };
      for (const el of column.querySelectorAll<HTMLElement>(".x-figure, .x-stage, .x-block")) {
        if (!shown(el)) continue;
        const w = reach(el);
        if (w > width + 1) problems.push(`${figureOf(el)} is ${w}px wide; the column is ${Math.round(width)}px`);
      }
      if (html.scrollWidth > innerWidth + 1) problems.push(`the page scrolls sideways: ${html.scrollWidth}px in a ${innerWidth}px window`);
      put("figure wider than column", problems, true);
    }
  }

  // ---- selection ----
  const selChecks = ["card covers selected", "card covers related", "related undimmed", "dimmed contrast", "ring", "relation wording"];
  if (!opts.sel) {
    for (const n of selChecks) if (n !== "dimmed contrast") put(n, [], false, "no selected state to test");
  } else {
    const sel = opts.sel;
    const info = els[sel];
    // The selected mark itself. A block or its notes layer can carry the same id (a figure named after
    // its main node), so elements the client marked selected win over anything else with that id.
    const candidates = byId(sel).filter((el) => !el.closest(".x-prose, .x-pop, .x-detail, .x-reading, .x-callouts") && shown(el));
    const marked = candidates.filter((el) => el.classList.contains("is-selected"));
    const selected = marked.length ? marked : candidates.filter((el) => !el.matches(".x-block, .x-read, [data-figure], .x-notes, .x-note-marker"));
    const lit = document.querySelectorAll(".is-selected").length > 0;
    const pops = [...document.querySelectorAll<HTMLElement>(".x-pop")].filter(shown);
    const fig = selected[0]?.closest("[data-figure]");
    const card =
      pops.find((p) => fig && (fig.contains(p) || p.closest(".x-stage")?.contains(fig) || p.getAttribute("data-for") === fig.getAttribute("data-figure"))) ??
      pops[0] ??
      [...document.querySelectorAll<HTMLElement>(".x-detail:not([data-placement]):not([hidden])")].find(shown) ??
      null;
    const noCard = !lit ? `sel=${sel} selected nothing` : "no card opened";
    if (!selected.length || !lit) {
      const why = !selected.length ? `sel=${sel}: no visible element has that id` : `sel=${sel} selected nothing`;
      for (const n of ["card covers selected", "card covers related", "ring"]) put(n, [why]);
    } else if (!card) {
      put("card covers selected", [], false, noCard);
      put("card covers related", [], false, noCard);
    } else {
      const cr = rect(card);
      const own = selected.flatMap(footprint);
      const hidden = G.coverage(cr, own);
      put("card covers selected", hidden > 0.002 ? [`the card hides ${Math.max(1, Math.round(hidden * 100))}% of ${name(sel)}`] : []);
      const related = [...document.querySelectorAll(".is-related")].filter(
        (el) => !el.closest(".x-prose, .x-pop, .x-detail, .x-reading") && !card.contains(el) && !el.parentElement?.closest(".is-related") && shown(el),
      );
      if (!related.length) put("card covers related", [], false, "the selection lights up nothing else");
      else {
        const parts = related.flatMap(footprint);
        const share = G.coverage(cr, parts);
        const hiddenBy = new Map<string, number>();
        for (const el of related) {
          const c = G.coverage(cr, footprint(el));
          const who = name(ownerId(el));
          if (c >= 0.2) hiddenBy.set(who, Math.max(c, hiddenBy.get(who) ?? 0));
        }
        const worst = [...hiddenBy.entries()].sort((a, b) => b[1] - a[1]).map(([who, c]) => `${who} ${Math.round(c * 100)}%`);
        put(
          "card covers related",
          share > 0.25 ? [`the card hides ${Math.round(share * 100)}% of what ${name(sel)} relates to (max 25%)${worst.length ? `: ${worst.join(", ")}` : ""}`] : [],
        );
      }
    }

    // related undimmed: the model's relations and context stay at full strength
    {
      const ids = new Set<string>([...(info?.related ?? []), ...(info?.context ?? [])]);
      if (info?.type === "edge") [info.from, info.to].forEach((i: string) => i && ids.add(i));
      if (info?.type === "group") (info.members ?? []).forEach((m: string) => ids.add(m));
      if (info?.type === "node")
        for (const e of Object.values(els) as any[]) {
          if (e.type !== "edge") continue;
          if (e.from === sel && e.to) ids.add(e.id).add(e.to);
          if (e.to === sel && e.from) ids.add(e.id).add(e.from);
        }
      ids.delete(sel);
      const problems: string[] = [];
      for (const id of ids)
        for (const el of byId(id)) {
          if (el.closest(".x-pop, .x-detail") || !shown(el)) continue;
          if (el.closest(".is-dimmed")) {
            problems.push(`${name(id)} relates to ${name(sel)} but is dimmed`);
            break;
          }
        }
      if (!info) put("related undimmed", [], false, `sel=${sel} has no model entry`);
      else put("related undimmed", problems, ids.size > 0, ids.size ? undefined : "the selection has no relations");
    }

    // ring: the selection wears ink, not the accent it has at rest. With the ring layer every
    // selection is checked; without it only a focal selection can be judged (it is invisible
    // when it keeps the accent it already has at rest).
    if (selected.length && lit) {
      const problems: string[] = [];
      const host = selected[0];
      const focal = selected.some((el) => el.closest('[data-focal="true"]') || el.querySelector('[data-focal="true"]'));
      const svg = host.closest("svg");
      const layer = svg?.querySelector(".x-sel-layer");
      // An HTML selection (a card, a cell) is judged once the page has the ink-ring client.
      const judged = focal || !!layer || (!svg && !!document.querySelector(".x-sel-layer"));
      if (!judged) put("ring", [], false, "no .x-sel-layer, and the selection isn't focal");
      else if (layer) {
        // Hover and compare variants share the layer; only the selection's own ring counts.
        const rings = [...layer.querySelectorAll<SVGGraphicsElement>(".x-sel-ring:not(.x-ring-hover, .x-ring-cmp)")].filter(shown);
        const strokeOf = (el: SVGGraphicsElement) => paint(el, getComputedStyle(el).stroke, parseFloat(getComputedStyle(el).strokeOpacity || "1"));
        // Rects, circles and the outline of a filled path are ink. A line (series, connector) is
        // selected by a heavier clone in its own hue over a bg halo, so it is judged by the halo and its contrast.
        const ink = rings.filter((r) => !r.matches(".x-sel-clone"));
        const clones = rings.filter((r) => r.matches(".x-sel-clone"));
        if (!rings.length) problems.push(`${name(sel)} is selected but .x-sel-layer has no visible .x-sel-ring`);
        else if (ink.length) {
          const ring = strokeOf(ink[0]);
          const ratio = G.contrastRatio(G.composite(ring, pageBg), pageBg);
          if (ratio < 3) problems.push(`the ring around ${name(sel)} is ${ratio.toFixed(2)}:1 on the background, needs 3:1`);
          if (same(ring, accent)) problems.push(`the ring around ${name(sel)} is the accent colour; selection must be ink`);
        } else {
          if (![...layer.querySelectorAll(".x-sel-halo:not(.x-ring-hover, .x-ring-cmp)")].some(shown))
            problems.push(`the selected line ${name(sel)} has no .x-sel-halo, so it doesn't stand off the lines it crosses`);
          const ratio = G.contrastRatio(G.composite(strokeOf(clones[0]), pageBg), pageBg);
          if (ratio < 3) problems.push(`the selected line ${name(sel)} is ${ratio.toFixed(2)}:1 on the background, needs 3:1`);
        }
      } else if (!(host instanceof SVGElement)) {
        const s = getComputedStyle(host);
        const ratio = G.contrastRatio(G.composite(paint(host, s.outlineColor), pageBg), pageBg);
        if (s.outlineStyle === "none" || parseFloat(s.outlineWidth) < 1.5) problems.push(`${name(sel)} shows no outline when selected`);
        else if (ratio < 3) problems.push(`the outline of ${name(sel)} is ${ratio.toFixed(2)}:1, needs 3:1`);
      } else {
        const shape = [...host.querySelectorAll<SVGGraphicsElement>(".x-node-box, .x-mark-shape, .x-edge-line, .x-series-line")].find(shown) ?? (host as SVGGraphicsElement);
        const s = getComputedStyle(shape);
        const stroke = s.stroke === "none" ? null : paint(shape, s.stroke, parseFloat(s.strokeOpacity || "1"));
        if (!stroke || same(stroke, accent))
          problems.push(`selecting the focal ${name(sel)} is invisible: no ring layer, and it keeps the accent it has at rest`);
      }
      if (judged) put("ring", problems);
    }

    // relation wording: rows read "verb → Target", never both endpoints
    if (card) {
      // Relation chips in the card's relation groups, or the older one-button rows. The title, the
      // breadcrumb and fact chips name one thing each, so they aren't relation rows.
      const rows = [...card.querySelectorAll<HTMLElement>(".x-pop-rel [data-ref], .x-pop-rows [data-ref], .x-link-row[data-ref]")];
      const problems: string[] = [];
      const self = info?.type === "edge" ? null : name(sel);
      for (const r of rows) {
        const target = r.getAttribute("data-ref")!;
        // A chip reads with its group header ("Blocks · Public launch"); an older row is one button.
        // a one-part relation is a row: its words in the dt, the part in the dd
        const group = r.closest(".x-pop-rel");
        const row = r.closest(".x-pop-rows .x-pop-fact");
        const text = group ? `${group.querySelector(".x-pop-k")?.textContent ?? ""} ${r.textContent ?? ""}`
          : row ? `${row.querySelector("dt")?.textContent ?? ""} ${r.textContent ?? ""}` : (r.closest("li") ?? r).textContent ?? "";
        if (self && G.repeatsEndpoints(text, self, name(target))) problems.push(`the row "${words(text, 60)}" repeats both ends; write "verb → ${name(target)}"`);
      }
      put("relation wording", problems, rows.length > 0, rows.length ? undefined : "the card has no relation rows");
    } else put("relation wording", [], false, noCard);
  }

  // ---- dimmed contrast: dimmed text stays readable ----
  {
    const dimmed = [...document.querySelectorAll(".is-dimmed")];
    if (!dimmed.length) put("dimmed contrast", [], false, "nothing is dimmed");
    else {
      const problems: string[] = [];
      const behind = (t: Element): [number, number, number] => {
        let bg: [number, number, number] = pageBg;
        const chain: Element[] = [];
        for (let e = t instanceof SVGElement ? t.closest("svg")?.parentElement ?? null : t; e && e !== html; e = e.parentElement) chain.unshift(e);
        for (const e of chain) {
          const c = paint(e, getComputedStyle(e).backgroundColor);
          if (c[3] > 0) bg = G.composite(c, bg);
        }
        if (t instanceof SVGElement) {
          const svg = t.closest("svg")!;
          const r = rect(t);
          const pt = new DOMPoint(r.x + r.w / 2, r.y + r.h / 2);
          for (const s of svg.querySelectorAll<SVGGeometryElement>("rect, circle, ellipse, path, polygon")) {
            if (!(s.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) || s.contains(t)) continue;
            if (s.matches(HIT) || s.closest("defs, marker, mask, clipPath") || !shown(s)) continue;
            const style = getComputedStyle(s);
            if (style.fill === "none") continue;
            const ctm = s.getScreenCTM();
            if (!ctm || !s.isPointInFill(pt.matrixTransform(ctm.inverse()))) continue;
            const c = paint(s, style.fill, parseFloat(style.fillOpacity || "1"));
            if (c[3] > 0) bg = G.composite(c, bg);
          }
        }
        return bg;
      };
      const seen = new Set<string>();
      const check = (el: Element, fg: [number, number, number, number]) => {
        const bg = behind(el);
        const ratio = G.contrastRatio(G.composite(fg, bg), bg);
        const label = words(el);
        if (ratio < 3 && !seen.has(label)) {
          seen.add(label);
          problems.push(`"${label}" is ${ratio.toFixed(2)}:1 while dimmed, needs 3:1`);
        }
      };
      for (const t of texts) {
        if (!t.closest(".is-dimmed")) continue;
        const s = getComputedStyle(t);
        if (s.fill === "none") continue;
        check(t, paint(t, s.fill, parseFloat(s.fillOpacity || "1")));
      }
      for (const d of dimmed) {
        if (d instanceof SVGElement) continue;
        for (const el of [d, ...d.querySelectorAll("*")]) {
          if (el instanceof SVGElement || !shown(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue;
          check(el, paint(el, getComputedStyle(el).color));
        }
      }
      put("dimmed contrast", problems);
    }
  }
  return out;
}

/** Clicks the first element of every selectable type and checks what happens. */
export async function interact(): Promise<Outcome> {
  const model = JSON.parse(document.getElementById("x-model")?.textContent || "{}");
  const els: Record<string, any> = model.elements ?? {};
  const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").toLowerCase();
  const shown = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const edges = Object.values(els).filter((e: any) => e.type === "edge");
  const degree = (id: string) => edges.filter((e: any) => e.from === id || e.to === id).length;
  const TYPES: [string, string][] = [
    ["node", ".x-node"],
    ["edge", ".x-edge"],
    ["edge label", ".x-edge-label[data-for]"],
    ["card", ".x-card[data-id]"],
    ["structure box", ".x-struct-box[data-id]"],
    ["structure row", ".x-struct-col[data-id]"],
    ["mark", ".x-mark[data-id]:not(.x-card, .x-struct-box, .x-struct-col)"],
    ["legend item", ".x-legend-item[data-id]"],
    ["group label", ".x-group[data-id] .x-group-label"],
    ["table row", "tbody tr[data-ref] > th"],
    ["table column", "thead th[data-col]"],
    ["compare item", ".x-compare-item[data-id]"],
  ];
  const idOf = (el: Element) => {
    const host = el.closest("[data-ref],[data-for],[data-id],[data-col]");
    return host?.getAttribute("data-for") ?? host?.getAttribute("data-ref") ?? host?.getAttribute("data-id") ?? host?.getAttribute("data-col") ?? null;
  };
  const problems: string[] = [];
  const picked = new Set<Element>();
  const api = (window as unknown as { explainer?: { select(id: string | null): void } }).explainer;
  for (const [type, selector] of TYPES) {
    let list = [...document.querySelectorAll(selector)].filter((el) => shown(el) && !picked.has(el) && !el.closest(".x-prose"));
    if (type === "node") list = list.sort((a, b) => degree(a.getAttribute("data-id") ?? "") - degree(b.getAttribute("data-id") ?? ""));
    const el = list[0];
    if (!el) continue;
    picked.add(el);
    const id = idOf(el);
    if (!id) continue;
    api?.select(null);
    await settle();
    const target = el.matches("th, td, tr") ? el : el.querySelector(".x-edge-hit, .x-line-hit, .x-node-box, .x-mark-shape") ?? el;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    await settle();
    const what = `${type} ${els[id]?.label ?? id}`;
    const selected = document.querySelector(".is-selected");
    if (!selected) {
      problems.push(`clicking the ${what} selected nothing`);
      continue;
    }
    const fig = el.closest(".x-figure");
    if (fig) {
      const idle = [...fig.querySelectorAll(".x-node, .x-edge, .x-mark, .x-group")].find(
        (x) => shown(x) && !x.closest(".is-selected, .is-related, .is-context, .is-cmp, .is-dimmed") && !x.querySelector(".is-selected, .is-related, .is-context"),
      );
      if (idle) problems.push(`selecting the ${what} left ${idOf(idle)} neither lit nor dimmed`);
    }
    const info = els[id];
    if (!info) problems.push(`the ${what} has no entry in the page model, so its card is empty`);
    else {
      const cards = [...document.querySelectorAll(".x-pop, .x-detail:not([data-placement]):not([hidden]), [data-detail]")].filter(shown);
      const text = norm(cards.map((c) => c.textContent).join(" "));
      const names = info.type === "edge" ? [els[info.from]?.label, els[info.to]?.label, info.label].filter(Boolean) : [info.label];
      // A connector with nothing to add (no about, facts or relations beyond its ends) opens no card on purpose.
      const silent = info.type === "edge" && !info.about && !info.facts?.length && !info.links?.length;
      if (silent) { /* the ring and the dimming answer the click; no card is expected */ }
      else if (!cards.length) problems.push(`clicking the ${what} opened no card`);
      else if (!names.some((n: string) => text.includes(norm(n)))) problems.push(`the card for the ${what} doesn't name it`);
    }
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    await settle();
    if (document.querySelector(".is-selected")) problems.push(`Escape did not clear the ${what}`);
  }
  return picked.size ? { ran: true, problems } : { ran: false, problems, skip: "nothing on the page is selectable" };
}

function readColors(names: string[]): Record<string, number[] | null> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const out: Record<string, number[] | null> = {};
  for (const name of names) {
    const probe = document.createElement("i");
    probe.style.color = `var(--x-${name}, transparent)`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    out[name] = a ? [r!, g!, b!] : null;
  }
  return out;
}

function noScriptProblems(): string[] {
  const problems: string[] = [];
  const html = document.documentElement;
  // A bare document hides its prose on purpose; test what shows in the full view.
  if (html.dataset.view === "bare") html.dataset.view = "full";
  document.querySelectorAll(".x-svg").forEach((svg, i) => {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) problems.push(`figure ${svg.closest("[data-figure]")?.getAttribute("data-figure") ?? i + 1} has no size`);
  });
  const exempt =
    "[data-detail], .x-steps-bar, .x-controls, .x-widget, .x-pop, .x-tip, .x-sel-layer, .x-on-sel, .x-on-rel, .x-on-hover, script, style, template, noscript, defs, title, desc, marker";
  // Buttons do nothing without JavaScript, so hiding them then is right (Copy CSV, step keys).
  const hidden: Element[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest(exempt) || el.closest("button") || hidden.some((h) => h.contains(el))) continue;
    const style = getComputedStyle(el);
    if (!el.hasAttribute("hidden") && style.display !== "none" && style.visibility !== "hidden") continue;
    hidden.push(el);
    const id = el.getAttribute("data-id") ?? el.getAttribute("data-block");
    problems.push(`${el.localName}${el.classList.length ? `.${[...el.classList].join(".")}` : ""}${id ? `[${id}]` : ""} is hidden without JavaScript`);
  }
  return problems;
}
