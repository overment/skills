---
title: Backlog by effort and impact
chrome: title
---

[Saved searches is the only quick win on the list](#backlog-saved-searches+backlog-top-left), so it ships before [single sign-on](#backlog-single-sign-on) starts.

```quadrant
id: backlog
x: { low: Low effort, high: High effort, title: Effort }
y: { low: Low impact, high: High impact, title: Impact }
quadrants:
  - { label: Quick wins, about: "High impact for little work: ship these first." }
  - { label: Big bets, about: "High impact that needs real investment: plan them as projects." }
  - { label: Fill-ins, about: "Cheap but minor: fit them into gaps between larger work." }
  - { label: Money pits, about: "Costly and minor: drop them or find a cheaper version." }
notes:
  - on: backlog-saved-searches
    text: "The only quick win: about a week of work for the most requested feature."
  - on: backlog-offline-mode
    text: "The deepest money pit: a sync engine for under 2% of sessions."
caveat: "Effort and impact are the team's estimates from one planning session on a 0 to 1 scale, not measurements."
data:
  - { label: Saved searches, x: 0.22, y: 0.82, focal: true, about: "Reuses the existing filter state, so the most requested feature is about a week of work." }
  - { label: Single sign-on, x: 0.78, y: 0.86, about: "Unblocks three enterprise deals but needs a new identity provider integration." }
  - { label: Bulk edit, x: 0.62, y: 0.64, about: "Power users ask for it; permission checks make it larger than it looks." }
  - { label: Custom reports, x: 0.72, y: 0.4, about: "Would replace spreadsheets for a few accounts, at the cost of a new query layer." }
  - { label: CSV export, x: 0.14, y: 0.42, about: "Half a day of work; support already links to a workaround." }
  - { label: Dark mode, x: 0.3, y: 0.28, about: "Pleasant, but rarely why anyone stays or leaves." }
  - { label: Offline mode, x: 0.88, y: 0.2, about: "Needs a sync engine; under 2% of sessions are on unreliable networks." }
```
