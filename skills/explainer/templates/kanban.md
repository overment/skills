---
title: Sprint board
chrome: title
---

[Review](#sprint-board-review) is the bottleneck: it holds four cards against a limit of three, and the [password reset](#sprint-board-password-reset-by-sms) is stuck there waiting on a security sign-off.

```kanban
id: sprint-board
notes:
  - on: sprint-board-review
    text: "Four cards against a limit of three. Nothing new should enter review until one leaves."
  - on: sprint-board-password-reset-by-sms
    text: "Blocked for nine days, and it still holds one of the three review slots."
columns:
  - { label: To do, about: "Agreed for this sprint but not started, so nothing here is late yet." }
  - { label: In progress, limit: 3, about: "Work someone is building now; the limit keeps each person on one thing." }
  - { label: Review, limit: 3, about: "Built and waiting for a second pair of eyes before it can ship." }
  - { label: Done, about: "Shipped to customers this sprint." }
cards:
  - { label: Saved payment methods, column: To do, tags: [checkout], owner: web, about: "Lets returning shoppers pay without typing their card again." }
  - { label: Order history export, column: To do, tags: [account], owner: backend, about: "A CSV download that business customers ask support for every week." }
  - { label: Delivery slot picker, column: In progress, tags: [checkout], owner: web, about: "Replaces the free-text delivery note with bookable one-hour slots." }
  - { label: Stock sync every 5 min, column: In progress, tags: [inventory], owner: backend, about: "Cuts overselling by refreshing stock far more often than the nightly job." }
  - { label: Password reset by SMS, column: Review, tags: [security], owner: backend, age: 9, blocked: "Security sign-off, no date yet", focal: true, about: "Waiting on a security sign-off with no date, and it holds a review slot the whole time." }
  - { label: Gift card balance, column: Review, tags: [checkout], owner: web, about: "Shows the remaining balance before the shopper applies the card." }
  - { label: Faster search results, column: Review, tags: [search], owner: backend, about: "Moves search to a cached index and halves the typical response time." }
  - { label: Return label in email, column: Review, tags: [returns], owner: web, about: "Attaches the printable label so shoppers stop calling support for it." }
  - { label: Address autocomplete, column: Done, tags: [checkout], owner: web, about: "Fewer typos in addresses means fewer failed deliveries." }
  - { label: Low-stock alerts, column: Done, tags: [inventory], owner: backend, about: "Warns buyers two weeks before a best-seller runs out." }
```
