// Obstacle boxes for note markers, read back from rendered markup: axes, legends and reference labels are built by
// kit helpers that return SVG only, and a marker must not sit on their text any more than on a mark's own labels.
import { textWidth, type Frame } from "../kit.ts";

const ENTITY: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/**
 * The box of every unrotated `<text>` in `svg`, measured as sans at `px` from its baseline (the same box value labels
 * use: 0.8em above the baseline, 1em tall). A legend label (not a legend note) also covers the swatch 22px to its left.
 */
export function textBoxes(svg: string, px: number): Frame[] {
  const out: Frame[] = [];
  for (const [, attrs, raw] of svg.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)) {
    if (attr(attrs, "transform")) continue;
    const x = Number(attr(attrs, "x")), y = Number(attr(attrs, "y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = textWidth(raw.replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITY[e] ?? e), px, "sans");
    const anchor = attr(attrs, "text-anchor");
    const left = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
    const cls = ` ${attr(attrs, "class") ?? ""} `;
    const swatch = cls.includes(" x-legend-label ") && !cls.includes(" x-legend-note ") ? 22 : 0;
    out.push({ x: left - swatch, y: y - px * 0.8, w: w + swatch, h: px });
  }
  return out;
}
