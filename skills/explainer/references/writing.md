# Writing labels and text

The canvas is for names. The card is for meaning. The prose is for the story. Most bad figures are bad writing: labels that describe the implementation, arrows that narrate, and `about` text that repeats the label.

## Rules

- **Name the job, not the build.** A label says what the part does for the reader, in their words. Versions, frameworks and internal codenames go in `sub` or nowhere.
- **Connectors are verbs, only when needed.** Use a lowercase verb phrase of at most 3 words. When the arrow's meaning is obvious from the two ends, drop the label.
- **`about` explains the part to someone who joined today.** It starts with what the label can't say and answers three questions in two or three short sentences: what it does (in the reader's words), why it is there (what depends on it, what it protects), and what to watch (the constraint, the failure, the number that matters). A chart mark needs less: one sentence on why its value is what it is, since the computed facts carry the rest.
- **One term, one meaning.** Use the same word for the same thing on the canvas, in prose and in the matrix. A term the reader won't know goes in the glossary, not into a longer label.
- **No chrome.** No boxes around the figure, no "Figure 1", no header saying "Architecture diagram". The page title and the first sentence do that work.
- **Mono for identifiers.** Events, states, ports and field names go in `sub` or connector labels. They're not quoted, because the typeface does the quoting.

## Before and after

| Before | After | Why |
|---|---|---|
| Node `AuthZ Svc v2 (internal)` | `Permissions` | Name the job. The version and visibility are noise, or a `sub` at most |
| Edge `sends HTTP POST request with JSON payload` | `submits order` | Say what happens, not how it travels |
| `Gateway` with about `The Gateway is the gateway service that handles requests.` | `Checks the session before anything else runs. Rejects about 2% of traffic.` | Add purpose and consequence instead of repeating the label |
| `Catalog` with about `Serves products and prices.` | `Serves products and prices to every page. It is read far more than written, so answers are cached for a minute: a price change can take that long to show.` | What it does, why it is built that way, and the surprise a new teammate would otherwise hit |
| Edge `calls` on `Checkout → Payment provider` | No label | The arrow already says it |
| Node `Idempotent Retry Handler` | `Retries` plus a glossary entry for *idempotent* | Keep the label plain and define the jargon once |
| A header `SYSTEM ARCHITECTURE DIAGRAM`, a framed card and a caption `Figure 1: Overview of components` | A first sentence stating the conclusion, then the figure | Chrome says nothing the reader needs |

## The per-figure pass

Run this on every figure before `check`. Answer each question with an edit or a reason.

1. **Remove a node?** If the reader's conclusion survives without it, cut it. Mention it in `about` of its neighbour if it matters.
2. **Merge two?** Two parts the reader never needs to tell apart become one part, like "Orders" rather than "Order API" plus "Order worker".
3. **Remove a connector?** Drop an edge that exists in the code but not in the story (health checks, logging, config reads). Replies usually go too.
4. **Remove a label?** Drop every connector label the two ends already imply, then every `sub` that isn't useful.
5. **One focal?** If you marked two, check that the second really is a second conclusion.
6. **Split?** Over 9 nodes or 12 connectors, make an overview figure with one node per area, then a detail figure per area. Never shrink text to fit.

Report what the pass removed so the user can ask for it back.

## Prose

- The first paragraph is the conclusion (BLUF): what the reader should believe after reading everything.
- Number sections when the order matters: `## 01 · The path of a story`.
- Link every claim to the marks that prove it. Wrap the claim, not only the noun: "[Organic search brought 4,120 signups](#signups-organic-search)". The whole sentence lights up when its mark is selected, and the card points back to it. `check` warns about a sentence with a number next to a figure that links nothing (`claim-unlinked`), and about a focal element nothing links to (`ref-focal`).
- A comparison is two marks: "[Mobile passed web in April](#wau-mobile-3+wau-web-3)" selects the first, compares it with the second, and the card shows both values and the difference.
- Prefer a matrix to a paragraph of "A can do X but not Y", and a figure to a paragraph of "A calls B which calls C".

## Two views, one document

Every page renders in two views, switched with the controls or `#view=bare|full`:

- **bare** shows diagrams and their interactions only: no title, prose, notes, captions or glossary. Design for this view first. The diagram, its labels and the `about` texts in the card must explain everything on their own.
- **full** adds the text around the diagrams and each figure's reading panel. Use it only for what a diagram can't carry: the conclusion, a caveat, a term.

Text budget for the full view:

- `title` only in front matter. No `eyebrow` and no `summary`: a kicker above the title and a sentence restating the first paragraph are both noise.
- One or two sentences of prose before a diagram: the conclusion. Never describe what the diagram already shows ("the figure below shows…").
- Headings only when a document has several diagrams that answer different questions.
- A figure `title` is a caption. Leave it out when the page title already names the figure.
- Set `view: bare` in front matter when the document is mainly for screenshots.

## Expanded view

The reading panel is the figure's own commentary: a "How to read" line the engine writes, up to 4 numbered notes, one caveat, and the data. In the full view each note also appears on the graph as a callout next to what it's about, so write notes that point at something, and keep each to a line or two: a callout is about 220px wide.

- **Note 1 is the focal fact.** The number the page is about, with its comparison: "4,120 signups, more than paid search and social ads combined (2,070)." Put it `on` the focal mark.
- **Note 2 is the pattern.** What the shape says that no single mark does: "Paid channels together bring half of organic." Put it `on` the marks that form the pattern.
- **Notes 3 and 4 are optional:** an exception the reader would otherwise miss, or a mark that looks wrong but isn't.
- **The caveat is what the figure doesn't show,** in one sentence: the attribution model, the date range, what was left out. It is the limit a careful reader would ask about, not a disclaimer.
- **Every note is a claim with a number or a name,** never a description of the chart ("The bars show…").
- **Notes don't repeat the prose.** The first paragraph states the conclusion; the notes prove it mark by mark.
- **A story walks the argument.** Three to six steps, each a mark and one line: the focal fact, the comparison that makes it matter, the exception. Use `cmp` on the step where two marks are weighed.

| Before | After |
|---|---|
| Note "The chart shows signups by channel." | "4,120 signups from organic search, more than paid search and social ads combined." |
| Note "Newsletter is in the middle." | No note; nothing to point at |
| Caveat "Data may be inaccurate." | "Last-touch attribution: channels that start the journey get less credit." |
