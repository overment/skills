# Flow charts: funnel, pyramid, sankey

Shared keys: `id` (required, prefixes every auto id as `<id>-<slug of label>`), `title` (caption, hidden in bare view), `format` (`auto`, `int`, `1`, `2`, `%`, `k`, `$`, `€`, `zł`, `h`, `d`), and for the expanded view `notes` (≤4 `{on: id | [ids], text}`, numbered markers on the graph), `caveat` (one sentence) and `story` (see format.md). Give an item an explicit `id` only when prose links to it. Labels drawn on a fill pick dark or light ink per fill and per theme, so they stay at 4.5:1 or better.

## funnel

Use when a count shrinks through ordered steps and the reader must see where most people drop out.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | Block id. |
| `title` | string | — | Caption above the chart. |
| `format` | Format | `auto` | How values print. |
| `focal` | bool | `true` | `false` turns off the automatic focal stage: a neutral funnel. |
| `data` | list \| map | required | Stages, first to last. Map shorthand: `label: value`. |
| `data[].label` | text | required | Stage name, left of the bar. |
| `data[].value` | number ≥ 0 | required | Count that reached this stage. |
| `data[].about` | text | — | 1–2 sentences: why people stop or pass here. |
| `data[].focal` | bool | auto | Accent. With no focal given, the stage after the biggest relative drop becomes focal. |
| `data[].muted` | bool | `false` | Context stage in grey. |
| `data[].id` | string | `<id>-<label>` | Explicit id for prose links. |

Draws centered bars on one scale, the value inside (or beside) each bar, and `→ 42%` (share of the stage above) under a CONVERSION header. A stage larger than the one above gives a warning.

**Selected:** the previous and the first stage stay lit (they are the denominators). The card shows the count, the step conversion with the loss ("39% of Verified email (−6,600)"), the share of the first stage, and this step's share of all drop-off ("61% of all drop-off"). A bracket in the CONVERSION column spans from the first stage to the selected one, with the share of the top.

```funnel
id: signup
data:
  - { label: Visited, value: 5200, about: "Landed on the pricing page." }
  - { label: Signed up, value: 940, about: "Created an account." }
  - { label: Activated, value: 410, about: "Finished setup." }
```

Budget: 2–7 stages. More than 7 gives a `budget-nodes` warning with a split point.

Anti-patterns:
- Using it for categories that are not sequential steps (channels, regions). Use a bar chart.
- Letting a stage be larger than the one above it (re-entries or mixed units). A funnel only narrows.
- Marking several stages focal. Keep the automatic one or pick the one the prose names.

## pyramid

Use when levels form a ranked hierarchy: a few at the top rest on many at the base (test pyramid, needs, goals → tasks).

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | Block id. |
| `title` | string | — | Caption. |
| `format` | Format | `auto` | How `value` prints. |
| `data` | list \| map | required | Levels, top (narrow) to base (wide). Map shorthand: `label: number` (value) or `label: sentence` (about). |
| `data[].label` | text | required | Level name, drawn inside the level (wraps when needed). |
| `data[].about` | text | — | 1–2 sentences for the detail panel. |
| `data[].value` | number | — | Shown to the right of the level. |
| `data[].focal` | bool | `false` | Accent: the level the prose is about. |
| `data[].muted` | bool | `false` | Context level in grey. |
| `data[].id` | string | `<id>-<label>` | Explicit id. |

Width is not proportional to `value`; the shape encodes rank only. Shade also encodes rank, strongest at the top (in both themes).

**Selected:** the levels above and below stay lit. With values, the card gives the share of all, the multiple of the level above ("3× End-to-end") and how many times larger the level below is ("Integration below is 2.9×"). The focal level also gets the ratio to the far end ("60× the top").

```pyramid
id: goals
data:
  - { label: Mission, about: "Why the team exists." }
  - { label: Goals, value: 4, about: "What this year must prove." }
  - { label: Projects, value: 18, about: "Where the time goes." }
```

Budget: 2–6 levels. More than 6 gives a `budget-nodes` warning.

Anti-patterns:
- Plotting quantities to compare. The widths are not to scale; use bars.
- Using an order that is not a ranking (steps in time). Use steps or a funnel.
- Writing long labels. Name the level and put the explanation in `about`.

## sankey

Use when a quantity splits and merges across 2–4 stages and the reader must see where it ends up.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | Block id. |
| `title` | string | — | Caption. |
| `format` | Format | `auto` | How values print. |
| `nodes` | map \| list | inferred | `id: Label` or `id: { label, about, focal, muted }`. When given, every link end must name a node id or label (`ref-exists`). When omitted, nodes come from link ends, with id `<id>-<label>`. |
| `links` | list | required | `"from -> to: value"` strings or `{ from, to, value, about, focal, muted, id }`. |
| `links[].value` | number > 0 | required | Amount on this flow. |
| `links[].about` | text | — | 1 sentence for the detail panel. |
| `links[].id` | string | `<from>-><to>` | Edge id. |
| `columns` | list of text | — | Stage names above the columns, left to right; must match the number of columns. Each is selectable and its card lists that stage's split. |

Layout: the column is the longest path from a source, sinks go in the last column, and node height is proportional to max(in, out). Node order comes from barycenter sweeps. Color shows origin: each source takes a palette slot, a node fed by one origin keeps that slot, and merged nodes turn neutral. Bands use their source's color at 35%. Labels never sit on bands: the first column's labels go in the left gutter, the last column's in the right gutter, and middle labels sit in the gap above their node. Note markers go in the gaps between columns, on the nearest space no band, node or label covers. Each label is followed by the value.

**Selected:** a node traces its flow end to end. Its own bands are related (brighter), bands reachable upstream or downstream are context, and the rest dims. The card gives in/out, where the node's volume ends up (or comes from), and its share of all flow. Totals past one hop are proportional estimates, marked `≈`, because a sankey does not record which item took which path. A selected band gets a thin ink outline (hover only brightens it). Its card shows its value, its share of both ends ("30% of Bot answer", "80% of Reopened"), and everything feeding its source and fed by its target stays as context. Prose can link a whole route with the virtual id `<id>-path-<source>-<sink>` (node ids without the block prefix), e.g. `#ticket-flow-path-chat-reopened`.

```sankey
id: tickets
links:
  - "Chat -> Bot: 2100"
  - "Chat -> Agent: 900"
  - "Bot -> Solved: 1900"
  - "Bot -> Reopened: 200"
  - "Agent -> Solved: 900"
```

Budget: 3–4 columns, 12 nodes, 16 links. Each limit gives a warning that names what to split or fold into "Other". A band thinner than 1.5px also warns.

Anti-patterns:
- Loops or flows that go back. They are rejected; show a cycle with a `figure` instead.
- Using it for one split of one total. A single stacked bar or a bar chart reads faster.
- Tiny flows that read as hairlines. Fold them into "Other" and name them in `about`.
