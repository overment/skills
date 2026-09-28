---
title: How a story gets published
chrome: title
width: wide
---

Every story passes one human gate, the [Review queue](#review), and one machine gate, the [Publisher](#publish). Nothing reaches readers without both. Pages are then served from the CDN, so a fix can take a few minutes to show up.

## 01 · The path of a story

An author writes in the [Writing app](#draft) and submits the draft. An editor approves it or [sends it back](#review->draft). Approval hands the story to the [Publisher](#publish), which saves a version, pushes the pages out and refreshes search in the background.

```figure
id: pipeline
layout: flow
grid: [5, 3]
nodes:
  author:  { label: Author, at: [0, 1], kind: actor, about: "Writes and revises stories. Can submit a draft but never publish it." }
  draft:   { label: Writing app, at: [1, 1], about: "Where drafts live until they are submitted. Saves every change so nothing is lost." }
  review:  { label: Review queue, at: [2, 1], about: "Holds submitted drafts until an editor approves them or asks for changes." }
  publish: { label: Publisher, at: [3, 1], focal: true, about: "Turns an approved draft into live pages. The only part allowed to write to the CDN." }
  content: { label: Content store, at: [3, 2], kind: store, about: "Keeps every published version so any page can be rolled back. Nothing is overwritten, so a bad publish costs one click to undo rather than a restore from backup." }
  cdn:     { label: CDN, at: [4, 1], kind: external, about: "Serves pages to readers from servers near them. Caches each page for up to five minutes." }
  search:  { label: Search index, at: [4, 0], kind: store, about: "Lets readers find stories by title and text. Updated in the background after each publish." }
edges:
  - author -> draft: writes
  - draft -> review: submits
  - review --> draft: sends back
  - review -> publish: approves
  - publish -> content: saves version
  - publish => cdn: pushes pages
  - publish ~> search: reindexes
groups:
  editorial: { label: Editorial, from: [1, 1], to: [2, 1], kind: zone }
notes:
  - { on: publish, text: "The only part allowed to write to the CDN, so every live page passed through it." }
  - { on: review->draft, text: "The one way back: an editor returns the draft instead of editing it." }
```

## 02 · Who can change what

Each stage allows fewer edits than the one before it. The [Writing app](#draft) can still [change the headline](#change-headline.draft), the [Review queue](#review) can only [partly edit the text](#edit-text.review), and the [Publisher](#publish) can only [schedule](#schedule.publish) or [take a page down](#take-down.publish). Select a column to find that stage in the diagram, or a cell for the rule in words.

```matrix
id: permissions
title: What each stage allows
corner: Action
columns: [draft, review, publish]
rows:
  - { id: edit-text, label: Edit the text, about: Editors suggest edits and the author accepts them., cells: { draft: yes, review: partial, publish: no } }
  - { id: change-headline, label: Change the headline, cells: { draft: yes, review: yes, publish: no } }
  - { id: schedule, label: Schedule a time, cells: { draft: no, review: yes, publish: yes } }
  - { id: take-down, label: Take a page down, cells: { draft: no, review: no, publish: yes } }
```

```note warn
A page that is taken down stays visible on the CDN for up to **five minutes**. For legal removals, purge the page by hand as well.
```

## 03 · Terms

```glossary
CDN: A network of servers that keeps copies of pages close to readers so they load fast.
version: One saved state of a story; every publish creates a new one.
```
