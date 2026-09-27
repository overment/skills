// Pure geometry and colour math for audit's in-page checks.
// No imports and no module state: audit installs these functions into the page by source text
// (see `geometryScript`), as declarations in one closure, so they may call each other.

export interface Rect { x: number; y: number; w: number; h: number }
export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

/** True when the segment a→b touches the rectangle (Liang–Barsky clipping). */
export function segmentHitsRect(ax: number, ay: number, bx: number, by: number, r: Rect): boolean {
  if (r.w <= 0 || r.h <= 0) return false;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - r.x, r.x + r.w - ax, ay - r.y, r.y + r.h - ay];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false; // parallel to this edge and outside it
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 <= t1;
}

/** Index of the first segment of a polyline that touches the rectangle, or -1. */
export function polylineHitsRect(points: number[][], r: Rect): number {
  for (let i = 1; i < points.length; i++) {
    if (segmentHitsRect(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], r)) return i - 1;
  }
  return -1;
}

/** Area shared by two rectangles. */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Share (0–1) of the parts' total area that `cover` hides. Parts are a footprint: the boxes of
 * filled shapes and labels, and small squares along stroked lines, so a long diagonal edge
 * counts only where it is drawn, not its whole bounding box.
 */
export function coverage(cover: Rect, parts: Rect[]): number {
  let total = 0, hidden = 0;
  for (const p of parts) {
    const area = Math.max(0, p.w) * Math.max(0, p.h);
    if (!area) continue;
    total += area;
    hidden += overlapArea(cover, p);
  }
  return total ? Math.min(1, hidden / total) : 0;
}

/** Small squares along a polyline, `step` apart, `size` wide: the drawn footprint of a stroke. */
export function strokeFootprint(points: number[][], size: number, step = 3): Rect[] {
  const out: Rect[] = [];
  const half = size / 2;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
      out.push({ x: x - half, y: y - half, w: size, h: size });
    }
  }
  return out;
}

/** WCAG 2 contrast ratio of two opaque sRGB colours (0–255 channels). */
export function contrastRatio(a: RGB, b: RGB): number {
  const lum = (c: RGB) => {
    const [r, g, bl] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` with alpha 0–1 painted over an opaque `bg`. */
export function composite(fg: RGBA, bg: RGB): RGB {
  const a = Math.max(0, Math.min(1, fg[3]));
  return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))) as RGB;
}

/** The CSS `saturate(s)` filter applied to one colour (Filter Effects feColorMatrix). */
export function saturate(c: RGB, s: number): RGB {
  const [r, g, b] = c;
  const m = [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
  return m.map((row) => Math.max(0, Math.min(255, Math.round(row[0] * r + row[1] * g + row[2] * b)))) as RGB;
}

/**
 * A relation row that names both of its endpoints repeats what the card already says
 * ("Security review → Public launch  Public launch"). A row should read "verb → Target".
 * Names match whole: "Payment" is not in "Extended by CardPayment", and "Search" is not
 * repeated by the chip "Search by name". The target is taken out of the row first, so a
 * source name inside the target's own name never counts.
 */
export function repeatsEndpoints(row: string, self: string, target: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const text = norm(row), a = norm(self), b = norm(target);
  if (!a || !b || a === b) return false;
  const whole = (name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "gu");
  const targets = text.match(whole(b))?.length ?? 0;
  if (targets > 1) return true;
  const rest = text.replace(whole(b), "$1 ");
  return targets > 0 && whole(a).test(rest);
}

/**
 * Ellipses the engine inserted: text that ends in "…" (or "...") where the source never has that
 * text, so the engine cut it short. An ellipsis inside a sentence ("L1, L2… and so on") is prose,
 * not truncation. Returns the offending strings.
 */
export function engineEllipses(texts: string[], source: string): string[] {
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  const src = squash(source);
  const out: string[] = [];
  for (const raw of texts) {
    const text = squash(raw);
    const tail = /(…|\.\.\.)$/.exec(text);
    if (!tail || src.includes(text)) continue;
    // The author may have written the ellipsis inside a longer string: compare the words before it.
    const before = text.slice(Math.max(0, tail.index - 12));
    if (!src.includes(before) && !out.includes(text)) out.push(text);
  }
  return out;
}

const FUNCTIONS = [segmentHitsRect, polylineHitsRect, overlapArea, coverage, strokeFootprint, contrastRatio, composite, saturate, repeatsEndpoints, engineEllipses];

/** Source that defines `window.__xg` with every function above, for Runtime.evaluate. */
export function geometryScript(): string {
  const names = FUNCTIONS.map((f) => f.name);
  return `window.__xg = (() => {\n${FUNCTIONS.map(String).join("\n")}\nreturn { ${names.join(", ")} };\n})();`;
}

export type Geometry = {
  segmentHitsRect: typeof segmentHitsRect; polylineHitsRect: typeof polylineHitsRect; overlapArea: typeof overlapArea;
  coverage: typeof coverage; strokeFootprint: typeof strokeFootprint; contrastRatio: typeof contrastRatio;
  composite: typeof composite; saturate: typeof saturate; repeatsEndpoints: typeof repeatsEndpoints; engineEllipses: typeof engineEllipses;
};
