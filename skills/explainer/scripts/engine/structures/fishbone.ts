// Fishbone (Ishikawa): one effect at the head, cause categories as bones, causes as ticks on each bone.
// Diagonal bones are this type's grammar.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type Fact, type ReadingSpec } from "../types.ts";
import { READING_KEYS, arrowDefs, groupInfo, idFrom, isObj, itemInfo, list, mark, notes, num, number, rank, readingSpec, share, svgFigure, text, textWidth, type Frame } from "../kit.ts";
import { allowKeys, esc, optBool, optString, requireMap, requireString } from "../blocks/util.ts";

type Pt = [number, number];
interface Cause { id: string; label: string; about?: string; focal: boolean; weight?: number }
interface Category { id: string; label: string; about?: string; causes: Cause[] }

interface FishboneBlock extends ReadingSpec {
  type: "fishbone";
  id: string;
  title?: string;
  line: number;
  effect: { id: string; label: string; about?: string };
  categories: Category[];
}

const MAX_CATEGORIES = 6, MAX_CAUSES = 3;
const LABEL_CAP = 200; // widest cause label before it wraps
const TICK_PAD = 14;   // tick length beyond its label
const CLEAR = 3;       // gap between an upper bone and the end of its labels

/** Word-wrap into at most `maxLines`; the last kept line gets an ellipsis when text is cut. */
function fit(value: string, maxW: number, measure: (s: string) => number, maxLines: number): { lines: string[]; cut: boolean } {
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next) > maxW) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  const overflow = lines.length > maxLines;
  let cut = overflow;
  const out = lines.slice(0, maxLines).map((l, i, all) => {
    if (measure(l) <= maxW && !(overflow && i === all.length - 1)) return l;
    cut = true;
    let t = l;
    while (t.length > 1 && measure(`${t}…`) > maxW) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  });
  return { lines: out.length ? out : [""], cut };
}

const weightOf = (c: Category) => c.causes.reduce((s, x) => s + (x.weight ?? 0), 0);
const causesText = (n: number) => `${n} cause${n === 1 ? "" : "s"}`;

/** Notes and story steps may only point at this block's own elements. */
function checkRefs(spec: ReadingSpec, known: Set<string>, where: string, line: number): void {
  const refs = [...(spec.notes ?? []).flatMap((n) => n.on), ...(spec.story ?? []).flatMap((s) => (s.cmp ? [s.sel, s.cmp] : [s.sel]))];
  const missing = refs.find((id) => !known.has(id));
  if (missing) throw new SpecError(`${where}: notes or story point at "${missing}", which is not an element of this block.`, line, "ref-exists");
}

export const blockModule: BlockModule<FishboneBlock> = {
  type: "fishbone",

  normalize(raw, ctx) {
    const line = raw.line;
    const data = requireMap(raw.data, "fishbone", line);
    allowKeys(data, ["id", "title", "effect", "categories", ...READING_KEYS], "fishbone", line);
    const id = requireString(data, "id", "fishbone", line);
    const where = `fishbone "${id}"`;
    const taken = new Set<string>([`${id}-effect`]);
    const claim = (given: string) => {
      if (taken.has(given)) throw new SpecError(`${where}: id "${given}" is used twice.`, line, "id-unique");
      taken.add(given);
    };

    let effect: FishboneBlock["effect"];
    if (typeof data.effect === "string" && data.effect.trim()) effect = { id: `${id}-effect`, label: data.effect.trim() };
    else if (isObj(data.effect)) {
      allowKeys(data.effect, ["label", "about"], `${where} effect`, line);
      effect = { id: `${id}-effect`, label: requireString(data.effect, "label", `${where} effect`, line), about: optString(data.effect, "about", `${where} effect`, line) };
    } else throw new SpecError(`${where} needs \`effect\`: the problem at the head, as text or { label, about }.`, line);

    const list0 = list(data.categories, `${where} categories`, line);
    if (list0.length < 2) throw new SpecError(`${where} needs at least 2 categories; got ${list0.length}.`, line);
    const categories: Category[] = list0.map((c, i) => {
      const cw = `${where} category ${i + 1}`;
      if (!isObj(c)) throw new SpecError(`${cw} must be a map: { label, causes, about }.`, line);
      allowKeys(c, ["id", "label", "about", "causes"], cw, line);
      const label = requireString(c, "label", cw, line);
      const given = optString(c, "id", cw, line);
      if (given) claim(given);
      const cid = given ?? idFrom(label, taken, `${id}-`);
      const raws = list(c.causes, `${cw} causes`, line);
      if (!raws.length) throw new SpecError(`${cw} ("${label}") needs 1 to ${MAX_CAUSES} causes.`, line);
      if (raws.length > MAX_CAUSES) {
        ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${cw} ("${label}") lists ${raws.length} causes; keep ${MAX_CAUSES}. Merge the minor ones or give them their own category.`, line });
      }
      const causes: Cause[] = raws.map((v, j) => {
        const pw = `${cw} cause ${j + 1}`;
        const f = typeof v === "string" ? { label: v } : v;
        if (!isObj(f)) throw new SpecError(`${pw} must be text or a map: { label, about }.`, line);
        allowKeys(f, ["id", "label", "about", "focal", "weight"], pw, line);
        const clabel = requireString(f, "label", pw, line);
        const cgiven = optString(f, "id", pw, line);
        if (cgiven) claim(cgiven);
        let weight: number | undefined;
        if (f.weight !== undefined) {
          weight = number(f.weight, `${pw} weight`, line);
          if (weight < 0) throw new SpecError(`${pw} weight must be 0 or more, got ${weight}.`, line);
        }
        return { id: cgiven ?? idFrom(clabel, taken, `${id}-`), label: clabel, about: optString(f, "about", pw, line), focal: optBool(f, "focal", pw, line), weight };
      });
      return { id: cid, label, about: optString(c, "about", cw, line), causes };
    });

    if (categories.length > MAX_CATEGORIES) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${categories.length} categories; keep it to ${MAX_CATEGORIES}. Merge overlapping categories or split into two fishbones.`, line });
    }
    const all = categories.flatMap((c) => c.causes);
    const weighted = all.filter((c) => c.weight !== undefined).length;
    if (weighted && weighted < all.length) {
      ctx.warn({ rule: "spec", severity: "warn", message: `${where} gives a weight to ${weighted} of ${all.length} causes; weigh every cause or none, since the card ranks them against each other.`, line });
    }
    const focal = all.filter((x) => x.focal).length;
    if (focal > BUDGET.focal - 1) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} causes focal; the effect already carries the accent, so mark at most one root cause.`, line });
    }
    const reading = readingSpec(data, line);
    checkRefs(reading, new Set([effect.id, ...categories.flatMap((c) => [c.id, ...c.causes.map((x) => x.id)])]), where, line);
    return { type: "fishbone", id, title: optString(data, "title", where, line), line, effect, categories, ...reading };
  },

  render(block, ctx) {
    const { theme } = ctx;
    const pad = theme.grid.pad, radius = theme.radius;
    const width = 960;
    const px = theme.type.nodeSub, lh = Math.round(px * 1.3);
    const tag = theme.type.tag;
    const headPx = theme.type.nodeLabel, headLh = Math.round(headPx * 1.3);
    const sans = (size: number) => (s: string) => textWidth(s, size, "sans") * 1.08;
    // category chips: sentence-case 13/600 sans
    const head600 = (s: string) => textWidth(s, tag, "sans") * 1.08;

    const n = block.categories.length;
    const most = Math.max(1, ...block.categories.map((c) => c.causes.length));
    const boneH = Math.max(96, (most + 1) * 40);
    const boxH = 26;
    const spineY = pad + boxH + boneH;
    const height = spineY + boneH + boxH + pad;
    const boneDx = Math.round(boneH * 0.5), k = boneDx / boneH;

    const head = fit(block.effect.label, 180, sans(headPx), 4);
    if (head.cut) {
      ctx.warn({ rule: "label-fit", severity: "warn", message: `fishbone "${block.id}": the effect is too long for the head; say it in under 8 words and move the rest to about.`, line: block.line });
    }
    const headW = Math.min(212, Math.max(132, ...head.lines.map((t) => sans(headPx)(t) + 32)));
    const headH = Math.max(56, head.lines.length * headLh + 24);
    const headX = width - pad - headW;
    const lastJoint = headX - 20;

    // Bones are staggered: every bone has its own joint on the spine, up and down alternating left to right,
    // so a bone's labels have the whole run back to the previous bone on the same side.
    const f = (j: number, count: number) => (j + 1) / (count + 1);
    const lift = (lines: number) => CLEAR + k * (6 + (lines - 1) * lh + 0.75 * px);
    const layoutAt = (cap: number) => {
      const fitted = block.categories.map((c) => c.causes.map((cause) => fit(cause.label, cap, sans(px), 2)));
      const reach = fitted.map((causes, i) => Math.min(...causes.map((fc, j) => {
        const w = Math.max(...fc.lines.map(sans(px)));
        const up = i % 2 === 0;
        return -boneDx * (1 - f(j, causes.length)) - (w + TICK_PAD + (up ? Math.max(0, lift(fc.lines.length) - 6) : 0));
      })));
      let x0 = pad - reach[0];
      if (n > 2) x0 = Math.max(x0, (pad - reach[1] - lastJoint / (n - 1)) / (1 - 1 / (n - 1)));
      const step = (lastJoint - x0) / (n - 1);
      return { fitted, x0, step };
    };
    let L = layoutAt(LABEL_CAP);
    if (2 * L.step - 32 < LABEL_CAP) L = layoutAt(Math.max(64, 2 * L.step - 32));
    const { fitted, x0, step } = L;

    const bones: string[] = [];
    const causes: string[] = [];
    const anchors: Record<string, Frame> = {};
    const labelBoxes: Frame[] = [];
    const bonePts: [Pt, Pt][] = [];
    let spineStart = headX;
    block.categories.forEach((c, i) => {
      const up = i % 2 === 0;
      const xs = x0 + i * step;
      const ox = xs - boneDx, oy = up ? spineY - boneH : spineY + boneH;
      const chipMax = Math.min(2 * step - 16, 240);
      const label = fit(c.label, chipMax - 32, head600, 1).lines[0];
      const bw = Math.min(chipMax, Math.ceil((head600(label) + 32) / 8) * 8);
      const bx = Math.max(pad, ox - bw / 2), by = up ? oy - boxH : oy;
      anchors[c.id] = { x: bx, y: by, w: bw, h: boxH };
      bonePts.push([[ox, oy], [xs, spineY]]);
      bones.push(mark({ id: c.id, label: c.label, cls: "x-fishbone-cat" },
        `<line class="x-fishbone-bone" x1="${num(ox)}" y1="${num(oy)}" x2="${num(xs)}" y2="${num(spineY)}"/>` +
        `<rect class="x-mark-shape" x="${num(bx)}" y="${num(by)}" width="${num(bw)}" height="${boxH}" rx="${num(radius)}"/>` +
        text(bx + bw / 2, by + boxH / 2 + tag * 0.35, label, "x-fishbone-cat-label", "middle")));

      c.causes.forEach((cause, j) => {
        const t = f(j, c.causes.length);
        const x = ox + boneDx * t, y = oy + (spineY - oy) * t;
        spineStart = Math.min(spineStart, x - 16);
        const fc = fitted[i][j];
        if (fc.cut) {
          ctx.warn({ rule: "label-fit", severity: "warn", message: `fishbone "${block.id}" cause "${cause.label}" is too long for its bone; keep causes to a few words.`, line: block.line });
        }
        const tw = Math.max(...fc.lines.map(sans(px)));
        // an upper bone leans left as it rises, so its labels end further left to stay clear of it
        const end = x - (up ? Math.max(6, lift(fc.lines.length)) : 6);
        const tick = x - end + tw + 8;
        const base = y - 6;
        const top = base - (fc.lines.length - 1) * lh - px;
        anchors[cause.id] = { x: x - tick, y: top, w: tick, h: y - top };
        labelBoxes.push({ x: end - tw, y: top, w: tw, h: y - top });
        const shape = `<rect class="x-hit" x="${num(x - tick)}" y="${num(top)}" width="${num(tick)}" height="${num(y + 4 - top)}"/>` +
          `<line class="x-mark-shape" x1="${num(x - tick)}" y1="${num(y)}" x2="${num(x)}" y2="${num(y)}"/>` +
          fc.lines.map((line, q) => text(end, base - (fc.lines.length - 1 - q) * lh, line, "x-mark-label", "end")).join("");
        causes.push(mark({ id: cause.id, label: cause.label, focal: cause.focal, cls: "x-fishbone-cause" }, shape));
      });
    });
    spineStart = Math.max(pad, spineStart);

    const spine = `<line class="x-fishbone-spine" x1="${num(spineStart)}" y1="${num(spineY)}" x2="${num(headX)}" y2="${num(spineY)}" marker-end="url(#${esc(block.id)}-arrow)"/>`;
    const hy0 = spineY - ((head.lines.length - 1) * headLh) / 2 + headPx * 0.35;
    anchors[block.effect.id] = { x: headX, y: spineY - headH / 2, w: headW, h: headH };
    const headMark = mark({ id: block.effect.id, label: block.effect.label, focal: true, cls: "x-fishbone-head" },
      `<rect class="x-mark-shape" x="${num(headX)}" y="${num(spineY - headH / 2)}" width="${num(headW)}" height="${num(headH)}" rx="${num(radius)}"/>` +
      head.lines.map((t, q) => text(headX + headW / 2, hy0 + q * headLh, t, "x-mark-label x-on-fill x-fishbone-effect", "middle")).join(""));
    // Markers keep off the bones and the spine too, not only off labels and marks.
    const along = (a: Pt, b: Pt): Frame[] => {
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
      return Array.from({ length: n + 1 }, (_, k) => ({ x: a[0] + ((b[0] - a[0]) * k) / n - 3, y: a[1] + ((b[1] - a[1]) * k) / n - 3, w: 6, h: 6 }));
    };
    const lines = [...bonePts.flatMap(([a, b]) => along(a, b)), ...along([spineStart, spineY], [headX, spineY])];
    const markers = notes(block, anchors, { obstacles: [...labelBoxes, ...Object.values(anchors), ...lines], bounds: { x: 0, y: 0, w: width, h: height } });

    const total = block.categories.reduce((s, c) => s + c.causes.length, 0);
    return svgFigure({
      id: block.id,
      kind: "fishbone",
      title: block.title,
      label: `Causes of: ${block.effect.label}`,
      desc: `${total} causes in ${block.categories.length} categories that lead to ${block.effect.label}.`,
      width,
      height,
      defs: arrowDefs(block.id),
      body: spine + bones.join("") + causes.join("") + headMark + markers,
    });
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const all = block.categories.flatMap((c) => c.causes.map((x) => ({ cause: x, cat: c })));
    const weighed = all.some(({ cause }) => cause.weight !== undefined);
    const total = all.reduce((s, { cause }) => s + (cause.weight ?? 0), 0);
    const weights = all.map(({ cause }) => cause.weight ?? 0);
    const counts = (skip?: string): Fact[] => block.categories.filter((c) => c.id !== skip).map((c) => ({
      k: c.label, v: weighed ? `${share(weightOf(c), total)} · ${causesText(c.causes.length)}` : causesText(c.causes.length), ref: c.id,
    }));
    const ranked = [...all].sort((a, b) => (b.cause.weight ?? 0) - (a.cause.weight ?? 0));

    elements[block.effect.id] = itemInfo({
      id: block.effect.id, label: block.effect.label, figure: block.id, kind: "effect", about: block.effect.about,
      related: [...block.categories.map((c) => c.id), ...all.map(({ cause }) => cause.id)],
      facts: weighed
        ? ranked.slice(0, 3).map(({ cause }, i) => ({ k: `${i + 1}${["st", "nd", "rd"][i]}`, v: `${cause.label} · ${share(cause.weight ?? 0, total)}`, ref: cause.id }))
          .concat({ k: "Causes", v: `${all.length} in ${block.categories.length} categories` })
        : [{ k: "Causes", v: `${all.length} in ${block.categories.length} categories` }, ...counts()],
      links: [{ rel: "Categories", ids: block.categories.map((c) => c.id) }],
      say: `${block.effect.label}: ${all.length} causes in ${block.categories.length} categories`,
    });
    for (const c of block.categories) {
      const info = groupInfo({
        id: c.id, label: c.label, figure: block.id, kind: "category", about: c.about, members: c.causes.map((x) => x.id),
        facts: [
          { k: "Causes", v: String(c.causes.length) },
          weighed ? { k: "Share", v: share(weightOf(c), total) } : null,
          ...counts(c.id),
        ].filter((x): x is Fact => !!x),
        links: [{ rel: "Causes", ids: c.causes.map((x) => x.id) }],
        say: `${c.label}: ${c.causes.map((x) => x.label).join(", ")}`,
      });
      info.related = [block.effect.id];
      elements[c.id] = info;
      c.causes.forEach((cause, j) => {
        const r = weighed ? rank(cause.weight ?? 0, weights) : undefined;
        elements[cause.id] = itemInfo({
          id: cause.id, label: cause.label, figure: block.id, kind: "cause", about: cause.about,
          related: [c.id, block.effect.id],
          facts: [
            { k: "Category", v: c.label, ref: c.id },
            weighed && r ? { k: "Weight", v: `${share(cause.weight ?? 0, total)} · ${r.nth}` } : null,
            { k: "Leads to", v: block.effect.label, ref: block.effect.id },
          ].filter((x): x is Fact => !!x),
          pos: cause.focal ? "root cause" : `${j + 1} of ${c.causes.length}`,
          say: `${cause.label}, ${c.label}${cause.focal ? ", root cause" : ""}${weighed ? `, ${share(cause.weight ?? 0, total)} of the weight` : ""}`,
        });
      });
    }
    return { elements };
  },

  reading() {
    return "The problem sits at the head on the right. Each diagonal bone is a category of causes, and the ticks along it are the causes in that category; top and bottom bones read the same way.";
  },

  table(block): DataTable {
    const weighed = block.categories.some((c) => c.causes.some((x) => x.weight !== undefined));
    return {
      head: weighed ? ["Category", "Cause", "Weight"] : ["Category", "Cause"],
      rows: block.categories.flatMap((c) => c.causes.map((x) => (weighed ? [c.label, x.label, String(x.weight ?? 0)] : [c.label, x.label]))),
    };
  },
};
