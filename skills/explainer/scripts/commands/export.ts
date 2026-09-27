/// <reference lib="dom" />
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { CommandRun } from "../engine/types.ts";
import { withBrowser } from "../lib/cdp.ts";
import { usage } from "../lib/commands.ts";
import { captureHash, display, openInput, openState, STATE_KEYS, type PageFile } from "./shot.ts";

const USAGE = usage("export");

export const run: CommandRun = async (argv) => {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { figure: { type: "string" }, mode: { type: "string" }, state: { type: "string" }, out: { type: "string", short: "o" } },
    });
  } catch (err) {
    console.error(`export: ${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = args;
  const input = positionals[0];
  const { hash: stateHash, unknown } = captureHash(values.state ?? "");
  const params = new URLSearchParams(stateHash);
  const mode = values.mode ?? params.get("theme") ?? "light";
  if (!input || positionals.length > 1 || (mode !== "light" && mode !== "dark")) {
    console.error(USAGE);
    return 2;
  }
  for (const key of unknown) console.error(`export: warning: "${key}" is not a state key; known keys: ${STATE_KEYS.join(", ")}`);
  params.set("theme", mode);
  const baked = !!values.state?.trim();
  let file: PageFile | undefined;
  try {
    file = await openInput(input);
    const url = file.url(params.toString());
    const result = await withBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900, scale: 1 });
      await openState(page, url);
      await page.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(mode)}`, 3000);
      return page.call(standaloneSvg, values.figure ?? null, baked);
    });
    if ("error" in result) throw new Error(result.error);
    const base = basename(input, extname(input));
    const sel = params.get("sel");
    const suffix = sel ? `-${sel.replace(/[^\w-]+/g, "-")}` : "";
    const out = resolve(values.out ?? join(dirname(resolve(input)), `${base}-${result.id}${suffix}${mode === "dark" ? "-dark" : ""}.svg`));
    const bytes = await Bun.write(out, `<?xml version="1.0" encoding="UTF-8"?>\n${result.svg}\n`);
    console.log(`wrote ${display(out)} · ${bytes} bytes${result.card ? " · with card" : ""}`);
    return 0;
  } catch (err) {
    console.error(`export: ${(err as Error).message}`);
    return 1;
  } finally {
    await file?.cleanup();
  }
};

/**
 * Runs in the page: clone the figure's SVG with computed styles as presentation attributes.
 * With `baked`, the state's look stays (dimming, related strokes, the .x-sel-layer rings), the
 * `is-*` classes are kept as metadata, and the open card is drawn into the SVG as a <g> of
 * rects and text, with the viewBox grown to fit it.
 */
function standaloneSvg(figureId: string | null, baked: boolean): { error: string } | { id: string; svg: string; card: boolean } {
  const NS = "http://www.w3.org/2000/svg";
  const SHAPES = ["rect", "path", "line", "circle", "ellipse", "polyline", "polygon", "text", "tspan"];
  const TEXT = ["text", "tspan"];
  const PAINT = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "fill-opacity", "stroke-opacity"];
  const FONT = ["font-family", "font-size", "font-weight", "letter-spacing", "text-anchor", "dominant-baseline"];
  const DEFAULTS: Record<string, string[]> = {
    opacity: ["1"], visibility: ["visible"], "fill-opacity": ["1"], "stroke-opacity": ["1"],
    "stroke-dasharray": ["none"], "stroke-linecap": ["butt"], "stroke-linejoin": ["miter"],
    "letter-spacing": ["normal", "0px"], "text-anchor": ["start"], "dominant-baseline": ["auto"],
    filter: ["none"], display: ["inline", "block"],
  };
  const shown = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";

  const figures = [...document.querySelectorAll<HTMLElement>("[data-figure]")];
  const figure = figureId === null ? figures[0] : figures.find((f) => f.dataset.figure === figureId);
  if (!figure)
    return { error: figures.length ? `No figure "${figureId}"; figures: ${figures.map((f) => f.dataset.figure).join(", ")}.` : "The page has no figures." };
  const svg = figure.querySelector<SVGSVGElement>("svg.x-svg") ?? figure.querySelector("svg");
  if (!svg) return { error: `Figure "${figure.dataset.figure}" has no <svg>.` };

  // Markers painted with context-stroke/fill take the stroke of the first line that uses them.
  const markerPaint = new Map<string, string>();
  for (const el of svg.querySelectorAll("[marker-end], [marker-start]")) {
    const id = /#([^)"']+)/.exec(el.getAttribute("marker-end") ?? el.getAttribute("marker-start") ?? "")?.[1];
    if (id && !markerPaint.has(id)) markerPaint.set(id, getComputedStyle(el).stroke);
  }

  const inline = (source: SVGSVGElement): SVGSVGElement => {
    const clone = source.cloneNode(true) as SVGSVGElement;
    const originals = [source, ...source.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    const drop: Element[] = [];
    originals.forEach((el, i) => {
      const copy = copies[i]!;
      const tag = el.localName;
      const style = getComputedStyle(el);
      // Hidden parts (hover-only rules, closed on-sel geometry) are left out rather than carried as display:none.
      if (i > 0 && style.display === "none" && !el.closest("defs, marker, symbol, clipPath, mask, pattern, linearGradient, radialGradient, title, desc, style")) {
        drop.push(copy);
        return;
      }
      const marker = el.closest("marker")?.id;
      const props = ["opacity", "visibility", ...(baked ? ["filter"] : []), ...(SHAPES.includes(tag) ? PAINT : []), ...(TEXT.includes(tag) ? FONT : [])];
      for (const prop of props) {
        let value = style.getPropertyValue(prop).trim();
        if (value.startsWith("context-")) value = (marker && markerPaint.get(marker)) || "";
        if (!value || DEFAULTS[prop]?.includes(value)) continue;
        copy.setAttribute(prop, value);
      }
      // CSS text-transform doesn't survive outside the page; write the transformed text.
      if ((tag === "text" || tag === "tspan") && style.textTransform === "uppercase") {
        for (const n of copy.childNodes) if (n.nodeType === 3) n.textContent = (n.textContent ?? "").toUpperCase();
      }
      if (i === 0) return;
      const state = baked ? [...el.classList].filter((c) => c.startsWith("is-") || c === "x-sel-layer" || c === "x-sel-ring") : [];
      for (const { name } of [...copy.attributes]) {
        if (name === "class" || name === "tabindex" || name === "role" || name.startsWith("data-") || name.startsWith("aria-")) copy.removeAttribute(name);
      }
      if (state.length) copy.setAttribute("class", state.join(" "));
    });
    for (const d of drop) d.remove();
    for (const hit of clone.querySelectorAll('[class*="-hit"]')) hit.remove();
    return clone;
  };

  const clone = inline(svg);
  clone.querySelectorAll(".x-edge-hit, .x-line-hit").forEach((h) => h.remove());
  clone.removeAttribute("class");
  clone.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns", NS);
  const vb = svg.viewBox.baseVal;
  const box = vb && vb.width && vb.height ? { x: vb.x, y: vb.y, w: vb.width, h: vb.height } : { x: 0, y: 0, w: svg.clientWidth, h: svg.clientHeight };

  // ---- the card, drawn as SVG ----
  let hasCard = false;
  if (baked) {
    const stage = figure.querySelector(".x-stage") ?? figure.closest(".x-stage") ?? figure;
    const card =
      [...stage.querySelectorAll<HTMLElement>(".x-pop"), ...document.querySelectorAll<HTMLElement>(`.x-pop[data-for="${CSS.escape(figure.dataset.figure ?? "")}"]`)].find(shown) ??
      [...document.querySelectorAll<HTMLElement>(".x-detail:not([data-placement]):not([hidden])")].find(shown);
    const inv = svg.getScreenCTM()?.inverse();
    if (card && inv) {
      hasCard = true;
      const scale = Math.hypot(inv.a, inv.b) || 1;
      const toUser = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(inv);
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "x-card-baked");
      const canvas = document.createElement("canvas").getContext("2d")!;
      const skip = '[data-action], .x-detail-close, [aria-label="Close"], .x-tip';
      const boxOf = (el: Element) => {
        const r = el.getBoundingClientRect();
        const a = toUser(r.left, r.top), b = toUser(r.right, r.bottom);
        return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
      };
      const paintBox = (el: Element) => {
        const s = getComputedStyle(el);
        const bg = s.backgroundColor, border = parseFloat(s.borderTopWidth) || 0;
        const hasBg = bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg);
        const hasBorder = border > 0 && s.borderTopStyle !== "none" && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.borderTopColor);
        if (!hasBg && !hasBorder) return;
        const b = boxOf(el);
        const rect = document.createElementNS(NS, "rect");
        for (const [k, v] of Object.entries({ x: b.x, y: b.y, width: b.w, height: b.h, rx: (parseFloat(s.borderTopLeftRadius) || 0) * scale })) rect.setAttribute(k, String(+v.toFixed(2)));
        rect.setAttribute("fill", hasBg ? bg : "none");
        if (hasBorder) {
          rect.setAttribute("stroke", s.borderTopColor);
          rect.setAttribute("stroke-width", String(+(border * scale).toFixed(2)));
        }
        g.append(rect);
      };
      paintBox(card);
      for (const el of card.querySelectorAll("*")) if (!el.closest(skip) && shown(el)) paintBox(el);
      // Text: one <text> per rendered line, at the baseline the browser used.
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        const raw = n.textContent ?? "";
        if (!parent || parent.closest(skip) || !raw.trim() || !shown(parent)) continue;
        const s = getComputedStyle(parent);
        canvas.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
        const m = canvas.measureText("Hg");
        const lines: { top: number; h: number; left: number; text: string }[] = [];
        const range = document.createRange();
        const re = /\S+\s*/g;
        for (let w = re.exec(raw); w; w = re.exec(raw)) {
          range.setStart(n, w.index);
          range.setEnd(n, w.index + w[0].length);
          const r = range.getClientRects()[0];
          if (!r) continue;
          const last = lines[lines.length - 1];
          if (last && Math.abs(last.top - r.top) < 2) last.text += w[0];
          else lines.push({ top: r.top, h: r.height, left: r.left, text: w[0] });
        }
        for (const line of lines) {
          const baseline = line.top + (line.h - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
          const p = toUser(line.left, baseline);
          const t = document.createElementNS(NS, "text");
          const text = s.textTransform === "uppercase" ? line.text.toUpperCase() : line.text;
          t.textContent = text.trimEnd();
          t.setAttribute("x", String(+p.x.toFixed(2)));
          t.setAttribute("y", String(+p.y.toFixed(2)));
          t.setAttribute("fill", s.color);
          t.setAttribute("font-family", s.fontFamily);
          t.setAttribute("font-size", String(+(parseFloat(s.fontSize) * scale).toFixed(2)));
          if (s.fontWeight !== "400") t.setAttribute("font-weight", s.fontWeight);
          if (s.letterSpacing !== "normal" && s.letterSpacing !== "0px") t.setAttribute("letter-spacing", String(+(parseFloat(s.letterSpacing) * scale).toFixed(2)));
          g.append(t);
        }
      }
      // A leader overlay (any other svg in the stage) comes along as a nested svg.
      for (const extra of stage.querySelectorAll<SVGSVGElement>("svg")) {
        if (extra === svg || svg.contains(extra) || card.contains(extra) || !shown(extra)) continue;
        const b = boxOf(extra);
        const nested = inline(extra);
        nested.removeAttribute("class");
        for (const [k, v] of Object.entries({ x: b.x, y: b.y, width: b.w, height: b.h })) nested.setAttribute(k, String(+v.toFixed(2)));
        if (!nested.getAttribute("viewBox")) nested.setAttribute("viewBox", `0 0 ${extra.clientWidth} ${extra.clientHeight}`);
        clone.append(nested);
      }
      clone.append(g);
      const c = boxOf(card);
      const x0 = Math.min(box.x, c.x - 8), y0 = Math.min(box.y, c.y - 8);
      const x1 = Math.max(box.x + box.w, c.x + c.w + 8), y1 = Math.max(box.y + box.h, c.y + c.h + 8);
      Object.assign(box, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  const round = (v: number) => +v.toFixed(2);
  clone.setAttribute("viewBox", `${round(box.x)} ${round(box.y)} ${round(box.w)} ${round(box.h)}`);
  clone.setAttribute("width", String(round(box.w)));
  clone.setAttribute("height", String(round(box.h)));

  const faces: string[] = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) if (rule instanceof CSSFontFaceRule) faces.push(rule.cssText);
    } catch {}
  }

  const probe = document.createElement("i");
  probe.style.color = "var(--x-bg)";
  document.body.append(probe);
  const background = getComputedStyle(probe).color;
  probe.remove();

  const anchor = clone.querySelector(":scope > desc") ?? clone.querySelector(":scope > title");
  const place = (node: Element) => (anchor ? anchor.after(node) : clone.prepend(node));
  // The backdrop covers the viewBox itself; `100%` would start at 0,0 and miss a shifted viewBox.
  const backdrop = document.createElementNS(NS, "rect");
  for (const [k, v] of Object.entries({ x: box.x, y: box.y, width: box.w, height: box.h })) backdrop.setAttribute(k, String(round(v)));
  backdrop.setAttribute("fill", background);
  place(backdrop);
  if (faces.length) {
    const defs = document.createElementNS(NS, "defs");
    const style = document.createElementNS(NS, "style");
    style.textContent = faces.join("\n");
    defs.append(style);
    place(defs);
  }
  return { id: figure.dataset.figure ?? "figure", svg: new XMLSerializer().serializeToString(clone), card: hasCard };
}
