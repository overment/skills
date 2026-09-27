---
title: Where signups come from
chrome: title
---

[Organic search brings in more new accounts](#signup-sources-organic-search+signup-sources-paid-search) than [paid search](#signup-sources-paid-search) and [social ads](#signup-sources-social-ads) combined.

```bar
id: signup-sources
format: int
unit: signups
axis: Signups, last 90 days
notes:
  - on: [signup-sources-organic-search, signup-sources-paid-search, signup-sources-social-ads]
    text: "4,120 signups, more than paid search and social ads combined (2,070)."
  - on: signup-sources-partner-webinars
    text: "The fewest signups, but the highest share of them later pay."
caveat: "Last-touch attribution: a signup counts for the channel of the visit where it happened, so channels that start the journey get less credit."
data:
  - { label: Organic search, value: 4120, focal: true, about: "Blog posts and docs pages that rank for setup questions; this traffic grew every quarter without extra spend." }
  - { label: Direct, value: 1650, about: "People typing the address or using a bookmark, mostly returning visitors who sign up on a second visit." }
  - { label: Referrals, value: 1480, about: "Links from partner sites and community forums; three integration directories send most of it." }
  - { label: Paid search, value: 1210, about: "Ads on category and competitor keywords, where cost per signup doubled after the spring bid changes." }
  - { label: Newsletter, value: 930, about: "Signups that followed a link in the monthly product email to existing subscribers." }
  - { label: Social ads, value: 860, about: "Sponsored posts on two networks aimed at team leads in mid-sized companies." }
  - { label: Partner webinars, value: 310, about: "Joint sessions with integration partners that bring few signups but the highest share that later pay." }
```
