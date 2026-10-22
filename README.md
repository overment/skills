# Skills

Agent Skills by overment. They use the open [Agent Skills](https://agentskills.io) format, so they work in Claude Code, Codex, Cursor, and any other agent that reads `SKILL.md`.

## Skills

- **[skill-shaper](skills/skill-shaper/)** creates or reshapes a skill, checked against the skills you already have. It works out the job behind the request, decides whether a skill is the right tool, draws clear boundaries with neighbouring skills, and picks the lightest steering for the task: concepts and guiding questions for judgment work, exact steps for fragile work. It runs the task once without the skill first and writes only what that run gets wrong, and it keeps descriptions to one or two plain sentences.
- **[explainer](skills/explainer/)** turns a system, dataset or plan into one self-contained interactive HTML diagram: architecture and flows, sequence and state machines, 18 chart types (bar, line, scatter, waterfall, heatmap, treemap, Sankey and more), Gantt, timelines, kanban, journeys, story maps, database schemas, UML, and incident reports with an annotated timeline. Clicking any part opens a short explanation next to it in the graph: what it does, why it is there and what to watch, then its facts and relations, each said once. The text and panels that talk about it light up too. Every diagram has a bare view and a view with text, light and dark themes, and click-to-explore details. Its text follows plain technical English (about 80% of ASD-STE100), and `check` flags any sentence over 25 words. It lints before building, audits the result in Chrome and captures any state as PNG or SVG. Needs Bun.
- **[knowledge](skills/knowledge/)** designs and evolves knowledge bases that agents maintain: notes vaults, team handbooks, research archives, agent memory. Rather than handing over a fixed layout, it has the model recall established methods, derive the structure from the questions the base must answer, and prove the result with filing, finding, cold-start and load tests. Note types are small contracts, not forms to fill. The base gets an agent skill of its own, with where things go, how each source comes in, search recipes, upkeep routines and a copy of `check.ts` (links, required fields, drift; in full or for just the notes an intake touched), so later sessions keep it consistent without knowledge installed, up to hundreds of thousands of notes. Needs Bun.
- **[article-audio](skills/article-audio/)** turns a long Markdown article into one narrated MP3 with ElevenLabs Eleven v4. The agent rewrites the article for the ear: a listener on a walk without the article and a reader following along both get what they need. A figure is told by its point and the facts the text relies on, not by its shapes and colours, and code, tables and paths become plain speech. A script checks the text for what v4 misreads (square brackets become audio tags, slashes become IPA), splits it into fragments of about two minutes, generates them with request stitching so the voice stays even, and joins them with exact pauses and loudness normalisation. Every fragment and a manifest with chapter start times stay on disk, so a later audit can regenerate one fragment without touching the rest; a retake of unchanged text gets a new seed, because v4 repeats a take for the same seed. It spends API credits, so it runs only when invoked by name, asks before anything beyond a short sample, and reports what the API actually billed. Needs Node or Bun, ffmpeg and an ElevenLabs API key.

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
