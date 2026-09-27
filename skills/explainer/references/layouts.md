# Layouts

The `layout` key names the pattern; you still place every node with `at`. Pick the layout that matches the question the reader is asking, then follow its grid pattern. Cells are `[col, row]`. Every layout shares the budget of 9 nodes, 12 connectors and 2 focal parts.

The layout also steers routing. In `tree`, `layers` and `states`, a connector to a node in a lower row leaves from the bottom edge, so parents fan down to children and interruptions drop out of the main path. Every other grid layout leaves from the side facing the target. `sequence` has its own renderer. Run `gallery` to see every layout rendered.

What the router guarantees, and what it warns about instead of drawing badly:

- Connectors run through the gutters and never through a node. Among the clear routes it takes the shortest one with the fewest bends that crosses no other connector; the ring outside the grid is the last resort. When two connectors must cross, the less important one (async, then reply) jumps the other.
- Connectors sharing a side are ordered by where they head, so a route that turns up takes the upper slot. Two routes share a gutter lane unless their runs overlap.
- A label sits beside its own line, at least 8px from every other connector and zone border. When the only free spot is on another line, `check` warns (`edge-label`): move the nodes apart rather than accept a hidden line.
- A `decision` node is a diamond, and its connectors leave from its vertices: sideways only to a node on its own row, from the top or bottom vertex otherwise. It has room for a short label and no `sub`.
- The layout also sets the card. Selecting a part shows its relations in the author's words, in reading order ("confirms ←", "charges card →"). Unlabelled connectors get a bare arrow, never an invented verb. The facts under the title are computed per layout; each section below lists them.

Every layout takes `notes:` (up to 4 `{on: id, text}`; `on` may be a node, a group or a connector id such as `orders->payments`) and `caveat:`. The notes are numbered on the figure and listed beside it in the expanded view.

## flow

**Use when** something moves through parts in order: a request, an order, a document.

```
row 0                 [Search]
row 1   [App] → [Gateway] → [Orders] → [Payments]
row 2                       [Orders DB]
```

- **Pattern:** the main path runs left to right on one row. Side effects (stores, background jobs) hang below the node that causes them, and external calls sit at the far right.
- **Budget:** 4–5 nodes on the main row, 1–3 off it.
- **Card:** what comes in and what goes out, how many parts are downstream and upstream. Parts two or more hops downstream stay undimmed, which answers "what breaks if this is down". A connector names its paired reverse connector.
- **Anti-patterns:**
  - Snaking the path back across rows.
  - Putting every store on the main row.
  - Arrows pointing both ways between the same pair when one `-->` reply would do.
- **Starts from:** `single-figure`, `explainer`, `walkthrough`.

## layers

**Use when** the answer is "what sits on top of what": client, API, services, data.

```
row 0   [   Web   ]  [ Mobile ]
row 1   [        API  (span 2)        ]
row 2   [ Orders DB ] [ Search index ]
```

- **Pattern:** one row per tier, top to bottom from the user to the data. Tiers start in column 0; a node that serves a whole tier spans it (`span: [3, 1]`). Side services sit in the next free column beside the tier they serve, not further out. Connectors mostly run downward. Tiers get tags L1, L2… in the left margin.
- **Budget:** 3–4 tiers, and at most 3 nodes per tier.
- **Card:** "Tier 2 of 4", the tiers above and below and the side services instead of arrows, and the path a request takes to reach the tier ("Reached through Browser › Edge cache"). That path stays lit.
- **Anti-patterns:**
  - Connectors that skip a tier without a reason worth a label.
  - Groups around each tier: the rows already group them.
- **Starts from:** `single-figure`. Set `layout: layers`.

## hub

**Use when** one part is the centre everything talks to: a message bus, a gateway, a shared database.

```
row 0   [Billing]         [Search]
row 1            [  Bus  ]
row 2   [Orders]          [Email]
```

- **Pattern:** the hub is at the centre cell and focal. Satellites go in the surrounding cells, leaving the cells directly beside the hub empty when connectors need room to turn. Arrows follow the data: a satellite that writes points at the hub, one that reads is pointed at (`memory -> writer: plan`), never `writer -> memory: reads`. Label edges only when their meanings differ.
- **Budget:** at most 6 satellites. More means the satellites need grouping or a second figure.
- **Card:** the hub lists its satellites grouped by the connector's words ("writes ←", "feeds →") and how many parts it connects. A satellite keeps its peers undimmed and names how many share the hub.
- **Anti-patterns:**
  - Satellite-to-satellite edges that turn the hub into a mesh.
  - Several focal parts: the hub is the one.
- **Starts from:** `single-figure`. Set `layout: hub`.

## states

**Use when** the question is the lifecycle of one thing: an order, a ticket, a deploy.

```
row 0   [Open] → [Assigned] → [Waiting] → [Solved]
row 1                ↑             ↓
row 2                └─ [Reopened] ┘
```

- **Pattern:**
  - Nodes are states; edges are transitions labelled with the event (`agent replies`, `customer writes`).
  - The happy path runs across the top row, with exceptions below.
  - Terminal states sit at the right edge.
  - Use the `boundary` or `optional` kind for states that not every item passes through.
  - Draw exception paths with `-->`: in this layout the legend calls them EXCEPTION, and plain transitions TRANSITION.
  - A branch on a condition is a `kind: decision` diamond with labelled outgoing transitions.
  - A dot marks each start state (nothing enters it), and a double border marks each final state (nothing leaves it).
- **Budget:** at most 7 states. Every transition label follows the 3-word limit.
- **Card:** "State · start/final", the transitions in and out, how many states are still reachable, and which states no longer are ("Can no longer reach: Cart, Placed"). Every state still reachable stays undimmed, so "can a paid order still be cancelled?" is answered by looking.
- **Anti-patterns:**
  - Mixing states with the services that change them.
  - Unlabelled transitions: in this layout the event is the point.
- **Starts from:** `single-figure`. Set `layout: states`.

## zones

**Use when** where things run matters: networks, trust boundaries, teams, vendors.

```
        ┌ PUBLIC ─────────┐  ┌ PRIVATE NETWORK ────────┐
row 0   │                 │  │ [Catalog]  [Product DB] │
row 1   │ [Shopper] [Gate]│  │ [Cart]                  │  [Payments]
row 2   │                 │  │ [Orders]   [Order DB]   │
        └─────────────────┘  └─────────────────────────┘
```

- **Pattern:**
  - Each zone is a group spanning whole columns, and zones sit left to right from outside to inside.
  - Use `kind: trust` for the security boundary and `kind: zone` for plain areas.
  - Third parties sit outside every group.
  - The part that crosses the boundary is usually focal.
  - The group label sits on the top border, like a fieldset legend.
- **Budget:** 2–3 groups; at most 4 nodes per group.
- **Card:** a zone (click its label or border) lights the connectors that cross its border, lists the parts reached from outside ("Crossing in from API gateway: Catalog, Cart, Orders") and what leaves it, and keeps its internal connectors undimmed. A node shows its zone as a breadcrumb and keeps it undimmed.
- **Anti-patterns:**
  - Groups nested inside groups.
  - A group around a single node.
  - Zones that cut through a node.
- **Starts from:** `system-map`.

## tree

**Use when** the answer is a breakdown: ownership, a module hierarchy, a decision tree.

```
row 0              [Platform]
row 1     [Storefront]      [Back office]
row 2   [Cart] [Search]   [Catalog] [Reports]
```

- **Pattern:** the root is centred on row 0 (span it if it needs width), with children on the next row under their parent. Each parent drops one bus to its children: a line means "contains", so it has no arrowhead and isn't selectable. Levels get tags L1, L2… in the left margin.
- **Budget:** at most 3 levels, and 4 children per parent.
- **Card:** selecting a part lights its ancestors and its whole subtree, shows the ancestors as a breadcrumb, and counts descendants. The root lists each top-level branch with its size.
- **Anti-patterns:**
  - Cross-links between branches: that's a flow, so switch layouts.
  - Leaves that only restate their parent.
- **Starts from:** `single-figure`. Set `layout: tree`.

## cycle

**Use when** a process repeats: a release loop, a feedback loop, a retry cycle.

```
row 0   [Plan]  → [Build]
row 1     ↑          ↓
row 2   [Learn] ← [Ship]
```

- **Pattern:** a ring on a 2 × 2 or 3 × 2 grid, running clockwise from the top-left. Each edge is the hand-off between phases, and one exit edge leaves the ring where the loop can end.
- **Budget:** 3–6 phases.
- **Card:** "Phase 3 / 4" in the order of the loop (the first scene's path when there is one), with the hand-in and the hand-off in the author's words.
- **Anti-patterns:**
  - Spokes into the middle of the ring.
  - A cycle that never repeats in reality: use `flow`.
- **Starts from:** `single-figure`. Set `layout: cycle`.

## sequence

**Use when** order in time matters more than place: who calls whom, and what comes back.

```
   [Browser]   [Web app]   [Auth]   [Email]
       │ enters email │         │        │
       │──────────────▶ requests link    │
       │              │─────────▶ sends link
       │              │         │════════▶
       │              │◀ ─ ─ ─ ─│ returns session
```

- **Pattern:** actors go left to right in the order they first act, and messages run top to bottom. Use `-->` only for replies that carry something the reader needs, and `=>` for calls to third parties. `~>` draws an async message with an open head.
- **Drawn:** a bar on a lifeline shows when that actor is busy: from a message it receives to the last message it takes part in without a break. In the expanded view every message carries its number, so a prose link to `#m6` is easy to find. Message ids are `m1`, `m2`… in order.
- **Labels:** a message label sits between two neighbouring lifelines inside the message's span, never on a lifeline. A label wider than that gap warns; shorten it or move the actors apart.
- **Width:** at most 960px, so the card docks beside it in the column. Four or five actors close up to fit (lifelines 240px or 184px apart instead of 264px), which leaves less room for each label.
- **Budget:** at most 5 actors. At most 12 messages; aim for 7. Actors take the node fields except `kind: decision`: a branch in time goes into a message label, or into a `states` figure.
- **Card:** "Message 3 / 7 · external call" with previous and next chips to walk the exchange, the reply that answers a request (or the request a reply answers). An actor lists its messages in time order with the other party ("2 ← Web app") and when it is busy.
- **Anti-patterns:**
  - A reply drawn for every call.
  - Internal helper calls inside one actor.
  - Two sequence figures in one document: message ids would collide.
- **Starts from:** `sequence`.

## Beside a figure: matrix and compare

A `matrix` or a `compare` next to a figure answers what the figure can't draw: who may do what, and how the options differ.

- **matrix:** columns that name figure parts (`columns: [draft, review, publish]`) take the part's label. Selecting a column lights its part in the figure and counts what it allows ("Allows 2 of 4"). Selecting the part lights only its own column; a neighbour of the part never lights it. Every cell is selectable and reads as a rule ("Review queue can change the headline"). Its id is `<row>.<column>`, so prose can link the claim itself: `[can only schedule](#schedule.publish)`.
- **compare:** `dimensions: [Delay, Needs]` (or `{id, label}`) adds one row per dimension to every card, aligned across cards, filled from each item's `values: {delay: about 1 s}`. Selecting a row selects it on every card and, when every value is a number in the same unit, shows the difference ("−29 s · 30× lower"). Its id is `<compare>-<dimension>`. `on: endpoint` links an item to a figure part: selecting the item lights the part, and the part's card names the item.
- Both take `notes:` and `caveat:` for the expanded view.
