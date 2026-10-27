---
name: system-diff
description: Builds a self-contained HTML report of what a pull request changes in a system, from the decision down to each changed line. Use when the user wants a system-level view of a PR or commit range. Not for a system with no change; use explainer.
license: MIT
metadata:
  author: overment
  version: "0.3.0"
---

# System diff

Without this skill, an agent builds a sound PR report in a look of its own. It names the map's parts by file path, uses insider names as if the reader had already used the product, and leaves the file in a job or temp folder as `index.html`. The reader decides on the PR, may not read code, and has never seen this system.

## Gather the change

- Resolve both ends to SHAs. For a PR, `gh pr view <n> -R <owner/repo> --json title,body,url,baseRefOid,headRefOid` names them, and `git fetch origin <baseRefOid> pull/<n>/head` brings them. Leave the user's checkout on its branch: read other commits with `git show <sha>:<path>` or in a separate worktree.
- Diff from the merge base: `git diff <base>...<head>`, with three dots. With two dots, commits that reached the base branch later look as if the PR reverts them.
- Draw the map from the code at head, and at base for removed parts. The diff alone has no architecture.

## The report

Four layers. The answer stays first. Each layer links to the next, so a reader goes from the decision to a changed line in a few clicks.

1. **Decision.** The first sentence says what the system is, in one clause, what changes for the people who use it, and whether to merge. Then the decisions, numbered, each with lettered options and a ★ on the one you recommend, so the user can answer "2b". A risk the reader would not see still belongs here when the code can now break unnoticed. Do not drop it to shorten the page.
2. **System map.** The parts the change touches and their direct neighbours. Each box repeats the clause from the chip. A short label between boxes says how they connect. Solid for changed code, dashed for changed behaviour without changed code, faint for context. Use HTML boxes, not a clipped SVG.
3. **Parts.** One section per changed part: before, after, why, and the risk. Before and after are what a person saw and sees. Leave open at most the one the recommended option depends on.
4. **Files.** One element with `id="files"`, closed until the reader opens it. Every changed file by its full path, with its line counts and a real unified hunk (`@@`), grouped under the same part names. Name lockfiles and generated files, but leave out their hunks. Paths stay here, also out of the decisions.

Layers 1–3 are for someone who does not read code. One name per part, used on the chip, the map, the section and the file group. The meta line under the title holds the repository, the PR or the range, both short SHAs and the date.

## The reader has not seen this product

A product name is not a definition. "The card" and "Gantt arrows" are still insider words. Where a name first matters, in the decision, the same view shows a chip: the name, then one clause for what a person does with that part. Link the name to the chip. Repeat that clause on the map box. Do not put the clause in parentheses in the decision sentence, do not hide it in a hover title, and do not add a glossary section. A word the clause itself uses, such as "bar", needs its own few words in that same clause. Later mentions may use the name alone.

**Product scene.** Before and after are what a person saw and what they see now, one or two sentences each. A path, a function or a selector is not a scene.

**Cold read.** A passing checker does not prove the reader can follow the page. Before you hand over, run `check.mjs --text` and list every name that text never explains. A fresh agent that sees only that text is the real check. If you cannot start one, say so and do the read yourself.

## Look

One light page in grays only: white background, ink `#111`, then `#555`, `#888`, `#ddd` and `#f5f5f5`, and `color-scheme: light`. Show state by fill, outline, dash or hatch, never by hue. Mark diff lines with `+` and `−` and a gray tint. Use the system font stack at 15px/1.55, `ui-monospace` for code, and one text column of about 72ch; the map may be wider. No kicker text: no eyebrow labels, no intro paragraph, no summary box that repeats the answer. Inline every style, script and image, so the file works offline. A UI change may embed screenshots in their real colours; the page around them stays gray.

Before you hand over, run:

```sh
git diff --name-only <base>...<head> | node <skill-dir>/scripts/check.mjs <report.html> --files -
```

It fails on a colour with a hue, including a named colour and a single-quoted value, on a linked asset (network or relative), on a changed file missing from the visible text, and on a changed path above `id="files"`. A comment that contains `id="files"` does not count as the file layer. It warns when that layer has no `@@` hunk. It does not judge whether a gloss is true. Pass `--allow-hue` only for an accent the user asked for.

## Save and hand over

- Write the report to `~/Downloads/<repo>-pr-<n>.html`, or `~/Downloads/<repo>-<base7>-<head7>.html` for a commit range. Write it there directly: job, temp and ignored folders get cleared, and copies drift apart. A new run for the same PR overwrites the same file. If the project's instructions name a folder for evidence, put one copy there too.
- Check the rendered page in a headless or off-screen browser. Show it to the user only when they asked. A sub-agent or background job never shows it, even when its brief says so, and returns the path.
- Reply with the decision sentence first, then the path.
