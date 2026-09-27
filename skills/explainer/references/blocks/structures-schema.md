# Structures: schema, uml

Both place boxes on the figure grid (`at: [col, row]`, cells 160×64, gaps 104/48). A box is as tall as its rows; its grid span reserves whole rows below it, so leave those empty. The canvas ends at the lowest box and grows on any side a connector needs. Ids are `<block id>-<slug>`: tables and classes `shop-orders`, columns and members `shop-orders-user-id`, relations `shop-orders->shop-users`.

Both take `notes` (up to 4 `{on: id, text}`), `caveat` and `story` for the expanded view; `on` and story steps may point at any table, column, class, member, relation or generalization set of the block.

## schema

Use when the reader needs to see how tables reference each other: which column points at which key (`physical`) or how many rows link to how many (`er`).

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id, prefixes every element id |
| `title` | string | none | caption, hidden in bare view |
| `mode` | `physical` \| `er` | `physical` | physical: types, one connector per `fk` from its row to the row it references. er: no types, table-to-table connectors |
| `tables` | map name → table | required | table name → `{ at, span?, columns, about?, focal?, muted? }` |
| `tables.*.at` | [col, row] | required | top-left cell |
| `tables.*.span` | int 1–4 | auto (≤3) | width in cells |
| `tables.*.columns` | list | required | `"name type [pk] [fk table.col [action]] [null] [unique]"`, or `{ "name type …": about }`, or `{ name, type, pk, fk, null, unique, about }` |
| `relations` | list | from fks | er only: `"users 1--* orders : places"` or `{ rel, about }`. Ends: `1`, `0..1`, `*`, `1..*`, `0..*` |

`action` is the on-delete rule: `cascade`, `restrict`, `set-null`, `set-default` or `no-action` (`fk orders.id cascade`). It is the only text drawn on a physical connector.

```schema
id: shop
tables:
  users:  { at: [0, 0], about: "Everyone who can sign in.", columns: ["id uuid pk", "email text unique"] }
  orders: { at: [2, 0], about: "One checkout.", columns: ["id uuid pk", "user_id uuid fk users.id", "total numeric"] }
notes:
  - { on: shop-orders-user-id, text: "An order can't exist without its buyer." }
```

Connectors end in crow's-foot notation: at the referencing row a foot (many) or, for a `unique` column, a ring and bar (at most one); at the referenced row a double bar (exactly one) or, for a `null` column, a ring and bar. Tables side by side get a Z through the gutter next to the referenced table; tables in one column get a bracket on the side where it crosses nothing. Two keys into one row sit just above and below its centre; three or more that turn in the same gutter share a bus with junction dots.

Selecting a primary key lights every column that references it, their tables and connectors; a foreign key lights the row it references; a table lights both rows of every relation it takes part in; a connector lights its two rows. The card lists them as References and Referenced by.

Budget: 6 tables, 8 columns per table, 8 relations, 1–2 focal tables.
- Don't list every column. Show the keys and the columns the story is about.
- Don't draw lookup or audit tables that every table references; mention them in prose.
- Don't use `relations` in physical mode. It's an error there; the `fk` columns draw the connectors.
- Link the prose to the exact columns: `[unit_price](#shop-order-items-unit-price) copies [products.price](#shop-products-price)`.

## uml

Use when the story is about types: who inherits, implements, owns or merely uses whom.

| key | type | default | meaning |
|---|---|---|---|
| `id` | string | required | block id |
| `title` | string | none | caption, hidden in bare view |
| `classes` | map name → class | required | `{ at, span?, attributes?, operations?, stereotype?, about?, focal?, muted? }` |
| `classes.*.attributes` | string list | [] | e.g. `"+id: UUID"`, `"-total: Money"` (quote them: YAML treats `#` and `: ` specially) |
| `classes.*.operations` | string list | [] | e.g. `"+pay(): Receipt"` |
| `classes.*.stereotype` | `interface` \| `abstract` | none | interface: «interface» line. abstract: italic name |
| `relations` | list | [] | `'A <op> B'`, `'A "1" <op> "many" B : label'`, or `{ rel, about }` |

Ops: `<|--` / `--|>` inheritance, `<|..` / `..|>` realization (dashed), `*--` / `--*` composition, `o--` / `--o` aggregation, `-->` / `<--` association, `..>` / `<..` dependency (dashed), `--` / `..` without an end. The symbol is drawn at the side it is written on.

```uml
id: pay
classes:
  Payment:     { at: [0, 0], stereotype: abstract, operations: ["+capture()"], about: "Every attempt to take money." }
  CardPayment: { at: [0, 2], attributes: ["-last4: String"], about: "A charge through the card provider." }
relations:
  - Payment <|-- CardPayment
```

A class shows only the compartments it fills; an empty attribute compartment stays when operations follow it. Each member is a row you can select and link to (`pay-cardpayment-last4`). Lines leave and enter vertically when the classes sit in different rows, so a subclass meets its parent from below. Two or more subclasses (or implementations) of one parent in one row share a single triangle under the parent, selectable as `<parent>-subclasses` (`<parent>-implementations`).

Selecting a class lights its members, the members it inherits, and its direct relations; the rest of its hierarchy stays at rest. The card names each relation in words: Extends, Extended by, Implements, Owns, Part of, Has, Held by, Refers to, Uses.

Budget: 7 classes, 8 relations, 5 members per compartment, 1–2 focal classes.
- Don't copy the whole class. List the members the story mentions.
- Don't add `..>` dependencies for every import. Keep the ones the reader must know.
- Don't label an inheritance or composition line; its end symbol already says it.
- Put subclasses at least one empty row below their parent, in one row, so they share its triangle.
