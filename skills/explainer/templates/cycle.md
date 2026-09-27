---
title: The feedback loop
chrome: title
width: wide
---

Every release is an experiment: we [ship](#ship) it, [measure](#measure) how people use it, [learn](#learn) what the numbers mean, and [decide](#decide) what to change next. The most important step is [Learn](#learn): without it, measuring is just watching the numbers. Press **Play** or use ← → to walk one round.

```figure
id: loop
layout: cycle
grid: [3, 2]
nodes:
  ship:    { label: Ship, at: [0, 0], about: "Puts a small change in front of real users. Small releases keep each round short and easy to read." }
  measure: { label: Measure, at: [2, 0], about: "Tracks what users actually do with the change. Collects usage and support signals for about a week." }
  learn:   { label: Learn, at: [2, 1], focal: true, about: "Turns raw numbers into a finding we can act on. This is where a round pays off or is wasted." }
  decide:  { label: Decide, at: [0, 1], about: "Chooses whether to keep, fix or drop the change. Sets the one thing the next release will test." }
edges:
  - ship -> measure: collects data
  - measure -> learn: spots trends
  - learn -> decide: suggests fixes
  - decide -> ship: picks next
scenes:
  round:
    title: One round of the loop
    path: [ship, measure, learn, decide, ship]
    notes:
      ship: A new checkout button goes live.
      measure: Usage and drop-off are tracked for a week.
      learn: Fewer people abandon their cart.
      decide: Keep the button and test the address form next.
notes:
  - { on: learn, text: "A round pays off or is wasted here: numbers without a finding change nothing." }
  - { on: decide->ship, text: "Each round ends by choosing one thing for the next release to test." }
```

```steps
for: loop
scenes: [round]
```

The loop only works when each round is short. A release that takes months to ship gives [Learn](#learn) one data point a quarter, so the team ends up guessing.
