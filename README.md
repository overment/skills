# Skills

Agent Skills by overment. They use the open [Agent Skills](https://agentskills.io) format, so they work in Claude Code, Codex, Cursor, and any other agent that reads `SKILL.md`.

## Skills

- **[skill-shaper](skills/skill-shaper/)** creates or reshapes a skill, checked against the skills you already have. It catches trigger collisions, decides where the skill lives and how each agent invokes it, validates the result, and hands over prompts to test routing.

## Install

Symlink a skill into your agent's skills folder, so `git pull` updates it everywhere:

```sh
git clone https://github.com/overment/skills.git
ln -s "$PWD/skills/skills/skill-shaper" ~/.agents/skills/   # Codex, Cursor
ln -s "$PWD/skills/skills/skill-shaper" ~/.claude/skills/   # Claude Code
```

Or install it in one project by linking into that repo's `.agents/skills/` or `.claude/skills/`. Its validator needs Python 3.9+ and nothing else.

Skills can steer an agent's tools and shell, so read one before you install it.

## Develop

```sh
python3 -m unittest discover -s tests
python3 skills/skill-shaper/scripts/validate.py skills/<name>
```

Routing prompts and behaviour scenarios for each skill are in `evals/`.

## License

MIT © overment
