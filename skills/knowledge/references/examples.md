# Examples

Four bases whose surveys led to different shapes. None is a starting point to copy: yours comes from your own survey.

## A personal second brain in Obsidian · a few thousand notes

- **Questions:** Where does project X stand? What did I decide about Y? What was I working on last month?
- **Methods:** PARA, because projects end and areas don't; daily notes; progressive summarization.
- **Shape:** `projects/`, `areas/`, `resources/` and `archive/`; a finished project moves to `archive/` whole. A daily log sits in `daily/2026/`, and each project links the days it came up.
- **Types:** only `project` (status, `review_by`). Everything else stays untyped.

## A team handbook in Notion · a few thousand pages

- **Questions:** How do I do X here? What's our policy on Y? Who owns Z? Why did we decide W?
- **Methods:** Diátaxis, handbook-first, owners with review dates, ADRs.
- **Shape:** one database, whose properties do the work of folders. `type` says what a reader wants: `how-to`, `reference`, `policy` or `decision`. `area` carries ownership. The start page is the context page, and each agent's instructions point to it.
- **Types:** the contracts are required properties (`owner` and `review_by` on every type but `decision`, which has `date` and `status`), plus a "How we write" page.

## An assistant's memory of one person · thousands of notes, written only by the agent

- **Questions:** What do they prefer? What did I promise, and to whom? Who is this contact to them?
- **Methods:** episodic and semantic memory, consolidation, facts with the dates they became true.
- **Shape:**
  - `people/` and `preferences/` hold current facts with dates and sources.
  - `commitments/` has one note per promise, linked to its person and closed when kept.
  - `episodes/` holds dated events. A weekly consolidation turns what the episodes teach into facts, then archives them.
- **Left out:** topic indexes. A generated list of open commitments is the one index.

## A lab's literature archive · 300,000 papers from automated alerts

- **Questions:** What's known about X? Which papers contradict Y? What changed in the field this quarter?
- **Methods:** entity resolution, atomic claims linked to their sources, reviews written as rollups, a derived full-text and embedding index.
- **Shape:**
  - `papers/<hash-prefix>/<doi-slug>.md`, so a repeated alert updates the note instead of duplicating it;
  - an author registry keyed by ORCID, with name variants;
  - `claims/<hash-prefix>/`, each claim linked to its paper;
  - `reviews/<topic>/<quarter>.md`, rollups that agents write from the claims.
- **Types:** `paper` (DOI, year, venue), `claim` (source, stance), `author` (ORCID, aliases).
- **Left out:** hand-kept reading lists; tags, because topics come from the reviews; any procedure that reads every paper on a topic.
