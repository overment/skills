# system-diff evals

Manual checks for routing and behaviour. Run each prompt in a fresh session with no earlier conversation. Run the behaviour scenarios twice, once with system-diff installed and once without it. Record which skill loaded, where the report was saved and what the reply said.

## Routing

Should trigger:

1. "Give me a system-level view of PR #482 in acme/shop as an HTML report."
2. "What does this branch change in our architecture compared to main? Make me a page I can click through."
3. "Make an architecture overview of what pull request 91 changed, so I can decide whether to merge it."
4. "I don't read code. Show me what https://github.com/acme/api/pull/77 does to the system."
5. "Prepare me an HTML report showing how commits a1b2c3d..e4f5a6b change the system."
6. "Before I approve PR 230, I want the big picture of which parts of the app it touches, as a report."

Should not trigger:

7. "Review PR #482 for bugs and leave inline comments." (line-level code review)
8. "Diagram our architecture so a new hire gets it in five minutes." (no change in view; explainer)
9. "Write the description for my pull request." (PR text)
10. "Summarize in two sentences what changed in the last three commits." (a chat answer)
11. "Write release notes for everything merged since v2.3." (release notes)

Pass: at least 5 of 1–6 trigger, and none of 7–11 does.

## Behaviour

| # | Setup and prompt | Expected with system-diff |
|---|---|---|
| B1 | This repository. "Treat the change from commit 96b61c0 to commit 3e0cbc9 as a pull request. Prepare me an HTML report with a system-level view of it, so I can decide on it and drill down to the details." | Saves `~/Downloads/skills-96b61c0-3e0cbc9.html`. `check.mjs` exits 0. A light gray page; map parts named in product words, paths only in the file layer. Numbered decisions with lettered options and one ★ each. The reply starts with the decision, then the path |
| B2 | A clone of any public repository with an open PR of 10–40 files. "Give me a system view of PR <n>." | Resolves both SHAs with `gh pr view`, diffs from the merge base (three dots), leaves the user's branch checked out, and saves `~/Downloads/<repo>-pr-<n>.html` |
| B3 | After B2, a new commit on the PR. "Update the system view." | Overwrites the same file; writes no `-v2` or second copy |
| B4 | Run as a sub-agent whose brief says "open it in the user's browser". | Returns the path and does not open the page |
| B5 | A PR that changes a UI screen. "Show me what this PR changes." | Screenshots keep their real colours and the page around them stays gray; `check.mjs` passes |

Checks for every scenario:

- `git diff --name-only <base>...<head> | node skills/system-diff/scripts/check.mjs <report> --files -` exits 0.
- The first sentence of the page answers what changes for the product and whether to merge.
- Every map part links to its section, and every section links to its files.
- No file paths, function names or SHAs above the file layer, except in the meta line.

Baseline from October 2026 (B1, a fresh Opus 5.5 agent without the skill): it built a sound report in 22 minutes. The decision came first, the map was clickable, all 27 files had their hunks, it ran the tests at both commits, checked the page in headless Chrome and did not run `open`. It used a dark warm theme with orange, red and green (31 hue errors from `check.mjs`), named the map's parts by file path, and saved `index.html` in a gitignored job folder. Don't add what it did right to the skill.
