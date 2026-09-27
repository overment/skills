---
title: Launch plan
chrome: title
---

The public launch on May 23 holds only if the [security review](#launch-security-review) ends on time: it is the one open task on the [critical path](#launch-critical), so it has no slack.

```gantt
id: launch
today: 2026-04-20
notes:
  - on: launch-security-review
    text: "The only open task with no slack. It is 20% done with 21% of its days gone, and every day it slips moves the launch."
  - on: launch-private-beta
    text: "The most slack of any open task: the beta can run six days over before the launch date moves."
caveat: "These are planned dates as of April 20. Slack assumes every task keeps its planned length."
tasks:
  - label: API design
    group: Build
    start: 2026-03-02
    days: 10
    progress: 1
    about: "Endpoints and error shapes agreed with both client teams. Changing them later costs a week each."
  - label: Backend
    group: Build
    after: [API design]
    days: 24
    progress: 1
    about: "Payments, accounts and order history, all behind the new endpoints."
  - label: Web app
    group: Build
    after: [API design]
    days: 30
    progress: 1
    about: "The checkout and account pages, rebuilt on the new API."
  - label: Mobile app
    group: Build
    after: [API design]
    days: 38
    progress: 1
    about: "The iOS and Android release that shares the web checkout flow."
  - label: Load test
    group: Verify
    after: [Backend]
    days: 10
    progress: 1
    about: "Three times last year's peak traffic, with no errors above the agreed limit."
  - label: Security review
    group: Verify
    after: [Backend, Web app]
    days: 42
    progress: 0.2
    focal: true
    about: "An outside firm tests the login and payment paths. Nothing ships until it signs off, so every day it slips moves the launch."
  - label: Private beta
    group: Verify
    after: [Mobile app, Load test]
    days: 28
    progress: 0.05
    about: "Two hundred invited customers place real orders. It can slip six days without moving the launch."
  - label: Help center
    group: Launch
    start: 2026-05-04
    end: 2026-05-22
    about: "Articles for every changed screen, written from the questions beta customers ask."
  - label: Support training
    group: Launch
    start: 2026-05-18
    days: 5
    about: "Two sessions, so every agent has placed a test order in the new apps."
  - label: Public launch
    group: Launch
    after: [Security review, Private beta]
    milestone: true
    about: "The new apps go to every customer and the old checkout is switched off."
```
