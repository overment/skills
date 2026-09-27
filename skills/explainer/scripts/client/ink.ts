// Dimmed-label ink: the colour math behind the client's choice of text colour on dimmed fills. Pure.

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

/** Dimmed labels keep this much contrast on whatever is behind them (3:1 plus a margin for rounding). */
export const DIM_MIN = 3.3;

/** `fg` with its alpha laid over an opaque `bg`. */
export function composite(fg: Rgba, bg: Rgb): Rgb {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)) as Rgb;
}

/** CSS `filter: saturate(s)` on one colour (the feColorMatrix saturate matrix). */
export function saturate([r, g, b]: Rgb, s: number): Rgb {
  const m = [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
  return m.map((row) => Math.min(255, Math.max(0, row[0] * r + row[1] * g + row[2] * b))) as Rgb;
}

function luminance(c: Rgb): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The first ink, in the order given (quietest first), that keeps `min` contrast once laid over `bg`
 * with its own alpha; the strongest one when none does. Returns its index.
 */
export function pickInk(bg: Rgb, inks: Rgba[], min = DIM_MIN): number {
  let best = 0, bestRatio = -1;
  for (let i = 0; i < inks.length; i++) {
    const ratio = contrast(composite(inks[i], bg), bg);
    if (ratio >= min) return i;
    if (ratio > bestRatio) { best = i; bestRatio = ratio; }
  }
  return best;
}
