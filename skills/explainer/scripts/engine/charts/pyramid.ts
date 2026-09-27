// Pyramid: ranked levels from a narrow top to a wide base, stacked trapezoids with the label inside.
// Rank is lightness (data-level ramp, strongest at the top); an optional value sits beside each level.
import { BUDGET, SpecError, type BlockModule, type ElementInfo, type Fact, type ReadingSpec } from "../types.ts";
import {
  NOTE_R, fmt, format as readFormat, idFrom, isObj, itemInfo, list, mark, notes as noteMarkers, num, number, ratio, readingSpec, share,
  svgFigure, text, textWidth, wrap, type Format, type Frame,
} from "../kit.ts";
import { allowKeys, optBool, optString, requireMap, requireString, type Fields } from "../blocks/util.ts";
import { markInk } from "./ink.ts";

interface PyramidLevel {
  id: string;
  label: string;
  value?: number;
  about?: string;
  focal: boolean;
  muted: boolean;
}

interface PyramidBlock extends ReadingSpec {
  type: "pyramid";
  id: string;
  title?: string;
  line: number;
  format: Format;
  levels: PyramidLevel[];
}

const MAX_LEVELS = 6;
/** Left and right margin: the drawing starts at the column edge, and a selection ring (3px out, 2px wide) never clips. */
const EDGE = 8;
const ITEM_KEYS = ["id", "label", "value", "about", "focal", "muted"];

function labelOf(v: unknown, where: string, line: number): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  throw new SpecError(`${where} needs a \`label\` (text).`, line);
}

function levelOf(x: Fields, label: string, where: string, line: number): Omit<PyramidLevel, "id"> & { id?: string } {
  return {
    id: optString(x, "id", where, line),
    label,
    value: x.value === undefined || x.value === null ? undefined : number(x.value, `${where} value`, line),
    about: optString(x, "about", where, line),
    focal: optBool(x, "focal", where, line),
    muted: optBool(x, "muted", where, line),
  };
}

function readLevels(v: unknown, where: string, line: number) {
  if (v === undefined) throw new SpecError(`${where} needs \`data\`: a list of { label, about } from the top level to the base.`, line);
  if (!Array.isArray(v) && isObj(v)) {
    return Object.entries(v).map(([label, x]) => {
      const iw = `${where} level "${label}"`;
      if (isObj(x)) {
        allowKeys(x, ITEM_KEYS.filter((k) => k !== "label"), iw, line);
        return levelOf(x, label, iw, line);
      }
      if (x === null) return levelOf({}, label, iw, line);
      if (typeof x === "number") return levelOf({ value: x }, label, iw, line);
      if (typeof x === "string") return levelOf({ about: x }, label, iw, line);
      throw new SpecError(`${iw} must be a number (value), a sentence (about) or a map { value, about }.`, line);
    });
  }
  return list(v, `${where} data`, line).map((x, i) => {
    const iw = `${where} level ${i + 1}`;
    if (!isObj(x)) throw new SpecError(`${iw} must be a map: { label, about, value? }.`, line);
    allowKeys(x, ITEM_KEYS, iw, line);
    return levelOf(x, labelOf(x.label, iw, line), iw, line);
  });
}

function withIds<T extends { id?: string; label: string }>(items: T[], blockId: string, where: string, line: number): (T & { id: string })[] {
  const taken = new Set<string>([blockId]);
  for (const it of items) {
    if (it.id === undefined) continue;
    if (taken.has(it.id)) throw new SpecError(`${where}: id "${it.id}" is used twice (ids must also differ from the block id).`, line, "id-unique");
    taken.add(it.id);
  }
  return items.map((it) => ({ ...it, id: it.id ?? idFrom(it.label, taken, `${blockId}-`) }));
}

/** Ramp step for the i-th of n levels: 6 at the top down to 1 at the base. */
function rank(i: number, n: number): number {
  return n === 1 ? 6 : Math.round(6 - (i * 5) / (n - 1));
}

export const blockModule: BlockModule<PyramidBlock> = {
  type: "pyramid",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "pyramid", line);
    allowKeys(data, ["id", "title", "format", "data", "notes", "caveat", "story"], "pyramid", line);
    const id = requireString(data, "id", "pyramid", line);
    const where = `pyramid "${id}"`;
    const format = readFormat(data.format, line);
    const levels: PyramidLevel[] = withIds(readLevels(data.data, where, line), id, where, line);
    const n = levels.length;
    if (n < 2) throw new SpecError(`${where} needs at least 2 levels in \`data\`; got ${n}.`, line);
    if (n > MAX_LEVELS) {
      const k = Math.ceil(n / 2);
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${n} levels; the budget is ${MAX_LEVELS}. Merge neighbouring levels the reader never tells apart, or split it into two pyramids: levels 1–${k} and ${k + 1}–${n}.`, line });
    }
    const focal = levels.filter((l) => l.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} levels focal; keep it to ${BUDGET.focal}.`, line });
    }
    return { type: "pyramid", id, title: optString(data, "title", where, line), line, format, levels, ...readingSpec(data, line) };
  },

  render(block, ctx) {
    const { theme } = ctx;
    const W = 960, pad = theme.grid.pad, px = theme.type.nodeSub, tag = theme.type.tag;
    const levels = block.levels, n = levels.length;
    const lineH = Math.round(px * 1.3), gap = 4, inset = 16;
    const values = levels.map((l) => (l.value === undefined ? "" : fmt(l.value, block.format)));
    const valW = Math.max(0, ...values.map((v) => (v ? textWidth(v, tag, "mono") + 12 : 0)));
    const baseW = Math.min(640, W - 2 * pad - 2 * valW);
    const top = pad / 2;
    const need = levels.map((l) => textWidth(l.label, px, "sans") + 2 * inset);

    // Narrowest top that still fits every single-line label at its level's top edge; wrap what does not fit.
    const layout = (h: number) => {
      const H = n * h + (n - 1) * gap;
      let topW = baseW * 0.22;
      for (let i = 0; i < n; i++) {
        const r = (i * (h + gap)) / H;
        topW = Math.max(topW, (need[i] - baseW * r) / (1 - r));
      }
      topW = Math.min(topW, baseW * 0.7);
      const widthAt = (t: number) => topW + ((baseW - topW) * t) / H;
      const lines = levels.map((l, i) => wrap(l.label, widthAt(i * (h + gap)) - 2 * inset, px));
      return { H, widthAt, lines };
    };
    let h = 52, geo = layout(h);
    for (let pass = 0; pass < 3; pass++) {
      const want = Math.max(52, Math.max(...geo.lines.map((l) => l.length)) * lineH + 24);
      if (want <= h) break;
      h = want;
      geo = layout(h);
    }

    const height = top + geo.H + pad;

    // Drawn around cx; `lo`/`hi` are the ink's horizontal ends (the base, the values beside it, note markers).
    const draw = (cx: number) => {
      const anchors: Record<string, Frame> = {};
      const labelBoxes: Frame[] = [];
      const rows = levels.map((l, i) => {
        const t = i * (h + gap), yT = top + t, yB = yT + h, mid = yT + h / 2;
        const wT = geo.widthAt(t), wB = geo.widthAt(t + h), wM = geo.widthAt(t + h / 2);
        anchors[l.id] = { x: cx - wB / 2, y: yT, w: wB, h };
        const pts = ([[cx - wT / 2, yT], [cx + wT / 2, yT], [cx + wB / 2, yB], [cx - wB / 2, yB]] as const)
          .map(([x, y]) => `${num(x)},${num(y)}`).join(" ");
        const parts = [`<polygon class="x-mark-shape" points="${pts}"/>`];
        const ls = geo.lines[i];
        const first = mid - ((ls.length - 1) * lineH) / 2 + px * 0.35;
        ls.forEach((ln, k) => parts.push(text(cx, first + k * lineH, ln, "x-mark-label x-on-fill", "middle")));
        const lw = Math.max(0, ...ls.map((ln) => textWidth(ln, px, "sans")));
        labelBoxes.push({ x: cx - lw / 2, y: mid - (ls.length * lineH) / 2, w: lw, h: ls.length * lineH });
        if (values[i]) {
          parts.push(text(cx + wM / 2 + 12, mid + tag * 0.35, values[i], "x-value-label"));
          labelBoxes.push({ x: cx + wM / 2 + 12, y: mid - tag / 2, w: textWidth(values[i], tag, "mono"), h: tag });
        }
        // The label sits on the level's own fill: data-ink picks text or surface for it (the ramp flips at a different level per theme).
        const ink = markInk(theme, { focal: l.focal, muted: l.muted, level: rank(i, n) });
        const attrs = ` data-level="${rank(i, n)}"${l.muted ? ` data-muted="true"` : ""}${ink} data-nav="${i},0"`;
        return mark({ id: l.id, label: l.label, value: values[i] || undefined, focal: l.focal, cls: "x-pyramid-level", attrs }, parts.join(""));
      });
      // a marker may sit on either side; the crop keeps it
      const markers = noteMarkers(block, anchors, { obstacles: labelBoxes, bounds: { x: -1e4, y: 0, w: 2e4, h: height } });
      const xs = [
        cx - baseW / 2, cx + baseW / 2, ...labelBoxes.map((bx) => bx.x + bx.w),
        ...[...markers.matchAll(/class="x-note-ring" cx="([-\d.]+)"/g)].flatMap((m) => [Number(m[1]) - NOTE_R, Number(m[1]) + NOTE_R]),
      ];
      return { body: `<g class="x-pyramid">${rows.join("")}</g>${markers}`, lo: Math.min(...xs), hi: Math.max(...xs) };
    };

    // The drawing starts at the column edge, so a card docked beside it sits right next to the base.
    const { body, hi } = draw(EDGE - draw(0).lo);
    const [a, z] = [levels[0], levels[n - 1]];
    return svgFigure({
      id: block.id,
      kind: "pyramid",
      title: block.title,
      label: `Pyramid from ${a.label} to ${z.label}`,
      desc: `${n} ranked levels, ${a.label} at the narrow top and ${z.label} at the wide base.`,
      width: Math.ceil(hi + EDGE),
      height,
      body,
    });
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const levels = block.levels, n = levels.length;
    const val = (x: number) => fmt(x, block.format);
    const counted = levels.every((l) => l.value !== undefined);
    const total = counted ? levels.reduce((a, l) => a + (l.value ?? 0), 0) : 0;
    const topL = levels[0], baseL = levels[n - 1];
    levels.forEach((l, i) => {
      const above = levels[i - 1], below = levels[i + 1];
      const facts: Fact[] = [];
      if (l.value !== undefined) {
        if (counted && total > 0) facts.push({ k: "Share of all", v: `${share(l.value, total)} of all`, raw: (l.value / total) * 100 });
        if (above?.value) facts.push({ k: "Level above", v: `${ratio(l.value, above.value)} ${above.label}`, ref: above.id, raw: l.value / above.value });
        if (below?.value !== undefined && l.value) facts.push({ k: "Level below", v: `${below.label} is ${ratio(below.value, l.value)}`, ref: below.id, raw: below.value / l.value });
        // The ratio that proves a pyramid: on the focal level, how it compares with the far end.
        if (l.focal && i > 0 && topL.value) facts.push({ k: "vs the top", v: `${ratio(l.value, topL.value)} the top`, ref: topL.id, raw: l.value / topL.value });
        else if (l.focal && i === 0 && baseL.value !== undefined && l.value) facts.push({ k: "vs the base", v: `the base is ${ratio(baseL.value, l.value)}`, ref: baseL.id, raw: baseL.value / l.value });
      }
      const related = [above?.id, below?.id].filter((x): x is string => !!x);
      const links = [above && { rel: "Above", ids: [above.id] }, below && { rel: "Below", ids: [below.id] }].filter((x): x is { rel: string; ids: string[] } => !!x);
      elements[l.id] = itemInfo({
        id: l.id,
        label: l.label,
        figure: block.id,
        kind: "level",
        value: l.value === undefined ? undefined : val(l.value),
        about: l.about,
        related, facts, links,
        pos: `${i + 1} of ${n}`,
        say: [l.label, l.value === undefined ? "" : val(l.value), `level ${i + 1} of ${n}`, counted && total > 0 && l.value !== undefined ? `${share(l.value, total)} of all` : ""].filter(Boolean).join(", "),
      });
    });
    return { elements };
  },

  reading(block) {
    const counted = block.levels.some((l) => l.value !== undefined);
    return `Levels are ranked from the narrow top to the wide base; the widths show rank, not amount${counted ? ", so compare the numbers beside the levels" : ""}. The stronger the shade, the higher the level.`;
  },

  table(block) {
    return {
      head: ["Level", "Value", "About"],
      rows: block.levels.map((l) => [l.label, l.value === undefined ? "—" : fmt(l.value, block.format), l.about ?? ""]),
    };
  },
};
