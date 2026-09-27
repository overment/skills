import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { inlineMarkdown, renderDoc } from "./blocks.ts";
import { esc } from "./blocks/util.ts";
import { widgetCode } from "./blocks/widget.ts";
import { parseDoc } from "./parse.ts";
import { loadTheme, themeCss } from "./theme.ts";
import { SpecError, type Diagnostic, type Mode, type ParsedDoc, type Segment, type Theme, type View, type WidgetBlock } from "./types.ts";

export interface BuildOptions { theme?: string; mode?: Mode; view?: View }
export interface BuildResult { html: string; diagnostics: Diagnostic[] }

const CHROMES = ["none", "title", "full"] as const;
const WIDTHS = ["narrow", "wide", "full"] as const;
const MODES = ["auto", "light", "dark"] as const;
const VIEWS = ["bare", "full"] as const;
const STYLES = resolve(import.meta.dir, "../styles");
const CLIENT = resolve(import.meta.dir, "../client/client.ts");

let client: Promise<string> | undefined;

function clientScript(): Promise<string> {
  client ??= bundleClient().catch((e) => {
    client = undefined;
    throw e;
  });
  return client;
}

/** base.css, then one stylesheet per block family from styles/blocks/, in name order. */
async function stylesheet(): Promise<string> {
  const dir = join(STYLES, "blocks");
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".css")).sort();
  const parts = await Promise.all([join(STYLES, "base.css"), ...files.map((f) => join(dir, f))].map((f) => Bun.file(f).text()));
  return parts.join("\n");
}

async function bundleClient(): Promise<string> {
  const result = await Bun.build({ entrypoints: [CLIENT], target: "browser", format: "iife", minify: true });
  if (!result.success) throw new Error(`The client bundle failed:\n${result.logs.join("\n")}`);
  return result.outputs[0].text();
}

export async function buildPage(file: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const path = resolve(file);
  return buildHtml(await Bun.file(path).text(), path, opts);
}

export async function buildHtml(source: string, file: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const name = basename(file);
  let doc: ParsedDoc;
  try {
    doc = parseDoc(source, file);
  } catch (e) {
    if (!(e instanceof SpecError)) throw e;
    return failed(name, [{ rule: e.rule, severity: "error", message: e.message, line: e.line }]);
  }

  const diagnostics: Diagnostic[] = [];
  const front = doc.front;
  const chrome = pick(front.chrome, CHROMES, "chrome", diagnostics) ?? (soleBlock(doc.segments) ? "none" : "title");
  const width = pick(front.width, WIDTHS, "width", diagnostics) ?? "wide";
  const mode = opts.mode ?? pick(front.mode, MODES, "mode", diagnostics) ?? "auto";
  const view = opts.view ?? pick(front.view, VIEWS, "view", diagnostics) ?? "full";

  let theme: Theme;
  try {
    theme = await loadTheme(opts.theme ?? text(front.theme), dirname(file));
  } catch (e) {
    return failed(name, [...diagnostics, { rule: "spec", severity: "error", message: `The theme could not be loaded: ${e instanceof Error ? e.message : String(e)}`, line: 1 }]);
  }

  const [css, base, js] = await Promise.all([themeCss(theme, { embedFonts: true }), stylesheet(), clientScript()]);
  const content = renderDoc(doc, theme);
  diagnostics.push(...content.diagnostics);

  const title = text(front.title);
  const eyebrow = text(front.eyebrow);
  const summary = text(front.summary);
  const pageTitle = title ?? content.blocks.map((b) => (b.type === "figure" ? b.title : undefined)).find(Boolean) ?? "Explainer";
  const header = chrome === "none" ? "" : [
    '<header class="x-header">',
    eyebrow ? `<p class="x-eyebrow">${esc(eyebrow)}</p>` : "",
    title ? `<h1 class="x-title">${esc(title)}</h1>` : "",
    summary ? `<p class="x-summary">${inlineMarkdown(summary)}</p>` : "",
    "</header>",
  ].join("");
  const source_ = text(front.source);
  const footer = chrome === "full" ? `<footer class="x-footer">${source_ ? inlineMarkdown(source_) : esc(name)}</footer>` : "";
  const widgets = content.blocks.filter((b): b is WidgetBlock => b.type === "widget").map(widgetCode);

  const html = [
    "<!doctype html>",
    // data-view and a fixed data-theme are written up front, so the page reads right with scripts off.
    `<html lang="${esc(text(front.lang) ?? "en")}" data-theme-default="${mode}" data-view-default="${view}" data-view="${view}"${mode === "auto" ? "" : ` data-theme="${mode}"`}>`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(pageTitle)}</title>`,
    `<style>${css}\n${base}</style>`,
    "</head>",
    "<body>",
    // Every page gets the same two switches: text on or off, light or dark. The client labels them.
    '<div class="x-controls"><button class="x-btn" type="button" data-action="view">With text</button><button class="x-toggle" type="button" data-action="theme" aria-label="Toggle dark mode"></button></div>',
    `<main class="x-page" data-width="${width}" data-chrome="${chrome}">`,
    header,
    `<div class="x-content">${content.html}</div>`,
    footer,
    "</main>",
    `<script type="application/json" id="x-model">${JSON.stringify(content.model).replace(/</g, "\\u003c")}</script>`,
    `<script>${inScript(js)}</script>`,
    widgets.length ? `<script type="module">${inScript(widgets.join("\n"))}</script>` : "",
    "</body>",
    "</html>",
  ].filter(Boolean).join("\n");

  return { html, diagnostics };
}

export function errorPage(title: string, diagnostics: Diagnostic[]): string {
  const items = diagnostics
    .map((d) => `<li><code>${d.line ? `line ${d.line}` : "file"}</code> <strong>${esc(d.rule)}</strong> ${esc(d.message)}</li>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · build failed</title><style>:root{color-scheme:light dark;font:15px/1.5 system-ui,sans-serif}body{max-width:720px;margin:48px auto;padding:0 24px}li{margin:8px 0}code{opacity:.7}</style></head><body><h1>${esc(title)} did not build</h1><ul>${items}</ul></body></html>`;
}

function failed(name: string, diagnostics: Diagnostic[]): BuildResult {
  return { html: errorPage(name, diagnostics), diagnostics };
}

function soleBlock(segments: Segment[]): boolean {
  let blocks = 0;
  let prose = false;
  const walk = (segs: Segment[]) => {
    for (const s of segs) {
      if (s.kind === "block") blocks++;
      else if (s.kind === "markdown") prose ||= s.text.trim() !== "";
      else walk(s.children);
    }
  };
  walk(segments);
  return blocks === 1 && !prose;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], key: string, diagnostics: Diagnostic[]): T | undefined {
  if (value == null) return undefined;
  if (allowed.includes(value as T)) return value as T;
  diagnostics.push({ rule: "spec", severity: "warn", line: 1, message: `Front matter \`${key}: ${value}\` is not one of ${allowed.join(", ")}; using the default.` });
  return undefined;
}

const text = (value: unknown) => (value == null ? undefined : String(value));
const inScript = (js: string) => js.replace(/<(\/script|!--)/gi, "<\\$1");
