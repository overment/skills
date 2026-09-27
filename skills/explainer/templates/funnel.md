---
title: Where trials drop off
chrome: title
---

Only about [one in three trials ever connects a data source](#trial-funnel-connected-data), and that single step loses more people than every other step combined.

```funnel
id: trial-funnel
format: int
data:
  - { label: Started trial, value: 12400, about: "Everyone who created an account from the pricing page; nothing is set up yet." }
  - { label: Verified email, value: 10900, about: "Clicked the link in the welcome email; most who don't typed their address wrong." }
  - { label: Connected data, value: 4300, about: "Linked a first data source, which often needs an admin password the trial user does not have." }
  - { label: Invited a teammate, value: 2900, about: "Added at least one colleague, the strongest early sign that a team will stay." }
  - { label: Upgraded to paid, value: 1550, about: "Entered a card before the 14-day trial ended." }
notes:
  - { on: trial-funnel-connected-data, text: "Connecting data loses 6,600 people, 61% of everyone who drops out." }
  - { on: trial-funnel-invited-a-teammate, text: "Two in three who connect data also invite a teammate, the strongest early sign a team will stay." }
caveat: Unique trial accounts from one month; someone who comes back for a second trial counts once.
```
