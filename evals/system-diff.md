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
| B1 | This repository. "Treat the change from commit 96b61c0 to commit 3e0cbc9 as a pull request. Prepare me an HTML report with a system-level view of it, so I can decide on it and drill down to the details." | Saves `~/Downloads/skills-96b61c0-3e0cbc9.html`. `check.mjs` exits 0. A light gray page. The first sentence says what explainer is and whether to merge. The answer and the decisions fit the first screen, and each name a decision uses is glossed in that view. Numbered decisions with lettered options and one ★ each, in product words. They keep the three risks found in the source at 3e0cbc9: audit no longer checks one-line relation rows in the card; a click on a Gantt bar where an arrow crosses it selects the arrow; 8 template cards lose an "Allowed in: 1 of 3" or "2 of 3" total. Each map box says what its part is. The 11 or so parts fold to one line each. The reply starts with the answer, then the path |
| B2 | A clone of any public repository with an open PR of 10–40 files. "Give me a system view of PR <n>." | Resolves both SHAs with `gh pr view`, diffs from the merge base (three dots), leaves the user's branch checked out, and saves `~/Downloads/<repo>-pr-<n>.html` |
| B3 | After B2, a new commit on the PR. "Update the system view." | Overwrites the same file; writes no `-v2` or second copy |
| B4 | Run as a sub-agent whose brief says "open it in the user's browser". | Returns the path and does not show the page. A headless or off-screen check is allowed |
| B5 | A PR that changes a UI screen. "Show me what this PR changes." | Screenshots keep their real colours and the page around them stays gray; `check.mjs` passes |
| B6 | A PR of 100 or more files in any public repository. "I don't know this codebase. What does PR <n> change, and should we merge it?" | The map groups the parts into a few areas; each part folds to one line; the reader reaches any file in three clicks; the cold read finds no unexplained name in the decisions |

Checks for every scenario:

- `git diff --name-only <base>...<head> | node skills/system-diff/scripts/check.mjs <report> --files -` exits 0.
- The first sentence says what the system is and whether to merge; the next say what changes for its users. No claim goes further than the code or a run shows.
- The answer and the decisions fit the first screen. Render the page headless at about 1440×900 to see it.
- Every risk that a run without the skill finds in the code is still in the decisions or the parts.
- Every map part links to its section, and every section links to its files. The file layer holds the hunks of every changed file except lockfiles and generated files.
- No file paths, function names or SHAs above the file layer, except in the meta line. `check.mjs` fails on a changed file's path there and warns on any `<code>`.
- One name per part: the map box, the decisions, the section heading and the file group use the same words.
- Cold read: a fresh agent that never saw the repository gets only the `check.mjs <report> --text` output and lists the names it can't explain. Compare the count with the same run without the skill (or with the previous version).

Baseline from October 2026 (B1, a fresh Opus 5.5 agent without the skill): it built a sound report in 22 minutes. The decision came first, the map was clickable, all 27 files had their hunks, it ran the tests at both commits, checked the page in headless Chrome and did not run `open`. It used a dark warm theme with orange, red and green (31 hue errors from `check.mjs`), named the map's parts by file path, and saved `index.html` in a gitignored job folder. Don't add what it did right to the skill.

With system-diff 0.1.0 (B1, Opus 5.5 high, one run): gray, saved to `~/Downloads`, 0 errors, decisions lettered. It still wrote for a reader who knows explainer. The decisions came before the map and used names the page explained later or never ("audit", "click band", "template cards", "the removed pin"), plus a CSS selector and a file path. One part had up to three names: map box "Board marker slot", section "The docked card and its marker". Map boxes said a scope ("system figures", "over the bars"), not what the part is. Before and after were often the mechanism ("entering such a zone costs 240, more than a crossing (160)"). All 11 parts were open: 2,258 words above the file layer. Version 0.2.0 targets these.

With system-diff 0.2.0 (B1, Opus 5.5 xhigh, one run, saved under another name and told not to open the page): `check.mjs` 0 errors, 0 warnings. The first sentence says what explainer is; the map comes first and each of its 9 boxes says what the part is; 8 of 8 parts keep one name on the map, in the section and over the files; before and after are 13 captures of the product's own sample diagrams at both ends; 869 of 2,539 words show before any fold. It had 2 decisions, not 5, and left out three risks the 0.1.0 run found (audit stops checking one-line rows, a click on a Gantt bar under an arrow selects the arrow, "1 of 3" lost on 8 cards; team-3 confirmed all three in the source). Its one Gantt decision was about a different effect, a white gap where an arrow crosses a bar. One run can't tell whether that is the skill or chance; rerun B1 two or three times per version. It never rendered the page, and the map has two labels that overflow. Its answer was one 63-word sentence with claims stronger than the code ("never look highlighted by mistake" for a hue-distance test). That 0.2.0 was then revised, and the group's merge is 0.3.0: decisions back on the first screen, every risk kept, the answer split, the rendered page checked, and a warning when the file layer has no hunk. That revision has no fresh run yet.
