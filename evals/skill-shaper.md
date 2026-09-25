# skill-shaper evals

Manual checks for routing and behaviour. Run each prompt in a fresh session with no earlier conversation. Run the behaviour scenarios twice: once with skill-shaper installed and once without it. Record which skill loaded and what came out.

## Routing

Should trigger:

1. "Turn what we just did into a skill."
2. "Save this workflow so you do it the same way next time."
3. "Write a SKILL.md for our release process."
4. "I keep explaining how we name migrations. Make that reusable."
5. "My deploy skill fires whenever I mention servers. Fix it."

Should not trigger:

6. "Explain how agents decide which skill to load." (writing about skills)
7. "Fix the typo in the wrangler skill's description." (small edit)
8. "Add 'use pnpm, not npm' to AGENTS.md." (a rule, not a skill)
9. "What skills do I have installed?" (inventory question)
10. "Review this pull request." (unrelated work that says "review")

Pass: at least 4 of 1–5 trigger, and none of 6–10 does. In Codex and Cursor, the built-in `skill-creator` and `/create-skill` compete for 1–4. Note which one answers; don't count it as a failure of the description.

## Behaviour

| # | Setup and prompt | Expected with skill-shaper |
|---|---|---|
| B1 | A repo whose transcripts feed a task tracker. "Make a skill that summarizes meeting transcripts." | Infers the action-item purpose from the evidence, asks at most one question, and shapes an extractor that flags unowned items rather than a summarizer |
| B2 | No context. "Make a skill that writes unit tests for our code." | Asks one question, coverage gate versus regressions, because the two answers lead to opposite skills |
| B3 | "Make a skill that checks every PR for a missing migration." | Recommends a CI step instead, builds no skill, and offers to write the step |
| B4 | "Just build me a changelog skill, no questions." | Asks nothing, states its assumed purpose in one line, and lists its assumptions in the handoff |
| B5 | Cloudflare skills installed, including a catch-all `cloudflare` skill. "Make a skill for deploying Workers." | Finds `wrangler` and `cloudflare`, asks whether to extend or build new, and, if new, names both boundaries in the description |
| B6 | "Make a skill for converting my bank's CSV export into a budget table." | Puts the parsing in a script; the body says when to run it and what to do with rows it can't categorize |
| B7 | "Make a skill for editing my blog posts in my voice." | Instruction-only, with real before-and-after examples and gotchas from past corrections; no numbered steps or scripts |

Checks for every scenario:

- No more than three questions, in one message.
- No motive presented as fact without a source.
- `validate.py` reports no errors on whatever was built.
- B6 and B7 produce visibly different shapes. If every skill comes out with the same headings, the shaping failed.
- The run without skill-shaper does worse on at least half the scenarios. If it doesn't, skill-shaper isn't adding enough to justify its context.

## Self-rebuild

Give a fresh session with skill-shaper installed this prompt: "Build a skill that helps people create other agent skills. It should interview briefly, check installed skills for collisions, and pick structure by judgment instead of a template." Compare the result with `skills/skill-shaper`. It should reach for the same decisions (evidence first, the is-it-a-skill gate, a collision check against the installed skills, a validator) and should not come out longer.
