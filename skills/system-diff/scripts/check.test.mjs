// Proves each claim in the header of check.mjs. Run: node --test scripts/check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "system-diff-check-"));
const script = new URL("./check.mjs", import.meta.url).pathname;
const changed = "src/card/popover.ts\nREADME.md\n";

function run(body, ...flags) {
  const file = join(dir, `r${Math.random().toString(36).slice(2)}.html`);
  writeFileSync(file, `<!doctype html><meta name="viewport" content="width=device-width">${body}`);
  try {
    return { code: 0, out: execFileSync("node", [script, file, "--files", "-", ...flags], { input: changed }).toString() };
  } catch (e) {
    return { code: e.status, out: e.stdout.toString() };
  }
}
const files = `<section id="files"><h2>Files</h2><p>src/card/popover.ts</p><p>README.md</p></section>`;
const good = `<style>body{color:#111;background:#fff;border:1px solid rgb(221 221 221)}</style>
<h1>The card shows each fact once</h1><p>Merge it.</p>${files}`;

test("a gray report that names every file passes", () => {
  const r = run(good);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2\/2 changed files named/);
  assert.match(r.out, /no unified hunk/);
});

test("a unified hunk clears the hunk warning", () => {
  const r = run(good.replace("<p>src/card/popover.ts</p>", "<pre>@@ -1 +1 @@\nsrc/card/popover.ts</pre>"));
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /no unified hunk/);
});

test("hues fail in CSS, style attributes and SVG paint, by any notation", () => {
  for (const hue of ["#c2410c", "rgb(200 40 40)", "hsl(20 80% 40%)", "oklch(60% 0.15 40)", "darkorange", "rebeccapurple", "snow"]) {
    assert.equal(run(`<style>p{color:${hue}}</style>${files}`).code, 1, hue);
  }
  assert.equal(run(`<p style="border-color: tomato">x</p>${files}`).code, 1);
  assert.equal(run(`<svg><rect fill="#0b6bcb"/></svg>${files}`).code, 1);
});

test("grays, token names and references are not hues", () => {
  const r = run(`<style>:root{--red:#555}p{color:var(--red);fill:url(#arrow-green);background:whitesmoke;border-color:oklch(50% 0 none)}</style>${files}`);
  assert.equal(r.code, 0, r.out);
});

test("--allow-hue turns hues into warnings", () => {
  const r = run(`<style>p{color:#c00}</style>${files}`, "--allow-hue");
  assert.equal(r.code, 0);
  assert.match(r.out, /warn .*colour with a hue/);
});

test("a colour set by a script only warns", () => {
  const r = run(`<script>el.style.fill = "#c00";</script>${files}`);
  assert.equal(r.code, 0);
  assert.match(r.out, /warn .*script holds colours/);
});

test("a load from the network fails; a plain link does not", () => {
  assert.equal(run(`<script src="https://cdn.example.com/x.js"></script>${files}`).code, 1);
  assert.equal(run(`<style>@import url("//fonts.example.com/a.css");</style>${files}`).code, 1);
  assert.equal(run(`<a href="https://github.com/acme/shop/pull/1">PR</a>${files}`).code, 0);
});

test("a changed file the report does not name fails", () => {
  const r = run(`<section id="files"><p>src/card/popover.ts</p></section>`);
  assert.equal(r.code, 1);
  assert.match(r.out, /not in the report: README.md/);
});

test("the file layer must exist", () => {
  const r = run(`<p>src/card/popover.ts README.md</p>`);
  assert.equal(r.code, 1);
  assert.match(r.out, /no element with id="files"/);
});

test("a path above the file layer fails, even a partial one; a file name or code only warns", () => {
  assert.match(run(`<p>Option a: edit src/card/popover.ts.</p>${files}`).out, /error .*path above the file layer: src\/card\/popover.ts/);
  assert.match(run(`<p>Option a: edit card/popover.ts.</p>${files}`).out, /error .*path above the file layer: card\/popover.ts/);
  const r = run(`<p>The README.md line changes; <code>sayOnce()</code> filters.</p>${files}`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /file names above the file layer: README.md/);
  assert.match(r.out, /code above the file layer.*sayOnce\(\)/);
});

test("--text prints the reader's text above the file layer, map labels included", () => {
  const file = join(dir, "text.html");
  writeFileSync(file, `<head><title>Answer</title><style>p{color:#111}</style></head><h1>Answer</h1><svg><text>The card</text><text>opens on a click</text></svg>
<p>Keep <code>main</code>.</p><script>const x = 1;</script>${files}`);
  const out = execFileSync("node", [script, file, "--text"]).toString();
  assert.equal(out.trim(), "Answer\nThe card\nopens on a click\nKeep main.");
});

test("the summary counts the words above the file layer and those shown before any fold", () => {
  const r = run(`<h1>One two</h1><details><summary>Three</summary><p>four five six</p></details>
<details open><summary>Seven</summary><p>eight</p></details>${files}`);
  assert.match(r.out, /8 words above the file layer \(5 before any fold\)/);
});

test("a relative file, file:// or an encoded URL is a linked asset; data: and #fragments are not", () => {
  for (const body of [
    '<script src="app.js"></script>', '<img src="shot.png">', "<img src='shot.png'>", "<img src=shot.png>",
    '<img src="file:///tmp/shot.png">', '<img src="&#104;ttps://example.org/a.png">', '<link href="theme.css" rel="stylesheet">',
    '<iframe src="child.html"></iframe>', '<object data="figure.svg"></object>', '<svg><image href="figure.svg"/></svg>',
    '<svg><use xlink:href="shapes.svg#part"/></svg>', '<video poster="poster.png"></video>', '<img srcset="shot.png 1x, shot-2x.png 2x">',
    '<p style="background:url(shot.png)">x</p>',
  ]) {
    const r = run(`${body}${files}`);
    assert.equal(r.code, 1, body);
    assert.match(r.out, /linked asset/, body);
  }
  assert.equal(run(`<style>body{background:url(shot.png)}</style>${files}`).code, 1);
  const r = run(`<img src="data:image/png;base64,AA=="><img srcset="data:image/png;base64,AA== 1x, data:image/png;base64,BB== 2x">
<svg><use href="#shape"/></svg><style>p{filter:url(#blur)}</style>${files}`);
  assert.equal(r.code, 0, r.out);
});

test("hues in single-quoted style and paint attributes fail", () => {
  assert.equal(run(`<p style='color:red'>x</p>${files}`).code, 1);
  assert.equal(run(`<svg><rect fill='red'/></svg>${files}`).code, 1);
});

test("markup inside a script or a diff is not checked as markup", () => {
  assert.equal(run(`<script>const x = \`<img src="shot.png"><rect fill="red">\`;</script>${files}`).code, 0);
  assert.equal(run(`<pre>&lt;img src="remote.png"&gt; &lt;rect fill="red"&gt;</pre>${files}`).code, 0);
});

test("a changed file named only in a comment, an attribute, a style or a script is not named", () => {
  for (const hidden of ['<!-- README.md -->', '<div data-file="README.md"></div>', '<style>/* README.md */</style>', '<script>const f = "README.md"</script>']) {
    const r = run(`${hidden}<section id="files"><p>src/card/popover.ts</p></section>`);
    assert.equal(r.code, 1, hidden);
    assert.match(r.out, /not in the report: README.md/, hidden);
  }
  assert.equal(run(`<section id="files"><p>src/card/popover.ts</p><p>READ&#77;E.md</p></section>`).code, 0);
});

test("an id=\"files\" inside a comment does not move the file layer", () => {
  const r = run(`<!-- <section id="files"> --><p>Option a: edit src/card/popover.ts.</p>${files}`);
  assert.equal(r.code, 1);
  assert.match(r.out, /path above the file layer: src\/card\/popover.ts/);
});
