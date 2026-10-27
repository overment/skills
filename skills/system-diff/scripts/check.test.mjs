#!/usr/bin/env node
// Run: node --test skills/system-diff/scripts/check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const checker = fileURLToPath(new URL("./check.mjs", import.meta.url));
const page = (body, files = "<pre>@@ -1 +1 @@\nsrc/part.ts</pre>") =>
  `<!doctype html><meta name="viewport" content="width=device-width"><style>body{color:#111;background:#fff}</style>${body}<section id="files">${files}</section>`;
function check(html, files = "src/part.ts\n", options = []) {
  const dir = mkdtempSync(join(tmpdir(), "system-diff-check-"));
  try {
    const report = join(dir, "report.html");
    writeFileSync(report, html);
    const result = spawnSync(process.execPath, [checker, report, "--files", "-", ...options], { input: files, encoding: "utf8" });
    return { status: result.status, out: result.stdout + result.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a gray page that names the file in the file layer passes", () => {
  assert.equal(check(page("<p>Keep it.</p>")).status, 0);
});
test("a relative image fails", () => {
  const result = check(page('<img src="shot.png"><p>Keep it.</p>'));
  assert.equal(result.status, 1);
  assert.match(result.out, /linked asset/);
});
test("a single-quoted hue fails", () => {
  assert.equal(check(page("<p style='color:red'>Keep it.</p>")).status, 1);
});
test("a named colour fails; a token does not", () => {
  assert.equal(check(page("<p>Keep it.</p>", '<pre>@@\nsrc/part.ts</pre>').replace("#111", "darkorange")).status, 1);
  assert.equal(check(page("<p style=\"color:var(--red)\">Keep it.</p>")).status, 0);
});
test("a path only in a comment does not count", () => {
  const result = check(page("<!-- src/part.ts --><p>Keep it.</p>", "<pre>@@</pre>"));
  assert.equal(result.status, 1);
  assert.match(result.out, /changed file not in the report/);
});
test("a changed path above the file layer fails, including after a fake files comment", () => {
  const result = check(`<!-- <section id="files">src/part.ts</section> -->` + page("<p>See src/part.ts</p>"));
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /changed path above the file layer: src\/part\.ts/);
});
test("Node.js in prose is not a path", () => {
  assert.equal(check(page("<p>Risk: needs Node.js 18 to build.</p>")).status, 0);
});
test("a missing hunk warns and does not hide another error", () => {
  const warn = check(page("<p>Keep it.</p>", "<pre>src/part.ts</pre>"));
  assert.equal(warn.status, 0);
  assert.match(warn.out, /no unified hunk/);
  const both = check(page('<img src="shot.png"><p>Keep it.</p>', "<pre>src/part.ts</pre>"));
  assert.equal(both.status, 1);
  assert.match(both.out, /linked asset/);
});
