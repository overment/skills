# Placement and agent differences

Read this during step 4 when choosing where a skill lives, and during step 6 before using any frontmatter field outside the Agent Skills spec. These facts come from each vendor's documentation, checked September 2026. Agents change quickly; when a detail matters, confirm it in the linked docs.

## Contents

- Where each agent loads skills
- Recommended layout
- Name conflicts
- Frontmatter beyond the spec
- Sources

## Where each agent loads skills

| Folder | Claude Code | Codex | Cursor |
|---|---|---|---|
| `~/.agents/skills/` | no | yes | yes |
| `~/.claude/skills/` | yes | no | yes |
| `~/.codex/skills/` | no | no | yes |
| `~/.cursor/skills/` | no | no | yes |
| `<repo>/.agents/skills/` | no | yes, from the working directory up to the repo root | yes, anywhere in the repo |
| `<repo>/.claude/skills/` | yes, from the working directory up to the repo root | no | yes |
| `<repo>/.cursor/skills/` | no | no | yes, anywhere in the repo |
| Plugins | yes, namespaced as `plugin:skill` | yes | yes |

Other details that affect placement:

- **Claude Code** follows symlinked skill folders and loads a skill once even when several locations point at the same target. It doesn't read `~/.claude/skills/` in Cowork or cloud sessions; those use skills enabled on the claude.ai account or committed to the repo. Skills synced from claude.ai land in `~/.claude/skills/synced/`.
- **Codex** follows symlinks. Two skills with the same name both appear in its selector. It ships built-in skills, including `skill-creator`, and caps the initial skill list at about 2% of the context window, shortening descriptions first.
- **Cursor** walks skill folders recursively, so category subfolders work, and a nested `.cursor/skills/` or `.agents/skills/` is scoped to files under its directory. Only `~/.cursor/skills/` syncs to Cursor's cloud agents. Its docs don't say whether a skill reached through two folders loads once or twice.

## Recommended layout

**Personal skills:** one canonical copy in `~/.agents/skills/<name>/`, which Codex and Cursor read, plus a symlink for Claude Code if the user runs it (a `~/.claude` folder is the usual evidence):

```sh
ln -s ~/.agents/skills/<name> ~/.claude/skills/<name>
```

Don't also copy the skill into `~/.codex/skills/` or `~/.cursor/skills/`. Codex's documentation doesn't list the first folder, Cursor already reads `~/.agents/skills/`, and every extra copy drifts and loads again in Cursor. The exception is a skill that must reach Cursor's cloud agents, which only see `~/.cursor/skills/`.

**Project skills:** the canonical copy in `<repo>/.agents/skills/<name>/`, plus, when anyone on the project uses Claude Code, a relative symlink so it sees the skill and the link survives cloning:

```sh
mkdir -p .claude/skills
ln -s ../../.agents/skills/<name> .claude/skills/<name>
```

**Skills from a shared repository:** clone once and symlink each skill folder into the locations above, so `git pull` updates every agent at once.

Put a skill in the project when it names the repo's paths, commands, or conventions, or when teammates need it. Put it in the global folder when it wraps a personal tool or a workflow that crosses projects.

## Name conflicts

- **Claude Code:** personal skills win over project skills of the same name. A local skill replaces a bundled skill of the same name, but not the bundled skill's aliases. Names are compared ignoring case and look-alike dashes. `synced` is reserved.
- **Codex:** same-name skills are not merged; both appear, and the user has to choose.
- **Cursor:** no documented precedence. Treat any duplicate name as a conflict.

`scripts/scan.py --check-name <name>` checks every folder above and the agents' built-in skills.

## Frontmatter beyond the spec

The Agent Skills spec defines `name`, `description`, `license`, `compatibility`, `metadata`, and the experimental `allowed-tools`. Every agent reads those. The fields below are ignored by agents that don't list them, so a skill relying on them behaves differently elsewhere.

| Field | Claude Code | Cursor | Effect |
|---|---|---|---|
| `disable-model-invocation` | yes | yes | Loads only when invoked by name |
| `paths` | yes | yes | Loads only for matching files |
| `when_to_use` | yes | | Extra trigger text; shares the 1,536-character listing cap with the description |
| `user-invocable` | yes | | `false` hides the skill from the `/` menu |
| `argument-hint`, `arguments` | yes | | Argument hints and `$name` substitution |
| `allowed-tools`, `disallowed-tools` | yes | | Pre-approves or removes tools while the skill runs |
| `model`, `effort` | yes | | Overrides the model or effort for the turn |
| `context: fork`, `agent`, `background` | yes | | Runs the skill in a subagent |
| `hooks`, `shell` | yes | | Registers hooks; picks the shell for inline commands |
| `icon`, `color` | | yes | Badge when the skill runs as a Custom Mode |

Codex keeps its extras outside the frontmatter, in `agents/openai.yaml`: display name, icons, `policy.allow_implicit_invocation`, and tool dependencies such as MCP servers.

Claude Code also expands `` !`command` `` lines and `${CLAUDE_SKILL_DIR}` inside the body. Other agents see those as literal text, so a portable skill doesn't rely on them.

## Sources

- Agent Skills specification: https://agentskills.io/specification
- Claude Code skills: https://code.claude.com/docs/en/skills
- Codex and ChatGPT skills: https://developers.openai.com/codex/skills
- Cursor skills: https://cursor.com/docs/skills
