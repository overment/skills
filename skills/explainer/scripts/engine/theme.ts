import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ColorTokens, FontFace, FontRole, Mode, Theme, ToneToken } from "./types";

const SKILL_ROOT = resolve(import.meta.dir, "../..");
const FONT_DIR = join(SKILL_ROOT, "assets", "fonts");
const MAX_EXTENDS = 5;

const COLOR_KEYS: (keyof ColorTokens)[] = [
  "bg", "surface", "surface-2", "line", "line-strong", "text", "text-dim", "text-faint",
  "accent", "ok", "warn", "danger", "info", "link",
];
const TONES = ["ok", "warn", "danger"] as const;
const TONE_KEYS: ToneToken[] = TONES.flatMap((t) => [`${t}-ink`, `${t}-tint`] as ToneToken[]);
/** Tint = tone at this share over surface, the WAS/NOW wash. */
const TINT_MIX = 0.12;
const INK_CONTRAST = 4.5;
/** Selection tiers: dimmed opacities and desaturation, the ink ring's width and gap. Per mode; a theme may override any. */
export type StateKey = "dim-fill" | "dim-stroke" | "dim-sat" | "dim-focal" | "sel-ring" | "sel-gap";
const STATE_DEFAULTS: Record<Mode, Record<StateKey, number>> = {
  light: { "dim-fill": 0.28, "dim-stroke": 0.35, "dim-sat": 0.3, "dim-focal": 0.45, "sel-ring": 2, "sel-gap": 3 },
  dark: { "dim-fill": 0.4, "dim-stroke": 0.5, "dim-sat": 0.35, "dim-focal": 0.45, "sel-ring": 2, "sel-gap": 3 },
};
const STATE_KEYS = Object.keys(STATE_DEFAULTS.light) as StateKey[];
/** Dimmed text keeps this much contrast on bg and surface, and DIM_TEXT_RAISED on surface-2, so the tints HTML items sit on stay above 3:1. */
const DIM_TEXT_CONTRAST = 3.6;
const DIM_TEXT_RAISED = 3.5;
/** The smallest size any text may render at, diagram labels included: figures are drawn 1:1, so this is also the authored minimum. */
export const MIN_TEXT = 13;
const TYPE_KEYS: (keyof Theme["type"])[] = [
  "caption", "ui", "body", "h2", "h1", "nodeLabel", "nodeSub", "edgeLabel", "tag",
];

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)$/i;
// Theme strings end up inside an inline <style>; keep them from closing rules or the element.
const CSS_UNSAFE = /[;{}<>]/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------- loading ----------

export async function loadTheme(nameOrPath = "default", docDir?: string): Promise<Theme> {
  const file = await locate(nameOrPath, docDir ?? process.cwd(), docDir, []);
  return validate(await readChain(file, docDir, [file]), file);
}

async function readChain(file: string, docDir: string | undefined, chain: string[]): Promise<Obj> {
  const { extends: parent, ...own } = await readJson(file);
  if (parent === undefined) return own;
  if (typeof parent !== "string") {
    throw new Error(`${file}: "extends" must be a theme name or a path to a .json file`);
  }
  if (chain.length > MAX_EXTENDS) {
    throw new Error(`${chain[0]}: "extends" is nested deeper than ${MAX_EXTENDS} levels`);
  }
  const parentFile = await locate(parent, dirname(file), docDir, chain);
  const merged = deepMerge(await readChain(parentFile, docDir, [...chain, parentFile]), own);
  dropStaleTones(merged, own);
  // A theme is named by its own file, never by the theme it extends.
  if (own.name === undefined) delete merged.name;
  return merged;
}

/** `seen` holds files already in the extends chain: a path hit is a cycle, a name hit falls through to the next location. */
async function locate(ref: string, baseDir: string, docDir: string | undefined, seen: string[]): Promise<string> {
  if (ref.endsWith(".json")) {
    const file = resolve(baseDir, ref.startsWith("~/") ? join(homedir(), ref.slice(2)) : ref);
    if (seen.includes(file)) throw new Error(`Theme "extends" cycle: ${[...seen, file].join(" -> ")}`);
    if (!(await Bun.file(file).exists())) throw new Error(`Theme file not found: ${file}`);
    return file;
  }
  if (!/^[\w-]+$/.test(ref)) {
    throw new Error(`Theme "${ref}" is neither a name (letters, digits, "-", "_") nor a path ending in .json`);
  }
  const candidates = [
    ...(docDir ? [join(docDir, ".explainer", "themes", `${ref}.json`)] : []),
    join(homedir(), ".explainer", "themes", `${ref}.json`),
    join(SKILL_ROOT, "themes", `${ref}.json`),
  ];
  for (const file of candidates) {
    if (!seen.includes(file) && (await Bun.file(file).exists())) return file;
  }
  throw new Error(
    `Theme "${ref}" not found; looked in .explainer/themes/ next to the document, ~/.explainer/themes/ and the built-in themes`,
  );
}

async function readJson(file: string): Promise<Obj> {
  let data: unknown;
  try {
    data = await Bun.file(file).json();
  } catch (err) {
    throw new Error(`${file}: not valid JSON (${(err as Error).message})`);
  }
  if (!isObj(data)) throw new Error(`${file}: a theme must be a JSON object`);
  return data;
}

/**
 * Inks and tints are derived from tone, surface and text. When a child theme changes any of those
 * but not the derived token itself, the inherited value is stale: drop it so themeVars derives it again.
 */
function dropStaleTones(merged: Obj, own: Obj): void {
  const pick = (o: Obj, mode: string): Obj | undefined => {
    const colors = o.colors;
    const v = isObj(colors) ? colors[mode] : undefined;
    return isObj(v) ? v : undefined;
  };
  for (const mode of ["light", "dark"] as const) {
    const mine = pick(own, mode) ?? {};
    const out = pick(merged, mode);
    if (!out) continue;
    const base = ["surface", "text"].some((k) => k in mine);
    for (const tone of TONES) {
      if (!base && !(tone in mine)) continue;
      for (const key of [`${tone}-ink`, `${tone}-tint`]) if (!(key in mine)) delete out[key];
    }
  }
}

/** Objects merge key by key; arrays and scalars from `over` replace. */
function deepMerge(base: Obj, over: Obj): Obj {
  const out: Obj = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (key === "__proto__") continue;
    const prev = out[key];
    out[key] = isObj(value) && isObj(prev) ? deepMerge(prev, value) : value;
  }
  return out;
}

function validate(raw: Obj, file: string): Theme {
  const errors: string[] = [];
  const get = (path: string) => path.split(".").reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), raw);
  const number = (path: string) => {
    const v = get(path);
    if (v === undefined) errors.push(`missing ${path}`);
    else if (typeof v !== "number" || !Number.isFinite(v) || v < 0) errors.push(`${path} must be a non-negative number`);
  };
  const pair = (path: string) => {
    const v = get(path);
    if (v === undefined) errors.push(`missing ${path}`);
    else if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      errors.push(`${path} must be [number, number]`);
    }
  };

  for (const mode of ["light", "dark"] as const) {
    for (const key of COLOR_KEYS) {
      const path = `colors.${mode}.${key}`;
      const v = get(path);
      if (v === undefined) errors.push(`missing ${path}`);
      else if (typeof v !== "string" || !isCssColor(v)) {
        errors.push(`${path} must be a CSS color (#hex or a color function), got ${JSON.stringify(v)}`);
      }
    }
    for (const key of TONE_KEYS) {
      const v = get(`colors.${mode}.${key}`);
      if (v !== undefined && (typeof v !== "string" || !isCssColor(v))) {
        errors.push(`colors.${mode}.${key} must be a CSS color (#hex or a color function), got ${JSON.stringify(v)}`);
      }
    }
    const series = get(`series.${mode}`);
    if (!Array.isArray(series) || series.length < 4 || !series.every((c) => typeof c === "string" && isCssColor(c))) {
      errors.push(`series.${mode} must list at least 4 CSS colors`);
    }
  }

  for (const role of ["sans", "mono", "heading"] as const) {
    const font = get(`fonts.${role}`);
    if (role === "heading" && font === undefined) continue;
    if (!isObj(font)) {
      errors.push(`missing fonts.${role}`);
      continue;
    }
    if (typeof font.family !== "string" || !font.family.trim() || CSS_UNSAFE.test(font.family)) {
      errors.push(`fonts.${role}.family must be a font family name`);
    }
    if (typeof font.fallback !== "string" || CSS_UNSAFE.test(font.fallback)) {
      errors.push(`fonts.${role}.fallback must be a CSS font stack`);
    }
    font.faces ??= [];
    if (!Array.isArray(font.faces)) {
      errors.push(`fonts.${role}.faces must be a list`);
      continue;
    }
    font.faces.forEach((face: unknown, i: number) => {
      const path = `fonts.${role}.faces[${i}]`;
      if (!isObj(face) || typeof face.file !== "string" || !face.file.endsWith(".woff2")) {
        errors.push(`${path}.file must be a .woff2 file name`);
        return;
      }
      for (const key of ["unicodeRange", "weight", "style"]) {
        const v = face[key];
        if (v !== undefined && (typeof v !== "string" || CSS_UNSAFE.test(v))) {
          errors.push(`${path}.${key} must be a CSS value string`);
        }
      }
    });
  }

  for (const mode of ["light", "dark"] as const) {
    const states = get(`states.${mode}`);
    if (states === undefined) continue;
    if (!isObj(states)) {
      errors.push(`states.${mode} must be a map of ${STATE_KEYS.join(", ")}`);
      continue;
    }
    for (const [key, v] of Object.entries(states)) {
      const max = key.startsWith("sel-") ? 8 : 1;
      if (!STATE_KEYS.includes(key as StateKey)) errors.push(`states.${mode}.${key} is unknown; use ${STATE_KEYS.join(", ")}`);
      else if (typeof v !== "number" || !(v >= 0 && v <= max)) errors.push(`states.${mode}.${key} must be a number from 0 to ${max}`);
    }
  }

  for (const key of TYPE_KEYS) {
    number(`type.${key}`);
    const v = get(`type.${key}`);
    if (typeof v === "number" && v >= 0 && v < MIN_TEXT) errors.push(`type.${key} is ${v}px; no text renders below ${MIN_TEXT}px`);
  }
  for (const path of ["radius", "grid.unit", "grid.pad"]) number(path);
  for (const path of ["grid.cell", "grid.gap"]) pair(path);

  if (errors.length) throw new Error(`Invalid theme ${file}:\n  - ${errors.join("\n  - ")}`);
  return {
    ...(raw as unknown as Theme),
    name: typeof raw.name === "string" ? raw.name : basename(file, ".json"),
    dir: dirname(file),
  };
}

function isCssColor(value: string): boolean {
  const v = value.trim();
  return HEX.test(v) || COLOR_FN.test(v);
}

// ---------- CSS ----------

export function themeVars(theme: Theme, mode: Mode): Record<string, string> {
  const tones = toneTokens(theme.colors[mode]);
  return Object.fromEntries([
    ...COLOR_KEYS.map((key) => [`--x-${key}`, theme.colors[mode][key]]),
    ...TONE_KEYS.map((key) => [`--x-${key}`, tones[key]]),
    ...theme.series[mode].map((color, i) => [`--x-series-${i + 1}`, color]),
  ]);
}

/**
 * State-tier tokens for one mode: --x-dim-fill/-stroke/-sat/-focal, --x-sel-ring/-gap (px), and --x-dim-text,
 * text-faint moved toward text until dimmed text keeps 3.6:1 on bg and surface and 3.5:1 on surface-2.
 */
export function stateVars(theme: Theme, mode: Mode): Record<string, string> {
  const own = (theme as Theme & { states?: Partial<Record<Mode, Partial<Record<StateKey, number>>>> }).states?.[mode] ?? {};
  const values = { ...STATE_DEFAULTS[mode], ...own };
  const c = theme.colors[mode];
  let dimText = c["text-faint"];
  try {
    for (let step = 0; step <= 20; step++) {
      const t = step ? mix(c.text, c["text-faint"], step / 20) : c["text-faint"];
      dimText = t;
      if (contrast(t, c.bg) >= DIM_TEXT_CONTRAST && contrast(t, c.surface) >= DIM_TEXT_CONTRAST && contrast(t, c["surface-2"]) >= DIM_TEXT_RAISED) break;
    }
  } catch {
    dimText = c["text-dim"];
  }
  return {
    ...Object.fromEntries(STATE_KEYS.map((k) => [`--x-${k}`, k.startsWith("sel-") ? `${values[k]}px` : String(values[k])])),
    "--x-dim-text": dimText,
  };
}

export async function themeCss(theme: Theme, { embedFonts = true }: { embedFonts?: boolean } = {}): Promise<string> {
  const out: string[] = [];
  if (embedFonts) {
    for (const role of [theme.fonts.sans, theme.fonts.mono, ...(theme.fonts.heading ? [theme.fonts.heading] : [])]) {
      for (const face of role.faces) out.push(await fontFace(role, face, theme.dir));
    }
  }
  const dark = { ...themeVars(theme, "dark"), ...stateVars(theme, "dark"), "color-scheme": "dark" };
  out.push(rule(":root", { ...themeVars(theme, "light"), ...stateVars(theme, "light"), ...layoutVars(theme), "color-scheme": "light" }));
  out.push(rule('[data-theme="dark"]', dark));
  out.push(`@media (prefers-color-scheme: dark) {\n${rule(":root:not([data-theme])", dark, "  ")}\n}`);
  // Same specificity as the dark rules above and later in source, so print always gets light tokens.
  out.push(
    `@media print {\n${rule(":root:is([data-theme], :not([data-theme]))", { ...themeVars(theme, "light"), ...stateVars(theme, "light"), "color-scheme": "light" }, "  ")}\n}`,
  );
  return out.join("\n") + "\n";
}

function layoutVars(theme: Theme): Record<string, string> {
  const px = (n: number) => `${n}px`;
  const { type, grid } = theme;
  return {
    "--x-font-sans": fontStack(theme.fonts.sans),
    "--x-font-mono": fontStack(theme.fonts.mono),
    // a display face for the page title; without one the title stays sans 600
    "--x-font-heading": theme.fonts.heading ? fontStack(theme.fonts.heading) : "var(--x-font-sans)",
    "--x-fw-heading": theme.fonts.heading ? "400" : "600",
    "--x-radius": px(theme.radius),
    "--x-fs-caption": px(type.caption),
    "--x-fs-ui": px(type.ui),
    "--x-fs-body": px(type.body),
    "--x-fs-h2": px(type.h2),
    "--x-fs-h1": px(type.h1),
    "--x-fs-node": px(type.nodeLabel),
    "--x-fs-node-sub": px(type.nodeSub),
    "--x-fs-edge": px(type.edgeLabel),
    "--x-fs-tag": px(type.tag),
    "--x-unit": px(grid.unit),
    "--x-cell-w": px(grid.cell[0]),
    "--x-cell-h": px(grid.cell[1]),
    "--x-gap-x": px(grid.gap[0]),
    "--x-gap-y": px(grid.gap[1]),
    "--x-pad": px(grid.pad),
  };
}

async function fontFace(role: FontRole, face: FontFace, themeDir?: string): Promise<string> {
  const data = await fontData(face.file, role.family, themeDir);
  const decls: Record<string, string> = {
    "font-family": quote(role.family),
    src: `url(data:font/woff2;base64,${data}) format('woff2')`,
    "font-weight": face.weight ?? "400",
    "font-style": face.style ?? "normal",
    "font-display": "block",
  };
  if (face.unicodeRange) decls["unicode-range"] = face.unicodeRange;
  return rule("@font-face", decls);
}

async function fontData(file: string, family: string, themeDir?: string): Promise<string> {
  for (const dir of themeDir ? [themeDir, FONT_DIR] : [FONT_DIR]) {
    const font = Bun.file(resolve(dir, file));
    if (await font.exists()) return Buffer.from(await font.arrayBuffer()).toString("base64");
  }
  throw new Error(`Font file "${file}" for ${family} not found in the theme folder or assets/fonts/`);
}

function fontStack(role: FontRole): string {
  return [quote(role.family), role.fallback.trim()].filter(Boolean).join(", ");
}

function quote(family: string): string {
  return `"${family.replace(/["\\]/g, "\\$&")}"`;
}

function rule(selector: string, decls: Record<string, string>, indent = ""): string {
  const body = Object.entries(decls).map(([k, v]) => `${indent}  ${k}: ${v};`).join("\n");
  return `${indent}${selector} {\n${body}\n${indent}}`;
}

// ---------- tones ----------

/**
 * Ink and tint per tone. A missing tint is the tone 12% over surface; every ink starts from the theme's
 * value (or the tone) and moves toward `text` until it reaches 4.5:1 on its tint.
 * Colors contrast() can't read (oklch…) fall back to CSS color-mix and the unchecked tone.
 */
export function toneTokens(colors: ColorTokens): Record<ToneToken, string> {
  const out = {} as Record<ToneToken, string>;
  for (const tone of TONES) {
    const ink = colors[`${tone}-ink`] ?? colors[tone];
    let tint = colors[`${tone}-tint`];
    try {
      tint ??= mix(colors[tone], colors.surface, TINT_MIX);
      out[`${tone}-tint`] = tint;
      out[`${tone}-ink`] = readableOn(ink, tint, colors.text);
    } catch {
      out[`${tone}-tint`] = tint ?? `color-mix(in srgb, ${colors[tone]} ${TINT_MIX * 100}%, ${colors.surface})`;
      out[`${tone}-ink`] = ink;
    }
  }
  return out;
}

/** `fg` if it reaches 4.5:1 on `bg`, else the first 5% step from `fg` toward `toward` that does. */
function readableOn(fg: string, bg: string, toward: string): string {
  for (let step = 0; step <= 20; step++) {
    const c = step ? mix(toward, fg, step / 20) : fg;
    if (contrast(c, bg) >= INK_CONTRAST) return c;
  }
  return toward;
}

/** sRGB mix, `share` of `a` over `b`, as #RRGGBB (what color-mix(in srgb) gives). */
function mix(a: string, b: string, share: number): string {
  const ca = channels(a), cb = channels(b);
  return `#${ca.map((c, i) => Math.round(c * share + cb[i] * (1 - share)).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// ---------- contrast ----------

/** WCAG 2 contrast ratio between two colors (#rgb, #rrggbb, rgb()). Alpha is ignored. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminance(color: string): number {
  const [r, g, b] = channels(color).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function channels(color: string): number[] {
  const s = color.trim();
  if (HEX.test(s)) {
    let hex = s.slice(1);
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  const match = /^rgba?\(([^()]*)\)$/i.exec(s);
  const values = (match?.[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3) ?? []).map((p) =>
    p.endsWith("%") ? parseFloat(p) * 2.55 : parseFloat(p),
  );
  if (values.length === 3 && values.every(Number.isFinite)) return values.map((v) => Math.min(255, Math.max(0, v)));
  throw new Error(`contrast: unsupported color "${color}"; use #rgb, #rrggbb or rgb()`);
}
