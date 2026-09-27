---
title: Why orders ship late
chrome: title
---

Most [late shipments](#late-shipping-effect) start inside the [warehouse process](#late-shipping-process), not with the [carriers](#late-shipping-carriers) that usually get the blame.

```fishbone
id: late-shipping
effect:
  label: Orders ship late
  about: "About one order in eight leaves the warehouse after the promised dispatch day."
categories:
  - label: People
    about: "Who picks and packs, and how ready they are for it."
    causes:
      - { label: New seasonal pickers, weight: 10, about: "Seasonal staff start on the floor after less than a full shift of training." }
      - { label: Thin evening shift, weight: 8, about: "Orders placed after 4 pm wait for a shift that runs at half strength." }
  - label: Process
    about: "How an order moves from the queue to the loading dock."
    causes:
      - { label: Labels printed by hand, weight: 18, about: "Each label is printed one at a time, so packing stalls whenever the printer jams." }
      - { label: Picking in large batches, weight: 15, about: "Batches wait until they are full, so early orders sit for hours." }
      - { label: No order cut-off time, weight: 12, about: "Without a cut-off, late orders jump into batches that were already closing." }
  - label: Tools
    about: "The software and devices the floor depends on."
    causes:
      - { label: Slow scanner app, weight: 9, about: "Each scan takes about two seconds, which adds minutes to every large order." }
      - { label: Stale stock counts, weight: 7, about: "Counts sync overnight, so pickers walk to empty shelves during the day." }
  - label: Carriers
    about: "The companies that collect parcels at the dock."
    causes:
      - { label: Missed pickups, weight: 12, about: "A carrier skips a collection about once a fortnight, holding a day's parcels." }
      - { label: Wrong service level, weight: 9, about: "Some express orders are booked on standard service by mistake." }
notes:
  - { on: [late-shipping-process, late-shipping-labels-printed-by-hand, late-shipping-picking-in-large-batches, late-shipping-no-order-cut-off-time], text: "Process carries the most weight: hand-printed labels, large batches and no cut-off together cause 45% of late orders." }
  - { on: late-shipping-carriers, text: "Carriers, the usual suspect, account for about a fifth: missed pickups and wrong service levels." }
```
