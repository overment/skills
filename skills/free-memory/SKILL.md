---
name: free-memory
description: >-
  Finds and frees what agent work leaves behind: stale processes that waste CPU, memory or ports (leaked test fixtures, orphaned dev servers and watchers, duplicate servers, forgotten log tails, abandoned headless browsers), and disk space held by finished git worktrees, build output such as Cargo target folders and node_modules, temp-folder leftovers and tool caches. It sorts everything into stop or delete, ask and keep with evidence, and acts only on what is clearly stale. Use when the machine is slow, hot or loud, memory, swap or disk is nearly full, someone asks what eats CPU, RAM or disk space, asks to clean up stale or leftover processes, worktrees, build folders or temp files, or a port is taken by a server nobody remembers starting. Not for stopping one process the user named, a memory leak inside an app's code, Docker containers or images, or sorting personal files such as Downloads or photos.
license: MIT
metadata:
  author: overment
  version: "0.2.0"
---

# Free memory and disk

Agents, test runs and dev servers leave processes and files behind. Each one is small, but together they hold gigabytes of memory, ports, hours of CPU, and hundreds of gigabytes of disk. Stopping a process or deleting a folder is easy. The hard part is to tell a leftover from something that somebody still uses. Without this skill, agents kill by name (`pkill node`) and take down live sessions, kill by CPU and miss the idle leaks, delete worktrees with unsaved edits, or delete temp folders by age and miss the large fresh build output. So collect evidence, sort everything into stop or delete, ask and keep, act only on the clear items, and ask about the rest.

Both scripts need Node.js 18 or later and work on macOS and Linux. `scripts/procs.mjs` needs `ps` and `lsof` (or `ss` on Linux). `scripts/disk.mjs` needs `git` and `du`, and `lsof` on macOS.

## Which part

- Memory, CPU, ports, a slow or hot machine: follow the process steps below.
- Disk space, worktrees, build folders, temp files: read [references/disk.md](references/disk.md) and follow it.
- Both: do the processes first. A stopped server no longer holds its worktree, so the disk scan can then judge it.

## Permission

- A request to clean up, kill or free memory lets you stop the KILL groups after you review them.
- A request to free disk space or to clean up worktrees, build output or temp files lets you delete the DELETE items after you review them.
- A question such as "what eats my CPU?" or "what fills my disk?" lets you scan only. Report what you find, then ask before you stop or delete anything.
- ASK items always need a fresh yes, one at a time or as a list the user confirms.
- Deleting is permanent. There is no trash. Say what comes back (branches, build output) and what does not (temp files).

## Processes: steps

1. Scan. The scan only reads. It never stops anything.

   ```bash
   S=<skill-dir>/scripts/procs.mjs
   node $S scan                 # memory, top CPU and memory users, kill / ask / keep groups with reasons
   node $S scan --keep          # also list the keep groups
   node $S scan --all           # all your processes, not only dev tools
   node $S scan --json          # the raw facts for each group
   node $S scan --min-age 2h    # default 60m; younger groups are always kept
   ```

   A group is a root process and all its descendants, for example `pnpm dev` → `vite` → `esbuild`. If the parent of the root exited, the group is "orphaned". The root climbs through wrapper shells (`zsh -c`, `sh start.sh`) that have no terminal.

2. Review every KILL and ASK group. The script guesses from facts. You decide. Check each reason against the rules below. If you are not sure, look closer:

   ```bash
   ps -o pid,ppid,etime,time,tty,args -p <pid>         # time = total CPU used
   lsof -a -d cwd -p <pid>; lsof -nP -iTCP -sTCP:LISTEN -a -p <pid>
   curl -sI http://127.0.0.1:<port> | head -3           # what the port serves
   git -C <cwd> worktree list; git -C <cwd> log -1 --format=%cr
   ```

3. Stop the groups you are sure of:

   ```bash
   node $S kill <root pid> [<root pid> ...]             # the whole group
   node $S kill --suggested --except 123,456            # every KILL group, minus the ones you reject
   node $S kill <pid> ... --dry-run                      # show what would stop
   ```

   `kill` acts only on processes from the last scan, and only if the scan is less than 1 hour old. It checks each start time, so a reused PID is never hit. It refuses this agent session. It sends SIGTERM, waits up to 5 s, then sends SIGKILL to the processes that are still running. A PID that is not a group root stops with its own descendants only.

4. Ask the user about each ASK group that you could not resolve. Give the command, folder, port, age and size.

5. Scan again to confirm, then report.

## Processes: how to judge

### Stale: stop it

- Its folder is gone: a deleted worktree or a removed temp dir.
- It is a test leftover and its parent exited: `node -e "setInterval(...)"`, fixtures, stubs, smoke runners, stall runners.
- Its parent exited and it runs from a temp folder (`$TMPDIR`, `/tmp`, `/var/folders`): `bunx` or `npx` caches, scratch servers, IPC executors of dead agent sessions.
- It is a watcher (`tsx watch`, nodemon, `--watch`, `--hot`) with no server child and no port. The server crashed, and the watcher waits forever.
- Two copies of one command run in one folder. The copy without the port lost the race for it.
- It is a log tail (`wrangler tail`, `tail -f`, `logs -f`) whose parent exited. Nobody reads it.
- It is a test browser driven over `--remote-debugging-pipe` and its parent exited. Nothing can control it again, even if it still starts new renderers. Crash handlers always detach (PPID 1). They are stale only when their browser has exited.
- Large CPU time on an orphan makes it urgent. For example, the `esbuild --service` of a forgotten `wrangler pages dev` used 21 hours of CPU in 5 days.

### In use: keep it

- This agent session started it. Stop your own processes when you are done with them.
- It runs in an open terminal: it has a tty and its shell is alive.
- It runs inside tmux, screen or zellij. Somebody started it on purpose.
- Its parent is alive: an agent session (Claude Code, Codex, Cursor and similar), an editor or a test runner. MCP servers such as `npm exec chrome-devtools-mcp` belong to their agent session. Exception: if the parent is a long-running broker or daemon, not a session, judge the child on its own facts.
- A member of the group started in the last 10 minutes, so the group is in use.
- GUI apps and their helpers: Electron renderers, WebKit, Chrome, Slack, Obsidian. Do not kill them, even at several GB. Report them, and the user can quit or reload the app.
- System processes and processes of other users. Never use sudo.

### Not sure: ask

- An orphaned dev server on a port whose project folder still exists. The user may have it open in a browser. Say so if it listens on `*`, `0.0.0.0` or `[::]`: then it is open to the network.
- A detached daemon with no clear owner, such as a status script, a browser daemon or a job runner. Detached daemons are often on purpose.
- Code that moved: the script path is gone, but the folder still exists somewhere else (for example an archive). The process still runs the old code.
- An orphaned test browser with a debugging port. A tool can connect to it again.

## Do not

- Do not run `killall node`, `pkill node` or `pkill -f node`. They kill agent sessions, MCP servers and live dev servers.
- Do not kill a PID from an old list. PIDs get reused. Use the script, or check `ps -o lstart= -p <pid>` right before the kill.
- Do not run `kill -- -<pgid>` before you check the group. A process group can contain the agent's own shell.
- In ad-hoc shell on macOS, remember that `/bin/bash` is 3.2. It has no `declare -A`, no `mapfile` and no `${x,,}`.
- Do not delete a worktree with `rm -rf` or `git worktree remove --force`, and do not unlock a locked worktree. Both lose work that git protects. Delete through `disk.mjs`.
- Do not delete by age or by name pattern alone. Ownership and use decide, as [references/disk.md](references/disk.md) explains.

## Report

1. What you stopped or deleted: a short table with group or kind, count and reason. For processes, give the memory freed, the CPU hogs you stopped and the ports you released. For disk, give the free space before and after.
2. What you did not stop or delete and why: one line per ASK item, with command or path, port, age and size. End with a direct question.
3. Other facts: the largest consumers that are not stale (apps, app data, VM disks), swap use, and interactive agent sessions older than a day. Each such session can hold MCP servers and browsers, and the user can close it. For disk, also say what refills it (see [references/disk.md](references/disk.md)).

Do not list every PID or path. Group them and count them.
