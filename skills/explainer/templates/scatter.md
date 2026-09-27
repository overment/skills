---
title: Support queues by speed and satisfaction
chrome: title
---

Queues that reply faster score higher, except the [weekend queue](#support-queues-weekend), which replies in two hours and still has the lowest satisfaction.

```scatter
id: support-queues
x: { title: First reply, format: h }
y: { title: Satisfaction, format: "%" }
guides: { x: 4, y: 85 }
data:
  - { label: Billing, x: 0.5, y: 91, group: Chat, about: "Short questions with answers the team already knows." }
  - { label: Onboarding, x: 0.8, y: 93, group: Chat, about: "New customers get a guided setup in the first reply." }
  - { label: Accounts, x: 0.6, y: 90, group: Chat, about: "Password and access fixes that take one step." }
  - { label: Returns, x: 1.2, y: 88, group: Chat, about: "A scripted flow that ends with a printed label." }
  - { label: Shipping, x: 1.5, y: 86, group: Chat, about: "Mostly tracking questions answered from the carrier feed." }
  - { label: Enterprise, x: 3, y: 89, group: Email, about: "A named agent follows each account from start to finish." }
  - { label: API, x: 6, y: 78, group: Email, about: "Most replies wait for an engineer to reproduce the issue." }
  - { label: Mobile, x: 8, y: 72, group: Email, about: "Bugs are escalated to the app team, which releases every two weeks." }
  - { label: Refunds, x: 10, y: 70, group: Email, about: "Every refund needs a finance approval before the reply." }
  - { label: Weekend, x: 2, y: 68, group: Email, focal: true, about: "Two people reply quickly but can't fix most problems until Monday." }
```
