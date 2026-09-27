---
title: When support tickets arrive
chrome: title
---

Tickets peak on [Monday mornings](#ticket-load-mon-09-12), and [weekends stay quiet all day](#ticket-load-row-sat+ticket-load-row-sun).

```heatmap
id: ticket-load
format: int
unit: tickets
rows: [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
columns: ["00–06", "06–09", "09–12", "12–15", "15–18", "18–24"]
values:
  - [14, 62, 118, 84, 71, 30]
  - [12, 48, 91, 76, 64, 26]
  - [11, 45, 86, 73, 60, 24]
  - [13, 44, 83, 70, 58, 25]
  - [12, 41, 77, 61, 43, 19]
  - [8, 12, 22, 25, 19, 14]
  - [7, 10, 18, 21, 23, 29]
rowAbout:
  Mon: The weekend backlog lands at once, so the morning block is the busiest window of the week.
  Tue: Volume drops by about a fifth once Monday's backlog is cleared.
  Wed: A typical midweek day, busy late in the morning and tapering after lunch.
  Thu: Almost identical to Wednesday, which makes it the easiest day to staff.
  Fri: Afternoons empty out early as customers wind down for the weekend.
  Sat: Only urgent issues arrive, and most come in around midday.
  Sun: Quiet all day, with a small rise in the evening as people prepare for Monday.
columnAbout:
  "00–06": Overnight tickets wait for the morning shift.
  "06–09": Early risers and customers in earlier time zones.
  "09–12": The peak window on every weekday.
  "12–15": The lunch dip is small, so weekday volume stays high.
  "15–18": Volume tapers through the afternoon, fastest on Friday.
  "18–24": An evening trickle, mostly handled by the on-call agent.
notes:
  - { on: ticket-load-mon-09-12, text: "The peak: 118 tickets in three hours, 31% of Monday's volume." }
  - { on: [ticket-load-row-sat, ticket-load-row-sun], text: "No weekend block passes 30 tickets, so one on-call agent covers both days." }
caveat: Counts are tickets opened, not agent workload; a ticket that takes all day still counts once.
```
