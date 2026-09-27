---
title: What a delivery app should build
chrome: title
---

[Recommendations](#recs) are the only part still built from scratch in-house, and they are the one to move toward a bought product.

```wardley
id: delivery-map
components:
  - { id: customer, label: Hungry customer, visibility: 0.97, evolution: 0.62, about: "The user need that anchors the map: a hot meal, fast." }
  - { id: ordering, label: Ordering app, visibility: 0.82, evolution: 0.52, about: "The screens customers use to browse, order and track; this is where the brand competes." }
  - { id: recs, label: Dish recommendations, visibility: 0.72, evolution: 0.18, focal: true, moving_to: 0.55, about: "Built from scratch today; comparable products now exist and cost less to run." }
  - { id: routing, label: Courier routing, visibility: 0.53, evolution: 0.4, about: "Custom logic that matches couriers to orders; it still sets the service apart." }
  - { id: payments, label: Payments, visibility: 0.5, evolution: 0.84, about: "Handled by a payment provider; no reason to build it." }
  - { id: menus, label: Menu data, visibility: 0.38, evolution: 0.5, about: "Restaurant menus kept up to date by a small internal team." }
  - { id: maps, label: Maps, visibility: 0.28, evolution: 0.8, about: "A licensed mapping service used for addresses and travel times." }
  - { id: hosting, label: Cloud hosting, visibility: 0.1, evolution: 0.93, about: "Rented compute and storage, billed by use." }
links:
  - customer -> ordering
  - ordering -> recs
  - ordering -> payments
  - ordering -> routing
  - recs -> menus
  - routing -> maps
  - menus -> hosting
  - routing -> hosting
notes:
  - { on: recs, text: "The dashed arrow is the recommendation: replace the in-house engine with a bought product, moving it from Genesis to Product." }
  - { on: hosting, text: "Everything it would rely on is already rented: menu data runs on the same commodity hosting as routing." }
caveat: Positions are the team's judgement of maturity, not measurements.
```
