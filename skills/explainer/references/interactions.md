# Interactions

What readers can do with a built page, and how widgets hook in. The engine wires all of it. You only choose ids, `about` text and scenes.

## State

The whole page state is these keys:

| Key | Type | Meaning |
|---|---|---|
| `sel` | id or null | The selected element. Its card opens next to it |
| `cmp` | id or null | A second element to compare with `sel` (compare mode) |
| `hide` | list of ids | Series or groups hidden through the legend. Scales stay fixed, so hiding never rescales a chart |
| `range` | `figure,from,to` or null | A brushed range on a figure that opts in (a timeline) |
| `hover` | id or null | The element under the pointer or focused (not in the URL) |
| `scene` | id or null | The active scene or story |
| `step` | number | Index into the scene, starting at 0. The counter shows step + 1 |
| `theme` | `light`, `dark` or null | null follows the front-matter `mode`, then the OS |
| `view` | `bare`, `full` or null | null follows the front-matter `view` |

The state is mirrored into the URL hash without adding history entries, so every state is linkable and capturable:

```
page.html#sel=gw
page.html#sel=wau-mobile-3&cmp=wau-web-3
page.html#hide=wau-desktop&theme=dark
page.html#scene=valid&step=2
page.html#sel=orders&view=full&capture=1
```

Unknown keys are ignored. A hash with no known key (an ordinary `#heading` link) scrolls and leaves the state alone. `capture=1` is for screenshots: no transitions, no tooltip, no focus rings, no controls or steps bar; the card, its leader and a step's callout stay.

## Tiers: selected, related, context, dimmed

Selecting something sorts every element of the figures it appears in into four tiers:

- **Selected:** an ink ring (`--x-text`, 2px) 3px outside the mark, over a `--x-bg` gap, so it reads on any fill. Lines, bands and sectors are redrawn on top in their own hue, 1.5px heavier, with a background halo, so a selected series is never hidden under the ones it crosses. Its own label turns ink and semibold. A focal mark keeps its accent fill.
- **Related:** full strength, no ring: the connectors and the parts at their other ends, a group's members, a mark's series, and the ids in the engine's `related` and `links`. Node frames and connectors get a step stronger.
- **Context:** the rest look, never dimmed: what belongs with the selection for comparison (a heatmap cell's row and column, the other points of a series), from the engine's `context`.
- **Dimmed:** everything else in the same figure. Shapes lose fill and stroke strength and saturation; their text turns `--x-dim-text` (3.6:1 or better), so dimmed labels stay readable. A label drawn on a dimmed fill (a heat cell, a tile, a level) gets the quietest theme ink that keeps 3:1 on that fill. HTML items (cards, cells, compare items) keep their surface and swap their text to `--x-dim-text`; they are never faded with opacity. A dimmed focal keeps a full accent stroke over a lighter fill: still the author's point, never louder than the selection.

Only figures (and blocks, and the matrix or compare table) that hold a lit element dim. Other figures and the prose stay as they are. Compare mode adds a dashed ink ring on `cmp` and lights its relations too. Hover never dims.

The values are theme tokens (`--x-dim-fill`, `--x-dim-stroke`, `--x-dim-sat`, `--x-dim-focal`, `--x-sel-ring`, `--x-sel-gap`, and the derived `--x-dim-text`), lighter in dark mode so context stays legible.

## Clicking and hovering

- **Click** a mark, node, connector, legend entry, header, prose link or chip: select it (click again, click empty canvas, press Esc or × to clear; Esc clears `cmp` first).
- **Shift-click or ⌘-click** a second element: compare it with the selection. The card's **Compare** action does the same with the next click.
- **Alt-click** a legend entry: hide that series (click it again to bring it back). **Double-click** a legend entry: show only it. Hidden series are listed under the figure as "Hidden: Web ×".
- **Hover or focus** shows a tooltip above the element (its `say` line: label, value, first fact) and a dashed ring on it and its direct relations. Nothing dims, so the page never flickers. Moving between neighbours doesn't flash (80 ms leave delay). Touch devices skip hover.
- **Hovering a prose link or a linked sentence** previews every id it names. Hovering a note marker highlights its note in the reading panel, and the other way round.
- **Drag** across a figure that opts in (`data-brush`, the timeline's date strip): select a range. Items inside it light up, the rest dims, and the count is announced.

## The card

A click opens a card inside the figure, next to the element, with a thin leader line to it (a caret when they nearly touch). It never covers the selected element, and it tries hard not to cover what the selection lights up or any label: when no spot beside the element is clear, it docks in a right gutter (the plot shrinks a little, its layout doesn't change) or under the figure. A docked card draws no marker of its own: the ink ring already shows what it is about, and the card's title names it. On screens under 640px it always docks under the figure. Its position depends only on the layout and the window width, so `shot` always shows the same card.

What it shows, top to bottom. Each line has to tell a reader who just joined something the canvas doesn't:

- **Eyebrow,** only when the kind means something: `Data store · hub`, `Trust boundary`, `Critical`, `Step 3 of 5`, `Message 4 / 8 · reply`. A word that only names what was clicked (bar, point, cell, tile, plain flow) is left out, and so is a count like "5 of 7", except where the order is the point (steps, stages, messages).
- **Breadcrumb** for nested things (`Data › Primary database`), then the **title**. A connector's title is its two ends, each a link.
- **Value** with its unit, never a repeat of the title.
- **About:** the author's description, first, because it is what the reader came for: what the part does, why it is there, what to watch.
- **Note:** when a reading-panel note points at the element, it follows with its number in the same ring the canvas marker uses; the canvas callout steps aside while the card shows it.
- **Facts:** up to 5 computed rows (rank, share, delta, slack, conversion). A fact that names another element links to it. Each thing is said once: a fact that repeats the value, the kind in the eyebrow, the `about` sentence or the relations below it is left out. A value too long for the rest of its line moves under its key rather than squeeze it.
- **Relations:** the engine's semantic groups ("Waits for", "Flows to", "Referenced by"), or else the connectors in reading order, in the author's words ("confirms ←", "charges card →"; an unlabelled one says "From" or "To"). A relation to one part is one row, words left and name right; several parts under the same words share a heading. A relation to only the breadcrumb or an edge's own ends is left out. Names are links in the page's one link style, not boxes; they wrap and are never truncated.
- **Actions,** only the ones that do something here: ‹ Back (after following a link; up to 8 steps), Compare (only on marks with a number, where it computes a difference), Hide (series with a legend entry), Play from here (when the element is in a scene). The address bar already holds the state, so there is no "Copy link". The prose sentences about the element light up on the page, so the card does not quote them.

A card that would say nothing the canvas doesn't (a connector with no `about`, no facts and no relations beyond its two ends) does not open: the ring and the dimming already show what was picked.

In compare mode the card shows A vs B: both values and every fact they share, with the difference ("46k vs 45k, +1k"). A `detail` block elsewhere on the page mirrors the card.

## Keyboard

| Key | Does |
|---|---|
| Tab | One stop per figure (the last mark you were on), then the card's chips and actions when a card is open, then on to the next figure |
| Arrow keys | Move between marks. Engines give an order with `data-nav="row,col"` (bars ↑↓, line ←→ along x and ↑↓ across series, heatmap and boards as a grid); otherwise the nearest mark in that direction |
| Home / End | First and last mark in the figure |
| Enter or Space | Select the focused mark and open its card; focus stays on the mark (`aria-expanded`) |
| Shift+Tab from the card's first chip | Back to the mark |
| Esc | Close the card (compare first) and return focus to the mark |
| ← → with a scene playing | Previous or next step; Home, End and R jump to the first step, the last step or replay |
| `t` | Toggle the theme when focus isn't in a text field |

A polite live region announces what was selected: the engine's `say` line, "Newsletter, 930 signups, 5th of 7, 8.8% of total", or the step and its note.

## Prose and graph

- Every sentence that holds a link is linked as a whole. Selecting a mark highlights the sentences that point at it, and only those; the page itself never scrolls because of a graph click.
- `[claim](#a+b)` selects `a` and compares it with `b`.
- When the figure sits beside its reading panel, the panel scrolls its own list to the note about the selection.

## Expanded view: the reading panel

In the full view, every block with notes, a caveat, a "How to read" line or data gets a reading panel: beside the figure (280px, sticky) when the block is 1100px wide or more, under it otherwise. It holds:

1. **How to read:** the engine's one or two sentences on the encodings.
2. **Notes:** up to four, numbered like their markers on the graph.
3. **What this doesn't show:** the caveat.
4. **Data:** the block's numbers as a table (a closed `<details>`), with Copy CSV.

The bare view hides the panel and the note markers. The panel is plain HTML, complete without JavaScript.

### Annotations on the graph

In the full view every note is also shown on the graph at once, as a small callout with its number, joined to its marker (or to the marks it is about) by a thin line. Callouts are placed once per layout, so they never jump when the selection changes: inside the figure, never over the marks their note is about, never over another callout, and off labels and value labels. Where the card would dock in the gutter right of the figure, callouts keep out of that column so the card never hides them, and a callout may sit in a lane under the figure instead (the figure grows by that lane). A note that finds no clean spot keeps its marker and stays in the reading panel. While something is selected, callouts about it stay lit and the others step back; a callout under the open card steps aside until the card closes. Hovering a callout highlights its marker and panel entry; clicking it selects what it points at.

The bare view shows no callouts: clicking an element opens its card, which lists the note first.

## Scenes, stories and steps

A `steps` block drives the scenes of a figure, or the `story:` of any block. At step k of a figure scene, the nodes before k are done (related look), the node at k is active (selected look), the connectors between them are lit and everything else dims. A story step selects its `sel` (and compares its `cmp`). The step's note shows as a callout in the graph, next to the element, and is announced. Play advances every 1.6 seconds; with reduced motion it jumps straight to the last step.

## Theme and view

The theme starts from the URL `theme`, then the front-matter `mode` (unless `auto`), then the OS setting. The toggle in the header, or `t`, flips it. The view starts from `#view=`, then front-matter `view`. Printing always uses light colours and hides controls and the card's actions.

## Without JavaScript

The built page is complete without scripts: every figure is visible and undimmed, the reading panels and their data tables are there (`view` and a fixed `mode` are written into the page, so the bare view and the theme apply too), the steps bar is hidden, and prose, matrix, compare and glossary read normally. Nothing shifts when the script starts.

## Engine contract

What block engines hand the client, and the class names the client and `base.css` key on. Engines emit geometry, classes and model data only. `base.css` owns every state rule; block CSS may set custom properties and per-type related looks, but never overrides the ring or the dimming.

Emit your figure through `kit.svgFigure` or `kit.htmlFigure`: they put the svg or board in the figure's `.x-stage`. A figure without one gets a stage from the client at start-up.

### Model fields

Every `model()` entry (`ElementInfo`) may carry, besides `label`, `value`, `about`, `related`:

| Field | Shape | Meaning |
|---|---|---|
| `facts` | `{k, v, ref?, tone?, raw?}[]` | Up to 5 computed card rows, most important first. `ref` makes the row a chip that selects that id. `tone` is `up`, `down` or `flat`. `raw` keeps the number for compare mode |
| `links` | `{rel, ids, inverse?}[]` | Semantic relation groups ("References", "Waits for", "Flows to"). When present they replace the edge-derived rows. `inverse` names the reverse relation: the back-link pass adds `{rel: inverse, ids: [this]}` to every target and puts this id in the targets' `context` |
| `context` | `id[]` | Ids that stay at rest (never dimmed) while this is selected: the heatmap row and column, group siblings, a series' other points |
| `pos` | string | Eyebrow position: `5 of 7`, `critical`, `3 / 7` |
| `crumb` | `id[]` | Ancestors for the breadcrumb, outermost first |
| `say` | string | One line for the aria-live region and the hover tooltip: `Newsletter, 930 signups, 5th of 7, 8.8% of total` |
| `aboutHtml` | string | `about` as sanitised inline HTML, built at build time. The client never renders raw `about` as HTML |

A module may also export `reading(block)`, the "How to read" line, and `table(block)`, `{head, rows}` for the Data section and Copy CSV.

After every `model()` has run, core does two passes:

- **about → aboutHtml.** `about` is rendered once, through the same Markdown renderer as the page with raw HTML off, into `aboutHtml`. Whatever an engine put in `aboutHtml` is replaced. The card inserts nothing else as HTML.
- **Back-links.** For each `links` entry with an `inverse`, every target gets `{rel: inverse, ids: [source]}`, and the source plus the source's other targets go into the target's `context`. Declare a relation once, on the side that owns it (a change card's `causes`), and the other side (the event) gets "Explained by" for free, in any block type.

A block with a `story:` gets a scene `<block id>-story` in the model, with `story` holding the steps.

### Shared block keys

Any block may accept these. Parse them with the kit so every block reads them the same way, and list them in the block's allowed keys (`READING_KEYS`, `SCALE_KEYS`).

| Key | Parsed by | Shape |
|---|---|---|
| `notes` | `parseNotes` | Up to 4 of `{on: id or [ids], text}` or plain text (no marker) |
| `caveat` | `parseCaveat` | One sentence: what the figure doesn't show |
| `story` | `parseStory` | Steps `{sel, cmp?, note?}` or bare ids |
| `marks` | `parseMarks` | Up to 2 reference lines `{y: value, label?}` or `{x: value, label?}`; value is a number, a date, `mean` or `median` (`markValue` resolves the last two) |
| `bands` | `parseBands` | Up to 3 ranges `{from, to, label?, axis?}` |
| `unit` | `parseUnit` | What one value counts: `signups`, `ms`, `%`, `$` |

### Kit helpers

- Facts: `rank(v, values)` gives `5 of 7` and `5th of 7`; `share(part, total)` gives `8.8%`; `delta(v, ref, unit?)` gives `−3,190`; `ratio(v, ref)` gives `4.4×`; `signed(v, unit?)` gives `+1,200`; `fmtUnit(v, unit?)` gives `930 signups`, `$1.2k` or `3.5 s`; `pct(v)`, `ordinal(n)`, `trend(d)`, and `factList(rows)`, which drops empty rows and keeps 5. Negatives always use a true minus (−). Percentages keep one decimal below 10%.
- `itemInfo` and `groupInfo` accept `facts`, `links`, `context`, `pos`, `crumb` and `say` (and `groupInfo` takes `value`).
- `refLine(frame, {x} | {y}, label?)` and `refBand(frame, {x: [a, b]} | {y: [a, b]}, label?)` draw reference rules and ranges at pixel positions.
- `notes(block, anchors, {obstacles?, bounds?})` places the numbered note markers at the least-covered corner of each target's anchor box.
- `onSel(svg)`, `onRel(svg)` and `onHover(svg)` wrap children that show only in that state. Pass `true` as the second argument inside HTML marks.
- `stageWrap(inner)` is the positioning box for the card and overlays; `svgFigure` and `htmlFigure` call it for you.

### Class names and attributes

| Name | On | Meaning |
|---|---|---|
| `is-selected` | mark, node, edge, row, ref | The selection (ink ring, not accent) |
| `is-related` | same | Directly related to the selection: full strength |
| `is-context` | same | Belongs with the selection for comparison: rest look, never dimmed |
| `is-dimmed` | same | Everything else inside a figure that holds a lit element |
| `is-hover` | same | Pointer or focus preview: dashed ring, no dimming |
| `is-cmp` | same | The second element in compare mode: dashed ink ring |
| `is-step-active`, `is-step-done` | same | Scene and story steps |
| `is-linked` | `.x-sent` | A prose sentence whose ref is selected |
| `.x-stage` | wrapper around a figure's svg or board | Positioning box for the card, leader and overlays |
| `.x-pop` | last child of `.x-stage` | The in-figure card, `role=dialog` |
| `.x-scroll` | first child of `.x-stage` | The horizontal scroller around the svg or board; the card and leader sit outside it, so it never clips them |
| `.x-sel-layer`, `.x-sel-ring` | last group of the svg | Ring clones for the selection. `.x-sel-under` is the bg gap under a ring; lines and filled paths get `.x-sel-halo` + `.x-sel-clone` / `.x-sel-outline` (also `.x-sel-ring`). Variants: `.x-ring-cmp` (dashed), `.x-ring-hover` (1px dashed) |
| `.x-leader` | svg overlay in `.x-stage` | The leader line and dot, or the caret |
| `.x-anchor` | a part inside a mark | Where the card and note markers point. Fallbacks: a connector's label, else the middle of its path; a series line's end; a wide bar's value end, a tall bar's top; else the bbox of `.x-mark-shape` or `.x-node-box`. An id with no mark of its own points at the union of its members' marks |
| `.x-on-sel`, `.x-on-rel`, `.x-on-hover` | children of a mark | Hidden until the mark is selected, related or hovered |
| `.x-ref-line`, `.x-ref-rule`, `.x-ref-label` | svg group | Reference line from `refLine`, `data-axis` x or y. Not `.x-ref`, which is a prose reference link |
| `.x-ref-band`, `.x-ref-band-fill` | svg group | Shaded range from `refBand` |
| `.x-notes`, `.x-note-marker`, `.x-note-ring`, `.x-note-num` | svg group | Note markers from `notes()`. Each marker has `data-note` (its number) and `data-for` (target ids). Hidden in the bare view |
| `.x-read`, `.x-reading` | section, aside `data-for=fig` | Figure plus its reading panel in the full view |
| `.x-callouts`, `.x-callout`, `.x-callout-line` | layer in `.x-stage`, box `data-note data-refs` | The annotation layer: each note as a callout on the graph (full view). Placed by `placeCallouts()` in `scripts/client/place.ts` |
| `.x-data` | `<details>` in the reading panel | The `table()` data with Copy CSV |
| `.x-sent` | span with `data-refs="a b"` | A prose sentence that contains refs |
| `data-nav="r,c"` | mark | Arrow-key order |
| `data-say` | mark | Fallback say line; the model's `say` wins |
| `data-brush` | svg element | Opts into the brush: dragging across it maps its x span onto `data-min`..`data-max` (or `data-domain="from to"`), numbers or ISO dates |
| `data-at`, `data-span` | mark | Where a mark sits on the brush axis: `data-at="v"`, `data-at="a..b"` (b exclusive) or `data-span="a b"` |
| `is-hidden`, `is-off` | mark, legend entry | Hidden through `hide=`; the legend entry stays, struck through |

### Tone tokens

`--x-ok-ink`, `--x-warn-ink` and `--x-danger-ink` are tone text colours. `--x-ok-tint`, `--x-warn-tint` and `--x-danger-tint` are the matching washes: by default the tone at 12% over `surface`. The theme loader moves each ink toward `text` until it reaches 4.5:1 on its tint, in both modes. Pair a tone with a word or symbol (WAS/NOW, ✓ PASS). Hue alone never carries the meaning. Tone is not focal: focal stays `--x-accent`.

## Widgets

A widget is a small script for what the blocks can't express: a slider that sets a value, a live counter, a toggle between two scenes. The body runs once with:

- `el`: the widget's container.
- `api`: the page's `explainer` object.

The body may return a cleanup function; it runs when the page is left. Each widget name may appear once per document (`check` fails a repeat).

Widgets are trusted code. They run in every reader's browser and in the headless Chrome used by `shot`, `audit`, `export` and `gallery`. Never paste text from an untrusted source into a widget body.

| `api` member | Does |
|---|---|
| `api.model` | Everything known about the document: `elements` (id → label, kind, value, about, facts, links, figure, from/to, members), `scenes`, `glossary` |
| `api.get()` | Returns the current state |
| `api.set(patch)` | Merges a partial state, e.g. `api.set({ sel: "gw" })` or `api.set({ sel: "a", cmp: "b" })` |
| `api.on(fn)` | Calls `fn(state, prev)` on every change and returns an unsubscribe function |
| `api.select(id)` | Selects an element, or clears the selection with `null` |
| `api.scene(id, step)` | Starts a scene at a step, or stops scenes with `null` |

Example: show the selected node's label.

````markdown
```widget selection
const line = document.createElement("p");
el.append(line);
const show = (s) => {
  const e = s.sel ? api.model.elements[s.sel] : null;
  line.textContent = e ? `Selected: ${e.label}` : "Select a part of the diagram.";
};
show(api.get());
return api.on(show);
```
````

Widgets get no styling of their own beyond the theme's variables. Use `var(--x-text-dim)`, `var(--x-accent)` and the other `--x-*` tokens rather than colours.
