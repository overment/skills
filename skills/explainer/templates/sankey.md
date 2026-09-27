---
title: Where support tickets end up
chrome: title
---

[Nearly one in three bot answers is reopened, against one in sixteen for first-line agents](#bot->reopened+agent->reopened), so the bot saves less work than its volume suggests.

```sankey
id: ticket-flow
columns: [Channel, First answer, Outcome]
nodes:
  email: { label: Email, about: "The slowest channel to answer, but it carries most account and billing questions." }
  chat: { label: Chat, about: "The busiest channel; the bot answers first and hands over when it is unsure." }
  form: { label: In-app form, about: "Sent from inside the product, so each ticket arrives with the page and account attached." }
  bot: { label: Bot answer, about: "Answers from the help centre without a person; instant, but it cannot see the account." }
  agent: { label: First-line agent, about: "Takes anything the bot cannot or should not answer, plus most email." }
  specialist: { label: Specialist, about: "Engineers and billing staff who handle tickets that need access or a code change." }
  solved: { label: Solved, about: "The customer confirmed the answer or did not reply within seven days." }
  reopened: { label: Reopened, about: "The customer wrote back because the answer did not fix the problem." }
links:
  - { from: email, to: agent, value: 1800, about: "Most email goes straight to a person because it often needs account details." }
  - { from: email, to: specialist, value: 400, about: "Billing disputes and data requests skip first line entirely." }
  - { from: chat, to: bot, value: 2100, about: "The bot takes every chat first and keeps the ones the help centre can answer." }
  - { from: chat, to: agent, value: 900, about: "Chats the bot is unsure about are handed over with the conversation so far." }
  - { from: form, to: bot, value: 600, about: "Form tickets that match a help article get an instant answer." }
  - { from: form, to: agent, value: 500, about: "Form tickets about errors go to a person with the page context attached." }
  - { from: bot, to: solved, value: 1900, about: "These customers took the bot's answer and did not come back." }
  - { from: bot, to: reopened, value: 800, focal: true, about: "These answers came back, usually because the article did not match the customer's account." }
  - { from: agent, to: solved, value: 3000, about: "First-line agents close most tickets on the first reply." }
  - { from: agent, to: reopened, value: 200, about: "A small share comes back, mostly when a fix needed a later release." }
  - { from: specialist, to: solved, value: 400, about: "Specialists solve almost everything they take; the few follow-up questions they get (about 20 a month) are counted here." }
notes:
  - { on: bot->reopened, text: "800 of 2,700 bot answers come back: 30%, against 6% for first-line agents." }
  - { on: reopened, text: "The bot takes 43% of tickets but produces 80% of the reopens." }
caveat: A reopened ticket counts once, however many times the customer writes back.
```
