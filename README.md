# Skills

Agent Skills by overment. They use the open [Agent Skills](https://agentskills.io) format, so they work in Claude Code, Codex, Cursor, and any other agent that reads `SKILL.md`.

## Skills

- **[skill-shaper](skills/skill-shaper/)** creates or reshapes a skill, checked against the skills you already have. It works out the job behind the request, decides whether a skill is the right tool, draws clear boundaries with neighbouring skills, and picks the lightest steering for the task: concepts and guiding questions for judgment work, exact steps for fragile work.
- **[explainer](skills/explainer/)** turns a system, dataset or plan into one self-contained interactive HTML diagram: architecture and flows, sequence and state machines, 18 chart types (bar, line, scatter, waterfall, heatmap, treemap, Sankey and more), Gantt, timelines, kanban, journeys, story maps, database schemas, UML, and incident reports with an annotated timeline. Clicking any part opens a short explanation next to it in the graph: what it does, why it is there and what to watch, then its facts and relations, each said once. The text and panels that talk about it light up too. Every diagram has a bare view and a view with text, light and dark themes, and click-to-explore details. It lints before building, audits the result in Chrome and captures any state as PNG or SVG. Needs Bun.
- **[knowledge](skills/knowledge/)** designs and evolves knowledge bases that agents maintain: notes vaults, team handbooks, research archives, agent memory. Rather than handing over a fixed layout, it has the model recall established methods, derive the structure from the questions the base must answer, and prove the result with filing, finding, cold-start and load tests. Note types are small contracts, not forms to fill. The base gets its own AGENTS.md and a copy of `check.ts` (links, required fields, drift; in full or for just the notes an intake touched), so later sessions keep it consistent without the skill, up to hundreds of thousands of notes. Needs Bun.

## Install

Symlink a skill into your agent's skills folder, so `git pull` updates it everywhere:

```sh
git clone https://github.com/overment/skills.git
ln -s "$PWD/skills/skills/skill-shaper" ~/.agents/skills/   # Codex, Cursor
ln -s "$PWD/skills/skills/skill-shaper" ~/.claude/skills/   # Claude Code
```

Or install it in one project by linking into that repo's `.agents/skills/` or `.claude/skills/`.

Skills can steer an agent's tools and shell, so read one before you install it.

## Develop

Each skill has routing prompts and behaviour scenarios in `evals/`. Run them in a fresh session with and without the skill.

## License

MIT © overment
