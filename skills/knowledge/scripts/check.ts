#!/usr/bin/env bun
// Mechanical checks for a Markdown knowledge base. Errors are broken invariants and exit 1.
// Signals are observations for the agent to judge; they never fail the run.
// It reads one note at a time and keeps only what the checks need, so it also runs on bases
// of hundreds of thousands of notes. USAGE below is the manual; ../references/upkeep.md says when to run it.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";

export type Finding = { rule: string; file: string; line?: number; message: string };
export type Report = {
  mode: "full" | "files";
  notes: number;
  checked: number;
  links: number;
  types: string[];
  ms: number;
  errors: Finding[];
  signals: Finding[];
  // Full runs only: the numbers worth watching as the base grows.
  sizes?: { folders: { folder: string; notes: number }[]; notes: { file: string; words: number }[] };
};
export type Options = { today?: string; files?: string[] };

type Line = { n: number; text: string };
type Parsed = { data: Record<string, unknown>; keys: Record<string, number>; yaml: Line[]; lines: Line[]; body: string };
type Typed = { file: string; data: Record<string, unknown>; keys: Record<string, number>; headings: string[] };
type Contract = { file: string; required: string[]; values: Record<string, string[]>; body: string };

const USAGE = `Usage: bun check.ts <base-dir> [--json] [--today YYYY-MM-DD] [--files <path>... | --files -]

Checks a Markdown knowledge base. Only .md files are notes. Dot-folders and
node_modules are skipped, and notes in the root folder count as entry points.

Links
  [[wikilinks]] resolve by file name anywhere in the base; a folder in the link
  narrows the match. They count inside frontmatter too, so a field can hold links
  to vocabulary notes. Markdown links resolve relative to the note, or to the base
  root when they start with /. Template syntax such as {{x}} or <% x %> is skipped.

Type contracts
  A note with "defines: <type>" is that type's contract. Its "required" fields and
  "values" lists are checked on every note with "type: <type>".

Errors (exit 1)
  broken-link        a link to no file
  ambiguous-link     a bare name that matches several notes
  frontmatter        frontmatter that doesn't parse, or is never closed
  contract           a malformed contract, or two contracts for one type
  missing-field      a required field that's missing or blank
  bad-value          a value outside its type's list

Signals (reported, never fail)
  orphan             nothing links to the note (root and archive/ folders exempt)
  overdue            a review, review_by, expires or valid_until date has passed
  mostly-empty       a field blank or a placeholder in half a type's notes
  recurring-heading  a heading in most notes of a type that its contract doesn't
                     name (as a heading, or in quotes, backticks or bold)
  unknown-type       a type with no contract, when the base has contracts
  tag-variants       tags that differ only by case, plural or separator
  single-use-tags    tags used once, in bases of 20 notes or more
  relative-date      "yesterday", "last week" and the like
  long-note          over 1,500 words
  crowded-folder     over 1,000 notes directly in one folder
A full run also prints the largest folders and the longest notes.

--files checks only the listed notes: paths relative to the base or the current
folder, or "-" to read them from stdin, one per line. It checks their links
against the whole base, their frontmatter and their fields. It finds a type's
contract by file name, so name each contract after its type (types/decision.md).
Orphans, drift, tags and crowded folders need a full run.`;

const DUE_FIELDS = new Set(["review", "review_by", "expires", "valid_until"]);
const PLACEHOLDERS = new Set(["n/a", "na", "none", "unknown", "tbd", "todo", "-", "?"]);
const LONG_NOTE_WORDS = 1500;
const CROWDED_FOLDER = 1000;
const SINGLE_USE_TAGS_FROM = 20;
const SHOWN_PER_RULE = 10;
const READS_AT_ONCE = 64;

const RELATIVE_DATE =
  /\b(yesterday|tomorrow|(?:last|next|this) (?:week|month|year|quarter|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:\d+|a few|a couple of|two|three|several) (?:days|weeks|months|years) ago)\b/i;
const WIKILINK = /!?\[\[([^\]\n]+?)\]\]/g;
const MD_LINK = /!?\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)[^)\n]*\)/g;
const REF_DEF = /^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]*>|\S+)/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const INLINE_TAG = /(?:^|[\s(])#([\p{L}_][\p{L}\p{N}_/-]*)/gu;
const HEADING = /^#{2,3}\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

export async function check(baseDir: string, options: Options = {}): Promise<Report> {
  const started = performance.now();
  const root = resolve(baseDir);
  const today = options.today ?? localDate();
  const { files, dirs } = walk(root);
  const notes = files.filter(isNote);
  const incremental = options.files !== undefined;
  const targets = incremental ? targetNotes(root, files, options.files!) : notes;
  const resolver = makeResolver(root, files, dirs);
  const errors: Finding[] = [];
  const signals: Finding[] = [];

  const linked = new Set<string>();
  const contracts = new Map<string, Contract>();
  const typed: Typed[] = [];
  const tagFiles = new Map<string, { count: number; first: string }>();
  const longest: { file: string; chars: number; words: number }[] = [];
  let links = 0;

  // Reads run concurrently because a large base is bound by file-system calls, not by parsing.
  await eachConcurrently(targets, READS_AT_ONCE, async (file) => {
    const note = parse(file, await readFile(join(root, file), "utf8"), errors);

    // Links: wikilinks anywhere, Markdown links in the body.
    for (const { n, text } of [...note.yaml, ...note.lines]) {
      if (!text.includes("[[")) continue;
      for (const m of text.matchAll(WIKILINK)) {
        const target = m[1].split("|")[0].split("#")[0].split("^")[0].replace(/\\$/, "").trim();
        if (!target || placeholderLink(target)) continue;
        links++;
        const hits = resolver.wiki(target);
        if (hits.length === 1) {
          if (hits[0] !== file) linked.add(hits[0]);
        } else if (hits.length === 0) {
          errors.push({ rule: "broken-link", file, line: n, message: `[[${target}]] matches no file` });
        } else {
          errors.push({ rule: "ambiguous-link", file, line: n, message: `[[${target}]] matches ${hits.join(", ")}; add the folder to the link` });
        }
      }
    }
    for (const { n, text } of note.lines) {
      const hrefs = text.includes("](") ? [...text.matchAll(MD_LINK)].map((m) => m[1]) : [];
      const definition = text.includes("]:") ? text.match(REF_DEF) : null;
      if (definition) hrefs.push(definition[1]);
      for (const target of hrefs) {
        if (placeholderLink(target)) continue;
        const hit = resolver.path(file, target);
        if (hit === null) continue;
        links++;
        if (hit) {
          if (hit !== file) linked.add(hit);
        } else {
          errors.push({ rule: "broken-link", file, line: n, message: `${target} doesn't exist` });
        }
      }
    }

    // Contracts and typed notes, kept compact for the checks after the pass.
    if (note.data.defines !== undefined) addContract(contracts, file, note, errors);
    else if (asList(note.data.type)?.length) typed.push({ file, data: note.data, keys: note.keys, headings: incremental ? [] : headingsOf(note) });

    if (archived(file)) return;

    // Signals about this note alone.
    for (const [key, value] of Object.entries(note.data)) {
      if (!DUE_FIELDS.has(key.toLowerCase())) continue;
      const date = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/)?.[0];
      if (date && date < today) signals.push({ rule: "overdue", file, line: note.keys[key], message: `${key} ${date} has passed` });
    }
    let chars = 0;
    for (const { n, text } of note.lines) {
      chars += text.length;
      const m = text.match(RELATIVE_DATE);
      if (m) signals.push({ rule: "relative-date", file, line: n, message: `"${m[0]}" is relative` });
    }
    const shortest = longest.length < 3 ? 0 : longest[longest.length - 1].chars;
    if (chars > LONG_NOTE_WORDS * 2 || (!incremental && chars > shortest)) {
      const words = note.lines.reduce((sum, { text }) => sum + (text.match(/\S+/g)?.length ?? 0), 0);
      if (words > LONG_NOTE_WORDS) signals.push({ rule: "long-note", file, message: `${words} words` });
      if (!incremental && chars > shortest) {
        longest.push({ file, chars, words });
        longest.sort((a, b) => b.chars - a.chars);
        longest.length = Math.min(longest.length, 3);
      }
    }
    if (!incremental) collectTags(note, file, tagFiles);
  });

  // In --files mode a contract is found by its file name: types/decision.md defines decision.
  if (incremental) {
    for (const note of typed) {
      for (const type of asList(note.data.type) ?? []) {
        if (contracts.has(type)) continue;
        for (const file of resolver.byStem(type)) {
          const parsed = parse(file, readFileSync(join(root, file), "utf8"), errors);
          if (parsed.data.defines === type) addContract(contracts, file, parsed, errors);
        }
      }
    }
  }

  // Fixed fields and allowed values.
  const byType = new Map<string, Typed[]>();
  for (const note of typed) {
    for (const type of asList(note.data.type) ?? []) {
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(note);
    }
  }
  for (const [type, members] of byType) {
    const contract = contracts.get(type);
    if (!contract) continue;
    for (const note of members) {
      for (const field of contract.required) {
        if (blank(note.data[field])) errors.push({ rule: "missing-field", file: note.file, line: note.keys[field] ?? 1, message: `"${field}" is required for type ${type}` });
      }
      for (const [field, allowed] of Object.entries(contract.values)) {
        const value = note.data[field];
        if (blank(value)) continue;
        for (const v of Array.isArray(value) ? value : [value]) {
          if (!allowed.includes(String(v))) errors.push({ rule: "bad-value", file: note.file, line: note.keys[field], message: `${field} "${v}" isn't one of: ${allowed.join(", ")} (type ${type})` });
        }
      }
    }
  }

  if (!incremental) {
    signals.push(...wholeBaseSignals({ notes, linked, contracts, byType, tagFiles }));
  }
  const sizes = incremental ? undefined : { folders: largestFolders(notes, 3), notes: longest.map(({ file, words }) => ({ file, words })) };

  errors.sort(byPlace);
  signals.sort(byPlace);
  return {
    mode: incremental ? "files" : "full",
    notes: notes.length,
    checked: targets.length,
    links,
    types: [...contracts.keys()].sort(),
    ms: Math.round(performance.now() - started),
    errors,
    signals,
    sizes,
  };
}

function largestFolders(notes: string[], top: number): { folder: string; notes: number }[] {
  const perFolder = new Map<string, number>();
  for (const file of notes) {
    const folder = file.includes("/") ? `${file.slice(0, file.lastIndexOf("/"))}/` : "./";
    perFolder.set(folder, (perFolder.get(folder) ?? 0) + 1);
  }
  return [...perFolder].sort((a, b) => b[1] - a[1]).slice(0, top).map(([folder, count]) => ({ folder, notes: count }));
}

function wholeBaseSignals(base: {
  notes: string[];
  linked: Set<string>;
  contracts: Map<string, Contract>;
  byType: Map<string, Typed[]>;
  tagFiles: Map<string, { count: number; first: string }>;
}): Finding[] {
  const signals: Finding[] = [];
  const contractFiles = new Set([...base.contracts.values()].map((c) => c.file));

  for (const file of base.notes) {
    if (!file.includes("/") || archived(file) || contractFiles.has(file)) continue;
    if (!base.linked.has(file)) signals.push({ rule: "orphan", file, message: "nothing links here" });
  }

  for (const [type, all] of base.byType) {
    const members = all.filter((n) => !archived(n.file));
    if (members.length < 3) continue;
    const contract = base.contracts.get(type);
    const where = contract?.file ?? members[0].file;
    const empty = new Map<string, number>();
    for (const m of members) {
      for (const [field, value] of Object.entries(m.data)) if (field !== "type" && placeholder(value)) empty.set(field, (empty.get(field) ?? 0) + 1);
    }
    for (const [field, count] of empty) {
      if (count >= 2 && count * 2 >= members.length) {
        signals.push({ rule: "mostly-empty", file: where, message: `"${field}" is empty in ${count} of ${members.length} ${type} notes` });
      }
    }
    const counts = new Map<string, number>();
    for (const m of members) for (const h of m.headings) counts.set(h, (counts.get(h) ?? 0) + 1);
    for (const [heading, count] of counts) {
      if (count < 3 || count * 5 < members.length * 3 || (contract && names(contract.body, heading))) continue;
      const tail = contract ? ", and the contract doesn't mention it" : "";
      signals.push({ rule: "recurring-heading", file: where, message: `"${heading}" heads ${count} of ${members.length} ${type} notes${tail}` });
    }
  }

  if (base.contracts.size) {
    for (const [type, members] of base.byType) {
      if (base.contracts.has(type)) continue;
      const count = members.length === 1 ? "1 note" : `${members.length} notes`;
      signals.push({ rule: "unknown-type", file: members[0].file, message: `type "${type}" has no contract (${count})` });
    }
  }

  const spellings = new Map<string, string[]>();
  for (const tag of base.tagFiles.keys()) {
    const key = tag.toLowerCase().replace(/[\s_-]+/g, "-").replace(/(?<=[a-z]{2}[^s])s$/, "");
    spellings.set(key, [...(spellings.get(key) ?? []), tag]);
  }
  for (const group of spellings.values()) {
    if (group.length < 2) continue;
    signals.push({ rule: "tag-variants", file: base.tagFiles.get(group[0])!.first, message: `${group.map((t) => `#${t}`).join(", ")} look like one tag` });
  }
  const live = base.notes.filter((f) => !archived(f)).length;
  if (live >= SINGLE_USE_TAGS_FROM) {
    const once = [...base.tagFiles].filter(([, use]) => use.count === 1).map(([t]) => `#${t}`);
    if (once.length) {
      const more = once.length > 12 ? ", …" : "";
      signals.push({ rule: "single-use-tags", file: "", message: `${once.length} tags are used once: ${once.slice(0, 12).join(", ")}${more}` });
    }
  }

  const perFolder = new Map<string, number>();
  for (const file of base.notes) {
    const folder = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".";
    perFolder.set(folder, (perFolder.get(folder) ?? 0) + 1);
  }
  for (const [folder, count] of perFolder) {
    if (count > CROWDED_FOLDER) signals.push({ rule: "crowded-folder", file: `${folder}/`, message: `${count} notes directly in this folder; shard it by date or ID prefix` });
  }

  return signals;
}

export function format(report: Report): string {
  const types = report.types.length ? `types: ${report.types.join(", ")}` : "no type contracts";
  const scope = report.mode === "files" ? `${report.checked} of ${report.notes} notes checked` : `${report.notes} notes`;
  const out = [`${scope}, ${report.links} links, ${types} · ${(report.ms / 1000).toFixed(1)} s`, ""];
  out.push(report.errors.length ? `✗ ${plural(report.errors.length, "error")}` : "✓ no errors");
  for (const e of report.errors.slice(0, 200)) out.push(`  ${where(e)}  ${e.rule}  ${e.message}`);
  if (report.errors.length > 200) out.push(`  … ${report.errors.length - 200} more (--json lists them all)`);
  if (report.signals.length) {
    out.push("", `· ${plural(report.signals.length, "signal")} to judge`);
    for (const [rule, items] of Map.groupBy(report.signals, (s) => s.rule)) {
      out.push(`  ${rule} (${items.length})`);
      for (const s of items.slice(0, SHOWN_PER_RULE)) out.push(`    ${s.file ? `${where(s)}  ` : ""}${s.message}`);
      if (items.length > SHOWN_PER_RULE) out.push(`    … ${items.length - SHOWN_PER_RULE} more`);
    }
  }
  if (report.sizes) {
    const n = (x: number) => x.toLocaleString("en-US");
    out.push("", `Largest folders: ${report.sizes.folders.map((f) => `${f.folder} ${n(f.notes)}`).join(" · ") || "none"}`);
    out.push(`Longest notes: ${report.sizes.notes.map((f) => `${f.file} ${n(f.words)} words`).join(" · ") || "none"}`);
  }
  if (report.mode === "files") out.push("", "Orphans, drift, tags and crowded folders need a full run.");
  return out.join("\n");
}

function walk(root: string): { files: string[]; dirs: Set<string> } {
  const files: string[] = [];
  const dirs = new Set<string>();
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.add(relative(root, path).split(sep).join("/").toLowerCase());
        visit(path);
      } else if (entry.isFile() || (entry.isSymbolicLink() && statSync(path, { throwIfNoEntry: false })?.isFile())) {
        files.push(relative(root, path).split(sep).join("/"));
      }
    }
  };
  visit(root);
  return { files: files.sort(), dirs };
}

function targetNotes(root: string, files: string[], paths: string[]): string[] {
  const known = new Map(files.map((f) => [f.toLowerCase(), f]));
  const out = new Set<string>();
  for (const path of paths) {
    const fromCwd = resolve(path);
    const abs = existsSync(fromCwd) ? fromCwd : resolve(root, path);
    const rel = relative(root, abs).split(sep).join("/");
    const file = known.get(rel.toLowerCase());
    if (!file || !isNote(file)) throw new Error(`${path} isn't a note in ${root}`);
    out.add(file);
  }
  return [...out];
}

function parse(file: string, text: string, errors: Finding[]): Parsed {
  const all = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let data: Record<string, unknown> = {};
  let yaml: Line[] = [];
  let start = 0;
  if (all[0]?.trim() === "---") {
    const end = all.findIndex((l, i) => i > 0 && (l.trim() === "---" || l.trim() === "..."));
    if (end < 0) {
      errors.push({ rule: "frontmatter", file, line: 1, message: "frontmatter is never closed with ---" });
    } else {
      yaml = all.slice(1, end).map((text, i) => ({ n: i + 2, text }));
      start = end + 1;
      try {
        const parsed = Bun.YAML.parse(yaml.map((l) => l.text).join("\n"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
        else if (parsed != null) errors.push({ rule: "frontmatter", file, line: 1, message: "frontmatter isn't a map of fields" });
      } catch (e) {
        errors.push({ rule: "frontmatter", file, line: 1, message: `frontmatter doesn't parse: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` });
      }
    }
  }
  const lines: Line[] = [];
  let fence = "";
  for (let i = start; i < all.length; i++) {
    const raw = all[i];
    const marker = raw.includes("``") || raw.includes("~~") ? raw.match(FENCE) : null;
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = "";
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    let text = raw;
    if (text.includes("`")) text = text.replace(/`[^`\n]*`/g, "");
    if (text.includes("<!--")) text = text.replace(/<!--.*?-->/g, "");
    lines.push({ n: i + 1, text });
  }
  const keys: Record<string, number> = {};
  for (const { n, text } of yaml) {
    const m = text.match(/^"?([^":#\s][^":]*?)"?\s*:/);
    if (m && !(m[1] in keys)) keys[m[1]] = n;
  }
  const body = data.defines !== undefined ? all.slice(start).join("\n") : "";
  return { data, keys, yaml, lines, body };
}

function headingsOf(note: Parsed): string[] {
  const out = new Set<string>();
  for (const { text } of note.lines) {
    if (!text.startsWith("##")) continue;
    const h = text.match(HEADING);
    if (h) out.add(h[1].toLowerCase());
  }
  return [...out];
}

function collectTags(note: Parsed, file: string, tagFiles: Map<string, { count: number; first: string }>) {
  const tags = new Set<string>();
  for (const key of ["tags", "tag"]) {
    const value = note.data[key];
    const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
    for (const t of raw) if (String(t ?? "").trim()) tags.add(String(t).trim().replace(/^#/, ""));
  }
  for (const { text } of note.lines) {
    if (!text.includes("#")) continue;
    for (const m of text.matchAll(INLINE_TAG)) tags.add(m[1]);
  }
  for (const t of tags) {
    const use = tagFiles.get(t);
    if (use) use.count++;
    else tagFiles.set(t, { count: 1, first: file });
  }
}

function addContract(contracts: Map<string, Contract>, file: string, note: Parsed, errors: Finding[]) {
  const name = note.data.defines;
  const at = note.keys.defines;
  if (typeof name !== "string" || !name.trim()) {
    errors.push({ rule: "contract", file, line: at, message: "`defines` must name one type" });
    return;
  }
  const required = asList(note.data.required);
  if (!required) errors.push({ rule: "contract", file, line: note.keys.required, message: "`required` must be a list of field names" });
  const values: Record<string, string[]> = {};
  const raw = note.data.values;
  if (raw != null && (typeof raw !== "object" || Array.isArray(raw))) {
    errors.push({ rule: "contract", file, line: note.keys.values, message: "`values` must map each field to its allowed values" });
  } else {
    for (const [field, allowed] of Object.entries((raw ?? {}) as Record<string, unknown>)) values[field] = asList(allowed) ?? [];
  }
  const existing = contracts.get(name);
  if (existing) errors.push({ rule: "contract", file, line: at, message: `type "${name}" is already defined in ${existing.file}` });
  else contracts.set(name, { file, required: required ?? [], values, body: note.body });
}

function makeResolver(root: string, files: string[], dirs: Set<string>) {
  const byLower = new Map(files.map((f) => [f.toLowerCase(), f]));
  const notesByStem = new Map<string, string[]>();
  const filesByName = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, file: string) => {
    const list = map.get(key);
    if (list) list.push(file);
    else map.set(key, [file]);
  };
  for (const file of files) {
    const lower = file.toLowerCase();
    const name = lower.slice(lower.lastIndexOf("/") + 1);
    add(filesByName, name, file);
    if (name.endsWith(".md")) add(notesByStem, name.slice(0, -3), file);
  }
  const under = (file: string, path: string) => file === path || file.endsWith(`/${path}`);

  return {
    byStem: (stem: string) => notesByStem.get(stem.toLowerCase()) ?? [],
    // Obsidian-style: a bare name matches a note anywhere; a path matches by suffix.
    wiki(target: string): string[] {
      const lower = target.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
      const stem = lower.endsWith(".md") ? lower.slice(0, -3) : lower;
      const notes = (notesByStem.get(stem.slice(stem.lastIndexOf("/") + 1)) ?? []).filter((f) => under(f.toLowerCase().slice(0, -3), stem));
      if (notes.length > 1) {
        const exact = notes.filter((f) => f.toLowerCase().slice(0, -3) === stem);
        if (exact.length === 1) return exact;
      }
      if (notes.length || lower.endsWith(".md")) return notes;
      return (filesByName.get(lower.slice(lower.lastIndexOf("/") + 1)) ?? []).filter((f) => under(f.toLowerCase(), lower));
    },
    // Markdown links resolve relative to the note, or to the base root when they start with /.
    // Returns null for links that aren't to local files, undefined for missing ones.
    path(from: string, target: string): string | null | undefined {
      let t = target.startsWith("<") ? target.slice(1, -1).trim() : target;
      if (!t || t.startsWith("#") || SCHEME.test(t)) return null;
      t = t.split("#")[0].split("?")[0];
      try {
        t = decodeURIComponent(t);
      } catch {}
      const rel = posix.normalize(t.startsWith("/") ? t.slice(1) : posix.join(posix.dirname(from), t)).replace(/\/$/, "");
      const lower = rel.toLowerCase();
      const hit = byLower.get(lower) ?? byLower.get(`${lower}.md`);
      if (hit) return hit;
      if (dirs.has(lower) || lower === ".") return rel;
      // Outside the base, or in a skipped folder: ask the file system.
      const abs = resolve(root, rel);
      return existsSync(abs) || existsSync(`${abs}.md`) ? rel : undefined;
    },
  };
}

// A contract names a heading when it uses it as a heading, or quotes, backticks or bolds it.
function names(body: string, heading: string): boolean {
  const h = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mark = "[\"'`*“”‘’]";
  return new RegExp(`^#{1,6}\\s+${h}\\s*$|${mark}${h}${mark}`, "im").test(body);
}

async function eachConcurrently<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Findings in a stable order: by file and line, with base-wide ones (no file) last.
function byPlace(a: Finding, b: Finding): number {
  if (!a.file !== !b.file) return a.file ? -1 : 1;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return (a.line ?? 0) - (b.line ?? 0);
}

// Template syntax such as {{customer}} or <% tp.date %> isn't a link to check.
function placeholderLink(target: string): boolean {
  return target.includes("{{") || target.includes("<%");
}

function isNote(file: string): boolean {
  return file.toLowerCase().endsWith(".md");
}

function asList(value: unknown): string[] | undefined {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map(String);
  return undefined;
}

function blank(value: unknown): boolean {
  return value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
}

function placeholder(value: unknown): boolean {
  return blank(value) || (typeof value === "string" && PLACEHOLDERS.has(value.trim().toLowerCase()));
}

function archived(file: string): boolean {
  return /(^|\/)archive\//i.test(file);
}

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function where(f: Finding): string {
  return f.line ? `${f.file}:${f.line}` : f.file;
}

if (import.meta.main) {
  if (typeof Bun === "undefined" || typeof Bun.YAML?.parse !== "function") {
    console.error("check.ts needs Bun 1.4 or newer. Run `bun upgrade`.");
    process.exit(2);
  }
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }
  let json = false;
  let today: string | undefined;
  let base: string | undefined;
  let files: string[] | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--today") today = args[++i];
    else if (arg === "--files") {
      files = [];
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) files.push(args[++i]);
      if (files.length === 1 && files[0] === "-") files = (await Bun.stdin.text()).split(/\r?\n/).filter((l) => l.trim());
    } else if (!arg.startsWith("-") && !base) base = arg;
    else {
      console.error(`check.ts: unexpected argument "${arg}".\n\n${USAGE}`);
      process.exit(2);
    }
  }
  if (today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    console.error("check.ts: --today takes a date like 2026-09-29.");
    process.exit(2);
  }
  if (!base || !existsSync(base) || !statSync(base).isDirectory()) {
    console.error(base ? `check.ts: ${base} isn't a folder.` : USAGE);
    process.exit(2);
  }
  let report: Report;
  try {
    report = await check(base, { today, files });
  } catch (e) {
    console.error(`check.ts: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  console.log(json ? JSON.stringify(report, null, 2) : format(report));
  process.exit(report.errors.length ? 1 : 0);
}
