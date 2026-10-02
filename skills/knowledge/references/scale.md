# Scale

Open this when the base will grow past a few thousand notes, or when searching, filing or checking it has slowed. At fifty notes an agent can read everything; at five hundred thousand it can read almost nothing. So every answer has to stay a few files away (rule 10).

## What breaks as it grows

| Notes | What starts to break |
|---|---|
| about 10,000 | folder listings, single hub pages, free-form tags, one entity filed under two names |
| about 100,000 | hand-kept indexes, search-before-create by text alone, a full check after every edit |
| 500,000 and more | anything that reads "all notes about X", any page that every writer edits |

## Decide early

Categories are still earned (rule 6). These mechanics are costly to change at volume, so decide them up front:

- **Identity:** IDs that never change and are unique across the base, so a rename never touches thousands of links. When a feed supplies a key, such as a message ID, an account or a DOI, derive a file-safe ID from it, so the same item always lands on the same note (idempotent intake).
- **Sharding:** split folders by date or ID prefix so none holds more than about a thousand notes. Size the split for the busiest period, not the average.
- **Registry:** one row per recurring entity (a person, a paper, a product, an error), with its aliases and the attributes that tell lookalikes apart. Generate it from the entity notes so it can't drift.
- **Vocabulary:** when feeds assign topics, seed a small closed list before they start, because synonyms arrive faster than the third-occurrence rule can catch them. If each term is a note and notes link to it from frontmatter, `check.ts` reports an unknown term as a broken link.

## Keep reads bounded

- **Layered entry points:** the base's skill routes to area indexes, those route to entity pages or rollups, and those route to notes.
- **Generated indexes:** a script builds them from frontmatter, per entity, period or type. They also give every event note an inbound link, so nothing depends on search alone.
- **One query command:** once a search takes more than one line of shell, wrap it in a script with filters (type, entity, date), kept beside `check.ts` in the base's skill, and name the command there.
- **Derived indexes:** full text, embeddings or a graph, for when filtered search still returns too much. A script rebuilds them from the files; nobody edits them, and they're never the source of truth.
- **Rollups:** summaries of event notes per entity, period or theme. Each records the filing time of the newest note it covers, taken from a `filed` field or the commit. A generated queue lists the rollups that have notes filed after that mark. Compare filing times, not the dates the notes are about.
- **Narrow, then ask:** when a name matches many entities, narrow by what you know. If several remain, ask; in unattended intake, send the item to a review queue. Never file into the first match.

## Writing at volume

- **Append, then consolidate:** one note per event; shared pages are regenerated, not edited by every writer.
- **Scripts for mechanics, agents for meaning:** IDs, dates, lookups and placement go to a script. What an item means stays with the agent.
- **Provenance and standing rules:** every note keeps its source and batch, so a bad batch can be reverted. Routine bulk changes, such as merging exact duplicates, run under a rule the owner agreed to and that the base's skill states.

Check each intake with `check.ts --files`, and run the full check and a judgment sample on a schedule.

## Load test

Reasoning misses what breaks at volume, so test it:

1. Write a generator, kept outside the base, that fills a copy with synthetic notes following the conventions exactly, generated pages included. Make it realistic first: names that collide at a natural rate, steady growth, recurring problems. Otherwise its artifacts look like design flaws.
2. Grow the copy to the expected size and run `check.ts` on it.
3. Have a fresh agent answer the survey's questions on the copy, plus a few about synthetic entities. If an answer needs more than a handful of files, or a search returns more than a screen of hits, the structure needs work. Without a fresh agent, answer them yourself using only the commands in the base's skill, and say so.
4. Fix the structure, not the test, then delete the copy.
