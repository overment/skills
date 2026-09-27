---
title: What happens to a support question
chrome: title
width: wide
---

Every question lands in [Triage](#triage) first. Known topics get an [instant answer](#triage->bot) from the [Answer bot](#bot); everything else [goes to](#triage->agent) a [Support agent](#agent). Press **Play** or use ← → to follow each path.

```figure
id: helpdesk
layout: flow
grid: [4, 3]
nodes:
  customer: { label: Customer, at: [0, 1], kind: actor, about: "Asks a question from the help page. Expects an answer or a named person within minutes." }
  form:     { label: Help form, at: [1, 1], about: "Collects the question and the order number. Rejects an email address that cannot receive mail." }
  triage:   { label: Triage, at: [2, 1], focal: true, about: "Reads the first lines and matches them against known topics. Decides who answers in under a second." }
  bot:      { label: Answer bot, at: [3, 0], about: "Replies with the matching help article. Most known questions end here." }
  agent:    { label: Support agent, at: [3, 2], kind: actor, about: "A person on the support team. Sees the full history before replying." }
  history:  { label: Ticket history, at: [2, 2], kind: store, about: "Every question and reply for each customer. Kept for two years." }
edges:
  - customer -> form: asks
  - form -> triage
  - triage -> bot: known topic
  - triage -> agent: new topic
  - triage -> history: logs
  - agent -> history: reads
scenes:
  known:
    title: A common question
    path: [customer, form, triage, bot]
    notes:
      customer: Asks when a parcel will arrive.
      form: Attaches the order number.
      triage: Recognises a delivery question.
      bot: Sends the delivery article in seconds.
  escalated:
    title: A question the bot can't answer
    path: [customer, form, triage, agent]
    notes:
      customer: Reports a charge they don't recognise.
      form: Attaches the order number.
      triage: Finds no matching topic.
      agent: Checks the history and replies.
notes:
  - { on: triage, text: "Triage decides who answers in under a second, before any person reads the question." }
  - { on: triage->history, text: "Every question is logged, whichever path it takes." }
caveat: Questions that arrive by email or chat skip the Help form and are not shown.
```

```steps
for: helpdesk
scenes: [known, escalated]
```

Both paths write to [Ticket history](#history), so an agent always sees what the customer already asked and what the bot already sent.
