---
title: What the support bot sends the model
chrome: title
width: wide
---

The [support bot](#bot) calls the [model](#model) twice for one question. [The second call](#call-2) sends everything the first one did, plus the [order lookup](#lookup) and its [result](#lookup-out), because the model keeps nothing between calls.

```figure
id: support-seq
layout: sequence
title: One question, two calls
actors:
  customer: { label: Customer, kind: actor, about: "Asks about an order in the chat on the help page. They see only the bot's replies, never the calls behind them, so every answer has to stand on its own." }
  bot:      { label: Support bot, focal: true, about: "Our service. Keeps the message list, calls the model and runs the tools the model asks for." }
  model:    { label: Model, kind: external, about: "Reads the list it is sent and replies with text or a tool request. It keeps no memory between calls." }
  orders:   { label: Orders API, about: "Returns an order's status, carrier and dates. It is our own service, not the model: the bot calls it, and the model only sees what comes back." }
messages:
  - customer -> bot: asks
  - bot -> model: sends call 1
  - model --> bot: asks for order
  - bot -> orders: looks up order
  - orders --> bot: returns status
  - bot -> model: sends call 2
  - model --> bot: answers
  - bot --> customer: replies
notes:
  - { on: m4, text: "The bot runs the lookup. The model only named the tool and the order number." }
```

```context
id: support-context
for: support-seq
items:
  - { id: rules, role: system, text: Support rules and tools, tokens: 640, about: "Tone, what the bot may promise, and the one tool it can call: find_order." }
  - { id: question, role: user, text: "Where is order 4417?", tokens: 9, about: "The customer's message, word for word." }
  - { call: call-1, label: Call 1, message: m2, reply: "find_order(4417)", about: "The model can't know the order's status, so it asks for the lookup." }
  - { id: lookup, role: assistant, text: "find_order(4417)", tokens: 16, about: "The model's tool request, kept in the list so the next call knows it asked." }
  - { id: lookup-out, role: tool, text: "Shipped Tuesday, DPD", tokens: 21, about: "What the Orders API returned, added as its own message." }
  - { call: call-2, label: Call 2, message: m6, reply: "It shipped on Tuesday with DPD.", final: true, about: "With the status in the list, the model answers and the loop ends." }
notes:
  - { on: call-2, text: "Call 2 sends all four messages. Nothing from call 1 is remembered unless it is in the list." }
caveat: A real system prompt and tool result are much longer; the token counts only show that each call costs more than the last.
```

Every call pays for the whole list again, so a long conversation or a verbose tool result makes every later call slower and more expensive.
