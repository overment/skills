# Shaping a skill

Read this during step 6. It gives the criteria for each element a skill might have. None of them is mandatory beyond the frontmatter and the purpose; include an element only when its criterion holds.

## Contents

- Description
- Body elements and when each earns its place
- Degrees of freedom
- Scripts
- References and assets
- Invocation
- Contrasting shapes
- Size

## Description

The description is the only text an agent sees when it decides whether to load the skill, and hosts shorten it when many skills are installed.

- Start with what the skill does, in the nouns the user uses: file types, tools, systems, project names.
- Follow with "Use when…" and the phrasings people actually type, including indirect ones ("what changed for customers since the last tag?").
- End with "Not for…" naming the nearest neighbour and, where one exists, the skill to use instead.
- Third person, no XML tags, at most 1024 characters. Put the most important use case first.

How pushy to be depends on the neighbourhood. Alone in its territory, a skill should claim every phrasing of its job, because agents under-trigger. Next to overlapping skills, it should claim less and name its boundaries, because a broad description steals prompts from specialists.

Weak: `Helps with release notes.`
Strong: `Writes customer-facing release notes from git history between two tags, grouped by customer impact with breaking changes first. Use when the user asks for release notes, a changelog entry, or what changed for customers since a version. Not for internal changelogs or commit message writing.`

## Body elements and when each earns its place

| Element | Include when |
|---|---|
| Purpose block and tie-breaker | Always |
| Inputs | The skill needs run-time material; state required or optional, where to look, and the default |
| Steps | Order matters, or a step is easy to skip |
| Output format | Something downstream parses or files the output; show the literal skeleton |
| Examples | Quality depends on taste or format; one real input and output beats three invented ones |
| Gotchas | Known failures exist; this is usually the most valuable section |
| Stop and ask | A wrong guess is costly or irreversible |
| Self-check | The output can be checked against the purpose before returning |
| Non-goals | A neighbouring skill or an obvious extension sits nearby |

Leave out anything whose only job is to explain the skill to a human reader. The agent reads the body only after the skill has triggered.

## Degrees of freedom

| Task | Freedom | Write |
|---|---|---|
| Review, writing, analysis, design | High | The goal, constraints, the quality bar, and reasons |
| Recurring procedure with variations | Medium | Steps with parameters, and when to deviate |
| Fragile or irreversible sequence | Low | Exact commands, a script, and "don't improvise" with the reason |

Over-constraining judgment work makes an agent brittle and literal. Under-constraining a fragile sequence makes it improvise where it shouldn't.

## Scripts

Add a script when the same code would be rewritten on every run, when the step needs exact output (parsing, conversion, date arithmetic, validation), or when a mistake is expensive. Keep judgment in prose.

A script is run, not read, so it costs almost no context. It should:

- solve the problem rather than hand it back to the model
- take arguments instead of hardcoded paths, and name its constants
- fail with messages that say what to fix
- print a result the agent can act on
- depend only on what the target machine already has, or state the dependency in `compatibility`

The body gives the exact command and says what the output means.

Data the user maintains over time, such as mappings, rules, or allow-lists, doesn't belong in the script or in the skill folder. Keep it in the project where the user edits their other files, and have the script read it from there. The skill folder then stays replaceable when a new version is installed.

## References and assets

Use `references/` for material that only some runs need: API details, a domain glossary, per-variant instructions (one file per provider, framework, or language). The body must say when to read each file ("Read `references/billing.md` before touching invoices"); an unmentioned file is never opened. Link only from SKILL.md, never from one reference to another, and put a Contents section at the top of any file over about 100 lines.

Use `assets/` for files copied into the output: templates, boilerplate, images, schemas.

A personal skill that works across projects can't rely on a path inside one checkout. When its best evidence, such as example writing or a sample output, lives in a single project, quote a short excerpt in the body or keep a copy in `assets/`. Mention the original location only as optional context.

## Invocation

- **Implicit (default):** the agent loads the skill when a prompt matches its description. Right for knowledge and workflows without side effects.
- **Explicit only:** for deploys, sends, deletions, payments, or anything the user wants to control. Claude Code and Cursor use `disable-model-invocation: true`; Codex uses `policy.allow_implicit_invocation: false` in `agents/openai.yaml`. Also make the body confirm before the irreversible step, since other agents ignore these fields.
- **Scoped to files:** Claude Code and Cursor accept `paths` globs, so file-specific guidance loads only for matching files.

## Contrasting shapes

The same procedure produces very different skills. These show the range; don't copy any of them.

**Reference skill, about 15 lines.** A team's API error conventions. Description, purpose, a short table of error codes and their meanings, two gotchas. No steps, scripts, or examples.

**Procedure skill, about 60 lines.** Adding a new service to monitoring. Purpose, inputs (service name and owner), numbered steps with the exact commands, a stop-and-ask before paging rules go live, and a checklist self-check. Explicit invocation because it changes on-call routing.

**Script-first skill, about 25 lines plus a script.** Renaming and resizing product photos to the shop's conventions. The body says when to run `scripts/prepare.py`, how to read its report, and what to do with photos it rejects. All image handling lives in the script.

**Judgment skill, about 40 lines.** Reviewing pull request descriptions for what a reviewer needs. Purpose, the quality bar, one real before-and-after example, and gotchas taken from past corrections. No steps, because the order doesn't matter.

**Router skill, about 30 lines plus references.** Working across several providers. The body picks the variant and says which reference file to read; each provider's detail lives in its own file.

## Size

Most good skills are well under 200 lines of body. Past about 500 lines, or 5000 tokens, move detail into references. Length is a symptom, not the goal: a 20-line skill that fixes a real failure beats a 300-line one that restates what the model already knows.
