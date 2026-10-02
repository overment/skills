---
title: Orders own their lines, not their payments
chrome: title
shots:
  - sel=checkout-cardpayment
  - sel=checkout-payment-amount
  - sel=checkout-order->checkout-lineitem
---

An [Order](#checkout-order) [owns its line items outright](#checkout-order->checkout-lineitem). Each [Payment](#checkout-payment) [stands on its own](#checkout-order->checkout-payment), so a failed charge stays on record after the order is cancelled.

```uml
id: checkout
classes:
  Customer:
    at: [0, 0]
    attributes: ["+id: UUID", "+email: Email"]
    about: The person who places orders; one customer can hold many.
  Order:
    at: [1, 0]
    attributes: ["+id: UUID", "-status: Status", "-total: Money"]
    operations: ["+pay(p: Payment)", "+cancel()"]
    about: Tracks one checkout from placement to delivery and keeps the running total.
  LineItem:
    at: [2, 0]
    attributes: ["+sku: Sku", "+qty: Int", "+price: Money"]
    about: One product at the price paid; it means nothing outside its order.
  Payment:
    at: [1, 2]
    stereotype: abstract
    focal: true
    attributes: ["#amount: Money"]
    operations: ["+capture()", "+refund()"]
    about: Every attempt to take money, kept even when it fails or the order is cancelled.
  CardPayment:
    at: [0, 4]
    attributes: ["-last4: String"]
    about: A charge through the card provider, captured after authorisation.
  BankTransfer:
    at: [2, 4]
    attributes: ["-reference: String"]
    about: Money the customer sends themselves; it settles in one to three days.
relations:
  - 'Order "0..*" --> "1" Customer : placed by'
  - 'Order "1" *-- "1..*" LineItem'
  - 'Order "1" o-- "0..*" Payment'
  - Payment <|-- CardPayment
  - Payment <|-- BankTransfer
notes:
  - on: checkout-order->checkout-lineitem
    text: Composition, the filled diamond. A LineItem is deleted with its Order and never moves to another one.
  - on: checkout-order->checkout-payment
    text: Aggregation, the hollow diamond. A Payment outlives its Order, which is why cancelling keeps the failed charge.
  - on: checkout-payment-subclasses
    text: CardPayment and BankTransfer both inherit amount, capture() and refund(), so refunds work the same way for both.
caveat: Only the members this story needs are shown; the real classes carry more.
```
