/// <reference lib="dom" />
import { rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildPage } from "../engine/page.ts";
import type { CommandRun } from "../engine/types.ts";
import { onCleanup, withBrowser, type Page } from "../lib/cdp.ts";
import { usage } from "../lib/commands.ts";

const USAGE = usage("shot");

export const READY = `document.documentElement.dataset.ready === "1"`;

/** The URL hash keys the page understands (see references/interactions.md). */
export const STATE_KEYS = ["sel", "cmp", "hide", "range", "scene", "step", "theme", "view"] as const;

/**
 * Screenshots show what a reader sees, minus what only a pointer or keyboard adds: no tooltip,
 * no focus ring (a focused mark must not add an accent stroke), no caret.
 */
export const CAPTURE_CSS = `html[data-capture] .x-tip { display: none !important; }
html[data-capture] :is(:focus, :focus-visible) { outline: none !important; }
html[data-capture] * { caret-color: transparent !important; }`;

export interface PageFile {
  path: string;
  /** The Markdown source when the input was a .md file, else null. */
  source: string | null;
  url(hash?: string): string;
  cleanup(): Promise<void>;
}

/** An .html input is used as is; a .md input is built into a temporary .html file. */
export async function openInput(input: string): Promise<PageFile> {
  const file = resolve(input);
  if (!(await Bun.file(file).exists())) throw new Error(`${input} not found`);
  const ext = extname(file).toLowerCase();
  if (ext === ".html" || ext === ".htm") return pageFile(file, null, async () => {});
  const source = await Bun.file(file).text();
  const { html, diagnostics } = await buildPage(file);
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length)
    throw new Error(`${input} has ${errors.length} error(s); fix what \`check\` reports:\n${errors.map((d) => `  ${d.line ?? "-"} ${d.rule} ${d.message}`).join("\n")}`);
  const dir = await mkdtemp(join(tmpdir(), "explainer-"));
  const release = onCleanup(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, `${basename(file, ext)}.html`);
  await Bun.write(path, html);
  return pageFile(path, source, async () => {
    await rm(dir, { recursive: true, force: true });
    release();
  });
}

function pageFile(path: string, source: string | null, cleanup: () => Promise<void>): PageFile {
  return { path, source, url: (hash = "") => pathToFileURL(path).href + (hash ? `#${hash}` : ""), cleanup };
}

export function display(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") ? rel : path;
}

/**
 * The hash shot opens: the --state keys, --view on top, and capture=1. Returns the unknown keys
 * too, so a typo like `selected=gw` is reported instead of silently capturing the resting state.
 */
export function captureHash(state: string, view?: string): { hash: string; unknown: string[] } {
  const params = new URLSearchParams(state.replace(/^#/, ""));
  const unknown = [...new Set([...params.keys()].filter((k) => !(STATE_KEYS as readonly string[]).includes(k) && k !== "capture"))];
  if (view) params.set("view", view);
  params.delete("capture");
  params.set("capture", "1");
  // URLSearchParams encodes '>' in ids like "a->b"; the client decodes either form.
  return { hash: params.toString(), unknown };
}

/** Waits two frames and a tick, so layout done in rAF callbacks (card placement) has landed. */
export function settle(page: Page, ms = 30): Promise<void> {
  return page.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, ${ms}))))`);
}

/** Loads `url` fresh (a hash-only change would not fire load), waits until the page is ready. */
export async function openState(page: Page, url: string): Promise<void> {
  await page.goto("about:blank");
  await page.goto(url);
  await page.waitFor(READY);
  await page.call(prepareCapture, CAPTURE_CSS);
  await settle(page);
}

export const run: CommandRun = async (argv) => {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        figure: { type: "string" },
        state: { type: "string" },
        view: { type: "string" },
        scale: { type: "string" },
        width: { type: "string" },
        out: { type: "string", short: "o" },
        page: { type: "boolean" },
      },
    });
  } catch (err) {
    console.error(`shot: ${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = args;
  const input = positionals[0];
  if (!input || positionals.length > 1) {
    console.error(USAGE);
    return 2;
  }
  const scale = Number(values.scale ?? 2);
  const width = Number(values.width ?? 1280);
  if (!(scale >= 1 && scale <= 4)) {
    console.error("shot: --scale must be between 1 and 4");
    return 2;
  }
  if (!Number.isInteger(width) || width < 200) {
    console.error("shot: --width must be a whole number of pixels, at least 200");
    return 2;
  }
  if (values.view !== undefined && values.view !== "bare" && values.view !== "full") {
    console.error("shot: --view must be bare or full");
    return 2;
  }
  const { hash, unknown } = captureHash(values.state ?? "", values.view);
  for (const key of unknown) console.error(`shot: warning: "${key}" is not a state key; known keys: ${STATE_KEYS.join(", ")}`);
  const params = new URLSearchParams(hash);
  const theme = params.get("theme");
  const started = performance.now();
  let file: PageFile | undefined;
  try {
    file = await openInput(input);
    const url = file.url(hash);
    const shot = await withBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900, scale });
      await openState(page, url);
      for (const warning of await page.call(stateWarnings, Object.fromEntries(params))) console.error(`shot: warning: ${warning}`);
      if (values.page) {
        // The page ends where the content ends, not at the bottom of the initial viewport.
        const size = await page.evaluate<{ w: number; h: number }>(
          "({ w: document.documentElement.scrollWidth, h: Math.ceil((document.querySelector('.x-page') ?? document.body).getBoundingClientRect().bottom + scrollY) })",
        );
        const w = Math.max(width, size.w);
        await page.setViewport({ width: w, height: size.h, scale });
        await settle(page);
        return { name: "page", w, h: size.h, png: await page.screenshot({ clip: { x: 0, y: 0, width: w, height: size.h } }) };
      }
      const box = await page.call(cropBox, values.figure ?? null, 16, true);
      if ("error" in box) throw new Error(box.error);
      await settle(page);
      return { name: box.id, w: box.width, h: box.height, png: await page.screenshot({ clip: box }) };
    });
    const base = basename(input, extname(input));
    const out = resolve(values.out ?? join(dirname(resolve(input)), `${base}-${shot.name}${theme ? `-${theme}` : ""}.png`));
    await Bun.write(out, shot.png);
    const ms = Math.round(performance.now() - started);
    console.log(`wrote ${display(out)} · ${Math.round(shot.w * scale)}×${Math.round(shot.h * scale)} px · ${ms} ms`);
    return 0;
  } catch (err) {
    console.error(`shot: ${(err as Error).message}`);
    return 1;
  } finally {
    await file?.cleanup();
  }
};

// ---- the functions below run in the page ----

/** Adds the capture stylesheet and drops focus, so no focus ring or tooltip reaches the image. */
export function prepareCapture(css: string): void {
  if (!document.querySelector("style[data-shot]")) {
    const style = document.createElement("style");
    style.dataset.shot = "";
    style.textContent = css;
    document.head.append(style);
  }
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.querySelectorAll(".x-tip").forEach((tip) => ((tip as HTMLElement).hidden = true));
}

/** What the state asked for but the page did not show. */
export function stateWarnings(state: Record<string, string>): string[] {
  const out: string[] = [];
  const html = document.documentElement;
  const found = (id: string) =>
    [...document.querySelectorAll("[data-id],[data-ref],[data-for],[data-col]")].some((el) =>
      ["data-id", "data-ref", "data-for", "data-col"].some((a) => el.getAttribute(a) === id),
    );
  if (state.sel && !document.querySelector(".is-selected")) out.push(`sel=${state.sel} selected nothing${found(state.sel) ? "" : " (no element has that id)"}`);
  if (state.cmp && !found(state.cmp)) out.push(`cmp=${state.cmp}: no element has that id`);
  if (state.scene && !document.querySelector(".is-step-active")) out.push(`scene=${state.scene} lit no step`);
  if (state.theme && html.dataset.theme !== state.theme) out.push(`theme=${state.theme} was not applied`);
  if (state.view && html.dataset.view !== state.view) out.push(`view=${state.view} was not applied`);
  return out;
}

/**
 * Runs in the page: the box to crop for a figure (or a matrix/compare block), in page coordinates.
 * It is the union of what belongs to the figure on screen: the figure and its .x-stage, the open
 * card (.x-pop, or the older floating .x-detail) and its leader, note markers and callouts, the reading
 * panel when the view is full, and the steps (with their note) while a scene is on. With `unclip`, scrollers inside the
 * figure are opened up so a board wider than the column is captured whole.
 */
export function cropBox(
  id: string | null,
  pad: number,
  unclip: boolean,
): { error: string } | { id: string; x: number; y: number; width: number; height: number } {
  const html = document.documentElement;
  const shown = (el: Element | null | undefined): el is HTMLElement => {
    if (!el || !el.getClientRects().length) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const figures = [...document.querySelectorAll<HTMLElement>("[data-figure]")];
  const blocks = [...document.querySelectorAll<HTMLElement>('.x-block:is([data-block="matrix"], [data-block="compare"])[data-id]')];
  const nameOf = (el: HTMLElement) => el.dataset.figure ?? el.dataset.id ?? "figure";
  const targets = [...figures, ...blocks];
  const el = id === null ? targets[0] : targets.find((t) => nameOf(t) === id);
  if (!el)
    return { error: targets.length ? `No figure "${id}"; figures: ${targets.map(nameOf).join(", ")}.` : "The page has no figures; use --page." };
  const name = nameOf(el);
  const sel = (s: string) => CSS.escape(s);

  if (unclip) {
    for (const node of [el, ...el.querySelectorAll<HTMLElement>("*")]) {
      if (!(node instanceof HTMLElement) || node.scrollWidth <= node.clientWidth + 1) continue;
      const style = getComputedStyle(node);
      if (style.overflowX === "visible") continue;
      node.style.overflowX = "visible";
      node.style.overflowY = "visible";
    }
  }

  const stage = el.querySelector<HTMLElement>(".x-stage") ?? el.closest<HTMLElement>(".x-stage");
  const home = el.closest(".x-read, .x-block") ?? el;
  const parts: Element[] = [el];
  if (stage) parts.push(stage);
  const scoped = (selector: string) => [
    ...(stage ?? el).querySelectorAll(selector),
    ...home.querySelectorAll(`${selector}[data-for="${sel(name)}"]`),
    ...document.querySelectorAll(`${selector}[data-for="${sel(name)}"]`),
  ];
  // Callout boxes and the card's leader live in the stage but may reach past the svg.
  parts.push(...scoped(".x-pop"), ...scoped(".x-note-marker"), ...scoped(".x-callout"), ...scoped(".x-leader"));
  if (html.dataset.view === "full") parts.push(...scoped(".x-reading"));
  if (document.querySelector(".is-step-active")) parts.push(...document.querySelectorAll(`.x-steps[data-for="${sel(name)}"]`));
  // The older client floats one detail panel at body level, next to the selection.
  parts.push(...document.querySelectorAll(".x-detail:not([data-placement]):not([hidden])"));

  const boxes = [...new Set(parts)].filter(shown).map((p) => {
    const r = p.getBoundingClientRect();
    // A scroller that stayed clipped still counts whole, and so does a child wider than its parent.
    let right = r.left + Math.max(r.width, p.scrollWidth);
    for (const d of p.querySelectorAll<HTMLElement>("*")) {
      if (d.closest("svg") || !d.getClientRects().length) continue;
      const b = d.getBoundingClientRect();
      right = Math.max(right, b.right, b.left + d.scrollWidth);
    }
    return { left: r.left, top: r.top, right, bottom: r.bottom };
  });
  const x = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.left)) + scrollX - pad));
  const y = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.top)) + scrollY - pad));
  const right = Math.ceil(Math.max(...boxes.map((b) => b.right)) + scrollX + pad);
  const bottom = Math.min(html.scrollHeight, Math.ceil(Math.max(...boxes.map((b) => b.bottom)) + scrollY + pad));
  return { id: name, x, y, width: right - x, height: bottom - y };
}
