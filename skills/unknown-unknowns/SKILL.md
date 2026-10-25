---
name: unknown-unknowns
description: Explores a topic with the user in short turns, backed by a live mind map, to surface what they don't know they don't know. Use when the user wants to find blind spots, get oriented in an unfamiliar field, or see a topic's landscape before going deep.
license: MIT (bundled Geist fonts under OFL-1.1, see assets/fonts/OFL.txt)
compatibility: The live map needs Node.js 18+ or Bun.
metadata:
  author: overment
  version: "0.5.0"
---

# Unknown unknowns

Agents answer "help me explore X" with a long overview and many questions, and the user stops steering. Keep the user in a tight loop: the chat stays short, and the live map holds the breadth and the detail.

## Replies

- About 120 words at most, no headings, and exactly one question at the end that the user can answer in a few words, a number or a letter.
- One or two doors, except in the term check and the net: named things the user can look up (a term, a failure mode, a debate, a tool), in bold, each with one line on why it matters for the goal.
- Often ask the user to guess before you explain (A or B?). A wrong guess is a surprise: stay on it before you move on. If the user skips a guess, answer it in one line in the next reply.
- Mark numbers, studies and fast-changing facts you aren't sure of with "(check)".
- Don't offer to build, design or write a report until the user asks.

## Shape

In the first reply, say once that the user can answer "go on", "deeper" or "net" at any time.

- **Start:** if the goal is unclear, ask for it with two or three guesses as letters. In the next reply, list six to eight numbered terms of art, basic to expert, and ask which are new, instead of asking their level. Only the new ones go on the map.
- **Go on / deeper:** pick the next door that matters most for the goal, or stay on the focused one.
- **Net:** when the user wants the whole picture first, around the node they name or else the focused one, put 12–20 new nodes on the map in three to five branches, each with a one-line note. Look past the obvious: failure modes, debates, dropped approaches, neighbouring fields. In the chat, list the branches, numbered, each with a few words on why it matters, and ask which to open first. A net at the start replaces the term check.
- **Wrap-up:** in eight lines or fewer, what is still open, then one thing nobody asked yet as the closing question.

## Map

Run `node scripts/map.mjs` from this skill's folder. `help` lists the commands.

- In the first reply, `open "<topic>"` and give the printed URL once. After a context loss, `show` gets the map back.
- After each reply, `add` the doors you showed and `focus` the one the reply explains most, or the node a net is around. Put the goal in the note of `goal`.
- Put the detail in notes, not in the chat. The user sees the map live, so no note or label may give away the answer to an open guess.
- Remove nodes that aren't crucial for the goal. `link` two nodes only when the relation itself matters.
- `attach` each artifact you make and the sources you checked. Name the artifact's node in the chat in one line. Don't mention other map updates.
- At wrap-up, put what is still open in the goal note. Leave the server running; it stops by itself.
