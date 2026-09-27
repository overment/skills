---
title: What answers when you open a page
chrome: title
width: wide
---

Most pages are answered by the [Edge cache](#cache) before your request reaches our servers. Only a [miss](#cache->app) goes down to the [App server](#app), which asks the [Database](#db) and hands slow work to the [Job queue](#queue). Images come from [Image storage](#images) through the cache and never touch the App server.

```figure
id: page-stack
layout: layers
grid: [4, 4]
nodes:
  browser: { label: Browser, at: [0, 0], span: [3, 1], kind: actor, about: "Asks for the page and draws it on screen. Keeps its own copy of files it loaded recently." }
  cache:   { label: Edge cache, at: [0, 1], span: [3, 1], focal: true, about: "Answers from a stored copy kept close to the reader. Only a request it can't answer goes further down." }
  app:     { label: App server, at: [0, 2], span: [3, 1], about: "Builds the page from code and data when the cache has no fresh copy." }
  db:      { label: Database, at: [0, 3], span: [3, 1], kind: store, about: "Holds accounts, posts and settings. Only the App server reads or writes it." }
  images:  { label: Image storage, at: [3, 1], kind: store, about: "Keeps photos and uploads. The cache fetches from it directly and keeps what it fetched." }
  queue:   { label: Job queue, at: [3, 2], kind: store, about: "Holds slow work such as sending email. Jobs run after the page has already gone back." }
edges:
  - browser -> cache: requests
  - cache -> app: misses
  - app -> db: queries
  - cache -> images: fetches
  - app ~> queue: queues jobs
notes:
  - { on: cache, text: "Most requests stop here, so the tiers below see only misses." }
  - { on: cache->app, text: "A miss is the only way a request reaches our servers." }
caveat: A cached copy can be a few minutes old; the figure doesn't show how long each tier keeps things.
```

The [Browser](#browser) asks first and keeps what it loaded recently. The [Edge cache](#cache) answers from a copy close to the reader. The [App server](#app) builds what the cache can't answer, and the [Database](#db) holds the data it builds from.

```note info
A cached copy stays fresh only for a set time, usually a few minutes. After that the next request is a miss: the App server rebuilds the page and the cache keeps the new copy. So a change can take that long to show up for everyone.
```
