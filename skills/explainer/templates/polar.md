---
title: Support tickets by weekday
chrome: title
---

[Monday brings about 60% more tickets than Thursday](#tickets-by-day-monday+tickets-by-day-thursday), so the extra support shift belongs at the start of the week.

```polar
id: tickets-by-day
format: int
unit: tickets
cycle: week
notes:
  - on: [tickets-by-day-monday, tickets-by-day-thursday]
    text: "Monday 412 against Thursday 254: 62% more, and a quarter of the week's tickets."
  - on: tickets-by-day-saturday
    text: "The weekend brings 192 tickets over two days; one person covers the queue."
caveat: "Four weeks of March; a release week or a billing change would move the shape."
data:
  - { label: Monday, value: 412, focal: true, about: "Weekend sign-ups meet their first invoice on Monday morning, so billing questions pile up." }
  - { label: Tuesday, value: 318, about: "The Monday backlog spills over until about noon." }
  - { label: Wednesday, value: 276, about: "A typical midweek day, mostly how-to questions." }
  - { label: Thursday, value: 254, about: "The quietest weekday, even with release notes going out in the afternoon." }
  - { label: Friday, value: 231, about: "Volume drops after lunch as teams wrap up the week." }
  - { label: Saturday, value: 88, about: "Only urgent access problems; one person covers the queue." }
  - { label: Sunday, value: 104, about: "Slightly above Saturday as admins prepare for the week." }
```
