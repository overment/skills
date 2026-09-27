---
title: New onboarding vs. current
chrome: title
---

The new flow [scores higher on four of five axes](#onboarding-new-flow+onboarding-current-flow) and [ties on trust](#onboarding-axis-trust), so the redesign cost no credibility.

```radar
id: onboarding
max: 10
axes: [Clarity, Speed, Completion, Trust, Self-serve]
notes:
  - on: onboarding-axis-trust
    text: "Trust ties at 7 of 10: the shorter flow did not make new users doubt the product."
  - on: onboarding-axis-self-serve
    text: "The largest gain, +4: import moved into a guided checklist, where most current-flow users stalled."
caveat: "Each flow was scored by a different group of 24 new users, three months apart; the groups are alike, not the same people."
series:
  - label: Current flow
    values: [6, 4, 5, 7, 3]
    about: Scored by 24 new users in March; most stalled at the data import step.
  - label: New flow
    values: [8, 7, 8, 7, 7]
    focal: true
    about: Scored by 24 new users in June, after import moved into a guided checklist.
```
