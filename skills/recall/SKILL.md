der---
name: recall
description: Finds what was decided earlier on a topic across sessions, subagent threads, trackers, docs and git history, and cites where and when. Use before answering "I don't know" or deciding something that may already be settled.
license: MIT
metadata:
  author: overment
  version: "0.2.0"
---

An earlier decision often exists where you have not looked yet, so check before you say "I don't know" or settle something that may already be settled. Sources you may reach include this session and its subagent threads, past sessions of any agent that worked on this project, issue trackers, docs and planning notes, git history on every branch, and the user; start where such a decision would most likely be recorded, and match the effort to what a wrong answer would cost. Stop when you can say which decision holds now, where and when it was made, and what it replaced. If the likely places show nothing, stop there, say where you looked and ask the user where it might be; the current state of the code and your own best guess are not decisions.
