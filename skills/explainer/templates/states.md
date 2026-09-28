---
title: The life of an order
chrome: title
---

Most orders go from [Placed](#placed) to [Delivered](#delivered) in one direction and never go back. Only two events break that line: a shopper can [cancel](#placed->cancel) before paying, and a delivered order can still be [refunded](#delivered->refund). Press **Play** or use ← → to follow each path.

```figure
id: order-life
layout: states
grid: [5, 3]
nodes:
  cart:      { label: Cart, at: [0, 1], about: "Items the shopper has picked but not committed to. Nothing is reserved yet." }
  placed:    { label: Placed, at: [1, 1], focal: true, about: "The shopper has confirmed the order and stock is held. This is the last point where it can be cancelled for free." }
  paid:      { label: Paid, at: [2, 1], about: "Payment has cleared and the warehouse can start packing. From here the shopper can no longer cancel for free; the only way back is a refund after delivery." }
  shipped:   { label: Shipped, at: [3, 1], about: "The parcel has left the warehouse and has a tracking number. The carrier owns it now, so delays from here on show up in their tracking, not in our systems." }
  delivered: { label: Delivered, at: [4, 1], about: "The carrier has confirmed the handover. The order ends here unless a refund follows." }
  cancel:    { label: Cancelled, at: [2, 2], about: "The order stopped before payment. Held stock goes back on sale, and no money moved, so nothing needs refunding. This state is final." }
  refund:    { label: Refunded, at: [4, 2], about: "The money has gone back to the shopper after delivery. This state is final." }
edges:
  - cart -> placed: checks out
  - placed -> paid: pays
  - paid -> shipped: ships
  - shipped -> delivered: arrives
  - placed --> cancel: cancels
  - delivered --> refund: refunds
scenes:
  happy:
    title: An order that arrives
    path: [cart, placed, paid, shipped, delivered]
    notes:
      cart: The shopper fills the basket.
      placed: Checkout confirms the order and holds stock.
      paid: The card payment clears.
      shipped: The warehouse hands the parcel to the carrier.
      delivered: The carrier confirms the handover.
  cancelled:
    title: An order cancelled before payment
    path: [cart, placed, cancel]
    notes:
      cart: The shopper fills the basket.
      placed: Checkout confirms the order and holds stock.
      cancel: The shopper changes their mind and the stock is released.
notes:
  - { on: placed->cancel, text: "Cancelling is only possible from Placed, before any money moves." }
  - { on: delivered->refund, text: "After delivery the only way back is a refund." }
caveat: Partial refunds, returns and failed payments are not modelled.
```

```steps
for: order-life
scenes: [happy, cancelled]
```

Once an order reaches [Paid](#paid), cancelling no longer applies. From there, the only way to undo it is through [Refunded](#refund), after the parcel has arrived.
