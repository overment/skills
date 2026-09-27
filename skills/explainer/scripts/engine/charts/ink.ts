// On-fill label ink for grid and flow charts. A label drawn on a coloured mark takes whichever of --x-text
// and --x-surface reads better on that fill, per theme mode, computed at build time from the theme's colours.
// When neither reaches 4.5:1 (mid-tone fills) it falls back to black or white. The mark carries
// data-ink="<light><dark>" (t = text, s = surface, k = black, w = white); charts-grids.css maps it for every chart.
import { contrast } from "../theme.ts";
import type { Mode, Theme } from "../types.ts";

/** Share of --x-series-1 in each data-level step of the sequential ramp (base.css mixes it with --x-surface in oklab). */
export const RAMP = [0.08, 0.2, 0.34, 0.5, 0.66, 0.82, 1] as const;

const MODES: Mode[] = ["light", "dark"];

type Rgb = [number, number, number];
export type Ink = "t" | "s" | "k" | "w";

function rgb(color: string): Rgb | null {
  const s = color.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) {
    let hex = s.slice(1);
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
  }
  const m = /^rgba?\(([^()]*)\)$/i.exec(s);
  const v = (m?.[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3) ?? []).map((p) => (p.endsWith("%") ? parseFloat(p) * 2.55 : parseFloat(p)));
  return v.length === 3 && v.every(Number.isFinite) ? (v as Rgb) : null;
}

const toLinear = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function srgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(255, Math.max(0, Math.round(fromLinear(c))))) as Rgb;
}

const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** color-mix(in oklab, a share, b) as #rrggbb, or null when a colour is not #hex or rgb(). */
export function mixOklab(a: string, b: string, share: number): string | null {
  const ca = rgb(a), cb = rgb(b);
  if (!ca || !cb) return null;
  const la = oklab(ca), lb = oklab(cb);
  return hex(srgb(la.map((v, i) => v * share + lb[i] * (1 - share)) as Rgb));
}

const AA = 4.5;

/** t/s when one of the theme's text or surface reaches AA (the better one wins), else k (black) or w (white), whichever is stronger. */
function pick(theme: Theme, mode: Mode, fill: string | null | undefined): Ink | null {
  if (!fill) return null;
  const { text, surface } = theme.colors[mode];
  try {
    const t = contrast(text, fill), s = contrast(surface, fill);
    if (Math.max(t, s) >= AA) return t >= s ? "t" : "s";
    return contrast("#000000", fill) >= contrast("#ffffff", fill) ? "k" : "w";
  } catch {
    return null;
  }
}

/** ` data-ink="tk"` for a fill given per mode, or "" when a colour can't be read (CSS then keeps its default). */
export function inkAttr(theme: Theme, fill: (mode: Mode) => string | null | undefined): string {
  const [l, d] = MODES.map((m) => pick(theme, m, fill(m)));
  return l && d ? ` data-ink="${l}${d}"` : "";
}

const slotColor = (theme: Theme, mode: Mode, slot: number) => {
  const list = theme.series[mode];
  return list[(Math.max(1, slot) - 1) % list.length];
};

/** Ink for a mark filled with palette slot `slot` (1-based). */
export const seriesInk = (theme: Theme, slot: number) => inkAttr(theme, (m) => slotColor(theme, m, slot));

/** Ink for a mark on ramp level 0–6 (--x-series-1 mixed toward --x-surface). */
export const rampInk = (theme: Theme, level: number) =>
  inkAttr(theme, (m) => mixOklab(slotColor(theme, m, 1), theme.colors[m].surface, RAMP[Math.max(0, Math.min(6, level))] ?? 1));

/** Ink for a focal (accent) mark. */
export const accentInk = (theme: Theme) => inkAttr(theme, (m) => theme.colors[m].accent);

/** Ink for a muted (--x-line-strong) mark. */
export const mutedInk = (theme: Theme) => inkAttr(theme, (m) => theme.colors[m]["line-strong"]);

/** Ink for a mark's own fill, in the precedence base.css paints it: muted, then focal, then ramp level, then series slot. */
export function markInk(theme: Theme, o: { focal?: boolean; muted?: boolean; level?: number; slot?: number }): string {
  if (o.muted) return mutedInk(theme);
  if (o.focal) return accentInk(theme);
  if (o.level !== undefined) return rampInk(theme, o.level);
  return seriesInk(theme, o.slot ?? 1);
}
