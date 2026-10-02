# Instructions

Open this when writing the base's skill: the Agent Skill later agents work from. They know only what the base and its skill tell them, so everything the design depends on must be in them.

## Where it lives

Name the skill and its folder after the base, in lowercase with hyphens (`lab-papers`), so it can't clash with another skill. Put it where agents look:

- **Agents work inside the base:** `.agents/skills/<name>/` at the repository root (or the base's root, without git) for Codex and Cursor, plus a relative link for Claude Code: `ln -s ../../.agents/skills/<name> .claude/skills/<name>`. Commit both, so the skill travels with the base.
- **Agents reach it from elsewhere, or it lives in Notion, a wiki or a database:** `~/.agents/skills/<name>/`, linked into `~/.claude/skills/`, with the base's location in SKILL.md.

The type contracts stay in the base ([templates](templates.md)). Link to them, and to other base files, with relative links, which `check.ts` can verify ([upkeep](upkeep.md)).

## Description

It's all an agent sees when choosing a skill. Name the base in the words people use for it, and claim all reading and writing there, because work that misses the skill ignores the design. Keep it under 1,024 characters, ending with "Not for…" and the nearest misses, such as the code in the same repository.

## What it holds

Write it so that a fresh agent with nothing else can:

- say what the base is for (the survey's questions, verbatim) and who reads and writes it;
- name the methods it follows and where it departs from them, because a method's name brings back its conventions;
- take in new material by its source's intake path, and file an item that fits nowhere;
- find things, with the exact commands and filters, skipping `archive/` unless a question needs the raw source;
- write to the content bar, following the naming and linking rules;
- open each type's contract;
- tell what it may change on its own and what needs a yes;
- run the checks ([upkeep](upkeep.md)) on their schedule, and record structural changes.

SKILL.md loads whole, so it keeps what every task needs, in under about 1,000 words, and lists reference notes with when to open each: the structure map (what goes where), intake per source, search recipes, upkeep routines, links to the contracts. Scripts go in `scripts/`, starting with `check.ts`. None of it lists notes: it routes to the base's indexes, which give each target a line, so it doesn't grow with the base.

Give every rule its reason on the same line. A bare rule gets applied too literally, or dropped at the first odd case. A rule with its reason stretches to cases nobody foresaw:

> Archive, don't delete: old notes link here, and the archive keeps those links working.

An AGENTS.md that already covers the base moves into the skill, after a yes, so the two can't disagree. Then run the cold-start test.

## Around it

- **Structure log:** each structural decision with its date and reason, so a later agent sees why a fence is there before removing it (Chesterton's fence). Keep it in the skill, next to the map it explains.
- **Vocabulary:** allowed terms and tags, with each synonym mapped to one preferred term (controlled vocabulary). Add it once terms start to vary.
- **Writer's guide:** people don't open skill folders. When they write too, put where things go, the content bar and the contracts on a page in the base, and link the skill to it rather than repeating them.

When the structure changes, update the skill in the same edit.

## Warning signs

- General knowledge in the skill.
- A folder listing with no word on what goes where.
- A description that doesn't name the base.
- A skill that no longer matches the base.
