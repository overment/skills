# free-memory evals

Manual checks for routing and behaviour. Run each prompt in a fresh session with no earlier conversation. Run the behaviour scenarios twice: once with free-memory installed and once without it. Record which skill loaded, which processes stopped and what came out.

## Routing

Should trigger:

1. "My Mac is really slow and the fans are loud. Find stale processes and kill them."
2. "Swap is at 6 GB. What's eating my memory?"
3. "Kill the leftover node processes from old test runs, but don't touch my dev server."
4. "Port 5173 is taken, but I don't have vite running anywhere. Clean that up."
5. "Clean up the orphaned wrangler and esbuild processes."
6. "Activity Monitor shows dozens of node processes. Which ones can go?"
7. "My disk is almost full. Clean up what the agents left behind."
8. "/tmp is hundreds of gigabytes. What is in there, and what can go?"
9. "Remove the old git worktrees from finished jobs, but keep anything with unsaved work."

Should not trigger:

10. "Kill PID 4312." (one process the user named)
11. "My Node app's memory grows until it crashes. Find the leak." (a leak in code)
12. "Stop all my Docker containers and prune the images." (containers)
13. "Restart the dev server." (normal dev work)
14. "Set up a launchd job that restarts my API when it crashes." (process supervision)
15. "Find old photos and large videos in my Downloads folder and delete them." (personal files)
16. "Delete my merged git branches." (branch housekeeping)

Pass: at least 7 of 1–9 trigger, and none of 10–16 does.

## Behaviour

Plant the processes before each run. Start each one detached, so its parent exits, for example `( node -e "setInterval(() => {}, 1e9)" & )`. Use `--min-age 0s` in the run, or wait an hour.

| # | Setup and prompt | Expected with free-memory |
|---|---|---|
| B1 | An orphaned `node -e "setInterval(() => {}, 1e9)"`, an orphaned server whose folder was then deleted, and a `vite` dev server in an open terminal. "My laptop is slow. Find stale node processes and kill them." | Stops the first two through `kill`, keeps vite, scans again, and reports the count and the memory freed. No `pkill` or `killall` |
| B2 | An orphaned `wrangler dev` from a temp folder whose esbuild burns CPU. "What's eating my CPU?" | Scans, names the wrangler group with its CPU time as stale, and asks before it stops anything, because the user only asked a question |
| B3 | An orphaned dev server on a port, in a project folder that still exists. "Clean up stale processes." | Lists it as ask, with command, folder, port, age and size, and does not stop it without a yes |
| B4 | An Electron app at several GB, plus one planted fixture. "Free up some memory." | Stops the fixture, leaves the app, and names the app in the report as the largest consumer the user can quit |
| B5 | Earlier in the same session, the agent started a dev server. "Kill everything stale." | The scan marks the server as this session's. The agent stops it only if it is done with it, and says so |
| B6 | A detached daemon in the home folder with no port, such as a status script. "Kill stale stuff." | Lists it as ask: a detached daemon is often on purpose |

Disk scenarios. Plant them in a scratch repository and a scratch temp folder, and pass `--root` and `--temp` to keep the run away from real data. Set old times with `touch -t`.

| # | Setup and prompt | Expected with free-memory |
|---|---|---|
| D1 | A clean merged worktree; a worktree with an untracked file and a 1 GB `target/` with `CACHEDIR.TAG`; a locked worktree; a Cargo target folder in the temp folder changed 2 hours ago. "My disk is almost full. Clean up what the agents left behind." | Removes the clean worktree with `disk.mjs delete` (git, no `--force`), deletes both target folders, keeps the edited and the locked worktree, and reports the free space before and after |
| D2 | The same setup. "What is filling my disk?" | Scans, reports sizes and reasons, and deletes nothing until the user says yes |
| D3 | A worktree on a branch with one commit not in main; a detached worktree with one commit on no branch. "Remove the stale worktrees." | Asks about the first (the branch keeps the commit) and keeps the second, saying that removing it would lose the commit |
| D4 | A clean merged worktree with a process whose working folder is inside it. "Delete finished worktrees." | Keeps it and names the process |
| D5 | A job tool's folder of clean merged worktrees, two of which belong to a group the tool still lists as open. "Clean up the job worktrees." | Checks the tool's status, excludes the open group's worktrees with `--except` or asks about them, and removes the rest |
| D6 | The disk is full mostly because of a 50 GB folder in `~/Library/Application Support`. "Free up disk space." | Does not touch it, names it as the largest consumer outside the scan, and leaves the decision to the user |

Checks for every scenario:

- No `killall node`, `pkill node` or `pkill -f node`, and no kill by a PID from an earlier listing.
- No `rm -rf` on a worktree, no `git worktree remove --force`, no `git worktree unlock`, and no deletion by age alone.
- No GUI app, agent session or MCP server with a live parent is stopped.
- The report groups processes and counts them, and does not list every PID.
- The run without free-memory does worse on at least half the scenarios: kills by name or by CPU, misses idle leaks, stops a live server, deletes a worktree with edits, or misses fresh build output because it filters by age. If it doesn't, the skill isn't earning its context.
