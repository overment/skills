---
title: Where an order's price lives
chrome: title
shots:
  - sel=shop-db-products-id
  - sel=shop-db-orders-id
  - sel=shop-db-order-items-product-id
  - sel=shop-db-order-items->shop-db-orders
---

Each [order line](#shop-db-order-items) copies [products.price](#shop-db-products-price) into its own [unit_price](#shop-db-order-items-unit-price) at checkout, so changing a price later never rewrites an old order. The line still points at its product through [product_id](#shop-db-order-items-product-id), which references [products.id](#shop-db-products-id).

```schema
id: shop-db
tables:
  users:
    at: [0, 0]
    about: Everyone who can sign in and place an order.
    columns:
      - id uuid pk: Generated at sign-up and never reused, even after the account is deleted.
      - email text unique: Used to sign in; changing it keeps the same id.
      - name text: Shown on invoices and in order emails.
  orders:
    at: [2, 0]
    about: One checkout by one user; it tracks progress but holds no prices.
    columns:
      - id uuid pk: Printed on the receipt as the order number.
      - user_id uuid fk users.id: The buyer; an order cannot exist without one.
      - status text: One of placed, paid, shipped or delivered.
      - placed_at timestamptz: When checkout finished, stored in UTC.
  products:
    at: [0, 2]
    about: The catalogue as it is today; prices here change freely.
    columns:
      - id uuid pk: Stable across renames and price changes.
      - title text: The name shown in the shop.
      - price numeric: Today's price; old orders never read it.
  order_items:
    at: [2, 2]
    focal: true
    about: One product in one order, frozen at the moment of checkout.
    columns:
      - order_id uuid fk orders.id cascade: The order this line belongs to; deleting the order deletes its lines.
      - product_id uuid fk products.id: What was bought, used for stock and reporting.
      - quantity int: How many units, always at least one.
      - unit_price numeric: Copied from products.price at checkout and never updated.
notes:
  - on: shop-db-order-items-unit-price
    text: unit_price is written once, at checkout. Nothing updates it when products.price changes, so an old order keeps the price it was charged.
  - on: shop-db-order-items->shop-db-products
    text: The line keeps only product_id, a reference and not a copy of the product, so stock and reports still join back to the product row.
caveat: Taxes, discounts and currency are left out; the figure only shows where the price is stored.
```
