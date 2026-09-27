import { basename, join, relative, resolve } from "node:path";
import { parseDoc } from "../engine/parse.ts";
import type { CommandRun } from "../engine/types.ts";
import { usage } from "../lib/commands.ts";

const SKILL = resolve(import.meta.dir, "../..");
const TEMPLATES = join(SKILL, "templates");
const USAGE = usage("new");

export const run: CommandRun = async (argv) => {
  if (argv.length === 1 && argv[0] === "--list") return list();
  if (argv.length !== 2 || argv.some((a) => a.startsWith("-"))) {
    console.error(USAGE);
    return 2;
  }
  const [name, target] = argv;
  const template = name.replace(/\.md$/, "");
  const names = templates();
  if (!names.includes(template)) {
    console.error(`explainer new: there is no template "${name}". Available: ${names.join(", ") || "none"}.`);
    return 1;
  }
  const out = resolve(target);
  if (await Bun.file(out).exists()) {
    console.error(`explainer new: ${target} already exists; pick another path.`);
    return 1;
  }
  await Bun.write(out, Bun.file(join(TEMPLATES, `${template}.md`)));
  const cwd = process.cwd();
  console.log(`wrote ${relative(cwd, out)}`);
  console.log(`next: bun ${relative(cwd, join(SKILL, "scripts/explainer.ts"))} watch ${relative(cwd, out)}`);
  return 0;
};

function templates(): string[] {
  try {
    return [...new Bun.Glob("*.md").scanSync(TEMPLATES)].map((f) => basename(f, ".md")).sort();
  } catch {
    return [];
  }
}

async function list(): Promise<number> {
  const names = templates();
  if (!names.length) {
    console.error(`explainer new: no templates found in ${TEMPLATES}.`);
    return 1;
  }
  const width = Math.max(...names.map((n) => n.length));
  for (const n of names) console.log(`${n.padEnd(width)}  ${await title(n)}`);
  return 0;
}

async function title(name: string): Promise<string> {
  try {
    return String(parseDoc(await Bun.file(join(TEMPLATES, `${name}.md`)).text()).front.title ?? "");
  } catch {
    return "";
  }
}
