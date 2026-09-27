/// <reference lib="dom" />
import { mkdir, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseDoc } from "../engine/parse.ts";
import { buildPage } from "../engine/page.ts";
import { loadTheme, themeCss } from "../engine/theme.ts";
import type { CommandRun, FrontMatter, Segment } from "../engine/types.ts";
import { chromeAvailable, withBrowser, type Page } from "../lib/cdp.ts";
import { usage } from "../lib/commands.ts";
import { pickStates } from "./audit.ts";
import { relPath } from "./build.ts";
import { captureHash, cropBox, display, openState } from "./shot.ts";

const USAGE = usage("gallery");
const SKILL_ROOT = resolve(import.meta.dir, "../..");
const MODES = ["light", "dark"] as const;
const VIEWS = ["bare", "full"] as const;

/** Gallery sections, in order. A document lands in the family of its first block. */
const FAMILIES: [name: string, kinds: string[]][] = [
  ["Flows and systems", ["flow", "zones", "hub", "layers", "tree", "cycle", "states", "sequence", "swimlane"]],
  ["Charts", ["bar", "line", "slope", "bump", "scatter", "beeswarm", "waterfall", "dumbbell", "heatmap", "treemap", "marimekko", "funnel", "pyramid", "sankey", "radar", "polar", "venn", "quadrant"]],
  ["Plans and boards", ["gantt", "timeline", "kanban", "journey", "storymap"]],
  ["Structures", ["schema", "uml", "fishbone", "wardley", "nested", "matrix", "compare"]],
];

interface Entry {
  slug: string;
  family: string;
  front: FrontMatter;
  kinds: string[];
  states: { label: string; hash: string }[];
  errors: number;
  /** Set while capturing: the id shown selected, and the matrix/compare blocks captured on their own. */
  sel?: string;
  blocks: { id: string; kind: string }[];
  shots: Set<string>;
}

export const run: CommandRun = async (argv) => {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { src: { type: "string", multiple: true }, "no-shots": { type: "boolean" }, open: { type: "boolean" } },
    });
  } catch (err) {
    console.error(`gallery: ${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  const out = resolve(args.positionals[0] ?? "explainer-gallery");
  const sources: [own: boolean, dir: string][] = [
    [false, join(SKILL_ROOT, "templates")],
    ...(args.values.src ?? []).map((dir): [boolean, string] => [true, resolve(dir)]),
  ];
  const started = performance.now();
  await mkdir(join(out, "src"), { recursive: true });

  const entries: Entry[] = [];
  for (const [own, dir] of sources) {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
    for (const name of files) {
      const file = join(dir, name);
      const slug = basename(name, ".md");
      if (entries.some((e) => e.slug === slug)) {
        console.error(`gallery: skipping ${relPath(file)}; "${slug}" is already in the gallery`);
        continue;
      }
      const source = await Bun.file(file).text();
      const doc = parseDoc(source, file);
      const { html, diagnostics } = await buildPage(file);
      const errors = diagnostics.filter((d) => d.severity === "error").length;
      if (errors) console.error(`gallery: ${relPath(file)} has ${errors} error(s); run \`check\` on it`);
      await Bun.write(join(out, `${slug}.html`), html);
      await Bun.write(join(out, "src", name), source);
      const { kinds, states } = describe(doc.segments);
      const family = own ? "Your documents" : FAMILIES.find(([, k]) => k.includes(kinds[0] ?? ""))?.[0] ?? "Other";
      entries.push({ slug, family, front: doc.front, errors, kinds, states, blocks: [], shots: new Set() });
    }
  }

  const shots = !args.values["no-shots"] && chromeAvailable();
  let count = 0;
  if (shots) {
    await withBrowser(async (browser) => {
      const page = await browser.newPage();
      for (const e of entries) count += await capture(page, out, e);
    });
  } else if (!args.values["no-shots"]) {
    console.error("gallery: Chrome not found, so cards have no thumbnails; set CHROME_PATH");
  }

  const css = await themeCss(await loadTheme("default"));
  await Bun.write(join(out, "index.html"), indexPage(entries, css, shots));
  const ms = Math.round(performance.now() - started);
  console.log(`wrote ${display(join(out, "index.html"))} · ${entries.length} documents${shots ? ` · ${count} thumbnails` : ""} · ${ms} ms`);
  if (args.values.open) Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", join(out, "index.html")]);
  return entries.some((e) => e.errors) ? 1 : 0;
};

/**
 * Every image of one document: at rest (bare, both themes), the top of the page (full, both
 * themes), selected (bare, both themes) and expanded (full view with the reading panel, light),
 * plus each matrix and compare block on its own. Returns how many files it wrote.
 */
async function capture(page: Page, out: string, e: Entry): Promise<number> {
  const url = (state: string) => `file://${join(out, `${e.slug}.html`)}#${captureHash(state).hash}`;
  const write = async (name: string, png: Uint8Array) => {
    await Bun.write(join(out, `${e.slug}-${name}.png`), png);
    e.shots.add(name);
  };
  const crop = async (target: string | null, name: string) => {
    const box = await page.call(cropBox, target, 16, true);
    if ("error" in box) return false;
    await write(name, await page.screenshot({ clip: box }));
    return true;
  };
  try {
    await page.setViewport({ width: 1280, height: 800, scale: 1.5 });
    await openState(page, url("theme=light&view=bare"));
    const picks = await page.call(pickStates);
    e.sel = picks.focal ?? picks.related ?? undefined;
    const targets = await page.call(captureTargets);
    const main = targets[0]?.id ?? null;
    e.blocks = targets.slice(1).filter((t) => t.kind === "matrix" || t.kind === "compare");

    for (const mode of MODES) {
      await page.setViewport({ width: 1280, height: 800, scale: 1.5 });
      await openState(page, url(`theme=${mode}&view=bare`));
      if (!(await crop(main, `bare-${mode}`))) await write(`bare-${mode}`, await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 800 } }));
      for (const b of e.blocks) {
        await openState(page, url(`theme=${mode}&view=bare`));
        await crop(b.id, `${b.id}-${mode}`);
      }
      await page.setViewport({ width: 1280, height: 800, scale: 1 });
      await openState(page, url(`theme=${mode}&view=full`));
      await write(`full-${mode}`, await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 800 } }));
      if (e.sel) {
        await page.setViewport({ width: 1280, height: 800, scale: 1.5 });
        await openState(page, url(`sel=${e.sel}&theme=${mode}&view=bare`));
        const where = await page.call(selectedTarget);
        await crop(where ?? main, `sel-${mode}`);
      }
    }
    await page.setViewport({ width: 1280, height: 800, scale: 1 });
    await openState(page, url("theme=light&view=full"));
    await crop(main, "read-light");
  } catch (err) {
    console.error(`gallery: ${e.slug}: ${(err as Error).message}`);
  }
  return e.shots.size;
}

// Runs in the page: what can be cropped, in page order (figures, then matrix and compare blocks).
function captureTargets(): { id: string; kind: string }[] {
  return [...document.querySelectorAll<HTMLElement>('[data-figure], .x-block:is([data-block="matrix"], [data-block="compare"])[data-id]')]
    .filter((el) => !el.parentElement?.closest("[data-figure]"))
    .map((el) => ({ id: el.dataset.figure ?? el.dataset.id ?? "", kind: el.dataset.block ?? el.closest(".x-block")?.getAttribute("data-block") ?? "figure" }))
    .filter((t) => t.id);
}

// Runs in the page: the figure (or matrix/compare block) that holds the selection.
function selectedTarget(): string | null {
  const el = document.querySelector(".is-selected:not(.x-ref)");
  const host = el?.closest<HTMLElement>('[data-figure], .x-block:is([data-block="matrix"], [data-block="compare"])[data-id]');
  return host?.dataset.figure ?? host?.dataset.id ?? null;
}

/** The block types a document uses, and a few states worth linking to. */
function describe(segments: Segment[]): { kinds: string[]; states: { label: string; hash: string }[] } {
  const kinds = new Set<string>();
  let scene: string | undefined;
  const walk = (list: Segment[]) => {
    for (const s of list) {
      if (s.kind === "container") walk(s.children);
      if (s.kind !== "block" || ["note", "glossary", "detail", "steps", "widget"].includes(s.block.type)) continue;
      const data = (s.block.data ?? {}) as Record<string, unknown>;
      kinds.add(s.block.type === "figure" ? String(data.layout ?? "flow") : s.block.type);
      if (s.block.type !== "figure") continue;
      scene ??= Object.keys((data.scenes ?? {}) as Record<string, unknown>)[0];
    }
  };
  walk(segments);
  return { kinds: [...kinds], states: scene ? [{ label: "scene", hash: `scene=${encodeURIComponent(scene)}&step=1` }] : [] };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function card(e: Entry, shots: boolean): string {
  const title = e.front.title ?? e.slug;
  const img = (name: string, attrs: string) =>
    e.shots.has(name) ? `<img ${attrs} src="${e.slug}-${name}.png" alt="${esc(title)}" loading="lazy">` : "";
  const column = (label: string, href: string, images: string) =>
    `<figure class="g-shot"><a class="g-thumb" href="${href}">${images || `<span class="g-none">none</span>`}</a><figcaption>${esc(label)}</figcaption></figure>`;
  const both = (name: string, extra = "") => MODES.map((m) => img(`${name}-${m}`, `data-mode="${m}"${extra}`)).join("");
  const rest = VIEWS.flatMap((v) => MODES.map((m) => img(`${v}-${m}`, `data-view="${v}" data-mode="${m}"`))).join("");
  const sel = e.sel ? `#view=bare&sel=${encodeURIComponent(e.sel)}` : "#view=bare";
  const strip = shots
    ? `<div class="g-strip">${[
        column("Rest", `${e.slug}.html#view=bare`, rest),
        column(e.sel ? `Selected · ${e.sel}` : "Selected", `${e.slug}.html${sel}`, both("sel")),
        column("Expanded", `${e.slug}.html#view=full`, img("read-light", 'data-mode="any"')),
        ...e.blocks.map((b) => column(`${b.kind} · ${b.id}`, `${e.slug}.html#view=bare`, both(b.id))),
      ].join("")}</div>`
    : "";
  const links = [
    `<a href="${e.slug}.html#view=bare">diagram</a>`,
    `<a href="${e.slug}.html#view=full">with text</a>`,
    ...(e.sel ? [`<a href="${e.slug}.html${sel}">selected</a>`] : []),
    ...e.states.map((s) => `<a href="${e.slug}.html#view=bare&${s.hash}">${esc(s.label)}</a>`),
    `<a href="src/${e.slug}.md">source</a>`,
  ];
  return `<article class="g-card">${strip}<div class="g-body">
<h2 class="g-title">${esc(title)}</h2><p class="g-kinds">${esc(e.kinds.join(" · "))}</p>
<p class="g-links">${links.join("")}</p>${e.errors ? `<p class="g-error">${e.errors} build error(s)</p>` : ""}
</div></article>`;
}

function indexPage(entries: Entry[], css: string, shots: boolean): string {
  const order = [...FAMILIES.map(([name]) => name), "Other", "Your documents"];
  const sections = order.filter((f) => entries.some((e) => e.family === f)).map((family) => {
    const list = entries.filter((e) => e.family === family);
    return `<section class="g-section"><h2 class="g-section-title">${esc(family)} <span>${list.length}</span></h2><div class="g-grid">${list.map((e) => card(e, shots)).join("\n")}</div></section>`;
  });
  return `<!doctype html>
<html lang="en" data-view="bare">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Explainer gallery</title>
<style>
${css}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--x-bg); color: var(--x-text); font-family: var(--x-font-sans); font-size: var(--x-fs-body); line-height: 1.5; -webkit-font-smoothing: antialiased; }
.g-page { max-width: 1320px; margin: 0 auto; padding: 40px 24px 64px; }
.g-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.g-head h1 { font-size: var(--x-fs-h1); font-weight: 600; letter-spacing: -0.01em; margin: 0; }
.g-controls { display: flex; gap: 6px; }
.g-controls button { font: inherit; font-size: var(--x-fs-ui); color: var(--x-text); background: var(--x-surface); border: 1px solid var(--x-line); border-radius: var(--x-radius); padding: 6px 12px; cursor: pointer; }
.g-controls button:hover { background: var(--x-surface-2); border-color: var(--x-line-strong); }
.g-section { margin-top: 36px; }
.g-section-title { font-family: var(--x-font-mono); font-size: var(--x-fs-tag); font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--x-text-dim); margin: 0 0 14px; }
.g-section-title span { color: var(--x-text-faint); margin-left: 6px; }
.g-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
.g-card { background: var(--x-surface); border: 1px solid var(--x-line); border-radius: var(--x-radius); overflow: hidden; display: flex; flex-direction: column; }
.g-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1px; background: var(--x-line); border-bottom: 1px solid var(--x-line); }
.g-shot { margin: 0; background: var(--x-bg); display: flex; flex-direction: column; min-width: 0; }
.g-shot figcaption { font-family: var(--x-font-mono); font-size: var(--x-fs-caption); color: var(--x-text-dim); padding: 6px 10px 8px; overflow-wrap: anywhere; }
.g-thumb { display: flex; align-items: center; justify-content: center; aspect-ratio: 16 / 10; padding: 10px; overflow: hidden; }
.g-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; display: none; }
.g-none { font-family: var(--x-font-mono); font-size: var(--x-fs-caption); color: var(--x-text-faint); }
html[data-view="bare"] .g-thumb img[data-view="full"] { object-position: top; }
.g-thumb img[data-mode="any"],
html:not([data-theme="dark"]) .g-thumb img[data-mode="light"]:not([data-view]),
html[data-theme="dark"] .g-thumb img[data-mode="dark"]:not([data-view]),
html:not([data-theme="dark"])[data-view="bare"] .g-thumb img[data-view="bare"][data-mode="light"],
html:not([data-theme="dark"])[data-view="full"] .g-thumb img[data-view="full"][data-mode="light"],
html[data-theme="dark"][data-view="bare"] .g-thumb img[data-view="bare"][data-mode="dark"],
html[data-theme="dark"][data-view="full"] .g-thumb img[data-view="full"][data-mode="dark"] { display: block; }
.g-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 2px; flex: 1; }
.g-title { font-size: var(--x-fs-ui); font-weight: 600; margin: 0; }
.g-kinds { margin: 0; font-family: var(--x-font-mono); font-size: var(--x-fs-caption); color: var(--x-text-dim); }
.g-links { margin: auto 0 0; padding-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
.g-links a { font-family: var(--x-font-mono); font-size: var(--x-fs-caption); color: var(--x-text); text-decoration: none; border: 1px solid var(--x-line); border-radius: var(--x-radius); padding: 2px 8px; }
.g-links a:hover { background: var(--x-surface-2); border-color: var(--x-line-strong); }
.g-error { margin: 0; color: var(--x-danger); font-size: var(--x-fs-caption); }
:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 2px; }
</style>
</head>
<body>
<main class="g-page">
<header class="g-head"><h1>Gallery</h1><div class="g-controls"><button type="button" data-set="view">With text</button><button type="button" data-set="theme">Dark</button></div></header>
${sections.join("\n")}
</main>
<script>
const root = document.documentElement;
const [viewButton, themeButton] = document.querySelectorAll(".g-controls button");
const show = () => {
  viewButton.textContent = root.dataset.view === "bare" ? "With text" : "Diagram only";
  themeButton.textContent = root.dataset.theme === "dark" ? "Light" : "Dark";
};
root.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
viewButton.addEventListener("click", () => { root.dataset.view = root.dataset.view === "bare" ? "full" : "bare"; show(); });
themeButton.addEventListener("click", () => { root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark"; show(); });
show();
</script>
</body>
</html>
`;
}
