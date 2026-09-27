# Line family: line, slope, bump, scatter

Shared rules: `id` is required and `title` is an optional caption that bare view hides. There is no prose inside a block. Every item takes `about` (1–2 sentences), and at most 2 may be `focal: true`. `muted: true` turns an item into gray context. Auto ids are `<block-id>-<label-slug>`. Link them from prose with `[Label](#id)`.

Every block here also takes the shared reading keys: `notes` (up to 4; `on` names a series, point, line, dot or group of the same block and gets a numbered marker), `caveat` (one sentence on what the chart doesn't show) and `story`. `line` and `scatter` take the scale keys too: `marks` (up to 2 dashed reference lines at a value, `mean` or `median`), `bands` (up to 3 shaded ranges) and `unit`. `slope` takes `unit`. An id in `notes` or `story` that is not in the block is a `ref-exists` error. Selecting a mark opens its card: the value, the change since the previous and first period, its rank, and for a point its series.

`format: k` writes thousands as k from 1,000 up (`7.6k`, `21k`, `1.2M`), and an axis puts every tick in one unit (`0, 25k, 50k`, never `5,000` beside `10k`).

## line

**Use when** a value changes over an ordered axis (time, versions, steps) and the shape of the change is the story.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | — | required, unique in the document |
| `title` | string | none | caption (hidden in bare view) |
| `categories` | list of text / ISO dates | — | x values in order; if all are `YYYY-MM` or `YYYY-MM-DD`, the x axis is a true time scale |
| `series` | list | — | `{ label, values, about?, focal?, muted?, id? }` |
| `series[].values` | list aligned with categories, or map category → value | — | `~` leaves a gap |
| `format` | Format | `auto` | value format for ticks, labels and the detail panel |
| `area` | bool | `false` | fills under a single series (y starts at 0) |
| `stack` | bool | `false` | stacked areas for parts of a whole; values ≥ 0 |
| `x.title` | string | none | x axis title |
| `y.title` | string | none | y axis title (unit) |
| `y.zero` | bool | `false` | start y at 0 (always on with `area` or `stack`) |
| `marks` | list | none | `{ y: value \| mean \| median, label }` or `{ x: category or date, label }` |
| `bands` | list | none | `{ from, to, label, axis? }`; `axis` is `y` (default) or `x` (categories or dates) |
| `unit` | string | none | what a value counts: `signups`, `$`, `%`. Symbols join the numbers; a word becomes the y title when there is none |

Ids are `<id>-<series>` for a line and `<id>-<series>-<index>` for a point, where the index is 0-based. With 3 series or fewer, names and last values are labeled at the line ends; with more, a selectable legend is used instead.

With `stack`, a gap (`~`) breaks that band and every band above it, because their floor is unknown there; `check` warns and lists the values it could not draw. Write `0` when the value really was zero.

```line
id: signups
format: k
categories: [2025-01, 2025-02, 2025-03, 2025-04]
y: { title: Signups }
series:
  - { label: Organic, values: [12000, 14100, 15800, 18200], focal: true, about: "Grew once the docs ranked in search." }
  - { label: Paid, values: [9000, 9400, 9100, 9300], muted: true, about: "Flat budget, flat result." }
```

**Budget:** 5 series × 24 points.
**Avoid:** five equally loud series (make one focal and mute the rest). `area` on several unstacked series. Unordered categories (use a bar chart).

## slope

**Use when** exactly two moments are compared and the reader should see who rose, who fell, and who swapped places.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | — | required |
| `title` | string | none | caption |
| `columns` | [before, after] | — | exactly two headings, e.g. `[2023, 2025]` |
| `data` | list | — | `{ label, from, to, about?, focal?, muted?, id? }` |
| `format` | Format | `auto` | value format |
| `tone` | `change` \| `none` | `none` | `change`: rising = ok, falling = danger. Use only when up is good. Focal lines keep the accent and muted lines stay gray |
| `unit` | string | none | what a value counts; `%` changes are shown in points |

Labels and values appear on both axes and are nudged at least 14px apart. The detail panel shows `from → to (±%)`, or points of difference when `format: "%"`.

```slope
id: channels
columns: [2023, 2025]
format: k
data:
  - { label: Chat, from: 7600, to: 21300, focal: true, about: "Became the default way to reach support." }
  - { label: Phone, from: 18400, to: 9200, about: "Callers moved to chat once it answered faster." }
```

**Budget:** 12 lines.
**Avoid:** more than two moments (use a line chart). Using `tone: change` when a rise is bad, such as costs or churn. Labels longer than 3 words.

## bump

**Use when** rank order matters more than the values: leaderboards, rankings, and "who is on top each quarter".

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | — | required |
| `title` | string | none | caption |
| `categories` | list | — | periods in order (text or ISO dates) |
| `series` | list | — | `{ label, ranks, about?, focal?, muted?, id? }` |
| `series[].ranks` | list aligned with categories, or map period → rank | — | whole numbers, 1 = top; `~` = unranked |

Ids follow the line chart: `<id>-<series>` and `<id>-<series>-<index>`. Each dot shows its rank number, names sit at both ends, and the detail panel says "Rank 2, up 1".

```bump
id: stores
categories: [Q1, Q2, Q3]
series:
  - { label: Lisbon, ranks: [2, 1, 1], about: "Tourist season carried it to the top." }
  - { label: Warsaw, ranks: [3, 3, 2], focal: true, about: "Climbed after the second floor opened." }
  - { label: Berlin, ranks: [1, 2, 3], about: "Lost footfall after the mall closed." }
```

**Budget:** 8 series × 8 periods. A warning fires if two series share a rank in one period.
**Avoid:** ranks when the gaps between values matter (use line). Coloring 8 series equally (make one focal and mute the rest). Ties.

## scatter

**Use when** the relationship between two measures is the story: trade-offs, outliers, clusters. Add `size` for a third measure (a bubble chart).

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | — | required |
| `title` | string | none | caption |
| `data` | list | — | `{ label, x, y, size?, group?, about?, focal?, muted?, id? }` |
| `x` / `y` | `{ title, format, zero, unit }` | none, `auto`, `false`, none | axis title (always set one; bare view relies on it), format, start at 0 |
| `size` | `{ title, format }` | none, `auto` | what bubble area means; shown in the size key |
| `labels` | `auto` \| `all` \| `none` | `auto` | `auto` labels focal points and the extremes. Labels that would overlap are skipped |
| `guides` | `{ x?, y? }` | none | dashed quadrant lines at these values (targets, averages) |
| `marks` | list | none | `{ x or y: value \| mean \| median, label }`, labeled reference lines |
| `bands` | list | none | `{ from, to, label, axis? }` on `y` (default) or `x` |
| `unit` | string | none | what y counts; `x.unit` and `y.unit` set each axis |

Once any point has a `size`, every point needs one. Radius follows a square-root scale, capped at 28px, and larger bubbles are drawn first. Once any point has a `group`, every point needs one: groups get palette colors and a selectable legend with id `<id>-<group-slug>`.

```scatter
id: queues
x: { title: First reply, format: h }
y: { title: Satisfaction, format: "%" }
guides: { x: 4, y: 85 }
data:
  - { label: Billing, x: 0.5, y: 91, about: "Short questions with known answers." }
  - { label: Weekend, x: 2, y: 68, focal: true, about: "Fast replies, but a small team can rarely solve the problem." }
  - { label: API, x: 6, y: 78, about: "Needs an engineer for most replies." }
```

**Budget:** 60 points (warning). At most 12 labeled points (`labels: all` warns above that).
**Avoid:** missing axis titles. `labels: all` on a dense cloud. Using `size` for a value the reader never needs. More than 8 groups.
