---
title: How agents share what they learn
chrome: title
width: wide
---

Agents never talk to each other directly. Each one reads from and writes to [Shared memory](#memory). As a result, what one agent learns is available to every other agent on its next step. The [Planner](#planner) writes the plan. The [Researcher](#researcher) adds findings, and results from [Tools](#tools) come back into memory. The [Writer](#writer) turns the plan and findings into a draft, and the [Reviewer](#reviewer) checks that draft against the plan.

```figure
id: agent-memory
layout: hub
grid: [5, 4]
nodes:
  memory:     { label: Shared memory, at: [2, 1], kind: store, focal: true, about: "Keeps the plan, findings, drafts and feedback in one place. Every agent starts its step here, so no agent has to ask another agent anything." }
  planner:    { label: Planner, at: [0, 0], about: "Breaks the goal into tasks and records them as the plan. Rewrites the plan when feedback shows it was wrong." }
  researcher: { label: Researcher, at: [0, 2], about: "Looks up facts for each task and saves them as findings. Each finding notes its source, so later agents can check it." }
  writer:     { label: Writer, at: [4, 0], about: "Reads the plan and findings, then saves a draft back to memory. Never searches for facts itself." }
  reviewer:   { label: Reviewer, at: [4, 2], about: "Checks the latest draft against the plan. Leaves feedback in memory for the next round." }
  tools:      { label: Tools, at: [2, 3], kind: external, about: "Search, code runners and APIs that agents call. Their results go into memory so that no agent repeats the same call." }
edges:
  - planner -> memory: writes plan
  - researcher -> memory: writes findings
  - memory -> writer: plan + findings
  - writer -> memory: saves draft
  - memory -> reviewer: latest draft
  - reviewer -> memory: feedback
  - tools --> memory: returns results
notes:
  - { on: memory, text: "No agent talks to another directly: every hand-off goes through Shared memory." }
caveat: How agents take turns is not shown; the figure only shows where the work is kept.
```

Every agent writes to memory: the [Planner](#planner) its plan, the [Researcher](#researcher) and [Tools](#tools) their findings, the [Writer](#writer) a [draft](#writer->memory) and the [Reviewer](#reviewer) its [feedback](#reviewer->memory). Only the Writer and the Reviewer read from it. When a new agent joins, it gets everything learned so far by reading [Shared memory](#memory). No other agent has to pass it anything.

```glossary
agent: A program that uses a language model to work toward a goal one step at a time.
context window: The text a model can see at once. Anything outside it is forgotten unless it is saved somewhere.
```
