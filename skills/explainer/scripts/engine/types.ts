// Shared contract for the explainer engine. Every module imports its types from here.
// Change this file only together with every module that depends on the changed shape.

// ---------- Theme ----------

export type Mode = "light" | "dark";

export interface ColorTokens {
  bg: string;          // page canvas
  surface: string;     // raised region: node boxes, panels, cards
  "surface-2": string; // hover / selected fill
  line: string;        // hairlines, default node stroke
  "line-strong": string; // hovered frame, strong rules
  text: string;        // primary text
  "text-dim": string;  // secondary text, sublabels, connector labels
  "text-faint": string;// disabled, absent marks, legend
  accent: string;      // interaction + focal only
  ok: string; warn: string; danger: string; info: string; // real state only
  link: string;        // external / API connectors
  // Tone text and washes for WAS/NOW panels and before/after cells. Optional in theme files:
  // theme.ts derives missing ones (tint = tone 12% over surface) and darkens or lightens every ink to 4.5:1 on its tint.
  "ok-ink"?: string; "warn-ink"?: string; "danger-ink"?: string;
  "ok-tint"?: string; "warn-tint"?: string; "danger-tint"?: string;
}

export type ToneToken = "ok-ink" | "warn-ink" | "danger-ink" | "ok-tint" | "warn-tint" | "danger-tint";

export interface FontFace {
  file: string;          // file name, resolved against assets/fonts/ or the theme's folder
  unicodeRange?: string; // CSS unicode-range for this subset
  weight?: string;       // e.g. "100 900" for a variable font
  style?: string;        // "normal" | "italic"
}

export interface FontRole {
  family: string;        // CSS family name, e.g. "Geist"
  fallback: string;      // CSS fallback stack
  faces: FontFace[];     // embedded as base64 @font-face; empty = rely on fallback
}

export interface Theme {
  name: string;
  /** `heading` is optional: a display face for the page title only; diagrams always use sans. */
  fonts: { sans: FontRole; mono: FontRole; heading?: FontRole };
  colors: { light: ColorTokens; dark: ColorTokens };
  /** Categorical palette for charts, in order of use. 6–8 colors per mode, all readable on bg. */
  series: { light: string[]; dark: string[] };
  type: {
    // px sizes, none below MIN_TEXT (13). Page ramp 13 · 15 · 19 · 26 + figure roles on the small step.
    caption: number; ui: number; body: number; h2: number; h1: number;
    nodeLabel: number;   // node name (sans, 600)
    nodeSub: number;     // node sublabel (sans, text-dim)
    edgeLabel: number;   // connector label (sans, text-dim)
    tag: number;         // section tag / legend / axis title (sans 600, sentence case)
  };
  radius: number;        // the single radius for every box
  grid: {
    unit: number;        // base unit, 8
    cell: [number, number]; // node cell [w, h] in px
    gap: [number, number];  // gutter [x, y] between cells; connectors live here
    pad: number;         // outer padding around the figure
  };
  /** Folder the theme was loaded from; font files resolve here first. Set by the loader. */
  dir?: string;
}

// ---------- Document ----------

export type Chrome = "none" | "title" | "full";
export type Width = "narrow" | "wide" | "full";
/** bare: diagrams and their interactions only. full: header, prose, notes and captions too. */
export type View = "bare" | "full";

export interface FrontMatter {
  title?: string;
  eyebrow?: string;
  summary?: string;
  source?: string;       // footer colophon (chrome: full)
  theme?: string;        // theme name or path to .json
  mode?: "auto" | Mode;
  chrome?: Chrome;       // default: "none" when the doc is a single block, else "title"
  width?: Width;         // default "wide"
  lang?: string;         // default "en"
  view?: View;
  /** States to audit and capture besides the defaults: "sel=id&theme=dark" strings, or { state, label } items. */
  shots?: string | (string | { state: string; label?: string })[];           // default "full"; readers switch with the controls or #view=
}

/** A fenced block after YAML parsing, before its module normalizes it. */
export interface RawBlock {
  type: string;          // fence language: figure | matrix | compare | steps | note | glossary | widget | detail
  info: string[];        // words after the language on the fence line, e.g. ["warn"] for ```note warn
  body: string;          // raw text inside the fence
  data: unknown;         // YAML-parsed body (undefined for note/widget, which are not YAML)
  line: number;          // 1-based line of the opening fence in the source
}

export type Segment =
  | { kind: "markdown"; text: string; line: number }
  | { kind: "block"; block: RawBlock }
  | { kind: "container"; layout: "split" | "stack" | "sidebar"; args: string[]; children: Segment[]; line: number };

export interface ParsedDoc {
  front: FrontMatter;
  segments: Segment[];
  file?: string;
}

// ---------- Figure spec (normalized) ----------

export type NodeKind = "actor" | "service" | "store" | "external" | "boundary" | "optional" | "decision";
export type EdgeKind = "flow" | "return" | "async" | "link";
export type Layout = "flow" | "layers" | "hub" | "states" | "zones" | "tree" | "cycle" | "sequence";

export interface NodeSpec {
  id: string;
  label: string;
  sub?: string;
  at: [number, number];   // [col, row], 0-based
  span: [number, number]; // [cols, rows], default [1, 1]
  kind: NodeKind;         // default "service"
  focal: boolean;
  about?: string;
  tags: string[];
}

export interface EdgeSpec {
  id: string;             // "<from>-><to>" or "<from>-><to>#2" when repeated
  from: string;
  to: string;
  label?: string;
  kind: EdgeKind;
  about?: string;
}

export interface GroupSpec {
  id: string;
  label: string;
  from: [number, number]; // top-left cell (inclusive)
  to: [number, number];   // bottom-right cell (inclusive)
  kind: "zone" | "trust";
  about?: string;
}

export interface SceneSpec {
  id: string;
  title: string;
  path: string[];                 // node ids in order; edges between consecutive nodes light up
  notes: Record<string, string>;  // node id → one-line note shown at that step
}

export interface FigureBlock {
  type: "figure";
  id: string;
  layout: Layout;
  title?: string;         // optional caption above the figure
  grid: [number, number]; // [cols, rows]; inferred from nodes when omitted
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  groups: GroupSpec[];
  scenes: SceneSpec[];
  legend: boolean;        // default true when >1 node kind or edge kind is used
  line: number;
}

/** Sequence layout: actors across the top, messages top to bottom. */
export interface SequenceBlock {
  type: "figure";
  id: string;
  layout: "sequence";
  title?: string;
  actors: NodeSpec[];     // `at` = [index, 0], span [1,1]
  messages: EdgeSpec[];   // id "m1", "m2", … in order; kind return = dashed reply
  scenes: SceneSpec[];    // path may contain actor ids and message ids
  legend: boolean;
  line: number;
}

// ---------- Other blocks (normalized) ----------

export type CellValue = "yes" | "no" | "partial" | string;

export interface MatrixBlock {
  type: "matrix";
  id: string;
  title?: string;
  corner?: string;                           // header of the row-label column
  columns: { id: string; label: string }[];  // ids that match elements get linked highlight
  rows: { id: string; label: string; about?: string; cells: Record<string, CellValue> }[];
  line: number;
}

export interface CompareBlock {
  type: "compare";
  id: string;
  title?: string;
  items: { id: string; label: string; points: string[]; focal: boolean; about?: string }[];
  line: number;
}

export interface StepsBlock {
  type: "steps";
  for: string;          // figure id
  scenes?: string[];    // subset/order; default all scenes of that figure
  line: number;
}

export interface NoteBlock {
  type: "note";
  tone: "info" | "warn" | "danger" | "ok";
  markdown: string;
  line: number;
}

export interface GlossaryBlock {
  type: "glossary";
  terms: Record<string, string>; // term → definition (one sentence)
  line: number;
}

export interface WidgetBlock {
  type: "widget";
  name: string;
  code: string;        // function body; runs with (el, api) in scope
  line: number;
}

export interface DetailBlock {
  type: "detail";      // explicit placement of the detail panel
  line: number;
}

export type Block =
  | FigureBlock | SequenceBlock | MatrixBlock | CompareBlock | StepsBlock
  | NoteBlock | GlossaryBlock | WidgetBlock | DetailBlock | CustomBlock;

/** Every other block type (charts, boards, structures) normalizes to its own interface with at least these keys. */
export interface CustomBlock extends ReadingSpec { type: string; id?: string; title?: string; line: number }

// ---------- Shared spec keys (normalized) ----------
// Any block may accept these. Parse them with kit.parseNotes / parseCaveat / parseStory / parseMarks / parseBands / parseUnit.

/** `notes:` item. `on` holds the target ids (a raw `on: id` becomes [id]); an empty list is a note without a marker. */
export interface NoteSpec { on: string[]; text: string }

/** `story:` step: select `sel` (and `cmp`), show `note` as an in-graph callout. */
export interface StoryStep { sel: string; cmp?: string; note?: string }

/** Statistic a reference line can stand on instead of a literal value. */
export type MarkStat = "mean" | "median";

/** `marks:` item, a reference line: `{y: 2, label: "SLO"}` or `{x: mean}`. At most 2 per block. */
export interface RefMarkSpec { axis: "x" | "y"; at: number | string | MarkStat; label?: string }

/** `bands:` item, a shaded range: `{from, to, label}`; `axis` defaults to the block's value axis. Values stay strings for dates. */
export interface BandSpec { axis?: "x" | "y"; from: number | string; to: number | string; label?: string }

/** `unit:` what one value counts: "signups", "h", "ms", "%", "$". Currency symbols go before the number, the rest after. */
export type Unit = string;

/** Keys for the expanded view. `caveat` is one plain sentence ("What this doesn't show"). */
export interface ReadingSpec { notes?: NoteSpec[]; caveat?: string; story?: StoryStep[] }

/** Keys for blocks with a numeric scale (bar, line, scatter, beeswarm, waterfall, timeline, gantt). */
export interface ScaleSpec { marks?: RefMarkSpec[]; bands?: BandSpec[]; unit?: Unit }

/** Real state for report blocks (WAS/NOW, before/after, status). Pair it with a word or symbol, never hue alone. */
export type Tone = "ok" | "warn" | "danger" | "neutral";

// ---------- Client model (embedded as JSON) ----------

export interface ElementInfo {
  id: string;
  type: "node" | "edge" | "group" | "row" | "column" | "item";
  label: string;
  sub?: string;
  about?: string;
  kind?: string;
  figure?: string;       // owning block id
  from?: string;         // edges only
  to?: string;           // edges only
  members?: string[];    // groups only: node ids inside
  value?: string;        // formatted value of a chart mark, shown under the title in the detail panel
  related?: string[];    // extra ids to light up with this element (a mark's series, a card's column…)
  facts?: Fact[];        // ≤5 computed rows for the card, most important first (kit.factList caps them)
  links?: Link[];        // semantic relation groups; when present they replace edge-derived rows
  context?: string[];    // tier-2 ids that stay at rest while this is selected (heatmap row/col, group siblings)
  pos?: string;          // eyebrow position, e.g. "5 of 7", "critical", "3 / 7"
  crumb?: string[];      // ancestor ids for the breadcrumb, outermost first
  say?: string;          // one line for aria-live and the hover tooltip: "Newsletter, 930 signups, 5th of 7"
  aboutHtml?: string;    // `about` as sanitised inline HTML, built at build time; the client never renders raw about
}

/** A card fact. `ref` makes it a chip that selects that id; `raw` keeps the number for compare mode. */
export interface Fact { k: string; v: string; ref?: string; tone?: "up" | "down" | "flat"; raw?: number }

/**
 * A relation group: `rel` is the label ("References", "Waits for", "Flows to"), `ids` its targets.
 * `inverse` names the reverse relation; the back-link pass adds {rel: inverse, ids: [this id]} to every target
 * and puts this id in the targets' context.
 */
export interface Link { rel: string; ids: string[]; inverse?: string }

/** Plain data table for the reading panel's Data <details> and Copy CSV. Cells are display strings. */
export interface DataTable { head: string[]; rows: string[][] }

export interface DocModel {
  elements: Record<string, ElementInfo>;
  scenes: Record<string, SceneSpec & { figure: string; edges: string[] }>; // edges: edge ids lit along the path, in order
  glossary: Record<string, string>;
}

// ---------- Block modules ----------

export interface Diagnostic {
  rule: string;          // stable rule id, see LINT_RULES
  severity: "error" | "warn";
  message: string;       // plain sentence, says what to change
  line?: number;
}

export class SpecError extends Error {
  constructor(message: string, public line?: number, public rule = "spec") {
    super(message);
  }
}

export interface RenderContext {
  theme: Theme;
  doc: ParsedDoc;
  /** Markdown → HTML for inline text (about, notes, points). */
  inline(md: string): string;
  /** Collect non-fatal problems while normalizing or rendering. */
  warn(d: Diagnostic): void;
}

export interface BlockModule<T extends { type: string; line: number } = Block> {
  type: T["type"];
  /** Validate + fill defaults. Throw SpecError for anything that cannot render. */
  normalize(raw: RawBlock, ctx: RenderContext): T;
  /** Pure: returns an HTML string (SVG inline). No colors, only classes and geometry. */
  render(block: T, ctx: RenderContext): string;
  /** What the client needs to know about this block's elements. */
  model?(block: T): Partial<DocModel>;
  /** The "How to read" line for the reading panel: encodings in one or two sentences. */
  reading?(block: T): string;
  /** The block's data as a table, for the reading panel and no-JS readers. */
  table?(block: T): DataTable;
}

// ---------- Commands ----------

/** Every CLI command module exports `run`. Returns the process exit code. */
export type CommandRun = (argv: string[]) => Promise<number>;

// ---------- Lint rule ids (shared by check.ts, docs, and renderers) ----------

export const LINT_RULES = {
  "spec": "Block cannot be parsed or has an unknown field.",
  "id-unique": "Every element id is unique across the whole document.",
  "ref-exists": "Edges, scenes, matrix columns and prose links point at existing ids.",
  "grid-collision": "Two nodes occupy the same cell.",
  "grid-bounds": "A node or group sits outside the figure grid.",
  "budget-nodes": "More than 9 nodes in one figure; split into overview + detail.",
  "budget-edges": "More than 12 connectors in one figure.",
  "budget-focal": "More than 2 focal elements in one figure.",
  "label-fit": "Node label is longer than its cell can hold.",
  "edge-label": "Connector label is over 3 words or 18 characters.",
  "about-missing": "Node has no `about`; the detail panel will be empty.",
  "about-repeats": "`about` starts by repeating the label.",
  "label-duplicate": "Two elements share the same visible label.",
  "route": "A connector could not be routed cleanly; move a node.",
  "ref-focal": "A figure's focal element is never linked from prose or a note.",
  "claim-unlinked": "A sentence with a number next to a figure links to no mark.",
  "note-target": "A note or story step points at an id that doesn't exist.",
  "link-implied": "A Wardley link repeats what the value chain already implies.",
  "link-bundle": "Two Wardley links meet a component so close together they read as one line.",
  "link-near-dot": "A Wardley link passes too close to a component it doesn't connect.",
  "move-boundary": "A Wardley movement ends on a stage boundary, so its target stage is ambiguous.",
  "move-left": "A Wardley movement points toward less evolved, which components don't do.",
} as const;

export type LintRule = keyof typeof LINT_RULES;

export const BUDGET = { nodes: 9, edges: 12, focal: 2, edgeLabelWords: 3, edgeLabelChars: 18 } as const;
