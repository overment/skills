// The one list of CLI commands. `explainer help`, every command's usage line and the SKILL.md
// command table (`explainer help --markdown`) are generated from it.

export interface CommandDoc {
  usage: string; // arguments after `explainer <name>`
  about: string; // one line for `help`
  skill: string; // the "What it does" cell in SKILL.md
}

export const COMMANDS = {
  new: {
    usage: "new <template> <out.md> | new --list",
    about: "Start a document from a template.",
    skill: "Copies a starter document. `new --list` lists the templates",
  },
  build: {
    usage: "build <doc.md> [-o out.html] [--theme name|path] [--mode light|dark]",
    about: "Write one self-contained HTML file.",
    skill: "Writes the HTML file and prints its path, size and diagnostics. Exits 1 on errors",
  },
  watch: {
    usage: "watch <doc.md> [--port 4646] [--theme name|path] [--mode light|dark] [--no-open]",
    about: "Serve with live reload while you edit.",
    skill: "Serves the page and reloads it on every save",
  },
  check: {
    usage: "check <doc.md>...",
    about: "Lint documents without a browser.",
    skill: "Lints without a browser. Prints `file:line rule message`",
  },
  audit: {
    usage: 'audit <doc.md|out.html>... [--state "sel=x&theme=dark"]... [--json]',
    about: "Check the rendered page in headless Chrome, at rest and with things selected.",
    skill:
      "Runs headless Chrome checks in light and dark, bare and full, at rest and with the focal element, a related element and every front-matter `shots:` state selected: text clipped or overflowing, engine-inserted `…`, label × line crossings, labels drawn over each other, lines leaving their svg, figures wider than the column, the card covering the selection or what it relates to, related elements dimmed, dimmed text under 3:1, an invisible selection ring, relation rows that repeat both ends, the click test per element type, contrast, console errors and the no-JS render. Prints `✗` for failures and `–` for checks it could not run. Exits 1 on any failure",
  },
  shot: {
    usage: 'shot <doc.md|out.html> [--figure id] [--state "sel=gw&cmp=db&theme=dark"] [--view bare|full] [--scale 2] [--width 1280] [--out x.png] [--page]',
    about: "Capture a PNG of any UI state: the figure with its card, rings, note markers, reading panel and step note.",
    skill:
      "Saves a PNG of a figure (with its open card, note markers, reading panel in `--view full`, and step note when a scene is on) or of the whole page, in any state. Wide boards are captured whole",
  },
  export: {
    usage: 'export <doc.md|out.html> [--figure id] [--state "sel=gw&theme=dark"] [--mode light|dark] [-o x.svg]',
    about: "Write a standalone SVG of one figure; --state bakes the selection, rings and card into it.",
    skill: "Saves a standalone SVG with styles inlined, for Figma or Keynote. `--state` bakes the selection, its ring and the card into the file",
  },
  gallery: {
    usage: "gallery [out-dir] [--src dir]... [--no-shots] [--open]",
    about: "Build every template (and --src documents) with rest, selected and expanded thumbnails and an index page.",
    skill:
      "Builds every template (plus any `--src` documents) and an index page showing each one at rest, selected and expanded (reading panel), in light and dark, including matrix and compare blocks. Use it to see what each layout looks like, or to review a set of documents together",
  },
  help: {
    usage: "help [command] | help --markdown",
    about: "Show this help. --markdown prints the SKILL.md command table.",
    skill: "Prints usage. `help --markdown` prints this table",
  },
} satisfies Record<string, CommandDoc>;

export type CommandName = keyof typeof COMMANDS;

export const isCommand = (name: string): name is CommandName => Object.hasOwn(COMMANDS, name);

/** `usage: explainer <usage>` for one command. */
export const usage = (name: CommandName) => `usage: explainer ${COMMANDS[name].usage}`;

export function helpText(): string {
  const rows = Object.values(COMMANDS).map((c) => `  ${c.usage}\n      ${c.about}`);
  return ["explainer: Markdown with data blocks → one interactive HTML file", "", "usage: bun scripts/explainer.ts <command> [args]", "", ...rows].join("\n");
}

/** The SKILL.md "Commands" table. Pipes inside cells are escaped for GitHub tables. */
export function commandTable(): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const rows = Object.values(COMMANDS).map((c) => `| \`${cell(c.usage)}\` | ${cell(c.skill)} |`);
  return ["| Command | What it does |", "|---|---|", ...rows].join("\n");
}
