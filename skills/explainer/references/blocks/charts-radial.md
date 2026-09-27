# Radial charts: radar, polar, venn, quadrant

All four: `id` required, `title` optional (hidden in bare view), no prose inside the block. Auto ids are `<block id>-<slug>`; explicit `id`s are used as given and must be unique in the document; `<id>-title` and `<id>-desc` are reserved for the figure itself.

Expanded view (all four): `notes` (≤4 `{on: id | [ids], text}`; note 1 is the fact that proves the sentence above the figure), `caveat` (what the figure doesn't show) and `story`. Radar, polar and venn also take `unit` (what one value counts). Card facts are computed: the gap to the focal series, share of the cycle, overlaps, nearest neighbours.

## radar

Use when 2–5 options are scored on the same 3–8 qualities and the *shape* of each profile is the point.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id |
| `title` | string | — | caption |
| `format` | Format | `auto` | value format in the detail panel |
| `max` | number | nice max of all values | scale top for axes without their own `max` |
| `axes` | list of text or `{ label, max, id? }` | required | 3–8 axes, clockwise from the top; each axis is a mark with id `<block id>-axis-<slug>` |
| `series` | list | required | `{ label, values, about?, focal?, muted?, id? }`; `values` is a list in axis order or a map `axis: value` |

```radar
id: plans
max: 10
axes: [Speed, Cost, Reach, Trust]
series:
  - { label: Plan A, values: [3, 8, 5, 6], about: "Cheapest to run; slow to reach new users." }
  - { label: Plan B, values: [7, 4, 6, 7], focal: true, about: "Faster everywhere except cost." }
```

Budget: 5 series, 8 axes (warn). Values from 0 up to their axis max. Rings show values only when every axis shares one max; otherwise each axis label shows its max. Every area is painted before any outline, so no fill washes over another series' line.

Selecting an axis name prints every series' value at its vertex and dims nothing; its card lists the values, each with its gap to the focal series. Selecting a series prints its values at its vertices; its card says "higher on 4 of 5, tie on Trust" against the focal series (the focal series: against the other) and lists the largest gaps as axis chips.

Anti-patterns: axes on different scales without `max` per axis (the shape lies); "lower is better" axes next to "higher is better" (flip them so outward always means better); 4+ series with no focal (nobody can read it).

## polar

Use when one value repeats around a cycle (weekdays, months, hours) and the reader should see where the cycle peaks.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id |
| `title` | string | — | caption |
| `format` | Format | `auto` | ring, label and detail values |
| `max` | number | nice max of values | outer ring value |
| `cycle` | text | — | what one full turn is (`week`, `year`, `day`), for "24% of the week" |
| `data` | list or map | required | `{ label, value, about?, focal?, muted?, id? }` in cycle order, or `label: value` / `label: { value, about }` |

```polar
id: tickets
format: int
data:
  - { label: Mon, value: 412, focal: true, about: "Billing questions after weekend sign-ups." }
  - { label: Tue, value: 318, about: "Monday backlog spills over." }
  - { label: Wed, value: 276, about: "Mostly how-to questions." }
```

Budget: 3–12 categories; warns above 8 and again above 12. Values ≥ 0. Bars start at the inner ring, and their length is linear in the value. With numeric labels such as hours, use the list form (JS orders numeric map keys). A narrow gap at the top, where the cycle wraps, holds a spoke with the ring values, so no ring label sits on a bar; when the gap would pass 24°, the innermost ring labels are left out.

Card: `#1 of 7`, the share of the cycle, the multiple of the mean, and the gaps to the peak (the peak: to the runner-up) and to the step before it, as chips. Selecting a sector draws the mean ring.

Anti-patterns: using it for categories without a cycle (use a sorted bar chart); negative values; comparing two series (use a line chart).

## venn

Use when the story is which things belong to 2 or 3 groups at once. Circle sizes are fixed, so show counts as `size` numbers.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id |
| `title` | string | — | caption |
| `format` | Format | `auto` | `size` values |
| `sets` | list `{ id, label, size?, about?, focal?, muted? }` or map `id: label` | required | 2 or 3 sets, drawn left, right (and bottom) |
| `overlaps` | list or map | `[]` | `{ sets: [a, b], label?, size?, about?, focal?, id? }`, `"a & b: label"`, or `a & b: label` |

```venn
id: roles
sets:
  - { id: pm, label: Product, about: "Owns the problem and the priority." }
  - { id: eng, label: Engineering, about: "Owns how it is built and run." }
overlaps:
  - { sets: [pm, eng], label: Roadmap, about: "Scope traded against technical risk." }
```

Budget: 2–3 sets (more is a SpecError). In a 3-set diagram a pair overlap is "those two, not the third"; describe the center with all three set ids. Only listed overlaps are selectable regions.

An overlap label sits on the widest band of its region, wrapped to that width and at least 6px inside every outline; `label-fit` warns when it still doesn't fit. A note marker sits beside its target's label, at least 6px off every circle and label: inside the region for an overlap, outside all circles for a set.

Selecting a set fills its overlap regions; its card lists them as chips (`∩ Engineering → Design system`, `all three → Prototyping`) and, when the set and all its overlaps have a `size`, the part only in that set. A region's card says which sets it is in and which it is not, and its share of each set when sizes are given.

Anti-patterns: long overlap labels (1–2 words; the rest goes in `about`); expecting circle area to show size; using it for 4+ groups (use a matrix).

## quadrant

Use when items are judged on two axes at once and the decision is "which corner is it in" (effort × impact, risk × value).

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id |
| `title` | string | — | caption |
| `x` | `{ low, high, title? }` | required | horizontal axis end labels and name |
| `y` | `{ low, high, title? }` | required | vertical axis end labels and name |
| `quadrants` | list of 4 text or `{ label, about }` | — | corner names in order top-left, top-right, bottom-left, bottom-right; `about` shows in the quadrant's card |
| `data` | list or map | required | `{ label, x, y, about?, focal?, muted?, id? }` with x, y in 0..1; or `label: [x, y]` |

```quadrant
id: backlog
x: { low: Low effort, high: High effort, title: Effort }
y: { low: Low impact, high: High impact, title: Impact }
quadrants: [Quick wins, Big bets, Fill-ins, Money pits]
data:
  - { label: Saved searches, x: 0.2, y: 0.8, focal: true, about: "A week of work for the top request." }
  - { label: Offline mode, x: 0.85, y: 0.2, about: "Needs a sync engine for few users." }
```

Budget: 12 items (warn). Positions are judgements, not measurements; 0.5 is the dividing line (0.5 counts as high), labelled on both dividers. A named quadrant is selected by its name (a click on empty plot space clears) and lights up its items; its card lists them from the corner inwards. Labels try right, left, above, then below, and warn `label-fit` when none is clear.

Card: a point shows both judgements as its value, its quadrant as the eyebrow, and its three nearest items as chips worded on the axes ("Custom reports: less effort, more impact").

Anti-patterns: plotting measured numbers (use a scatter); points exactly on the center lines; every corner named "good/bad" with no decision attached.
