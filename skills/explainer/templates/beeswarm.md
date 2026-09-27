---
title: Time to first reply by plan
chrome: title
---

[All but one enterprise ticket got a first reply within two hours](#first-reply-enterprise+first-reply-ticket-4163), while [free-plan tickets waited up to a day](#first-reply-free).

```beeswarm
id: first-reply
format: h
axis: Hours to first reply
marks:
  - { x: 2, label: 2 h target }
notes:
  - on: first-reply-ticket-4163
    text: "Ticket 4163, the only enterprise ticket over 2 h: it arrived during a shift handover and sat unassigned."
  - on: first-reply-free
    text: "The free-plan queue is not staffed at weekends, so its slowest tickets wait past 15 h."
caveat: "Hours are wall-clock time, nights and weekends included; the time a ticket took to resolve is not shown."
data:
  - { label: Ticket 4102, value: 0.4, group: Enterprise, about: "SSO login loop after a certificate rotation, picked up by the on-call engineer." }
  - { label: Ticket 4117, value: 0.6, group: Enterprise, about: "Question about audit log retention, answered from the security FAQ." }
  - { label: Ticket 4125, value: 0.8, group: Enterprise, about: "Export job stuck in the queue and restarted by support within the hour." }
  - { label: Ticket 4131, value: 1.1, group: Enterprise, about: "Request to add forty seats before a team rollout." }
  - { label: Ticket 4140, value: 1.3, group: Enterprise, about: "Webhook failures traced to an expired signing secret on the customer side." }
  - { label: Ticket 4148, value: 1.5, group: Enterprise, about: "Invoice needed a purchase order number for the finance team." }
  - { label: Ticket 4156, value: 1.9, group: Enterprise, about: "Slow dashboards in one region during a traffic spike." }
  - { label: Ticket 4163, value: 3.2, group: Enterprise, focal: true, about: "Arrived during a shift handover and sat unassigned until the next agent logged in." }
  - { label: Ticket 4104, value: 1.2, group: Team, about: "Billing question about switching from monthly to yearly." }
  - { label: Ticket 4111, value: 2.0, group: Team, about: "Calendar sync bug reported with a screen recording attached." }
  - { label: Ticket 4119, value: 2.6, group: Team, about: "Asked how to move projects between workspaces." }
  - { label: Ticket 4127, value: 3.1, group: Team, about: "Password reset emails landing in a spam folder." }
  - { label: Ticket 4135, value: 3.8, group: Team, about: "Feature request for custom fields on tasks." }
  - { label: Ticket 4142, value: 4.4, group: Team, about: "API rate limit hit during a bulk import." }
  - { label: Ticket 4150, value: 5.9, group: Team, about: "Mobile app crash on an older Android version." }
  - { label: Ticket 4159, value: 7.5, group: Team, about: "Sent late on a Friday and answered the next morning." }
  - { label: Ticket 4106, value: 2.5, group: Free, about: "Could not verify an email address after changing it." }
  - { label: Ticket 4113, value: 4.8, group: Free, about: "Asked whether the free plan includes guest access." }
  - { label: Ticket 4121, value: 7.2, group: Free, about: "Spreadsheet import dropped the date column." }
  - { label: Ticket 4129, value: 9.6, group: Free, about: "Question about deleting an old workspace." }
  - { label: Ticket 4137, value: 12.1, group: Free, about: "Desktop notifications arriving twice." }
  - { label: Ticket 4144, value: 15.4, group: Free, about: "Sent over a weekend, when the free-plan queue is not staffed." }
  - { label: Ticket 4152, value: 18.8, group: Free, about: "Duplicate of an earlier ticket, merged before the reply." }
  - { label: Ticket 4161, value: 22.5, group: Free, about: "Language setting reverting to English after logout." }
```
