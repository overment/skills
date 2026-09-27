import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildPage } from "../engine/page.ts";
import type { CommandRun, Diagnostic, Mode } from "../engine/types.ts";
import { usage } from "../lib/commands.ts";

const USAGE = usage("build");

export const run: CommandRun = async (argv) => {
  let values: { out?: string; theme?: string; mode?: string };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { out: { type: "string", short: "o" }, theme: { type: "string" }, mode: { type: "string" } },
    }));
  } catch (e) {
    console.error(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  if (positionals.length !== 1 || !isMode(values.mode)) {
    console.error(USAGE);
    return 2;
  }
  const file = resolve(positionals[0]);
  if (!(await Bun.file(file).exists())) {
    console.error(`explainer build: ${positionals[0]} does not exist.`);
    return 1;
  }
  const out = resolve(values.out ?? `${file.replace(/\.(md|markdown)$/i, "")}.html`);
  if (out === file) {
    console.error("explainer build: the output path is the input file; pass -o out.html.");
    return 2;
  }
  const started = performance.now();
  const { html, diagnostics } = await buildPage(file, { theme: values.theme, mode: values.mode as Mode | undefined });
  const ms = Math.round(performance.now() - started);
  const bytes = await Bun.write(out, html);
  console.log(`wrote ${relPath(out)} · ${(bytes / 1024).toFixed(1)} KB · ${ms} ms`);
  for (const d of diagnostics) console.log(formatDiagnostic(relPath(file), d));
  return diagnostics.some((d) => d.severity === "error") ? 1 : 0;
};

export function isMode(value: string | undefined): boolean {
  return value === undefined || value === "light" || value === "dark";
}

export function formatDiagnostic(file: string, d: Diagnostic): string {
  return `${file}${d.line ? `:${d.line}` : ""} ${d.severity} ${d.rule} ${d.message}`;
}

/** Relative inside the working directory, absolute outside it: `../../../tmp/x` helps no one. */
export function relPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return !rel || rel.startsWith("..") ? resolve(path) : rel;
}
