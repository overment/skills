---
title: Where the disciplines meet
chrome: title
---

[Prototyping](#team-overlap-product-design-engineering) is the only work that needs [product](#product), [design](#design) and [engineering](#engineering) in the room together, so it gets the shared weekly slot.

```venn
id: team-overlap
notes:
  - on: [team-overlap-product-design-engineering, product, design, engineering]
    text: "The only work that needs all three disciplines at once, and it stalls as soon as one is missing."
  - on: team-overlap-design-engineering
    text: "Design system work needs no product input, so it keeps its own schedule."
caveat: "Circles are drawn the same size: they don't show how much of each discipline's work sits in an overlap."
sets:
  - { id: product, label: Product, about: "Owns the problem and the priority, and decides what is worth building this quarter." }
  - { id: design, label: Design, about: "Owns how the product feels to use, from research to final screens." }
  - { id: engineering, label: Engineering, about: "Owns how it is built and run, including cost and reliability." }
overlaps:
  - { sets: [product, design], label: Discovery, about: "Interviews and problem framing; engineering joins once a direction exists." }
  - { sets: [design, engineering], label: Design system, about: "Shared components and tokens, maintained without product input." }
  - { sets: [product, engineering], label: Roadmap, about: "Sequencing and scope cuts, traded against technical risk." }
  - { sets: [product, design, engineering], label: Prototyping, focal: true, about: "Stalls as soon as any one discipline is missing." }
```
