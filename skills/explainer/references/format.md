# Document format

The complete authoring reference. The engine rejects what isn't listed here; `check` names the line.

## Contents

- File shape
- Front matter
- Blocks and YAML
- figure: nodes, edges, groups, scenes, legend
- figure with layout: sequence
- Keys every block takes: notes, caveat, story
- Keys for blocks with a scale: marks, bands, unit
- matrix, compare, steps, note, glossary, widget, detail
- Containers
- Prose links and glossary terms
- Ids
- Grid geometry and label limits
- Lint rules

## File shape

````markdown
---
title: How a request is authorized
chrome: title
---

Every request passes the [Gateway](#gw) before any service runs.

```figure
id: auth
layout: flow
nodes:
  app: { label: Web app, at: [0, 0], kind: actor, about: What the user sees. Sends a session token with every request. }
  gw:  { label: Gateway, at: [1, 0], focal: true, about: Checks the token before anything else runs. }
edges:
  - app -> gw: sends token
```
````

Markdown between blocks becomes prose. Headings keep slug ids, so `## 01 · Access` becomes `#01-access`.

## Front matter

YAML between two `---` lines at the very start of the file. Every key is optional.

| Key | Default | Meaning |
|---|---|---|
| `title` | none | Page title. Shown in the header when `chrome` is `title` or `full` |
| `eyebrow` | none | Small section tag above the title (sentence case) |
| `summary` | none | One line under the title |
| `source` | none | Colophon in the footer. Shown only with `chrome: full` |
| `chrome` | `none` if the document is a single block, else `title` | `none` is just the content. `title` adds the header with the theme toggle. `full` adds the header and footer |
| `mode` | `auto` | `auto` follows the reader's OS. `light` or `dark` sets the starting theme; readers can still toggle |
| `width` | `wide` | `narrow` is 720px, `wide` is 1280px (prose keeps a 68ch measure; figures use the width), `full` is the window width |
| `theme` | `default` | A theme name, or a path to a theme `.json` relative to the document |
| `lang` | `en` | The page's `lang` attribute |
| `view` | `full` | `bare` starts on the diagrams alone; `full` adds the header, prose, notes and reading panels. Readers switch with the controls or `#view=` |
| `shots` | none | Extra states `audit` checks and `gallery` can capture, as URL hashes: `"sel=gw&theme=dark"`, a list of them, `[{state, name}]`, or a map of name → state |

## Blocks and YAML

A block is a fence with a type: ```` ```figure ````, ```` ```note warn ````. Words after the type are its info. Fences with any other language (```` ```ts ````) stay ordinary code in the prose.

`note` bodies are Markdown and `widget` bodies are JavaScript. Every other body is YAML. Four YAML traps:

- Inside `{ … }` a comma ends the value. Text with commas needs quotes or block style.
- `: ` (colon then space) inside text starts a new key. Quote it: `sub: "v2: beta"`.
- ` #` (space then hash) starts a comment.
- Values starting with `:`, `@`, `*`, `&`, `!`, `%`, `` ` ``, `[` or `{` need quotes: `sub: ":443"`.

## figure

```figure
id: checkout
layout: flow
title: How checkout works
grid: [4, 2]
nodes: …
edges: …
groups: …
scenes: …
legend: true
```

| Key | Default | Meaning |
|---|---|---|
| `id` | required | Block id. `steps`, `shot --figure` and `export --figure` use it |
| `layout` | set it | `flow`, `layers`, `hub`, `states`, `zones`, `tree`, `cycle` or `sequence`. See [layouts.md](layouts.md) |
| `title` | none | Caption above the figure. Also the SVG's accessible title |
| `grid` | inferred from nodes | `[cols, rows]` |
| `nodes` | required | Map or list, see below |
| `edges` | `[]` | Connectors |
| `groups` | `{}` | Rectangles around cells |
| `scenes` | `{}` | Named paths for `steps` |
| `legend` | on when more than one node kind or edge kind is used | `false` hides it |

### Nodes

Map form (id → fields) or list form (items with `id`):

```yaml
nodes:
  gw: { label: Gateway, sub: ":443", at: [2, 1], focal: true, about: Checks the token before anything else runs. }
```

```yaml
nodes:
  - id: gw
    label: Gateway
    at: [2, 1]
    about: Checks the token before anything else runs.
```

| Field | Default | Meaning |
|---|---|---|
| `label` | required | The name on the box. About 18 characters per column spanned |
| `sub` | none | A short dim line under the label: port, version, count |
| `at` | required | `[col, row]`, counted from 0 |
| `span` | `[1, 1]` | `[cols, rows]` |
| `kind` | `service` | See the kinds below |
| `focal` | `false` | Accent treatment. At most 2 per figure |
| `about` | none | Two or three short sentences for the card: what it does, why it is there, what to watch. Markdown inline |
| `tags` | `[]` | Short strings for your own grouping. Not drawn on the canvas |

| Kind | Use for | Drawn as |
|---|---|---|
| `actor` | A person or client outside the system | Actor box |
| `service` | Anything that runs and decides | Default box |
| `store` | A database, queue, bucket, cache | Store box |
| `external` | A third party you don't run | External box |
| `boundary` | A whole system drawn as one part | Dashed |
| `optional` | A part that isn't in every setup | Dashed |
| `decision` | A branch point; label the outgoing edges | Diamond; connectors leave from its vertices; no `sub`, and about half a cell's width for the label |

### Edges

Three forms, freely mixed:

```yaml
edges:
  - gw -> orders                  # string
  - app -> gw: sends token        # string with label
  - { from: gw, to: orders, label: forwards, kind: flow, about: Only after the token is valid. }
```

| Arrow | Kind | Means | Drawn as |
|---|---|---|---|
| `->` | `flow` | A call or hand-off | Solid |
| `-->` | `return` | A reply or a step back | Dashed |
| `~>` | `async` | Queued, fire-and-forget, background | Dashed, light |
| `=>` | `link` | A call out to an external system or API | Link colour |

- Only the object form takes `about`.
- The edge id is `<from>-><to>`. When the same pair is repeated, the second gets `<from>-><to>#2`, then `#3`.
- Labels are lowercase verb phrases as you write them: at most 3 words and 18 characters. Leave off the label when the arrow is obvious.

### Groups

```yaml
groups:
  core: { label: Core services, from: [2, 0], to: [4, 2], kind: zone, about: Everything our team runs. }
```

| Field | Default | Meaning |
|---|---|---|
| `label` | required | Shown as a section tag on the top border, like a fieldset legend |
| `from` / `to` | required | Top-left and bottom-right cells, both included |
| `kind` | `zone` | `zone` for plain grouping, `trust` for a security boundary |
| `about` | none | Card text |

The group box sits in the gutters around its cells, so it never touches a node. Make it cover whole nodes. Selecting a group lights its members and the edges among them.

### Scenes

```yaml
scenes:
  valid:
    title: A valid request
    path: [app, gw, orders, db]
    notes:
      gw: Token checks out.
```

- `path` lists node ids in order. The edge between each consecutive pair lights up, so an edge must exist for every pair.
- `notes` maps a node id to one line, shown when the scene reaches that node.
- Add a `steps` block to give readers controls for the scenes.

### Legend

The legend is a strip under the figure. It lists only the node kinds and edge kinds that are actually used, plus "focal" when any part is focal.

## figure with layout: sequence

Actors go across the top and messages run top to bottom.

```figure
id: signin
layout: sequence
actors:
  browser: { label: Browser, kind: actor, about: The person signing in. }
  app:     { label: Web app, about: Shows the form and holds no secrets. }
  auth:    { label: Auth service, focal: true, about: Issues and checks one-time links. }
messages:
  - browser -> app: enters email
  - app -> auth: requests link
  - auth --> app: returns session
```

- `actors` takes the same fields as nodes, minus `at` and `span`: order sets position. `kind: decision` is rejected; branch in a `states` figure instead.
- `messages` takes the same three forms and four arrows as edges. `-->` is a dashed reply.
- Messages get ids `m1`, `m2`… in order, so prose can link to one with `[checks token](#m2)`. Two sequence figures in one document would both have an `m1`, so keep one per document.
- Scene paths may mix actor ids and message ids. The 12-connector budget counts messages.

## Keys every block takes: notes, caveat, story

These feed the expanded view (`view: full`): a reading panel beside or under the figure, numbered note markers on the graph, and a step-through. Every block type accepts them.

```bar
id: signups
notes:
  - on: signups-organic-search
    text: "4,120 signups, more than paid search and social ads combined."
  - on: [signups-paid-search, signups-social-ads]
    text: "Paid channels together bring half of it."
  - Signups from the last 90 days only.
caveat: "Last-touch attribution: channels that start the journey get less credit."
story:
  - { sel: signups-organic-search, note: "Organic search leads by a wide margin." }
  - { sel: signups-paid-search, cmp: signups-organic-search, note: "Paid search brings less than a third of it." }
  - signups-partner-webinars
```

| Key | Shape | Meaning |
|---|---|---|
| `notes` | Up to 4 items: `{on: id \| [ids], text}` or plain text | Numbered notes in the reading panel. A note with `on` also gets a numbered ring marker at its target in the graph (the first `on` id the block draws) and, in the full view, a callout with its text right on the graph. Hovering a note highlights its marker and the other way round; clicking either selects the target, and the card lists the note first. Note 1 = the focal fact, note 2 = the pattern (see [writing.md](writing.md#expanded-view)) |
| `caveat` | One sentence | "What this doesn't show": the limit a careful reader would ask about |
| `story` | Steps: `{sel, cmp?, note?}` or a bare id | A walk through the block. A `steps` block with `for: <block id>` gives it controls; each step selects `sel` (and compares with `cmp`) and shows `note` as a callout in the graph |

The reading panel also holds the engine's "How to read" line and a "Data" table with Copy CSV, so every chart reads without JavaScript. The bare view hides the panel and the markers.

`check` fails a note or story step whose id doesn't exist (`note-target`).

## Keys for blocks with a scale: marks, bands, unit

Blocks with a numeric or time axis (bar, line, scatter, beeswarm, waterfall, timeline, gantt and others that say so in `references/blocks/`) also take:

| Key | Shape | Meaning |
|---|---|---|
| `marks` | Up to 2: `{y: value, label?}` or `{x: value, label?}` | Dashed reference lines. The value is a number, a date, `mean` or `median` |
| `bands` | Up to 3: `{from, to, label?, axis?}` | Shaded ranges, e.g. a target zone or a holiday week |
| `unit` | A short word or symbol | What one value counts: `signups`, `ms`, `h`, `%`, `$`. Currency symbols go before the number, the rest after; facts and deltas in the card use it |

## matrix

```matrix
id: access
title: What each part may do
corner: Action
columns: [gw, orders, { id: audit, label: Audit log }]
rows:
  - { id: read, label: Read orders, cells: { gw: yes, orders: yes, audit: no } }
  - { id: write, label: Create order, about: Only for verified accounts., cells: { gw: yes, orders: partial, audit: yes } }
```

| Key | Default | Meaning |
|---|---|---|
| `id` | required | Block id |
| `title` | none | Table caption |
| `corner` | none | Header of the row-label column |
| `columns` | required | An element id takes that element's label and highlights with it, or use `{ id, label }` |
| `rows` | required | `id`, `label`, optional `about`, `cells` keyed by column id |

Cell values: `yes` shows ✓, `no` a dim ·, `partial` ◐. Any other text is shown as written, so keep it to a word or two.

Cells are selectable with the id `<row>.<col>`. A column that names a diagram part gets the id `<matrix>.<col>`, so selecting the part and selecting the column stay two different things.

## compare

```compare
id: delivery
title: Two ways to hear about a payment
items:
  - id: polling
    label: Polling
    points:
      - Asks every 30 seconds
      - Most answers say nothing changed
  - id: webhooks
    label: Webhooks
    focal: true
    about: What we run now.
    points:
      - The provider calls us once
```

Each item has `id`, `label`, `points` (a list of short lines), an optional `focal` (the chosen option) and an optional `about`. Two or three items work best.

`dimensions: [{id, label} | name]` adds rows every item answers, with `values: {dimension: text}` per item. An item's `on: id | [ids]` links it to diagram parts, which its card lists.

## steps

```steps
for: auth
scenes: [valid, rejected]
```

`for` is a figure id, or the id of any block with a `story:`. `scenes` picks a subset and order; the default is every scene in that figure, then the block's story (scene id `<block>-story`). Renders previous, next and play controls and a scene list. The current step's note shows as a callout in the graph.

Keys while a scene plays: ← → step, Home and End jump to the first and last step, R replays from the start. With reduced motion, Play jumps to the last step.

## note

````markdown
```note warn
Tokens expire after **15 minutes**.
```
````

Tone is the first info word: `info` (default), `warn`, `danger` or `ok`. Use a tone only for real state, not decoration. The body is Markdown.

## glossary

```glossary
token: A short-lived string that proves who is calling.
idempotent: Safe to run twice with the same result.
```

Maps each term to one sentence. The block renders as a definition list where you place it. It also wraps the term in prose: see "Glossary terms" below.

## widget

````markdown
```widget selection
const p = document.createElement("p");
el.append(p);
return api.on((s) => { p.textContent = s.sel ?? ""; });
```
````

The name is the first info word and must be unique in the document. The body is a function body that runs with `el` (the widget's container) and `api` in scope, and may return a cleanup function, which runs when the page is left. See [interactions.md](interactions.md#widgets). Use a widget only for what the blocks can't express.

A widget is trusted code: it runs in every reader's browser and in the headless Chrome that `shot`, `audit`, `export` and `gallery` start. Never paste text from an untrusted source into a widget; put such strings in labels or prose, which are escaped.

## detail

````markdown
```detail
```
````

An empty block that places a copy of the card in the page, usually inside a `split`. The card itself always opens inside the figure, next to what was clicked; the `detail` block mirrors it and shows a prompt when nothing is selected.

## Containers

```markdown
::: split 2fr 1fr
```matrix
…
```
```detail
```
:::
```

- A line starting `:::` with a layout opens a container; a bare `:::` closes it. Containers can nest one level deep.
- `split` puts its children in columns. Its arguments are CSS grid tracks, one per child.
- `stack` stacks its children with block spacing.
- `sidebar` pairs main content with a narrow side column.

## Markdown and safety

Prose, `about`, notes, captions, glossary definitions and front-matter `summary` and `source` are Markdown. Raw HTML in them is shown as text, not run, and links keep only `http(s):`, `mailto:` and `#` targets; anything else (`javascript:`, `data:`) becomes a dead link. Labels are always plain text. So text from an untrusted source is safe anywhere except inside a `widget`.

## Prose links and glossary terms

- `[text](#id)` where `id` is any element id (node, edge, group, matrix row or column, compare item) becomes a live reference. Hovering it highlights the element; clicking it selects it. Edge ids work too: `[sends it back](#review->draft)`.
- `[text](#a+b)` selects `a` and compares it with `b`: "[Mobile passed web in April](#wau-mobile-3+wau-web-3)" opens the A-vs-B card with the difference.
- The whole sentence around a link is linked too: selecting a mark highlights every sentence that points at it. So link the claim, not just the noun: "[Organic search brought 4,120 signups](#signups-organic-search)".
- Links to ids that don't exist fail `ref-exists`. Ordinary `#heading` links still work, and never change the page state.
- Glossary terms are wrapped automatically: the first occurrence in each prose segment, whole words, case-insensitive. Hovering or focusing the term shows its definition. Don't mark them up yourself.

## Ids

Element ids are unique across the whole document: nodes, edges, groups, matrix rows, compare items, and sequence messages. Use short lowercase words (`gw`, `orders`, `edit-text`). A matrix row can't reuse a node's id; pick a name for the row itself.

## Grid geometry and label limits

The default theme: `unit` 8, cell 160 × 64, gaps 104 (x) and 48 (y), padding 32.

- A cell's origin is `x = 32 + col × 264`, `y = 32 + row × 112`.
- A node spanning n columns is `n × 160 + (n − 1) × 104` wide.
- Figure width is `cols × 160 + (cols − 1) × 104 + 64`.
  - 3 columns: 752px
  - 4 columns: 1016px
  - 5 columns: too wide for the 1232px column (1280 window), so the figure narrows its column gutters to about 100px and fits. Zones, level tags and routes around the outside narrow them a little more
  - 6 or more columns: warns (`budget-nodes`) when even 64px gutters don't fit; the figure scrolls sideways. Use fewer columns or split it
- Figures never scale: text stays 13px. A narrowed gutter holds a shorter connector label, so `check` may warn (`edge-label`) on a long label in a 5-column figure.
- On a narrow page, keep to 3 columns.
- The legend adds about 48px under the grid.
- Connectors run only in the gutters. Leave an empty cell where a connector must turn around a node.

| Text | Limit |
|---|---|
| Node label | About 18 characters for a 1-column node; more for each extra column spanned. `check` computes the exact limit from the theme |
| Node `sub` | Shorter than the label. A port, version or count |
| Connector label | At most 3 words and 18 characters |
| `about` | 1–2 sentences. Must not start by repeating the label |
| Any sentence | 25 words, 20 in an instruction. See [writing.md](writing.md#plain-technical-english) |

## Lint rules

`check` prints `file:line rule message`. The rules:

| Rule | Fires when |
|---|---|
| `spec` | A block can't be parsed or has an unknown field |
| `id-unique` | Two elements share an id anywhere in the document |
| `ref-exists` | An edge, scene, matrix column, `steps.for` or prose link points at a missing id |
| `grid-collision` | Two nodes occupy the same cell |
| `grid-bounds` | A node or group sits outside the grid |
| `budget-nodes` | A figure has more than 9 nodes |
| `budget-edges` | A figure has more than 12 connectors |
| `budget-focal` | A figure has more than 2 focal elements |
| `label-fit` | A node label is longer than its cell holds |
| `edge-label` | A connector label is over 3 words or 18 characters |
| `about-missing` | A node has no `about` |
| `about-repeats` | An `about` starts with the label |
| `about-thin` | A node or actor `about` has fewer than 12 words: it names the part again rather than explain it |
| `sentence-long` | A sentence in prose, an `about`, a note, a step note, a caveat, a point or a definition has more than 25 words (ASD-STE100 allows 20 in an instruction, 25 in a description) |
| `label-duplicate` | Two elements show the same label |
| `route` | A connector couldn't be routed cleanly. Move a node |
| `note-target` | A note's `on` or a story step points at an id that doesn't exist |
| `ref-focal` | A focal element is never linked from prose or a note (warning) |
| `claim-unlinked` | A sentence with a number, right before or after a block, links to no mark (warning) |
| `link-implied` | Wardley: a link the value chain already implies (`a -> c` while `a -> b -> c` exists) |
| `link-bundle` | Wardley: two links meet one dot less than 4° apart |
| `link-near-dot` | Wardley: a link passes within 6px of another component's dot or ghost |
| `move-boundary` | Wardley: a `moving_to` ghost sits on a stage boundary |
| `move-left` | Wardley: `moving_to` is left of `evolution` |
