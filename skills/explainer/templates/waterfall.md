---
title: How revenue grew this year
chrome: title
---

Annual recurring revenue grew from [$4.2M](#arr-bridge-start-of-year) to [$5.1M](#arr-bridge-end-of-year) because [new customers brought in more than churn took away](#arr-bridge-new-customers+arr-bridge-churn).

```waterfall
id: arr-bridge
format: $
axis: Annual recurring revenue
notes:
  - on: arr-bridge-new-customers
    text: "The largest gain, +$1.6M: two thirds of it came from the self-serve plan."
  - on: arr-bridge-churn
    text: "The largest loss, −$1.1M, is 73% of everything lost this year; half of it left with ten accounts."
caveat: "Contracted revenue only: usage fees and one-off services are not in these numbers."
data:
  - { label: Start of year, value: 4200000, about: "Contracted yearly revenue on the first of January, before any of this year's changes." }
  - { label: New customers, value: 1600000, focal: true, about: "First contracts signed this year, two thirds of them from the self-serve plan." }
  - { label: Expansion, value: 600000, about: "Existing customers adding seats or moving to a higher plan." }
  - { label: Price change, value: 200000, about: "The list price rise in April, applied to accounts as they renewed." }
  - { label: Contraction, value: -400000, about: "Customers who stayed but cut seats, mostly after team reductions." }
  - { label: Churn, value: -1100000, about: "Contracts that were not renewed; half of the loss came from ten accounts." }
  - { label: End of year, total: true, about: "Contracted yearly revenue on the last day of December." }
```
