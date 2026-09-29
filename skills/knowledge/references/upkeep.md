# Upkeep

Open this when a base exists and needs checking, cleaning or reshaping, or when you're deciding how it stays healthy.

## Checks

For a Markdown base, copy `scripts/check.ts` into it, for example as `tools/check.ts`. It's one file with no dependencies (it needs Bun 1.4 or later), so the base can check itself without this skill. Name the commands in the context file:

```sh
bun tools/check.ts .                    # the whole base
bun tools/check.ts . --files <path>...  # only the notes an intake touched
```

Errors fail the run. Signals are for you to judge; a long note may be long for a reason. `--help` lists both.

Run the full check where nobody has to remember it: a pre-commit hook or CI job for a base under git, or a scheduled job otherwise. Without any of these, the context file tells agents to run it at the start of each session. Name the trigger in the context file. When the skill's `check.ts` changes, replace the copy. In Notion, a wiki or a database, let the medium enforce the contracts (required properties, `NOT NULL` columns, allowed values), and keep saved queries for orphans and overdue notes.

No script does the judgment checks (ROT audit). Read a sample of recent notes against the content bar, look for contradictions and silent duplicates, and rerun the filing and finding tests on recent inflow.

## When types change

Promote a heading or field that most notes of a type already have. Drop a fixed field that's usually empty. Split a type whose notes answer two different questions, and merge two types that answer the same one.

## When structure changes

The signs: filing is ambiguous somewhere, the same question keeps missing, an index outgrows a screen, a misc folder grows. Reshape as [structure](structure.md) describes, update the context file in the same edit, and record why in the structure log.
