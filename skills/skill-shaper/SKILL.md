---
name: skill-shaper
description: Creates or reshapes Agent Skills (SKILL.md folders) for Claude Code, Codex and Cursor, checked against the skills already installed. Use when the user asks to make a skill, turn a workflow or conversation into one, or fix a skill that fires on the wrong requests or never fires. Not for small edits to a skill, writing about skills, or AGENTS.md and CLAUDE.md rules.
license: MIT
compatibility: The bundled validator needs Python 3.9 or newer and no packages.
metadata:
  author: overment
  version: "0.5.0"
---

# Skill Shaper

You already know how to write good instructions. This skill covers what the request doesn't show you: the skills already installed, how Claude Code, Codex and Cursor load them, and how to prove the new one routes correctly. The user's instructions override it.

## Before drafting

- Look at the skills your harness already lists: it shows the name and description of every local and global skill it loaded. Open a neighbour's `SKILL.md` only when its description overlaps the new one.
- Find what goes wrong today without the skill, and who uses the output. The request names a task; that failure decides the rules. Write an inference as "my guess is X, because Y", never as the user's motive.
- Decide whether a skill is the right tool. A skill runs only when an agent loads it, so anything with one right answer (a check, a conversion, a calculation) belongs in a script, and in CI or a hook if it must run on every change. A one-line always-on rule belongs in `AGENTS.md`. When judgment work has a step that must never be skipped, build both: a thin skill and a guard. If the answer isn't a skill, say so and why, build the alternative when the request's intent covers it, check that the repo as it stands passes it, and go straight to the handoff.
- Ask only what the files can't answer and what would change the skill: one message, each question in bold first, then your guess and the default you'll use. The name, structure and scripts are your call; list them as assumptions.

## Neighbourhood

- **Triggers collide more than names.** For every installed skill whose description would claim the new skill's requests, either extend it or give the new description a boundary that names it ("Not for X; use other-skill"). Catch-all descriptions ("any Cloudflare task") are the usual culprits.
- **Names:** pick one that no listed skill uses. Agents also ship built-in skills (Codex has `skill-creator`, Cursor has `create-skill`), and a clash shadows or competes with them. Prefer a name that says what the skill is for over a generic one.
- **Placement:** a skill that names repo paths, commands or conventions goes in the project. Personal tools, cross-project workflows and matters of taste go in the user's global folder, even if the examples live in one repo. Keep one canonical copy in `.agents/skills/<name>/` (Codex and Cursor read it) and link it into `.claude/skills/` only if the user runs Claude Code. Copies drift, and Cursor loads every copy it finds. [references/placement.md](references/placement.md) has each agent's folders, precedence rules and sources.
- If a neighbour's description is broken or claims too much, mention it, but leave it alone unless asked.

## Writing it

The shape follows the job: a list of conventions can be ten lines, a fragile workflow can be mostly a script. What agents most often get wrong:

- **Description.** It is the only text seen while routing, and hosts shorten it when many skills are installed. Write it in third person ("Extracts…", not "Extract…"), put the main use case first in the words the user types, and end with "Not for…" naming the nearest neighbour. Leave out process narration and any purpose you inferred: the first wastes the listing, the second widens the trigger. Trigger wording in the body is never seen, because the body loads only after routing.
- **Purpose.** Open the body with two or three sentences on who uses the output and what goes wrong without the skill. Agents fall back on it when the rules don't cover a case.
- **Leave out** what the model does unprompted and facts that `AGENTS.md` or `CLAUDE.md` already load every session.
- **Side effects.** A skill that deploys, sends, deletes or spends is explicit-only in every agent: `disable-model-invocation: true` covers Claude Code and Cursor, and Codex needs `agents/openai.yaml` with `policy.allow_implicit_invocation: false`. The body says what invoking it authorises and what still needs a fresh yes. An explicit-only skill never loads for a plain request, so when it carries a safety gate, add a guard or an `AGENTS.md` pointer that the plain path can't skip.
- **Data the user edits** (rules, mappings, lists) lives in the project, not in the skill folder, so updating the skill never overwrites it. A personal skill keeps a short list in its body instead.
- **Portability.** Frontmatter beyond the spec and features such as Claude Code's `` !`command` `` lines are ignored by other agents; placement.md lists which agent reads what.

## Validate and hand off

1. Run `python3 <this skill's directory>/scripts/validate.py <skill-dir>` for the spec rules (name format, lengths, frontmatter, links). Fix every error, and fix each warning or know why it doesn't apply.
2. Reread the neighbours' descriptions next to the new one: every request you'd route to the new skill should belong to it alone.
3. Hand off:
   - the file tree and the description
   - assumptions, with unanswered questions first
   - how to invoke it: `/name` in Claude Code and Cursor, `$name` in Codex
   - three requests that should load it and two near misses, taken from neighbouring skills and from what the user excluded. For an explicit-only skill, the positives are invocations by name and a plain-language request is a near miss
   - one real task to run in a fresh session, once with the skill and once without. If the outputs don't differ, the skill isn't needed.

Offer to run those checks in a fresh session or subagent. This session already knows the answers, so it can't test routing.
