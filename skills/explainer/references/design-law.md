# Design law

Laws every explainer page follows. `base.css`, the renderers and `check` enforce most of them; the rest are on you, the author.
Each law carries one line of rationale. When two laws conflict, the earlier section wins.

## 1 · Principles

- **P1 Conclusion first.** The first sentence states the model; the figure proves it; detail waits behind selection.
  A reader who stops after any section is still right.
- **P2 Squint test.** At a glance each view shows one focal point and a legible group structure.
  If everything is loud, nothing is.
- **P3 Weakest sufficient tool.** Separate things with whitespace → alignment → tint → hairline frame, in that order.
  Every stronger tool you skip is noise you did not add.
- **P4 Structured density.** Compress hard, but every compression adds structure (row, label, notation), never just smaller text.
  Density is fine; undifferentiated density is the failure.
- **P5 Show, then tell.** Try a matrix or compare first, then a figure, then a sentence.
  Prose is the fallback, not the default.
- **P6 One source of emphasis.** Focus comes from dimming the rest, never from making the target louder.
  Loud targets compete; dimmed context cooperates.

## 2 · Tokens & color

- **T1 Roles, not colors.** Style only through `--x-*` tokens; raw hex lives only in theme JSON.
  Swapping a theme must never require touching markup or CSS.
- **T2 Hue = meaning, lightness = hierarchy.** Never put both jobs on one axis.
  Mixed axes make every difference ambiguous.
- **T3 One accent, and it means focal.** `--x-accent` marks the author's point (the ≤2 focal elements), nothing else: not links, not selection.
  Selection is ink (`--x-text`), never accent: a selected mark and the focal mark must never look alike.
- **T4 State hues are for state.** `ok / warn / danger / info` appear only on notes, boundary nodes and real status.
  A red heading reads as an error.
- **T5 60-30-10.** Canvas dominates, surfaces support, saturated color stays under ~10% of the view.
  Saturation is a budget; spend it on meaning.
- **T6 Derived tints.** Fills are `color-mix(in oklab, <token> 8–12%, var(--x-surface))`, frames `color-mix(<token> 40%, transparent)`.
  Invented in-between colors drift out of both modes.
- **T7 Every color earns its place.** A color appears at least twice or has a legend entry.
  A one-off color is noise the reader tries to decode.
- **T8 Redundant encoding.** Color never carries meaning alone; pair it with a label, dash pattern or position.
  Survives color blindness, grayscale print and screenshots.
- **T9 Contrast.** `text` and `text-dim` reach 4.5:1 on `bg` and `surface` in both modes; `text-faint` 3:1, and only for non-essential marks.
  Dimmed labels use `--x-dim-text`, which the theme derives at 3.6:1 or better on `bg` and `surface` (3.5:1 on `surface-2`). `audit` fails the page otherwise.

## 3 · Typography

- **Y1 Two faces, mono only for code.** The sans sets everything a reader reads: prose, every diagram label, tags, numbers, the card. Mono is for `code` and identifiers written as code (schema columns and types, hashes).
  Mono labels next to sans prose read as a second voice; a third face is decoration.
- **Y2 Four sizes, nothing under 13px.** `13 small · 15 body · 19 h2 · 26 h1`, weights 400 and 600. Every diagram role (node label, sublabel, connector label, tick, legend, value) is on the small step, and so are tags, captions, the card body and callouts.
  Figures render 1:1 (S6), so the theme size is the size on screen; the theme loader rejects smaller sizes and `audit` fails text that renders below 13px.
- **Y3 Weight and color before size.** A heading one step up in `--x-text` beats one three steps up. In a figure the primary label is 13/600 `text`, everything else 13/400 `text-dim`.
  Size jumps break rhythm; weight keeps it.
- **Y4 Section tags are sentence case.** Block and figure titles, reading-panel keys, card relation keys, board heads, legend, axis titles and group labels: 13/600, `--x-text-dim`, no uppercase, no tracking.
  Uppercase letter-spaced mono is a third text style; weight and colour already mark a tag.
- **Y5 Two label levels.** Section tag (600, `text-dim`) and in-panel label (400, `text-dim`); never equal weight.
  Identical labels at different scopes flatten the structure.
- **Y6 Measure.** Paragraphs 45–68ch; line-heights on 4px: 20 small, 24 body, 28 h2, 32 h1.
  Long lines lose the return sweep.
- **Y7 Tabular numerals** wherever numbers align (matrices, step counts, sequences, card facts).
  Proportional digits wobble in columns.
- **Y8 One link style.** Every link in prose (external, a reference to the graph, a glossary term) is text colour with a 1px `text-faint` underline; ink on hover; a 2px ink underline while it points at the selection. No accent links, no dotted variants, no sentence tint.
  Three link treatments make the reader decode which is which.

## 4 · Grid & spacing

- **S1 Everything sits on the theme grid.** Nodes occupy cells (`cell 160×64`, `gap 104×48`, `pad 32`); never hand-place coordinates.
  One grid keeps every figure in the document visually related.
- **S2 Gutters are for connectors.** Nothing but lines and their labels lives in the gaps between cells.
  Crowded gutters are where routing fails.
- **S3 8px rhythm.** Spacing is 8, 16, 24, 32 or 48 (4 only inside controls); blocks sit 32px apart.
  A shared rhythm reads as order without any rule lines.
- **S4 One flow axis.** Lay the happy path along one row (left→right) or column (top→bottom); branches go perpendicular.
  Two axes make the reader search for the start.
- **S5 Groups wrap cells, not pixels.** Zones span `from..to` cells and stay inside the gutters.
  A zone that touches a node reads as that node's border.
- **S6 One column, figures 1:1.** The page column is at most 1280px (1232 at a 1280 window); prose keeps 68ch from its left edge, figures start at the same edge, never centred, and render at their drawn size. A figure wider than the column scrolls inside its stage; engines draw to fit 1232px.
  A figure scaled to fit shrinks its labels below the minimum; a centred figure breaks the column.
- **S7 Lanes, not overlap.** The card docks 16px right of the plot when that gutter fits, else under the figure; callouts go in the lanes beside the plot or in free space, never on a mark, label, connector or marker (8px clear); note markers sit just outside their target, never on text or another mark.
  Anything drawn over the figure hides the answer it is meant to explain.

## 5 · Shape

- **R1 One radius.** `--x-radius` (6px) on every box: nodes, groups, panels, buttons, notes, cells at corners.
  Two radii look accidental; small boxes already look rounder than big ones at the same value.
- **R2 No pills.** Full rounding only on true circles (dots, the theme glyph).
  Shape does not encode state; color and type do.
- **R3 No shadows.** Depth is a surface token step, never `box-shadow` or a drop filter.
  Shadows fake a z-axis the page does not have.
- **R4 No partial borders.** Contain with a tint or a full hairline frame; never a left, top or bottom accent edge.
  A side border reads as a tab or nav affordance and creates false asymmetry.
- **R5 Frames nest twice at most** (page → card → chip).
  Deeper structure comes from spacing and labels.

## 6 · Focus & interaction grammar

- **F1 Selection is an ink ring.** The selected mark gets a 2px `--x-text` ring 3px outside it, over a `--x-bg` gap, drawn in a layer on top; lines are redrawn on top in their own hue, 1.5px heavier. Nothing moves or resizes, and the fill stays (a focal mark stays accent).
  Ink reads on any fill, accent included, and never competes with the author's emphasis.
- **F1b One stroke per state, never shared.** Selection = 2px solid ink ring. Compared (`cmp`) = the same, dashed. Related = its own outline, solid, stepped up to `text-dim` at 1.5px (no ring, no dash). Hover and keyboard focus = 1px dashed `--x-text-dim` ring, only on what the selection does not already light. Focal = 1.5px accent and a 12% accent tint. Dashes otherwise only encode data and sit in the legend.
- **F2 One selection, many mirrors.** Selecting a mark lights its matrix column, compare card, prose sentences, reading-panel note and `detail` block.
  Coupled views are what turn a picture into an index.
- **F3 Hover previews, click commits.** Hover shows a tooltip and dashed rings on the element and its direct relations, and dims nothing; a click commits the selection, the dimming and the card.
  Commit on hover makes the page flicker under the cursor.
- **F3b The card answers, it doesn't repeat.** It is 256px wide, never clipped and never scrolls. It docks in the gutter 16px right of the plot, level with what was clicked; where there is no gutter it floats within 64px of it only if it covers none of the selection, what it lights up or any label; otherwise it sits under the figure. Its leader is a caret or a line of at most 160px that crosses no label, or nothing (the ring marks the anchor). It shows what the label can't: computed facts (rank, share, delta), `about`, and relations by name ("Waits for", "Flows to").
  A card that repeats the printed value wastes the click; a card that hides the answer defeats it.
- **F4 Visibly interactive at rest.** Pointer cursor and hover response on everything selectable, once JS is running.
  No mystery meat.
- **F5 Designed focus.** A focused mark shows the hover ring and its tooltip; controls and links keep an accent outline on `:focus-visible`. Captures show neither.
  Default rings clash; mouse users should not see them.
- **F6 Keyboard parity.** One Tab stop per figure; arrows move between marks, Home/End jump to the ends, Enter opens the card, Tab walks its chips, Esc closes it and returns focus; ←/→ step scenes.
  Anything a mouse can do, a keyboard can.
- **F7 Motion only for state.** Transitions 120–160ms ease-out on opacity, fill, stroke; none under reduced motion or capture.
  Motion that is not change is distraction.
- **F8 Complete without JS.** The static page shows every figure undimmed; controls that need JS are hidden.
  Screenshots, feed readers and printouts must still tell the story.

## 7 · Connectors

- **C1 Orthogonal only.** Horizontal and vertical segments with r=8 corners, routed in gutters.
  Diagonals in a grid look like errors.
- **C2 Never behind a box.** A connector never crosses a node that is not its endpoint; move the node if it must.
  A line under a box implies a relation that does not exist (`route` warns).
- **C3 Style = relation.** `->` flow solid, `-->` return dashed, `~>` async dotted faint, `=>` link in `--x-link`.
  Declared once in the legend, never broken.
- **C4 Arrowheads always.** Direction is information.
- **C5 Fan-out spreads.** Several connectors on one side attach at evenly spaced points ≥12px apart; parallel runs keep lanes.
  Stacked lines read as one.
- **C6 Label the axis only.** Name the 2–4 connectors that tell the story; the rest are discoverable via selection.
  Labels on every line are a wall of text in disguise.
- **C7 Short labels.** Lowercase verb phrase, ≤3 words, ≤18 characters, 13px sans `text-dim`, on a masked horizontal run.
  Long labels cannot find a clear segment (`edge-label`).

## 8 · Emphasis by dimming

- **E1 Dim, don't glow, don't fade text.** Unrelated shapes lose fill and stroke strength and saturation (`--x-dim-fill`, `--x-dim-stroke`, `--x-dim-sat`, higher in dark); their text turns `--x-dim-text` instead of fading, and a label on a dimmed fill takes the quietest ink that keeps 3:1 there. HTML items keep their surface and swap text to `--x-dim-text`.
  Fading a whole group also fades its labels and turns accent brown on dark canvases.
- **E1b Dim only where the selection is.** Only figures and blocks that hold a lit element dim; other figures and the prose stay as they are.
- **E2 Four tiers.** Selected (ring), related (full strength, a step stronger stroke), context (rest look, never dimmed: a heatmap row, the rest of a series), dimmed.
  The reader needs the local neighborhood, not just the dot.
- **E2b Focal survives.** A dimmed focal keeps a full-opacity accent stroke with a lighter fill, and never outshines the selection.
- **E3 Focal is rare.** At most 2 focal nodes per figure, marked by an accent tint and frame (`budget-focal`).
  Three focal points is zero focal points.
- **E4 Scenes teach order.** In a scene, done steps are quiet, the active step uses selection styling, the rest dims.
  One moving highlight explains sequence better than numbered labels.
- **E5 Terminal states look terminal.** Use a dashed boundary or a store kind where flow can stop.
  The eye should find the ends without reading.

## 9 · Density & budgets

- **B1 ≤9 nodes per figure.** More → split into an overview figure plus a detail figure (`budget-nodes`).
  Working memory holds a handful of chunks, not a dozen.
- **B2 ≤12 connectors per figure** (`budget-edges`).
  Past that the lines become texture.
- **B3 Groups of 3–5.** More items in a zone → introduce a sub-group.
  Chunks beyond five stop reading as one thing.
- **B4 Labels fit their cell.** A label longer than `labelCapacity` is rewritten, not shrunk (`label-fit`).
  Smaller text is compression without structure.
- **B5 Every node has an `about`** that adds information instead of repeating the label (`about-missing`, `about-repeats`): what it does, why it is there, what to watch, in two or three short sentences (`about-thin` under 12 words).
  The card is where the micro lives; an empty card wastes the click.
- **B6 Paragraph budget.** At most ~3 lines per paragraph and ~2 paragraphs between blocks.
  More means the content wants a matrix, compare or figure.
- **B7 Rule lists are matrices.** "X is allowed when Y" repeated → a `matrix`. Before/after or options → a `compare`.
  Sentences hide the grid the reader has to rebuild.
- **B8 Unique labels.** No two elements share a visible label (`label-duplicate`).
  Duplicates make links and the card ambiguous.

## 10 · Dark mode

- **D1 Same roles, new values.** Dark mode swaps token values only; markup and CSS are identical.
  One code path cannot drift.
- **D2 Deep neutral, not black.** Dark `bg` is a warm near-black with surfaces one step lighter.
  Pure black makes hairlines vibrate and swallows the surface step.
- **D3 Lighter accent, same hue.** The dark accent is raised in lightness to keep contrast, not shifted in hue.
  The reader's learned mapping survives the switch.
- **D4 Default follows the reader.** `mode: auto` follows the OS; a toggle and `#theme=` override.
  The page respects the setting the reader already chose.
- **D5 Print is light.** Print always uses light tokens and hides controls.
  Paper has no dark mode.

## Checklist before shipping

1. Squint: one focal point, groups legible, nothing under 13px, nothing drawn over a label? (P2, E3, Y2, S7)
2. Any side border, shadow, second radius or pill? (R1–R4)
3. Any hue decorating instead of meaning? (T3, T4)
4. Any paragraph over 3 lines, or a rule list that is secretly a matrix? (B6, B7)
5. Figure: one axis, legend present, terminals marked, ≤9 nodes, ≤12 connectors? (S4, C3, E5, B1, B2)
6. Selection: ink ring, rest dimmed only in its own figure, focal still accent, the card covering nothing it lights up? (F1, F3b, E1, E2b)
7. Both modes: `check` and `audit` pass, contrast ≥4.5? (T9, D1)
