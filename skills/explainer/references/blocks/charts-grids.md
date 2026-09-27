# Grid charts: heatmap, treemap, marimekko

All three fill a rectangle with marks. Colors come from classes only. Every cell, tile and segment can be selected, and so can every row, column, group and segment name.

Every block here also takes `notes` (≤4 `{on: id | [ids], text}`, numbered markers on the graph), `caveat` (one sentence) and `story` for the expanded view; see format.md. Labels drawn on a fill pick dark or light ink per fill and per theme, so they stay at 4.5:1 or better on every palette slot and ramp step.

## heatmap

**Use when:** one value per cell of two categorical axes (day × hour, team × week), and you care about the pattern, not exact values.

| key | type | default | meaning |
|---|---|---|---|
| `id` | text | required | block id; prefixes every cell/row/column id |
| `title` | text | — | caption, hidden in bare view |
| `rows` | list of labels | required | top to bottom, order kept |
| `columns` | list of labels | required | left to right, order kept |
| `values` | list of lists | required | one list per row, one number per column; `null` = empty cell |
| `format` | Format | `auto` | value format (`int`, `%`, `k`, `$`…) |
| `scale` | `quantile` \| `linear` | `quantile` | how values map to the 7 ramp levels: by rank, or by position between min and max |
| `rowAbout` | map row → text | — | detail-panel text for a row |
| `columnAbout` | map column → text | — | detail-panel text for a column |
| `unit` | text | — | what one cell counts (`tickets`); the reading line and screen-reader summary use it |

```heatmap
id: load
format: int
rows: [Mon, Tue, Wed]
columns: [Morning, Noon, Evening]
values:
  - [10, 40, 20]
  - [5, null, 30]
  - [60, 25, 15]
rowAbout:
  Mon: Weekend backlog lands at once.
```

**Budget:** 12 rows × 16 columns. Over that, aggregate (days → weeks) or split the rows.
Values show inside cells ≥ 36px wide. Column labels turn 45° when they don't fit flat. The legend names the scale (`quantile bins` or `linear steps`); the ramp runs from faintest to strongest in both themes.

**Selected:** a cell is a crosshair: its row and column heads light up, and the rest of its row and column stays at full strength while the other cells dim. Its card gives rank ("highest of 42"), share of its row ("31% of Mon (379)"), the multiple of its column average, and chips to the lowest cell in its column and the peak (or low) of its row. A row or column head gives its total, share of the grid, rank, peak and lowest cell. Empty cells fade with the grid. Arrow keys move through the grid (`data-nav`).

**Anti-patterns**
- Using a heatmap for one row. That's a bar chart.
- Using `scale: linear` with one outlier. Every other cell ends up in the lightest level. Keep `quantile`.
- Encoding a status (ok/late) as a number to get colors. Use a matrix instead.

## treemap

**Use when:** parts of one total, with too many parts for bars (8–30), optionally in 2–6 groups.

| key | type | default | meaning |
|---|---|---|---|
| `id` | text | required | block id |
| `title` | text | — | caption |
| `format` | Format | `auto` | value format |
| `data` | list \| map | required | items, or `label: value` shorthand (`label: { value, group, about }` also works) |
| `data[].label` | text | required | tile name |
| `data[].value` | number > 0 | required | area |
| `data[].group` | text | — | all items or none; groups get an outer box, a label strip and one palette slot each |
| `data[].about` | text | — | detail panel |
| `data[].focal` | bool | false | accent; at most one |
| `data[].muted` | bool | false | grey context tile |
| `data[].id` | text | `<id>-<label>` | explicit id |
| `groupAbout` | map group → text | — | detail-panel text for a group |

```treemap
id: spend
format: "$"
data:
  - { label: API servers, value: 18400, group: Compute, focal: true, about: "Serves every request." }
  - { label: Database, value: 12800, group: Data, about: "Primary store." }
  - { label: Backups, value: 2900, group: Data, about: "Nightly snapshots." }
```

**Budget:** 30 tiles and 6 groups; more of either warns (past 8 groups the palette repeats). Merge the smallest into "Other" or draw one treemap per group.
Layout is squarified and sorted by value. A tile shows its label and value when they fit; otherwise it has no text but is still selectable. Without groups, the shade follows rank.

**Selected:** a tile's card shows the breadcrumb (Network › Egress), its share of the group ("66% of Network"), its share of the total, its rank and a chip to the group's largest tile. Its siblings stay lit, so the share is visible. A group is one mark drawn on its whole frame: the selection rings the frame, and a group too small for a label strip can still be selected. Its card gives the share of the total, the tile count and the largest tile.

**Anti-patterns**
- Negative or zero values. Areas can't show them, so use bars.
- Using a treemap to compare two similar values. Areas are hard to compare, so use bars.
- Mixing grouped and ungrouped items. That's a spec error; put the stragglers in "Other".

## marimekko

**Use when:** two-level share: how big each column is (market size) **and** how it splits (channel mix). Both dimensions must matter.

| key | type | default | meaning |
|---|---|---|---|
| `id` | text | required | block id |
| `title` | text | — | caption |
| `format` | Format | `auto` | format of column widths |
| `sort` | bool | `true` | sort columns by width, widest first; `false` keeps order (time, stages) |
| `data` | list | required | one item per column |
| `data[].label` | text | required | column name, under the column |
| `data[].width` | number > 0 | required | column total; sets its width |
| `data[].segments` | map name → share \| `{ value, about, focal, muted }` | required | split of the column; normalized to 100% |
| `data[].about` | text | — | detail panel for the column |
| `data[].muted` | bool | false | grey out the whole column |
| `data[].id` | text | `<id>-<label>` | explicit id |
| `segmentAbout` | map name → text | — | detail-panel text for a segment name (legend item) |

```marimekko
id: mix
format: "$"
data:
  - { label: Europe, width: 120000000, segments: { Retail: 45, Online: 35, Wholesale: 20 } }
  - { label: Asia-Pacific, width: 70000000, segments: { Retail: 22, Online: { value: 58, focal: true }, Wholesale: 20 } }
```

**Budget:** 6 columns × 5 segments.
Segment names keep one color across columns and are stacked largest-total first, from the bottom. The legend is selectable; `focal` goes on a segment.

**Selected:** a segment is a cross: the rest of its column and the same segment name in every column stay lit. Its card gives the amount, its share of the column, of that segment name ("32% of all Online") and of the total, plus a chip to the column where that name holds the largest share. A column head lists its mix; a legend item lists its share in each column. When the prose compares two cells, link both (`#a+b`) so the card compares them.

**Anti-patterns**
- Giving every column the same width. That's a 100% stacked bar.
- Using many thin columns. Labels won't fit, so merge the tail into "Other".
- Writing segment shares that sum to 100 in some columns and to absolute values in others. Both work, but pick one so the source reads clearly.
