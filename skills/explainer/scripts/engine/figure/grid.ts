import type { Theme } from "../types.ts";

export interface Rect { x: number; y: number; w: number; h: number }

export function cellRect(at: [number, number], span: [number, number], theme: Theme): Rect {
  const { pad, cell: [cw, ch], gap: [gx, gy] } = theme.grid;
  return {
    x: pad + at[0] * (cw + gx),
    y: pad + at[1] * (ch + gy),
    w: span[0] * cw + (span[0] - 1) * gx,
    h: span[1] * ch + (span[1] - 1) * gy,
  };
}

export function figureSize(grid: [number, number], theme: Theme): { w: number; h: number } {
  const area = cellRect([0, 0], grid, theme);
  return { w: area.w + 2 * theme.grid.pad, h: area.h + 2 * theme.grid.pad };
}

/** Zones hug their cells; connectors in the gutters stay clear of the border. */
export const GROUP_MARGIN = 12;

export function groupRect(from: [number, number], to: [number, number], theme: Theme): Rect {
  const a = cellRect(from, [1, 1], theme), b = cellRect(to, [1, 1], theme);
  return inflate({ x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y }, GROUP_MARGIN);
}

export function labelCapacity(spanCols: number, theme: Theme): number {
  const { w } = cellRect([0, 0], [spanCols, 1], theme);
  return Math.floor((w - 24) / (theme.type.nodeLabel * 0.6));
}

const NARROW = new Set("ijl.,:;|!'");
const SEMI = new Set("frt ");

function charEm(c: string): number {
  if (NARROW.has(c)) return 0.28;
  if (SEMI.has(c)) return 0.36;
  if (c === "M" || c === "W") return 0.86;
  if ((c >= "A" && c <= "Z") || c === "m" || c === "w") return 0.72;
  if (c >= "0" && c <= "9") return 0.58;
  return 0.54;
}

export function textWidth(text: string, px: number, font: "sans" | "mono"): number {
  if (font === "mono") return [...text].length * 0.6 * px;
  let em = 0;
  for (const c of text) em += charEm(c);
  return em * px;
}

/** Sans text at weight 600, which a label turns when selected: masks and margins hold this width. */
export function boldWidth(text: string, px: number): number {
  return textWidth(text, px, "sans") * 1.08;
}

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

/** Strict overlap; zero-width rects (segments) count when they pass through the interior. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function segmentBox(a: [number, number], b: [number, number]): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}
