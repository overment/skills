# Structures: maps

Four types for how things are arranged: who does which step (`swimlane`), why a problem happens (`fishbone`), where parts sit on the path from novel to commodity (`wardley`), and what contains what (`nested`). Every item takes `about`; the card shows it on click, next to computed facts and relations the diagram doesn't print.

Every block here also takes the shared reading keys for the expanded view: `notes` (up to 4 `{on: id | [ids], text}`; the first `on` id gets a numbered marker on the graph), `caveat` (one sentence on what the diagram doesn't show) and `story` (see format.md). An id in `notes` or `story` that is not an element of the same block is a `ref-exists` error.

No label is ever crossed by a line. Labels are placed next to their mark with at least 2px of clear space around them, and each type warns when it can't manage that.

## swimlane

**Use when** a process crosses teams or systems and the handoffs between them are the story.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id; prefixes auto lane and handoff ids |
| `title` | string | — | caption, hidden in bare view |
| `lanes` | list | required | rows, top to bottom; a bare string is `{ label }` |
| `lanes[].id` | string | `<id>-<label-slug>` | steps may use the id or the label |
| `lanes[].label` | string | required | the owner: team, role or system |
| `lanes[].about` | string | — | card text |
| `steps` | list | required | boxes in lane × column cells |
| `steps[].id` | string | required | unique in the document; links use it |
| `steps[].label` | string | required | verb phrase, 2 lines at most (about 24 chars) |
| `steps[].lane` | string | required | lane id or label |
| `steps[].col` | int ≥ 0 | previous step's col + 1 | column is order in time; the same col in two lanes means parallel |
| `steps[].kind` | `task`\|`decision`\|`event` | `task` | box, diamond, pill (start/end) |
| `steps[].wait` | string | — | how long the step waits before it starts ("up to 5 days"); shown in its card and its handoff's card |
| `steps[].about` | string | — | card text |
| `steps[].focal` | bool | false | accent; one per block |
| `links` | list | `[]` | `- a -> b`, `- a -> b: label`, `- a --> b` (return, dashed) |

```swimlane
id: signup
lanes: [Visitor, App, Email service]
steps:
  - { id: fill, label: Fills the form, lane: Visitor, kind: event, about: "Name, email and password." }
  - { id: create, label: Creates the account, lane: App, about: "Stored unverified." }
  - { id: send, label: Sends the link, lane: Email service, wait: under a minute, about: "Expires after 24 hours." }
links:
  - fill -> create
  - create -> send
```

**Budget:** 5 lanes, 12 steps, 12 links, 5 columns, 1–2 focal. Above 5 columns the block warns: at a 1,080px page it would scroll, so give parallel steps the same `col` or split the flow at a handoff.

**Layout:** cell 144×56 with a 56px column gap. A decision sends each branch out of its own vertex: down-lane from the bottom, up-lane from the top, same lane from the right. Handoffs turn in the column gap. When the lanes on the way are busy, a link runs along the lane's padding band instead of through a step, and parallel runs take separate tracks. A link back to another lane leaves the top or bottom of its step, so it never shares a side with the forward links. A branch label rests just above its own line, on the longest straight run that has room, and `edge-label` warns when no clear spot exists. `route` warns when a link still runs through a step or on top of another link.

**Relations:** selecting a lane lights every link with an end in it, so handoffs in and out are part of the lane. Every lane-to-lane handoff also gets an id, `<id>-<from lane>-to-<to lane>` (for example `refund-flow-support-to-finance`), that prose can link to: it lights the handoff's links and the steps at both ends. A step's card shows its lane, the handoff it came from and its `wait`. A decision's card lists its branches as "If yes" and "If no".

**Anti-patterns:** one lane per person when the role is what matters; one step per click or API call; a label on every arrow, when only decision branches (`yes`/`no`) need one.

## fishbone

**Use when** a problem has many contributing causes and the point is to show where they come from.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id |
| `title` | string | — | caption |
| `effect` | string \| `{ label, about }` | required | the problem at the head; always focal; id `<id>-effect` |
| `categories` | list | required, 2–6 | bones, alternating top/bottom from left to right |
| `categories[].id` | string | `<id>-<slug>` | group id |
| `categories[].label` | string | required | one or two words: People, Process, Tools… |
| `categories[].about` | string | — | card text |
| `categories[].causes` | list | required, 1–3 | text, or `{ id?, label, about, focal?, weight? }` |
| `causes[].focal` | bool | false | the root cause; at most one (the head already carries the accent) |
| `causes[].weight` | number ≥ 0 | — | how much the cause contributes (share of incidents, hours lost); give it to every cause or none |

```fishbone
id: slow-page
effect: Checkout page loads slowly
categories:
  - { label: Frontend, causes: [Large images, Blocking scripts] }
  - { label: Backend, causes: [Uncached prices] }
```

**Budget:** 6 categories × 3 causes. Keep a cause to about 4 words.

**Layout:** every bone has its own joint on the spine, so a bone's labels have the whole run back to the previous bone on the same side. The spine starts just before the first tick. Labels on upper bones end further left, because those bones lean left as they rise.

**Relations:** the effect is related to every category and cause, and a cause lights its category and the effect. A category's card counts its causes and lists the other categories with their counts. With weights, the effect's card ranks the top causes and each category shows its share.

**Anti-patterns:** causes that restate the effect ("slow load"); one category holding everything; sentences on the bones, which belong in `about`.

## wardley

**Use when** deciding what to build, buy or outsource. Position shows how visible a part is to the user and how mature it is.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id |
| `title` | string | — | caption |
| `components` | list | required | dots |
| `components[].id` | string | `<id>-<slug>` | links may use the id or the label |
| `components[].label` | string | required | the capability, not the vendor |
| `components[].visibility` | 0–1 | required | 1 = the user sees it (top), 0 = deep infrastructure |
| `components[].evolution` | 0–1 | required | stage columns: <.25 Genesis, <.5 Custom, <.75 Product, else Commodity |
| `components[].moving_to` | 0–1 | — | future evolution; dashed arrow to a ghost dot |
| `components[].inertia` | bool | false | a bar beside the dot: something resists the move |
| `components[].about` | string | — | card text |
| `components[].focal` / `muted` | bool | false | accent / context |
| `links` | list | `[]` | `- a -> b` means a needs b; no labels |

```wardley
id: blog
components:
  - { id: reader, label: Reader, visibility: 0.95, evolution: 0.6 }
  - { id: cms, label: Publishing, visibility: 0.7, evolution: 0.4, moving_to: 0.7 }
  - { id: host, label: Hosting, visibility: 0.15, evolution: 0.9 }
links: [reader -> cms, cms -> host]
```

**Budget:** 12 components, 14 links, 2 movements, 2 inertia bars, 1–2 focal.

**Layout:** links run straight from dot edge to dot edge. Where several links meet one dot, their ends are spread at least 3.5px apart on its rim, so each one stays distinguishable. Each label tries 24 spots around its dot, two rings of 12, anchored on the side facing the dot. The score punishes a link through the label (its own link most), near misses under 6px, trails, stage rules and the side its links leave from. Busy components are placed first, then three sweeps improve the result. If every spot is crossed, the label moves out on a thin leader line. If that fails too, `label-fit` names the link that crosses it. Labels carry a halo in the page colour, and stage rules stop short of any label. Axis words are horizontal. A dashed movement trail is cased in the page colour, so links crossing it look broken, and the ghost is filled with the page colour.

**Lints** (warnings; the data is never moved for you):
- `link-implied`: a link the chain already implies (a → c when a → b → c exists). Drop it.
- `link-bundle`: two links meet a dot less than 4° apart and read as one line.
- `link-near-dot`: a link passes within 6px of another component's dot or ghost, so it looks connected to it.
- `move-boundary`: a ghost sits on a stage boundary, so its target stage is ambiguous. Use 0.05 either side.
- `move-left`: `moving_to` is less evolved than `evolution`.

If you get a `label-fit` warning, move the component by about 0.05.

**Relations:** a component's card lists what it needs and what needs it. It shows its path up the value chain to the user, which answers "does the user see this?", and its visibility rank. Every component above it in the chain stays at rest as context while the rest dims. A link's card shows the stages it spans. The four stage headers under the axis are selectable (`<id>-stage-genesis`, `-custom`, `-product`, `-commodity`). Each one lights its components and names anything moving into it.

**Anti-patterns:** vendor names as components; everything in Custom; arrows for data flow, when links are dependencies only; a link for every dependency the chain already implies.

## nested

**Use when** the point is containment: parts inside areas inside a system, such as teams in departments or modules in services.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id |
| `title` | string | — | caption |
| `root` | map | required | the outermost box |
| `*.id` | string | `<id>-<slug>` | any box |
| `*.label` | string | required | container: header strip (mono caps); leaf: centered label |
| `*.children` | list | `[]` | boxes inside, in reading order; a bare string is a leaf |
| `*.about` | string | — | card text |
| `*.focal` / `*.muted` | bool | false | accent / context |

```nested
id: app
root:
  label: Mobile app
  children:
    - { label: Account, children: [Sign-in, Profile] }
    - { label: Shop, children: [Catalog, Cart] }
```

**Budget:** 20 boxes, 4 levels.

**Layout:** children pack left to right in rows. Boxes keep their natural height, top-aligned, so a container with fewer parts is visibly smaller. All leaves in one container share one width, and a leaf that wraps to a new row never stretches. Each level is tinted one step further from the page, and leaves are raised above every container in both themes.

**Relations:** selecting a container lights its whole subtree; its siblings dim. Its card shows the breadcrumb, how many of the parts it holds, and its children as chips. Selecting a leaf keeps its containers at rest as context and shows the containing chain.

**Anti-patterns:** a container with one child (merge them); using nesting to show a flow (use a figure); deep trees shown in full, when you should show two levels and give each area its own block.
