#!/usr/bin/env node
// Checks a system-diff report. Node 18+, no dependencies.
//
//   git diff --name-only BASE...HEAD | node check.mjs report.html --files -
//   gh pr diff 123 --name-only      | node check.mjs report.html --files -
//   node check.mjs report.html --text      # the page above the file layer, as plain text
//
// Errors: anything the page loads from outside itself (network or a relative file); a colour
// with a hue in CSS, a style attribute or SVG paint; a changed file the report's text does not
// name (comments, attributes and scripts don't count); a changed file's path above the file
// layer (the element with id="files"; one inside a comment doesn't count); no file layer.
// Warnings: a changed file's name or any <code> above the file layer; a colour a script sets;
// no viewport; a dark scheme; uppercase text.
// It also counts the words above the file layer, and those a reader sees before opening a <details> fold.
// It does not resolve colours that a script computes, and it can't tell whether a gloss is
// clear: feed --text to a reader who doesn't know the system for that.
//
// Options: --files <path|->  changed paths, one per line (required unless --text)
//          --allow-hue       report hues as warnings, for an accent the user asked for
//          --text            print the text above the file layer and exit
// Exits 1 when any error is found.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const at = args.indexOf("--files");
const filesArg = at >= 0 ? args[at + 1] : undefined;
const report = args.find((a, i) => !a.startsWith("--") && !(at >= 0 && i === at + 1));
const allowHue = args.includes("--allow-hue");
const textOnly = args.includes("--text");

if (!report || (!filesArg && !textOnly)) {
  console.error("usage: node check.mjs <report.html> --files <list.txt|-> [--allow-hue]\n" +
    "       node check.mjs <report.html> --text");
  process.exit(2);
}

const raw = readFileSync(report, "utf8");
// Embedded images and fonts are data, not styling or requests.
const html = raw.replace(/data:[^"')\s]+/g, "data:");
const lineOf = (index) => html.slice(0, index).split("\n").length;
const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&minus;/g, "−")
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0] === "x" || n[0] === "X" ? parseInt(n.slice(1), 16) : +n))
  .replace(/&amp;/g, "&");

// Comments and the bodies of scripts and styles are not markup. Blanking them keeps every offset,
// so line numbers stay right and a comment can't move the file layer or name a file.
const blank = (s) => s.replace(/[^\n]/g, " ");
const blankBodies = (s, tag) => s.replace(new RegExp(`(<${tag}\\b[^>]*>)([\\s\\S]*?)(</${tag}>)`, "gi"),
  (_, open, body, close) => open + blank(body) + close);
const noComments = html.replace(/<!--[\s\S]*?-->/g, blank);
const noScripts = blankBodies(noComments, "script");
const markup = blankBodies(noScripts, "style");
const tags = [...markup.matchAll(/<([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)];

// The file layer starts at the element with id="files"; layers 1–4 are everything before it.
const filesAt = markup.search(/<[a-z][\w-]*\b[^>]*\sid\s*=\s*["']?files["'\s>]/i);
const upper = html.slice(0, filesAt >= 0 ? filesAt : html.length);
const visible = (part) => decode(part
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<(head|script|style|template)\b[\s\S]*?<\/\1>/gi, "")
  .replace(/<\/(p|li|h[1-6]|div|section|article|header|footer|tr|td|th|dt|dd|summary|details|text|tspan|title|figcaption|caption|ol|ul|dl|table|g)>|<br\s*\/?>/gi, "\n")
  .replace(/<\/?(a|abbr|b|code|dfn|em|i|kbd|mark|q|s|small|strong|sub|sup|u|var)\b[^>]*>/gi, "")
  .replace(/<[^>]+>/g, " "))
  .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");

// What a reader sees before opening anything: closed <details> folds keep only their <summary>.
function unfolded(part) {
  let prev;
  do {
    prev = part;
    part = part.replace(/<details\b(?![^>]*\sopen\b)[^>]*>((?:(?!<details\b)[\s\S])*?)<\/details>/gi,
      (_, body) => (body.match(/<summary\b[\s\S]*?<\/summary>/i) ?? [""])[0]);
  } while (part !== prev);
  return part;
}
const count = (t) => (t.match(/\S+/g) ?? []).length;

if (textOnly) {
  console.log(visible(upper));
  if (filesAt < 0) console.error('warn  no element with id="files"; printed the whole page');
  process.exit(0);
}

const changed = readFileSync(filesArg === "-" ? 0 : filesArg, "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean);
const errors = [];
const warnings = [];

// Style sheets without their comments, and style attributes; both quote styles.
const sheets = [...noScripts.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  .map((m) => [m.index + m[0].indexOf(m[1]), m[1].replace(/\/\*[\s\S]*?\*\//g, blank)]);
const styleAttrs = tags.flatMap((t) => [...t[0].matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)]
  .map((m) => [t.index, m[1] ?? m[2]]));

// 1. The page loads nothing from outside itself: not from the network, and not a relative file,
// which breaks once the page is sent on. Plain <a href> links are fine; data: and #fragments are inline.
const inline = (v) => /^(data:|#)/i.test(decode(v).trim());
for (const t of tags.filter((t) => /^(script|img|iframe|source|video|audio|embed|track|object|link|image|use|input)$/i.test(t[1]))) {
  for (const a of t[0].matchAll(/\s(src|srcset|poster|data|(?:xlink:)?href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const v = a[2] ?? a[3] ?? a[4];
    const ok = a[1].toLowerCase() === "srcset"
      ? v.split(",").every((c) => inline(c.trim().split(/\s+/)[0])) : inline(v);
    if (!ok) errors.push(`line ${lineOf(t.index)}: linked asset; the page must work as one file: ${v.slice(0, 80)}`);
  }
}
for (const [index, css] of [...sheets, ...styleAttrs]) {
  for (const m of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) {
    if (!inline(m[1])) errors.push(`line ${lineOf(index)}: linked asset in CSS: ${m[1].slice(0, 80)}`);
  }
  if (/@import\b/i.test(css)) errors.push(`line ${lineOf(index)}: linked asset: CSS @import; inline the style sheet`);
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
// Every CSS named colour except the grays (black, white, silver, gainsboro, whitesmoke, *gray, *grey).
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
].join(" ").split(" ").join("|")})\\b`, "gi");
const notColour = /^(content|font|font-family|grid-template-areas|grid-area|animation|animation-name|transition|transition-property|will-change|quotes|counter-reset|counter-increment|view-transition-name)$/i;

// Declaration values only, so selectors such as #add are not read as colours.
const values = [];
for (const [index, css] of sheets) {
  for (const d of css.matchAll(/([-\w]+)\s*:\s*([^;{}]+)(?=[;}])/g)) {
    if (!notColour.test(d[1])) values.push([index + d.index, d[2]]);
  }
}
for (const [index, css] of styleAttrs) {
  for (const d of css.matchAll(/([-\w]+)\s*:\s*([^;]+)/g)) {
    if (!notColour.test(d[1])) values.push([index, d[2]]);
  }
}
for (const t of tags) {
  for (const m of t[0].matchAll(/\s(fill|stroke|stop-color|color|flood-color|lighting-color)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    values.push([t.index, m[2] ?? m[3]]);
  }
}

for (const [index, rawValue] of values) {
  // A token's name (var(--red)) or a reference (url(#arrow-green)) is not a colour.
  const value = rawValue.replace(/var\(\s*--[-\w]+/g, "var(").replace(/url\([^)]*\)/g, "url()");
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

// A script can set colours too. Its strings may also be embedded code, so this only warns.
for (const m of noComments.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  const literals = [
    ...[...m[1].matchAll(/["'`](#[0-9a-f]{3,8})["'`]/gi)]
      .filter((c) => [4, 5, 7, 9].includes(c[1].length) && !hexGray(c[1])).map((c) => c[1]),
    ...[...m[1].matchAll(/\b(rgba?|hsla?|hwb|oklch|oklab|lch|lab)\(([^)]*)\)/gi)]
      .filter((c) => !/[a-z_$]/i.test(c[2].replace(/none|deg|turn|rad|%/g, "")) && !fnGray(c[1].toLowerCase(), c[2]))
      .map((c) => c[0]),
  ];
  if (literals.length) {
    warnings.push(`line ${lineOf(m.index)}: a script holds colours with a hue: ${[...new Set(literals)].slice(0, 5).join(", ")}`);
  }
}

// 3. Every changed file appears by its full repository path, in text a reader sees:
// a path in a comment, an attribute, a script or a style does not count.
const text = decode(markup.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " "));
const missing = changed.filter((p) => !text.includes(p));
for (const p of missing) errors.push(`changed file not in the report: ${p}`);

// 4. Paths and code stay in the file layer.
if (filesAt < 0) {
  errors.push('no element with id="files"; the file layer must have it, so code names can be kept below it');
} else {
  const above = visible(upper);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const said = (s) => new RegExp(`(^|[^\\w./-])${esc(s)}($|[^\\w/-])`).test(above);
  // A path counts from its last two segments on ("references/format.md"); a bare file name only warns.
  const names = new Set();
  for (const p of changed) {
    const seg = p.split("/");
    const path = seg.slice(0, -1).map((_, k) => seg.slice(k).join("/")).find(said);
    if (path) errors.push(`changed file's path above the file layer: ${path}`);
    else if (/\.\w+$/.test(seg.at(-1)) && said(seg.at(-1))) names.add(seg.at(-1));
  }
  if (names.size) warnings.push(`file names above the file layer: ${[...names].slice(0, 8).join(", ")}`);
  const code = [...new Set([...upper.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, "")).trim()))]
    .filter(Boolean);
  if (code.length) {
    warnings.push(`code above the file layer (fine only in the meta line): ${code.slice(0, 10).join(" · ")}` +
      (code.length > 10 ? ` · and ${code.length - 10} more` : ""));
  }
  // A file list without a hunk cannot reach a changed line. A warning, not an error:
  // an agent run that keeps hunks in another shape should still pass.
  if (changed.length && !html.slice(filesAt).includes("@@")) {
    warnings.push("file layer has no unified hunk; the reader cannot reach a changed line");
  }
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

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`error ${e}`);
const words = filesAt >= 0 ? `${count(visible(upper))} words above the file layer ` +
  `(${count(visible(unfolded(upper)))} before any fold), ` : "";
console.log(`${changed.length - missing.length}/${changed.length} changed files named, ${words}` +
  `${errors.length} errors, ${warnings.length} warnings, ` +
  `${(raw.length / 1024).toFixed(0)} KB`);
process.exit(errors.length ? 1 : 0);
