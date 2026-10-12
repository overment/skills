---
name: skill-shaper
description: Creates a new agent skill or reshapes one that triggers on the wrong requests. Use when asked to make a skill, turn a workflow into a skill, or fix how a skill triggers. Not for writing about skills.
license: MIT
metadata:
  author: overment
  version: "0.7.0"
---

# Skill Shaper

You already know how to write instructions. This skill adds the judgment calls and the few facts about skill loading you can't infer. The user's instructions take precedence.

## Think it through

Answer from evidence first: the conversation, the project, and the skills your harness lists. Ask only what the evidence can't settle.

- **Job to be done.** What failure does the skill fix? That decides the rules. Label guesses: "my guess is X, because Y".
- **Poka-yoke.** One right answer → a script, CI check or hook. An always-on one-liner → `AGENTS.md`. Judgment plus a step that must never be skipped → a thin skill and a guard. If it isn't a skill, say why.
- **MECE.** Each request belongs to exactly one skill. On overlap, extend the neighbour or add "Not for X; use Y" to the new description.
- **Baseline.** When the task is safe to run, have a fresh agent with the same tools do it once without the skill. The bare tool run with its defaults isn't a baseline, and neither is your own run: you know too much. If you can't start a fresh agent, say so and give the user the prompt to run. Its mistakes are the skill's job; if it makes none, the skill may not be needed.
- **Newcomer test.** Write only what the baseline got wrong and local facts no model can know: names, paths, flags, limits, footguns. Cut general know-how (using common tools, reading `--help`, guarding secrets, checking output, reporting back) and anything the tool's own help or `AGENTS.md` already says.
- **Pre-mortem.** Picture it firing on the wrong request, staying silent, or acting without permission. Test those cases. Only a failure you see, or can't test, becomes a line.
- **Chesterton's fence.** When reshaping a skill, find out why a rule exists before removing it.

Ask in one message: each question in bold, then your guess and default. Decide the name and structure yourself, and list them as assumptions.

## Steer the new skill

Use the lightest steering that works.

- **Judgment work** (writing, review, design): one or two precise named concepts ("steelman", "inverted pyramid") and a few questions the agent asks itself. Say how each concept applies. Skip personas and praise.
- **Fragile work** (deploys, migrations, exact formats): exact steps, commands and scripts.
- **Every skill:** at most one opening sentence on what goes wrong without it, then the local facts. No section that restates the tool's documentation.

## Facts to get right

- **Description:** one or two sentences, about 250 characters at most: what the skill does and when to use it, third person, in the words a user would type. No lists of examples, file types or features; the model generalizes from one clear phrase. Add "Not for X" only for a near miss the wording would otherwise catch, and name the skill that should take it. It's the only text an agent sees when choosing a skill.

  Slop: "Transcribes local audio and video recordings, such as meetings, calls, interviews, lectures, podcasts and voice memos, into well-formatted Markdown with named speakers and correct spelling of terms… (.mp3, .m4a, .wav…) … Not for live dictation, reading text aloud, subtitle files…"
  Clean: "Transcribes audio and video recordings with the `transcribe` CLI. Use when the user wants a transcript, notes or quotes from a recording."
- **Spec:** `name` is lowercase letters, digits and hyphens, at most 64 characters, and matches the folder. `description` is at most 1,024 characters, with no XML. Avoid names already listed or built in (`skill-creator`, `create-skill`).
- **Placement:** repo-specific → the project. Personal or cross-project → the global folder. Keep one copy in `.agents/skills/<name>/` and link it into `.claude/skills/` only for Claude Code users. Details: [references/placement.md](references/placement.md).
- **Side effects:** a skill that deploys, sends, deletes or spends is explicit-only. That means `disable-model-invocation: true` for Claude Code and Cursor, and `policy.allow_implicit_invocation: false` in `agents/openai.yaml` for Codex. Say what invoking the skill authorises and what needs a fresh yes. A plain request never loads an explicit-only skill, so add a guard or an `AGENTS.md` pointer.
- **User data:** rules and lists the user edits live in the project, not the skill folder. A personal skill keeps them in its body.
- **Portability:** frontmatter outside the spec and agent-specific syntax work in one agent only.

## Hand off

This session already knows the answers (curse of knowledge), so test routing and the task in fresh subagents. Cut every line whose behaviour the baseline already showed. Then give the user:

- the files and the description
- your assumptions, unanswered questions first
- how to invoke it: `/name` in Claude Code and Cursor, `$name` in Codex
- three requests that should load it, and two near misses that shouldn't
- one real task whose output should differ with and without the skill
