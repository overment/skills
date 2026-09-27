---
title: What the app is made of
chrome: none
width: wide
---

The [App](#app) ships as three parts that deploy separately. The [Web client](#web) holds every screen and no secrets, the [API](#api) holds sign-in and billing, and the [Workers](#workers) send email after a request is already answered.

```figure
id: app-tree
layout: tree
title: What the app is made of
grid: [5, 3]
nodes:
  app:     { label: App, at: [2, 0], focal: true, about: "Everything we ship. It has three parts that deploy separately." }
  web:     { label: Web client, at: [0, 1], about: "What people see in the browser. It holds no secrets and talks only to the API." }
  api:     { label: API, at: [2, 1], about: "Answers every request from the browser and decides who may do what." }
  workers: { label: Workers, at: [4, 1], about: "Background jobs that run after a request is answered, so nobody waits on them." }
  pages:   { label: Pages, at: [0, 2], about: "Every screen from sign-in to checkout, built from shared components." }
  auth:    { label: Auth, at: [2, 2], about: "Signs people in and checks their session on every request." }
  billing: { label: Billing, at: [3, 2], about: "Charges cards and keeps invoices for every paid order." }
  emails:  { label: Emails, at: [4, 2], about: "Sends receipts and password resets. Retries when the mail provider is slow." }
edges:
  - app -> web
  - app -> api
  - app -> workers
  - web -> pages
  - api -> auth
  - api -> billing
  - workers -> emails
notes:
  - { on: api, text: "Everything that handles a secret sits under the API." }
```
