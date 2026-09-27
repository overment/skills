// Client runtime: state + URL hash, state tiers and selection rings, the in-figure card, prose linking,
// the reading panel, steps and stories, keyboard, tooltips, theme, widgets.
import type { DocModel, ElementInfo, Mode, SceneSpec, StoryStep, View } from "../engine/types.ts";
import { crosses, dockColumn, GUTTER, leader, LEADER_MAX, nearest, place, placeCallouts, WEIGHT, type CalloutItem, type Obstacle, type Rect } from "./place.ts";
import { composite, pickInk, saturate, type Rgb, type Rgba } from "./ink.ts";
import { cardData, compareData, h, renderCallout, renderCard, renderCompare, type CardExtras } from "./popover.ts";

export interface State {
  sel: string | null;
  cmp: string | null;      // second element in compare mode
  hide: string[];          // series or group ids hidden through the legend
  range: string | null;    // brush: "<figure>,<from>,<to>" in the brush host's data units
  hover: string | null;
  scene: string | null;
  step: number;
  theme: Mode | null;
  view: View | null;
}
export type Dir = "up" | "down" | "left" | "right";
export interface Frame { active: string | null; done: string[]; edges: string[]; note: string | null; count: string }
export interface StoryFrame { sel: string | null; cmp: string | null; note: string | null; count: string }
export type Widget = (el: HTMLElement, api: Explainer) => void | (() => void);
export interface Explainer {
  model: DocModel;
  get(): State;
  set(patch: Partial<State>): void;
  on(fn: (s: State, prev: State) => void): () => void;
  register(name: string, fn: Widget): void;
  select(id: string | null): void;
  scene(id: string | null, step?: number): void;
}
/** A scene built from a block's `story:` (blocks.ts adds `story`; path holds the step ids). */
type Scene = SceneSpec & { figure: string; edges: string[]; story?: StoryStep[] };

declare global {
  interface Window { explainer: Explainer }
}

const VEC: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const CONE = Math.tan(Math.PI / 6); // ±30° either side = 60° cone
const HASH_KEYS = ["sel", "cmp", "hide", "range", "scene", "step", "theme", "view", "capture"];

// ---------- pure ----------

/** True when the hash carries state; a bare "#heading" anchor carries none and must leave state alone. */
export function isStateHash(hash: string): boolean {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  return HASH_KEYS.some((k) => p.has(k));
}

export function parseHash(hash: string): Partial<State> & { capture?: boolean } {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const out: Partial<State> & { capture?: boolean } = {};
  const sel = p.get("sel"), cmp = p.get("cmp"), scene = p.get("scene"), step = Number(p.get("step")), theme = p.get("theme");
  if (sel) out.sel = sel;
  if (cmp) out.cmp = cmp;
  const hide = (p.get("hide") ?? "").split(",").filter(Boolean);
  if (hide.length) out.hide = hide;
  const range = p.get("range");
  if (range && /^[^,]+,[^,]+,[^,]+$/.test(range)) out.range = range;
  if (scene) out.scene = scene;
  if (p.has("step") && Number.isInteger(step) && step >= 0) out.step = step;
  if (theme === "light" || theme === "dark") out.theme = theme;
  const view = p.get("view");
  if (view === "bare" || view === "full") out.view = view;
  if (p.get("capture") === "1") out.capture = true;
  return out;
}

export function serializeHash(s: State, capture = false): string {
  const p = new URLSearchParams();
  if (s.sel) p.set("sel", s.sel);
  if (s.cmp) p.set("cmp", s.cmp);
  if (s.hide?.length) p.set("hide", s.hide.join(","));
  if (s.range) p.set("range", s.range);
  if (s.scene) {
    p.set("scene", s.scene);
    if (s.step > 0) p.set("step", String(s.step));
  }
  if (s.theme) p.set("theme", s.theme);
  if (s.view) p.set("view", s.view);
  if (capture) p.set("capture", "1");
  const q = p.toString().replace(/%2C/g, ",");
  return q ? `#${q}` : "";
}

const edgesOf = (model: DocModel) => Object.values(model.elements).filter((e) => e.type === "edge");

/** Everything that lights up at full strength with `id`: connectors and their ends, members, `related`, `links`. */
export function related(model: DocModel, id: string): Set<string> {
  const out = new Set([id]);
  const el = model.elements[id];
  if (el?.type === "edge") {
    if (el.from) out.add(el.from);
    if (el.to) out.add(el.to);
  } else if (el?.type === "group") {
    const members = new Set(el.members ?? []);
    members.forEach((m) => out.add(m));
    for (const e of edgesOf(model)) if (members.has(e.from ?? "") && members.has(e.to ?? "")) out.add(e.id);
  } else if (el?.type === "node") {
    for (const e of edgesOf(model)) {
      if (e.from === id && e.to) out.add(e.id).add(e.to);
      else if (e.to === id && e.from) out.add(e.id).add(e.from);
    }
  }
  // Blocks without connectors (charts, boards, tables) name what belongs with an element.
  el?.related?.forEach((r) => out.add(r));
  el?.links?.forEach((l) => l.ids.forEach((r) => out.add(r)));
  return out;
}

/** Tier-2 ids: they keep their rest look (never dimmed) while `id` is selected. */
export function contextOf(model: DocModel, id: string): string[] {
  return model.elements[id]?.context ?? [];
}

export function sceneFrame(model: DocModel, sceneId: string, step: number): Frame {
  const sc = model.scenes[sceneId];
  const n = sc?.path.length ?? 0;
  if (!n) return { active: null, done: [], edges: [], note: null, count: "" };
  const k = Math.max(0, Math.min(n - 1, Math.floor(step) || 0));
  const joins = (id: string, a: string, b: string) => model.elements[id]?.from === a && model.elements[id]?.to === b;
  const edges: string[] = [];
  for (let i = 0; i < k; i++) {
    const a = sc.path[i], b = sc.path[i + 1];
    const e = sc.edges.find((x) => joins(x, a, b)) ?? sc.edges.find((x) => joins(x, b, a));
    if (e && !edges.includes(e)) edges.push(e);
  }
  const active = sc.path[k];
  return { active, done: sc.path.slice(0, k), edges, note: sc.notes?.[active] ?? null, count: `${k + 1} / ${n}` };
}

/** One step of a `story:`: what it selects and compares, and its note. Null for a scene without a story. */
export function storyFrame(model: DocModel, sceneId: string, step: number): StoryFrame | null {
  const story = (model.scenes[sceneId] as Scene | undefined)?.story;
  if (!story?.length) return null;
  const k = Math.max(0, Math.min(story.length - 1, Math.floor(step) || 0));
  const s = story[k];
  return { sel: s.sel, cmp: s.cmp ?? null, note: s.note ?? null, count: `${k + 1} / ${story.length}` };
}

export function pickNeighbor(from: { x: number; y: number }, candidates: { id: string; x: number; y: number }[], dir: Dir): string | null {
  const [vx, vy] = VEC[dir];
  let best: string | null = null, bestScore = Infinity;
  for (const c of candidates) {
    const dx = c.x - from.x, dy = c.y - from.y;
    const along = dx * vx + dy * vy, across = Math.abs(dx * vy - dy * vx);
    if (along <= 0 || across > along * CONE) continue;
    const score = Math.hypot(dx, dy) + across * 2;
    if (score < bestScore) { bestScore = score; best = c.id; }
  }
  return best;
}

/**
 * Arrow order from engine `data-nav="row,col"`: ←→ move along the row, ↑↓ along the column. When the
 * exact column has no neighbour, ↑↓ go to the nearest row in that direction, closest column first.
 */
export function navNeighbor(from: [number, number], candidates: { id: string; nav: [number, number] }[], dir: Dir): string | null {
  const [r, c] = from;
  const along = dir === "left" || dir === "right";
  const sign = dir === "right" || dir === "down" ? 1 : -1;
  let best: string | null = null, bestKey = [Infinity, Infinity];
  for (const x of candidates) {
    const [xr, xc] = x.nav;
    const d = along ? (xc - c) * sign : (xr - r) * sign;
    if (d <= 0) continue;
    if (along && xr !== r) continue;
    const key = along ? [d, 0] : [xc === c ? 0 : 1, d * 1000 + Math.abs(xc - c)];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = x.id; bestKey = key; }
  }
  return best;
}

/** "a b" and "a+b" ref lists → ids. */
export function refIds(v: string | null | undefined): string[] {
  return (v ?? "").split(/[\s+]+/).filter(Boolean);
}

/** The say line for aria-live and the tooltip: the engine's `say`, else label, value and the first fact. */
export function sayLine(el: ElementInfo | undefined, fallback = ""): string {
  if (!el) return fallback;
  if (el.say) return el.say;
  if (fallback) return fallback;
  return [el.type === "edge" ? el.label || el.id : el.label, el.value, el.facts?.[0]?.v].filter(Boolean).join(" · ");
}

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A brush value: a number as is, an ISO date as days since 1970 (so dates and numbers share one scale). */
export function brushValue(v: string): number {
  return ISO.test(v) ? Date.parse(`${v}T00:00:00Z`) / DAY : Number(v);
}

/** Back to the host's own kind of value: an ISO date when its domain is dates, else a number rounded to the domain. */
export function brushLabel(v: number, dates: boolean, whole: boolean): string {
  if (dates) return new Date(Math.round(v) * DAY).toISOString().slice(0, 10);
  return String(whole ? Math.round(v) : Math.round(v * 100) / 100);
}

/**
 * The span an element covers on a brush axis: `data-at="v"` (a point), `data-at="a..b"` (b exclusive) or
 * `data-span="a b"`. Null when it has none.
 */
export function brushSpan(at: string | null, span: string | null): [number, number] | null {
  const raw = at ?? span;
  if (!raw) return null;
  const [a, b] = raw.includes("..") ? raw.split("..") : raw.trim().split(/\s+/);
  const lo = brushValue(a), hi = b === undefined ? lo : brushValue(b) - (raw.includes("..") ? 1e-9 : 0);
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/** Comma-separated values for the reading panel's Copy CSV. */
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}

// ---------- DOM ----------

const RANK: Record<string, number> = { "is-selected": 5, "is-step-active": 5, "is-cmp": 4, "is-related": 3, "is-step-done": 3, "is-context": 2 };
const MARKS = [...Object.keys(RANK), "is-dimmed", "is-hidden", "is-off"];
const NOT_EL = ".x-block,.x-figure,.x-legend-item,section,.x-steps,.x-reading,.x-read";
// Every element with an id the client can light: `.x-mark` is the hook every block beyond the grid figure uses.
const INDEXED = `.x-node,.x-edge,.x-group,.x-edge-label,.x-lifeline,.x-mark,.x-legend-item[data-id],[data-ref],[data-col],[data-id]:not(${NOT_EL})`;
const DIMMABLE = `.x-node,.x-edge,.x-edge-label,.x-group,.x-mark,.x-card,.x-compare-item,.x-matrix th[data-col],.x-matrix td[data-col],.x-matrix tbody tr[data-ref],[data-id]:not(${NOT_EL},.x-matrix *)`;
const HIT = ".x-node,.x-edge,.x-edge-label,.x-group-label,.x-group-hit,.x-mark,.x-legend-item[data-id],.x-ref,th[data-ref],tbody tr[data-ref]>th,.x-compare-item,.x-chip[data-ref],.x-crumb[data-ref],.x-card[data-id]";
const NOT_ANCHOR = ".x-legend-item,.x-ref,.x-sent,.x-edge-label,.x-chip,.x-crumb,.x-reading *,.x-pop *";
const RING_SHAPE = ".x-mark-shape,.x-node-box,.x-edge-line,.x-group-box,.x-series-line";
const RINGABLE = ".x-mark,.x-node,.x-edge,.x-group";
const HOOKS = ".x-on-sel,.x-on-rel,.x-on-hover";
/** The painted part of a mark: its first ring shape outside the state hooks. */
const shapeOf = (el: Element): Element | null =>
  el.matches(RING_SHAPE) ? el : [...el.querySelectorAll(RING_SHAPE)].find((s) => !s.closest(HOOKS)) ?? null;
const ARROWS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const SVG_NS = "http://www.w3.org/2000/svg";
const BACK_MAX = 8;
const LEAVE_MS = 80;

type Ring = "sel" | "cmp" | "hover";

function idOf(t: EventTarget | null): string | null {
  const el = t instanceof Element ? t.closest(HIT) : null;
  if (!el) return null;
  if (el.matches(".x-edge-label")) return el.getAttribute("data-for");
  const host = el.closest("[data-ref],[data-id]");
  return host?.getAttribute("data-ref") ?? host?.getAttribute("data-id") ?? null;
}

function ns<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const shown = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
};

/** Screen boxes of an element's painted parts: lines become a string of small boxes along the path. */
function shapeRects(el: Element, cap = 40): DOMRect[] {
  if (!(el instanceof SVGElement)) return [el.getBoundingClientRect()];
  // State hooks count once they show: a selected bar's reference rule is part of what the selection displays.
  const shapes = el.matches(RING_SHAPE) ? [el] : [...el.querySelectorAll(`${RING_SHAPE}, ${HOOKS} :is(line, path, rect)`)].filter(shown).slice(0, 40);
  if (!shapes.length) return [el.getBoundingClientRect()];
  const out: DOMRect[] = [];
  for (const s of shapes) {
    if (s instanceof SVGGeometryElement && !(s instanceof SVGRectElement) && !(s instanceof SVGCircleElement) && getComputedStyle(s).fill === "none") {
      const m = s.getScreenCTM();
      const len = s.getTotalLength();
      const n = Math.min(cap, Math.max(2, Math.ceil(len / 18)));
      for (let i = 0; i <= n && m; i++) {
        const p = s.getPointAtLength((len * i) / n).matrixTransform(m);
        out.push(new DOMRect(p.x - 4, p.y - 4, 8, 8));
      }
    } else out.push(s.getBoundingClientRect());
  }
  return out;
}

/** Where the card and the leader point: `.x-anchor`, an edge's label, a line's end or middle, a bar's value end. */
function anchorRect(el: Element, id: string): DOMRect {
  const a = el.querySelector(".x-anchor");
  if (a && shown(a)) return a.getBoundingClientRect();
  const svg = el.closest("svg");
  if (el.matches(".x-edge") && svg) {
    const label = svg.querySelector(`.x-edge-label[data-for="${CSS.escape(id)}"]`);
    if (label && shown(label)) return label.getBoundingClientRect();
  }
  const s = shapeOf(el);
  // A series points at its end label when it has one: the name is what the card is about.
  const label = s?.matches(".x-series-line") ? [...el.querySelectorAll("text")].find((t) => !t.closest(HOOKS) && shown(t)) : null;
  if (label) return label.getBoundingClientRect();
  if (s instanceof SVGGeometryElement && !(s instanceof SVGRectElement) && !(s instanceof SVGCircleElement) && getComputedStyle(s).fill === "none") {
    const m = s.getScreenCTM(), len = s.getTotalLength();
    if (m && len) {
      const p = s.getPointAtLength(s.matches(".x-series-line") ? len : len / 2).matrixTransform(m);
      return new DOMRect(p.x - 4, p.y - 4, 8, 8);
    }
  }
  const r = (s ?? el).getBoundingClientRect();
  if (s instanceof SVGRectElement && r.width > 2.5 * r.height) return new DOMRect(r.right - 8, r.top, 8, r.height);
  if (s instanceof SVGRectElement && r.height > 2.5 * r.width) return new DOMRect(r.left, r.top, r.width, 8);
  return r;
}

/**
 * The mark's own labels, copied above its ring with their computed look, so a halo or ring drawn over a
 * filled shape never hides the text inside it. State hooks (.x-on-sel…) are left where they are.
 */
function liftText(svg: SVGSVGElement, el: Element, put: (n: SVGElement) => void): void {
  const vm = svg.getScreenCTM()?.inverse();
  for (const t of el.querySelectorAll<SVGTextElement>("text")) {
    const m = t.getScreenCTM();
    if (!vm || !m || t.closest(HOOKS) || !shown(t)) continue;
    const cs = getComputedStyle(t);
    const n = t.cloneNode(true) as SVGTextElement;
    n.removeAttribute("id");
    n.setAttribute("class", "x-sel-text");
    for (const k of ["fill", "font-family", "font-size", "font-weight", "letter-spacing", "text-transform", "font-variant-numeric"]) n.style.setProperty(k, cs.getPropertyValue(k));
    put(n);
    const x = vm.multiply(m);
    n.setAttribute("transform", `matrix(${[x.a, x.b, x.c, x.d, x.e, x.f].map((v) => Math.round(v * 1000) / 1000).join(" ")})`);
  }
}

/** Ring geometry for one mark, appended to `layer` in the svg's user space. */
function ring(svg: SVGSVGElement, layer: SVGGElement, el: Element, kind: Ring, gap: number): void {
  const shape = (shapeOf(el) ?? el) as SVGGraphicsElement;
  const sm = shape.getScreenCTM(), vm = svg?.getScreenCTM();
  if (!sm || !vm || !shown(shape)) return;
  const m = vm.inverse().multiply(sm);
  const transform = `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map((v) => Math.round(v * 1000) / 1000).join(" ")})`;
  // Ring variants use their own classes, so a query for .is-cmp or .is-hover only ever finds marks.
  const cls = kind === "sel" ? "" : ` x-ring-${kind}`;
  const put = (node: SVGElement) => { node.setAttribute("transform", transform); layer.append(node); };
  const cs = getComputedStyle(shape);
  const isLine = shape instanceof SVGGeometryElement && !(shape instanceof SVGRectElement) && !(shape instanceof SVGCircleElement) && !(shape instanceof SVGEllipseElement);
  if (isLine) {
    const sw = Number(/[\d.]+/.exec(cs.strokeWidth)?.[0] ?? 0); // may read "calc(3.5px)"
    const filled = cs.fill !== "none" && parseFloat(cs.fillOpacity) > 0 && !/,\s*0\)$/.test(cs.fill);
    const clone = (c: string, style: Record<string, string>) => {
      const n = shape.cloneNode(false) as SVGElement;
      for (const a of ["id", "class", "style", "tabindex", "role", "aria-label"]) n.removeAttribute(a);
      if (c === "x-sel-halo") for (const a of ["marker-start", "marker-mid", "marker-end"]) n.removeAttribute(a);
      n.setAttribute("class", c);
      for (const [k, v] of Object.entries(style)) n.style.setProperty(k, v);
      put(n);
    };
    if (kind === "hover") {
      if (filled) clone(`x-sel-outline${cls}`, { "stroke-width": "1px" });
      else clone("x-sel-clone", { fill: "none", stroke: cs.stroke, "stroke-width": `${sw + 1}px`, "stroke-dasharray": cs.strokeDasharray });
      return;
    }
    clone("x-sel-halo", { "stroke-width": `${sw + 6}px` });
    if (filled) {
      // Stroke only: the ring never repaints the shape, so the labels inside a band, sector or level stay put.
      clone(`x-sel-ring x-sel-outline${cls}`, {});
    } else {
      // A line stays in its hue, 1.5px heavier (3.5px for a 2px series), never thinner than it already is.
      clone(`x-sel-ring x-sel-clone${cls}`, {
        fill: "none", stroke: cs.stroke, "stroke-width": `${Math.min(sw + 1.5, Math.max(sw, 3.5))}px`,
        "stroke-dasharray": kind === "cmp" ? "6 3" : cs.strokeDasharray,
      });
    }
    liftText(svg, el, put);
    return;
  }
  const bb = shape.getBBox();
  if (shape instanceof SVGCircleElement) {
    const r = shape.r.baseVal.value + gap + 0.5;
    const at = { cx: shape.cx.baseVal.value, cy: shape.cy.baseVal.value, r };
    put(ns("circle", { ...at, class: `x-sel-under${cls}` }));
    put(ns("circle", { ...at, class: `x-sel-ring${cls}` }));
    return;
  }
  const rx = (parseFloat(shape.getAttribute("rx") ?? "") || parseFloat(cs.getPropertyValue("rx")) || 0) + gap;
  const at = { x: bb.x - gap, y: bb.y - gap, width: bb.width + 2 * gap, height: bb.height + 2 * gap, rx };
  put(ns("rect", { ...at, class: `x-sel-under${cls}` }));
  put(ns("rect", { ...at, class: `x-sel-ring${cls}` }));
  // A zone's name sits on its top border: lift the mask and the label above the ring.
  for (const part of el.matches(".x-group") ? el.querySelectorAll(".x-group-mask, .x-group-label") : []) {
    const n = part.cloneNode(true) as SVGElement;
    n.removeAttribute("id");
    put(n);
  }
}

export function boot(): void {
  const html = document.documentElement;
  html.dataset.js = "1";
  const $$ = <E extends Element = HTMLElement>(sel: string, root: ParentNode = document): E[] => [...root.querySelectorAll<E>(sel)];
  const src = document.getElementById("x-model")?.textContent;
  const model: DocModel = { elements: {}, scenes: {}, glossary: {}, ...(src ? JSON.parse(src) : {}) };
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const noHover = matchMedia("(hover: none)");
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Stages: every figure's svg or board sits in .x-stage > .x-scroll; the card and the leader overlay are
  // the stage's last children, so the scroller never clips them. Engines using kit get the stage at build time.
  for (const fig of $$(".x-figure")) {
    let stage = fig.querySelector<HTMLElement>(":scope > .x-stage");
    if (!stage) {
      stage = h("div", "x-stage");
      stage.append(...[...fig.children].filter((c) => !c.matches("figcaption")));
      fig.append(stage);
    }
    if (!stage.querySelector(":scope > .x-scroll")) {
      const scroll = h("div", "x-scroll");
      scroll.append(...stage.children);
      stage.append(scroll);
    }
  }

  const index = new Map<string, Element[]>();
  const add = (id: string | null, el: Element) => {
    if (!id) return;
    const list = index.get(id) ?? [];
    if (!list.includes(el)) list.push(el);
    index.set(id, list);
  };
  for (const el of $$<Element>(INDEXED)) {
    if (el.closest(".x-pop")) continue;
    add(el.getAttribute(el.matches(".x-edge-label,.x-lifeline") ? "data-for" : "data-id"), el);
    refIds(el.getAttribute("data-ref")).forEach((id) => add(id, el));
    add(el.getAttribute("data-cmp"), el);
    add(el.getAttribute("data-col"), el);
  }
  const sents = $$(".x-sent[data-refs]");

  // store
  let capture = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const readHash = (): Partial<State> => {
    const { capture: c, ...rest } = parseHash(location.hash);
    capture = !!c;
    if (capture) html.dataset.capture = "1";
    else delete html.dataset.capture;
    return rest;
  };
  const known = (id: string | null) => (id && (model.elements[id] || index.has(id)) ? id : null);
  const norm = (s: State): State => {
    const sc = s.scene ? model.scenes[s.scene] : undefined;
    const sel = known(s.sel);
    const cmp = sel && s.cmp !== sel ? known(s.cmp) : null;
    const step = sc ? Math.max(0, Math.min(sc.path.length - 1, Math.floor(s.step) || 0)) : 0;
    return { ...s, sel, cmp, hide: [...new Set(s.hide ?? [])], scene: sc ? s.scene : null, step };
  };
  const EMPTY: State = { sel: null, cmp: null, hide: [], range: null, hover: null, scene: null, step: 0, theme: null, view: null };
  let state = norm({ ...EMPTY, ...readHash() });
  const same = (a: State, b: State) =>
    (Object.keys(EMPTY) as (keyof State)[]).every((k) => (k === "hide" ? a.hide.join() === b.hide.join() : a[k] === b[k]));
  const subs = new Set<(s: State, prev: State) => void>();
  const set = (patch: Partial<State>) => {
    const prev = state, next = norm({ ...state, ...patch });
    if (same(next, prev)) return;
    state = next;
    subs.forEach((fn) => fn(next, prev));
  };

  // theme
  const themeOf = (s: State): Mode => {
    const d = html.dataset.themeDefault;
    return s.theme ?? (d === "light" || d === "dark" ? d : mq.matches ? "dark" : "light");
  };
  const applyTheme = (s: State) => {
    const t = themeOf(s);
    html.dataset.theme = t;
    $$(".x-toggle").forEach((b) => b.setAttribute("aria-pressed", String(t === "dark")));
  };
  mq.addEventListener("change", () => applyTheme(state));

  // view: bare shows diagrams and their interactions only; full adds header, prose, notes and the reading panel
  const viewOf = (s: State): View => s.view ?? (html.dataset.viewDefault === "bare" ? "bare" : "full");
  const applyView = (s: State) => {
    const v = viewOf(s);
    html.dataset.view = v;
    $$('[data-action="view"]').forEach((b) => {
      b.setAttribute("aria-pressed", String(v === "full"));
      b.textContent = v === "full" ? "Diagram only" : "With text";
    });
  };

  // ---------- tiers ----------
  const frameOf = (s: State) => {
    const story = s.scene ? storyFrame(model, s.scene, s.step) : null;
    const scene = s.scene && !story ? sceneFrame(model, s.scene, s.step) : null;
    return { story, scene, sel: story ? story.sel : scene ? null : s.sel, cmp: story ? story.cmp : scene ? null : s.cmp };
  };
  let marked: Element[] = [];
  const lit = new Map<Element, string>();
  const hiddenIds = (s: State) => {
    const out = new Set<string>();
    for (const id of s.hide) {
      out.add(id);
      model.elements[id]?.members?.forEach((m) => out.add(m));
    }
    return out;
  };
  const scopeOf = (el: Element): Element | null =>
    el.matches("tr") ? el.parentElement
      : el.matches("[data-col]") ? el.closest("table")
      : el.closest(".x-figure,.x-compare") ?? (el.closest(".x-prose,.x-reading") ? null : el.closest(".x-block"));
  const paint = (s: State) => {
    marked.forEach((el) => el.classList.remove(...MARKS));
    marked = [];
    lit.clear();
    const put = (id: string | null | undefined, cls: string) =>
      id && index.get(id)?.forEach((el) => {
        if (el.matches(".x-sent")) return;
        if ((RANK[lit.get(el) ?? ""] ?? 0) < RANK[cls]) lit.set(el, cls);
      });
    const { scene: f, sel, cmp } = frameOf(s);
    if (f?.active) {
      [...f.done, ...f.edges].forEach((id) => put(id, "is-step-done"));
      put(f.active, "is-step-active");
    } else if (sel) {
      contextOf(model, sel).forEach((id) => put(id, "is-context"));
      related(model, sel).forEach((id) => put(id, "is-related"));
      if (cmp) {
        related(model, cmp).forEach((id) => put(id, "is-related"));
        put(cmp, "is-cmp");
      }
      put(sel, "is-selected");
    }
    const range = !f?.active && !sel ? rangeOf(s) : null;
    if (range) for (const el of range.inside) lit.set(el, "is-related");
    const scopes = new Set<Element>();
    const holders = new Set<Element>();
    lit.forEach((cls, el) => {
      el.classList.add(cls);
      marked.push(el);
      const sc = scopeOf(el);
      if (sc) scopes.add(sc);
      for (let p = el.parentElement; p && !p.matches(".x-figure"); p = p.parentElement) holders.add(p);
    });
    if (range) scopes.add(range.figure);
    for (const sc of scopes) {
      for (const el of $$<Element>(DIMMABLE, sc)) {
        if (lit.has(el) || holders.has(el) || el.closest(".x-pop,.x-legend")) continue;
        el.classList.add("is-dimmed");
        marked.push(el);
      }
    }
    const hidden = hiddenIds(s);
    hidden.forEach((id) => index.get(id)?.forEach((el) => {
      el.classList.add(el.matches(".x-legend-item") ? "is-off" : "is-hidden");
      marked.push(el);
    }));
    const on = new Set([sel, cmp].filter(Boolean) as string[]);
    for (const el of sents) el.classList.toggle("is-linked", refIds(el.dataset.refs).some((id) => on.has(id)));
    for (const li of $$(".x-reading-note[data-refs]")) {
      const hit = refIds(li.dataset.refs).some((id) => on.has(id));
      li.classList.toggle("is-linked", hit);
      const aside = li.closest<HTMLElement>(".x-reading");
      // The panel scrolls itself to the note; the page never scrolls because of a graph click.
      if (hit && aside && aside.scrollHeight > aside.clientHeight) aside.scrollTop = li.offsetTop - aside.offsetTop - 8;
    }
    renderHidden(s);
    tintCallouts(s);
    drawRings();
    inkDimmed();
  };

  // ---------- dimmed labels keep 3:1 on whatever fill they sit on ----------
  // A label drawn on a mark's own fill (a heat cell, a tile, a level) sits on that fill once it is dimmed, not
  // on the canvas. Each dimmed label gets the quietest theme ink that still reads on the fill behind it,
  // computed from the colours, opacities and saturation the dimming settles on (not mid-transition).
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const colours = new Map<string, Rgba>();
  const rgba = (css: string): Rgba => {
    const hit = colours.get(css);
    if (hit || !probe) return hit ?? [0, 0, 0, 0];
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "rgba(0,0,0,0)";
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    const out: Rgba = [r, g, b, a / 255];
    colours.set(css, out);
    return out;
  };
  const CAMEL: Record<string, string> = { opacity: "opacity", filter: "filter", "fill-opacity": "fillOpacity", fill: "fill" };
  /** The value a property is heading to: a running transition's end, else the computed value. */
  const settled = (el: Element, prop: "opacity" | "filter" | "fill-opacity" | "fill"): string => {
    const now = getComputedStyle(el).getPropertyValue(prop);
    for (const a of el.getAnimations?.() ?? []) {
      if ((a as CSSTransition).transitionProperty !== prop || !(a.effect instanceof KeyframeEffect)) continue;
      const end = a.effect.getKeyframes().at(-1)?.[CAMEL[prop]];
      if (typeof end === "string") return end;
    }
    return now;
  };
  const chainOf = (el: Element, fn: (e: Element) => number) => {
    let v = 1;
    for (let e: Element | null = el; e; e = e.parentElement) v *= fn(e);
    return v;
  };
  const alphaOf = (el: Element) => chainOf(el, (e) => parseFloat(settled(e, "opacity")) || 0);
  const satOf = (el: Element) => chainOf(el, (e) => Number(/saturate\(([\d.]+)\)/.exec(settled(e, "filter"))?.[1] ?? 1));
  const paintOf = (el: Element, color: string, own: number): Rgba => {
    const c = rgba(color), s = satOf(el);
    const rgb: Rgb = s < 1 ? saturate([c[0], c[1], c[2]], s) : [c[0], c[1], c[2]];
    return [rgb[0], rgb[1], rgb[2], c[3] * own * alphaOf(el)];
  };
  let inked: SVGTextElement[] = [];
  const inkDimmed = () => {
    inked.forEach((t) => t.style.removeProperty("fill"));
    inked = [];
    const texts = $$<SVGTextElement>(".x-svg .is-dimmed text").filter((t) => !t.closest(".x-sel-layer") && shown(t));
    if (!texts.length) return;
    const root = getComputedStyle(html);
    const inks = ["--x-dim-text", "--x-text-dim", "--x-text", "--x-surface", "--x-bg"].map((v) => root.getPropertyValue(v).trim()).filter(Boolean);
    const page = rgba(getComputedStyle(document.body).backgroundColor);
    const shapes = new Map<SVGSVGElement, SVGGeometryElement[]>();
    for (const t of texts) {
      const svg = t.ownerSVGElement;
      if (!svg) continue;
      let list = shapes.get(svg);
      if (!list) {
        list = $$<SVGGeometryElement>("rect, circle, ellipse, path, polygon", svg).filter((sh) =>
          !sh.closest("defs, marker, mask, clipPath, .x-sel-layer") && !sh.matches(".x-edge-hit, .x-line-hit, .x-hit, .x-group-hit") && getComputedStyle(sh).fill !== "none" && shown(sh));
        shapes.set(svg, list);
      }
      const r = t.getBoundingClientRect();
      const at = new DOMPoint(r.x + r.width / 2, r.y + r.height / 2);
      let bg: Rgb = [page[0], page[1], page[2]];
      for (const sh of list) {
        if (!(sh.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
        const m = sh.getScreenCTM();
        if (!m || !sh.isPointInFill(at.matrixTransform(m.inverse()))) continue;
        const c = paintOf(sh, settled(sh, "fill"), parseFloat(settled(sh, "fill-opacity")) || 0);
        if (c[3] > 0) bg = composite(c, bg);
      }
      const own = parseFloat(settled(t, "fill-opacity")) || 0;
      const current = paintOf(t, getComputedStyle(t).fill, own);
      const options = [current, ...inks.map((c) => paintOf(t, c, own))];
      const i = pickInk(bg, options);
      if (i > 0) {
        t.style.setProperty("fill", inks[i - 1]);
        inked.push(t);
      }
    }
  };

  // hover preview: dashed rings on the element and its direct relations, a tooltip, no dimming
  let preview: string[] = [];
  let hovered: Element[] = [];
  const paintHover = (ids: string[]) => {
    hovered.forEach((el) => el.classList.remove("is-hover"));
    hovered = [];
    const all = new Set<string>();
    for (const id of ids) related(model, id).forEach((r) => all.add(r));
    for (const id of all) index.get(id)?.forEach((el) => {
      if (el.matches(".x-sent")) return;
      el.classList.add("is-hover");
      hovered.push(el);
    });
    preview = ids;
    drawRings();
  };

  // ---------- selection layer: ring clones, the brush band ----------
  const gapPx = () => parseFloat(getComputedStyle(html).getPropertyValue("--x-sel-gap")) || 3;
  const drawRings = () => {
    $$(".x-sel-layer").forEach((l) => l.remove());
    const layers = new Map<SVGSVGElement, SVGGElement>();
    const layerOf = (el: Element) => {
      const svg = el.closest("svg");
      if (!svg || !svg.matches(".x-svg, .x-stage svg")) return null;
      let layer = layers.get(svg);
      if (!layer) {
        layer = ns("g", { class: "x-sel-layer", "aria-hidden": "true" });
        layers.set(svg, layer);
      }
      return layer;
    };
    const gap = gapPx();
    const done = new Set<Element>();
    const draw = (el: Element, kind: Ring) => {
      if (done.has(el) || !el.matches(RINGABLE) || el.closest(".x-legend")) return;
      const layer = layerOf(el);
      if (!layer) return;
      done.add(el);
      ring(el.closest("svg")!, layer, el, kind, gap);
    };
    lit.forEach((cls, el) => {
      if (cls === "is-selected" || cls === "is-step-active") draw(el, "sel");
      else if (cls === "is-cmp") draw(el, "cmp");
    });
    // A hover ring previews; on what the selection already lights it would only add a second line.
    if (!capture) hovered.forEach((el) => !["is-selected", "is-cmp", "is-related", "is-step-active"].includes(lit.get(el) ?? "") && draw(el, "hover"));
    const r = rangeOf(state);
    if (r) {
      const layer = layerOf(r.host);
      if (layer) layer.append(ns("rect", { class: "x-brush-band", ...r.band }));
    }
    layers.forEach((layer, svg) => svg.append(layer));
  };

  // ---------- brush: drag across an svg element with data-brush; its x span maps onto
  // data-min..data-max (or data-domain="from to"), numbers or ISO dates ----------
  interface RangeHit { figure: Element; host: SVGGraphicsElement; inside: Element[]; band: { x: number; y: number; width: number; height: number }; count: string }
  const domainOf = (host: SVGGraphicsElement): [number, number, boolean] => {
    const [a, b] = host.dataset.min !== undefined ? [host.dataset.min, host.dataset.max ?? ""] : (host.dataset.domain ?? "0 1").split(/\s+/);
    return [brushValue(a), brushValue(b), ISO.test(a)];
  };
  const rangeOf = (s: State): RangeHit | null => {
    if (!s.range) return null;
    const [fid, a, b] = s.range.split(",");
    const figure = document.querySelector(`[data-figure="${CSS.escape(fid)}"]`);
    const host = figure?.querySelector<SVGGraphicsElement>("svg [data-brush]");
    if (!figure || !host) return null;
    const lo = Math.min(brushValue(a), brushValue(b)), hi = Math.max(brushValue(a), brushValue(b));
    const [d0, d1] = domainOf(host);
    const bb = host.getBBox();
    const px = (v: number) => bb.x + ((v - d0) / (d1 - d0 || 1)) * bb.width;
    const items = $$<Element>("[data-at],[data-span]", figure).filter((el) => el !== host && el.matches(INDEXED));
    const inside = items.filter((el) => {
      const span = brushSpan(el.getAttribute("data-at"), el.getAttribute("data-span"));
      return !!span && span[1] >= lo && span[0] <= hi;
    });
    return { figure, host, inside, band: { x: px(lo), y: bb.y, width: Math.max(1, px(hi) - px(lo)), height: bb.height }, count: `${inside.length} of ${items.length} in range` };
  };
  let brushed = false;
  document.addEventListener("pointerdown", (e) => {
    const host = (e.target as Element).closest?.<SVGGraphicsElement>("svg [data-brush]");
    const fig = host?.closest<HTMLElement>("[data-figure]");
    const m = host?.getScreenCTM();
    if (!host || !fig || !m || e.button !== 0) return;
    const inv = m.inverse();
    const at = (ev: PointerEvent) => new DOMPoint(ev.clientX, ev.clientY).matrixTransform(inv).x;
    const x0 = at(e);
    const bb = host.getBBox();
    const [d0, d1, dates] = domainOf(host);
    const val = (x: number) =>
      brushLabel(d0 + ((Math.min(Math.max(x, bb.x), bb.x + bb.width) - bb.x) / (bb.width || 1)) * (d1 - d0), dates, dates || (Number.isInteger(d0) && Number.isInteger(d1)));
    const up = (ev: PointerEvent) => {
      removeEventListener("pointerup", up);
      const x1 = at(ev);
      if (Math.abs(x1 - x0) * (m.a || 1) < 4) return;
      brushed = true;
      set({ range: `${fig.dataset.figure},${val(Math.min(x0, x1))},${val(Math.max(x0, x1))}`, sel: null, cmp: null, scene: null });
      say(rangeOf(state)?.count ?? "");
    };
    addEventListener("pointerup", up);
  });

  // ---------- the card: one .x-pop per stage, placed by place.ts ----------
  let popN = 0;
  const hostOf = (el: Element): HTMLElement | null => {
    const stage = el.closest<HTMLElement>(".x-stage");
    if (stage) return stage;
    const block = el.closest<HTMLElement>(".x-block");
    block?.classList.add("x-pop-host");
    return block;
  };
  const popOf = (host: HTMLElement): HTMLElement => {
    let pop = host.querySelector<HTMLElement>(":scope > .x-pop");
    if (!pop) {
      const id = `x-pop-${++popN}`;
      pop = h("div", "x-pop", undefined, { id, role: "dialog", "aria-modal": "false", "aria-labelledby": `${id}-t` });
      pop.hidden = true;
      host.append(pop);
    }
    return pop;
  };
  const overlayOf = (host: HTMLElement): SVGSVGElement => {
    let o = host.querySelector<SVGSVGElement>(":scope > .x-leader");
    if (!o) {
      o = ns("svg", { class: "x-leader", "aria-hidden": "true" });
      host.insertBefore(o, host.querySelector(":scope > .x-pop"));
    }
    return o;
  };
  /**
   * What a card for `id` points at: its mark in a stage, on screen, rather than a legend entry or a ref.
   * An id with no mark of its own (a lane handoff, a legend-only series) points at the union of its members,
   * or at last at its legend entry.
   */
  const anchorsOf = (id: string): Element[] => {
    const pick = (list: Element[]) => {
      const staged = list.filter((el) => el.closest(".x-stage"));
      const pool = staged.length ? staged : list;
      return pool.find((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < innerHeight;
      }) ?? pool[0];
    };
    const own = (x: string) => (index.get(x) ?? []).filter((el) => !el.matches(NOT_ANCHOR) && !el.closest(".x-legend") && shown(el));
    const first = pick(own(id));
    if (first) return [first];
    const members = (model.elements[id]?.members ?? []).flatMap(own);
    const lead = pick(members);
    if (lead) {
      const host = lead.closest(".x-stage");
      return members.filter((el) => el.closest(".x-stage") === host);
    }
    const legend = (index.get(id) ?? []).find((el) => el.matches(".x-legend-item") && shown(el));
    return legend ? [legend] : [];
  };
  const unionRect = (rects: DOMRect[]) => {
    const x = Math.min(...rects.map((r) => r.left)), y = Math.min(...rects.map((r) => r.top));
    return new DOMRect(x, y, Math.max(...rects.map((r) => r.right)) - x, Math.max(...rects.map((r) => r.bottom)) - y);
  };
  const anchorBox = (els: Element[], id: string) => (els.length === 1 ? anchorRect(els[0], id) : unionRect(els.map((el) => el.getBoundingClientRect())));
  let expanded: Element[] = [];
  let current: { host: HTMLElement; anchor: Element; anchors: Element[]; id: string } | null = null;
  const closePops = () => {
    for (const pop of $$(".x-pop")) {
      pop.hidden = true;
      pop.replaceChildren();
    }
    $$(".x-leader").forEach((o) => o.replaceChildren());
    $$(".x-callouts .is-covered").forEach((c) => c.classList.remove("is-covered"));
    $$(".is-dock-right,.is-dock-below").forEach((el) => {
      el.classList.remove("is-dock-right", "is-dock-below");
      el.style.removeProperty("min-height");
    });
    expanded.forEach((el) => el.removeAttribute("aria-expanded"));
    expanded = [];
    current = null;
  };
  const back: string[] = [];
  let picking = false;
  const scenesWith = (id: string) => Object.entries(model.scenes).find(([, sc]) => sc.path.includes(id) || sc.edges.includes(id))?.[0];
  const noteFor = (id: string): CardExtras["note"] => {
    const li = $$(".x-reading-note[data-refs]").find((el) => refIds(el.dataset.refs).includes(id));
    return li ? { n: li.dataset.note ?? "", text: li.querySelector(".x-reading-note-text")?.textContent?.trim() ?? "" } : undefined;
  };
  const mentionsOf = (id: string) =>
    viewOf(state) !== "full" ? [] : sents
      .map((el, i) => ({ el, i }))
      .filter(({ el }) => refIds(el.dataset.refs).includes(id) && shown(el))
      .slice(0, 2)
      .map(({ el, i }) => ({ i, text: el.textContent?.trim() ?? "" }));
  const extrasFor = (id: string): CardExtras => {
    const el = model.elements[id];
    const legend = index.get(id)?.some((x) => x.matches(".x-legend-item"));
    return {
      pin: true,
      note: noteFor(id),
      mentions: mentionsOf(id),
      back: back.length ? { id: back[back.length - 1], text: model.elements[back[back.length - 1]]?.label ?? back[back.length - 1] } : undefined,
      compare: true,
      picking,
      hide: !!legend && el?.type === "group",
      play: scenesWith(id),
    };
  };
  const bodyFor = (s: State, popId: string): { id: string; body: HTMLElement } | null => {
    const { story, scene } = frameOf(s);
    if (scene?.active) return scene.note ? { id: scene.active, body: renderCallout(scene.count, scene.note, popId, true) } : null;
    if (story?.sel && story.note) return { id: story.sel, body: renderCallout(story.count, story.note, popId, true) };
    const { sel, cmp } = frameOf(s);
    if (!sel) return null;
    if (cmp) {
      const c = compareData(model, sel, cmp);
      if (c) return { id: sel, body: renderCompare(c, popId, extrasFor(sel)) };
    }
    const d = cardData(model, sel);
    return d ? { id: sel, body: renderCard(d, popId, extrasFor(sel)) } : null;
  };
  const renderPop = (s: State) => {
    closePops();
    renderDetail(s);
    const { sel, scene } = frameOf(s);
    const id = scene?.active ?? sel;
    const anchors = id ? anchorsOf(id) : [];
    const anchor = anchors[0];
    const host = anchor ? hostOf(anchor) : null;
    if (!id || !anchor || !host) return;
    const pop = popOf(host);
    const content = bodyFor(s, pop.id);
    if (!content) return;
    pop.dataset.kind = scene?.active || (frameOf(s).story?.note) ? "callout" : "card";
    pop.replaceChildren(content.body, h("button", "x-pop-close", "×", { type: "button", "data-action": "clear", "aria-label": "Close" }));
    pop.hidden = false;
    current = { host, anchor, anchors, id };
    for (const el of index.get(id) ?? []) {
      if (!el.matches("[tabindex]")) continue;
      el.setAttribute("aria-expanded", "true");
      el.setAttribute("aria-controls", pop.id);
      expanded.push(el);
    }
    position();
  };
  const position = () => {
    if (!current) return;
    const { host, anchors, id } = current;
    const pop = popOf(host);
    host.classList.remove("is-dock-right", "is-dock-below", "has-gutter");
    host.style.removeProperty("min-height");
    pop.style.left = pop.style.top = "0px";
    const hr = host.getBoundingClientRect();
    const rel = (r: DOMRect): Rect => ({ x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height });
    const card = { w: pop.offsetWidth, h: pop.offsetHeight };
    const obstacles: Obstacle[] = [];
    let group = 0;
    const push = (el: Element, weight: number, kind: Obstacle["kind"]) => {
      const rects = shapeRects(el).filter((r) => r.width || r.height);
      group++;
      rects.forEach((r, i) => {
        // A lit connector's ends carry its arrowhead or key marker: covering them hides which way it runs.
        const end = kind === "related" && el.matches(".x-edge") && rects.length > 4 && (i < 2 || i >= rects.length - 2);
        obstacles.push({ ...rel(r), weight: end ? WEIGHT.selected : weight, kind: end ? "selected" : kind, group });
      });
    };
    const within = (el: Element) => host.contains(el) && !el.closest(".x-pop,.x-sel-layer,.x-leader");
    const tiers = new Set<Element>();
    lit.forEach((cls, el) => {
      if (!within(el) || cls === "is-context") return;
      tiers.add(el);
      const selected = cls === "is-selected" || cls === "is-step-active";
      push(el, selected ? WEIGHT.selected : WEIGHT.related, selected ? "selected" : "related");
      // The mark's own labels, its state annotations (.x-on-sel deltas and rules) included, weigh like the mark.
      for (const t of el.querySelectorAll("text")) {
        const r = t.getBoundingClientRect();
        if (r.width) obstacles.push({ ...rel(r), weight: selected ? WEIGHT.selected : WEIGHT.related, kind: selected ? "selected" : "related" });
      }
    });
    if (!obstacles.some((o) => o.kind === "selected")) for (const a of anchors) push(a, WEIGHT.selected, "selected");
    for (const t of $$<Element>("text, .x-board-head, .x-card-label", host)) {
      if (within(t) && ![...tiers].some((x) => x.contains(t))) obstacles.push({ ...rel(t.getBoundingClientRect()), weight: WEIGHT.label, kind: "label" });
    }
    for (const m of $$<Element>(".x-mark,.x-node,.x-card", host)) {
      if (within(m) && !tiers.has(m) && (!m.querySelector(".x-mark") || m.matches(".x-card"))) obstacles.push({ ...rel(m.getBoundingClientRect()), weight: WEIGHT.mark, kind: "mark" });
    }
    const own = obstacles.filter((o) => o.kind === "selected");
    const subject = own.length ? own.reduce((u, o) => {
      const x = Math.min(u.x, o.x), y = Math.min(u.y, o.y);
      return { x, y, w: Math.max(u.x + u.w, o.x + o.w) - x, h: Math.max(u.y + u.h, o.y + o.h) - y };
    }, { x: own[0].x, y: own[0].y, w: own[0].w, h: own[0].h } as Rect) : undefined;
    // The card may cover a callout (it is the answer being asked for), but prefers not to.
    for (const c of $$<Element>(".x-callout", host)) obstacles.push({ ...rel(c.getBoundingClientRect()), weight: WEIGHT.label, kind: "mark" });
    const plotEl = host.querySelector(":scope > .x-scroll > *");
    // Figures render 1:1: the plot's natural width is its minimum; a board's is its content width.
    const plotMin = plotEl instanceof SVGSVGElement ? plotEl.width.baseVal.value : plotEl ? plotEl.scrollWidth : 0;
    const mobile = innerWidth < 640 || hr.width < 520;
    const p = place({
      anchor: rel(anchorBox(anchors, id)),
      subject,
      card,
      stage: { w: hr.width, h: hr.height },
      plot: plotEl ? rel(plotEl.getBoundingClientRect()) : undefined,
      plotMin,
      view: { x: -hr.left, w: html.clientWidth },
      obstacles,
      mobile,
    });
    pop.dataset.mode = p.mode;
    const overlay = overlayOf(host);
    overlay.replaceChildren();
    // A callout the card lands on steps aside while the card is open, rather than peek out from under it; so does the
    // callout of the note the card itself shows, which would otherwise be on screen twice (the marker stays).
    const cover = () => {
      const shown = pop.querySelector<HTMLElement>(".x-pop-note[data-note]")?.dataset.note;
      if (shown) host.querySelectorAll(`.x-callout[data-note="${shown}"]`).forEach((c) => c.classList.add("is-covered"));
      const pr = pop.getBoundingClientRect();
      for (const c of $$(".x-callout, .x-callout-line", host)) {
        const r = c.getBoundingClientRect();
        const hit = r.right > pr.left && r.left < pr.right && r.bottom > pr.top && r.top < pr.bottom;
        const box = c.matches(".x-callout-line") ? host.querySelector(`.x-callout[data-note="${c.getAttribute("data-note")}"]`) : c;
        if (hit && box) box.classList.add("is-covered");
      }
      for (const line of $$(".x-callout-line", host)) {
        line.classList.toggle("is-covered", !!host.querySelector(`.x-callout.is-covered[data-note="${line.getAttribute("data-note")}"]`));
      }
    };
    if (p.mode === "dock-below") {
      host.classList.add("is-dock-below");
      pop.style.left = pop.style.top = "";
      const a = rel(anchorBox(anchors, id));
      // The first free spot around the anchor: above its middle, then its corners, then below; never on a
      // callout or a label (beside a bar sits its value label).
      const busy = $$<Element>(".x-callout, text", host).filter((t) => !t.closest(".x-leader")).map((t) => rel(t.getBoundingClientRect()));
      const spots: [number, number][] = [
        [a.x + a.w / 2, a.y - 14], [a.x + a.w + 10, a.y - 10], [a.x - 10, a.y - 10], [a.x + a.w / 2, a.y + a.h + 14], [a.x + a.w + 14, a.y + a.h / 2],
      ];
      const free = spots.find(([x, y]) => y >= 10 && !busy.some((b) => x + 10 > b.x && x - 10 < b.x + b.w && y + 10 > b.y && y - 10 < b.y + b.h));
      const [cx, cy] = free ?? [a.x + a.w / 2, Math.max(10, a.y - 14)];
      // a board mark with its own pin slot (plans-boards) shows the 1 in its marker lane instead
      const lanePin = anchors.length === 1 && anchors[0].querySelector(":scope > .x-plan-lane > .x-plan-pin, :scope > * > .x-plan-lane > .x-plan-pin");
      if (!lanePin) overlay.append(ns("circle", { class: "x-leader-num", cx, cy, r: 6 }));
      if (mobile) {
        const scroll = host.querySelector<HTMLElement>(":scope > .x-scroll");
        if (scroll && scroll.scrollWidth > scroll.clientWidth) scroll.scrollLeft = a.x + scroll.scrollLeft + a.w / 2 - scroll.clientWidth / 2;
      }
      cover();
      return;
    }
    let rect = p.rect;
    if (p.mode === "dock-right") {
      host.style.setProperty("--x-pop-w", `${card.w}px`);
      // The gutter is already free beside a narrow plot; only a wider one needs the stage to reserve it.
      const plotRight = plotEl ? plotEl.getBoundingClientRect().right - hr.left : 0;
      host.classList.add("is-dock-right");
      if (plotEl && plotRight + GUTTER + card.w <= hr.width) host.classList.add("has-gutter");
      // In its gutter the card shows everything; the stage grows to hold it rather than cover the text below.
      const full = pop.offsetHeight;
      host.style.minHeight = `${full}px`;
      card.h = Math.max(card.h, full);
      const hr2 = host.getBoundingClientRect();
      const a = anchorBox(anchors, id);
      const y = Math.round(Math.max(0, Math.min(a.top - hr2.top + a.height / 2 - card.h / 2, hr2.height - card.h)) / 8) * 8;
      const right = plotEl ? plotEl.getBoundingClientRect().right - hr2.left : hr2.width - card.w - GUTTER;
      rect = { x: Math.min(hr2.width - card.w, right + GUTTER), y, w: card.w, h: card.h };
    }
    pop.style.left = `${Math.round(rect.x)}px`;
    pop.style.top = `${Math.round(rect.y)}px`;
    const hr3 = host.getBoundingClientRect();
    const a = anchorBox(anchors, id);
    const rel3 = (r: DOMRect): Rect => ({ x: r.left - hr3.left, y: r.top - hr3.top, w: r.width, h: r.height });
    // Every label counts, the selected mark's own included, except the one the leader points at.
    const target = rel3(a);
    const labels = $$<Element>("text, .x-card-label, .x-board-head", host)
      .filter((t) => !t.closest(".x-pop,.x-sel-layer,.x-leader,.x-callouts") && !t.closest(HOOKS))
      .map((t) => rel3(t.getBoundingClientRect()))
      .filter((r) => !(r.x >= target.x - 1 && r.y >= target.y - 1 && r.x + r.w <= target.x + target.w + 1 && r.y + r.h <= target.y + target.h + 1));
    const l = leader(rect, target, labels);
    // Near: a caret or a short clean line. Far, or only reachable across a label: no line; the ring marks the anchor.
    const far = !l.caret && (l.length > LEADER_MAX || labels.some((r) => crosses(l.x1, l.y1, l.x2, l.y2, r)));
    if (far) {
      // nothing to draw
    } else if (l.caret) {
      const ang = Math.atan2(l.y2 - l.y1, l.x2 - l.x1), c = Math.cos(ang), s = Math.sin(ang);
      const tip = [l.x1 + c * 8, l.y1 + s * 8], b1 = [l.x1 - s * 5, l.y1 + c * 5], b2 = [l.x1 + s * 5, l.y1 - c * 5];
      overlay.append(ns("path", { class: "x-leader-caret", d: `M${b1.join(",")} L${tip.join(",")} L${b2.join(",")}` }));
    } else {
      overlay.append(ns("line", { class: "x-leader-line", x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 }));
      // The end dot is dropped where it would sit on a value label next to the anchor.
      const texts = $$<Element>("text", host).filter((t) => !t.closest(".x-pop,.x-leader,.x-sel-layer")).map((t) => rel3(t.getBoundingClientRect()));
      const onText = texts.some((r) => l.x2 + 4 > r.x && l.x2 - 4 < r.x + r.w && l.y2 + 4 > r.y && l.y2 - 4 < r.y + r.h);
      if (!onText) overlay.append(ns("circle", { class: "x-leader-dot", cx: l.x2, cy: l.y2, r: 3 }));
    }
    cover();
  };
  let raf = 0;
  const replace = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      annotate();
      if (current) position();
      drawRings();
    });
  };
  addEventListener("resize", replace);
  for (const sc of $$(".x-scroll")) sc.addEventListener("scroll", replace, { passive: true });

  // ---------- annotation layer: in the full view every note is also a callout on the graph ----------
  // Placed once per layout (not per selection, so they never jump), clear of marks, labels and each other,
  // inside the stage. A note that finds no clean spot stays in the reading panel with its marker.
  // Where the card would dock in the gutter, callouts keep out of its column (it would hide them) and may
  // take a lane under the plot instead; the stage grows by that lane, above a card docked under the figure.
  const annotate = () => {
    $$(".x-callouts, .x-callout-lane").forEach((c) => c.remove());
    if (viewOf(state) !== "full") return;
    for (const stage of $$(".x-stage")) {
      const read = stage.closest(".x-read");
      const notes = read ? $$(".x-reading-note[data-note]", read).filter((li) => li.closest(".x-read") === read) : [];
      if (!notes.length) continue;
      const hr = stage.getBoundingClientRect();
      const rel = (r: DOMRect): Rect => ({ x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height });
      const layer = h("div", "x-callouts", undefined, { "aria-hidden": "true" });
      const lines = ns("svg", { class: "x-callout-lines" });
      layer.append(lines);
      stage.insertBefore(layer, stage.querySelector(":scope > .x-leader, :scope > .x-pop"));
      const boxes: { box: HTMLElement; item: CalloutItem }[] = [];
      for (const li of notes) {
        const n = li.dataset.note!;
        const refs = refIds(li.dataset.refs);
        const marker = $$(`.x-note-marker[data-note="${CSS.escape(n)}"]`, stage).find(shown);
        const targets = refs.flatMap((id) => (index.get(id) ?? []).filter((el) => stage.contains(el) && !el.matches(NOT_ANCHOR) && shown(el)));
        const at = marker ?? targets[0];
        if (!at) continue;
        const box = h("div", "x-callout", undefined, { "data-note": n, ...(refs.length ? { "data-refs": refs.join(" ") } : {}) });
        const text = li.querySelector(".x-reading-note-text");
        box.append(h("span", "x-callout-num", n), h("span", "x-callout-text"));
        // The note is already sanitised page content; copy its nodes rather than re-parse any HTML.
        text?.childNodes.forEach((c) => box.lastElementChild!.append(c.cloneNode(true)));
        layer.append(box);
        boxes.push({ box, item: { anchor: rel(at.getBoundingClientRect()), w: 0, h: 0, keep: targets.flatMap((t) => shapeRects(t, 24).map(rel)) } });
      }
      for (const b of boxes) {
        b.item.w = b.box.offsetWidth;
        b.item.h = b.box.offsetHeight;
      }
      const obstacles: Obstacle[] = [];
      const within = (el: Element) => !el.closest(".x-callouts,.x-pop,.x-sel-layer,.x-leader");
      for (const m of $$<Element>(".x-mark,.x-node,.x-edge,.x-card", stage)) {
        if (within(m) && (!m.querySelector(".x-mark") || m.matches(".x-card"))) for (const r of shapeRects(m, 24)) obstacles.push({ ...rel(r), weight: WEIGHT.mark, kind: "mark" });
      }
      // lifelines, axes and the legend rule are lines too: a callout never sits across one
      for (const l of $$<Element>(".x-lifeline, .x-axis-line, .x-legend-rule", stage)) obstacles.push({ ...rel(l.getBoundingClientRect()), weight: WEIGHT.mark, kind: "mark" });
      for (const t of $$<Element>("text, .x-card-label, .x-board-head", stage)) {
        if (within(t) && !t.closest(".x-notes, .x-on-sel, .x-on-rel, .x-on-hover")) obstacles.push({ ...rel(t.getBoundingClientRect()), weight: WEIGHT.label, kind: "label" });
      }
      for (const m of $$<Element>(".x-note-marker", stage)) obstacles.push({ ...rel(m.getBoundingClientRect()), weight: 20, kind: "label" });
      const plotEl = stage.querySelector(":scope > .x-scroll > *");
      const plot = plotEl ? rel(plotEl.getBoundingClientRect()) : undefined;
      // the same test position() makes: a narrow screen docks the card under the figure, never in the gutter
      const mobile = innerWidth < 640 || hr.width < 520;
      // position() sets --x-pop-w to the last docked card, which a step's narrower callout card may have been
      const popW = Math.max(256, parseFloat(getComputedStyle(stage).getPropertyValue("--x-pop-w")) || 0);
      const dock = mobile ? undefined : dockColumn({ w: hr.width, h: hr.height }, plot, popW);
      const spots = placeCallouts(boxes.map((b) => b.item), { w: hr.width, h: hr.height }, obstacles, plot, dock);
      const depth = Math.max(0, ...spots.map((r) => (r ? r.y + r.h - hr.height : 0)));
      if (depth > 0) {
        const lane = h("div", "x-callout-lane", undefined, { "aria-hidden": "true" });
        lane.style.height = `${Math.ceil(depth)}px`;
        const scroll = stage.querySelector(":scope > .x-scroll");
        if (scroll) scroll.after(lane);
        else stage.insertBefore(lane, layer);
      }
      const labels = obstacles.filter((o) => o.kind === "label" && o.weight === WEIGHT.label);
      // connectors as points along each path: a leader that would cross one is not drawn, and the number alone pairs
      // the callout with its marker, as for a far one. The connector a note is about is the leader's own target.
      const along = (el: Element): Rect[] => {
        const p = el.querySelector<SVGGeometryElement>(".x-edge-line");
        const m = p?.getScreenCTM();
        if (!p || !m) return [];
        const len = p.getTotalLength(), n = Math.max(2, Math.ceil(len / 4));
        return Array.from({ length: n + 1 }, (_, i) => {
          const q = p.getPointAtLength((len * i) / n).matrixTransform(m);
          return rel(new DOMRect(q.x - 3, q.y - 3, 6, 6));
        });
      };
      const wires = $$<Element>(".x-edge", stage).filter(within).map((el) => ({ id: el.getAttribute("data-id") ?? "", rects: along(el) }));
      spots.forEach((r, i) => {
        const { box, item } = boxes[i];
        if (!r) return box.remove();
        box.style.left = `${Math.round(r.x)}px`;
        box.style.top = `${Math.round(r.y)}px`;
        const l = leader(r, nearest(r, item), labels);
        // A far callout (in a lane) is paired with its marker by the number alone, like a far card.
        const refs = refIds(box.dataset.refs);
        const wired = wires.some((w) => !refs.includes(w.id) && w.rects.some((b) => crosses(l.x1, l.y1, l.x2, l.y2, b)));
        const far = l.length > LEADER_MAX || labels.some((b) => crosses(l.x1, l.y1, l.x2, l.y2, b)) || wired;
        if (!l.caret && !far) lines.append(ns("line", { class: "x-callout-line", "data-note": box.dataset.note!, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 }));
      });
    }
    tintCallouts(state);
  };
  /** Callouts about the selection stay lit; the others step back like the marks they point at. */
  const tintCallouts = (s: State) => {
    const { sel, cmp } = frameOf(s);
    const on = new Set<string>();
    if (sel) [sel, cmp].forEach((id) => id && related(model, id).forEach((x) => on.add(x)));
    for (const c of $$(".x-callout")) {
      const refs = refIds(c.dataset.refs);
      c.classList.toggle("is-linked", !!sel && refs.some((id) => id === sel || id === cmp));
      c.classList.toggle("is-dimmed", !!sel && !refs.some((id) => on.has(id)));
    }
  };

  // `::: detail` blocks mirror the card
  const panels = $$("[data-detail]");
  const empty = new Map(panels.map((p) => [p, p.innerHTML]));
  const renderDetail = (s: State) => {
    const { sel } = frameOf(s);
    const d = sel ? cardData(model, sel) : null;
    for (const p of panels) {
      if (d && sel) p.replaceChildren(renderCard(d, `${p.id || "x-detail"}-card`, { ...extrasFor(sel), pin: false, mentions: [] }));
      else p.innerHTML = empty.get(p) ?? "";
      if (p.dataset.placement !== "inline") p.hidden = !d;
    }
  };

  // hidden series: a "Hidden: Web ×" row under the figure
  const renderHidden = (s: State) => {
    $$(".x-hidden-row").forEach((r) => r.remove());
    const byHost = new Map<HTMLElement, string[]>();
    for (const id of s.hide) {
      const leg = index.get(id)?.find((el) => el.matches(".x-legend-item"));
      const host = leg?.closest<HTMLElement>(".x-stage");
      if (host) byHost.set(host, [...(byHost.get(host) ?? []), id]);
    }
    byHost.forEach((ids, host) => {
      const row = h("p", "x-hidden-row", "Hidden: ");
      ids.forEach((id) => row.append(h("button", "x-chip", `${model.elements[id]?.label ?? id} ×`, { type: "button", "data-action": "unhide", "data-id": id })));
      host.querySelector(":scope > .x-scroll")?.after(row);
    });
  };

  // live region: the say line of whatever was just selected or stepped to
  const live = h("div", "x-live", "", { role: "status", "aria-live": "polite" });
  document.body.append(live);
  const say = (text: string) => {
    live.textContent = "";
    if (text) requestAnimationFrame(() => (live.textContent = text));
  };
  const announce = (s: State) => {
    const { story, scene, sel, cmp } = frameOf(s);
    if (scene?.active) return say(`Step ${scene.count}: ${[model.elements[scene.active]?.label, scene.note].filter(Boolean).join(". ")}`);
    if (story) return say(`Step ${story.count}: ${[sayLine(model.elements[story.sel ?? ""]), story.note].filter(Boolean).join(". ")}`);
    if (sel && cmp) return say(`${sayLine(model.elements[sel])} compared with ${sayLine(model.elements[cmp])}`);
    if (sel) say(sayLine(model.elements[sel], index.get(sel)?.find((el) => el.getAttribute("data-say"))?.getAttribute("data-say") ?? ""));
  };

  // steps
  const steps = $$(".x-steps[data-for]");
  const sceneIds = (root: Element) => $$(".x-scene", root).map((b) => b.dataset.scene ?? "").filter((id) => model.scenes[id]);
  const lastStep = (id: string) => model.scenes[id].path.length - 1;
  const renderSteps = (s: State) => {
    for (const st of steps) {
      const on = !!s.scene && sceneIds(st).includes(s.scene);
      const f = on ? storyFrame(model, s.scene!, s.step) ?? sceneFrame(model, s.scene!, s.step) : null;
      const q = <E extends Element = HTMLElement>(sel: string) => st.querySelector<E>(sel);
      const count = q(".x-steps-count"), note = q(".x-steps-note");
      if (count) count.textContent = f?.count ?? "";
      if (note) note.textContent = f?.note ?? "";
      const prev = q<HTMLButtonElement>('[data-action="prev"]');
      const next = q<HTMLButtonElement>('[data-action="next"]');
      const play = q<HTMLButtonElement>('[data-action="play"]');
      if (prev) prev.disabled = !on || s.step <= 0;
      if (next) next.disabled = on && s.step >= lastStep(s.scene!);
      if (play) {
        play.textContent = on && timer !== undefined ? "Pause" : "Play";
        play.setAttribute("aria-label", play.textContent);
      }
      for (const b of $$(".x-scene", st)) {
        if (b.dataset.scene === s.scene) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      }
    }
  };

  // actions
  const stopPlay = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
    renderSteps(state);
  };
  const select = (id: string | null, via: "chip" | "back" | "other" = "other") => {
    stopPlay();
    picking = false;
    if (via === "chip" && state.sel && id && id !== state.sel) {
      back.push(state.sel);
      if (back.length > BACK_MAX) back.shift();
    } else if (via === "other") back.length = 0;
    set({ sel: id, cmp: null, range: null, scene: null, step: 0 });
    if (via !== "other") renderPop(state);
  };
  const toggle = (id: string) => select(state.sel === id && !state.scene && !state.cmp ? null : id);
  const clear = () => {
    if (picking) {
      picking = false;
      return renderPop(state);
    }
    if (state.cmp) return set({ cmp: null });
    if (state.range) return set({ range: null });
    select(null);
  };
  const startScene = (id: string | null, step = 0) => {
    stopPlay();
    set(id ? { scene: id, step, sel: null, cmp: null, range: null } : { scene: null, step: 0 });
  };
  const stepBy = (d: number, ids: string[]) => {
    stopPlay();
    if (state.scene && (!ids.length || ids.includes(state.scene))) set({ step: state.step + d });
    else if (d > 0 && ids[0]) startScene(ids[0]);
  };
  const play = (ids: string[], from?: number) => {
    if (timer !== undefined) return stopPlay();
    const id = state.scene && ids.includes(state.scene) ? state.scene : ids[0];
    if (!id) return;
    const last = lastStep(id);
    const start = from ?? (state.scene === id && state.step < last ? state.step : 0);
    // Reduced motion: no animation, jump straight to the last step.
    if (reduced()) return startScene(id, last);
    startScene(id, start);
    timer = setInterval(() => {
      if (state.scene !== id || state.step >= last) return stopPlay();
      set({ step: state.step + 1 });
      if (state.step >= last) stopPlay();
    }, 1600);
    renderSteps(state);
  };
  const toggleHide = (id: string) => set({ hide: state.hide.includes(id) ? state.hide.filter((x) => x !== id) : [...state.hide, id] });
  const flash = (el: Element) => {
    el.classList.remove("is-flash");
    void (el as HTMLElement).offsetWidth;
    el.classList.add("is-flash");
    setTimeout(() => el.classList.remove("is-flash"), 1200);
  };
  const copy = (text: string, btn: HTMLElement) => {
    const done = () => {
      const was = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = was), 1200);
    };
    navigator.clipboard?.writeText(text).then(done, () => {});
  };
  const actions: Record<string, (ids: string[], btn: HTMLElement) => void> = {
    prev: (ids) => stepBy(-1, ids),
    next: (ids) => stepBy(1, ids),
    play: (ids) => play(ids),
    theme: () => set({ theme: themeOf(state) === "dark" ? "light" : "dark" }),
    view: () => set({ view: viewOf(state) === "full" ? "bare" : "full" }),
    clear: () => {
      const mark = current?.anchor;
      select(null);
      if (mark instanceof HTMLElement || mark instanceof SVGElement) (mark as HTMLElement).focus?.({ preventScroll: true });
    },
    back: () => {
      const id = back.pop();
      if (id) select(id, "back");
    },
    compare: () => {
      picking = true;
      renderPop(state);
    },
    hide: () => {
      const id = state.sel;
      if (id) {
        select(null);
        toggleHide(id);
      }
    },
    unhide: (_, btn) => toggleHide(btn.dataset.id ?? ""),
    copy: (_, btn) => copy(location.href, btn),
    "play-scene": (_, btn) => {
      const id = btn.dataset.scene ?? "";
      const sc = model.scenes[id];
      const at = sc ? Math.max(0, sc.path.indexOf(state.sel ?? "")) : 0;
      stopPlay();
      play([id], at);
    },
    csv: (_, btn) => {
      const table = btn.closest(".x-data")?.querySelector("table");
      if (table) copy(toCsv([...table.rows].map((r) => [...r.cells].map((c) => c.textContent?.trim() ?? ""))), btn);
    },
  };

  // ---------- tooltip ----------
  const tip = h("div", "x-tip", "", { role: "tooltip", id: "x-tip" });
  tip.hidden = true;
  tip.style.position = "fixed";
  document.body.append(tip);
  const showTip = (anchor: Element, content: string) => {
    if (capture || !content) return hideTip();
    tip.textContent = content;
    tip.hidden = false;
    anchor.setAttribute("aria-describedby", "x-tip");
    const r = anchor.getBoundingClientRect(), above = r.top - 6 - tip.offsetHeight;
    tip.style.top = `${above < 8 ? r.bottom + 6 : above}px`;
    tip.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - tip.offsetWidth / 2, innerWidth - tip.offsetWidth - 8))}px`;
  };
  const termDef = (term: HTMLElement | null): string | undefined => {
    const key = term?.dataset.term ?? "";
    return term ? model.glossary[key] ?? model.glossary[key.toLowerCase()] : undefined;
  };
  const hideTip = () => {
    tip.hidden = true;
  };
  const tipFor = (id: string, el: Element) => {
    const info = model.elements[id];
    if (!info || el.closest(".x-pop,.x-prose,.x-reading")) return "";
    return sayLine(info, el.getAttribute("data-say") ?? "");
  };

  // ---------- roving tabindex: one tab stop per figure ----------
  const rovers = (fig: Element) => $$<HTMLElement>("[tabindex]", fig).filter((el) => !el.closest(".x-pop,.x-reading") && (el.dataset.id || el.dataset.ref || el.dataset.for));
  const navOf = (el: Element): [number, number] | null => {
    const v = el.getAttribute("data-nav")?.split(",").map(Number);
    return v && v.length === 2 && v.every(Number.isFinite) ? [v[0], v[1]] : null;
  };
  const ordered = (fig: Element) => {
    const els = rovers(fig);
    if (!els.every((el) => navOf(el))) return els;
    return [...els].sort((a, b) => navOf(a)![0] - navOf(b)![0] || navOf(a)![1] - navOf(b)![1]);
  };
  const setCurrent = (el: HTMLElement) => {
    const fig = el.closest(".x-figure");
    if (!fig) return;
    for (const m of rovers(fig)) m.tabIndex = m === el ? 0 : -1;
  };
  for (const fig of $$(".x-figure")) {
    const els = ordered(fig);
    els.forEach((el, i) => (el.tabIndex = i ? -1 : 0));
  }
  const focusMark = (el: HTMLElement | null) => {
    if (!el) return;
    setCurrent(el);
    el.focus({ preventScroll: false });
  };

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    if (brushed) {
      brushed = false;
      return;
    }
    const t = e.target as Element;
    const act = t.closest<HTMLElement>("[data-action]");
    if (act) {
      const st = act.closest(".x-steps");
      return actions[act.dataset.action ?? ""]?.(st ? sceneIds(st) : [], act);
    }
    const sc = t.closest<HTMLElement>(".x-scene");
    if (sc) return startScene(sc.dataset.scene ?? null);
    const mention = t.closest<HTMLElement>(".x-pop-mention");
    if (mention) {
      const sent = sents[Number(mention.dataset.sent)];
      sent?.scrollIntoView({ block: "center", behavior: reduced() || capture ? "auto" : "smooth" });
      if (sent) flash(sent);
      return;
    }
    const note = t.closest<HTMLElement>(".x-reading-note[data-refs], .x-note-marker[data-for], .x-callout[data-refs]");
    if (note) return toggle(refIds(note.dataset.refs ?? note.dataset.for)[0]);
    const multi = t.closest<HTMLElement>(".x-ref[data-cmp]");
    if (multi) {
      e.preventDefault();
      return set({ sel: multi.dataset.ref ?? null, cmp: multi.dataset.cmp ?? null, scene: null, range: null });
    }
    const id = idOf(t);
    if (id) {
      if (t.closest(".x-ref")) e.preventDefault();
      const legend = t.closest(".x-legend-item");
      if (legend && (e.altKey || state.hide.includes(id))) return toggleHide(id);
      if (picking && state.sel && id !== state.sel) {
        picking = false;
        return set({ cmp: id });
      }
      if ((e.shiftKey || e.metaKey || e.ctrlKey) && state.sel && id !== state.sel) return set({ cmp: state.cmp === id ? null : id });
      if (t.closest(".x-pop")) return select(id, "chip");
      const mark = t.closest<HTMLElement>("[tabindex]");
      if (mark?.closest(".x-figure")) setCurrent(mark);
      return toggle(id);
    }
    if (t.closest(".x-svg, .x-scroll") && !t.closest(".x-pop")) clear();
  });

  document.addEventListener("dblclick", (e) => {
    const legend = (e.target as Element).closest<HTMLElement>(".x-legend-item[data-id]");
    const fig = legend?.closest(".x-figure");
    if (!legend || !fig) return;
    // Isolate: hide every other legend entry of this figure (again: show all).
    const ids = $$<HTMLElement>(".x-legend-item[data-id]", fig).map((el) => el.dataset.id!);
    const others = ids.filter((x) => x !== legend.dataset.id);
    const isolated = others.every((x) => state.hide.includes(x));
    set({ hide: isolated ? state.hide.filter((x) => !ids.includes(x)) : [...new Set([...state.hide.filter((x) => x !== legend.dataset.id), ...others])], sel: null });
  });

  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (e.key === "Escape") {
      hideTip();
      const inPop = t.closest?.(".x-pop");
      const mark = current?.anchor as HTMLElement | undefined;
      if (picking || state.cmp || state.range) return clear();
      if (state.sel || state.scene) select(null);
      if (inPop && mark?.focus) focusMark(mark);
      return;
    }
    if (t.closest("input,textarea,select,[contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
    const fig = t.closest(".x-figure");
    const onMark = !!fig && t.matches("[tabindex]") && !t.closest(".x-pop");
    if (e.key === "Enter" || e.key === " ") {
      const id = t.matches("button,a") ? null : idOf(t);
      if (id) {
        e.preventDefault();
        toggle(id);
      }
      return;
    }
    if (e.key === "t") return actions.theme([], t);
    if (state.scene && !onMark || state.scene && (e.key === "Home" || e.key === "End" || e.key === "r")) {
      const id = state.scene;
      if (e.key === "Home") return (e.preventDefault(), startScene(id, 0));
      if (e.key === "End") return (e.preventDefault(), startScene(id, lastStep(id)));
      if (e.key === "r") return (e.preventDefault(), stopPlay(), play([id], 0));
    }
    const dir = ARROWS[e.key];
    if (dir && state.scene && (dir === "left" || dir === "right") && !onMark) {
      e.preventDefault();
      return stepBy(dir === "right" ? 1 : -1, []);
    }
    if (!onMark || !fig) return;
    const els = ordered(fig);
    let next: HTMLElement | undefined;
    if (e.key === "Home") next = els[0];
    else if (e.key === "End") next = els[els.length - 1];
    else if (dir) {
      const from = navOf(t);
      if (from) {
        const cands = els.filter((el) => el !== t && navOf(el)).map((el, i) => ({ id: String(els.indexOf(el)), nav: navOf(el)!, i }));
        const hit = navNeighbor(from, cands, dir);
        next = hit === null ? undefined : els[+hit];
      } else {
        const center = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };
        const others = els.filter((el) => el !== t && shown(el));
        const hit = pickNeighbor(center(t), others.map((el, i) => ({ id: String(i), ...center(el) })), dir);
        next = hit === null ? undefined : others[+hit];
      }
    }
    if (next) {
      e.preventDefault();
      focusMark(next);
    }
  });

  let leave: ReturnType<typeof setTimeout> | undefined;
  const hoverTo = (ids: string[]) => {
    clearTimeout(leave);
    const key = ids.join(" ");
    if (key === preview.join(" ")) return;
    set({ hover: ids[0] ?? null });
    paintHover(ids);
  };
  document.addEventListener("mouseover", (e) => {
    if (noHover.matches) return;
    const t = e.target as Element;
    const term = t.closest<HTMLElement>(".x-term");
    const def = termDef(term);
    const ref = t.closest<HTMLElement>(".x-ref[data-ref], .x-sent[data-refs], .x-reading-note[data-refs], .x-note-marker[data-for], .x-callout[data-refs]");
    const ids = ref && !t.closest(".x-pop") ? refIds(ref.dataset.refs ?? ref.dataset.for ?? [ref.dataset.ref, ref.dataset.cmp].join(" ")) : [idOf(t)].filter((x): x is string => !!x);
    for (const el of $$(".x-note-marker.is-hover, .x-reading-note.is-hover, .x-callout.is-hover")) el.classList.remove("is-hover");
    const n = t.closest<HTMLElement>("[data-note]")?.dataset.note;
    if (n) {
      const block = t.closest(".x-read");
      if (block) for (const el of $$(`[data-note="${CSS.escape(n)}"]`, block)) el.classList.add("is-hover");
    }
    if (ids.length) hoverTo(ids);
    else {
      clearTimeout(leave);
      leave = setTimeout(() => hoverTo([]), LEAVE_MS);
    }
    const mark = t.closest(HIT);
    if (term && def) showTip(term, def);
    else if (mark && ids[0] && ids[0] !== state.sel) showTip(mark, tipFor(ids[0], mark));
    else hideTip();
  });
  document.addEventListener("mouseout", (e) => {
    if (e.relatedTarget) return;
    leave = setTimeout(() => hoverTo([]), LEAVE_MS);
    hideTip();
  });
  document.addEventListener("focusin", (e) => {
    const t = e.target as HTMLElement;
    const term = t.closest<HTMLElement>(".x-term");
    const def = termDef(term);
    if (term && def) return showTip(term, def);
    if (t.closest(".x-figure") && t.matches("[tabindex]") && !t.closest(".x-pop")) {
      setCurrent(t);
      const id = idOf(t);
      if (id) {
        hoverTo([id]);
        if (id !== state.sel) showTip(t, tipFor(id, t));
      }
    }
  });
  document.addEventListener("focusout", (e) => {
    const t = e.target as Element;
    if (t.matches(".x-term") || t.closest(".x-figure")) hideTip();
    if (t.closest(".x-figure") && !t.closest(".x-pop")) hoverTo([]);
  });
  // A "#heading" link carries no state: it scrolls, and theme, view and selection stay as they are.
  addEventListener("hashchange", () => {
    if (!isStateHash(location.hash)) return;
    set({ ...EMPTY, theme: state.theme, view: state.view, ...readHash() });
  });

  // initial render + sync (internal subscriber runs before API subscribers)
  applyTheme(state);
  applyView(state);
  annotate();
  paint(state);
  renderPop(state);
  renderSteps(state);
  subs.add((s, p) => {
    const tiers = s.sel !== p.sel || s.cmp !== p.cmp || s.scene !== p.scene || s.step !== p.step || s.range !== p.range || s.hide.join() !== p.hide.join();
    if (s.view !== p.view) {
      applyView(s);
      annotate();
    }
    if (tiers) {
      paint(s);
      renderPop(s);
      renderSteps(s);
      announce(s);
      const { sel } = frameOf(s);
      const mark = sel ? index.get(sel)?.find((el) => el.matches("[tabindex]") && el.closest(".x-figure")) : null;
      if (mark instanceof HTMLElement || mark instanceof SVGElement) setCurrent(mark as HTMLElement);
    } else if (s.view !== p.view) renderPop(s);
    if (s.theme !== p.theme) {
      applyTheme(s);
      drawRings();
      inkDimmed();
    }
    const hash = serializeHash(s, capture);
    if (hash !== location.hash) history.replaceState(null, "", hash || location.pathname + location.search);
  });

  // api + widgets
  const widgets = new Map<string, Widget>();
  const cleanups: (() => void)[] = [];
  let ready = false;
  const mount = (name: string, fn: Widget) => {
    for (const el of $$(`[data-widget="${CSS.escape(name)}"]`)) {
      try {
        const done = fn(el, api);
        if (typeof done === "function") cleanups.push(done);
      } catch (err) {
        console.error(`widget ${name}:`, err);
      }
    }
  };
  // A widget's returned cleanup runs when the page goes away (navigation, bfcache, closing the tab).
  addEventListener("pagehide", () => cleanups.splice(0).forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error("widget cleanup:", err);
    }
  }));
  const api: Explainer = {
    model,
    get: () => state,
    set,
    on: (fn) => {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    register: (name, fn) => {
      widgets.set(name, fn);
      if (ready) mount(name, fn);
    },
    select: (id) => select(id),
    scene: (id, step = 0) => startScene(id, step),
  };
  window.explainer = api;

  // module scripts (widgets) run before DOMContentLoaded, so wait for it as well as fonts
  const parsed = document.readyState === "loading" ? new Promise((r) => addEventListener("DOMContentLoaded", r, { once: true })) : null;
  Promise.all([document.fonts?.ready, parsed]).then(() => {
    ready = true;
    widgets.forEach((fn, name) => mount(name, fn));
    // Fonts change text boxes: callouts, rings and the card are measured again before a shot is taken.
    annotate();
    drawRings();
    if (current) position();
    html.dataset.ready = "1";
  });
}

if (typeof document !== "undefined") boot();
