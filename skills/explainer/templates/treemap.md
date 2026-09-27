---
title: Where the cloud bill goes
chrome: title
---

The [API servers](#cloud-bill-api-servers) alone are about a quarter of the monthly cloud bill.

```treemap
id: cloud-bill
format: "$"
data:
  - { label: API servers, value: 18400, group: Compute, focal: true, about: "Always-on capacity sized for the Monday peak, idle most nights." }
  - { label: Batch jobs, value: 9200, group: Compute, about: "Nightly imports and report builds on spot capacity." }
  - { label: Build runners, value: 4100, group: Compute, about: "CI machines that scale with the number of open pull requests." }
  - { label: Staging, value: 3600, group: Compute, about: "A smaller copy of production that runs around the clock." }
  - { label: Primary database, value: 12800, group: Data, about: "One large managed instance plus a read replica." }
  - { label: Analytics warehouse, value: 7400, group: Data, about: "Billed per query; dashboards refreshing hourly drive most of it." }
  - { label: Backups, value: 2900, group: Data, about: "Daily snapshots kept for 35 days." }
  - { label: Cache, value: 2100, group: Data, about: "In-memory cache in front of the database for sessions and hot reads." }
  - { label: Egress, value: 6300, group: Network, about: "Data sent out to customers, mostly file downloads." }
  - { label: Load balancers, value: 1800, group: Network, about: "Hourly fee per balancer, plus a charge per connection." }
  - { label: CDN, value: 1500, group: Network, about: "Serves static assets and absorbs most repeat downloads." }
  - { label: Logs, value: 3900, group: Observability, about: "Kept for 30 days; debug-level logs from two services make up half." }
  - { label: Metrics, value: 1200, group: Observability, about: "Custom metrics billed per time series." }
groupAbout:
  Compute: Machines that run code, both always-on and on demand.
  Data: Everything that stores or queries data.
  Network: Traffic leaving the platform and the parts that route it.
  Observability: Logs and metrics used to run the platform.
notes:
  - { on: cloud-bill-api-servers, text: "API servers cost $18,400: about a quarter of the bill and half of Compute." }
  - { on: cloud-bill-group-data, text: "Data is the second-largest group, and the primary database is half of it." }
caveat: List prices for one month, before discounts and credits; support plans and domains are not included.
```
