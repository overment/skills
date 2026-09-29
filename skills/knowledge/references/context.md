# Context

Open this when writing the files a later agent reads first. A later agent knows only what the base tells it, so everything the design depends on must be in these files.

## The context file

Put it where every agent that writes to the base loads it without being asked:
- **A file base:** AGENTS.md at the root. For Claude Code, add a CLAUDE.md containing the line `@AGENTS.md` (Claude Code's import syntax).
- **Notion, a wiki or a database:** the base's first page, plus a one-line pointer in each agent's own instructions.

Agents read it in every session, so keep it under about 1,000 words. When it runs longer, move detail into linked pages (the writer's guide, the contracts, the search help), and keep the routing, the rules and their reasons. It doesn't grow with the base: it routes to indexes and names the search command, and never lists the notes themselves. Write it so that an agent reading only this file can:

- say what the base is for (the survey's questions, verbatim) and who reads and writes it;
- name the methods it follows and where it departs from them, because a method's name brings back its conventions;
- take in new material by the intake path, and file an item that fits nowhere;
- find things, with the exact commands and filters, skipping `archive/` unless a question needs the raw source;
- write to the content bar, following the naming and linking rules;
- find each type's contract;
- tell what it may change on its own and what needs a yes;
- run the checks ([upkeep](upkeep.md)) on their schedule, and record structural changes.

Give every rule its reason on the same line. A bare rule gets applied too literally, or dropped at the first odd case. A rule with its reason stretches to cases nobody foresaw:

> Archive, don't delete: old notes link here, and the archive keeps those links working.

Then run the cold-start test.

## Around it

- **Indexes:** curated entry points, with a line on each target and never a bare folder listing. Past a few thousand notes, generate them ([scale](scale.md)).
- **Vocabulary:** allowed terms and tags, with each synonym mapped to one preferred term (controlled vocabulary). Add it once terms start to vary.
- **Structure log:** each structural decision with its date and reason, so a later agent sees why a fence is there before removing it (Chesterton's fence). Name it so it isn't confused with the base's own decision notes.
- **Writer's guide:** when people write too, put what they need on the entry page or in a short guide the context file links to: where things go, the content bar, each type's contract.
- **llms.txt:** only when the base is published for agents outside it.

When the structure changes, update the context file in the same edit.

## Warning signs

- General knowledge in the context file.
- A folder listing with no word on what goes where.
- A context file that no longer matches the base.
