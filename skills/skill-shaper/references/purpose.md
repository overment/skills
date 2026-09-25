# Purpose and missing context

Read this during steps 2 and 5, when the request is ambiguous, the purpose isn't obvious from evidence, or you need to decide what to ask.

## Contents

- Questions that reach the purpose
- When the purpose changes the skill
- Sorting missing context
- Phrasing gaps back to the user
- Where the purpose lives in the finished skill
- Edge cases

## Questions that reach the purpose

Ask them of the evidence first, and of the user only when the evidence is silent. Propose an answer rather than asking open-ended: "I think the point is X because you said Y, right?" takes one word to confirm.

| Question | Reveals | Changes |
|---|---|---|
| What happens right after the output exists? Who reads it, and what do they do? | The consumer | Output format, detail level, destination |
| What goes wrong today, by hand or with an agent working unguided? | The failure the skill must prevent | Core rules, gotchas, checks |
| Show one output you were happy with and one you weren't. | The quality bar, including taste nobody wrote down | Examples, self-check |
| How often does this happen, and how different is each case? | Whether a skill is the right tool | Skill, script, AGENTS.md line, or nothing |
| If this worked perfectly, what would you stop doing? | The real saving | Scope, and where the skill hands back to the user |

"What goes wrong today" is the spec. A skill is mostly a fix for a known failure; if nobody can name one, the skill probably isn't needed yet.

## When the purpose changes the skill

**Same request, different skill.** "Write release notes from our commits." The notes go to customers, who skip anything that doesn't change their day, and last month a breaking change hid in a list of forty refactors. The skill stops summarizing commits and starts sorting by customer impact: breaking changes first with what to do, then visible improvements, and internal work left out. Self-check: could a customer tell from the first three lines whether they need to act?

**Two purposes, opposite skills.** "Write unit tests for our code." If the reason is a coverage gate, the skill drifts toward shallow tests that exercise mocks. If the reason is regressions reaching production, it targets the fragile modules and past incidents, derives expected values by hand, and checks that each test fails when the code breaks. When the evidence supports both, this is the one question worth asking.

**No skill at all.** "Check that every new API route has an OpenAPI entry." This check has one right answer, and a model would sometimes get it wrong. Recommend a test or CI step that compares the router's routes with the spec, and offer to write it.

## Sorting missing context

Every gap has two properties: where the answer ends up, and who can supply it.

**Written into the skill.** True on every run, and a capable newcomer would get it wrong: domain facts, footguns ("staging shares its database with QA"), conventions, field names, the quality bar. Test: same every run, and not something the model already knows.

**Supplied at run time.** Differs between runs: the target file, the audience, the date range. For each input, the skill states whether it is required, where to look first (conversation, working files, then ask), and what to do when it is missing.

**Only the user knows.** Intent when the evidence is ambiguous, taste, unwritten organisational knowledge, risk tolerance and authority, what is out of scope. These are the only legitimate questions, and most are one-time design questions rather than run-time ones. Much of what feels like this category is really "findable but not looked up yet."

For each gap, in order:

1. Would the answer change the skill? If not, drop it.
2. Can you find it? Then go and look.
3. Is a wrong guess cheap and easy to spot? Assume it and label it.
4. Otherwise it goes into the one check-in.

## Phrasing gaps back to the user

- Lead with the guess and its evidence: "You mentioned a breaking change got buried, so I think the point is customer impact, not a commit summary."
- Show what depends on it: "If so, internal refactors disappear from the notes; if these are for the team, they stay."
- Offer a default: "I'll write for customers unless you say otherwise."
- Keep sources apart: mark each point *found* (with source), *assumed*, or *need from you*.
- Never assert a motive: "You didn't say why; my guess is X", not "Since you want to boost productivity…"
- Don't hold the work hostage. Send the draft with its assumptions marked next to the questions.

A check-in, for shape:

> Two things before I write this; everything else I found or assumed (listed below).
> 1. **Audience:** I'm reading these notes as customer-facing, so internal changes drop out. Right, or does the team read them too?
> 2. **Authority:** may it publish the notes to the changelog page, or only draft them? I'll assume draft-only.
>
> *Found:* releases are tagged `vX.Y.Z`; commits follow Conventional Commits. *Assumed:* English; a breaking change always comes with a migration line.

Then run the draft on a real case. The user's "no, not like that" defines the quality bar better than any question could.

## Where the purpose lives in the finished skill

- **Description:** only the part that helps routing ("…grouped by customer impact. Not for internal changelogs."). Never an inferred motive.
- **Purpose block** at the top of the body: consumer, failure, what good looks like, in two to four sentences.
- **Tie-breaker:** "When the rules below don't cover a case, serve this purpose and say so." Agents that report using it are telling you a rule is missing or wrong.
- **A reason beside each rule,** so the agent can tell when the rule applies: "Never omit a breaking change, even a small one; one surprised customer costs more than a longer note."
- **Non-goals** when a neighbouring skill or an obvious extension sits nearby.
- **A self-check derived from the purpose,** which is how the purpose shapes every run.

## Edge cases

- **"Just build it."** Skip the questions but still gather evidence and decide whether it's a skill. State the assumed purpose in one line at the top of the handoff so a wrong guess is visible at once.
- **The stated purpose contradicts the evidence.** "It's for executives", yet every past output went into tickets. Name the mismatch once; it often means two consumers.
- **Two consumers with different quality bars.** Prefer two skills over one skill with modes when their self-checks would conflict.
- **Reshaping an existing skill.** The bad output or misfire is the failure, so don't ask for it again. Ask only whether the purpose itself changed. If it did, rewrite the purpose block before touching rules; if not, the fix is a rule, an example, the description, or the self-check.
- **The user can't say what good looks like.** Don't ask twice. Draft two contrasting versions and ask which is closer.
