# Disk

Agent work fills a disk in three ways. Each job gets a git worktree, and many worktrees stay after the job ends. Each build writes its own output: a Rust `target` folder is often 20–50 GB, and agents put one per job in a temp folder. Test runs, browsers and tools leave folders in `/tmp` and `$TMPDIR`.

Two shortcuts go wrong. Deleting by age ("temp folders older than 2 days") misses the largest items, because build output from today's jobs is just as safe to delete and much larger. Deleting by path (`rm -rf` on a worktree, `git worktree remove --force`) loses unsaved edits and commits that are on no branch. So decide by ownership and use: who made it, does a process still use it, and can git or a build make it again.

## Steps

1. Scan. The scan only reads. It never deletes anything.

   ```bash
   D=<skill-dir>/scripts/disk.mjs
   node $D scan                  # free space, then delete / ask / keep items with reasons and sizes
   node $D scan --keep           # also list and measure the keep items
   node $D scan --json           # the raw facts for each item
   node $D scan --root ~/code    # look for repositories only below this folder (default: home, 4 levels)
   node $D scan --min-age 2h     # default 60m; worktrees and build output changed more recently are kept
   node $D scan --temp-age 1d    # default 2d; for other temp leftovers
   node $D scan --idle-age 30d   # default 14d; for build output in main checkouts
   ```

   The scan finds every repository below the root and in the temp folders, then lists all worktrees of each repository with `git worktree list`, wherever they are. It takes a few minutes on a full disk, because it measures sizes with `du`.

   Kinds: `worktree` (a linked git worktree), `prune` (a worktree record whose folder is gone or is no longer a checkout of the repository), `build` (output a build or install makes again: a folder with `CACHEDIR.TAG` such as a Cargo `target`, `node_modules` next to a lockfile, `.next`, `.svelte-kit`, `.turbo`), `temp` (a leftover at the top of a temp folder), `clone` (a repository in a temp folder), `orphan` (a folder that claims to be a worktree, but git no longer knows it), `cache` (a tool cache in the home folder, 512 MB or more).

2. Review every DELETE and ASK item. The script guesses from facts. You decide.

   - Ask the job tool first. A tool made the worktrees when they sit in one folder next to the repository (often hidden, with a name that ends in `worktrees`) and the repository keeps job records. List the tool's open jobs and groups with its own status command. Keep the worktrees of open jobs and open groups: pass their ids to `--except`. If the tool has its own cleanup command, read what it does before you run it. Some remove worktrees with `--force`.
   - Keep build output that a running job will use again, for example a target folder whose name matches the ticket or branch of a running job. Deleting it loses nothing, but the job then rebuilds from zero.
   - If you are not sure, look closer:

   ```bash
   git -C <worktree> status --short; git -C <worktree> log --oneline -3
   git -C <repo> worktree list --porcelain             # lock notes, prunable records
   lsof +D <folder> 2>/dev/null | head                 # slow on big folders
   ```

3. Delete the items you are sure of:

   ```bash
   node $D delete --suggested --dry-run                # what would go, and the size
   node $D delete --suggested --except 12,40           # every DELETE item, minus the ones you reject
   node $D delete <id> [<id> ...]                      # named items, also ASK items after a yes
   ```

   `delete` acts only on items from the last scan, and only if the scan is less than 1 hour old. Just before each deletion, it checks the item again. It skips an item that a process now uses, that changed after the scan, that a different folder replaced, or that got new commits or edits. System indexers such as Spotlight do not count as use. It never deletes a KEEP item, a main checkout, a scan root or the home folder. It removes worktrees with `git worktree remove` without `--force`, so git itself refuses a locked worktree or one with edits, and the branch stays. Then it runs `git worktree prune`. It deletes other items with `rm -r`.

4. Ask the user about each ASK item that you could not resolve. Give the path, size, age and reason. Group look-alike items.

5. Scan again to confirm, then report. Give the free space before and after.

## How to judge

### Safe to delete

- A worktree that is finished. No process uses it, it is not locked, and it has no unsaved changes. All its commits are in the main checkout's branch or in the default branch. A rebase or a cherry-pick counts as merged. Its branch stays after the removal.
- A worktree record that git marks prunable, when it is not locked. `git worktree prune` drops only the record.
- Build output that no process uses, in a temp folder or in a worktree that nobody works in. Its age does not matter: a Cargo target from two hours ago is as safe to delete as one from two weeks ago. In a worktree that you keep, deleting its build output keeps every edit and frees most of the space.
- Other temp leftovers that no process uses and that nobody changed for 2 days.
- A clone in a temp folder whose commits are all on a remote and that has no unsaved changes.

### In use or protected: keep it

- A process uses it: its working folder, an open file, a path in its arguments, or its `CARGO_TARGET_DIR` is inside. That includes this agent session. Build output inside a worktree that a process uses is in use too.
- It is in an app's data folder (`~/Library`, `~/.local/share`, `~/.config`). The app manages its own worktrees there.
- It is locked. A lock note records the owner's decision, for example "unlock needs owner approval". Never unlock without the owner's yes. Build output inside a locked worktree is an ASK item.
- It has unsaved changes. Its build output can still go.
- It has a detached HEAD with commits that are on no branch. Removing it would lose those commits.
- It changed in the last hour.
- A main checkout, and its build output when somebody used the checkout in the last 14 days. The user works there.
- A temp folder that holds a repository or worktree. Those are judged on their own. Scan again after they go.
- Everything outside the scan: app data (`~/Library/Application Support`, `~/Library/Containers`), VM disks, Docker data, the Trash, and personal folders such as Desktop, Documents and Downloads. Report the large ones. The user decides.

### Not sure: ask

- A worktree with commits that are not merged. The branch keeps them, but somebody may still want the checkout.
- A stale lock: the process named in the lock note is gone, or git's own `initializing` lock is more than a day old. The owner unlocks with `git worktree unlock <path>`. Then scan again.
- An orphan: a folder that says it is a worktree, but git no longer knows it. Git cannot check it for unsaved edits.
- Build output of a main checkout that nobody used for 14 days. The next build or install makes it again, but takes time.
- `node_modules` with no lockfile. A new install can resolve other versions.
- A tool cache. The tool fills it again, but the next install or test run is slower. Prefer the tool's own command: `pnpm store prune`, `npm cache clean --force`, `brew cleanup`.
- A cache subfolder named after a worktree or job that no longer exists, for example a check script's per-worktree cache. It is stale, but the scan cannot tell this by itself.

## Make it stay fixed

A disk that fills again in a day has a cause that cleanup alone does not fix. The largest DELETE kinds show it:

- Many `build` items in temp folders: each job builds into its own output folder. Suggest a shared folder or a small pool that jobs reuse, or deleting the folder when the job ends.
- Many worktrees outside the job tool's own folder: agents made extra checkouts by hand, and the tool's cleanup never sees them.
- Many worktrees of finished jobs in an open group: the group was never closed. Closing it lets the tool clean up.

Report the cause and a fix to the user. Do not change the job tool or the build scripts yourself.

## Do not

- Do not use `rm -rf` on a worktree, `git worktree remove --force` or `git worktree unlock`.
- Do not delete branches. They cost almost no space, and they hold the work.
- Do not delete inside a main checkout without a yes.
- Do not run `docker system prune`, empty the Trash, or clear app caches inside `~/Library`. Report them, and the user decides.
- Do not delete an item from an old list. Use the script, which checks each item again.
