---
title: Weekly active users by platform
chrome: title
---

[Mobile](#weekly-users-mobile) passed web in April and ended the year about 50% ahead, while desktop stayed flat.

```line
id: weekly-users
format: k
categories: [2025-01, 2025-02, 2025-03, 2025-04, 2025-05, 2025-06, 2025-07, 2025-08, 2025-09, 2025-10, 2025-11, 2025-12]
y: { title: Active users }
notes:
  - { on: weekly-users-mobile-3, text: "April: mobile passes web for the first time." }
caveat: "Counts people active at least once a week, so one person on two platforms counts twice."
series:
  - label: Mobile
    focal: true
    values: [31000, 35200, 40100, 45600, 49800, 53500, 56200, 59900, 62400, 65800, 68300, 71500]
    about: "Grew every month after offline mode shipped in March."
  - label: Web
    values: [42000, 43500, 44100, 44800, 45200, 45000, 44600, 45100, 45900, 46200, 46800, 47100]
    about: "Holds steady because most sessions still start from an email link."
  - label: Desktop
    muted: true
    values: [12100, 12300, 12200, 12400, 12300, 12500, 12400, 12600, 12500, 12700, 12600, 12800]
    about: "A small, loyal group of power users rather than a growth channel."
```
