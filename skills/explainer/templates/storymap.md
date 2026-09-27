---
title: Online grocery ordering
chrome: title
---

[The first release](#grocery-map-mvp) is a thin slice through every step, so a shopper can find, pay for and receive groceries end to end, with [next-day delivery](#grocery-map-next-day-slots-only) as the only option.

```storymap
id: grocery-map
notes:
  - on: grocery-map-mvp
    text: "One story under each of the eight steps: the smallest version a shopper can use to order end to end."
  - on: grocery-map-same-day-slots
    text: "The deferred story that matters most. Same-day delivery waits until next-day demand is known."
activities:
  - label: Find products
    about: "Getting from a shopping list to the right items on screen."
    steps:
      - { label: Search, about: "Typing what they want and getting the right product first." }
      - { label: Browse aisles, about: "Wandering by category, the way people shop in a store." }
  - label: Fill the basket
    about: "Choosing quantities and changing their mind."
    steps:
      - { label: Add items, about: "Putting products in the basket in the right amount." }
      - { label: Edit basket, about: "Reviewing the basket before paying." }
  - label: Check out
    about: "Committing to a delivery time and paying."
    steps:
      - { label: Pick a slot, about: "Choosing when the groceries arrive." }
      - { label: Pay, about: "Paying for the order without leaving the page." }
  - label: Get the delivery
    about: "Everything after payment until the bags are in the kitchen."
    steps:
      - { label: Track, about: "Knowing where the order is and when it will arrive." }
      - { label: Receive, about: "The handover at the door." }
releases:
  - label: MVP
    about: "The smallest version a shopper can use to order end to end."
    stories:
      Search: [{ label: Search by name, about: "Exact and partial product names; no typo tolerance yet." }]
      Browse aisles: [{ label: Top-level aisles, about: "Twelve aisles with no sub-categories, enough for a first order." }]
      Add items: [{ label: Add with quantity, about: "A plus and minus control on every product tile." }]
      Edit basket: [{ label: Remove an item, about: "The one edit every shopper needs before paying." }]
      Pick a slot: [{ label: Next-day slots only, focal: true, about: "One delivery day keeps the warehouse plan simple while demand is unknown." }]
      Pay: [{ label: Card payment, about: "Cards through the payment provider's hosted form." }]
      Track: [{ label: Confirmation email, about: "Order summary and delivery window, sent at payment." }]
      Receive: [{ label: Doorstep handover, about: "The driver hands the bags over and marks the order delivered." }]
  - label: Next
    about: "Features that make a second and third order faster."
    stories:
      Search: [{ label: Diet filters, about: "Vegan, gluten-free and other filters on search results." }]
      Browse aisles: [{ label: Offers aisle, about: "Every discounted product in one place." }]
      Add items: [{ label: Reorder last basket, about: "One tap to start from the previous order." }]
      Pick a slot: [{ label: Same-day slots, about: "Afternoon delivery for orders placed before 10 am." }]
      Pay: [{ label: Saved cards, about: "Pay with a stored card and skip the form." }]
      Track: [{ label: Live driver map, about: "The van's position during the final hour." }]
  - label: Later
    about: "Ideas worth keeping that no one is committed to yet."
    stories:
      Search: [{ label: Voice search, about: "Adding items by speaking while cooking." }]
      Add items: [{ label: Shared family basket, about: "Several people add to one basket before it is paid." }]
      Pay: [{ label: Pay with vouchers, about: "Store credit and gift vouchers at checkout." }]
      Receive: [{ label: Approve substitutions at the door, about: "The shopper accepts or rejects swapped items before the driver leaves." }]
```
