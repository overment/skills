#!/usr/bin/env bun
import type { CommandRun } from "./engine/types.ts";
import { commandTable, helpText, isCommand, usage, COMMANDS } from "./lib/commands.ts";

const MIN_BUN = "1.4.0";

const usageOf = (name: keyof typeof COMMANDS) => `${usage(name)}\n  ${COMMANDS[name].about}`;

if (typeof Bun === "undefined" || Bun.semver.order(Bun.version, MIN_BUN) < 0) {
  const found = typeof Bun === "undefined" ? "it was started without Bun" : `this is Bun ${Bun.version}`;
  console.error(`explainer needs Bun ${MIN_BUN} or newer; ${found}. Run \`bun upgrade\`.`);
  process.exit(1);
}

const [name = "help", ...rest] = process.argv.slice(2);

if (name === "help" || name === "--help" || name === "-h") {
  if (rest[0] === "--markdown") console.log(commandTable());
  else console.log(rest[0] && isCommand(rest[0]) ? usageOf(rest[0]) : helpText());
  process.exit(0);
}
if (!isCommand(name)) {
  console.error(`explainer: unknown command "${name}".\n\n${helpText()}`);
  process.exit(2);
}
if (rest.includes("--help") || rest.includes("-h")) {
  console.log(usageOf(name));
  process.exit(0);
}

try {
  const { run } = (await import(`./commands/${name}.ts`)) as { run: CommandRun };
  process.exit(await run(rest));
} catch (e) {
  console.error(`explainer ${name}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  process.exit(1);
}
