# Structure

Open this when choosing where the base lives and how notes are arranged, named and linked. The survey's questions and the rules in [SKILL.md](../SKILL.md) derive the layout; nothing here is a layout to copy.

## Medium

Match it to what the questions mostly are:

| Questions are mostly | Fits |
|---|---|
| looking things up and reading | Markdown files under git |
| the same, plus filtering by fields | Markdown with properties (Obsidian or similar) |
| filters and totals over uniform records | a table: SQLite, a Notion database |
| multi-hop across relations | a graph database such as neo4j |
| shared editing with permissions | Notion, Confluence or a wiki, which agents reach through an API or MCP |

Mixing is normal, such as files with a graph index built over them. When unsure, choose Markdown under git: every agent can read it, and it moves anywhere. A tool the person doesn't know isn't a reason to avoid it, only a reason to confirm before committing to it.

## Layout

1. For each survey question, sketch the path from the entry point to the answer. Which mechanism shortens it: a folder, a link, a property, a tag or an index?
2. Use the fewest mechanisms that cover every path, each carrying one kind of meaning (rule 5).
3. Start flat: a few folders, an entry index and links. Add depth under pressure (rule 6).
4. Name for recognition. Ideas get titles that state their point, entities get their names, and dated things start with the date. Where links use bare names, file names must be unique across the base.
5. Pick one link style. Use wikilinks where the tools support them; `check.ts` also reads them in frontmatter. Use relative Markdown links otherwise.
6. Run the filing and finding tests. When one fails, change the structure, not the test.

## Reshaping

Map old locations to new ones, and keep links working by rewriting them or leaving a pointer. The plan-and-yes rule in [SKILL.md](../SKILL.md) applies.

## Warning signs

- A misc folder that keeps growing.
- Tags that repeat the folders.
- A structure sized for a volume the base won't reach, or for far less than it will.

Next: [templates](templates.md).
