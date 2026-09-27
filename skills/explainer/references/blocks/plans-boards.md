# Plan boards: kanban, journey, storymap

HTML boards laid out on a CSS grid. Every header, row label, card and chip can be selected. Selecting a column, stage, step or release header lights up its cards. Auto ids are `<block id>-<slug>`. An explicit `id` is used exactly as written, so make it unique in the document. Text items take a bare label (`- Pay`) or a map. Keep prose out of the block: `about` is for the card.

All three accept `notes` (≤ 4, `{on, text}`), `caveat` and `story` (see format.md). A note's number sits on the corner of its first target that the board draws. Selection is an ink outline 3px off the element. Focal keeps the accent, so a selected card never looks like a second focal. Row labels stay in view when a wide board scrolls sideways.

## kanban

**Use when** the point is where work sits right now: which stage is congested, and what is blocked.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id; prefixes auto ids |
| `title` | string | — | caption (hidden in bare view) |
| `columns` | list | required | `{ id?, label, limit?, about? }` or a label, left to right |
| `columns[].limit` | int ≥ 1 | — | WIP limit; header shows `n / limit`, over limit → warn tone |
| `cards` | list | `[]` | `{ id?, label, column, tags?, owner?, age?, blocked?, about?, focal?, muted? }` |
| `cards[].column` | string | required | column id or label |
| `cards[].tags` | list | `[]` | short mono chips (area, component); a chip selects every card with that tag, id `<id>-tag-<slug>` |
| `cards[].owner` | string | — | team or role, shown in the card footer |
| `cards[].age` | int ≥ 0 | — | days the card has sat in its column (card only) |
| `cards[].blocked` | bool or text | false | danger dot, the word "blocked" and a red bar on the left edge; text is the reason, shown in the card |
| `focal` / `muted` | bool | false | the one card to look at / context only |

```kanban
id: sprint
columns:
  - { label: Doing, limit: 2, about: "Work being built now." }
  - { label: Review, limit: 2, about: "Waiting for a second pair of eyes." }
cards:
  - { label: Slot picker, column: Doing, tags: [checkout], owner: web, about: "Bookable one-hour delivery slots." }
  - { label: SMS reset, column: Review, blocked: true, focal: true, about: "Waiting on a security sign-off." }
```

Lanes share their rows, so heads and first cards line up and every lane is as tall as the fullest one. A head shows `n / limit` and a danger count of blocked cards. **Card:** a column shows its load against the limit, which cards are blocked and the owner mix. A card shows its column, age, blocked reason and one chip per tag ("checkout: 4 cards"). Cards that share its tags stay readable while it is selected.

**Budget:** 5 columns, 16 cards, 5 per column (`budget-nodes`); focal ≤ 2.
**Expanded view:** a note on the over-limit column and one on the blocked card, both linked from the prose.
**Anti-patterns:** a column per person (use `owner`); tags that repeat the column ("in-review"); ticket numbers as labels (name the outcome).

## journey

**Use when** you are showing how a customer's experience changes stage by stage, and where it hurts.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id |
| `title` | string | — | caption |
| `stages` | list | required | `{ id?, label, about? }` or a label; 1–12 laid out, order is time |
| `rows` | list | — | `{ id?, label, about?, cells }`; typical labels are Doing, Thinking, Touchpoint |
| `rows[].cells` | list | required | exactly one per stage: label, `{ id?, label, about?, focal?, muted? }`, or `~` for empty |
| `sentiment` | list | — | one per stage: a number from −2 to 2, or `{ value, about? }`; ≥ 1 is ok, ≤ −1 is danger, anything in between is neutral (grey) |
| `pains` | list | `[]` | `{ id?, stage, label, about? }`; a danger chip in that stage (stage id or label) |

Either `rows` or `sentiment` is required.

```journey
id: signup
stages: [Discover, Sign up, First use]
rows:
  - { label: Doing, cells: [Sees an ad, Fills the form, Imports contacts] }
sentiment: [1, -1, 2]
pains:
  - { stage: Sign up, label: Form times out, about: "Everything typed is lost after 10 minutes." }
```

The sentiment band is 120px tall, with hairlines at +2 and −2 and a dashed zero. **Card:** a point keeps its whole stage column readable (doing, thinking, touchpoint, pains). It says where it stands ("lowest of 5") and how far it moved from the stage before ("−3 from Sign up"). A stage head lists its pains as chips. A pain chip lights its stage and its point. Columns are 180px wide up to 5 stages and 140px at 6, so a budget-sized journey fits the page.

**Budget:** 6 stages, 4 rows, 3 pains (`budget-nodes`). More than 12 stages is an error.
**Expanded view:** a note on the trough stage that links its point and pain, and one on the recovery.
**Anti-patterns:** internal system steps as stages (use the customer's words); a thoughts row that restates the actions; a pain for every stage (keep the ones that cost the most).

## storymap

**Use when** you are showing a product as the user's path (activities → steps) and what each release slices off it.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id |
| `title` | string | — | caption |
| `activities` | list | required | `{ id?, label, about?, steps }`, left to right |
| `activities[].steps` | list | required | label or `{ id?, label, about? }`; step labels must be unique in the map |
| `releases` | list | required | `{ id?, label, about?, stories? }`, top to bottom; each one is a band |
| `releases[].stories` | map | `{}` | step label or id → list of stories (label or `{ id?, label, about?, focal?, muted? }`) |

```storymap
id: shop
activities:
  - { label: Find, about: "Getting to the right product.", steps: [Search, Browse] }
  - { label: Buy, about: "Paying for the basket.", steps: [Pay] }
releases:
  - { label: MVP, about: "Order end to end.", stories: { Search: [By name], Browse: [Aisles], Pay: [Card] } }
  - { label: Next, stories: { Search: [Diet filters] } }
```

The line under the first release is the release cut (2px ink, tagged). Faint rules separate the step columns. From 7 steps on the columns narrow to 96px, so 8 steps fit the page. **Card:** a release shows "n stories · covers k of 8 steps", and the steps it leaves empty show as chips and as "no story" slots in its row while it is selected. An activity shows its steps and a count per release. A story shows the activity › step breadcrumb and its release, and the other stories under the same step stay readable.

**Budget:** 5 activities, 3 releases, 20 stories, 8 steps (`budget-nodes`). More than 12 steps is an error. `check` warns when the first release skips a step.
**Expanded view:** a note on the first release (linked) and one on the deferred story that matters most.
**Anti-patterns:** a first release that skips a step (the slice has to cross the whole backbone); technical tasks as stories; one release per sprint (use Now / Next / Later).
