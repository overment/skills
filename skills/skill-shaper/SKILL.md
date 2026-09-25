---
name: skill-shaper
description: Creates or reshapes Agent Skills (SKILL.md folders) for Claude Code, Codex and Cursor, checked against the skills already installed. Use when the user asks to make a skill, turn a workflow or conversation into one, or fix a skill that fires on the wrong requests or never fires. Not for small edits to a skill, writing about skills, or AGENTS.md and CLAUDE.md rules.
license: MIT
metadata:
  author: overment
  version: "0.6.0"
---

# Skill Shaper

You already know how to write instructions. This skill steers the judgment calls that make a skill worth loading, and supplies the few facts about skill loading you can't infer. The user's instructions override it.

## Think it through

Answer these from evidence first: the conversation, the project, and the skills your harness lists. Ask the user only what the evidence can't settle and would change the skill.

- **What job is the skill hired for?** Think in jobs to be done. The request names a task; the failure behind it decides the rules. Write an inference as "my guess is X, because Y", never as the user's motive.
- **Should it be a skill at all?** A skill runs only when an agent loads it. A step with one right answer wants poka-yoke: a script, or a CI check or hook if it must run on every change, which makes the mistake impossible instead of reminding someone to avoid it. A one-line rule that always applies belongs in `AGENTS.md`. Judgment work with a step that must never be skipped gets both a thin skill and a guard. If the answer isn't a skill, say why, and build the alternative when the request's intent covers it.
- **Where does it sit among the installed skills?** Descriptions should be MECE: every request belongs to exactly one skill. Where the new one overlaps a neighbour, extend the neighbour, or draw the line in the new description ("Not for X; use other-skill"). Catch-all descriptions are the usual culprits.
- **How will it fail?** Run a pre-mortem. A month from now it fired on the wrong request, stayed silent on the right one, or did something the user never authorised. Each failure you can picture becomes a line in the description or the body.
- **What would a smart newcomer get wrong?** That's the content. Leave out what the model does unprompted and facts that `AGENTS.md` or `CLAUDE.md` already load every session.
- **Reshaping an existing skill?** Respect Chesterton's fence: find out why a rule is there before removing it. The misfire the user reports is the failure to fix.

When you ask, send one message. Put each question first, in bold, followed by your guess and the default you'll use. The name, structure and scripts are your call; list them as assumptions.

## Steering the new skill

A skill steers another model. Use the lightest steering that works for the kind of task.

- **Judgment work** (writing, review, analysis, design): anchor it with one or two precise, well-known concepts and a few questions the agent asks itself, rather than a list of rules. A named concept such as "inverted pyramid", "steelman" or "blast radius" carries a whole practice in a couple of words, and a question adapts to each case where a rule can't. Add a line on how each concept applies here. Personas and praise ("you are a world-class expert", "high-quality") carry nothing.
- **Fragile work** (deploys, migrations, exact formats): exact steps and commands, and a script where one wrong move breaks something. Concepts and questions don't replace a checked step.
- **Every skill:** open the body with two or three sentences on who uses the output and what goes wrong without the skill, since agents fall back on that when nothing else covers a case. Keep the local facts no concept can supply: paths, commands, footguns, and what the skill may do without asking.

## Facts you can't infer

- **Description.** It's the only text seen while routing, and hosts shorten it when many skills are installed. Write it in third person ("Extracts…", not "Extract…"), with the main use case first in the words the user types and a "Not for…" naming the nearest neighbour. Leave out process narration and any purpose you inferred. Trigger wording in the body is never seen, because the body loads only after routing.
- **Spec.** `name` is 1–64 lowercase letters, digits and single hyphens, and matches the folder. `description` is at most 1,024 characters, with no XML tags. Choose a name no listed skill uses, and avoid the agents' built-in skills (Codex's `skill-creator`, Cursor's `create-skill`).
- **Placement.** A skill that names repo paths, commands or conventions goes in the project. Personal tools, cross-project workflows and matters of taste go in the user's global folder, even if the examples live in one repo. Keep one canonical copy in `.agents/skills/<name>/`, which Codex and Cursor read, and link it into `.claude/skills/` only if the user runs Claude Code. Copies drift, and Cursor loads every copy it finds. [references/placement.md](references/placement.md) has each agent's folders, precedence rules and sources.
- **Side effects.** A skill that deploys, sends, deletes or spends is explicit-only in every agent. `disable-model-invocation: true` covers Claude Code and Cursor; Codex needs `agents/openai.yaml` with `policy.allow_implicit_invocation: false`. The body says what invoking it authorises and what still needs a fresh yes. An explicit-only skill never loads for a plain request, so when it carries a safety gate, add a guard or an `AGENTS.md` pointer that the plain path can't skip.
- **Data the user edits** (rules, mappings, lists) lives in the project, not in the skill folder, so updating the skill never overwrites it. A personal skill keeps a short list in its body instead.
- **Portability.** Frontmatter beyond the spec, and features such as Claude Code's `` !`command` `` lines, are ignored by other agents. placement.md lists which agent reads what.

## Hand off

Mind the curse of knowledge: this session already knows the answers, so it can't judge routing. Test the skill the way your harness allows, in a fresh session or a subagent. Then give the user:

- the files and the description
- your assumptions, with unanswered questions first
- how to invoke it: `/name` in Claude Code and Cursor, `$name` in Codex
- three requests that should load it and two near misses, taken from neighbouring skills and from what the user excluded. For an explicit-only skill, the positives are invocations by name, and a plain-language request is a near miss
- one real task whose output should differ with and without the skill. If it doesn't, the skill isn't needed.
