---
title: How magic-link sign-in works
chrome: title
width: wide
---

The [Auth service](#auth) never trusts the browser on its own. It [emails a one-time token](#m3) inside a link, and only a link that [passes the check](#m6) creates a [session](#m7).

```figure
id: magic-link
layout: sequence
title: Signing in with an emailed link
actors:
  browser: { label: Browser, kind: actor, about: "The person signing in and the tab they started in." }
  app:     { label: Web app, about: "Shows the sign-in form. Holds no secrets and asks Auth for every decision." }
  auth:    { label: Auth service, focal: true, about: "Creates and checks one-time links. Issues the session once a link is used." }
  mail:    { label: Email provider, kind: external, about: "Delivers the link to the inbox. Usually takes a few seconds." }
messages:
  - browser -> app: enters email
  - app -> auth: requests link
  - auth => mail: sends link
  - mail ~> browser: delivers email
  - browser -> app: opens link
  - app -> auth: checks token
  - auth --> app: returns session
notes:
  - { on: m6, text: "This check enforces the rule: a token works once and only for 15 minutes." }
  - { on: m4, text: "The only step outside our systems; delivery usually takes a few seconds." }
caveat: Rate limits and the error paths for an expired link are not shown.
```

```note info
Links expire after **15 minutes** and work once. Opening an old link starts over from the sign-in form.
```

```glossary
token: The random part of the link that Auth checks; it works only once.
```
