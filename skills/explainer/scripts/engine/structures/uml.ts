// uml: class diagram on the figure grid. A class shows its name, then attributes, then operations (empty trailing
// compartments are left out); every member is a selectable row. Relations use UML ends: hollow triangle (inheritance,
// realization), diamonds (composition, aggregation), open arrow. Routes leave vertically, so a subclass meets its parent
// from below; siblings in one row share a single triangle under the parent.
import { BUDGET, SpecError, type BlockModule, type DataTable, type ElementInfo, type Fact, type Link, type ReadingSpec, type RenderContext, type Theme } from "../types.ts";
import { READING_KEYS, esc, factList, groupInfo, idFrom, isObj, itemInfo, list, mark, notes as noteMarkers, num, readingSpec, svgFigure, text, textWidth } from "../kit.ts";
import { allowKeys, joinList, optBool, optString, requireMap, requireString, stringList } from "../blocks/util.ts";
import {
  bandPath, boxWidth, cell, cellsFor, checkRefs, columnWidth, count, edgePath, edgeSvg, fitText, hit, inflate, markerObstacles, overlaps, placeLabel,
  rectOf, routeBoxes, runBoxes, segBox, spanOf, union, withColumn, type Pt, type Rect, type Route,
} from "./grid.ts";

type UmlKind = "inheritance" | "realization" | "composition" | "aggregation" | "association" | "dependency";
interface Op { kind: UmlKind; at?: "start" | "end" }

interface UmlMember {
  id: string;
  text: string;                      // as written: "+pay(p: Payment)"
  name: string;                      // "pay"
}

interface UmlClass {
  id: string;
  name: string;
  at: Pt;
  span: Pt;                          // [cols, rows]; rows follow the member count
  stereotype?: "interface" | "abstract";
  attributes: UmlMember[];
  operations: UmlMember[];
  about?: string;
  focal: boolean;
  muted: boolean;
}

interface UmlRelation {
  id: string;
  from: string;                      // class id, left side as written
  to: string;                        // class id, right side as written
  kind: UmlKind;
  head?: "start" | "end";            // which end carries the triangle, diamond or arrow
  label?: string;
  fromMult?: string;
  toMult?: string;
  title: string;                     // card title
  about: string;
  set?: string;                      // generalization set it is drawn in
}

/** Two or more subclasses (or implementations) of one parent in one row below it: drawn with one shared triangle. */
interface UmlSet {
  id: string;
  parent: string;
  kind: "inheritance" | "realization";
  children: string[];
  relations: string[];
}

interface UmlBlock extends ReadingSpec {
  type: "uml";
  id: string;
  title?: string;
  line: number;
  grid: Pt;
  cell: number;                      // this figure's column width
  classes: UmlClass[];
  relations: UmlRelation[];
  sets: UmlSet[];
}

const LIMIT = { classes: 7, relations: 8, members: 5 } as const;
const HEAD = 34, STEREO = 14, MEMBER = 18, INSET = 12, COMP_PAD = 6, EMPTY = 10;
/** Room between a parent's bottom and its subclasses' tops for the triangle, the trunk and the bus. */
const TRUNK_ROOM = 40;
const CLASS_KEYS = ["at", "span", "attributes", "operations", "stereotype", "about", "focal", "muted"];
const OPS = new Map<string, Op>([
  ["<|--", { kind: "inheritance", at: "start" }], ["--|>", { kind: "inheritance", at: "end" }],
  ["<|..", { kind: "realization", at: "start" }], ["..|>", { kind: "realization", at: "end" }],
  ["*--", { kind: "composition", at: "start" }], ["--*", { kind: "composition", at: "end" }],
  ["o--", { kind: "aggregation", at: "start" }], ["--o", { kind: "aggregation", at: "end" }],
  ["<--", { kind: "association", at: "start" }], ["-->", { kind: "association", at: "end" }], ["--", { kind: "association" }],
  ["<..", { kind: "dependency", at: "start" }], ["..>", { kind: "dependency", at: "end" }], ["..", { kind: "dependency" }],
]);
const HEADS: Record<UmlKind, string> = {
  inheritance: "tri", realization: "tri", composition: "dia-filled", aggregation: "dia", association: "vee", dependency: "vee",
};
const DASHED = new Set<UmlKind>(["realization", "dependency"]);
const HIERARCHY = new Set<UmlKind>(["inheritance", "realization"]);
/** Card relation words: what the plain end says about the symbol end, and the reverse. */
const REL: Record<UmlKind, [string, string]> = {
  inheritance: ["Extends", "Extended by"],
  realization: ["Implements", "Implemented by"],
  composition: ["Part of", "Owns"],
  aggregation: ["Held by", "Has"],
  association: ["Refers to", "Referred to by"],
  dependency: ["Uses", "Used by"],
};
const VISIBILITY: Record<string, string> = { "+": "public", "-": "private", "#": "protected", "~": "package" };
const RELATION = /^\s*([^\s"]+)\s+(?:"([^"]*)"\s+)?(\S+)\s+(?:"([^"]*)"\s+)?([^\s":]+)\s*(?::\s*(.*\S))?\s*$/;

export const blockModule: BlockModule<UmlBlock> = {
  type: "uml",

  normalize(raw, ctx) {
    const line = raw.line;
    const theme = ctx.theme;
    const data = requireMap(raw.data, "uml", line);
    allowKeys(data, ["id", "title", "classes", "relations", ...READING_KEYS], "uml", line);
    const id = requireString(data, "id", "uml", line);
    const where = `uml "${id}"`;
    const classMap = requireMap(data.classes, `${where} classes`, line);
    const names = Object.keys(classMap);
    if (!names.length) throw new SpecError(`${where} needs at least one class under \`classes\`.`, line);

    const taken = new Set<string>();
    const cids = new Map(names.map((name) => [name, idFrom(name, taken, `${id}-`)]));
    const drafted = names.map((name) => {
      const cw = `${where} class "${name}"`;
      const v = classMap[name];
      if (!isObj(v)) throw new SpecError(`${cw} must be a map: { at: [col, row], attributes, operations }.`, line);
      allowKeys(v, CLASS_KEYS, cw, line);
      if (v.at === undefined) throw new SpecError(`${cw} needs \`at: [col, row]\`.`, line);
      const at = cell(v.at, `${cw} at`, line);
      const stereo = optString(v, "stereotype", cw, line);
      if (stereo !== undefined && stereo !== "interface" && stereo !== "abstract") {
        throw new SpecError(`${cw}: stereotype must be interface or abstract, got "${stereo}".`, line);
      }
      const stereotype = stereo === "interface" || stereo === "abstract" ? stereo : undefined;
      const members = (key: "attributes" | "operations") =>
        (v[key] === undefined ? [] : stringList(v[key], `${cw} ${key}`, line)).map((t) => {
          const m = memberName(t);
          return { id: idFrom(`${name}-${m}`, taken, `${id}-`), text: t, name: m };
        });
      const attributes = members("attributes"), operations = members("operations");
      for (const [part, ms] of [["attributes", attributes], ["operations", operations]] as const) {
        if (ms.length > LIMIT.members) {
          ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${cw} lists ${ms.length} ${part}; keep it to ${LIMIT.members}, the ones the story needs.`, line });
        }
      }
      const size = classSize(name, stereotype, attributes, operations, theme);
      const span = spanOf(v.span, `${cw} span`, line);
      const box: UmlClass = {
        id: cids.get(name) as string, name, at, span: [span ?? 1, cellsFor(size.h, theme.grid.cell[1], theme.grid.gap[1])],
        stereotype, attributes, operations,
        about: optString(v, "about", cw, line), focal: optBool(v, "focal", cw, line), muted: optBool(v, "muted", cw, line),
      };
      return { cw, size, span, box };
    });
    // Every class is as wide as the widest one that fits a column, so the figure stays within 960px.
    const cols = Math.max(...drafted.map((d) => d.box.at[0] + (d.span ?? 1)));
    const width = columnWidth(drafted.filter((d) => d.span === undefined).map((d) => d.size.w), cols, theme);
    const classes = drafted.map(({ cw, size, span, box }) => {
      const need = cellsFor(size.w, width, theme.grid.gap[0]);
      box.span[0] = span ?? Math.min(need, 3);
      if (need > box.span[0]) {
        ctx.warn({ rule: "label-fit", severity: "warn", message: `${cw} needs span: ${need} to show "${size.widest}" in full; widen it or shorten the member.`, line });
      }
      return box;
    });

    const byName = new Map(classes.map((c) => [c.name, c]));
    const edgeIds = new Set<string>();
    const edgeId = (from: string, to: string) => {
      let e = `${from}->${to}`;
      for (let n = 2; edgeIds.has(e); n++) e = `${from}->${to}#${n}`;
      edgeIds.add(e);
      return e;
    };
    const rawRelations = data.relations === undefined ? [] : list(data.relations, `${where} relations`, line);
    const relations: UmlRelation[] = rawRelations.map((item, i) => {
      const rw = `${where} relation ${i + 1}`;
      let spec: string;
      let about: string | undefined;
      if (typeof item === "string") spec = item;
      else if (isObj(item)) {
        allowKeys(item, ["rel", "about"], rw, line);
        spec = requireString(item, "rel", rw, line);
        about = optString(item, "about", rw, line);
      } else throw new SpecError(`${rw} must be a string like "Order *-- LineItem" or { rel, about }.`, line);
      const m = RELATION.exec(spec);
      const op = m ? OPS.get(m[3] as string) : undefined;
      if (!m || !op) {
        throw new SpecError(`${rw} "${spec}" must read 'A <op> B' or 'A "1" <op> "many" B : label', with <op> one of ${[...OPS.keys()].join(" ")}.`, line);
      }
      const [, a = "", fromMult, , toMult, b = "", label] = m;
      const ca = byName.get(a), cb = byName.get(b);
      if (!ca || !cb) throw new SpecError(`${rw} names class "${ca ? b : a}", which is not in classes (${names.join(", ")}).`, line, "ref-exists");
      checkLabel(label, rw, line, ctx);
      return {
        id: edgeId(ca.id, cb.id), from: ca.id, to: cb.id, kind: op.kind, head: op.at, label,
        fromMult: fromMult || undefined, toMult: toMult || undefined,
        title: relTitle(op, a, b, label), about: about ?? relAbout(op, a, b),
      };
    });

    for (let i = 0; i < classes.length; i++) {
      for (let j = i + 1; j < classes.length; j++) {
        const a = classes[i] as UmlClass, b = classes[j] as UmlClass;
        if (overlaps(a, b)) {
          throw new SpecError(`${where}: classes "${a.name}" and "${b.name}" overlap. "${a.name}" covers ${a.span[0]}×${a.span[1]} cells from [${a.at.join(", ")}] because of its members; move "${b.name}" to row ${a.at[1] + a.span[1]} or column ${a.at[0] + a.span[0]}.`, line, "grid-collision");
        }
      }
    }
    if (classes.length > LIMIT.classes) {
      ctx.warn({ rule: "budget-nodes", severity: "warn", message: `${where} has ${classes.length} classes; keep it to ${LIMIT.classes}. Draw the core model here and one diagram per area (e.g. payments) below it.`, line });
    }
    if (relations.length > LIMIT.relations) {
      ctx.warn({ rule: "budget-edges", severity: "warn", message: `${where} draws ${relations.length} relations; keep it to ${LIMIT.relations}. Drop dependencies the story doesn't need first.`, line });
    }
    const focal = classes.filter((c) => c.focal).length;
    if (focal > BUDGET.focal) {
      ctx.warn({ rule: "budget-focal", severity: "warn", message: `${where} marks ${focal} classes focal; keep it to ${BUDGET.focal}.`, line });
    }

    // Siblings in one row below their parent share one triangle.
    const byId = new Map(classes.map((c) => [c.id, c]));
    const groups = new Map<string, UmlRelation[]>();
    for (const r of relations) {
      if (!HIERARCHY.has(r.kind) || !r.head) continue;
      const [parent, child] = ends(r).map((x) => byId.get(x) as UmlClass);
      if (!parent || !child || child.at[1] < parent.at[1] + parent.span[1]) continue;
      const k = `${parent.id}|${r.kind}|${child.at[1]}`;
      (groups.get(k) ?? groups.set(k, []).get(k) as UmlRelation[]).push(r);
    }
    const sets: UmlSet[] = [];
    for (const rs of groups.values()) {
      if (rs.length < 2) continue;
      const first = rs[0] as UmlRelation, parent = ends(first)[0];
      const kind = first.kind as UmlSet["kind"];
      const setId = idFrom(`${byId.get(parent)?.name}-${kind === "inheritance" ? "subclasses" : "implementations"}`, taken, `${id}-`);
      for (const r of rs) r.set = setId;
      sets.push({ id: setId, parent, kind, children: rs.map((r) => ends(r)[1]), relations: rs.map((r) => r.id) });
    }

    const reading = readingSpec(data, line);
    const ids = [...classes.flatMap((c) => [c.id, ...c.attributes.map((m) => m.id), ...c.operations.map((m) => m.id)]), ...relations.map((r) => r.id), ...sets.map((s) => s.id)];
    checkRefs(reading, new Set(ids), where, line);
    const grid: Pt = [Math.max(...classes.map((c) => c.at[0] + c.span[0])), Math.max(...classes.map((c) => c.at[1] + c.span[1]))];
    return { type: "uml", id, title: optString(data, "title", where, line), line, grid, cell: width, classes, relations, sets, ...reading };
  },

  render(block, ctx) {
    const theme = ctx.theme, fid = block.id, pad = theme.grid.pad, px = theme.type.edgeLabel;
    const warn = (message: string) => ctx.warn({ rule: "route", severity: "warn", message, line: block.line });
    const grid = withColumn(theme, block.cell);
    // A class box is as tall as its compartments and as wide as the figure's column; the grid span only reserves room for it.
    const rects = new Map(block.classes.map((c) => {
      const r = rectOf(c.at, c.span, grid), size = classSize(c.name, c.stereotype, c.attributes, c.operations, theme);
      return [c.id, { ...r, w: boxWidth(c.span[0], size.w, grid), h: Math.min(r.h, size.h) }] as const;
    }));
    const names = new Map(block.classes.map((c) => [c.id, c.name]));
    const boxes = block.classes.map((c) => ({ id: c.id, label: c.name, at: c.at, span: c.span }));
    const routes = routeBoxes(block, boxes, block.relations.filter((r) => !r.set), rects, grid, "tree");
    for (const r of routes.values()) if (r.warn) warn(r.warn);
    const trunks = new Map<string, Pt[]>();
    for (const s of block.sets) {
      const t = trunk(s, rects);
      trunks.set(s.id, t.trunk);
      t.branches.forEach((points, i) => routes.set(s.relations[i] as string, { points }));
      const skip = [s.parent, ...s.children];
      const lines = [t.trunk, ...t.branches];
      const near = [...rects].filter(([id, r]) => !skip.includes(id) && lines.some((p) => p.slice(1).some((b, i) => hit(segBox(p[i] as Pt, b), inflate(r, 6)))));
      if (near.length) warn(`The ${s.kind === "inheritance" ? "subclasses" : "implementations"} of ${names.get(s.parent)} pass through ${near.map(([id]) => `"${names.get(id)}"`).join(", ")}; move it so the row between them is free.`);
      if (t.room < TRUNK_ROOM) warn(`${names.get(s.parent)} sits ${Math.round(t.room)}px above its ${s.kind === "inheritance" ? "subclasses" : "implementations"}; leave one empty row between them for the shared triangle.`);
    }

    // Multiplicities first (they belong at the ends), then names beside a run that is clear of boxes and of them.
    const blocked = [...rects.values()].map((r) => inflate(r, 2));
    const mults = new Map<string, { text: string; x: number; y: number; anchor: "start" | "end"; box: Rect }[]>();
    for (const r of block.relations) {
      const pts = (routes.get(r.id) as Route).points;
      const out: { text: string; x: number; y: number; anchor: "start" | "end"; box: Rect }[] = [];
      for (const [mult, atStart] of [[r.fromMult, true], [r.toMult, false]] as const) {
        if (!mult) continue;
        const at = endLabelAt(pts, atStart), w = textWidth(mult, px, "sans");
        out.push({ text: mult, ...at, box: { x: at.anchor === "start" ? at.x : at.x - w, y: at.y - px, w, h: px * 1.3 } });
      }
      mults.set(r.id, out);
    }
    const allMults = [...mults.values()].flat().map((m) => m.box);
    const labels = new Map<string, Rect>();
    for (const r of block.relations) {
      if (!r.label) continue;
      const pts = (routes.get(r.id) as Route).points;
      const lines = block.relations.filter((o) => o !== r).flatMap((o) => runBoxes((routes.get(o.id) as Route).points)).concat([...trunks.values()].flatMap(runBoxes));
      const box = placeLabel(r.label, pts, px, [...blocked, ...allMults, ...labels.values()], lines, !!(r.fromMult || r.toMult));
      if (box) labels.set(r.id, box);
      else ctx.warn({ rule: "edge-label", severity: "warn", message: `uml "${fid}": label "${r.label}" on ${r.title} has no room beside its line; move the classes apart or shorten it.`, line: block.line });
    }

    const ext = union([
      ...[...rects.values()].map((r) => inflate(r, pad)),
      ...[...routes.values(), ...[...trunks.values()].map((points) => ({ points }))].flatMap((r) => r.points.map(([x, y]) => inflate({ x, y, w: 0, h: 0 }, pad / 2))),
      ...[...labels.values(), ...allMults].map((b) => inflate(b, pad / 2)),
    ]);
    const dx = -ext.x, dy = -ext.y;
    const at = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
    const shift = (p: Pt[]): Pt[] => p.map(([x, y]) => [x + dx, y + dy]);

    const drawn: Pt[][] = [];
    const edges = block.relations.map((r) => {
      const pts = shift((routes.get(r.id) as Route).points);
      const d = edgePath(pts, drawn);
      drawn.push(pts);
      const extra = (mults.get(r.id) ?? []).map((m) => text(m.x + dx, m.y + dy, m.text, "x-struct-mult", m.anchor));
      const box = labels.get(r.id);
      if (box && r.label) extra.push(text(box.x + dx + box.w / 2, box.y + dy + box.h / 2 + px * 0.35, r.label, "x-struct-label", "middle"));
      const head = r.set ? undefined : `${fid}-uml-${HEADS[r.kind]}`;
      const markers = { start: r.head === "start" ? head : undefined, end: r.head === "end" ? head : undefined };
      return edgeSvg(r, d, markers, DASHED.has(r.kind), extra.join(""));
    }).join("");
    const trunkSvg = block.sets.map((s) => {
      const pts = shift(trunks.get(s.id) as Pt[]);
      drawn.push(pts);
      return edgeSvg({ id: s.id, from: s.parent, to: s.parent }, edgePath(pts, []), { end: `${fid}-uml-tri` }, s.kind === "realization", "", "x-struct-trunk");
    }).join("");
    const classSvgs = block.classes.map((c) => classSvg(c, at(rects.get(c.id) as Rect), theme)).join("");

    const anchors: Record<string, Rect> = {};
    for (const c of block.classes) {
      const r = at(rects.get(c.id) as Rect);
      anchors[c.id] = r;
      for (const m of memberRows(c, r)) anchors[m.member.id] = m.rect;
    }
    for (const r of block.relations) {
      const box = labels.get(r.id);
      anchors[r.id] = box ? at(box) : midFrame(shift((routes.get(r.id) as Route).points));
    }
    for (const s of block.sets) anchors[s.id] = midFrame(shift(trunks.get(s.id) as Pt[]));
    const width = ext.w, height = ext.h;
    const notes = noteMarkers(block, anchors, {
      // 6px round each class: a marker stays clear of the selection ring, drawn 3px outside a selected class.
      obstacles: [...block.classes.map((c) => inflate(anchors[c.id] as Rect, 6)), ...drawn.flatMap(markerObstacles), ...[...labels.values(), ...allMults].map(at)],
      bounds: { x: 0, y: 0, w: width, h: height },
    });
    const classNames = block.classes.map((c) => c.name);
    return svgFigure({
      id: fid,
      kind: "uml",
      title: block.title,
      label: `Class diagram: ${joinList(classNames)}`,
      desc: `${count(classNames.length, "class", "classes")} (${joinList(classNames)}) joined by ${count(block.relations.length, "relation")}.`,
      width,
      height,
      defs: umlDefs(fid),
      body: `<g class="x-struct-edges">${edges}${trunkSvg}</g><g class="x-struct-boxes">${classSvgs}</g>${notes}`,
    });
  },

  model(block) {
    const elements: Record<string, ElementInfo> = {};
    const byId = new Map(block.classes.map((c) => [c.id, c]));
    const name = (id: string) => byId.get(id)?.name ?? id;
    const parents = new Map<string, string[]>(), children = new Map<string, string[]>();
    for (const r of block.relations) {
      if (!HIERARCHY.has(r.kind) || !r.head) continue;
      const [p, c] = ends(r);
      (parents.get(c) ?? parents.set(c, []).get(c) as string[]).push(p);
      (children.get(p) ?? children.set(p, []).get(p) as string[]).push(c);
    }
    // Nearest first, in the order the relations are written.
    const closure = (id: string, next: Map<string, string[]>): string[] => {
      const seen = new Set<string>(), queue = [...(next.get(id) ?? [])];
      while (queue.length) {
        const x = queue.shift() as string;
        if (x === id || seen.has(x)) continue;
        seen.add(x);
        queue.push(...(next.get(x) ?? []));
      }
      return [...seen];
    };
    const membersOf = (c: UmlClass) => [...c.attributes, ...c.operations];
    const hierarchyEdges = (ids: Set<string>) => block.relations.filter((r) => HIERARCHY.has(r.kind) && ids.has(r.from) && ids.has(r.to)).flatMap((r) => [r.id, ...(r.set ? [r.set] : [])]);

    for (const c of block.classes) {
      const ancestors = closure(c.id, parents), descendants = closure(c.id, children);
      const incident = block.relations.filter((r) => r.from === c.id || r.to === c.id);
      const inherited = ancestors.flatMap((a) => membersOf(byId.get(a) as UmlClass));
      const related = [...new Set([
        ...membersOf(c).map((m) => m.id), ...inherited.map((m) => m.id),
        ...incident.flatMap((r) => [r.id, r.from === c.id ? r.to : r.from, ...(r.set ? [r.set] : [])]),
      ])].filter((x) => x !== c.id);
      // The rest of the hierarchy (grandparents, grandchildren and the lines between them) stays at rest.
      const family = new Set([c.id, ...ancestors, ...descendants]);
      const context = [...family, ...hierarchyEdges(family)].filter((x) => x !== c.id && !related.includes(x));
      const links = new Map<string, string[]>();
      for (const r of incident) {
        if (r.from === r.to) continue;
        const other = r.from === c.id ? r.to : r.from;
        const rel = relWord(r, c.id);
        links.set(rel, [...(links.get(rel) ?? []), other]);
      }
      const facts: (Fact | false)[] = [
        { k: "Members", v: [c.attributes.length && count(c.attributes.length, "attribute"), c.operations.length && count(c.operations.length, "operation")].filter(Boolean).join(" · ") || "none shown" },
        !!ancestors.length && { k: "Inherits", v: inherited.map((m) => m.text).join(", ") || `nothing shown from ${joinList(ancestors.map(name))}` },
        !!descendants.length && { k: children.get(c.id)?.length === descendants.length ? "Subclasses" : "Descendants", v: joinList(descendants.map(name)) },
      ];
      const info: ElementInfo = {
        id: c.id, type: "node", label: c.name, kind: kindWord(c), figure: block.id, related, facts: factList(facts),
        say: [c.name, kindWord(c), ancestors.length && `extends ${joinList((parents.get(c.id) ?? []).map(name))}`, descendants.length && `extended by ${joinList((children.get(c.id) ?? []).map(name))}`].filter(Boolean).join(", "),
      };
      if (context.length) info.context = context;
      if (links.size) info.links = [...links].map(([rel, ids]): Link => ({ rel, ids }));
      if (c.about) info.about = c.about;
      elements[c.id] = info;

      for (const [part, members] of [["attribute", c.attributes], ["operation", c.operations]] as const) {
        for (const m of members) {
          const type = /\)?\s*:\s*(.+)$/.exec(m.text.replace(/\(.*\)/, "()"))?.[1]?.trim();
          elements[m.id] = itemInfo({
            id: m.id, label: `${c.name}.${m.name}${part === "operation" ? "()" : ""}`, figure: block.id, kind: part, value: m.text, related: [c.id],
            crumb: [c.id], context: descendants,
            facts: factList([
              { k: "Visibility", v: VISIBILITY[m.text.trim()[0] ?? ""] ?? "not given" },
              !!type && { k: part === "operation" ? "Returns" : "Type", v: type as string },
              !!descendants.length && { k: "Inherited by", v: joinList(descendants.map(name)) },
            ]),
            say: `${c.name}.${m.name}, ${part}${type ? `, ${type}` : ""}`,
          });
        }
      }
    }
    for (const r of block.relations) {
      const [head, tail] = r.head === "start" ? [r.from, r.to] : [r.to, r.from];
      const facts: (Fact | false)[] = [
        { k: "Kind", v: r.kind },
        !!(r.fromMult && r.toMult) && { k: "Multiplicity", v: `${r.fromMult} ${name(r.from)} to ${r.toMult} ${name(r.to)}` },
        r.kind === "composition" && { k: "Lifecycle", v: `a ${name(tail)} is deleted with its ${name(head)}` },
        r.kind === "aggregation" && { k: "Lifecycle", v: `a ${name(tail)} outlives its ${name(head)}` },
        HIERARCHY.has(r.kind) && { k: "Inherits", v: membersOf(byId.get(head) as UmlClass).map((m) => m.text).join(", ") || "nothing shown" },
      ];
      const e: ElementInfo = { id: r.id, type: "edge", label: r.title, kind: r.kind, figure: block.id, from: r.from, to: r.to, about: r.about, facts: factList(facts), say: r.title };
      if (r.fromMult && r.toMult) e.value = `${r.fromMult} to ${r.toMult}`;
      if (r.set) e.related = [r.set];
      elements[r.id] = e;
    }
    for (const s of block.sets) {
      const info = groupInfo({
        id: s.id, label: `${s.kind === "inheritance" ? "Subclasses" : "Implementations"} of ${name(s.parent)}`, figure: block.id,
        members: [s.parent, ...s.children], kind: s.kind === "inheritance" ? "generalization" : "realization",
        links: [{ rel: s.kind === "inheritance" ? "Extended by" : "Implemented by", ids: s.children }],
        say: `${joinList(s.children.map(name))} ${s.kind === "inheritance" ? "extend" : "implement"} ${name(s.parent)}`,
      });
      // What the children inherit lights with them.
      info.related = [...s.relations, ...membersOf(byId.get(s.parent) as UmlClass).map((m) => m.id)];
      elements[s.id] = info;
    }
    return { elements };
  },

  reading() {
    return "Each box is a class: its name, then attributes, then operations (italic = abstract). A hollow triangle points at the parent a class extends (dashed: an interface it implements); a filled diamond sits at the owner its parts can't outlive, a hollow diamond at a holder its parts outlive; an open arrow points at what a class refers to (dashed: uses).";
  },

  table(block) {
    const name = new Map(block.classes.map((c) => [c.id, c.name]));
    if (!block.relations.length) {
      return { head: ["Class", "Kind", "Attributes", "Operations"], rows: block.classes.map((c) => [c.name, kindWord(c), c.attributes.map((m) => m.text).join(", "), c.operations.map((m) => m.text).join(", ")]) };
    }
    const out: DataTable = { head: ["From", "Relation", "To", "Multiplicity"], rows: [] };
    for (const r of block.relations) {
      out.rows.push([name.get(r.from) ?? r.from, r.kind, name.get(r.to) ?? r.to, r.fromMult && r.toMult ? `${r.fromMult} to ${r.toMult}` : ""]);
    }
    return out;
  },
};

// ---------- wording ----------

/** [parent, child] of a hierarchy relation; [symbol end, plain end] for the other kinds. */
function ends(r: UmlRelation): [string, string] {
  return r.head === "start" ? [r.from, r.to] : [r.to, r.from];
}

function relWord(r: UmlRelation, self: string): string {
  if (!r.head) return r.kind === "association" ? "Linked to" : r.from === self ? "Uses" : "Used by";
  const [head] = ends(r);
  const [plain, symbol] = REL[r.kind];
  return head === self ? symbol : plain;
}

function memberName(t: string): string {
  return /^\s*[+\-#~]?\s*([^\s(:]+)/.exec(t)?.[1] ?? t.trim();
}

function kindWord(c: UmlClass): string {
  return c.stereotype === "interface" ? "interface" : c.stereotype === "abstract" ? "abstract class" : "class";
}

function relTitle(op: Op, a: string, b: string, label?: string): string {
  if (label) return `${a} ${label} ${b}`;
  const [head, tail] = op.at === "start" ? [a, b] : [b, a];
  switch (op.kind) {
    case "inheritance": return `${tail} extends ${head}`;
    case "realization": return `${tail} implements ${head}`;
    case "composition": return `${head} owns ${tail}`;
    case "aggregation": return `${head} has ${tail}`;
    case "association": return op.at ? `${tail} → ${head}` : `${a} – ${b}`;
    case "dependency": return op.at ? `${tail} uses ${head}` : `${a} uses ${b}`;
  }
}

function relAbout(op: Op, a: string, b: string): string {
  const [head, tail] = op.at === "start" ? [a, b] : [b, a];
  switch (op.kind) {
    case "inheritance": return `${tail} is a kind of ${head} and inherits its members.`;
    case "realization": return `${tail} implements the ${head} interface.`;
    case "composition": return `${tail} exists only as part of ${head}; removing the ${head} removes it.`;
    case "aggregation": return `${head} groups ${tail}, which also exists on its own.`;
    case "association": return op.at ? `${tail} keeps a reference to ${head}.` : `${a} and ${b} know about each other.`;
    case "dependency": return op.at ? `${tail} uses ${head} without keeping a reference to it.` : `${a} uses ${b} without keeping a reference to it.`;
  }
}

function checkLabel(label: string | undefined, where: string, line: number, ctx: RenderContext): void {
  if (!label) return;
  if (label.split(/\s+/).length > BUDGET.edgeLabelWords || label.length > BUDGET.edgeLabelChars) {
    ctx.warn({ rule: "edge-label", severity: "warn", message: `${where}: label "${label}" is over ${BUDGET.edgeLabelWords} words or ${BUDGET.edgeLabelChars} characters; use a short verb or drop it.`, line });
  }
}

// ---------- measuring and drawing ----------

const compH = (n: number) => (n ? 2 * COMP_PAD + n * MEMBER : EMPTY);

/** Compartments drawn below the name: none, attributes, or attributes (kept, maybe empty) and operations. */
function compartments(attributes: UmlMember[], operations: UmlMember[]): UmlMember[][] {
  return operations.length ? [attributes, operations] : attributes.length ? [attributes] : [];
}

function classSize(name: string, stereotype: UmlClass["stereotype"], attributes: UmlMember[], operations: UmlMember[], theme: Theme): { w: number; h: number; widest: string } {
  const ty = theme.type;
  const s = stereotype === "interface" ? STEREO : 0;
  let w = 2 * INSET + textWidth(name, ty.nodeLabel, "sans") * 1.05, widest = name;
  if (s) w = Math.max(w, 2 * INSET + textWidth("«interface»", ty.tag, "mono"));
  for (const m of [...attributes, ...operations]) {
    const mw = 2 * INSET + textWidth(m.text, ty.nodeSub, "mono");
    if (mw > w) { w = mw; widest = m.text; }
  }
  return { w, h: HEAD + s + compartments(attributes, operations).reduce((h, c) => h + compH(c.length), 0), widest };
}

function memberRows(c: UmlClass, r: Rect): { member: UmlMember; rect: Rect; y: number }[] {
  const out: { member: UmlMember; rect: Rect; y: number }[] = [];
  let y = r.y + HEAD + (c.stereotype === "interface" ? STEREO : 0);
  for (const members of compartments(c.attributes, c.operations)) {
    members.forEach((member, i) => {
      const top = y + COMP_PAD + i * MEMBER;
      out.push({ member, y: top + MEMBER / 2, rect: { x: r.x + 1, y: top, w: r.w - 2, h: MEMBER } });
    });
    y += compH(members.length);
  }
  return out;
}

function classSvg(c: UmlClass, r: Rect, theme: Theme): string {
  const ty = theme.type;
  const s = c.stereotype === "interface" ? STEREO : 0;
  const cx = r.x + r.w / 2, inner = r.w - 2 * INSET;
  const parts = [`<rect class="x-mark-shape" x="${num(r.x)}" y="${num(r.y)}" width="${num(r.w)}" height="${num(r.h)}" rx="${num(theme.radius)}"/>`, bandPath(r, HEAD + s, theme.radius)];
  if (s) parts.push(text(cx, r.y + 14 + ty.tag * 0.35, "«interface»", "x-struct-stereo", "middle"));
  const nameCls = c.stereotype === "abstract" ? "x-struct-name x-italic" : "x-struct-name";
  parts.push(text(cx, r.y + s + HEAD / 2 + ty.nodeLabel * 0.35, fitText(c.name, inner, ty.nodeLabel, "sans"), nameCls, "middle"));
  let y = r.y + HEAD + s;
  for (const members of compartments(c.attributes, c.operations)) {
    parts.push(`<line class="x-struct-rule" x1="${num(r.x)}" y1="${num(y)}" x2="${num(r.x + r.w)}" y2="${num(y)}"/>`);
    y += compH(members.length);
  }
  const muted = c.muted ? ` data-muted="true"` : "";
  const value = c.stereotype ? kindWord(c) : undefined;
  const box = mark({ id: c.id, label: c.name, value, focal: c.focal, cls: "x-struct-box", attrs: muted }, parts.join(""));
  const rows = memberRows(c, r).map(({ member, rect, y: mid }) => mark(
    { id: member.id, label: `${c.name}.${member.name}`, value: member.text, cls: "x-struct-col", attrs: muted },
    `<rect class="x-mark-shape x-struct-row x-anchor" x="${num(rect.x)}" y="${num(rect.y)}" width="${num(rect.w)}" height="${num(rect.h)}"/>` +
      text(r.x + INSET, mid + ty.nodeSub * 0.35, fitText(member.text, inner, ty.nodeSub, "mono"), "x-struct-member x-mono"),
  )).join("");
  return `<g class="x-struct-class">${box}${rows}</g>`;
}

/**
 * One triangle under the parent's bottom centre, a trunk down to a bus halfway to the children,
 * and a branch from the bus up into the top centre of each child.
 */
function trunk(s: UmlSet, rects: Map<string, Rect>): { trunk: Pt[]; branches: Pt[][]; room: number } {
  const p = rects.get(s.parent) as Rect;
  const px = p.x + p.w / 2, pb = p.y + p.h;
  const kids = s.children.map((id) => rects.get(id) as Rect);
  const top = Math.min(...kids.map((k) => k.y));
  const bus = Math.round((pb + top) / 2);
  const branches = kids.map((k): Pt[] => {
    const cx = k.x + k.w / 2;
    return cx === px ? [[cx, k.y], [cx, bus]] : [[cx, k.y], [cx, bus], [px, bus]];
  });
  return { trunk: [[px, bus], [px, pb]], branches, room: top - pb };
}

/** Where a line without a label takes its note marker: the middle of its longest run. */
function midFrame(p: Pt[]): Rect {
  let best = 0, len = -1;
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i] as Pt, b = p[i + 1] as Pt, l = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (l > len) { len = l; best = i; }
  }
  const a = p[best] ?? [0, 0], b = p[best + 1] ?? a;
  return { x: (a[0] + b[0]) / 2 - 1, y: (a[1] + b[1]) / 2 - 1, w: 2, h: 2 };
}

/** UML ends. orient auto-start-reverse lets one marker serve both ends; the tip sits on the class border. */
function umlDefs(fid: string): string {
  const m = (name: string, w: number, h: number, body: string) =>
    `<marker id="${esc(fid)}-uml-${name}" viewBox="0 0 ${w} ${h}" markerWidth="${w}" markerHeight="${h}" refX="${w - 1}" refY="${h / 2}" orient="auto-start-reverse" markerUnits="userSpaceOnUse">${body}</marker>`;
  return m("tri", 16, 16, `<path class="x-struct-head" d="M1,1.5 L15,8 L1,14.5 z"/>`) +
    m("dia", 22, 12, `<path class="x-struct-head" d="M1,6 L11,1 L21,6 L11,11 z"/>`) +
    m("dia-filled", 22, 12, `<path class="x-struct-head x-filled" d="M1,6 L11,1 L21,6 L11,11 z"/>`) +
    m("vee", 12, 12, `<path class="x-struct-head x-open" d="M1,1 L11,6 L1,11"/>`);
}

/** Multiplicity beside the line, just outside the box and clear of the end marker. */
function endLabelAt(p: Pt[], atStart: boolean): { x: number; y: number; anchor: "start" | "end" } {
  const e = atStart ? p[0] : p[p.length - 1], q = atStart ? p[1] : p[p.length - 2];
  if (!e || !q) return { x: 0, y: 0, anchor: "start" };
  const dx = Math.sign(q[0] - e[0]), dy = Math.sign(q[1] - e[1]);
  if (dx === 0) return { x: e[0] + 10, y: dy >= 0 ? e[1] + 18 : e[1] - 10, anchor: "start" };
  return { x: e[0] + dx * 6, y: e[1] - 8, anchor: dx > 0 ? "start" : "end" };
}
