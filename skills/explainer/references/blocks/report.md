# Report: meta, events, change, metrics, checklist

A report is one page where each panel proves the next: what happened (**events**), why and what changed (**change**), the evidence (**metrics**), and how to check it yourself (**checklist**), under a title and a status line (**meta**). Start from `new report <out.md>`.

```
title                                   ← front matter `title`, the finding in one line
meta: chips · status                    ← where it ran, which build, the verdict
events: the trace                       ← full width
change: A · B · C cards                 ← full width
::: split 3fr 2fr
metrics | checklist                     ← side by side at 1100px and up, stacked below
:::
```

Ids are page-global, like figure node ids. Relations are declared once, on the side that knows them, and every panel lights its counterparts: click an event and the fixes that explain it, the rows they moved and the steps that reproduce it light up; the rest dims.

**Use when** the reader has to trust a fix: an incident, a performance change, a bug report with its evidence. For a history over days or years, use `timeline`. For a plan, use `gantt`.

## Rhetoric

- **Status is the BLUF.** The meta `status` says the verdict in one line ("Landed with review PASS"). The title states the finding, not the ticket ("Stop is immediate, and a 429 ends the turn").
- **Each card's NOW is one sentence a reader can test.** Not "improved Stop", but "a repeat press is a no-op".
- **Every metric row names its method in `about`**: tool, runs, machine. A number without a method is an anecdote.
- **Say what you didn't run.** A `proof` row with `status: skip` is worth more than silence.
- **Tone is real state, never decoration.** Every tone also carries a word or a symbol (WAS/NOW, ✓ pass, ▲, "faster"), so it never rests on hue alone.

## meta

The line under the title. It has no panel frame.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | `meta` | Block id |
| `chips` | list | `[]` | Text, or `{ label, tone?, id?, about?, copy?, refs? }`. Pills in the sans; a copyable one (hash, branch, path) is set in mono |
| `chips[].tone` | ok · warn · danger | neutral | Tinted pill with a symbol (✓ ▲ ×) |
| `chips[].id` | string | none | Makes the chip selectable |
| `chips[].refs` | id or list | `[]` | "Evidence" chips on its card (inverse "Cited by"); needs `id` |
| `chips[].copy` | true · text · false | the hash in the label | Click copies it. A 7–40 character hex hash is detected on its own |
| `status` | text or `{ text, tone }` | none | One line with a tone symbol. Hidden in bare view |

**Budget:** 5 chips.

## events

A second-precision trace: dots for moments, spans for waits, clusters for repeated events. It explains itself in the graph. Click any moment (an event, a span, a cluster, or one bar of a cluster) and its card opens right there with a leader to the exact point, while the cards, rows and steps it connects to light up in the other panels. The expanded view also shows the key explanations on the graph at once. Use `timeline` for dates.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | Block id |
| `title` | text | none | Panel title (kept in bare view) |
| `start` | time | the earliest absolute time | t0; every `+Δ` is from here |
| `end` | time | the last thing on the trace | Right end of the axis |
| `tz` | text | none | Printed after the start time, e.g. `UTC` |
| `compress` | auto · off | auto | Collapse a dominant empty gap into a `//` break |
| `annotate` | auto · off · list of ids | auto | Which moments show their `note` as a box in the expanded view. `auto` means every moment with a `note`, in time order |
| `events` | map id → fields | required | See below |
| `spans` | map id → fields | `{}` | `from`, `to` and the event fields below. A bar on the track above the axis |
| `clusters` | map id → fields | `{}` | `items` and the event fields below. Bars under the axis |
| `clusters.*.items` | list | required | `{ at, dur, id?, label?, about?, note?, fix?, metric?, check? }`. Each bar is its own moment; `id` defaults to `<cluster>-1`, `-2`… |
| `notes`, `caveat`, `story` | | | The shared reading keys (see `format.md`) |

Event fields:

| key | meaning |
|---|---|
| `at` | Required. When it happened (see Times) |
| `label`, `sub` | The words on the canvas: a few words, then an optional second line |
| `about` | What happened here and why it matters, 1–2 sentences. The card shows it on click. `check` warns when it's missing |
| `note` | One short sentence for the expanded view's box. Without it, `about` is used when it fits in 5 lines |
| `fix` | Change cards that explain this moment. The moment reads "Explained by", the card "Seen at" |
| `metric` | Metric rows that measure it: "Measured by" / "Observed at" |
| `check` | Try steps that reproduce it ("Reproduced by" / "Reproduces"), or open questions about it ("Open question" / "About") |
| `tone`, `focal`, `place` | Tone of label and dot. Accent (≤ 2). `above` or `below` to prefer a side |

Every event, span and cluster should link to at least one card, row or step; `check` warns when one doesn't. Write each relation once. `fix` on an event and `causes` on a card are the same relation, and so are `metric` and `measures`, and `check` and `reproduces`. The page reads them as one whichever end you use, so the card never shows a group twice.

**Times** can be written four ways, and one block may mix them:

| form | example | means |
|---|---|---|
| clock | `"10:08:57.2"` | Time of day. Quote it in YAML |
| offset | `+13.2s`, `-400ms` | From `start` |
| anchored | `e429+2s` | From another event in this block. The two become each other's context |
| ISO | `2026-09-26T10:08:44Z` | Absolute. Clock times beside it fall on its day and offset |

Durations: `3.5 s`, `800ms`, `1m30s`, `2 min`, or a bare number of seconds.

**What the engine does:**

- The axis is proportional to time. A gap longer than 15% of the trace and 2.5× the median gap becomes a `//` break, and the ruler prints the skipped time.
- The ruler shows the absolute start and end plus round relative ticks (`+5 s`).
- Each cluster bar prints its own duration at its end.
- Labels (label, then `sub`) wrap at 32 characters, two lines each. They are placed above or below the axis with leader lines, and they never overlap a dot, bar or another label.
- A label at the left or right edge re-anchors inward. Nothing is clipped and nothing is cut with "…". A label that can't fit becomes a numbered marker with its text listed under the trace, and `check` warns `label-fit`.
- **Click:** the card opens next to the moment with a leader to it. While it's open, the trace grows a lane under the plot so the card never has to dock away from its point. It shows the time, `+Δ` from the first event, Δ from the previous one, a span's ends, and a cluster's durations with the total and mean. Then come `about` and the relation chips. A bar lights everything its cluster lights, and its sibling bars stay at rest.
- **Expanded view:** each annotated moment gets a numbered marker (`kit.notes()`) at the outer corner of its label. Its `note` goes in a numbered box on a band above or below the trace, on the side of the label and as close to the moment as the other boxes allow. Boxes never overlap and never leave the figure. A note over 5 lines is left out with a `label-fit` warning, and still opens on click.
- **Bare view:** only the trace. No bands and no markers, just the cards on click.
- Hovering a moment shows its time on the ruler.

```events
id: trace
tz: UTC
end: "10:09:19"
events:
  sent: { at: "10:08:44", label: Message sent, about: "The turn starts.", check: step-stream }
  e429:
    at: "10:08:56"
    label: HTTP 429
    sub: painted as final
    tone: warn
    focal: true
    note: "The provider said 429; the app painted it as final while a retry was queued."
    about: "The provider answered Too Many Requests, and the app still scheduled a retry."
    fix: c-429
    check: step-429
clusters:
  stops:
    label: 3 Stop presses
    tone: warn
    about: "Each press scanned every journal under a shared lock."
    fix: [c-runtime, c-ui]
    metric: [copy-first, copy-repeat]
    check: step-hammer
    items:
      - { at: "10:09:05.3", dur: 3.5 s, metric: copy-first }
      - { at: "10:09:06.2", dur: 6.3 s, metric: copy-repeat }
      - { id: stops-3, at: "10:09:06.8", dur: 11.8 s, note: "11.8 s with no feedback." }
```

**Budget:** 14 events, spans and clusters together (`budget-nodes`). 3 clusters of up to 6 items each. 6 annotated moments. 2 focal.

## change

Root cause → fix cards, lettered A, B, C in order. WAS is warn ink on warn tint. NOW is ok ink on ok tint (warn for `partial`, danger for `reverted`, each with its word on the card).

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | Block id |
| `title` | text | none | Panel title |
| `items` | map id → fields | required | One card per cause |
| `items.*.label` | text | required | The fix in a few words ("429 settles") |
| `items.*.was` / `now` | text | required | Behaviour before and after. Inline Markdown |
| `items.*.tone` | fixed · partial · reverted | fixed | Colour and word of NOW |
| `items.*.causes` | id or list | `[]` | Events, spans or clusters it explains ("Seen at" / "Explained by"). Same as `fix` on the event, so write it on one side. `check` warns when a card explains nothing on the trace |
| `items.*.affects` | id or list | `[]` | Metric rows it moved: "Moved" / "Changed by" |
| `items.*.verify` | id or list | `[]` | Steps that check it: "Check with" / "Verifies". The same relation as a step's `verifies`; write it on either side |
| `items.*.about`, `focal` | | | Card text; accent border |

**Budget:** 4 cards.

## metrics

A before/after table. Cells keep the author's text. Numbers, units and ranges are parsed so tone and the change column follow `better`.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | Block id |
| `title` | text | none | Panel title |
| `better` | lower · higher | none | Which way is good. Without it, numeric pairs stay untoned (and `check` warns) |
| `columns` | [text, text] | `[Before, After]` | Value column headers |
| `corner` | text | `Where` | Label column header |
| `change` | text · false | `Change` | Change column header, or `false` to hide it |
| `bars` | log · off | off | A small before/after bar pair on a log scale in the change column |
| `rows` | map id → fields | required unless `proof` | See below |
| `proof` | list | `[]` | `{ label, status: pass · fail · known · skip, value?, about?, id?, proves? }`, shown as a PROOF sub-table with ✓ pass, × fail, ◐ known, — not run |

Row fields: `label`, `before`, `after` (text, a number with `unit`, or `{ text, tone }`), `unit`, `better` (overrides the block), `measures` (event ids, "Observed at" / "Measured by"; the same as `metric` on the event), `about` (the method; `check` warns when missing), `tone` (for both cells).

- Values: `0.8 ms`, `3.3–6.1 s`, `12%`, `4 KB`, `1,200`, `≈10 s`. Words such as `same frame` or `not re-measured` stay neutral unless toned.
- Numbers are set in the sans with tabular figures, like every number on the page. Mono is for code: put a command or an identifier in backticks in a proof `value`.
- Change: ranges are compared end to end, low with low and high with high. `0.73–1.72 s → 0.8 ms` reads `≈900–2,150× faster`. Below 1.5× it reads as a percentage (`12% lower`). Two toned word cells read `better` or `worse`.

**Budget:** 8 rows.

## checklist

Try steps and open questions.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | Block id |
| `title` | text | none | Panel title. Inline code allowed |
| `steps` | map id → fields | `{}` | `{ do, expect?, code?, verifies?, reproduces?, done?, about? }`, rendered as "do: expect `code`" |
| `steps.*.verifies` | id or list | `[]` | Change cards it checks: "Verifies" / "Check with" |
| `steps.*.reproduces` | id or list | `[]` | Events it makes happen again: "Reproduces" / "Reproduced by" (the same as `check` on the event) |
| `steps.*.done` | bool | false | A static tick |
| `open` | map id → fields | `{}` | `{ text, owner?, decision?, on?, about? }`. `decision: true` prints "**Owner decides:**" |
| `open.*.on` | id or list | `[]` | What the question is about: "About" / "Open question" |

A reader can tick a step's number. The tick stays in that browser tab and never goes into the URL.

**Budget:** 8 steps, 5 open questions.

## What lights up

| select | lit (related) | at rest (context) | dimmed |
|---|---|---|---|
| an event, span or cluster | the cards that explain it, the rows those cards moved, the rows that measure it, the steps that reproduce it, a cluster's bars | the cards' other causes and checks, events anchored to it (`e429+2s`) | everything else in the panels that hold a lit element |
| one bar of a cluster | its own rows, plus everything its cluster lights | its sibling bars | the rest |
| a card | its causes, rows and checks | what those rows and steps point at | the rest |
| a metric row | the cards that moved it, the events it measures | the cards' other rows and checks | the rest |
| a step or question | the cards it verifies, the events it reproduces | the cards' causes | the rest |

A `#sel=<id>` URL captures the whole cross-panel state, so `shot --page --state 'sel=stops'` reproduces it.

## Anti-patterns

- A trace with every log line. Keep the moments the cards explain, and fold repeats into a cluster.
- A card whose NOW says "fixed" or "improved". Write the behaviour a reader can see.
- A metric with no method, or "after" measured on a different machine than "before" without saying so.
- A change card that explains no moment. If nothing on the trace shows the problem, the trace is missing a moment.
- A moment with no `about`. The trace shows *when*; the card is where the reader learns *what happened*.
- Tone used for emphasis. Amber means worse and green means better, nothing else.
