---
title: Store system map
chrome: title
width: wide
---

All traffic enters through the [API gateway](#gateway). Nothing in the [private network](#private) is reachable from the internet except through the gateway's three calls, to [Catalog](#gateway->catalog), [Cart](#gateway->cart) and [Orders](#gateway->orders). Only one call leaves it: [Orders charging the payment provider](#orders->payments).

```figure
id: store-map
layout: zones
grid: [5, 3]
nodes:
  shopper:  { label: Shopper, at: [0, 1], kind: actor, about: "Browses and buys from a phone or a laptop. Everything they do arrives through the API gateway; they never reach a service directly." }
  gateway:  { label: API gateway, at: [1, 1], focal: true, about: "The only public entry point. Checks sessions and rate limits before routing a request inward." }
  catalog:  { label: Catalog, at: [2, 0], about: "Serves products and prices to every page. It is read far more than written, so answers are cached for a minute: a price change can take that long to show." }
  cart:     { label: Cart, at: [2, 1], about: "Holds what a shopper intends to buy. Empties after seven days without a visit." }
  orders:   { label: Orders, at: [2, 2], about: "Creates orders and takes payment. The only service allowed to call the payment provider." }
  products: { label: Product DB, at: [3, 0], kind: store, about: "Product details and prices. Written by the back office and read by Catalog." }
  orderdb:  { label: Order DB, at: [3, 2], kind: store, about: "Every order and its status, written only by Orders. It is backed up every hour, so at worst an outage loses the last hour of changes." }
  payments: { label: Payment provider, at: [4, 2], kind: external, about: "Charges cards on our behalf and runs outside our network. Card numbers go straight to it, so our own systems never store or see them." }
edges:
  - shopper -> gateway: requests
  - gateway -> catalog
  - gateway -> cart
  - gateway -> orders
  - catalog -> products: reads
  - cart -> orders: checks out
  - orders -> orderdb: writes
  - orders => payments: charges
groups:
  public:  { label: Public, from: [0, 1], to: [1, 1], kind: zone }
  private: { label: Private network, from: [2, 0], to: [3, 2], kind: trust }
notes:
  - { on: private, text: "Three connectors cross into the private network, and all three start at the API gateway." }
  - { on: orders->payments, text: "The only connector that leaves the private network." }
caveat: Back-office access, backups and monitoring are left out.
```

## Access

Each service touches only the data it owns. [Orders](#orders) is the only column with more than one ✓, because it is the one service that [writes orders](#write-orders) and [calls the payment provider](#call-payments). Select a cell for the rule in words.

::: split 2fr 1fr
```matrix
id: access
title: What each service can reach
corner: Permission
columns: [catalog, cart, orders]
rows:
  - { id: read-products, label: Read Product DB, cells: { catalog: yes, cart: no, orders: no } }
  - { id: write-orders, label: Write Order DB, cells: { catalog: no, cart: no, orders: yes } }
  - { id: call-payments, label: Call the payment provider, cells: { catalog: no, cart: no, orders: yes } }
  - { id: personal-data, label: See personal data, about: Cart knows who the shopper is but never sees an address or card., cells: { catalog: no, cart: partial, orders: yes } }
```
```detail
```
:::
