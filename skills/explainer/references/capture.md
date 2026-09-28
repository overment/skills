# Capture

Images of any state, editable SVG, a pre-flight audit, and a gallery. `shot`, `export`, `audit` and `gallery` need Chrome. They use `CHROME_PATH`, then the usual install locations, and print a clear error when none is found. Ctrl-C (or SIGTERM) at any point closes the headless Chrome and removes its temporary profile.

Documents, widgets included, are trusted code: these commands run them in headless Chrome with `file://` access. Never capture a document built from untrusted text.

## shot: PNG of a figure or page

```sh
bun <skill-dir>/scripts/explainer.ts shot doc.md --figure auth --state "sel=gw&theme=dark" --scale 2 --out auth-gw-dark.png
```

- Given a `.md`, it builds first. Given an `.html`, it uses that file.
- `--figure <id>` captures that figure (or a matrix or compare block by its id); `--page` captures the whole page. With neither, the first figure.
- `--state` is the URL hash without `#`, in the same keys as the page (see [interactions.md](interactions.md)): `sel`, `cmp`, `hide`, `range`, `scene`, `step`, `theme`, `view`. `capture=1` is added for you. A key shot doesn't know is reported, and so is a `sel` that selected nothing.
- `--view bare|full` sets the view (it wins over `view=` in `--state`).
- `--width` is the window width (default 1280). The card's position depends on it, so the same width always gives the same image.
- It waits until fonts are loaded and the state is applied, so the image is the same on every run.
- Tooltips, focus rings and the steps bar are hidden. The card, its leader, the selection rings and the step note stay.
- The background is the theme's page colour, not transparent.

The figure crop is everything that belongs to the figure on screen:

- the figure and its `.x-stage`;
- the open card (`.x-pop`), even where it sticks out of the figure;
- the note markers and, in the full view, the note callouts;
- with `--view full`, the reading panel (`.x-reading`);
- while a scene is on, the steps and their note.

Boards wider than the column (storymap, swimlane) are captured whole, not cut at the scroller's edge.

| `--state` | Shows |
|---|---|
| `sel=gw` | The gateway selected: its card open, its relations lit, the rest dimmed |
| `sel=a&cmp=b` | A compared with B: both rings and the A-vs-B card |
| `hide=mobile,web` | Those series hidden through the legend, scales unchanged |
| `scene=valid&step=2` | The third step of scene `valid`, with its note |
| `theme=dark` | Dark mode |
| `view=full&sel=orders` | The expanded view (reading panel, note markers) with Orders selected |
| (empty) | The resting state, nothing selected |

| `--scale` | For |
|---|---|
| 1 | Thumbnails, previews, chat messages |
| 2 | Docs, READMEs and slides (the usual choice) |
| 3 | Print |

When the user asks for "the diagram as an image", capture the figure, not the page. Name files after their state (`auth-gw-dark.png`) when taking several. For a series (one image per step), run `shot` once per `step`.

## export: standalone SVG

```sh
bun <skill-dir>/scripts/explainer.ts export doc.md --figure auth --mode dark -o auth-dark.svg
bun <skill-dir>/scripts/explainer.ts export doc.md --figure auth --state "sel=gw&theme=dark" -o auth-gw.svg
```

This writes the figure as an SVG with the computed styles inlined, so it looks right in Figma, Keynote or anywhere else without the page's CSS. `--mode` picks the colours (or `theme=` in `--state`). Without `--state` the file is the resting figure.

With `--state` the state is baked in:

- the selection, related and dimmed looks;
- the selection rings;
- the open card, drawn as an SVG group of rects and text. The viewBox grows to fit the card.

The `is-*` classes stay on the elements as a record of the state. Hidden hover-only parts are left out.

Use `export` when the user wants to edit or restyle the figure, and `shot` when they want to paste it.

## audit: check before handing over

```sh
bun <skill-dir>/scripts/explainer.ts audit doc.md
bun <skill-dir>/scripts/explainer.ts audit templates/*.md --state "sel=orders&view=full"
```

It opens the built page in headless Chrome and checks several states, each in light and dark, bare and full:

- at rest;
- with the first focal element selected;
- with the first non-focal element that has relations selected;
- every state listed in front matter `shots:`;
- every `--state` you pass.

`shots:` is one hash, or a list of hashes or `{ state, name }` items, or a map of name → hash. A state that names its `theme` or `view` runs only in that one.

It prints one line per check: `✓` passed, `✗` failed (with each problem and the states it showed in), `–` skipped because the page had nothing to test. A skipped check is never reported as passed. It exits 1 on any failure. `--json` prints the results as JSON.

| Check | Fails when |
|---|---|
| ready | the page never sets `html[data-ready="1"]` in some state |
| console | there are console errors or uncaught exceptions |
| overflow | a label is wider than the box or shape it sits in (nodes, bars, cells, table rows) |
| text clipped | a `<text>` runs outside its svg, or text is cut off, clamped or ellipsised by an overflow box (card rows included) |
| engine ellipsis | a text ends in `…` that the Markdown source doesn't contain, so the engine cut it short (an ellipsis inside a sentence is prose) |
| masks | a connector label's backing covers a node or mark, or a schema/uml connector label or multiplicity covers a table or class box |
| line clipped | a connector or series line runs outside its svg |
| label overlap | two labels in a figure draw over each other (a second copy of the same text at the same spot, a halo, doesn't count) |
| callout × line | an in-graph callout box (full view) sits on a connector, or its leader crosses a connector the note isn't about. Callouts the open card hides don't count |
| label × line | a label is crossed by a connector, series line, bone or structure path that isn't its own (checked segment by segment against the glyphs' box; lines hidden under an opaque shape behind the label don't count) |
| text size | a visible text renders below 13px: svg text is measured after the figure's scale, HTML text by its computed size |
| figure wider than column | a figure, stage or block is wider than the page column, or the page scrolls sideways |
| interaction | clicking one element of each selectable type (node, edge, edge label, card, table or class box, column or member row, mark, legend item, group label, table row and column, compare item) selects nothing, leaves something in its figure neither lit nor dimmed, opens no card (except a connector with no `about`, facts or relations beyond its ends, which opens none on purpose) or a card that doesn't name it, or Esc doesn't clear it |
| card covers selected | the open card hides any of the selected element |
| card covers related | the open card hides more than 25% of what the selection lights up |
| related undimmed | something the selection relates to (or keeps as context) is dimmed |
| dimmed contrast | dimmed text is under 3:1 against what is actually behind it (opacity, fill-opacity and desaturation included) |
| ring | the selection has no ink ring (or outline) at 3:1, or the ring is the accent colour. A selected line (series, connector) keeps its hue: it needs its bg halo and 3:1 instead. Before the page has a ring layer, only focal selections are judged: they fail when they keep the accent they have at rest |
| relation wording | a relation chip in the card names both of its endpoints ("Security review → Public launch  Public launch"). Names match whole, so "Extended by CardPayment" on Payment is fine |
| contrast | `text` and `text-dim` are under 4.5:1 on `bg` and `surface`, `text-faint` under 3:1 on `bg`, or a tone ink under 4.5:1 on its tint, in light or dark |
| no-js | with JavaScript off, a figure has no size or content is hidden (buttons, which need JavaScript anyway, may hide) |

`check` catches what can be known from the source. `audit` catches what only shows in a browser. Run both before calling the work done.

## gallery: every template at a glance

```sh
bun <skill-dir>/scripts/explainer.ts gallery /tmp/gallery --open
```

For each template (and each `--src` document) it writes the HTML page and:

| File | Shows |
|---|---|
| `<name>-bare-{light,dark}.png` | the first figure at rest |
| `<name>-full-{light,dark}.png` | the top of the page with its text |
| `<name>-sel-{light,dark}.png` | the figure with its focal element (or the first element with relations) selected, card open |
| `<name>-read-light.png` | the expanded view: the figure with its reading panel and note markers |
| `<name>-<block>-{light,dark}.png` | each matrix and compare block that isn't the first figure |

`index.html` shows rest, selected and expanded side by side for every document, with light/dark and diagram/with-text toggles.

## Dark mode

- Pass `theme=dark` in `--state` for `shot`, and `--mode dark` (or `theme=dark` in `--state`) for `export`.
- `build --mode dark` or front-matter `mode: dark` only sets the page's starting theme. Readers can still toggle.
- When the user wants both, capture both and say which is which.
