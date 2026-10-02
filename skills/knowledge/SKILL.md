---
name: knowledge
description: >-
  Designs and evolves knowledge bases that agents maintain: notes vaults, second brains, team wikis and handbooks, research archives, agent memory. It derives the structure, note types and conventions from what the base must answer, and leaves the base an agent skill of its own, with checks, so later agents keep it consistent, from a few notes to hundreds of thousands. Use when asked to start, organize, restructure, scale or clean up such a base, to write the instructions its agents follow, or to choose where it should live (Markdown, Obsidian, Notion, a graph database). Not for a codebase's CLAUDE.md, AGENTS.md or skills, retrieval or vector-search pipelines, writing a single note, answering questions from an existing base, or diagrams of it.
license: MIT
metadata:
  author: overment
  version: "0.4.0"
---

# Knowledge

The bases this skill builds are kept by agents working in separate sessions. Without a shared design, each session invents its own structure, and the base decays into duplicates, filler and orphans. Your job is to design the environment the base grows in: its structure, its note types, and the base's skill, an Agent Skill of its own that lets any later agent keep it the same way without this one.

## Recall before you design

You already know Zettelkasten, PARA, Diátaxis, faceted classification and many more methods. Before choosing methods, a medium or a layout, bring that knowledge into the conversation, so the design builds on it rather than on your first idea:

- Name the methods that fit this base, and what each would do here. [Methods](references/methods.md) lists names to start from.
- Look through at least two fields: library science (classification), information architecture (finding), technical writing (reading), knowledge management (staying true), data modeling (entities and relations), cognitive psychology (understanding).
- Compare two options before picking one.

Do all three for the methods and the layout; a smaller choice needs only a line of reasoning.

## Rules

They hold at every level, from the whole base to a single section, so you can derive structure anywhere without a template.

1. **Purpose first (BLUF).** Every unit opens with what it's for and its main point.
2. **Questions shape structure.** Each level, type or tag must shorten the path from a question to its answer.
3. **One home per fact.** Everything else links to it.
4. **One reason to change.** Split what changes separately; keep together what changes together.
5. **One axis per mechanism.** Folders, links, tags and properties each carry one kind of meaning.
6. **Structure is earned.** Add a level, type or field around the third time content needs it, and remove it when it stops working. In a base that will grow large, identity and sharding are the exception ([scale](references/scale.md)).
7. **Every page is page one.** A note makes sense to a reader who lands on it from search.
8. **Nothing is orphaned.** Every note is reachable from an entry point, and every link says why it's there.
9. **Identity is stable.** Names survive reorganizations, and links survive moves.
10. **Reads stay bounded.** Any answer is a few files away, however large the base grows.

When rules conflict, the base's purpose decides. Record the choice in the base's structure log.

## Tests

Any structure that passes them is fine.

- **Filing** (card sorting): ten items each have exactly one obvious home and type. Use real ones, plus a few kinds the material doesn't contain yet.
- **Finding** (tree testing): each survey question leads from the entry point to its answer in a few steps.
- **Cold start:** a fresh agent that has only the base's skill loads it unprompted for a survey question and a new item, then passes both tests. Use a fresh subagent or session when you can. Otherwise read only the base's skill, file five items, answer three survey questions, and list every guess you had to make.
- **Load:** when the base will grow past a few thousand notes, run the finding test on a copy grown to that size ([scale](references/scale.md)).

For Markdown bases, `scripts/check.ts` checks links, required fields and drift. The base's skill carries its own copy; [upkeep](references/upkeep.md) says how and when to run it.

## Nodes

Open only what the task needs.

| Node | Open when |
|---|---|
| [survey](references/survey.md) | starting a base, or when one no longer fits its use |
| [methods](references/methods.md) | choosing how the base is organized, written and kept true |
| [structure](references/structure.md) | choosing the medium, layout and naming |
| [templates](references/templates.md) | a kind of note recurs |
| [content](references/content.md) | deciding what goes in and how it's written |
| [instructions](references/instructions.md) | writing the base's skill, which later agents work from |
| [upkeep](references/upkeep.md) | checking, cleaning or reshaping an existing base |
| [scale](references/scale.md) | the base will grow past a few thousand notes |
| [examples](references/examples.md) | you want to see different needs lead to different shapes |

A new base usually walks survey through instructions in order, then upkeep for the checks. "Our tags are a mess" starts at upkeep.

## Asking and acting

- Read the conversation, the existing files and the sources before asking. Ask at most three questions in one message, each with your guess and the default you'll use. If nobody answers, go ahead on the defaults, and record the open questions in the base's skill so a later session asks them again.
- In a new base, create freely. In an existing one, show a plan and get a yes before moving, renaming, merging or rewriting anything; then work in small batches and check after each.
- Archive instead of deleting: move the note into `archive/`, which `check.ts` exempts, so old links still resolve. The exception is content that must be gone, such as a request to forget, personal data or a secret. Delete it everywhere it's copied, including rollups and derived indexes, and fix the links.

## Report

Say what you built or changed, with paths, and the description of the base's skill; the methods you chose and why; the test and check results; what you left out on purpose; and your assumptions, open questions first.
