import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { contrast, loadTheme, stateVars, themeCss, themeVars, toneTokens } from "../engine/theme";
import type { Mode } from "../engine/types";

const SKILL = resolve(import.meta.dir, "../..");
const DEFAULT_FILE = join(SKILL, "themes", "default.json");
const BASE_CSS = join(SKILL, "scripts", "styles", "base.css");

let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "explainer-theme-"));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function write(name: string, data: unknown): Promise<string> {
  const file = join(tmp, name);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return file;
}

describe("loadTheme", () => {
  test("loads the built-in default theme", async () => {
    const theme = await loadTheme(DEFAULT_FILE);
    expect(theme.name).toBe("default");
    expect(theme.dir).toBe(join(SKILL, "themes"));
    expect(theme.grid).toEqual({ unit: 8, cell: [160, 64], gap: [104, 48], pad: 32 });
    expect(theme.radius).toBe(6);
    expect(theme.fonts.sans.family).toBe("Geist");
    expect(theme.fonts.mono.family).toBe("Geist Mono");
    expect(theme.fonts.mono.faces).toHaveLength(2);
  });

  test("extends deep-merges objects and replaces scalars", async () => {
    const base = await loadTheme(DEFAULT_FILE);
    const file = await write("warm.json", {
      name: "warm",
      extends: DEFAULT_FILE,
      radius: 3,
      colors: { light: { accent: "#aa3300" } },
    });
    const theme = await loadTheme(file);
    expect(theme.name).toBe("warm");
    expect(theme.radius).toBe(3);
    expect(theme.colors.light.accent).toBe("#aa3300");
    expect(theme.colors.light.text).toBe(base.colors.light.text);
    expect(theme.colors.dark).toEqual(base.colors.dark);
    expect(theme.grid).toEqual(base.grid);
    expect(theme.dir).toBe(tmp);
    expect("extends" in theme).toBe(false);
  });

  test("resolves .json paths against the document folder", async () => {
    const theme = await loadTheme("warm.json", tmp);
    expect(theme.radius).toBe(3);
  });

  test("finds named themes in <docDir>/.explainer/themes", async () => {
    await write(".explainer/themes/house.json", { extends: "default", radius: 4 });
    const theme = await loadTheme("house", tmp);
    expect(theme.name).toBe("house");
    expect(theme.radius).toBe(4);
    expect(theme.dir).toBe(join(tmp, ".explainer", "themes"));
  });

  test("a named theme can extend the theme it shadows", async () => {
    const docDir = join(tmp, "shadow");
    await write("shadow/.explainer/themes/default.json", { extends: "default", radius: 2 });
    const theme = await loadTheme("default", docDir);
    expect(theme.radius).toBe(2);
    expect(theme.dir).toBe(join(docDir, ".explainer", "themes"));
  });

  test("errors name the key and the file", async () => {
    const bad = await write("broken.json", { extends: DEFAULT_FILE, colors: { dark: { accent: "banana" } } });
    await expect(loadTheme(bad)).rejects.toThrow(/colors\.dark\.accent/);

    const bare = await write("bare.json", { name: "bare" });
    const err = (await loadTheme(bare).catch((e) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("bare.json");
    expect(err.message).toContain("missing colors.light.bg");
    expect(err.message).toContain("missing fonts.sans");
    expect(err.message).toContain("missing grid.cell");
  });

  test("rejects unknown names, cycles and deep chains", async () => {
    await expect(loadTheme("no-such-theme", tmp)).rejects.toThrow(/not found/);

    await write("a.json", { extends: "./b.json" });
    await write("b.json", { extends: "./a.json" });
    await expect(loadTheme("a.json", tmp)).rejects.toThrow(/cycle/);

    for (let i = 0; i < 7; i++) {
      await write(`deep${i}.json`, { extends: i < 6 ? `./deep${i + 1}.json` : DEFAULT_FILE, radius: i });
    }
    await expect(loadTheme("deep0.json", tmp)).rejects.toThrow(/deeper than 5/);
    expect((await loadTheme("deep2.json", tmp)).radius).toBe(2);
  });
});

describe("contrast", () => {
  test("computes WCAG ratios", () => {
    expect(contrast("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "rgb(255, 255, 255)")).toBeCloseTo(1, 5);
    expect(contrast("rgb(0 0 0)", "#777777")).toBeCloseTo(4.69, 1);
    expect(() => contrast("banana", "#fff")).toThrow();
  });

  for (const mode of ["light", "dark"] as Mode[]) {
    test(`default ${mode}: text and text-dim reach 4.5:1 on bg and surface`, async () => {
      const colors = (await loadTheme(DEFAULT_FILE)).colors[mode];
      for (const fg of ["text", "text-dim"] as const) {
        for (const bg of ["bg", "surface"] as const) {
          expect({ pair: `${fg} on ${bg}`, ok: contrast(colors[fg], colors[bg]) >= 4.5 }).toEqual({ pair: `${fg} on ${bg}`, ok: true });
        }
      }
    });
  }
});

describe("tone tokens", () => {
  const TONES = ["ok", "warn", "danger"] as const;

  for (const mode of ["light", "dark"] as Mode[]) {
    test(`default ${mode}: every tone ink reaches 4.5:1 on its tint, and default.json matches the derivation`, async () => {
      const colors = (await loadTheme(DEFAULT_FILE)).colors[mode];
      const tones = toneTokens(colors);
      for (const t of TONES) {
        expect({ tone: t, ok: contrast(tones[`${t}-ink`], tones[`${t}-tint`]) >= 4.5 }).toEqual({ tone: t, ok: true });
        expect(colors[`${t}-ink`]).toBe(tones[`${t}-ink`]);
      }
      const bare = Object.fromEntries(Object.entries(colors).filter(([k]) => !/-(ink|tint)$/.test(k))) as typeof colors;
      expect(toneTokens(bare)).toEqual(tones);
    });
  }

  test("derives a tint and darkens a weak ink until it reads", async () => {
    const colors = { ...(await loadTheme(DEFAULT_FILE)).colors.light };
    for (const t of TONES) { delete colors[`${t}-ink`]; delete colors[`${t}-tint`]; }
    const tones = toneTokens({ ...colors, ok: "#88CC99" });
    expect(tones["ok-tint"]).toMatch(/^#[0-9A-F]{6}$/);
    expect(tones["ok-ink"]).not.toBe("#88CC99");
    expect(contrast(tones["ok-ink"], tones["ok-tint"])).toBeGreaterThanOrEqual(4.5);
  });

  test("falls back to color-mix for colors contrast() can't read", async () => {
    const colors = { ...(await loadTheme(DEFAULT_FILE)).colors.light, warn: "oklch(0.6 0.1 70)" };
    delete colors["warn-ink"];
    delete colors["warn-tint"];
    const tones = toneTokens(colors);
    expect(tones["warn-tint"]).toBe(`color-mix(in srgb, oklch(0.6 0.1 70) 12%, ${colors.surface})`);
    expect(tones["warn-ink"]).toBe("oklch(0.6 0.1 70)");
  });

  test("extends drops inherited inks and tints whose inputs the child changed", async () => {
    const file = await write("tone-child.json", {
      extends: DEFAULT_FILE,
      colors: { light: { ok: "#2F6F3E" }, dark: { surface: "#101010", "warn-ink": "#E0B070" } },
    });
    const theme = await loadTheme(file);
    expect(theme.colors.light["ok-ink"]).toBeUndefined();
    expect(theme.colors.light["warn-ink"]).toBe("#946112");
    expect(theme.colors.dark["ok-tint"]).toBeUndefined();
    expect(theme.colors.dark["warn-ink"]).toBe("#E0B070");
    const vars = themeVars(theme, "light");
    expect(contrast(vars["--x-ok-ink"]!, vars["--x-ok-tint"]!)).toBeGreaterThanOrEqual(4.5);
  });

  test("rejects a tone token that isn't a color", async () => {
    const file = await write("tone-bad.json", { extends: DEFAULT_FILE, colors: { dark: { "ok-tint": "green;" } } });
    await expect(loadTheme(file)).rejects.toThrow(/colors\.dark\.ok-tint must be a CSS color/);
  });
});

describe("themeCss", () => {
  test("emits both modes, the OS fallback and embedded fonts", async () => {
    const css = await themeCss(await loadTheme(DEFAULT_FILE));
    expect(css).toContain(":root");
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain("prefers-color-scheme");
    expect(css).toContain("@font-face");
    expect(css).toContain("data:font/woff2;base64,");
    expect(css.match(/@font-face/g)).toHaveLength(4);
    expect(css).toContain('--x-font-sans: "Geist", ui-sans-serif');
    expect(css).toContain("--x-radius: 6px;");
    expect(css).toContain("--x-fs-node-sub: 13px;");
    expect(css).toContain("--x-cell-w: 160px;");
  });

  test("skips @font-face when embedFonts is false", async () => {
    const css = await themeCss(await loadTheme(DEFAULT_FILE), { embedFonts: false });
    expect(css).not.toContain("@font-face");
    expect(css).toContain("--x-accent:");
  });

  test("throws for a missing font file", async () => {
    const file = await write("nofont.json", {
      extends: DEFAULT_FILE,
      fonts: { sans: { faces: [{ file: "missing.woff2", weight: "400" }] } },
    });
    await expect(themeCss(await loadTheme(file))).rejects.toThrow(/missing\.woff2/);
  });

  test("themeVars maps every color token", async () => {
    const theme = await loadTheme(DEFAULT_FILE);
    const vars = themeVars(theme, "dark");
    expect(Object.keys(vars)).toHaveLength(14 + 6 + theme.series.dark.length);
    expect(vars["--x-bg"]).toBe(theme.colors.dark.bg);
    expect(vars["--x-surface-2"]).toBe(theme.colors.dark["surface-2"]);
    expect(vars["--x-warn-ink"]).toBe(theme.colors.dark["warn-ink"]!);
    expect(vars["--x-danger-tint"]).toBe(theme.colors.dark["danger-tint"]!);
  });
});

describe("state tokens", () => {
  for (const mode of ["light", "dark"] as Mode[]) {
    test(`default ${mode}: dimmed text keeps 3:1 on bg and surface`, async () => {
      const theme = await loadTheme(DEFAULT_FILE);
      const vars = stateVars(theme, mode);
      const c = theme.colors[mode];
      expect(contrast(vars["--x-dim-text"]!, c.bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(vars["--x-dim-text"]!, c.surface)).toBeGreaterThanOrEqual(3);
    });
  }

  test("dark dims less than light, so context stays legible on a dark canvas", async () => {
    const theme = await loadTheme(DEFAULT_FILE);
    const light = stateVars(theme, "light"), dark = stateVars(theme, "dark");
    expect(Number(dark["--x-dim-fill"])).toBeGreaterThan(Number(light["--x-dim-fill"]));
    expect(light["--x-sel-ring"]).toBe("2px");
    expect(light["--x-sel-gap"]).toBe("3px");
  });

  test("a theme may override a state token; unknown or out-of-range ones are rejected", async () => {
    const ok = await write("states-ok.json", { extends: DEFAULT_FILE, states: { dark: { "dim-fill": 0.5 } } });
    expect(stateVars(await loadTheme(ok), "dark")["--x-dim-fill"]).toBe("0.5");
    const bad = await write("states-bad.json", { extends: DEFAULT_FILE, states: { light: { "dim-fill": 2, glow: 1 } } });
    await expect(loadTheme(bad)).rejects.toThrow(/states\.light\.dim-fill must be a number from 0 to 1[\s\S]*states\.light\.glow is unknown/);
  });

  test("themeCss writes them into both modes", async () => {
    const css = await themeCss(await loadTheme(DEFAULT_FILE), { embedFonts: false });
    expect(css.match(/--x-dim-fill:/g)).toHaveLength(4);
    expect(css).toContain("--x-dim-text:");
  });
});

describe("base.css", () => {
  test("selection is ink, never accent; the focal-dim rule outranks the dimming rules", async () => {
    const css = await Bun.file(BASE_CSS).text();
    // Prose refs are links, and links are accent; every mark, node and card selection is ink.
    for (const rule of css.match(/[^{}]*\.is-selected[^{}]*\{[^}]*\}/g) ?? []) if (!/\.x-ref\b/.test(rule)) expect(rule).not.toContain("--x-accent");
    expect(css).toContain(":root:root .x-svg .is-dimmed[data-focal=\"true\"]");
    expect(css).not.toMatch(/\[data-theme="dark"\][^{]*is-dimmed/);
    expect(css).toMatch(/\.x-matrix \.x-mark \{ display: inline-block/);
    expect(css).not.toMatch(/(^|\n)\.x-mark \{ display: inline-block/);
  });

  test("has no color literals, shadows or one-sided borders", async () => {
    const css = await Bun.file(BASE_CSS).text();
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).not.toContain("box-shadow");
    expect(css).not.toMatch(/border-(?:left|right|top|bottom)(?:-(?:width|style|color))?\s*:/);
  });

  test("every radius is the theme radius (or a true circle)", async () => {
    const css = await Bun.file(BASE_CSS).text();
    const values = [...css.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((v) => !/var\(--x-radius\)/.test(v) && v !== "50%")).toEqual([]);
  });

  test("only uses variables the theme or the file itself defines", async () => {
    const css = await Bun.file(BASE_CSS).text();
    const vars = await themeCss(await loadTheme(DEFAULT_FILE), { embedFonts: false });
    const defined = new Set([...vars.matchAll(/(--x-[\w-]+)\s*:/g), ...css.matchAll(/(--x-[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = [...css.matchAll(/var\((--x-[\w-]+)/g)].map((m) => m[1]);
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });
});
