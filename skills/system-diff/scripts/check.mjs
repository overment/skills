#!/usr/bin/env node
// Static checks: no linked asset, no hue, every changed file in visible text,
// and no changed path above the file layer. It does not judge whether a gloss
// is true. Node 18+, no dependencies.
//
//   git diff --name-only BASE...HEAD | node check.mjs report.html --files -
//
// Options: --files <path|->  changed paths, one per line (required)
//          --allow-hue       report hues as warnings
//          --text            print the text above the file layer, then exit 0
// Exits 1 when any error is found. --text does not change that.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const at = args.indexOf("--files");
const filesArg = at >= 0 ? args[at + 1] : undefined;
const report = args.find((a, i) => !a.startsWith("--") && i !== at + 1);
const allowHue = args.includes("--allow-hue");
const textOnly = args.includes("--text");

if (!report || !filesArg) {
  console.error("usage: node check.mjs <report.html> --files <list.txt|-> [--allow-hue] [--text]");
  process.exit(2);
}

const raw = readFileSync(report, "utf8");
const html = raw.replace(/data:[^"')\s]+/g, "data:");
const changed = readFileSync(filesArg === "-" ? 0 : filesArg, "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean);

const errors = [];
const warnings = [];
const lineOf = (index) => html.slice(0, index).split("\n").length;
const mask = (s) => s.replace(/[^\n]/g, " ");
const decode = (s) => s.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) =>
  String.fromCodePoint(n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n)))
  .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");

// Comments are not tags and not reader text. Mask them so a fake id="files" cannot hide a path.
const markup = html.replace(/<!--[\s\S]*?-->/g, mask);
const tags = [...markup.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi,
  (_, open, _name, body, close) => open + mask(body) + close)
  .matchAll(/<([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)];

const inline = (value) => /^(data:|#)/i.test(decode(value).trim());
for (const tag of tags.filter((t) => /^(script|img|iframe|source|video|audio|embed|track|object|link|image|use|input)$/i.test(t[1]))) {
  for (const attr of tag[0].matchAll(/\s(src|srcset|poster|data|(?:xlink:)?href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const value = attr[2] ?? attr[3] ?? attr[4];
    const selfContained = attr[1].toLowerCase() === "srcset"
      ? /^data:(?:\s+[\d.]+[wx])?(?:\s*,\s*data:(?:\s+[\d.]+[wx])?)*$/i.test(value.trim()) : inline(value);
    if (!selfContained) errors.push(`line ${lineOf(tag.index)}: linked asset: ${value.slice(0, 80)}`);
  }
}
const css = [...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
for (const tag of tags) {
  for (const m of tag[0].matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) css.push(m[1] ?? m[2]);
}
for (const style of css) {
  for (const m of style.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) {
    if (!inline(m[1])) errors.push(`linked CSS asset: ${m[1].slice(0, 80)}`);
  }
  if (/@import\b/i.test(style)) errors.push("CSS @import is not self-contained; inline the stylesheet");
}

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
// Named colours except the grays. var(--red) and url(#arrow) are tokens, not paint.
const hueNames = new RegExp(`\\b(${[
  "aliceblue antiquewhite aqua aquamarine azure beige bisque blanchedalmond blue blueviolet brown burlywood",
  "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod",
  "darkgreen darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen",
  "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dodgerblue firebrick",
  "floralwhite forestgreen fuchsia ghostwhite gold goldenrod green greenyellow honeydew hotpink indianred indigo",
  "ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow",
  "lightgreen lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue",
  "lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple",
  "mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream",
  "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen",
  "paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown",
  "royalblue saddlebrown salmon sandybrown seagreen seashell sienna skyblue slateblue slategray slategrey snow",
  "springgreen steelblue tan teal thistle tomato turquoise violet wheat yellow yellowgreen",
].join(" ").split(/\s+/).join("|")})\\b`, "gi");
const notColour = /^(content|font|font-family|grid-template-areas|grid-area|animation|animation-name|transition|transition-property|will-change|quotes|counter-reset|counter-increment|view-transition-name)$/i;
const paintOf = (value) => value.replace(/var\([^)]*\)/gi, " ").replace(/url\([^)]*\)/gi, " ");

const values = [];
for (const m of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
  for (const d of m[1].matchAll(/([-\w]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
    if (!notColour.test(d[1])) values.push([m.index + m[0].indexOf(m[1]) + d.index, d[2]]);
  }
}
for (const tag of tags) {
  for (const m of tag[0].matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const d of (m[1] ?? m[2]).matchAll(/([-\w]+)\s*:\s*([^;]+)/g)) {
      if (!notColour.test(d[1])) values.push([tag.index, d[2]]);
    }
  }
  for (const m of tag[0].matchAll(/\s(fill|stroke|stop-color|color|flood-color|lighting-color)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    values.push([tag.index, m[2] ?? m[3]]);
  }
}
for (const [index, value] of values) {
  const paint = paintOf(value);
  const hues = [
    ...[...paint.matchAll(/#[0-9a-f]{3,8}\b/gi)].filter((m) => [4, 5, 7, 9].includes(m[0].length) && !hexGray(m[0])).map((m) => m[0]),
    ...[...paint.matchAll(/\b(rgba?|hsla?|hwb|oklch|oklab|lch|lab)\(([^)]*)\)/gi)].filter((m) => !fnGray(m[1].toLowerCase(), m[2])).map((m) => m[0]),
    ...[...paint.matchAll(hueNames)].map((m) => m[0]),
  ];
  for (const hue of hues) (allowHue ? warnings : errors).push(`line ${lineOf(index)}: colour with a hue: ${hue}`);
}

function tagEnd(source, i) {
  let quote = null;
  for (let j = i + 1; j < source.length; j++) {
    const c = source[j];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ">") return j;
  }
  return -1;
}
function filesRanges(source) {
  const ranges = [];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt < 0) break;
    if (!/^<[a-zA-Z]/.test(source.slice(lt, lt + 2))) { i = lt + 1; continue; }
    const end = tagEnd(source, lt);
    if (end < 0) break;
    const rawTag = source.slice(lt, end + 1);
    if (/\sid\s*=\s*["']files["']/i.test(rawTag)) {
      const name = rawTag.match(/^<([a-zA-Z][\w:-]*)/)[1];
      let depth = 1;
      let k = end + 1;
      while (k < source.length && depth > 0) {
        const n = source.indexOf("<", k);
        if (n < 0) break;
        const ne = tagEnd(source, n);
        if (ne < 0) break;
        const t = source.slice(n, ne + 1);
        const nm = t.match(/^<\/?([a-zA-Z][\w:-]*)/);
        if (nm && nm[1].toLowerCase() === name.toLowerCase()) depth += t.startsWith("</") ? -1 : 1;
        k = ne + 1;
        if (depth === 0) ranges.push([lt, k]);
      }
    }
    i = end + 1;
  }
  return ranges;
}

const files = filesRanges(markup);
if (files.length !== 1) errors.push(`file layer id="files" appears ${files.length} times; use one element`);
function cut(source, ranges) {
  let out = "";
  let i = 0;
  for (const [from, to] of ranges) {
    if (from > i) out += source.slice(i, from);
    i = Math.max(i, to);
  }
  return out + source.slice(i);
}
function visible(source) {
  return decode(source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim();
}
const reader = visible(markup);
const above = visible(cut(markup, files));
const missing = changed.filter((p) => !reader.includes(p));
for (const p of missing) errors.push(`changed file not in the report: ${p}`);
for (const p of changed) {
  const parts = p.split("/");
  const leaks = [p];
  for (let n = 1; n < parts.length; n++) leaks.push(parts.slice(n).join("/"));
  for (const leak of leaks) {
    if (leak.length > 1 && above.includes(leak)) errors.push(`changed path above the file layer: ${leak}`);
  }
}
const filesText = files.length === 1 ? markup.slice(files[0][0], files[0][1]) : "";
if (changed.length && !filesText.includes("@@")) {
  warnings.push("file layer has no unified hunk; the reader cannot reach a changed line");
}

if (!/<meta\b[^>]*name\s*=\s*["']?viewport/i.test(html)) warnings.push("no viewport meta tag; the page will not fit a phone");
if (/color-scheme\s*:[^;}]*dark/i.test(html) || /prefers-color-scheme\s*:\s*dark/i.test(html)) {
  warnings.push("the page has a dark scheme; the report is light only");
}

if (textOnly) {
  console.log(above);
  process.exit(errors.length ? 1 : 0);
}
for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`error ${e}`);
const words = above ? above.split(/\s+/).filter(Boolean).length : 0;
console.log(`${changed.length - missing.length}/${changed.length} changed files named, ` +
  `${words} words above the file layer, ${errors.length} errors, ${warnings.length} warnings, ${(raw.length / 1024).toFixed(0)} KB`);
process.exit(errors.length ? 1 : 0);
