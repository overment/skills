# unknown-unknowns evals

Run each prompt in a fresh session with no earlier conversation. Run the behaviour scenarios twice: once with unknown-unknowns installed and once without it. A scenario is a short conversation: send the prompt, then the scripted replies one at a time.

## Routing

Should trigger:

1. "I'm about to buy my first house. What am I missing?"
2. "Help me find my blind spots about running a newsletter as a side business."
3. "I'm new to Rust coming from Python. What don't I know that I don't know?"
4. "Where do I even start with home espresso? I know nothing."
5. "Next month I start leading a team for the first time. What am I not seeing?"
6. "I'm buying my first espresso setup. Show me the whole landscape first, then we'll dig in."

Should not trigger:

7. "Research the market for home espresso machines and write me a report." (a written report)
8. "Explain how TCP congestion control works." (a direct explanation)
9. "Give me a full overview of quantum computing in one answer." (the user asks for one long answer)
10. "What are the risks in this migration plan?" with a plan attached (a review of a given artifact)
11. "Organize my research notes into a second brain." (a knowledge base)
12. "Draw a mind map of my project plan." (a diagram; explainer)

Pass: at least 5 of 1–6 trigger, and none of 7–12 does.

## Behaviour

| # | Prompt, then scripted replies | Without the skill (expected failure) | With the skill |
|---|---|---|---|
| B1 | "I'm a backend developer. I want to add offline sync to my notes app (TypeScript, SQLite on the device, Postgres on the server). Help me explore the unknown unknowns here before I start building." Then: "4, 6, 7 and 8 are new. just me on many devices, web + iOS. honestly where do I even start?" | Turn 1 is a sectioned overview of 1,000+ words that ends with several questions. Turn 2 switches to a design with code and offers to build it. | Turn 1 is a term check. Turn 2 has one or two doors chosen from the new terms and the goal, and ends with one question. No code, no offer to build. |
| B2 | "I want to explore my unknown unknowns about sleep." Then: "B mostly. I sleep ~7h but feel foggy till noon" | A list of 10+ claims and several personal questions. The goal is never asked. | Turn 1 asks for the goal, with lettered guesses. Later turns tie each door to the morning fog. |
| B3 | "Next month I start leading a team of five engineers. First time as a manager. What am I not seeing?" Then: the numbers of the new terms and "go on". Then a confident wrong answer to the agent's guess question. | No guess questions; a wrong belief is never exposed. | At least one "predict first" question. After the wrong guess, the next turn follows the surprise before it moves on. |
| B4 | Continue B1 for three turns, then: "ok I need to go, let's wrap up for today" | A long summary, or a plan for building. | The open questions and one thing nobody asked yet, in eight lines or fewer. |
| B5 | Continue B3, then: "can you write everything we covered into one doc?" | — | Writes the full document at once. The turn limit does not block a direct request. |
| B6 | Run B2 for six turns. In turn 5, add: "can you make me something visual that shows how the two sleep processes interact over a day?" Use `--no-open` and a temp `--dir`. | — | `open` runs in the first reply, and the URL appears once. Each door shown is a node with a label of 1–3 words. Only new terms from the term check are added. The focused door is the one the reply explains most. The artifact is one HTML file, attached to its node, and the chat names the node in one line. No note gives away the answer to an open guess question. `show` at the end matches the conversation. |
| B7 | "I'm buying my first espresso setup. Drop the net first, show me the whole landscape, then we'll dig into a few." Then the number of the least obvious branch, then "go on" (skipping the guess), then "net around" the focused door, then "wrap up". | One long overview with headings; the user picks nothing. | Turn 1 has no term check: 12–20 nodes in three to five branches go on the map, and the chat lists only the numbered branches with a few words each. Later turns go back to one or two doors. A skipped guess is answered in one line. No note gives away an open guess. The second net is around the focused door. |

Checks for every turn of every scenario:

- About 120 words at most, unless the user asked for depth or a document.
- No headings in a normal turn.
- Exactly one question at the end, answerable in a few words, a number or a letter.
- Every door is named and is tied to the user's goal.
- Numbers, studies and fast-changing facts the agent isn't sure of carry "(check)".
- The run without the skill does worse on turn length and question count in B1–B3. If it doesn't, the skill isn't needed.
