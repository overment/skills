---
name: system-diff
description: Builds a self-contained HTML report of what a pull request changes in a system, from the decision down to each changed line. Use when the user wants a system-level view of a PR or commit range. Not for a system with no change; use explainer.
license: MIT
metadata:
  author: overment
  version: "0.1.0"
---

# System diff

Without this skill, an agent builds a sound PR report in a look of its own. It names the map's parts by file path and leaves the file in a job or temp folder as `index.html`. The reader decides on the PR and may not read code.

## Gather the change

- Resolve both ends to SHAs. For a PR, `gh pr view <n> -R <owner/repo> --json title,body,url,baseRefOid,headRefOid` names them, and `git fetch origin <baseRefOid> pull/<n>/head` brings them. Leave the user's checkout on its branch: read other commits with `git show <sha>:<path>` or in a separate worktree.
- Diff from the merge base: `git diff <base>...<head>`, with three dots. With two dots, commits that reached the base branch later look as if the PR reverts them.
- Draw the map from the code at head, and at base for removed parts. The diff alone has no architecture.

## The report

Four layers. Each links to the next, so a reader goes from the answer to a changed line in a few clicks.

1. **Decision.** The first sentence says what changes for the product and whether to merge. Then the decisions, numbered, each with lettered options and a ★ on the one you recommend, so the user can answer "2b".
2. **System map.** The parts the PR changes and their direct neighbours. Solid for changed code, dashed for changed behaviour without changed code, faint for context.
3. **Parts.** One section per changed part: before, after, why, and the risk.
4. **Files.** Every changed file by its full path, with its line counts and hunks, grouped under the same part names. Name lockfiles and generated files, but leave out their hunks.

Layers 1–3 are for someone who does not read code. Name parts by what they do for the product: "the card a reader opens", not `client/popover.ts`. Keep paths, code names and SHAs for layer 4, also out of the decisions. The meta line under the title holds the repository, the PR, both short SHAs and the date.

## Look

One light page in grays only: white background, ink `#111`, then `#555`, `#888`, `#ddd` and `#f5f5f5`, and `color-scheme: light`. Show state by fill, outline, dash or hatch, never by hue. Mark diff lines with `+` and `−` and a gray tint. Use the system font stack at 15px/1.55, `ui-monospace` for code, and one text column of about 72ch; the map may be wider. No kicker text: no eyebrow labels, no intro paragraph, no summary box that repeats the answer. Inline every style, script and image, so the file works offline. A UI change may embed screenshots in their real colours; the page around them stays gray.

Before you hand over, run:

```sh
git diff --name-only <base>...<head> | node <skill-dir>/scripts/check.mjs <report.html> --files -
```

It fails on a colour with a hue, on anything loaded from the network, and on a changed file that the report does not name. Pass `--allow-hue` only for an accent the user asked for.

## Save and hand over

- Write the report to `~/Downloads/<repo>-pr-<n>.html`, or `~/Downloads/<repo>-<base7>-<head7>.html` for a commit range. Write it there directly: job, temp and ignored folders get cleared, and copies drift apart. A new run for the same PR overwrites the same file. If the project's instructions name a folder for evidence, put one copy there too.
- Open the report only when the user asked for that. A sub-agent or background job never opens it, even when its brief says so: it returns the path to the agent that started it.
- Reply with the decision sentence first, then the path.
