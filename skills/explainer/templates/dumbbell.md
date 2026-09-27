---
title: Page load before and after
chrome: title
---

Every page loads faster since images moved to the new pipeline, and [product pages gained the most](#page-load-product+page-load-category).

```dumbbell
id: page-load
format: "1"
unit: s
better: lower
axis: Median page load, seconds
columns: [Before, After]
notes:
  - on: page-load-product
    text: "The largest gain, 2.5 s faster: galleries now load at screen size first."
  - on: page-load-account
    text: "The smallest gain, 0.2 s: account pages are mostly text and forms, so the pipeline had little to change."
caveat: "Median desktop load over the two weeks before and after the switch; mobile networks were not measured separately."
data:
  - { label: Product, from: 4.6, to: 2.1, focal: true, about: "Galleries of up to twenty photos now load at screen size first, so the gain here is the largest." }
  - { label: Category, from: 3.9, to: 2.6, about: "Grids of thumbnails benefit from smaller files, but the filter scripts still block the first paint." }
  - { label: Blog, from: 3.3, to: 2.2, about: "Header images were the heaviest item on most posts." }
  - { label: Home, from: 2.8, to: 1.9, about: "The hero banner is now served in a modern format at half the size." }
  - { label: Search, from: 3.1, to: 2.4, about: "Result thumbnails got lighter, but the query itself takes most of the time." }
  - { label: Checkout, from: 2.2, to: 1.8, about: "Few images here; the small gain comes from the shared logo and icons." }
  - { label: Account, from: 1.9, to: 1.7, about: "Mostly text and forms, so the pipeline had little to change." }
```
