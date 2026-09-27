import { SpecError, type BlockModule, type RenderContext, type StepsBlock } from "../types";
import { allowKeys, attr, entries, esc, findFigureRaw, isObj, rawBlocks, requireMap, requireString, stringList, type Fields } from "./util";

/**
 * Scene id → title for the block `target`, in source order: a figure's `scenes`, then any block's `story:`
 * (scene id "<block>-story", the same id blocks.ts gives the story in the model).
 */
function sceneTitles(ctx: RenderContext, target: string, line: number): Map<string, string> {
  const figure = findFigureRaw(ctx.doc, target)[0];
  const storied = rawBlocks(ctx.doc).find((b) => isObj(b.data) && String(b.data.id ?? "") === target && Array.isArray(b.data.story) && b.data.story.length);
  if (!figure && !storied) {
    const known = rawBlocks(ctx.doc)
      .filter((b) => isObj(b.data) && b.data.id != null && (b.type === "figure" || Array.isArray(b.data.story)))
      .map((b) => String((b.data as Fields).id));
    throw new SpecError(`steps: "${target}" is neither a figure nor a block with \`story:\`. Candidates: ${known.join(", ") || "none"}.`, line, "ref-exists");
  }
  let scenes: [string, Fields][] = [];
  try {
    if (figure) scenes = entries((figure.data as Fields).scenes, "scenes");
  } catch {
    // The figure module reports malformed scenes; steps just sees none.
  }
  const titles = new Map(scenes.map(([id, f]) => [id, typeof f.title === "string" && f.title.trim() ? f.title.trim() : id]));
  if (storied) {
    const title = (storied.data as Fields).title;
    titles.set(`${target}-story`, typeof title === "string" && title.trim() ? title.trim() : "Walk through");
  }
  return titles;
}

export const stepsModule: BlockModule<StepsBlock> = {
  type: "steps",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "steps", line);
    allowKeys(data, ["for", "scenes"], "steps", line);
    const target = requireString(data, "for", "steps", line);
    const titles = sceneTitles(ctx, target, line);
    if (titles.size === 0) throw new SpecError(`steps: "${target}" has no \`scenes\` or \`story\` to step through.`, line, "ref-exists");
    const scenes = data.scenes == null ? undefined : stringList(data.scenes, "steps scenes", line);
    for (const scene of scenes ?? []) {
      if (!titles.has(scene)) {
        throw new SpecError(`steps: "${target}" has no scene "${scene}". Scenes: ${[...titles.keys()].join(", ")}.`, line, "ref-exists");
      }
    }
    return { type: "steps", for: target, scenes, line };
  },

  render(block, ctx) {
    const titles = sceneTitles(ctx, block.for, block.line);
    const list = (block.scenes ?? [...titles.keys()])
      .map((id) => `<li><button type="button" class="x-scene"${attr("data-scene", id)}>${esc(titles.get(id) ?? id)}</button></li>`)
      .join("");
    const bar =
      `<div class="x-steps-bar">` +
      `<button type="button" class="x-btn" data-action="prev" aria-label="Previous step">←</button>` +
      `<span class="x-steps-count" aria-live="polite"></span>` +
      `<button type="button" class="x-btn" data-action="next" aria-label="Next step">→</button>` +
      `<button type="button" class="x-btn" data-action="play" aria-label="Play">Play</button>` +
      `<span class="x-steps-keys" aria-hidden="true">← → step · Home End · R replay</span>` +
      `</div>`;
    return `<div class="x-steps"${attr("data-for", block.for)}>${bar}<ol class="x-steps-list">${list}</ol><p class="x-steps-note" aria-live="polite"></p></div>`;
  },
};
