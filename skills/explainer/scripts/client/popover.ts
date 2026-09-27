// The in-figure card: what it says (pure, tested) and its DOM. Every string goes in as textContent;
// the only HTML is aboutHtml, sanitised at build time.
import type { DocModel, ElementInfo, Fact } from "../engine/types.ts";

export interface Chip { id: string; text: string }
export interface RelGroup { rel: string; chips: Chip[] }
export interface CardData {
  id: string;
  eyebrow: string;          // "Bar · 5 of 7", sentence case like every section tag
  crumb: Chip[];            // ancestors, outermost first
  title: string;
  ends?: [Chip, Chip];      // an edge's endpoints, shown as the title
  value: string;            // primary value · sub, never a repeat of the title
  facts: Fact[];
  aboutHtml: string;
  groups: RelGroup[];
}
export interface CompareRow { k: string; a: string; b: string; d: string }
export interface CompareData { a: Chip; b: Chip; rows: CompareRow[] }

// The legend's words, so the eyebrow never says SERVICE where the legend says DATA STORE.
const NODE_WORDS: Record<string, string> = { actor: "person", store: "data store", external: "external", boundary: "boundary", optional: "optional", decision: "decision" };
const EDGE_WORDS: Record<string, string> = { flow: "flow", return: "reply", async: "async", link: "external call" };
const MINUS = "−";

const labelOf = (model: DocModel, id: string) => model.elements[id]?.label || id;
const chip = (model: DocModel, id: string): Chip => ({ id, text: labelOf(model, id) });

function eyebrow(el: ElementInfo): string {
  // a node of the default kind has no word: "Service" is software vocabulary a diagram about anything else doesn't use,
  // and the breadcrumb already says where the node sits
  const kind = el.type === "edge" ? EDGE_WORDS[el.kind ?? "flow"] ?? el.kind ?? "connector"
    : el.type === "node" ? (el.kind === "service" ? "" : NODE_WORDS[el.kind ?? ""] ?? el.kind ?? "node")
    : el.kind || el.type;
  const s = [kind, el.pos].filter(Boolean).join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Relation groups for the card. Engine `links` win. Otherwise connectors in reading order: "Out" holds
 * "verb → Target" (or just Target), "In" holds "Source → verb" (or just Source). An edge has none: its
 * endpoints are the title. Never an invented "A → B", never a repeated endpoint.
 */
export function relationGroups(model: DocModel, id: string): RelGroup[] {
  const el = model.elements[id];
  if (!el) return [];
  if (el.links?.length) {
    return el.links
      .map((l) => ({ rel: l.rel, chips: dedupe(l.ids.filter((x) => x !== id).map((x) => chip(model, x))) }))
      .filter((g) => g.chips.length);
  }
  if (el.type === "edge") return [];
  const edges = Object.values(model.elements).filter((e) => e.type === "edge");
  const out = edges.filter((e) => e.from === id && e.to).map((e) => ({ id: e.to!, text: e.label ? `${e.label} → ${labelOf(model, e.to!)}` : labelOf(model, e.to!) }));
  const inn = edges.filter((e) => e.to === id && e.from).map((e) => ({ id: e.from!, text: e.label ? `${labelOf(model, e.from!)} → ${e.label}` : labelOf(model, e.from!) }));
  const groups: RelGroup[] = [];
  if (inn.length) groups.push({ rel: "In", chips: dedupe(inn) });
  if (out.length) groups.push({ rel: "Out", chips: dedupe(out) });
  // A zone's few members are worth a chip each; a series' dozens of points are not, and neither are members
  // the facts already link to. A member named after its group ("Mobile, Jan" in Mobile) drops the prefix.
  const members = el.type === "group" ? el.members ?? [] : [];
  const cited = new Set((el.facts ?? []).map((f) => f.ref));
  if (members.length && members.length <= 6 && !members.some((m) => cited.has(m))) {
    const prefix = new RegExp(`^${el.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[,·:–—-]\\s*`, "i");
    groups.push({ rel: "Contains", chips: dedupe(members.map((m) => ({ id: m, text: labelOf(model, m).replace(prefix, "") || labelOf(model, m) }))) });
  }
  return groups;
}

function dedupe(chips: Chip[]): Chip[] {
  const seen = new Set<string>();
  return chips.filter((c) => {
    const k = `${c.id}\u0000${c.text}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

export function cardData(model: DocModel, id: string): CardData | null {
  const el = model.elements[id];
  if (!el) return null;
  const isEdge = el.type === "edge" && el.from && el.to;
  const ends: [Chip, Chip] | undefined = isEdge ? [chip(model, el.from!), chip(model, el.to!)] : undefined;
  const title = ends ? `${ends[0].text} → ${ends[1].text}` : el.label;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const parts = [el.value, isEdge ? el.label : el.sub].filter((s): s is string => !!s && norm(s) !== norm(title));
  return {
    id,
    eyebrow: eyebrow(el),
    crumb: (el.crumb ?? []).filter((c) => c !== id).map((c) => chip(model, c)),
    title,
    ends,
    value: [...new Set(parts)].join(" · "),
    facts: (el.facts ?? []).slice(0, 5),
    aboutHtml: el.aboutHtml ?? "",
    groups: relationGroups(model, id),
  };
}

// ---------- compare ----------

/** Reads the number out of a formatted value: "46k" → 46000, "−$1,234" → -1234, "8.8%" → 8.8. */
export function parseNum(v: string | undefined): number | null {
  const m = /([+\-−]?)\s*[$€£¥]?\s*([\d,]*\.?\d+)\s*([kKMB])?/.exec(v ?? "");
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, "")) * ({ k: 1e3, K: 1e3, M: 1e6, B: 1e9 }[m[3] ?? ""] ?? 1);
  return Number.isFinite(n) ? (m[1] === "-" || m[1] === MINUS ? -n : n) : null;
}

/** A signed difference in the style of `like`: "+1k", "−3,190 signups", "+$40", "+2.5 pts" for percentages. */
export function fmtDelta(d: number, like = ""): string {
  const a = Math.abs(d);
  const pre = /^[+\-−]?\s*([$€£¥])/.exec(like)?.[1] ?? "";
  const unit = /\d[kKMB]?(\s+[^\d\s].*)$/.exec(like)?.[1] ?? "";
  const post = /%\s*$/.test(like) ? " pts" : /^\s+of\b/.test(unit) ? "" : unit;
  const short = /\d[kKMB]\b/.test(like);
  const group = (n: number, dp: number) => n.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: 0 });
  const body = short && a >= 1e6 ? `${group(a / 1e6, 1)}M` : short && a >= 1e3 ? `${group(a / 1e3, a >= 1e4 ? 0 : 1)}k` : group(a, a < 10 && !Number.isInteger(a) ? 1 : 0);
  if (body === "0") return `${pre}0${post}`;
  return `${d < 0 ? MINUS : "+"}${pre}${body}${post}`;
}

/** A vs B: the primary values, then every fact both carry, with the difference when both are numbers. */
export function compareData(model: DocModel, a: string, b: string): CompareData | null {
  const ea = model.elements[a], eb = model.elements[b];
  if (!ea || !eb) return null;
  const rows: CompareRow[] = [];
  const diff = (va: string, vb: string, ra?: number, rb?: number) => {
    // Without raw numbers, "#1 of 7" or "39% of total" are ranks and shares: their difference reads wrong.
    if ((ra === undefined || rb === undefined) && /\bof\b/.test(`${va} ${vb}`)) return "";
    const na = ra ?? parseNum(va), nb = rb ?? parseNum(vb);
    return na === null || nb === null ? "" : fmtDelta(na - nb, va);
  };
  if (ea.value || eb.value) rows.push({ k: "Value", a: ea.value ?? "—", b: eb.value ?? "—", d: ea.value && eb.value ? diff(ea.value, eb.value) : "" });
  for (const f of ea.facts ?? []) {
    const g = eb.facts?.find((x) => x.k === f.k);
    if (g) rows.push({ k: f.k, a: f.v, b: g.v, d: diff(f.v, g.v, f.raw, g.raw) });
  }
  return { a: chip(model, a), b: chip(model, b), rows: rows.slice(0, 6) };
}

// ---------- DOM ----------

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const chipButton = (c: Chip, cls = "x-chip") => h("button", cls, c.text, { type: "button", "data-ref": c.id });

export interface CardExtras {
  pin?: boolean;                                 // docked under the figure: a filled dot, the twin of the one beside the anchor
  note?: { n: string; text: string };            // the reading-panel note on this element, listed first
  mentions?: { i: number; text: string }[];      // linked prose sentences, full view only
  back?: Chip;                                   // the previous selection made through a chip
  compare?: boolean;                             // offer "Compare"
  picking?: boolean;                             // compare mode is waiting for the second element
  hide?: boolean;                                // offer "Hide" (a series or group with a legend entry)
  play?: string;                                 // scene id for "Play from here"
}

function head(box: HTMLElement, eyebrowText: string, pin?: boolean) {
  if (!eyebrowText && !pin) return;
  const p = h("p", "x-pop-eyebrow");
  if (pin) p.append(h("span", "x-pop-num", "", { "aria-hidden": "true" }));
  p.append(eyebrowText);
  box.append(p);
}

function actions(box: HTMLElement, x: CardExtras) {
  const row = h("div", "x-pop-actions");
  const btn = (act: string, text: string, attrs: Record<string, string> = {}) => row.append(h("button", "x-pop-act", text, { type: "button", "data-action": act, ...attrs }));
  if (x.back) btn("back", `‹ Back to ${x.back.text}`, { "data-back": x.back.id });
  if (x.picking) row.append(h("span", "x-pop-hint", "Pick an element to compare"));
  else if (x.compare) btn("compare", "Compare");
  if (x.hide) btn("hide", "Hide");
  btn("copy", "Copy link");
  if (x.play) btn("play-scene", "Play from here", { "data-scene": x.play });
  box.append(row);
}

function groups(box: HTMLElement, list: RelGroup[]) {
  for (const g of list) {
    const div = h("div", "x-pop-rel");
    div.append(h("p", "x-pop-k", g.rel));
    const chips = h("div", "x-chips");
    g.chips.forEach((c) => chips.append(chipButton(c)));
    div.append(chips);
    box.append(div);
  }
}

function facts(box: HTMLElement, list: Fact[], note?: CardExtras["note"]) {
  if (!list.length && !note) return;
  const dl = h("dl", "x-pop-facts");
  const row = (k: string, v: HTMLElement | string, tone?: string, cls = "") => {
    const div = h("div", `x-pop-fact${cls}`);
    const dd = h("dd");
    if (tone) dd.dataset.tone = tone;
    dd.append(v);
    div.append(h("dt", "", k), dd);
    dl.append(div);
  };
  // data-note lets the client hide the canvas callout that would repeat this note while the card is open
  if (note) {
    row(`Note ${note.n}`, note.text, undefined, " x-pop-note");
    (dl.lastElementChild as HTMLElement).dataset.note = note.n;
  }
  for (const f of list) row(f.k, f.ref ? chipButton({ id: f.ref, text: f.v }) : f.v, f.tone);
  box.append(dl);
}

/** The card body for one element. `id` prefixes the title id that aria-labelledby points at. */
export function renderCard(d: CardData, popId: string, x: CardExtras = {}): HTMLElement {
  const box = h("div", "x-pop-body");
  head(box, d.eyebrow, x.pin);
  if (d.crumb.length) {
    const p = h("p", "x-pop-crumb");
    d.crumb.forEach((c) => p.append(chipButton(c, "x-crumb"), h("span", "x-crumb-sep", "›", { "aria-hidden": "true" })));
    box.append(p);
  }
  const title = h("h3", "x-pop-title", undefined, { id: `${popId}-t` });
  if (d.ends) title.append(chipButton(d.ends[0], "x-crumb"), h("span", "x-pop-arrow", " → "), chipButton(d.ends[1], "x-crumb"));
  else title.textContent = d.title;
  box.append(title);
  if (d.value) box.append(h("p", "x-pop-value", d.value));
  facts(box, d.facts, x.note);
  if (d.aboutHtml) {
    const about = h("div", "x-pop-about");
    about.innerHTML = d.aboutHtml; // built at build time by safeMarkdown: raw HTML off, safe link schemes only
    box.append(about);
  }
  groups(box, d.groups);
  if (x.mentions?.length) {
    const div = h("div", "x-pop-rel x-pop-mentions");
    div.append(h("p", "x-pop-k", "Mentioned in text ↓"));
    x.mentions.forEach((m) => div.append(h("button", "x-pop-mention", m.text, { type: "button", "data-sent": String(m.i) })));
    box.append(div);
  }
  actions(box, x);
  return box;
}

export function renderCompare(c: CompareData, popId: string, x: CardExtras = {}): HTMLElement {
  const box = h("div", "x-pop-body");
  head(box, "Compare", x.pin);
  const title = h("h3", "x-pop-title", undefined, { id: `${popId}-t` });
  title.append(chipButton(c.a, "x-crumb"), h("span", "x-pop-arrow", " vs "), chipButton(c.b, "x-crumb"));
  box.append(title);
  if (c.rows.length) {
    // Each fact is a label line, then A, B and the difference side by side: three narrow columns fit 300px.
    const t = h("table", "x-pop-cmp");
    const tr = h("tr");
    tr.append(h("th", "", c.a.text, { scope: "col" }), h("th", "", c.b.text, { scope: "col" }), h("th", "", "Δ", { scope: "col" }));
    const thead = h("thead");
    thead.append(tr);
    const tbody = h("tbody");
    for (const r of c.rows) {
      const k = h("tr", "x-pop-cmp-k");
      k.append(h("th", "", r.k, { colspan: "3", scope: "rowgroup" }));
      const row = h("tr");
      row.append(h("td", "", r.a), h("td", "", r.b), h("td", "", r.d || "—"));
      tbody.append(k, row);
    }
    t.append(thead, tbody);
    box.append(t);
  }
  actions(box, { ...x, compare: false });
  return box;
}

/** A step note in the graph: step count and the note, no actions. */
export function renderCallout(count: string, note: string, popId: string, pin?: boolean): HTMLElement {
  const box = h("div", "x-pop-body");
  head(box, count ? `Step ${count}` : "Step", pin);
  box.append(h("p", "x-pop-title x-pop-note-text", note, { id: `${popId}-t` }));
  return box;
}
