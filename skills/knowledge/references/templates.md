# Templates

Open this when a kind of note recurs and you're deciding what it must hold.

Here a template is a contract, not a form. A form gets filled in mechanically: every heading appears, and the empty ones say "N/A". A contract fixes only what other things depend on and leaves the rest to the note's content.

## Types emerge

Group notes by what a reader wants from them, not by topic; topics are links or tags. A kind of note becomes a type once it recurs and something depends on its fields: a query, a check, an index. Until then, untyped notes are fine. Most bases need two to six types.

## The contract

One file per type, named after it (`types/decision.md`); a note joins it with `type: decision`. `check.ts` enforces the contract's `required` fields and `values` lists on those notes. It reads due dates only from `review`, `review_by`, `expires` and `valid_until`, so use those names.

```markdown
---
defines: decision
required: [date, status]
values:
  status: [proposed, accepted, amended, superseded]
---
# decision

Exists so that: a later reader knows what was chosen, why, and what would reopen it.
Reader arrives asking: "why is it like this, and can I change it?"
Fixed: date, status, and a link to what it affects.
Default: the decision in one sentence, then the reason. Options only if one was really weighed, because readers come for the verdict.
Lifecycle: proposed, then accepted. A later decision that changes part of it makes it amended; one that replaces it makes it superseded. Either way, link to the newer one.
Drifting when: notes re-argue the debate, or status never changes.
Examples: [[2026-03-02-async-standups]] (short), [[2026-05-19-switch-accounting-firm]] (long)
```

Every contract needs the first three lines. Add the others only where the type has something to say:

- **Reader arrives asking** replaces a list of headings: each note opens with the answer to that question.
- **Fixed** holds only what queries, links and checks rely on. Keep it short, because each fixed field is one more thing a writer fills in whether or not it applies.
- **Default** says what to do unless the content calls for something else. Its reason lets a writer tell when it doesn't apply.
- **Lifecycle** names the states a note moves through, such as a partial change or a return.
- **Drifting when** names what upkeep should look for.
- **Examples** are two real notes that differ in size or shape. One example gets copied; two show the range. Leave the line out until real notes exist.

Keep placeholder skeletons (`{{title}}`, empty headings) out of the base, because agents copy them literally. In Notion, a graph database or SQLite, the fixed fields become required properties or columns, and the rest of the contract lives on a page agents read.

## Warning signs

- Empty or "N/A" sections, or every note of a type the same length.
- Types that differ only by topic.
- A required field that usually says "unknown".

Next: [content](content.md).
