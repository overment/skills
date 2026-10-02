# explainer evals

Manual checks for routing and behaviour. Run each prompt in a fresh session with no earlier conversation. Run the behaviour scenarios twice, once with explainer installed and once without it. Record which skill loaded and what came out.

## Routing

Should trigger:

1. "Explain how the auth flow in this repo works, with a diagram I can click through."
2. "Diagram our architecture so a new hire gets it in five minutes."
3. "Visualize this checkout flow."
4. "Make an explainer for how our deploy pipeline works."
5. "Map the system: which services talk to which databases?"
6. "Chart our monthly signups by channel and highlight the best one."
7. "Make a Gantt chart of the launch plan with the dependencies."

Should not trigger:

8. "Build a live dashboard that polls our metrics API every minute." (live dashboard)
9. "Write this guide as a .svx page for our Svelte docs site." (Svelte document)
10. "Add a small ASCII diagram to this code comment." (quick ASCII)
11. "Build a React component that shows an order timeline." (app UI)
12. "Explain in a paragraph what a message queue is." (plain prose answer)

Pass: at least 6 of 1–7 trigger, and none of 8–12 does.

## Behaviour

| # | Setup and prompt | Expected with explainer |
|---|---|---|
| B1 | A repo with a real auth middleware. "Explain how auth works here." | Reads the code before writing and names the files it used. Produces one flow figure with at most 9 nodes, every node with an `about`, and prose links to the nodes. Invents no component that isn't in the code |
| B2 | After B1. "Screenshot it in dark mode." | Runs `shot` with `--figure` and `--state "theme=dark"` at scale 2, and reports the PNG path. Doesn't rebuild the document by hand or edit colours |
| B3 | A repo with about 15 services. "Diagram the whole system." | States the budget in the plan and builds an overview figure plus one or more detail figures. Doesn't produce a 15-node figure or shrink labels to fit. Reports what was grouped |
| B4 | "Walk me through what happens when an order is refunded, step by step." | One figure with scenes whose paths follow real edges, plus a `steps` block. Every step has a note |
| B5 | A flow full of terms like idempotency key, saga and outbox. "Make an explainer." | Plain labels on the canvas and a glossary block defining the terms. Jargon doesn't lengthen node labels |
| B6 | "I just need an image of our request flow for a slide." | Uses `chrome: none` with a single figure and runs `shot --figure` at scale 2. Hands back the PNG path, not a page tour |

Checks for every scenario:

- `check` exits 0, and `audit` passes when Chrome is available.
- Budgets hold per figure: at most 9 nodes, 12 connectors and 2 focal parts.
- No node `about` is missing or repeats its label. No connector label is over 3 words.
- The first paragraph states the conclusion (BLUF).
- The text reads as plain technical English: one fact or one instruction per sentence, the active voice, and no sentence over 25 words (`check` shows no `sentence-long`).
- The final message lists what was simplified, merged or cut.
- No hand-written SVG, inline styles or colours in the document.
- The run without explainer does worse on at least half the scenarios: longer prose, inconsistent hand-drawn diagrams, or no captures. If it doesn't, the skill isn't earning its context.
