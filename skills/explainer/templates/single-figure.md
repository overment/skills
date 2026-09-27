---
title: How checkout works
chrome: none
mode: auto
width: wide
---

[Checkout](#checkout) is the one part that talks to the [payment provider](#checkout->payments), and it only [queues the receipt](#checkout->receipts), so a slow mail server never holds up a payment.

```figure
id: checkout
layout: flow
title: How checkout works
grid: [5, 2]
nodes:
  shopper:    { label: Shopper, at: [0, 0], kind: actor, about: "Someone with a full cart who presses Pay. Sees a receipt or a clear error within seconds." }
  storefront: { label: Storefront, at: [1, 0], about: "Shows the cart and the final price. Hands the order over once the shopper confirms." }
  checkout:   { label: Checkout, at: [2, 0], focal: true, about: "Turns a cart into an order. Locks the price while the card is charged so it cannot change mid-payment." }
  payments:   { label: Payment provider, at: [4, 0], kind: external, about: "Charges the card on our behalf. We never see the full card number." }
  orders:     { label: Orders DB, at: [2, 1], kind: store, about: "Keeps every order with its status and the price paid at the time." }
  receipts:   { label: Receipts, at: [3, 1], about: "Emails the receipt a moment after payment. A slow mail server never holds up checkout." }
edges:
  - shopper -> storefront: pays
  - storefront -> checkout
  - checkout => payments: charges card
  - payments --> checkout: confirms
  - checkout -> orders: saves order
  - checkout ~> receipts: queues receipt
groups:
  platform: { label: Our platform, from: [1, 0], to: [3, 1], kind: zone }
notes:
  - { on: checkout->payments, text: "Only Checkout talks to the payment provider, so card data never passes through the Storefront." }
  - { on: checkout->receipts, text: "The receipt is queued, not sent: payment finishes even when email is slow." }
caveat: Retries, refunds and failed payments are not shown.
```
