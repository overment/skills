import { SpecError, type BlockModule, type WidgetBlock } from "../types";
import { attr, rawBlocks } from "./util";

const NAME = /^[a-z][a-z0-9-]*$/;

export const widgetModule: BlockModule<WidgetBlock> = {
  type: "widget",

  normalize(raw, ctx) {
    const name = raw.info[0] ?? "";
    if (!NAME.test(name)) {
      throw new SpecError(`widget needs a lowercase name after the fence, e.g. \`\`\`widget cost-slider (got "${name}").`, raw.line);
    }
    // Widgets register by name: a second block with the same name would run the first one's code in both places.
    const first = rawBlocks(ctx.doc).find((b) => b.type === "widget" && b.info[0] === name);
    if (first && first !== raw) {
      throw new SpecError(`widget "${name}" is already defined at line ${first.line}; give each widget its own name.`, raw.line, "id-unique");
    }
    if (!raw.body.trim()) throw new SpecError(`widget "${name}" has no code.`, raw.line);
    return { type: "widget", name, code: raw.body, line: raw.line };
  },

  render(block) {
    return `<div class="x-widget"${attr("data-widget", block.name)}></div>`;
  },
};

export function widgetCode(block: WidgetBlock): string {
  return `explainer.register(${JSON.stringify(block.name)}, (el, api) => {\n${block.code}\n});`;
}
