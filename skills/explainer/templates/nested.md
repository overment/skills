---
title: What the online store is made of
chrome: title
---

[Checkout](#store-parts-checkout) is the smallest area of the store, but it holds [the only part that touches money directly](#store-parts-payment-form).

```nested
id: store-parts
root:
  label: Online store
  about: "Everything a shopper and the shop team use, grouped by the area that owns it."
  children:
    - label: Storefront
      about: "What shoppers see before they decide to buy."
      children:
        - { label: Product pages, about: "One page per item with photos, sizes and stock level." }
        - { label: Search, about: "Finds items by name, category and colour; most visits start here." }
        - { label: Cart, about: "Keeps chosen items for seven days, even across devices." }
    - label: Checkout
      about: "The steps between a full cart and a confirmed order."
      children:
        - { label: Payment form, focal: true, about: "The only screen that handles card details, so it gets the strictest security review." }
        - { label: Address check, about: "Corrects typos in postcodes before the order reaches the warehouse." }
    - label: Back office
      about: "Tools the shop team uses behind the scenes."
      children:
        - { label: Inventory, about: "Stock levels per warehouse, updated with every sale and delivery." }
        - { label: Refunds, about: "Where the team approves money going back to shoppers." }
        - { label: Sales reports, about: "Daily and weekly totals by product and channel." }
notes:
  - { on: [store-parts-checkout, store-parts-payment-form], text: "Checkout holds two of the eight parts, and one of them, the payment form, is the only screen that handles card details." }
```
