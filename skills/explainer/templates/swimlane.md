---
title: How a refund gets approved
chrome: title
---

A refund spends most of its time waiting at [the handoff from Support to Finance](#refund-flow-support-to-finance), so [Finance's approval](#approve) is the step to speed up first.

```swimlane
id: refund-flow
lanes:
  - { id: customer, label: Customer, about: "The shopper who wants money back for an order." }
  - { id: support, label: Support, about: "The team that answers the request and checks it against the refund policy." }
  - { id: finance, label: Finance, about: "The team that releases money, once a week in a payout run." }
steps:
  - { id: ask, label: Asks for a refund, lane: customer, kind: event, about: "The request arrives through the help form with the order number attached." }
  - { id: eligible, label: Within policy?, lane: support, kind: decision, about: "Support checks the delivery date, the item's condition and how it was paid. Orders older than 30 days or sold as final sale stop here." }
  - { id: refuse, label: Explains refusal, lane: support, about: "The customer gets the reason and an offer of store credit instead." }
  - { id: approve, label: Approves payout, lane: finance, col: 2, focal: true, wait: up to 5 days, about: "Approvals wait for the weekly payout run, which adds up to five days." }
  - { id: pay, label: Sends money back, lane: finance, about: "The money goes back to the original card; banks take two to three days to show it." }
  - { id: paid, label: Gets the money, lane: customer, kind: event, about: "The flow ends when the refund appears on the customer's statement." }
links:
  - ask -> eligible
  - eligible -> refuse: no
  - eligible -> approve: yes
  - approve -> pay
  - pay -> paid
notes:
  - { on: eligible->approve, text: "The slow part: an approved refund waits up to five days here for Finance's weekly payout run." }
  - { on: pay, text: "Once Finance pays, the bank adds two to three days before the customer sees the money." }
```
