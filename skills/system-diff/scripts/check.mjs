#!/usr/bin/env node
// Checks a system-diff report: no network load, no hue, every changed file
// named, a 4–14 word gloss for each named part, and paths only in one closed
// file index. Node 18+, no dependencies. It cannot judge whether a gloss is true.
//
//   git diff --name-only BASE...HEAD | node check.mjs report.html --files -
//   gh pr diff 123 --name-only      | node check.mjs report.html --files -
//
// Options: --files <path|->  changed paths, one per line (required)
//          --allow-hue       report hues as warnings, for an accent the user asked for
// Exits 1 when any error is found.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const at = args.indexOf("--files");
const filesArg = at >= 0 ? args[at + 1] : undefined;
const report = args.find((a, i) => !a.startsWith("--") && i !== at + 1);
const allowHue = args.includes("--allow-hue");

if (!report || !filesArg) {
  console.error("usage: node check.mjs <report.html> --files <list.txt|-> [--allow-hue]");
  process.exit(2);
}

const raw = readFileSync(report, "utf8");
// Embedded images and fonts are data, not styling or requests.
const html = raw.replace(/data:[^"')\s]+/g, "data:");
const changed = readFileSync(filesArg === "-" ? 0 : filesArg, "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean);

const errors = [];
const warnings = [];
const lineOf = (index) => html.slice(0, index).split("\n").length;

// 1. Nothing loads from the network. Plain <a href> links are fine.
const loads = [
  /<(script|img|iframe|source|video|audio|embed|track)\b[^>]*\s(src|srcset|poster)\s*=\s*["']?(https?:)?\/\//gi,
  /<object\b[^>]*\sdata\s*=\s*["']?(https?:)?\/\//gi,
  /<link\b[^>]*\shref\s*=\s*["']?(https?:)?\/\//gi,
  /@import\s+(url\()?\s*["']?(https?:)?\/\//gi,
  /url\(\s*["']?(https?:)?\/\//gi,
];
for (const re of loads) {
  for (const m of html.matchAll(re)) {
    errors.push(`line ${lineOf(m.index)}: loads from the network: ${m[0].slice(0, 80)}`);
  }
}

// 2. Gray only: every colour in CSS values and SVG paint has no hue.
const near = (...v) => Math.max(...v) - Math.min(...v) <= 3;
const num = (s, full) => (s === "none" ? 0 : s.endsWith("%") ? (parseFloat(s) / 100) * full : parseFloat(s));

function hexGray(hex) {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  return near(...[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)));
}
function fnGray(name, body) {
  const p = body.replace(/\/.*$/, "").split(/[\s,]+/).filter(Boolean);
  switch (name) {
    case "rgb": case "rgba": return near(...p.slice(0, 3).map((s) => num(s, 255)));
    case "hsl": case "hsla": return num(p[1], 100) === 0 || [0, 100].includes(num(p[2], 100));
    case "hwb": return num(p[1], 100) + num(p[2], 100) >= 100;
    case "oklch": return num(p[1], 0.4) <= 0.004;
    case "lch": return num(p[1], 150) <= 1;
    case "oklab": return Math.abs(num(p[1], 0.4)) <= 0.004 && Math.abs(num(p[2], 0.4)) <= 0.004;
    case "lab": return Math.abs(num(p[1], 125)) <= 1 && Math.abs(num(p[2], 125)) <= 1;
    default: return true;
  }
}
const hueNames = /\b(red|orange|yellow|green|blue|purple|violet|pink|brown|cyan|magenta|teal|navy|maroon|olive|lime|aqua|fuchsia|indigo|gold|coral|salmon|crimson|tomato|orchid|plum|tan|khaki|beige|ivory|lavender|turquoise|chocolate|firebrick|darkred|darkblue|darkgreen|royalblue|steelblue|skyblue|seagreen|slategray|slategrey)\b/gi;
const notColour = /^(content|font|font-family|grid-template-areas|grid-area|animation|animation-name|transition|transition-property|will-change|quotes|counter-reset|counter-increment|view-transition-name)$/i;

// Declaration values only, so selectors such as #add are not read as colours.
const values = [];
for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
  for (const d of m[1].matchAll(/([-\w]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
    if (!notColour.test(d[1])) values.push([m.index + m[0].indexOf(m[1]) + d.index, d[2]]);
  }
}
for (const m of html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) {
  for (const d of m[1].matchAll(/([-\w]+)\s*:\s*([^;]+)/g)) {
    if (!notColour.test(d[1])) values.push([m.index, d[2]]);
  }
}
for (const m of html.matchAll(/\s(fill|stroke|stop-color|color|flood-color|lighting-color)\s*=\s*"([^"]*)"/gi)) {
  values.push([m.index, m[2]]);
}

for (const [index, value] of values) {
  const hues = [
    ...[...value.matchAll(/#[0-9a-f]{3,8}\b/gi)]
      .filter((m) => [4, 5, 7, 9].includes(m[0].length) && !hexGray(m[0])).map((m) => m[0]),
    ...[...value.matchAll(/\b(rgba?|hsla?|hwb|oklch|oklab|lch|lab)\(([^)]*)\)/gi)]
      .filter((m) => !fnGray(m[1].toLowerCase(), m[2])).map((m) => m[0]),
    ...[...value.matchAll(hueNames)].map((m) => m[0]),
  ];
  for (const hue of hues) {
    (allowHue ? warnings : errors).push(`line ${lineOf(index)}: colour with a hue: ${hue}`);
  }
}

// 3. Every changed file appears by its full repository path.
const text = html.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
const missing = changed.filter((p) => !text.includes(p));
for (const p of missing) errors.push(`changed file not in the report: ${p}`);

const fileRe = /\b[\w.-]+\.(?:ts|tsx|js|mjs|cjs|md|css|json|html|py|rs|go|yml|yaml|toml|svg)\b/i;
const selRe = /(^|[^a-zA-Z0-9])\.[a-zA-Z][\w-]{1,}/;

// 4. Glance glosses, product scenes, and one closed file index.
// A product name is not a definition. The check can see the markers and the
// length. It cannot see whether the clause is true.
const els = parseElements(raw);
const glosses = els.filter((el) => hasAttr(el.raw, "data-gloss"));
const byId = new Map(els.filter((el) => el.id).map((el) => [el.id, el]));
const decision = els.find((el) => attr(el.raw, "data-layer") === "decision");
const parts = els.filter((el) => el.name === "details" && attr(el.raw, "data-part"));
const mapNodes = els.filter((el) => attr(el.raw, "data-part") && el.name !== "details");
const fileIndexes = els.filter((el) => attr(el.raw, "data-layer") === "files");

if (!decision) errors.push("no data-layer=\"decision\"; the answer and its glosses must be one view");
if (glosses.length === 0) errors.push("no glance gloss; the first use of a part needs a 4–14 word clause");

for (const g of glosses) {
  if (!g.id) {
    errors.push("a gloss has no id, so the decision cannot link to it");
    continue;
  }
  const name = attr(g.raw, "data-name");
  if (!name) errors.push(`gloss #${g.id} has no data-name`);
  const clauses = els.filter((el) => el !== g && hasAttr(el.raw, "data-clause") && el.start >= g.openEnd && el.end <= g.innerEnd);
  if (clauses.length !== 1) {
    errors.push(`gloss #${g.id} needs one data-clause, found ${clauses.length}`);
  } else {
    const words = textOf(raw, clauses[0]).split(/\s+/).filter(Boolean);
    if (words.length < 4 || words.length > 14) {
      errors.push(`gloss #${g.id}: clause has ${words.length} words; use 4 to 14`);
    }
    g.clause = words.join(" ");
    g.phrase = name;
  }
}

if (decision) {
  const links = [...inner(raw, decision).matchAll(/<a\b[^>]*href\s*=\s*["']#([^"']+)["'][^>]*>/gi)];
  if (links.length === 0) errors.push("the decision links no name to a gloss");
  const linked = new Set();
  for (const m of links) {
    const target = byId.get(m[1]);
    if (!target || !hasAttr(target.raw, "data-gloss")) {
      errors.push(`decision link #${m[1]} does not land on a gloss`);
    } else linked.add(m[1]);
  }
  // Clauses sit in this view, so a name inside a clause is not a new use.
  const decisionText = textOutside(raw, decision, glosses);
  for (const g of glosses) {
    if (!g.phrase) continue;
    if (hasPhrase(decisionText, g.phrase) && !linked.has(g.id)) {
      errors.push(`decision uses "${g.phrase}" but does not link it to #${g.id}`);
    }
  }
}

for (const node of mapNodes) {
  const id = attr(node.raw, "data-part");
  const g = byId.get(id);
  if (!g || !hasAttr(g.raw, "data-gloss")) {
    errors.push(`map node data-part=\"${id}\" has no gloss`);
    continue;
  }
  if (g.clause && !norm(textOf(raw, node)).includes(norm(g.clause))) {
    errors.push(`map node for #${id} does not repeat its clause`);
  }
}

if (parts.length === 0) errors.push("no part disclosure; changed parts start closed, with at most one open");
const openParts = parts.filter((el) => hasAttr(el.raw, "open"));
if (openParts.length > 1) errors.push(`${openParts.length} parts are open; leave at most one open`);
for (const part of parts) {
  const id = attr(part.raw, "data-part");
  const g = byId.get(id);
  if (!g || !hasAttr(g.raw, "data-gloss")) errors.push(`part data-part=\"${id}\" has no gloss`);
  const body = inner(raw, part);
  if (!/data-scene\s*=\s*["']before["']/i.test(body)) errors.push(`part #${id} has no before scene`);
  if (!/data-scene\s*=\s*["']after["']/i.test(body)) errors.push(`part #${id} has no after scene`);
  if (hasAttr(part.raw, "open") && (fileRe.test(textOf(raw, part)) || selRe.test(textOf(raw, part)))) {
    errors.push(`open part #${id} shows a path or a selector; those stay in the closed file index`);
  }
}

const closedIndex = fileIndexes.filter((el) => el.name === "details" && !hasAttr(el.raw, "open"));
if (closedIndex.length === 0) errors.push("no closed file index; put every path in one closed details data-layer=\"files\"");
for (const el of fileIndexes) {
  const covered = closedIndex.some((box) => el === box || (el.start >= box.openEnd && el.end <= box.innerEnd));
  if (!covered) errors.push("a files marker sits outside the closed file index, so paths can show on the first screen");
}

const prose = proseOutside(raw, closedIndex);
if (fileRe.test(prose)) {
  const hit = prose.match(fileRe);
  errors.push(`path outside the file index: ${hit[0]}`);
}
if (selRe.test(prose)) {
  const hit = prose.match(selRe);
  errors.push(`selector outside the file index: ${hit[0].trim()}`);
}

// 5. Small things that recur in rejected reports.
if (!/<meta\b[^>]*name\s*=\s*["']?viewport/i.test(html)) {
  warnings.push("no viewport meta tag; the page will not fit a phone");
}
if (/color-scheme\s*:[^;}]*dark/i.test(html) || /prefers-color-scheme\s*:\s*dark/i.test(html)) {
  warnings.push("the page has a dark scheme; the report is light only");
}
for (const m of html.matchAll(/text-transform\s*:\s*uppercase/gi)) {
  warnings.push(`line ${lineOf(m.index)}: uppercase text often reads as kicker text`);
}

function tagEnd(html, i) {
  let quote = null;
  for (let j = i + 1; j < html.length; j++) {
    const c = html[j];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\"" || c === "'") { quote = c; continue; }
    if (c === ">") return j;
  }
  return -1;
}

function parseElements(html) {
  const out = [];
  const stack = [];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (!/^<\/?[a-zA-Z]/.test(html.slice(lt, lt + 3))) { i = lt + 1; continue; }
    const end = tagEnd(html, lt);
    if (end < 0) break;
    const rawTag = html.slice(lt, end + 1);
    const name = (rawTag.match(/^<\/?([a-zA-Z][\w:-]*)/) || [])[1];
    if (!name) { i = lt + 1; continue; }
    if (rawTag.startsWith("</")) {
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].name === name.toLowerCase()) {
          const el = stack[s];
          el.innerEnd = lt;
          el.end = end + 1;
          out.push(el);
          stack.length = s;
          break;
        }
      }
      i = end + 1;
      continue;
    }
    const el = { name: name.toLowerCase(), raw: rawTag, start: lt, openEnd: end + 1, id: attr(rawTag, "id") };
    const self = /\/>$/.test(rawTag) || voidTags.has(el.name);
    if (self) {
      el.innerEnd = end + 1;
      el.end = end + 1;
      out.push(el);
    } else stack.push(el);
    i = end + 1;
  }
  return out;
}

function attr(raw, name) {
  const m = raw.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i"));
  if (!m) return undefined;
  return (m[2] ?? m[3] ?? m[4] ?? "").trim();
}
function hasAttr(raw, name) {
  return new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|/?>|$)`, "i").test(raw);
}
function inner(html, el) {
  return html.slice(el.openEnd, el.innerEnd ?? el.openEnd);
}
function textOf(html, el) {
  return inner(html, el).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function textOutside(html, el, skips) {
  let out = "";
  let i = el.openEnd;
  const ranges = skips
    .filter((s) => s.start >= el.openEnd && s.end <= el.innerEnd)
    .map((s) => [s.start, s.end])
    .sort((a, b) => a[0] - b[0]);
  for (const [from, to] of ranges) {
    if (from > i) out += html.slice(i, from);
    i = Math.max(i, to);
  }
  out += html.slice(i, el.innerEnd);
  return out.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function norm(s) { return s.replace(/\s+/g, " ").trim(); }
function hasPhrase(text, phrase) {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "iu").test(text);
}
function proseOutside(html, boxes) {
  let out = "";
  let i = 0;
  const skips = [];
  const style = [...html.matchAll(/<style\b[\s\S]*?<\/style>/gi), ...html.matchAll(/<script\b[\s\S]*?<\/script>/gi)];
  for (const box of boxes) skips.push([box.start, box.end]);
  for (const m of style) skips.push([m.index, m.index + m[0].length]);
  skips.sort((a, b) => a[0] - b[0]);
  for (const [from, to] of skips) {
    if (to <= i) continue;
    if (from > i) out += html.slice(i, from);
    i = Math.max(i, to);
  }
  out += html.slice(i);
  return out.replace(/<[^>]+>/g, " ");
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`error ${e}`);
console.log(`${changed.length - missing.length}/${changed.length} changed files named, ` +
  `${errors.length} errors, ${warnings.length} warnings, ${(raw.length / 1024).toFixed(0)} KB`);
process.exit(errors.length ? 1 : 0);
