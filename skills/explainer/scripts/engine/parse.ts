import { SpecError, type FrontMatter, type ParsedDoc, type RawBlock, type Segment } from "./types.ts";

import { blockModules } from "./registry.ts";

/** Fence languages that are blocks; everything else stays a Markdown code block. */
const BLOCKS = new Set(Object.keys(blockModules));
const NOT_YAML = new Set(["note", "widget"]);
const CONTAINERS = new Set(["split", "stack", "sidebar"]);
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const OPEN = /^:::\s*([A-Za-z][\w-]*)(.*)$/;
const CLOSE = /^:::\s*$/;

type Container = Extract<Segment, { kind: "container" }>;
interface Fence { indent: number; marker: string; lang: string; info: string[] }

export function parseDoc(source: string, file?: string): ParsedDoc {
  const lines = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const { front, start } = frontMatter(lines);
  const root: Segment[] = [];
  const open: Container[] = [];
  let md: string[] = [];
  let mdLine = 0;

  const here = () => (open.length ? open[open.length - 1].children : root);
  const keep = (line: string, n: number) => {
    if (!md.length && !line.trim()) return;
    if (!md.length) mdLine = n;
    md.push(line);
  };
  const flush = () => {
    const text = md.join("\n").trimEnd();
    if (text) here().push({ kind: "markdown", text, line: mdLine });
    md = [];
  };

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    const fence = openFence(line);
    if (fence) {
      const end = closeFence(lines, i + 1, fence);
      if (BLOCKS.has(fence.lang)) {
        if (end < 0) throw new SpecError(`The \`${fence.lang}\` fence is never closed; add a closing ${fence.marker} line.`, n);
        flush();
        here().push({ kind: "block", block: rawBlock(fence, lines.slice(i + 1, end), n) });
      } else {
        const last = end < 0 ? lines.length - 1 : end;
        for (let j = i; j <= last; j++) keep(lines[j], j + 1);
      }
      i = end < 0 ? lines.length : end;
      continue;
    }
    if (CLOSE.test(line)) {
      if (!open.length) throw new SpecError("This `:::` closes nothing; remove it or open a container above it.", n);
      flush();
      open.pop();
      continue;
    }
    const opener = OPEN.exec(line);
    if (opener) {
      const layout = opener[1];
      if (!CONTAINERS.has(layout)) throw new SpecError(`Unknown container \`::: ${layout}\`; use split, stack or sidebar.`, n);
      if (open.length >= 2) throw new SpecError("Containers nest one level at most; close the outer one first.", n);
      flush();
      const box: Container = {
        kind: "container",
        layout: layout as Container["layout"],
        args: opener[2].trim().split(/\s+/).filter(Boolean),
        children: [],
        line: n,
      };
      here().push(box);
      open.push(box);
      continue;
    }
    keep(line, n);
  }
  if (open.length) {
    const box = open[open.length - 1];
    throw new SpecError(`\`::: ${box.layout}\` is never closed; add a line with \`:::\`.`, box.line);
  }
  flush();
  return { front, segments: root, file };
}

function frontMatter(lines: string[]): { front: FrontMatter; start: number } {
  if (lines[0]?.trim() !== "---") return { front: {}, start: 0 };
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (end < 0) throw new SpecError("Front matter is never closed; add a line with `---`.", 1);
  const data = yaml(lines.slice(1, end).join("\n"), "Front matter", 1);
  if (typeof data !== "object" || Array.isArray(data)) throw new SpecError("Front matter must be a map of `key: value` lines.", 1);
  return { front: data as FrontMatter, start: end + 1 };
}

function openFence(line: string): Fence | undefined {
  const m = FENCE.exec(line);
  if (!m) return;
  const [, indent, marker, rest] = m;
  if (marker[0] === "`" && rest.includes("`")) return;
  const words = rest.trim().split(/\s+/).filter(Boolean);
  return { indent: indent.length, marker, lang: (words.shift() ?? "").toLowerCase(), info: words };
}

function closeFence(lines: string[], from: number, fence: Fence): number {
  const close = new RegExp(`^ {0,3}${fence.marker[0]}{${fence.marker.length},}\\s*$`);
  for (let j = from; j < lines.length; j++) if (close.test(lines[j])) return j;
  return -1;
}

function rawBlock(fence: Fence, body: string[], line: number): RawBlock {
  const indent = new RegExp(`^ {0,${fence.indent}}`);
  const text = (fence.indent ? body.map((l) => l.replace(indent, "")) : body).join("\n");
  const data = NOT_YAML.has(fence.lang) ? undefined : yaml(text, `The \`${fence.lang}\` block`, line);
  return { type: fence.lang, info: fence.info, body: text, data, line };
}

function yaml(text: string, where: string, line: number): unknown {
  if (!text.trim()) return {};
  try {
    return Bun.YAML.parse(text) ?? {};
  } catch (e) {
    throw new SpecError(`${where} is not valid YAML: ${e instanceof Error ? e.message : String(e)}`, line, "spec");
  }
}
