---
title: Sales by region and channel
chrome: title
---

[Europe](#channel-mix-europe) is the largest market, but [Asia-Pacific already sells more than half of its volume online](#channel-mix-asia-pacific-online+channel-mix-europe-online).

```marimekko
id: channel-mix
format: "$"
data:
  - label: Europe
    width: 120000000
    about: The largest market, still led by physical stores.
    segments:
      Retail: { value: 45, about: "Flagship stores in capital cities carry most of it." }
      Online: { value: 35, about: "Growing steadily, mostly through the web shop." }
      Wholesale: { value: 20, about: "Department stores in three countries." }
  - label: North America
    width: 95000000
    about: Online and stores are nearly even here.
    segments:
      Retail: { value: 40, about: "Outlet stores bring in most of this." }
      Online: { value: 42, about: "The app accounts for two thirds of online orders." }
      Wholesale: { value: 18, about: "One national chain carries the range." }
  - label: Asia-Pacific
    width: 70000000
    about: The fastest-growing region, and the most digital.
    segments:
      Retail: { value: 22, about: "A handful of stores in major cities." }
      Online: { value: 58, focal: true, about: "Marketplace storefronts bring in most of the region's sales." }
      Wholesale: { value: 20, about: "Distributors cover the smaller markets." }
  - label: Latin America
    width: 40000000
    about: The smallest region, served mostly through partners.
    segments:
      Retail: { value: 50, about: "Franchise stores run by local partners." }
      Online: { value: 20, about: "Limited by delivery coverage outside large cities." }
      Wholesale: { value: 30, about: "Regional distributors supply independent shops." }
segmentAbout:
  Retail: Stores we run or franchise.
  Online: Our web shop, app and marketplace storefronts.
  Wholesale: Other retailers who buy the range and resell it.
notes:
  - { on: channel-mix-asia-pacific-online, text: "58% of Asia-Pacific sales are online, against 35% in Europe." }
  - { on: channel-mix-europe, text: "Europe is 37% of all sales and still sells most through stores (45%)." }
caveat: Shares are of sales value, not of orders; a large wholesale order counts for more than many small online ones.
```
