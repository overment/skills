---
name: system-diff
description: Builds a self-contained HTML report of what a pull request changes in a system, from the decision down to each changed line. Use when the user wants a system-level view of a PR or commit range. Not for a system with no change; use explainer.
license: MIT
metadata:
  author: overment
  version: "0.3.0"
---

# System diff

Without this skill, an agent builds a sound PR report in a look of its own. It names the map's parts by file path and leaves the file in a job or temp folder as `index.html`. Even with the look fixed, it writes for someone who already knows the system. The reader decides on the PR, may not read code, and has never seen this system.

## Gather the change

- Resolve both ends to SHAs. For a PR, `gh pr view <n> -R <owner/repo> --json title,body,url,baseRefOid,headRefOid` names them, and `git fetch origin <baseRefOid> pull/<n>/head` brings them. Leave the user's checkout on its branch: read other commits with `git show <sha>:<path>` or in a separate worktree.
- Diff from the merge base: `git diff <base>...<head>`, with three dots. With two dots, commits that reached the base branch later look as if the PR reverts them.
- Draw the map from the code at head, and at base for removed parts. The diff alone has no architecture.

## The report

Five layers. Each links to the next, so a reader goes from the answer to a changed line in a few clicks, and stops at the depth they need.

1. **Answer.** One short sentence says what the system is and whether to merge. The next one or two say what changes for the people who use it. Claim only what the code or a run shows: "prefers", not "always".
2. **Decisions.** Numbered, each with lettered options and a ★ on the one you recommend, so the user can answer "2b". The answer and the decisions fit the first screen. Say each in product words: what a user would notice or what could now break unnoticed, and what each option leads to. Product words change how a risk is told, not which risks are told: keep every risk you found in the code, even one no user sees.
3. **System map.** The parts the PR changes and their direct neighbours. Each box holds the part's name and a few words on what it is, so the map is the page's glossary. Solid for changed code, dashed for changed behaviour without changed code, faint for context.
4. **Parts.** One section per changed part. It opens with one line on what a user notices; before, after, why and the risk sit under it. With more than about seven parts, fold each section to that line.
5. **Files.** In an element with `id="files"`: every changed file by its full path, with its line counts and hunks, grouped under the same part names. Name lockfiles and generated files, but leave out their hunks.

Layers 1–4 are for someone who does not read code. Keep paths, code names and SHAs for the file layer. The meta line under the title holds the repository, the PR or range, both short SHAs and the date.

## Words a stranger can follow

This is the curse of knowledge: you know this system, so you can't see which of your words are private to it. The reader can.

- **One name per part.** Name it by what it does for the product ("the card a reader opens", not `client/popover.ts`). Choose the name once, and use it on the map, in the decisions, as the section heading and over the files. A second name reads as a second part.
- **Gloss at first use.** Where a name first appears, usually in a decision, say what it is in a few words in the same view: in place, or on a one-line note beside it that the name links to. "The card: the box that opens when a reader clicks a part." Do not stack those notes above the decisions. A gloss behind a hover or in a glossary further down is not in view. A gloss must not rest on another unexplained object: an arrow "between bars" still has to say that a bar is one scheduled task. After that, use the name alone and link it to its section. A thing the reader meets only once needs a description, not a name.
- **Scenes, not mechanisms.** Before and after are what a user sees or does: a screen, a message, a click, a number on the page, a command's output. Scores, thresholds and function names go into why, in product words, or into the file layer. When the product runs at both ends, show the same scene twice: a screenshot, a rendered sample or the real output.
- **Cold read.** Before you hand over, give a fresh sub-agent only the output of `node <skill-dir>/scripts/check.mjs <report.html> --text` and ask which words it cannot explain from the page alone. Gloss or replace each one. If you can't start a sub-agent, read that text yourself and say that a stranger has not read the page.

## Look

One light page in grays only: white background, ink `#111`, then `#555`, `#888`, `#ddd` and `#f5f5f5`, and `color-scheme: light`. Show state by fill, outline, dash or hatch, never by hue. Mark diff lines with `+` and `−` and a gray tint. Use the system font stack at 15px/1.55, `ui-monospace` for code, and one text column of about 72ch; the map may be wider. No kicker text: no eyebrow labels, no intro paragraph, no summary box that repeats the answer. Inline every style, script and image, so the file works offline. A UI change may embed screenshots in their real colours; the page around them stays gray. Look at the rendered page in a headless or off-screen browser before you hand over, the map first: text that leaves its box or a clipped label is a defect.

Before you hand over, run:

```sh
git diff --name-only <base>...<head> | node <skill-dir>/scripts/check.mjs <report.html> --files -
```

It fails on a colour with a hue, on anything the page loads from outside itself, on a changed file that the report does not name in its text, and on a changed file's path above the file layer. A comment that contains `id="files"` is not the file layer. It warns on code above the file layer, and when that layer has no `@@` hunk. Pass `--allow-hue` only for an accent the user asked for. It can't judge whether a gloss is clear; the cold read does that.

## Save and hand over

- Write the report to `~/Downloads/<repo>-pr-<n>.html`, or `~/Downloads/<repo>-<base7>-<head7>.html` for a commit range. Write it there directly: job, temp and ignored folders get cleared, and copies drift apart. A new run for the same PR overwrites the same file. If the project's instructions name a folder for evidence, put one copy there too.
- Show the report to the user (a window or tab on their screen) only when they asked for that. Rendering it in a headless or off-screen browser to check it is not showing it. A sub-agent or background job never shows it, even when its brief says so: it returns the path to the agent that started it.
- Reply with the answer sentence first, then the path.
