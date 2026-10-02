import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { check, format } from "./check.ts";

function base(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "knowledge-check-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const TODAY = { today: "2026-09-29" };
const rules = (items: { rule: string }[]) => items.map((f) => f.rule);

const DECISION = `---
defines: decision
required: [date, status]
values:
  status: [proposed, accepted, superseded]
---
# decision

Exists so that: a later reader knows what was chosen and why.
`;

describe("links", () => {
  test("a linked base passes with no errors or orphans", async () => {
    const root = base({
      "README.md": "Start at [the index](notes/index.md).",
      "notes/index.md": "See [[pricing]] and [pricing again](pricing.md) and [the web](https://example.com) and [a section](#top).",
      "notes/pricing.md": "Back to [[index]].",
    });
    const report = (await check(root, TODAY));
    expect(report.errors).toEqual([]);
    expect(rules(report.signals)).not.toContain("orphan");
    expect(report.links).toBe(4);
  });

  test("broken links are errors, but links in code are ignored", async () => {
    const root = base({
      "README.md": "[gone](notes/gone.md) and [[missing]]\n\n```\n[[also-missing]]\n```\n\n`[[inline]]`",
    });
    const report = (await check(root, TODAY));
    expect(rules(report.errors)).toEqual(["broken-link", "broken-link"]);
    expect(report.errors[0].line).toBe(1);
  });

  test("a bare name that matches two notes is ambiguous until the folder is given", async () => {
    const root = base({
      "README.md": "[[index]] then [[a/index]]",
      "a/index.md": "",
      "b/index.md": "[[a/index]]",
    });
    const report = (await check(root, TODAY));
    expect(rules(report.errors)).toEqual(["ambiguous-link"]);
  });

  test("attachments, dotted titles, aliases, headings and extensionless paths resolve", async () => {
    const root = base({
      "README.md": "![[diagram.png]] [[v1.2 release|the release]] [[v1.2 release#Notes]] [x](notes/plain)",
      "diagram.png": "",
      "v1.2 release.md": "",
      "notes/plain.md": "",
    });
    expect((await check(root, TODAY)).errors).toEqual([]);
  });

  test("wikilinks in frontmatter count as links", async () => {
    const root = base({
      "README.md": "",
      "people/anna.md": "",
      "calls/call.md": '---\ncustomer: "[[anna]]"\n---\n',
    });
    const orphans = (await check(root, TODAY)).signals.filter((s) => s.rule === "orphan").map((s) => s.file);
    expect(orphans).toEqual(["calls/call.md"]);
  });
});

describe("frontmatter and contracts", () => {
  test("frontmatter that doesn't parse or never closes is an error", async () => {
    const root = base({
      "a.md": "---\ntitle: [unclosed\n---\n",
      "b.md": "---\ntitle: x\n",
    });
    expect(rules((await check(root, TODAY)).errors)).toEqual(["frontmatter", "frontmatter"]);
  });

  test("required fields and allowed values are enforced for the type's notes", async () => {
    const root = base({
      "types/decision.md": DECISION,
      "decisions/ok.md": "---\ntype: decision\ndate: 2026-09-01\nstatus: accepted\n---\n",
      "decisions/missing.md": "---\ntype: decision\ndate: 2026-09-01\n---\n",
      "decisions/blank.md": '---\ntype: decision\ndate: ""\nstatus: accepted\n---\n',
      "decisions/bad.md": "---\ntype: decision\ndate: 2026-09-01\nstatus: done\n---\n",
    });
    const report = (await check(root, TODAY));
    expect(report.types).toEqual(["decision"]);
    const found = report.errors.map((e) => `${e.rule} ${e.file}:${e.line}`).sort();
    expect(found).toEqual(["bad-value decisions/bad.md:4", "missing-field decisions/blank.md:3", "missing-field decisions/missing.md:1"]);
  });

  test("two contracts for one type is an error", async () => {
    const root = base({ "types/a.md": DECISION, "types/b.md": DECISION });
    expect(rules((await check(root, TODAY)).errors)).toEqual(["contract"]);
  });
});

describe("signals", () => {
  test("orphans skip the root folder, contracts and archives", async () => {
    const root = base({
      "README.md": "",
      "types/decision.md": DECISION,
      "notes/lonely.md": "",
      "archive/old.md": "",
    });
    const orphans = (await check(root, TODAY)).signals.filter((s) => s.rule === "orphan").map((s) => s.file);
    expect(orphans).toEqual(["notes/lonely.md"]);
  });

  test("overdue reviews, relative dates and long notes are reported", async () => {
    const root = base({
      "policy.md": `---\nreview: 2026-01-01\nexpires: 2027-01-01\n---\nWe agreed on this last week.\n\n${"word ".repeat(1600)}`,
    });
    const report = (await check(root, TODAY));
    expect(report.errors).toEqual([]);
    expect(rules(report.signals).sort()).toEqual(["long-note", "overdue", "relative-date"]);
  });

  test("drift in a type: fields mostly empty, headings the contract doesn't mention, unknown types", async () => {
    const note = (status: string) => `---\ntype: decision\ndate: 2026-09-01\nstatus: ${status}\nowner: n/a\n---\n## Why\n\ntext\n\n## Decision\n\ntext\n`;
    const root = base({
      "types/decision.md": DECISION,
      "d/1.md": note("accepted"),
      "d/2.md": note("proposed"),
      "d/3.md": note("accepted"),
      "d/4.md": "---\ntype: meeting\n---\n",
    });
    const report = (await check(root, TODAY));
    const messages = report.signals.filter((s) => s.rule !== "orphan").map((s) => `${s.rule}: ${s.message}`);
    expect(messages).toContain('mostly-empty: "owner" is empty in 3 of 3 decision notes');
    expect(messages).toContain('recurring-heading: "why" heads 3 of 3 decision notes, and the contract doesn\'t mention it');
    expect(messages.some((m) => m.startsWith('recurring-heading: "decision"'))).toBe(false);
    expect(messages).toContain('unknown-type: type "meeting" has no contract (1 note)');
  });

  test("tag variants across frontmatter and inline tags, but not headings or code", async () => {
    const root = base({
      "a.md": "---\ntags: [ai-agents]\n---\n## Heading\n\nAbout #AI_agent and `#not-a-tag`, issue #12.",
      "b.md": "#pricing",
    });
    const report = (await check(root, TODAY));
    const variants = report.signals.filter((s) => s.rule === "tag-variants").map((s) => s.message);
    expect(variants).toEqual(["#ai-agents, #AI_agent look like one tag"]);
  });

  test("a folder with more than a thousand notes is crowded", async () => {
    const files: Record<string, string> = { "README.md": "" };
    for (let i = 0; i < 1001; i++) files[`calls/${i}.md`] = "";
    const crowded = (await check(base(files), TODAY)).signals.filter((s) => s.rule === "crowded-folder");
    expect(crowded.map((s) => s.file)).toEqual(["calls/"]);
  });

  test("the text report groups signals and marks errors", async () => {
    const root = base({ "README.md": "[[missing]]", "notes/a.md": "", "notes/b.md": "" });
    const text = format(await check(root, TODAY));
    expect(text).toContain("✗ 1 error");
    expect(text).toContain("orphan (2)");
  });
});

describe("--files", () => {
  const files = () =>
    base({
      "README.md": "[[gone]]",
      "types/decision.md": DECISION,
      "decisions/old.md": "---\ntype: decision\n---\n[[also-gone]]",
      "decisions/new.md": "---\ntype: decision\ndate: 2026-09-01\nstatus: done\n---\nSee [[old]] and [[nowhere]]. It happened yesterday.",
      "notes/lonely.md": "",
    });

  test("checks only the listed notes, resolving links against the whole base", async () => {
    const report = await check(files(), { ...TODAY, files: ["decisions/new.md"] });
    expect(report.mode).toBe("files");
    expect(report.checked).toBe(1);
    expect(report.notes).toBe(5);
    expect(report.errors.map((e) => `${e.rule} ${e.file}`).sort()).toEqual(["bad-value decisions/new.md", "broken-link decisions/new.md"]);
    expect(rules(report.signals)).toEqual(["relative-date"]);
  });

  test("finds the contract by its file name", async () => {
    const report = await check(files(), { ...TODAY, files: ["decisions/old.md"] });
    expect(report.types).toEqual(["decision"]);
    expect(rules(report.errors).sort()).toEqual(["broken-link", "missing-field", "missing-field"]);
  });

  test("a path that isn't a note in the base is refused", async () => {
    expect(check(files(), { ...TODAY, files: ["decisions/missing.md"] })).rejects.toThrow("isn't a note");
  });
});

describe("sizes and templates", () => {
  test("a full run reports the largest folders and longest notes", async () => {
    const report = await check(
      base({ "README.md": "", "a/1.md": "word ".repeat(40), "a/2.md": "word ".repeat(900), "b/1.md": "word ".repeat(10) }),
      TODAY,
    );
    expect(report.sizes?.folders[0]).toEqual({ folder: "a/", notes: 2 });
    expect(report.sizes?.notes[0]).toEqual({ file: "a/2.md", words: 900 });
    expect(format(report)).toContain("Largest folders: a/ 2");
  });

  test("template placeholders in links are not checked", async () => {
    const report = await check(base({ "templates/call.md": "With [[{{customer}}]] on [day](<% tp.date %>.md)." }), TODAY);
    expect(report.errors).toEqual([]);
  });
});
