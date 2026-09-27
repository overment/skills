import { describe, expect, test } from "bun:test";
import { loadTheme } from "../engine/theme.ts";
import { parseDoc } from "../engine/parse.ts";
import { blockModule as schema } from "../engine/structures/schema.ts";
import { blockModule as uml } from "../engine/structures/uml.ts";
import { crossCount, type Pt } from "../engine/structures/grid.ts";
import { textWidth } from "../engine/kit.ts";
import { SpecError, type BlockModule, type Diagnostic, type RawBlock, type RenderContext } from "../engine/types.ts";

const theme = await loadTheme();
const pad = theme.grid.pad;
const ctx = (warns: Diagnostic[] = []): RenderContext => ({
  theme, doc: { front: {}, segments: [] }, inline: (s: string) => s, warn: (d) => void warns.push(d),
});
const raw = (type: string, data: unknown): RawBlock => ({ type, info: [], body: "", data, line: 7 });
const unesc = (s: string) => s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, "&");

function build<T extends { type: string; line: number }>(mod: BlockModule<T>, data: unknown, warns: Diagnostic[] = []) {
  const c = ctx(warns);
  const block = mod.normalize(raw(mod.type, data), c);
  return { block, html: mod.render(block, c), model: mod.model?.(block) ?? {} };
}

/** The first block of `type` in a template, as the renderer sees it. */
async function template(file: string, type: string): Promise<RawBlock> {
  const doc = parseDoc(await Bun.file(new URL(`../../templates/${file}`, import.meta.url)).text(), file);
  for (const s of doc.segments) if (s.kind === "block" && s.block.type === type) return s.block;
  throw new Error(`no ${type} block in ${file}`);
}

function specError(fn: () => unknown): SpecError {
  try { fn(); } catch (e) { if (e instanceof SpecError) return e; throw e; }
  throw new Error("expected a SpecError");
}

/** Connector paths by edge id, as polylines: the start, every corner (a Q control point) and the end. */
function routes(html: string): Map<string, Pt[]> {
  const out = new Map<string, Pt[]>();
  for (const m of html.matchAll(/<g class="x-edge[^"]*" data-id="([^"]+)"[^>]*><path class="x-edge-line" d="([^"]+)"/g)) {
    const d = m[2] as string;
    const nums = (s: string) => s.split(/[ ,]/).map(Number);
    const start = nums((/^M([\d.,-]+)/.exec(d) as RegExpExecArray)[1] as string) as Pt;
    const corners = [...d.matchAll(/Q([\d.-]+),([\d.-]+)/g)].map((q) => [Number(q[1]), Number(q[2])] as Pt);
    const ends = [...d.matchAll(/[LQ]([\d.-]+),([\d.-]+)(?: ([\d.-]+),([\d.-]+))?/g)];
    const last = ends[ends.length - 1] as RegExpMatchArray;
    const end: Pt = last[3] !== undefined ? [Number(last[3]), Number(last[4])] : [Number(last[1]), Number(last[2])];
    out.set(unesc(m[1] as string), [start, ...corners, end]);
  }
  return out;
}

/** Drawn box rects by mark id. */
function boxes(html: string): Map<string, { x: number; y: number; w: number; h: number }> {
  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const m of html.matchAll(/class="x-mark x-struct-box" data-id="([^"]+)"[^>]*><rect class="x-mark-shape" x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)) {
    out.set(unesc(m[1] as string), { x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]) });
  }
  return out;
}

function viewBox(html: string): { w: number; h: number } {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(html) as RegExpExecArray;
  return { w: Number(m[1]), h: Number(m[2]) };
}

function checkMarkup(html: string, elements: Record<string, { type: string }>, prefix: string) {
  const ids = [...html.matchAll(/data-id="([^"]+)"/g)].map((m) => unesc(m[1] as string));
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    expect(id.startsWith(`${prefix}-`)).toBe(true);
    expect(elements[id]).toBeDefined();
  }
  const marks = [...html.matchAll(/<g class="x-mark[^"]*" data-id="[^"]+"[^>]*>(<rect class="x-mark-shape)?/g)];
  expect(marks.length).toBeGreaterThan(0);
  for (const m of marks) expect(m[1]).toBeDefined();
  for (const m of html.matchAll(/data-from="([^"]+)" data-to="([^"]+)"/g)) {
    expect(elements[unesc(m[1] as string)]?.type).toBe("node");
    expect(elements[unesc(m[2] as string)]?.type).toBe("node");
  }
  expect(html).not.toMatch(/style=/);
  expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}(?![\w-])/);
  expect(html).not.toMatch(/rgba?\(|hsla?\(/);
}

/** Every route and box sits inside the canvas. */
function contained(html: string) {
  const { w, h } = viewBox(html);
  for (const pts of routes(html).values()) for (const [x, y] of pts) expect(x >= 0 && x <= w && y >= 0 && y <= h).toBe(true);
  for (const r of boxes(html).values()) expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h).toBe(true);
}

const shop = () => ({
  id: "shop",
  tables: {
    users: { at: [0, 0], about: "People who can sign in.", columns: ["id uuid pk", "email text unique"] },
    orders: { at: [2, 0], focal: true, columns: ["id uuid pk", { name: "user_id", type: "uuid", fk: "users.id", about: "Who placed it." }, "total numeric"] },
    items: { at: [2, 2], columns: [{ "order_id uuid pk fk orders.id cascade": "The order this line belongs to." }, "qty int"] },
  },
});

describe("schema", () => {
  test("normalizes shorthand, objects, fk columns and their actions", () => {
    const { block } = build(schema, shop());
    expect(block.mode).toBe("physical");
    expect(block.tables.map((t) => t.id)).toEqual(["shop-users", "shop-orders", "shop-items"]);
    const orders = block.tables[1]!;
    expect(orders.columns[1]!.fk).toEqual({ table: "users", column: "id" });
    expect(orders.columns[1]!.id).toBe("shop-orders-user-id");
    expect(orders.span[1]).toBe(2);
    const item = block.tables[2]!.columns[0]!;
    expect(item.pk && item.fk?.table === "orders" && item.fk.action === "cascade" && item.about === "The order this line belongs to.").toBe(true);
    // A connector now starts at its fk row, so only a referential action earns a label.
    expect(block.relations.map((r) => r.label)).toEqual([undefined, "cascade"]);
    expect(block.relations.map((r) => [r.column, r.target])).toEqual([["shop-orders-user-id", "shop-users-id"], ["shop-items-order-id", "shop-orders-id"]]);
    expect(block.relations.map((r) => r.ends)).toEqual([["many", "one"], ["many", "one"]]);
    const { block: nullable } = build(schema, { id: "n", tables: { a: { at: [0, 0], columns: ["id int pk"] }, b: { at: [2, 0], columns: ["a_id int fk a.id null unique"] } } });
    expect(nullable.relations[0]!.ends).toEqual(["zero-one", "zero-one"]);
  });

  test("renders marks, crow's-foot connectors and a model entry for each", () => {
    const { html, model } = build(schema, shop());
    checkMarkup(html, model.elements ?? {}, "shop");
    expect(html).toContain('marker-start="url(#shop-er-many)" marker-end="url(#shop-er-one)"');
    expect(html).not.toContain("url(#shop-arrow)");
    expect(html).toContain(">numeric</text>");
    expect(html).toMatch(/class="x-struct-label"[^>]*>cascade<\/text>/);
    expect(html).not.toMatch(/x-struct-label[^>]*>user_id</);
  });

  test("template: every connector runs from its fk row centre to the referenced row centre", async () => {
    const c = ctx();
    const block = schema.normalize(await template("schema.md", "schema"), c);
    const html = schema.render(block, c);
    const paths = routes(html), rects = boxes(html);
    const rowY = (table: string, column: string) => {
      const t = block.tables.find((x) => x.name === table)!;
      return rects.get(t.id)!.y + 49 + 24 * t.columns.findIndex((x) => x.name === column);
    };
    for (const r of block.relations) {
      const pts = paths.get(r.id)!;
      const [ft, fc] = r.title.split(" → ")[0]!.split(".") as [string, string];
      const [tt, tc] = r.title.split(" → ")[1]!.split(".") as [string, string];
      expect(pts[0]![1]).toBe(rowY(ft, fc));
      expect(pts[pts.length - 1]![1]).toBe(rowY(tt, tc));
      // Ends sit on the left or right side of their table, never on top or bottom.
      const a = rects.get(r.from)!, b = rects.get(r.to)!;
      expect([a.x, a.x + a.w]).toContain(pts[0]![0]);
      expect([b.x, b.x + b.w]).toContain(pts[pts.length - 1]![0]);
    }
    const user = paths.get("shop-db-orders->shop-db-users")!;
    expect([user[0]![1], user[user.length - 1]![1]]).toEqual([105, 81]);
    // Same column: a bracket on the right, where it crosses nothing.
    const order = paths.get("shop-db-order-items->shop-db-orders")!;
    const items = rects.get("shop-db-order-items")!;
    expect(Math.min(...order.map((p) => p[0]))).toBe(items.x + items.w);
    expect(order[1]![0]).toBeGreaterThanOrEqual(items.x + items.w + 30);
    const all = [...paths.values()];
    let crossings = 0;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) crossings += crossCount(all[i]!, all[j]!);
    expect(crossings).toBe(0);
    expect(html).not.toMatch(/ A4,4 /);
    contained(html);
  });

  test("template: selecting a key lights both sides of its relation", async () => {
    const c = ctx();
    const block = schema.normalize(await template("schema.md", "schema"), c);
    const els = schema.model!(block).elements!;
    const pk = els["shop-db-products-id"]!;
    expect(pk.related).toEqual(expect.arrayContaining(["shop-db-products", "shop-db-order-items-product-id", "shop-db-order-items", "shop-db-order-items->shop-db-products"]));
    expect(pk.links).toEqual([{ rel: "Referenced by", ids: ["shop-db-order-items-product-id"] }]);
    expect(pk.pos).toBe("PK");
    expect(els["shop-db-users-id"]!.related).toContain("shop-db-orders-user-id");
    expect(els["shop-db-orders-id"]!.related).toEqual(expect.arrayContaining(["shop-db-order-items-order-id", "shop-db-order-items->shop-db-orders"]));
    const fk = els["shop-db-order-items-product-id"]!;
    expect(fk.related).toEqual(expect.arrayContaining(["shop-db-order-items", "shop-db-products-id", "shop-db-products", "shop-db-order-items->shop-db-products"]));
    expect(fk.links).toEqual([{ rel: "References", ids: ["shop-db-products-id"] }]);
    expect(fk.pos).toBe("FK → products.id");
    expect(fk.facts).toEqual(expect.arrayContaining([{ k: "Cardinality", v: "many order_items per products row" }, { k: "Null", v: "not null" }, { k: "Unique", v: "no" }]));
    const table = els["shop-db-order-items"]!;
    expect(table.related).toEqual(expect.arrayContaining(["shop-db-orders-id", "shop-db-products-id", "shop-db-order-items-order-id", "shop-db-order-items-product-id"]));
    expect(table.links).toEqual([{ rel: "References", ids: ["shop-db-orders-id", "shop-db-products-id"] }]);
    const edge = els["shop-db-order-items->shop-db-orders"]!;
    expect(edge.related).toEqual(["shop-db-order-items-order-id", "shop-db-orders-id"]);
    expect(edge.facts).toContainEqual({ k: "On delete", v: "cascade" });
  });

  test("template: notes, reading line and data table", async () => {
    const c = ctx();
    const block = schema.normalize(await template("schema.md", "schema"), c);
    const html = schema.render(block, c);
    expect(html.match(/class="x-note-marker"/g)?.length).toBe(2);
    expect(block.caveat).toBeDefined();
    expect(schema.reading!(block)).toContain("foreign-key row");
    const t = schema.table!(block);
    expect(t.head).toEqual(["Table", "Column", "Type", "Key", "References"]);
    expect(t.rows).toContainEqual(["order_items", "product_id", "uuid", "FK", "products.id"]);
    expect(t.rows.length).toBe(14);
  });

  test("self references, shared rows and the outer gutters stay apart and inside the canvas", () => {
    const warns: Diagnostic[] = [];
    const { html } = build(schema, {
      id: "s",
      tables: {
        employees: { at: [0, 0], columns: ["id int pk", "manager_id int fk employees.id null", "dept_id int fk depts.id", "mentor_id int fk employees.id null"] },
        depts: { at: [2, 0], columns: ["id int pk", "name text", "head_id int fk employees.id null"] },
        badges: { at: [0, 2], columns: ["id int pk", "owner_id int fk employees.id"] },
      },
    }, warns);
    contained(html);
    const ends = [...routes(html).values()].flatMap((p) => [p[0]!, p[p.length - 1]!]);
    // No two connector ends meet at one point: a self reference never lands on another key's arrow.
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) expect(Math.hypot(ends[i]![0] - ends[j]![0], ends[i]![1] - ends[j]![1])).toBeGreaterThanOrEqual(8);
    expect(warns.filter((w) => w.rule === "route")).toEqual([]);
  });

  test("three keys into one row share a bus with junction dots; runs around a blocking table stay on the canvas", () => {
    const warns: Diagnostic[] = [];
    const { html } = build(schema, {
      id: "b",
      tables: {
        x: { at: [0, 0], columns: ["id int pk", "a text", "b text", "c text", "d text"] },
        c: { at: [1, 0], columns: ["id int pk", "z text"] },
        y: { at: [2, 0], columns: ["id int pk", "x1 int fk x.id", "x2 int fk x.id", "x3 int fk x.id"] },
      },
    }, warns);
    contained(html);
    const paths = [...routes(html).values()];
    const lane = paths.map((p) => p[p.length - 2]![0]);
    expect(new Set(lane).size).toBe(1);
    expect(new Set(paths.map((p) => p[p.length - 1]!.join(","))).size).toBe(1);
    expect(html.match(/class="x-struct-join"/g)?.length).toBeGreaterThanOrEqual(1);
    expect(warns.filter((w) => w.rule === "route")).toEqual([]);
  });

  test("the canvas ends at the lowest box, not at the reserved rows", () => {
    const { html } = build(schema, shop());
    const bottom = Math.max(...[...boxes(html).values()].map((r) => r.y + r.h));
    expect(viewBox(html).h).toBe(bottom + pad);
  });

  test("er mode hides types, draws crow's feet and forwards router warnings", () => {
    const data = { ...shop(), mode: "er", relations: ["users 1--* orders : places", { rel: "orders 1--1..* items", about: "An order has at least one line." }] };
    const { block, html, model } = build(schema, data);
    expect(block.relations[0]!.ends).toEqual(["one", "many"]);
    expect(html).not.toContain(">numeric</text>");
    expect(html).toContain('marker-end="url(#shop-er-many)"');
    expect(html).toContain('marker-start="url(#shop-er-one)"');
    checkMarkup(html, model.elements ?? {}, "shop");
    // Five connectors on the short side of a one-column table: the router's spacing warning reaches check.
    const warns: Diagnostic[] = [];
    build(schema, {
      id: "h", mode: "er",
      tables: { x: { at: [0, 0], columns: ["id int pk"] }, y: { at: [2, 0], columns: ["id int pk", ...[1, 2, 3, 4, 5].map((i) => `x${i} int fk x.id`)] } },
    }, warns);
    expect(warns.some((w) => w.rule === "route" && w.message.includes("closer than"))).toBe(true);
  });

  test("an er self reference loops out of a side no other connector uses", () => {
    const { html } = build(schema, { id: "e", mode: "er", tables: { emp: { at: [0, 0], columns: ["id int pk", "boss int fk emp.id", "dept int fk dept.id"] }, dept: { at: [2, 0], columns: ["id int pk"] } } });
    const emp = boxes(html).get("e-emp")!;
    const loop = routes(html).get("e-emp->e-emp")!;
    expect(Math.min(...loop.map((p) => p[0]))).toBeLessThan(emp.x);
    expect(loop[1]![0]).toBe(emp.x - 36);
    contained(html);
  });

  test("errors", () => {
    expect(specError(() => schema.normalize(raw("schema", { ...shop(), colour: "red" }), ctx()))).toBeInstanceOf(SpecError);
    const badAt = specError(() => schema.normalize(raw("schema", { id: "s", tables: { a: { at: "top", columns: ["id int"] } } }), ctx()));
    expect(badAt.line).toBe(7);
    const ref = specError(() => schema.normalize(raw("schema", { id: "s", tables: { a: { at: [0, 0], columns: ["x int fk nope.id"] } } }), ctx()));
    expect(ref.rule).toBe("ref-exists");
    const erRef = specError(() => schema.normalize(raw("schema", { ...shop(), mode: "er", relations: ["users 1--* ghosts"] }), ctx()));
    expect(erRef.rule).toBe("ref-exists");
    const clash = specError(() => schema.normalize(raw("schema", { id: "s", tables: { a: { at: [0, 0], columns: ["a int", "b int"] }, b: { at: [0, 1], columns: ["c int"] } } }), ctx()));
    expect(clash.rule).toBe("grid-collision");
    expect(specError(() => schema.normalize(raw("schema", { ...shop(), relations: ["users 1--* orders"] }), ctx()))).toBeInstanceOf(SpecError);
    expect(specError(() => schema.normalize(raw("schema", { id: "s", tables: { a: { at: [0, 0], columns: [{ name: "b", fk: "a.id explode" }, "id int pk"] } } }), ctx()))).toBeInstanceOf(SpecError);
    expect(specError(() => schema.normalize(raw("schema", { ...shop(), notes: [{ on: "shop-ghost", text: "Nothing here." }] }), ctx())).rule).toBe("ref-exists");
  });

  test("warns over budget", () => {
    const tables = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`t${i}`, { at: [i % 4, Math.floor(i / 4)], columns: ["id int pk"] }]));
    const warns: Diagnostic[] = [];
    build(schema, { id: "s", tables }, warns);
    expect(warns.some((w) => w.rule === "budget-nodes")).toBe(true);
  });

  test("deterministic and escaped", () => {
    expect(build(schema, shop()).html).toBe(build(schema, shop()).html);
    const { html } = build(schema, { id: "s", tables: { "<script>x</script>": { at: [0, 0], columns: ["<b>id</b> int pk"] } } });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
  });
});

const pay = () => ({
  id: "pay",
  classes: {
    Order: { at: [1, 0], attributes: ["+id: UUID"], operations: ["+pay(): Receipt"], about: "One checkout." },
    LineItem: { at: [2, 0], attributes: ["+qty: Int"] },
    Payment: { at: [1, 2], stereotype: "abstract", operations: ["+capture()"] },
    CardPayment: { at: [0, 4] },
    Payable: { at: [2, 4], stereotype: "interface", operations: ["+amount(): Money"] },
  },
  relations: ['Order "1" *-- "1..*" LineItem', "Payment <|-- CardPayment", "Order --> Payment : paid by", "CardPayment ..|> Payable"],
});

const shapes = () => ({
  id: "u",
  classes: {
    Shape: { at: [1, 0], stereotype: "interface", operations: ["+area(): Float"] },
    Base: { at: [1, 2], stereotype: "abstract", attributes: ["#name: String"] },
    Circle: { at: [0, 4], attributes: ["-r: Float"] },
    Square: { at: [2, 4], attributes: ["-side: Float"] },
  },
  relations: ["Shape <|.. Base", "Base <|-- Circle", "Base <|-- Square"],
});

describe("uml", () => {
  test("normalizes classes, members and every relation kind", () => {
    const { block } = build(uml, pay());
    expect(block.classes.map((c) => c.id)).toEqual(["pay-order", "pay-lineitem", "pay-payment", "pay-cardpayment", "pay-payable"]);
    expect(block.classes[0]!.attributes).toEqual([{ id: "pay-order-id", text: "+id: UUID", name: "id" }]);
    expect(block.classes[0]!.operations[0]!.id).toBe("pay-order-pay");
    expect(block.relations.map((r) => r.kind)).toEqual(["composition", "inheritance", "association", "realization"]);
    expect(block.relations[0]).toMatchObject({ head: "start", fromMult: "1", toMult: "1..*" });
    expect(block.relations[2]).toMatchObject({ head: "end", label: "paid by" });
    expect(block.sets).toEqual([]);
  });

  test("renders compartments, member rows, notation ends and a model entry for each", () => {
    const { html, model } = build(uml, pay());
    checkMarkup(html, model.elements ?? {}, "pay");
    expect(html).toContain('marker-start="url(#pay-uml-dia-filled)"');
    expect(html).toContain('marker-start="url(#pay-uml-tri)"');
    expect(html).toContain('marker-end="url(#pay-uml-vee)"');
    expect(html).toMatch(/x-struct-edge x-dashed"[^>]*data-from="pay-cardpayment"/);
    expect(html).toContain("«interface»");
    expect(html).toContain("x-struct-name x-italic");
    expect(html).toContain(">1..*</text>");
    expect(html).toContain('class="x-mark x-struct-col" data-id="pay-order-pay"');
    expect(model.elements?.["pay-payment->pay-cardpayment"]?.type).toBe("edge");
    expect(model.elements?.["pay-order-pay"]).toMatchObject({ type: "item", kind: "operation", related: ["pay-order"], crumb: ["pay-order"] });
  });

  test("empty trailing compartments are left out; an empty one before operations stays", () => {
    const { html } = build(uml, pay());
    const rules = (id: string) => {
      const g = new RegExp(`data-id="${id}"[^>]*>(.*?)</g>`).exec(html)?.[1] ?? "";
      return g.match(/x-struct-rule/g)?.length ?? 0;
    };
    expect(rules("pay-cardpayment")).toBe(0);
    expect(rules("pay-lineitem")).toBe(1);
    expect(rules("pay-payable")).toBe(2);
    expect(rules("pay-order")).toBe(2);
  });

  test("a subclass meets its parent from below", () => {
    const { html } = build(uml, pay());
    const r = boxes(html), p = routes(html).get("pay-payment->pay-cardpayment")!;
    const payment = r.get("pay-payment")!, card = r.get("pay-cardpayment")!;
    expect(p[0]![1]).toBe(payment.y + payment.h);
    expect(p[p.length - 1]![1]).toBe(card.y);
  });

  test("siblings in one row share one triangle under the parent's bottom centre", async () => {
    const c = ctx();
    const block = uml.normalize(await template("uml.md", "uml"), c);
    const html = uml.render(block, c);
    expect(block.sets).toEqual([{ id: "checkout-payment-subclasses", parent: "checkout-payment", kind: "inheritance", children: ["checkout-cardpayment", "checkout-banktransfer"], relations: ["checkout-payment->checkout-cardpayment", "checkout-payment->checkout-banktransfer"] }]);
    expect(html.match(/url\(#checkout-uml-tri\)/g)?.length).toBe(1);
    const r = boxes(html), paths = routes(html);
    const payment = r.get("checkout-payment")!;
    const trunk = paths.get("checkout-payment-subclasses")!;
    expect(trunk[trunk.length - 1]).toEqual([payment.x + payment.w / 2, payment.y + payment.h]);
    for (const id of ["checkout-cardpayment", "checkout-banktransfer"]) {
      const kid = r.get(id)!, branch = paths.get(`checkout-payment->${id}`)!;
      expect(branch[0]).toEqual([kid.x + kid.w / 2, kid.y]);
      expect(branch[branch.length - 1]![1]).toBe(trunk[0]![1]);
    }
    const els = uml.model!(block).elements!;
    expect(els["checkout-payment->checkout-cardpayment"]!.related).toEqual(["checkout-payment-subclasses"]);
    expect(els["checkout-payment-subclasses"]).toMatchObject({ type: "group", members: ["checkout-payment", "checkout-cardpayment", "checkout-banktransfer"] });
    expect(els["checkout-payment"]!.links).toEqual([{ rel: "Held by", ids: ["checkout-order"] }, { rel: "Extended by", ids: ["checkout-cardpayment", "checkout-banktransfer"] }]);
    expect(els["checkout-lineitem"]!.links).toEqual([{ rel: "Part of", ids: ["checkout-order"] }]);
    expect(els["checkout-order->checkout-lineitem"]!.facts).toContainEqual({ k: "Lifecycle", v: "a LineItem is deleted with its Order" });
    expect(html.match(/class="x-note-marker"/g)?.length).toBe(3);
    contained(html);
  });

  test("a class lights its members and inherited members; the rest of its hierarchy is context", () => {
    const { block } = build(uml, shapes());
    const els = uml.model!(block).elements!;
    const circle = els["u-circle"]!;
    expect(circle.related).toEqual(expect.arrayContaining(["u-circle-r", "u-base-name", "u-shape-area", "u-base", "u-base-subclasses"]));
    expect(circle.context).toEqual(expect.arrayContaining(["u-shape", "u-shape->u-base"]));
    expect(circle.facts).toContainEqual({ k: "Inherits", v: "#name: String, +area(): Float" });
    const shape = els["u-shape"]!;
    expect(shape.context).toEqual(expect.arrayContaining(["u-circle", "u-square", "u-base->u-circle", "u-base->u-square"]));
    expect(shape.facts).toContainEqual({ k: "Descendants", v: "Base, Circle and Square" });
    expect(els["u-base-name"]).toMatchObject({ context: ["u-circle", "u-square"] });
    expect(els["u-base-name"]!.facts).toEqual(expect.arrayContaining([{ k: "Visibility", v: "protected" }, { k: "Type", v: "String" }]));
  });

  test("a self relation loops out of a free side and labels stay clear of boxes", () => {
    const { html } = build(uml, { id: "n", classes: { Node: { at: [0, 0], attributes: ["+id: Int"] }, Other: { at: [2, 0] } }, relations: ["Node o-- Node : children", "Node --> Other : uses"] });
    const node = boxes(html).get("n-node")!;
    const loop = routes(html).get("n-node->n-node")!;
    expect(Math.max(...loop.map((p) => p[0]))).toBe(node.x);
    const labels = [...html.matchAll(/<text class="x-struct-label" x="([\d.]+)" y="([\d.]+)"/g)];
    expect(labels.length).toBe(2);
    for (const m of labels) {
      const x = Number(m[1]), y = Number(m[2]);
      for (const b of boxes(html).values()) expect(x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h).toBe(false);
    }
    contained(html);
  });

  test("errors", () => {
    expect(specError(() => uml.normalize(raw("uml", { ...pay(), relations: ["Order ==> Payment"] }), ctx()))).toBeInstanceOf(SpecError);
    expect(specError(() => uml.normalize(raw("uml", { ...pay(), relations: ["Order --> Ghost"] }), ctx())).rule).toBe("ref-exists");
    expect(specError(() => uml.normalize(raw("uml", { id: "u", classes: { A: { at: [0, 0], stereotype: "enum" } } }), ctx()))).toBeInstanceOf(SpecError);
    expect(specError(() => uml.normalize(raw("uml", { id: "u", classes: { A: { at: [0, 0], methods: [] } } }), ctx()))).toBeInstanceOf(SpecError);
    expect(specError(() => uml.normalize(raw("uml", { id: "u", classes: { A: { at: [0, "x"] } } }), ctx())).line).toBe(7);
    expect(specError(() => uml.normalize(raw("uml", { ...pay(), story: ["pay-ghost"] }), ctx())).rule).toBe("ref-exists");
  });

  test("warns over the member budget", () => {
    const warns: Diagnostic[] = [];
    build(uml, { id: "u", classes: { A: { at: [0, 0], attributes: ["a", "b", "c", "d", "e", "f"] } } }, warns);
    expect(warns.some((w) => w.rule === "budget-nodes")).toBe(true);
  });

  test("deterministic and escaped", () => {
    expect(build(uml, pay()).html).toBe(build(uml, pay()).html);
    const { html } = build(uml, { id: "u", classes: { "<script>alert(1)</script>": { at: [0, 0], attributes: ["<img>"] } } });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img>");
  });
});

describe("schema and uml widths", () => {
  test("templates stay within 960px, so the card docks in the gutter beside them", async () => {
    for (const [file, mod] of [["schema.md", schema], ["uml.md", uml]] as const) {
      const c = ctx();
      const block = (mod as BlockModule<{ type: string; line: number }>).normalize(await template(file, file.replace(".md", "")), c);
      expect(viewBox((mod as BlockModule<{ type: string; line: number }>).render(block, c)).w).toBeLessThanOrEqual(960);
    }
  });

  test("every table is as wide as the widest one that fits a column; a wider one spans two alone", () => {
    const long = "note text"; // a short column beside one with a long type
    const { html, block } = build(schema, {
      id: "w",
      tables: {
        a: { at: [0, 0], columns: ["id uuid pk", "placed_at timestamptz"] },
        b: { at: [2, 0], columns: ["id uuid pk", long] },
        c: { at: [0, 2], columns: ["id uuid pk", "payload character varying(4000)"] },
      },
    });
    const r = boxes(html);
    const [a, b, c] = ["w-a", "w-b", "w-c"].map((id) => r.get(id)!);
    expect(a.w).toBe(b.w);
    expect(a.w % 8).toBe(0);
    expect(a.w).toBeGreaterThan(theme.grid.cell[0]);
    expect(block.tables.find((t) => t.name === "c")!.span[0]).toBe(2);
    expect(c.w).toBeGreaterThan(a.w);
    expect(c.w).toBeLessThan(2 * a.w + theme.grid.gap[0]);
  });

  test("key chips hold their 13px sans label", () => {
    const { html } = build(schema, { id: "k", tables: { t: { at: [0, 0], columns: ["id uuid pk", "u uuid fk t.id"] } } });
    const chips = [...html.matchAll(/class="x-struct-chip" data-key="(pk|fk)" x="[\d.-]+" y="[\d.-]+" width="([\d.]+)" height="([\d.]+)"/g)];
    expect(chips.length).toBe(2);
    for (const m of chips) {
      expect(Number(m[2])).toBeGreaterThanOrEqual(textWidth(m[1]!.toUpperCase(), theme.type.tag, "sans") + 8);
      expect(Number(m[3])).toBeGreaterThanOrEqual(16);
    }
  });
});
