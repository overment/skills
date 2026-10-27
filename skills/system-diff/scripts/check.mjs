#!/usr/bin/env node
// Checks a system-diff report: it loads nothing from the network, uses no hue,
// and names every changed file. Node 18+, no dependencies.
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

// 4. Small things that recur in rejected reports.
if (!/<meta\b[^>]*name\s*=\s*["']?viewport/i.test(html)) {
  warnings.push("no viewport meta tag; the page will not fit a phone");
}
if (/color-scheme\s*:[^;}]*dark/i.test(html) || /prefers-color-scheme\s*:\s*dark/i.test(html)) {
  warnings.push("the page has a dark scheme; the report is light only");
}
for (const m of html.matchAll(/text-transform\s*:\s*uppercase/gi)) {
  warnings.push(`line ${lineOf(m.index)}: uppercase text often reads as kicker text`);
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`error ${e}`);
console.log(`${changed.length - missing.length}/${changed.length} changed files named, ` +
  `${errors.length} errors, ${warnings.length} warnings, ${(raw.length / 1024).toFixed(0)} KB`);
process.exit(errors.length ? 1 : 0);
