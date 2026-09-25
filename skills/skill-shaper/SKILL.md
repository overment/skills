---
name: skill-shaper
description: Creates a new agent skill or reshapes one that triggers on the wrong requests. Use when asked to make a skill, turn a workflow into a skill, or fix how a skill triggers. Not for writing about skills.
license: MIT
metadata:
  author: overment
  version: "0.6.2"
---

# Skill Shaper

You already know how to write instructions. This skill adds the judgment calls and the few facts about skill loading you can't infer. The user's instructions take precedence.

## Think it through

Answer from evidence first: the conversation, the project, and the skills your harness lists. Ask only what the evidence can't settle.

- **Job to be done.** What failure does the skill fix? That decides the rules. Label guesses: "my guess is X, because Y".
- **Poka-yoke.** One right answer → a script, CI check or hook. An always-on one-liner → `AGENTS.md`. Judgment plus a step that must never be skipped → a thin skill and a guard. If it isn't a skill, say why.
- **MECE.** Each request belongs to exactly one skill. On overlap, extend the neighbour or add "Not for X; use Y" to the new description.
- **Pre-mortem.** Picture it firing on the wrong request, staying silent, or acting without permission. Each failure becomes a line in the description or body.
- **Newcomer test.** Include only what a smart newcomer would get wrong. Leave out what the model already does and what `AGENTS.md` already says.
- **Chesterton's fence.** When reshaping a skill, find out why a rule exists before removing it.

Ask in one message: each question in bold, then your guess and default. Decide the name and structure yourself, and list them as assumptions.

## Steer the new skill

Use the lightest steering that works.

- **Judgment work** (writing, review, design): one or two precise named concepts ("steelman", "inverted pyramid") and a few questions the agent asks itself. Say how each concept applies. Skip personas and praise.
- **Fragile work** (deploys, migrations, exact formats): exact steps, commands and scripts.
- **Every skill:** open with who uses the output and what goes wrong without the skill. Keep the local facts: paths, commands, footguns, permissions.

## Facts to get right

- **Description:** what the skill does, when to use it, and what it's not for. Third person, the user's words, main use first. Nothing else: it's the only text an agent sees when choosing a skill.
- **Spec:** `name` is lowercase letters, digits and hyphens, at most 64 characters, and matches the folder. `description` is at most 1,024 characters, with no XML. Avoid names already listed or built in (`skill-creator`, `create-skill`).
- **Placement:** repo-specific → the project. Personal or cross-project → the global folder. Keep one copy in `.agents/skills/<name>/` and link it into `.claude/skills/` only for Claude Code users. Details: [references/placement.md](references/placement.md).
- **Side effects:** a skill that deploys, sends, deletes or spends is explicit-only. That means `disable-model-invocation: true` for Claude Code and Cursor, and `policy.allow_implicit_invocation: false` in `agents/openai.yaml` for Codex. Say what invoking the skill authorises and what needs a fresh yes. A plain request never loads an explicit-only skill, so add a guard or an `AGENTS.md` pointer.
- **User data:** rules and lists the user edits live in the project, not the skill folder. A personal skill keeps them in its body.
- **Portability:** frontmatter outside the spec and agent-specific syntax work in one agent only.

## Hand off

This session already knows the answers (curse of knowledge), so test routing in a fresh session or subagent. Then give the user:

- the files and the description
- your assumptions, unanswered questions first
- how to invoke it: `/name` in Claude Code and Cursor, `$name` in Codex
- three requests that should load it, and two near misses that shouldn't
- one real task whose output should differ with and without the skill
