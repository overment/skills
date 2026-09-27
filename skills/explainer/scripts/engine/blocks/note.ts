import { safeMarkdown } from "../markdown.ts";
import { SpecError, type BlockModule, type NoteBlock } from "../types";
import { attr } from "./util";

const TONES = ["info", "warn", "danger", "ok"] as const;

export const noteModule: BlockModule<NoteBlock> = {
  type: "note",

  normalize(raw) {
    const tone = raw.info[0] ?? "info";
    if (!(TONES as readonly string[]).includes(tone)) {
      throw new SpecError(`note: tone "${tone}" is not one of ${TONES.join(", ")}.`, raw.line);
    }
    if (!raw.body.trim()) throw new SpecError("note is empty; write the note as Markdown inside the fence.", raw.line);
    return { type: "note", tone: tone as NoteBlock["tone"], markdown: raw.body, line: raw.line };
  },

  render(block) {
    return `<aside class="x-note"${attr("data-tone", block.tone)} role="note">${safeMarkdown(block.markdown)}</aside>`;
  },
};
