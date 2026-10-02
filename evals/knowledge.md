# knowledge evals

Manual checks for routing and behaviour. Run each prompt in a fresh session with no earlier conversation. Run the behaviour scenarios twice, once with knowledge installed and once without it. Record which skill loaded and what came out.

## Routing

Should trigger:

1. "Set up a knowledge base for my research notes. Agents will keep it in order."
2. "My Obsidian vault is a mess: duplicates, random tags, nothing links. Fix the system."
3. "Design the folder structure and templates for our team handbook."
4. "Write the instructions agents follow in my notes repo, so they file things the same way every time."
5. "Should my second brain live in Markdown, Notion or neo4j?"
6. "Our support agent needs a memory folder for what it learns about customers. How should it be organized?"
7. "Clean up the tags in this vault and decide which ones we keep."
8. "Our support notes will reach 500,000 next year once the helpdesk feed is on. Will this structure hold?"

Should not trigger:

9. "Write a CLAUDE.md for this codebase." (codebase context)
10. "Build a RAG pipeline over our docs with pgvector." (retrieval pipeline)
11. "Summarize this article into a note." (a single note)
12. "What does my vault say about pricing?" (answering from a base)
13. "Draw a diagram of how my vault is organized." (diagram, explainer)
14. "Remember that I prefer tabs over spaces." (the agent's own memory)
15. "Turn our release checklist into a skill." (a skill, not a knowledge base)

Pass: at least 6 of 1–8 trigger, and none of 9–15 does.

## Behaviour

| # | Setup and prompt | Expected with knowledge |
|---|---|---|
| B1 | An empty folder. "Set up a knowledge base for my reading notes." | Writes the survey questions and a recall of methods (through at least two fields, comparing two options) into the conversation before creating files, at a length that fits a small base. Asks at most three questions, or states its guesses. Leaves the base's skill in `.agents/skills/<name>/`, linked into `.claude/skills/`, naming the chosen methods with reasons; no AGENTS.md or CLAUDE.md. Few or no types, and a flat layout |
| B2 | A vault of 200 notes with overlapping folders and 150 tags. "Clean this up." | Samples before judging, runs `check.ts`, and proposes a migration table. Moves, renames or merges nothing before a yes. Archives instead of deleting |
| B3 | A pile of about 20 mixed captures: calls, decisions, clippings, fixes. "Turn this into a knowledge base agents will maintain." | Titles state the point. Generic clippings shrink to what's specific to this base. Superseded facts are marked and linked forward. Relative dates become absolute. Types are contracts, not skeletons, and `check.ts` exits 0 |
| B4 | After B3, a fresh session with the base's skill but without knowledge. "File these four new notes, then answer: why did the price change?" | Loads the base's skill from its description, unprompted. Following only that skill, it files each note in one obvious place, extends existing notes rather than duplicating them, and finds the answer in a few steps |
| B5 | "Build my second brain in neo4j." The person has never used it. | Checks whether the questions justify a graph (multi-hop relations). Either confirms and explains the model with a first Cypher query, or proposes files with a graph index. Confirms before committing |
| B6 | A team wiki. "Make templates for our docs." | Derives types from real pages, grouped by what readers want from them. Writes contracts with fixed, default and free parts plus two real examples each. No placeholder skeletons, no more than six types |
| B7 | The Inkpost inbox, plus: "Soon the helpdesk and call transcripts will feed this automatically: up to 500,000 notes in three years." | Decides identity, sharding and an entity registry before the first folder. The base's skill routes to indexes and names the query command, and doesn't list items. Feeds get idempotent IDs from their source. Runs a load test on a synthetic copy at 500,000 notes and reports files opened per answer. Uses `check.ts --files` after each intake |

Checks for every scenario:

- The recall of methods appears in the conversation before any structure is chosen, and each chosen method is tied to a survey question.
- The base's skill passes the cold-start test and gives the reason for every rule. Its name matches its folder, and its description names the base, stays under 1,024 characters and ends with "Not for…".
- No template is a form of empty headings. The fixed part of each type is small, and `check.ts` enforces it.
- Nothing existing is moved, merged or deleted without a yes.
- The run without knowledge does worse on at least half the scenarios: generic PARA-style folders, fill-in templates, pasted clippings, no instructions for later agents or rules without reasons. If it doesn't, the skill isn't earning its context.
