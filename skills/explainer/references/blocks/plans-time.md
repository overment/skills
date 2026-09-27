# Plans over time: gantt, timeline

## gantt

**Use when** the reader has to see which tasks wait on which and where the calendar has no slack. For an order of steps without dates, use a `figure` with `layout: flow`.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | Block id; auto ids become `<id>-<slug>` |
| `title` | string | none | Caption (hidden in bare view) |
| `start` | date | first task | First day shown |
| `end` | date | last task | Last day shown, inclusive (`2026-05` means through May 31) |
| `today` | date | none | Accent dashed marker; dropped with a warning if out of range |
| `tasks` | list | required | See below |
| `tasks[].label` | string | required | Name of the job, shown in the left column |
| `tasks[].id` | string | `<id>-<slug>` | Explicit id; must be unique in the document |
| `tasks[].start` | date | end of its `after` tasks | First day |
| `tasks[].end` | date | — | Last day, inclusive. Use either `end` or `days` |
| `tasks[].days` | number | — | Length in calendar days |
| `tasks[].group` | string | none | Phase; a header row that selects all its tasks |
| `tasks[].after` | id/label or list | `[]` | Predecessors; drawn as arrows from their end to this start |
| `tasks[].progress` | 0..1 | none | Share done, shown as an inner bar |
| `tasks[].milestone` | bool | false | Diamond on `start`; no `end`/`days`/`progress` |
| `tasks[].about` | string | none | 1–2 sentences for the detail panel |
| `tasks[].focal` / `muted` | bool | false | Accent (≤ 2) / context |
| `marks` | list | none | Up to 2 dated reference lines `{x: 2026-05-01, label}` |
| `bands` | list | none | Up to 3 dated ranges `{from, to, label}` |
| `notes` / `caveat` / `story` | | none | Expanded view and step-through, see format.md |

Dates: `YYYY-MM-DD`, `YYYY-MM` or `YYYY`. Ticks switch between days, weeks, months, quarters and years by span.

**What the engine works out.** The critical-path method runs on every linked task (one with an `after`, or one that others wait for). Float is the number of days a task can slip before the last linked finish moves. A task with no float is critical. A task that nothing links to shows "not linked". The chart draws:

- critical connectors in ink at rest, and a "Critical path" key that selects `<id>-critical` (link it from prose: `[critical path](#launch-critical)`);
- a dashed slack box after every linked bar with float, labelled with its days as the card writes them ("6 d"), moved aside when today or a mark crosses the middle. It shows while the task is selected, and always in the full view, where note markers keep off it;
- connectors drawn over the bars, each on a halo of canvas, so none ever hides behind a bar. They turn in the 8px gutters between rows and take the nearest clear column within 96px of the gap between their two bars; past that they run straight down beside their own bars and pass over the ones between on the halo, rather than cross the chart to a free column. If no column is clear even there, `check` warns (`route`);
- milestone dates in the first spot that clears every connector (right of the diamond by default, with room kept for it);
- bars without `progress`, in a chart where other tasks have it, as outlines, so unstarted work never looks finished;
- a selectable today marker, `<id>-today`: late tasks, tasks in progress, what starts next.

The ids `<id>-critical` and `<id>-today` are reserved.

**Card.** A task shows its slack ("0 d · critical", "6 d", "not linked"), the share done, how much of its time is gone as of `today`, and when it ends relative to the finishing milestone ("1 d before Public launch"). *Waits for* and *Blocks* chips use the real task names. The rest of its chain upstream and downstream stays readable while it is selected. A connector shows the idle days between its ends. It has no label of its own.

```gantt
id: launch
today: 2026-04-20
tasks:
  - { label: Design, group: Build, start: 2026-03-02, days: 10, progress: 1, about: "Endpoints agreed with both client teams." }
  - { label: Backend, group: Build, after: Design, days: 24, focal: true, about: "Every later task waits on it." }
  - { label: Launch, group: Ship, after: Backend, milestone: true, about: "Goes to every customer." }
```

**Budget:** 14 tasks (`budget-nodes`), 2 focal.

**Expanded view.** Link the BLUF to `#<id>-critical`. Put one note on the only open task with no slack and one on the task with the most slack, and add a caveat that the dates are a plan.

**Anti-patterns**
- Hard-coding dates that follow from `after`. Leave out `start` so a slip moves everything after it.
- Marking every late task focal. Mark the one on the critical path.
- A 40-row plan. Make one gantt per group, or merge finished work into one bar.

## timeline

**Use when** the order and spacing of events over time is the point: a history, a release record, an incident. For planned work with durations, use `gantt`.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | Block id; auto ids become `<id>-<slug>` |
| `title` | string | none | Caption (hidden in bare view) |
| `start` / `end` | date | data plus a margin | Range shown; `end` is inclusive |
| `events` | list | required | See below |
| `events[].date` | date | required | `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; the label shows that precision |
| `events[].label` | string | required | What happened, a few words |
| `events[].lane` | string | none | Row; all events have one or none. Lane labels select their events |
| `events[].id` | string | `<id>-<slug>` | Explicit id |
| `events[].about` | string | none | 1–2 sentences for the detail panel |
| `events[].focal` / `muted` | bool | false | Accent (≤ 2) / context |
| `periods` | list | `[]` | Shaded bands `{ label, start, end, about?, id? }`; selecting one lights its events |
| `marks` / `bands` | list | none | Dated reference lines `{x, label}` (≤ 2) and ranges `{from, to, label}` (≤ 3) |
| `notes` / `caveat` / `story` | | none | Expanded view and step-through, see format.md |

Labels alternate above and below the axis and stack into levels so they never overlap. Leaders never cross a label. A focal event stands on a longer stem with a larger dot.

**Card.** An event shows its position ("4 of 8"), how long after the previous event it came ("15 months after Paid plans") and how long until the next, both as chips, and its era, which lights up with it. The previous and next events stay readable. An era shows its length and its events.

**Brush and keys.** Events carry `data-at="YYYY-MM-DD"` and periods carry `data-at="start..end"`. The axis strip under the plot is `<rect class="x-timeline-brush" data-brush="<id>" data-min data-max>`, and its x span maps linearly onto [`data-min`, `data-max`). The client's brush turns a drag there into `range=a..b`. Arrow keys follow `data-nav`: ← → step through events in date order, and ↑ goes to the eras.

```timeline
id: history
periods:
  - { label: Side project, start: 2019-01, end: 2020-12 }
events:
  - { date: 2019-04, label: First prototype, about: "Built in a weekend for one team." }
  - { date: 2022-09, label: Public API, focal: true, about: "Partners brought more teams than marketing did." }
```

**Budget:** 12 events (`budget-nodes`), 2 focal, 3 lanes or fewer is a good limit.

**Expanded view.** One note on the turning-point event. The reading line already says that spacing is proportional to time.

**Anti-patterns**
- Long labels. Put the sentence in `about` and keep the label to a few words.
- Lanes that hold one event each. Use one lane and let `about` say where it happened.
- Periods that exist only for decoration. Every band should separate eras the prose talks about.
