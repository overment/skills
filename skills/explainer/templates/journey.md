---
title: Switching mobile plans
chrome: title
---

People arrive keen and leave happy, but [moving their number during set-up](#switch-plan-sentiment-set-up) takes days and is where most of them nearly give up.

```journey
id: switch-plan
notes:
  - on: [switch-plan-doing-set-up, switch-plan-sentiment-set-up, switch-plan-pain-transfer-code-needed]
    text: "The trough: sentiment drops three points from sign-up while the transfer waits on a code from the old provider."
  - on: switch-plan-sentiment-first-bill
    text: "The recovery: a first bill that matches the advertised price brings sentiment back to +1."
stages:
  - { label: Discover, about: "The customer first hears about the plan, usually from an ad or a friend." }
  - { label: Compare, about: "They weigh price, data and coverage against what they pay today." }
  - { label: Sign up, about: "They order the plan online and pass an identity check." }
  - { label: Set up, about: "The SIM arrives and the old number has to move across." }
  - { label: First bill, about: "The first month ends and they see what they actually pay." }
rows:
  - label: Doing
    about: "What the customer does at each stage."
    cells:
      - { label: Sees a price ad, about: "Most people start from a price they saw, not from a need." }
      - { label: Checks the coverage map, about: "Coverage at home and at work decides more switches than price does." }
      - { label: Orders online, about: "The form takes about six minutes, including the identity check." }
      - { label: Requests a number transfer, focal: true, about: "The transfer needs a code from the old provider, which few people have to hand." }
      - { label: Opens the bill, about: "Most people open the first bill once, to check it matches the advertised price." }
  - label: Thinking
    about: "What goes through their head, in their words."
    cells:
      - { label: "Could I pay less?", about: "The trigger is almost always a monthly price that feels too high." }
      - { label: "Will it work at home?", about: "Dropped calls at home are the fear that stops most comparisons." }
      - { label: "That was quick", about: "Sign-up is faster than people expect, which builds early trust." }
      - { label: "Is my old number gone?", about: "Two days without a working number feels like being cut off." }
      - { label: "Matches what I was promised", about: "A bill with no surprises settles the decision for good." }
  - label: Touchpoint
    about: "Where the customer meets the company at each stage."
    cells:
      - { label: Social ad, about: "Short video ads bring in about half of new customers." }
      - { label: Coverage page, about: "The busiest page on the site during the comparison stage." }
      - { label: Checkout, about: "One page with the identity check built in." }
      - { label: SMS and support chat, about: "Status texts during the transfer, and chat when they don't arrive." }
      - { label: Email bill, about: "A one-page bill with the monthly total at the top." }
sentiment:
  - { value: 1, about: "Curious and hopeful about paying less." }
  - { value: 0, about: "Unsure, because roaming costs are hard to find." }
  - { value: 1, about: "Pleased at how quick ordering was." }
  - { value: -2, about: "Anxious and frustrated while the number is in limbo." }
  - { value: 1, about: "Relieved once the bill matches the price." }
pains:
  - { stage: Compare, label: Roaming costs unclear, about: "Prices abroad sit in a footnote, so careful buyers leave to call support." }
  - { stage: Set up, label: Transfer code needed, about: "Without the old provider's code the transfer stalls, often for two or three days." }
```
