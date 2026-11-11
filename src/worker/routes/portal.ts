import { Hono } from "hono";
import { ORDER_STATUSES } from "../../shared/constants";
import { cartItemSchema, placeOrderSchema, retailerSelfProfileSchema } from "../../shared/schemas";
import { RETAILER_COLS, retailerCtx, retailerOnly, type BusinessRow, type RetailerCtx } from "../lib/auth";
import { body, invalid, like, notFound, now, ok, pageParams, uuid, type AppEnv } from "../lib/http";
import { changeOrderStatus, createOrder, orderDetail, pricedProducts, priceLines, retailerLedger } from "../lib/orders";
import { rateLimit, resolveAvailability } from "../lib/util";

/**
 * Retailer-facing API. Every query is scoped by BOTH the retailer's business_id and their own retailer id,
 * both taken from the session — never from the request.
 */
export const portalRoutes = new Hono<AppEnv>();
portalRoutes.use("*", retailerOnly);

/** What a retailer may see of a product: their own effective price only — never the standard price or other overrides. */
const PORTAL_PRODUCT = `p.id, p.name, p.sku, p.description, p.unit, p.mrp_paise, p.gst_rate_bp, p.min_order_qty, p.stock_qty, p.availability,
  p.image_url, p.category_id, c.name AS category_name, COALESCE(rp.price_paise, p.price_paise) AS price_paise`;
const PORTAL_FROM = `FROM products p
  LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL
  LEFT JOIN retailer_product_prices rp ON rp.product_id = p.id AND rp.retailer_id = ? AND rp.business_id = p.business_id`;

function present(p: any, biz: BusinessRow) {
  const tracked = !!biz.track_inventory && p.stock_qty != null;
  const { stock_qty, availability, gst_rate_bp, ...rest } = p;
  return {
    ...rest,
    gst_rate_bp: biz.gst_enabled ? gst_rate_bp : 0,
    availability_status: resolveAvailability(p, biz),
    available_qty: tracked ? stock_qty : null,
  };
}

async function ensureCart(db: D1Database, auth: RetailerCtx): Promise<string> {
  const ts = now();
  await db.prepare("INSERT INTO carts (id, business_id, retailer_id, created_at, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(retailer_id) DO NOTHING")
    .bind(uuid(), auth.business.id, auth.retailer.id, ts, ts).run();
  const cart = await db.prepare("SELECT id FROM carts WHERE retailer_id = ? AND business_id = ?").bind(auth.retailer.id, auth.business.id).first<{ id: string }>();
  return cart!.id;
}

async function cartView(db: D1Database, auth: RetailerCtx) {
  const cartId = await ensureCart(db, auth);
  const { results: rows } = await db
    .prepare(
      `SELECT ci.product_id, ci.quantity, p.name, p.sku, p.unit, p.image_url, p.min_order_qty
       FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = ? AND ci.business_id = ? ORDER BY ci.created_at`,
    )
    .bind(cartId, auth.business.id)
    .all<any>();
  const lines = rows.map((r) => ({ productId: r.product_id, quantity: r.quantity }));
  const products = await pricedProducts(db, auth.business.id, auth.retailer.id, lines.map((l) => l.productId));
  const { priced, issues, subtotal, tax } = priceLines(auth.business, products, lines);
  const pricedById = new Map(priced.map((l) => [l.product.id, l]));
  const issueById = new Map(issues.map((i) => [i.productId, i.message]));
  const items = rows.map((r) => {
    const l = pricedById.get(r.product_id);
    const p = products.get(r.product_id);
    return {
      product_id: r.product_id, name: r.name, sku: r.sku, unit: r.unit, image_url: r.image_url, min_order_qty: r.min_order_qty, quantity: r.quantity,
      unit_price_paise: p?.effective_price_paise ?? null,
      line_subtotal_paise: l?.lineSubtotal ?? null,
      gst_rate_bp: l?.gstRateBp ?? 0,
      gst_amount_paise: l?.gst ?? 0,
      available_qty: p && auth.business.track_inventory && p.stock_qty != null ? p.stock_qty : null,
      issue: issueById.get(r.product_id) ?? null,
    };
  });
  return { cartId, items, subtotal_paise: subtotal, tax_paise: tax, total_paise: subtotal + tax, item_count: items.length, can_checkout: items.length > 0 && issues.length === 0 };
}

// ── Store & catalogue ─────────────────────────────────────────────────

portalRoutes.get("/store", async (c) => {
  const { business } = retailerCtx(c);
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.archived_at IS NULL AND p.is_active = 1) AS product_count
     FROM categories c WHERE c.business_id = ? AND c.deleted_at IS NULL ORDER BY c.name`,
  ).bind(business.id).all<any>();
  return ok(c, {
    business: { name: business.name, slug: business.slug, phone: business.phone, email: business.email, address: business.address, city: business.city, state: business.state, gstin: business.gstin, about: business.about, gst_enabled: business.gst_enabled },
    categories: results.filter((r) => r.product_count > 0),
  });
});

portalRoutes.get("/dashboard", async (c) => {
  const auth = retailerCtx(c);
  const db = c.env.DB;
  const ledger = await retailerLedger(db, auth.business.id, auth.retailer.id);
  const [recent, active, cart] = await db.batch([
    db.prepare("SELECT id, order_number, status, payment_status, total_paise, created_at FROM orders WHERE business_id = ? AND retailer_id = ? ORDER BY created_at DESC LIMIT 5").bind(auth.business.id, auth.retailer.id),
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE business_id = ? AND retailer_id = ? AND status NOT IN ('delivered','rejected','cancelled')").bind(auth.business.id, auth.retailer.id),
    db.prepare("SELECT COUNT(*) AS n FROM cart_items ci JOIN carts ct ON ct.id = ci.cart_id WHERE ct.retailer_id = ? AND ct.business_id = ?").bind(auth.retailer.id, auth.business.id),
  ]);
  return ok(c, { totals: ledger.totals, recentOrders: recent.results, activeOrders: (active.results[0] as any).n, cartCount: (cart.results[0] as any).n });
});

portalRoutes.get("/products", async (c) => {
  const { business, retailer } = retailerCtx(c);
  const { page, pageSize, offset } = pageParams(c, 24);
  const where = ["p.business_id = ?", "p.archived_at IS NULL", "p.is_active = 1"];
  const params: unknown[] = [business.id];
  const q = c.req.query("q")?.trim();
  if (q) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')");
    params.push(like(q), like(q));
  }
  const categoryId = c.req.query("categoryId");
  if (categoryId) {
    where.push("p.category_id = ?");
    params.push(categoryId);
  }
  const w = where.join(" AND ");
  const db = c.env.DB;
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${w}`).bind(...params),
    db.prepare(`SELECT ${PORTAL_PRODUCT} ${PORTAL_FROM} WHERE ${w} ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?`).bind(retailer.id, ...params, pageSize, offset),
  ]);
  return ok(c, (rows.results as any[]).map((p) => present(p, business)), { page, pageSize, total: (count.results[0] as any).n });
});

portalRoutes.get("/products/:id", async (c) => {
  const { business, retailer } = retailerCtx(c);
  const p = await c.env.DB.prepare(`SELECT ${PORTAL_PRODUCT} ${PORTAL_FROM} WHERE p.id = ? AND p.business_id = ? AND p.archived_at IS NULL AND p.is_active = 1`)
    .bind(retailer.id, c.req.param("id"), business.id).first();
  if (!p) throw notFound("Product");
  return ok(c, present(p, business));
});

// ── Cart ──────────────────────────────────────────────────────────────

portalRoutes.get("/cart", async (c) => ok(c, await cartView(c.env.DB, retailerCtx(c))));

portalRoutes.put("/cart/items", async (c) => {
  const auth = retailerCtx(c);
  const input = await body(c, cartItemSchema);
  const db = c.env.DB;
  const cartId = await ensureCart(db, auth);
  if (input.quantity === 0) {
    await db.prepare("DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?").bind(cartId, input.productId).run();
    return ok(c, await cartView(db, auth));
  }
  const products = await pricedProducts(db, auth.business.id, auth.retailer.id, [input.productId]);
  if (!products.has(input.productId)) throw notFound("Product");
  const { issues } = priceLines(auth.business, products, [input]);
  if (issues.length) throw invalid(issues[0].message, issues);
  const ts = now();
  await db.batch([
    db.prepare(
      `INSERT INTO cart_items (id, cart_id, business_id, product_id, quantity, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
    ).bind(uuid(), cartId, auth.business.id, input.productId, input.quantity, ts, ts),
    db.prepare("UPDATE carts SET updated_at = ? WHERE id = ?").bind(ts, cartId),
  ]);
  return ok(c, await cartView(db, auth));
});

portalRoutes.delete("/cart", async (c) => {
  const auth = retailerCtx(c);
  const cartId = await ensureCart(c.env.DB, auth);
  await c.env.DB.prepare("DELETE FROM cart_items WHERE cart_id = ?").bind(cartId).run();
  return ok(c, await cartView(c.env.DB, auth));
});

// ── Orders ────────────────────────────────────────────────────────────

/** Checkout. The request carries only an optional note: lines come from the server-side cart, prices from the resolver. */
portalRoutes.post("/orders", async (c) => {
  const auth = retailerCtx(c);
  await rateLimit(c, "place-order", auth.retailer.id, 30, 600);
  const input = await body(c, placeOrderSchema);
  const db = c.env.DB;
  const cartId = await ensureCart(db, auth);
  const { results } = await db.prepare("SELECT product_id, quantity FROM cart_items WHERE cart_id = ?").bind(cartId).all<{ product_id: string; quantity: number }>();
  const order = await createOrder(db, {
    business: auth.business, retailerId: auth.retailer.id, retailerName: auth.retailer.business_name, retailerUserId: auth.user.id,
    lines: results.map((r) => ({ productId: r.product_id, quantity: r.quantity })), note: input.note, actor: auth.user, source: "retailer", clearCartId: cartId,
  });
  return ok(c, order, undefined, 201);
});

portalRoutes.get("/orders", async (c) => {
  const { business, retailer } = retailerCtx(c);
  const { page, pageSize, offset } = pageParams(c);
  const where = ["o.business_id = ?", "o.retailer_id = ?"];
  const params: unknown[] = [business.id, retailer.id];
  const status = c.req.query("status");
  if (status === "active") where.push("o.status NOT IN ('delivered','rejected','cancelled')");
  else if (status && (ORDER_STATUSES as readonly string[]).includes(status)) {
    where.push("o.status = ?");
    params.push(status);
  }
  const w = where.join(" AND ");
  const db = c.env.DB;
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM orders o WHERE ${w}`).bind(...params),
    db.prepare(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.total_paise, o.amount_paid_paise, o.created_at,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
       FROM orders o WHERE ${w} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...params, pageSize, offset),
  ]);
  return ok(c, rows.results, { page, pageSize, total: (count.results[0] as any).n });
});

portalRoutes.get("/orders/:id", async (c) => {
  const { business, retailer } = retailerCtx(c);
  return ok(c, await orderDetail(c.env.DB, business.id, c.req.param("id"), retailer.id));
});

portalRoutes.post("/orders/:id/cancel", async (c) => {
  const { business, retailer, user } = retailerCtx(c);
  return ok(c, await changeOrderStatus(c.env.DB, { business, orderId: c.req.param("id"), to: "cancelled", actor: user, note: "Cancelled by retailer", retailerId: retailer.id }));
});

/** Copies a past order's lines into the cart at today's prices; anything no longer orderable is reported back. */
portalRoutes.post("/orders/:id/reorder", async (c) => {
  const auth = retailerCtx(c);
  const db = c.env.DB;
  const order = await db.prepare("SELECT id FROM orders WHERE id = ? AND business_id = ? AND retailer_id = ?").bind(c.req.param("id"), auth.business.id, auth.retailer.id).first();
  if (!order) throw notFound("Order");
  const { results: items } = await db.prepare("SELECT product_id, product_name, quantity FROM order_items WHERE order_id = ?").bind(c.req.param("id")).all<{ product_id: string; product_name: string; quantity: number }>();
  const lines = items.map((i) => ({ productId: i.product_id, quantity: i.quantity }));
  const products = await pricedProducts(db, auth.business.id, auth.retailer.id, lines.map((l) => l.productId));
  const { priced, issues } = priceLines(auth.business, products, lines);
  const cartId = await ensureCart(db, auth);
  const ts = now();
  if (priced.length) {
    await db.batch(priced.map((l) =>
      db.prepare(
        `INSERT INTO cart_items (id, cart_id, business_id, product_id, quantity, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
      ).bind(uuid(), cartId, auth.business.id, l.product.id, l.quantity, ts, ts),
    ));
  }
  return ok(c, { added: priced.length, skipped: issues.map((i) => ({ name: i.name ?? "Product", reason: i.message })) });
});

// ── Ledger & profile ──────────────────────────────────────────────────

portalRoutes.get("/ledger", async (c) => {
  const { business, retailer } = retailerCtx(c);
  return ok(c, await retailerLedger(c.env.DB, business.id, retailer.id));
});

portalRoutes.get("/profile", (c) => ok(c, retailerCtx(c).retailer));

portalRoutes.patch("/profile", async (c) => {
  const { business, retailer } = retailerCtx(c);
  const raw = await c.req.json().catch(() => ({}));
  const input = await body(c, retailerSelfProfileSchema);
  const cols: Record<string, string> = { contactPerson: "contact_person", address: "address", city: "city", state: "state", gstin: "gstin" };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(cols)) {
    if (!(key in raw)) continue;
    sets.push(`${col} = ?`);
    params.push((input as any)[key] ?? null);
  }
  if (!sets.length) throw invalid("Nothing to update");
  await c.env.DB.prepare(`UPDATE retailer_profiles SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND business_id = ?`).bind(...params, now(), retailer.id, business.id).run();
  return ok(c, await c.env.DB.prepare(`SELECT ${RETAILER_COLS} FROM retailer_profiles r WHERE r.id = ?`).bind(retailer.id).first());
});
