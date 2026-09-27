# Bars and dots: bar, waterfall, dumbbell, beeswarm

Shared keys: `id` (required, unique in the document), `title` (caption, hidden in bare view), `format` (`auto|int|1|2|%|k|$|€|zł|h|d`, default `auto`), `axis` (what the values measure, with the period, e.g. `Signups, last 90 days`), `unit` (what one value counts: `signups`, `s`, `$`, `%`; symbols are printed on the chart, words only in the card). Items take `label`, `about` (1-2 sentences for the card), `focal: true` (accent, max 2), `muted: true` (grey context) and an optional `id`. Auto ids are `<block id>-<label slug>`; `<id>-title` and `<id>-desc` are reserved for the figure's own title and description.

Expanded view (every block here): `notes` (≤4 `{on: id | [ids], text}`; note 1 is the fact that proves the sentence above the figure, and its number is drawn on the first target), `caveat` (one sentence: what the figure doesn't show) and `story`. `bar`, `waterfall` and `beeswarm` also take `marks` (≤2 reference lines at a number, `mean` or `median`) and `bands` (≤3 shaded ranges `{from, to, label}`). There is no `note` key; prose belongs in the document.

What a click shows is computed here, not written: rank, share, the gap to the focal bar, levels, medians. Link the claim in the prose to the marks that prove it; a multi-id ref `[text](#a+b)` selects `a` and compares it with `b`.

## bar

Use when comparing one amount across categories, or a few series across a few categories.

| key | type | default | meaning |
|---|---|---|---|
| `data` | list `{ label, value, about?, focal?, muted?, id? }` or map `label: value` | — | one series; use this or `categories` + `series` |
| `categories` | list of text | — | category labels for several series |
| `series` | list `{ label, values, about?, focal?, muted?, id? }` | — | `values`: a list aligned with `categories` (`null` = gap) or a map category → value |
| `stack` | bool | `false` | stack series instead of placing them side by side |
| `orient` | `horizontal` \| `vertical` | horizontal when > 6 categories or a label > 12 chars | bar direction |
| `sort` | `value` \| `none` | `value` for `data`, `none` for `series` | `value` sorts largest first (series: by category total) |
| `marks`, `bands` | see above | — | on the value axis; bars have one numeric axis, so `{x: …}` and `{y: …}` both mean it |

~~~bar
id: signups
unit: signups
axis: Signups, last 90 days
marks:
  - { x: mean, label: average }
data:
  Organic search: 4120
  Referrals: 1480
  Paid search: 1210
~~~

Card: a bar shows `#5 of 7`, its share of the total, its gap to the focal bar (the focal bar: to the runner-up) as a chip, and its gap to the average. A grouped cell shows its gap to the other series in the same category; a stacked cell its share of the category and of its series; a series its total, share and largest category. Selecting a bar of a single series draws a rule at its value, and every other bar prints its signed difference in place of its value.

Budget: 12 bars for one series, 6 categories × 4 series. Negative values extend from a zero baseline. Several series get a selectable legend; selecting a series lights all its bars. Stacked bars show segment values inside when they fit, the total at the end, and a tick axis.

Anti-patterns: a legend for a single series (label the bars instead). `sort: none` on unordered categories. Stacking series that don't add up to a meaningful total.

## waterfall

Use when explaining how a starting total became an ending total through signed changes.

| key | type | default | meaning |
|---|---|---|---|
| `data` | list `{ label, value, total?, about?, focal?, muted?, id? }` | — | first item is the starting total; `total: true` draws the running total (its `value` is optional and must match); every other `value` is a signed change |
| `marks`, `bands` | see above | — | on the y axis (`{y: …}`); `mean`/`median` are of the levels |

~~~waterfall
id: arr
format: $
data:
  - { label: Start of year, value: 4200000 }
  - { label: New customers, value: 1600000 }
  - { label: Churn, value: -1100000 }
  - { label: End of year, total: true }
~~~

Budget: 8 bars including totals. Sign is fill weight, not colour: totals are solid, increases tinted, decreases hollow, all in one hue, so the accent stays the only loud colour (design-law T4) and a selection ring shows on every bar. A legend names the four looks; its Increase and Decrease keys select every step of that sign. Labels are signed (+12 / −4); decrease labels sit under the bar, where no carry line arrives.

Card: a change shows `$6.2M → $5.1M`, its share of the gross gains or losses, what share of the largest opposite change it cancels (or outweighs), and its rank by size. A total shows its net change against the start and the reconciliation `4.2 + 1.6 + 0.6 + 0.2 − 0.4 − 1.1 = 5.1 ($M)`, each term a chip. Selecting a bar turns its carry lines in and out solid and prints their levels.

Anti-patterns: more than 8 steps (merge the small changes into "Other"). A total whose `value` you computed by hand (leave it out). Using it for values that are not additive.

## dumbbell

Use when each row has two values (before/after, plan/actual) and the gap matters more than either value.

| key | type | default | meaning |
|---|---|---|---|
| `columns` | `[text, text]` | `[Before, After]` | names of the two values, shown in the legend |
| `better` | `lower` \| `higher` | — | which way is an improvement; ranks rows by gain and says "better by 0.4 s" |
| `data` | list `{ label, from, to, about?, focal?, muted?, id? }` or map `label: [from, to]` | — | one row each |
| `sort` | `change` \| `none` | `change` | `change` puts the largest absolute change on top (the legend says so) |

~~~dumbbell
id: load
format: "1"
unit: s
better: lower
axis: Median page load, seconds
data:
  Product: [4.6, 2.1]
  Home: [2.8, 1.9]
~~~

Budget: 12 rows. Each row is one mark wrapping both dots and the line, so selecting a row lights both values. The first value is a hollow dot and the second a solid one, in one hue, with a small arrowhead for the direction; a focal row draws both in the accent. Selecting a row prints the change over the line and shades the row. The two legend keys are selectable: they ring every dot of that end and show its mean.

Card: `−0.4 s (−18%)`, the rank by gain (or by size of change without `better`), the median change of all rows, and with `better` a plain verdict.

Anti-patterns: using it for time series with more than two points (use a line chart). Rows with different units. Marking every improved row focal.

## beeswarm

Use when showing how individual items spread along one number, optionally compared across groups.

| key | type | default | meaning |
|---|---|---|---|
| `data` | list `{ label, value, group?, about?, focal?, muted?, id? }` or map `label: value` | — | one dot per item; `group` gives each group its own row and colour (all items or none) |
| `marks`, `bands` | see above | — | on the x axis (`{x: 2, label: 2 h target}`); the first mark also feeds the group card ("7 of 8 under 2 h target") |

~~~beeswarm
id: reply
format: h
axis: Hours to first reply
marks:
  - { x: 2, label: 2 h target }
data:
  - { label: Ticket 4102, value: 0.4, group: Enterprise }
  - { label: Ticket 4106, value: 2.5, group: Free }
~~~

Budget: 80 dots, 6 groups. Dots are dodged so they never overlap; a note under the axis says the vertical spread is packing, not a value. Each group name is a mark: selecting it lights its dots and shows the group median and middle half (always shown in the full view). A focal dot gets its label printed above its row. Selecting a dot draws a hairline at its value through every group, with its name and value above the plot.

Card: a group shows n, median, range, middle half and the share under the first mark; a dot its place in its group ("lowest of 8"), the group median, its place overall, and the next lower and higher items as chips.

Anti-patterns: fewer than about 10 dots (use a bar or dumbbell). Showing aggregates as dots (every dot must be one real item). Using a group per item.
