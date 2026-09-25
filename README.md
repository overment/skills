# Skills

Agent Skills by overment, for Claude Code, Codex, Cursor, and any other agent that reads the open [Agent Skills](https://agentskills.io) format.

Each skill is a folder with a `SKILL.md`: a short description that tells the agent when to load it, and instructions it follows once loaded. Scripts and reference files load only when a task needs them.

## Skills

| Skill | What it does |
|---|---|
| [skill-shaper](skills/skill-shaper/) | Shapes a new skill, or reshapes one that misfires. It gathers evidence before asking, finds the purpose behind the request, decides whether a skill is the right tool at all, checks your installed skills for name and trigger collisions, then picks structure, placement, and invocation to fit, instead of filling a template. Ships with a scanner for installed skills and a spec validator. |

## Install

Clone the repository once, then link the skills you want into the folders your agents read. Links keep every agent on the same copy, and `git pull` updates all of them.

```sh
git clone https://github.com/overment/skills.git ~/src/overment-skills
cd ~/src/overment-skills

mkdir -p ~/.agents/skills ~/.claude/skills
ln -s "$PWD/skills/skill-shaper" ~/.agents/skills/skill-shaper   # Codex and Cursor
ln -s "$PWD/skills/skill-shaper" ~/.claude/skills/skill-shaper   # Claude Code
```

Skip the second link if you don't use Claude Code, or if `~/.claude/skills` is already a symlink to `~/.agents/skills`. For a single project, link into the repo's `.agents/skills/` (and `.claude/skills/` for Claude Code) instead.

| Agent | Personal folder | Project folder |
|---|---|---|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Codex | `~/.agents/skills/` | `.agents/skills/` |
| Cursor | `~/.agents/skills/` or `~/.cursor/skills/` (also reads the Claude and Codex folders) | `.agents/skills/` or `.cursor/skills/` |

Avoid copying a skill into several of these folders. Copies drift apart, and Cursor loads each one separately. [skill-shaper's placement notes](skills/skill-shaper/references/placement.md) cover the details and the sources.

## Use

Skills load on their own when a request matches their description. Ask for what you want ("turn this workflow into a skill"), or invoke one by name: `/skill-shaper` in Claude Code and Cursor, `$skill-shaper` in Codex. Codex and Cursor ship their own skill creators, which answer similar requests; invoke skill-shaper by name when you want it specifically.

The bundled scripts need Python 3.9 or newer and no packages:

```sh
python3 skills/skill-shaper/scripts/scan.py              # every skill your agents load, with collisions and drift
python3 skills/skill-shaper/scripts/scan.py --check-name my-skill
python3 skills/skill-shaper/scripts/validate.py path/to/skill
```

## Layout

```text
skills/<name>/          one folder per skill: SKILL.md plus optional scripts/, references/, assets/
evals/<name>.md         routing prompts and behaviour scenarios for each skill
tests/                  unit tests for bundled scripts
```

Evals and tests live outside the skill folders, so installing a skill doesn't copy them.

## Develop

```sh
python3 -m unittest discover -s tests
python3 skills/skill-shaper/scripts/validate.py skills/<name>
```

Skills are code that steers an agent's tools and shell. Read a skill before installing it, from this repository or any other.

## License

MIT © overment
