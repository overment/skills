---
title: How we hear about payments
chrome: title
width: wide
---

We stopped asking the payment provider for news and let it tell us instead. [Webhooks](#webhooks) cut the [delay](#delivery-delay) from up to 30 seconds to about one, and removed the [answers that said nothing changed](#delivery-waste).

```compare
id: delivery
title: Two ways to learn that a payment settled
dimensions:
  - { id: delay, label: Delay }
  - { id: waste, label: Empty answers }
  - { id: needs, label: Needs }
items:
  - id: polling
    label: Polling
    about: What we ran until this year.
    values: { delay: up to 30 s, waste: 9 in 10, needs: a timer per open order }
    points:
      - Asks about every open order every 30 seconds
      - Shoppers wait up to 30 seconds to see "paid"
  - id: webhooks
    label: Webhooks
    focal: true
    about: What we run now.
    on: endpoint
    values: { delay: about 1 s, waste: none, needs: a public endpoint }
    points:
      - The provider calls us once when a payment settles
      - The endpoint checks every signature
notes:
  - { on: delivery-delay, text: "Delay decided it: shoppers saw \"paid\" up to 30 seconds late." }
```

## How it works now

```figure
id: settle
layout: flow
title: A settled payment, end to end
grid: [3, 2]
nodes:
  provider: { label: Payment provider, at: [0, 0], kind: external, about: "Settles the charge with the bank and reports the result exactly once." }
  endpoint: { label: Webhook endpoint, at: [1, 0], focal: true, about: "The one public URL the provider calls. Rejects any message without a valid signature." }
  orders:   { label: Orders, at: [2, 0], about: "Records that the order is paid and when it happened." }
  mailer:   { label: Receipts, at: [2, 1], about: "Emails the receipt once the order is marked paid." }
edges:
  - provider => endpoint: notifies
  - endpoint --> provider: acknowledges
  - endpoint -> orders: marks paid
  - orders ~> mailer: sends receipt
notes:
  - { on: endpoint, text: "The only public URL in the flow; a message without a valid signature stops here." }
```

```note info
If the endpoint doesn't answer within 10 seconds, the provider retries for up to three days. Handling the same message twice must be safe.
```
