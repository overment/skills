import { dirname, resolve } from "node:path";
import { renderDoc } from "../engine/blocks.ts";
import { lint } from "../engine/lint.ts";
import { parseDoc } from "../engine/parse.ts";
import { loadTheme } from "../engine/theme.ts";
import { SpecError, type CommandRun, type Diagnostic } from "../engine/types.ts";
import { usage } from "../lib/commands.ts";

export const run: CommandRun = async (argv) => {
  const unknown = argv.filter((a) => a.startsWith("-"));
  const inputs = argv.filter((a) => !a.startsWith("-"));
  if (!inputs.length || unknown.length) {
    console.error(unknown.length ? `check: unknown option ${unknown[0]}\n${usage("check")}` : usage("check"));
    return 2;
  }
  let failed = false;
  for (const input of inputs) {
    if (inputs.length > 1) console.log(input);
    failed = (await checkOne(input)) || failed;
  }
  return failed ? 1 : 0;
};

/** Lints one document and prints its diagnostics. Returns true when it has errors. */
async function checkOne(input: string): Promise<boolean> {
  const file = resolve(input);
  const source = Bun.file(file);
  if (!(await source.exists())) {
    console.error(`check: ${input} not found`);
    return true;
  }
  let diagnostics: Diagnostic[];
  try {
    diagnostics = await collect(await source.text(), file);
  } catch (err) {
    if (!(err instanceof SpecError)) {
      console.error(`check: ${input}: ${(err as Error).message}`);
      return true;
    }
    diagnostics = [{ rule: err.rule, severity: "error", message: err.message, line: err.line }];
  }
  const sorted = dedupe(diagnostics).sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  for (const d of sorted) console.log(`${input}:${d.line ?? 1} ${d.severity} ${d.rule} ${d.message}`);
  const errors = sorted.filter((d) => d.severity === "error").length;
  const warnings = sorted.length - errors;
  console.log(sorted.length ? `${plural(errors, "error")}, ${plural(warnings, "warning")}` : "✓ no problems");
  return errors > 0;
}

/** Every diagnostic `check` reports for one document: build problems plus lint. */
export async function collect(source: string, file: string): Promise<Diagnostic[]> {
  const doc = parseDoc(source, file);
  const theme = await loadTheme(doc.front.theme, dirname(file));
  const { blocks, diagnostics, model } = renderDoc(doc, theme);
  return [...diagnostics, ...lint(doc, blocks, theme, Object.keys(model.elements))];
}

function dedupe(list: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return list.filter((d) => {
    const key = [d.rule, d.severity, d.line, d.message].join("\u0000");
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
