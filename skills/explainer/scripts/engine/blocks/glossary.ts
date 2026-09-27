import { SpecError, type BlockModule, type GlossaryBlock } from "../types";
import { attr, esc, isObj, slug } from "./util";

export const glossaryModule: BlockModule<GlossaryBlock> = {
  type: "glossary",

  normalize(raw) {
    const line = raw.line;
    if (!isObj(raw.data)) throw new SpecError("glossary must be a map of `term: one-sentence definition`.", line);
    const terms: Record<string, string> = {};
    const slugs = new Map<string, string>();
    for (const [term, definition] of Object.entries(raw.data)) {
      const text = typeof definition === "string" || typeof definition === "number" ? String(definition).trim() : "";
      if (!text) throw new SpecError(`glossary: "${term}" needs a one-sentence definition.`, line);
      const key = slug(term);
      if (!key) throw new SpecError(`glossary: "${term}" needs letters or digits.`, line);
      const clash = slugs.get(key);
      if (clash) throw new SpecError(`glossary: "${term}" and "${clash}" collide; rename one.`, line, "id-unique");
      slugs.set(key, term);
      terms[term] = text;
    }
    if (slugs.size === 0) throw new SpecError("glossary is empty; add `term: definition` lines.", line);
    return { type: "glossary", terms, line };
  },

  render(block, ctx) {
    const rows = Object.entries(block.terms)
      .map(([term, definition]) => `<dt${attr("id", `term-${slug(term)}`)}>${esc(term)}</dt><dd>${ctx.inline(definition)}</dd>`)
      .join("");
    return `<dl class="x-glossary">${rows}</dl>`;
  },

  model(block) {
    return { glossary: { ...block.terms } };
  },
};
