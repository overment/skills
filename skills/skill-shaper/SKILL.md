---
name: skill-shaper
description: Shapes a new Agent Skill, or reshapes one that misfires, through a short evidence-first interview. Finds the purpose behind the request and the context the skill is missing, checks installed global and project skills for name and trigger collisions, decides whether a skill is the right tool at all, then chooses structure, placement and invocation, writes the files, validates them, and hands over test prompts. Use when the user asks to create or build a skill, write a SKILL.md, turn a workflow or conversation into a skill, make a procedure reusable across sessions, or fix a skill that triggers when it shouldn't or doesn't trigger at all. Not for small edits to an existing skill, writing about skills, or editing AGENTS.md or CLAUDE.md rules.
license: MIT
compatibility: Bundled scripts need Python 3.9 or newer and no packages.
metadata:
  author: overment
  version: "0.3.2"
---

# Skill Shaper

A skill is worth the difference between how an agent works with it and without it. This procedure finds that difference, writes only that, and makes sure the skill fires where it should and nowhere else.

The user's instructions override this skill. If they want no questions, a particular layout, or a specific location, do that and list what you assumed.

The scripts live in this skill's `scripts/` folder. Run them as `python3 <this skill's directory>/scripts/<script>.py`; both print `--help`.

## 1. Gather evidence before asking

- **The conversation:** steps taken, commands run, formats produced, and every correction the user made. Corrections are the most valuable raw material a skill can have.
- **Installed skills:** run `scripts/scan.py --project <repo root>`, adding `--home <dir>` when your `$HOME` isn't the user's (containers, remote workers). It lists every skill the user's agents load, with full descriptions, install locations, drifted copies, and broken frontmatter. Keep the output; step 4 needs it.
- **The project:** `AGENTS.md` or `CLAUDE.md`, the files the workflow touches, and past outputs the user liked or rejected.

Label each fact *found* (with its source), *assumed*, or *unknown*. Look up whatever you can instead of asking for it.

## 2. Find the purpose behind the request

The request names a task. The skill has to serve the reason the task exists, and that reason decides the output format, the rules, and the self-check. Fill these in from evidence:

- **Consumer:** who or what uses the output, and what they do next.
- **Failure:** what goes wrong today without the skill.
- **Good:** what an acceptable output looks like, ideally a real one.
- **Frequency and variance:** how often it happens, and how much each case differs.
- **Authority:** what the skill may do without asking: write, send, delete, deploy, spend.

Go one level above the request, not five. Stop when the next "why" no longer changes a rule, an input, the self-check, or whether to build at all. Never present a motive the user didn't state as fact; write "my guess is X, because Y". [references/purpose.md](references/purpose.md) has probing questions, worked examples, and how to sort missing context.

## 3. Decide whether it should be a skill

| Signal | Build instead |
|---|---|
| Happens once | Do the task |
| Always-on constraint of a line or two | A line in `AGENTS.md` or `CLAUDE.md` |
| A check, conversion, or calculation with one right answer | A script. If it must run on every change, a lint rule, hook, or CI step. If people ask an agent for it now and then, a thin skill that runs the script, rather than an `AGENTS.md` line that costs context in every session |
| Needs live data or actions in another system | An MCP tool, possibly with a thin skill on top |
| An installed skill already covers the territory | Extend that skill |
| Nobody can name what goes wrong today | Nothing yet; offer to do the task once |
| Recurs, needs judgment, has a clear trigger, fails in known ways | A skill |
| A judgment workflow with a mechanical step that must never be skipped | A thin skill for the judgment, plus a script, guard, or CI check for the mechanical part |

When the answer isn't a skill, say so, name the alternative, and say why. Build it if the request's intent already authorises that kind of change ("check every PR" authorises editing CI, even though it asked for a skill); otherwise offer to. A request for a skill is not by itself a reason to create one. Then skip step 4 and step 6, still ask as step 5 describes if open points remain, and verify the alternative in step 7. In the hybrid case, the skill part goes through every step and the mechanical part is verified like an alternative.

## 4. Check the neighbourhood

Using the scan from step 1:

- **Triggers matter more than names.** Find every installed skill whose description would plausibly claim the new skill's prompts. Catch-all descriptions ("any X task", "comprehensive") are the usual thieves. For each overlap, choose: extend the existing skill, narrow the new description and name the boundary (`not for X; use other-skill`), or split or merge.
- **Names:** run `scripts/scan.py --check-name <name>`. It checks the spec and every folder the agents read, plus the agents' built-in skills. Follow prefixes already in use, and avoid generic names such as `helper` or `review` that invite the next collision.
- **Placement:** a skill that names repo paths, commands, or conventions belongs in the project. Personal tools, cross-project workflows, and taste (a writing voice, a review style) belong in the user's global folder, even when all the examples live in one repo. Write one canonical copy and link it only for the other agents the scan or the user shows they run, because copies drift. [references/placement.md](references/placement.md) lists where each agent looks.

Mention drift, duplicates, or broken frontmatter the scan shows near the new skill, but leave other skills alone unless the user asks.

## 5. Ask once, and only what changes the skill

Before asking, predict the likely answers. If the skill would come out the same either way, choose a default and label it assumed. Evidence rarely settles these, so they usually go to the user:

- where the skill must **not** fire
- the quality bar, when there is no example output
- side effects it may take without confirmation
- personal or project scope, when the evidence is split

Send one message with at most three questions, most consequential first. Open each with the question itself in bold, then your guess, its evidence, what depends on it, and the default you'll use if they don't answer; a question buried mid-paragraph tends to go unanswered. Design choices such as script or prose, one skill or two, and the name are yours: decide them and list them as assumptions instead of asking. A trivial skill gets no questions: draft it and list the assumptions. An answer that doesn't address what you asked leaves your default in place; list it first among the handoff's assumptions. Ask a second round only when an answer opened a new output, side effect, or audience. If the user can't describe what good looks like, draft two contrasting versions and let them pick.

## 6. Shape it

There is no template. Each element earns its place from what this skill needs; [references/shaping.md](references/shaping.md) holds the decision criteria and contrasting shapes. What every skill gets:

- **Description:** what it does and when to use it, front-loaded with the words the user actually types, plus "not for…" naming the nearest neighbour. Third person. All trigger information lives here, because the body is invisible while the agent decides.
- **Purpose:** open the body with two to four sentences naming the consumer and the failure, then: "When the rules below don't cover a case, serve this purpose and say so."
- **Content test:** a line belongs only if it holds on every run and a capable newcomer would get it wrong. Cut background, generic advice, anything the model already does unprompted, and facts the project's always-loaded files (`AGENTS.md`, `CLAUDE.md`) already carry. If the skill quotes an example output, run its own self-check on that example; if the example fails, the rule is wrong.
- **Reasons over volume:** give each rule its reason instead of capitalized MUSTs. Agents handle edge cases from the reason.
- **Freedom matched to fragility:** goals and constraints for judgment work; exact steps or a script where one wrong move breaks something.
- **Side effects:** skills that deploy, send, delete, or spend are explicit-invoke only where the agent supports it. Inside the skill, separate what the user already authorised by invoking it from what needs a fresh yes, and say which is which. Confirming every command trains people to approve without reading. An explicit-only skill never loads for a plain request like "deploy to prod", so when it carries a safety gate, add a one-line pointer in `AGENTS.md` or a guard the plain path can't skip.
- **User-maintained data:** mappings, rules, or lists the user edits over time live in the project next to their other files, not inside the skill folder. The skill tells the agent where to find them. A personal skill has no project: keep a short list in the body and offer to extend it when the user corrects something.
- **Portability:** describe actions ("ask the user") instead of naming one agent's tools, unless the skill targets that agent alone.

Inferred purposes and unconfirmed assumptions go in the handoff, never in the description. If an agent needs an assumption at run time, put it in the body marked unconfirmed.

## 7. Validate and hand off

For a skill:

1. Run `scripts/validate.py <skill-dir>` and fix every error. Treat warnings as questions: fix them or know why not.
2. Run `scripts/scan.py` again and confirm the new skill is listed once, with any other paths marked as links to it, and no new collision.
3. Hand off:
   - the file tree and the description
   - the purpose in one line, and the assumptions you made
   - how to invoke it in each agent the user runs. For an explicit-only skill this is the only way it runs: `/name` in Claude Code and Cursor, `$name` in Codex
   - three or more prompts that should trigger it, worded differently from the request, and two or more near misses taken from neighbouring skills' territory and from what the user excluded. For an explicit-only skill, the positives are invocations by name, and a plain-language request is a near miss that must not load it
   - the baseline check: one representative task the skill serves (not the request to create it), run once in a fresh session without the skill and once with it. If the outputs don't differ, the skill isn't needed yet.

Offer to run those checks in a fresh session or subagent, because this conversation already knows the answers and would hide what the skill is missing. If no fresh session is available, list the checks as pending, each with the difference it should show.

For an alternative, first run it against the repository as it stands, which should pass; if it doesn't, fix the cause or report it before relying on the check. Then exercise it the way it will run (the script on a sample, the CI check against a passing and a failing case). When it depends on a system you can't reach, run it against a stand-in and name the real run still pending. Hand off why it isn't a skill, what it catches, what it doesn't, and anything the user still has to switch on.

## Gotchas

- **Pushy versus precise.** Agents tend to under-trigger skills, so a description should cover every phrasing inside its territory. In a crowded neighbourhood, widening the territory steals prompts; name boundaries instead.
- **Inferred purpose in the description** widens the trigger beyond what the user asked for.
- **Every skill comes out the same shape.** If this one looks like the last skill you shaped, you applied a template. A reference skill can be ten lines; a fragile workflow can be mostly a script.
- **Trigger phrases in the body.** A "When to use" section is never seen at routing time.
- **Copies instead of links.** A skill copied into each agent's folder drifts, and agents that read several folders load every copy.
- **Descriptions get shortened** when many skills are installed, so the key use case goes first.
