import { MAX_ORDER_LINES, ORDER_STATUS_LABELS, ORDER_TRANSITIONS, type OrderStatus } from "../../shared/constants";
import { gstAmount } from "../../shared/money";
import type { AuthUser, BusinessRow } from "./auth";
import { AppError, conflict, forbidden, invalid, notFound, now, uuid } from "./http";
import { auditStmt, businessUserIds, inr, isConstraintError, notifyStmt, resolveAvailability } from "./util";

export const NOT_VOID = "status NOT IN ('rejected','cancelled')";

export type PricedProduct = {
  id: string; name: string; sku: string; unit: string; price_paise: number; effective_price_paise: number; gst_rate_bp: number;
  min_order_qty: number; stock_qty: number | null; availability: string; is_active: number; archived_at: string | null;
};

/**
 * THE price resolver. A retailer's price is their override if one exists, otherwise the standard price.
 * Always scoped by business_id, so ids from another tenant simply resolve to nothing.
 * `useSpecialPrices` is false when the admin has switched retailer-specific pricing off for the business:
 * overrides are then ignored (but kept, so they come back if the feature is switched on again).
 */
export async function pricedProducts(db: D1Database, businessId: string, retailerId: string, productIds: string[], useSpecialPrices: boolean): Promise<Map<string, PricedProduct>> {
  const out = new Map<string, PricedProduct>();
  for (let i = 0; i < productIds.length; i += 80) {
    const chunk = productIds.slice(i, i + 80);
    const { results } = await db
      .prepare(
        `SELECT p.id, p.name, p.sku, p.unit, p.price_paise, COALESCE(rp.price_paise, p.price_paise) AS effective_price_paise,
                p.gst_rate_bp, p.min_order_qty, p.stock_qty, p.availability, p.is_active, p.archived_at
         FROM products p
         LEFT JOIN retailer_product_prices rp ON rp.product_id = p.id AND rp.retailer_id = ? AND rp.business_id = p.business_id AND 1 = ?
         WHERE p.business_id = ? AND p.id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(retailerId, useSpecialPrices ? 1 : 0, businessId, ...chunk)
      .all<PricedProduct>();
    for (const r of results) out.set(r.id, r);
  }
  return out;
}

export type LineIssue = { productId: string; name?: string; message: string };

/** Validates requested lines against catalogue rules and returns server-priced lines. Never reads a price from the client. */
export function priceLines(business: BusinessRow, products: Map<string, PricedProduct>, lines: { productId: string; quantity: number }[]) {
  const issues: LineIssue[] = [];
  const priced: {
    product: PricedProduct; quantity: number; lineSubtotal: number; gstRateBp: number; gst: number; deductStock: boolean;
  }[] = [];
  for (const line of lines) {
    const p = products.get(line.productId);
    if (!p || p.archived_at || !p.is_active) {
      issues.push({ productId: line.productId, name: p?.name, message: `${p?.name ?? "A product"} is no longer available` });
      continue;
    }
    if (line.quantity < p.min_order_qty) {
      issues.push({ productId: p.id, name: p.name, message: `${p.name}: minimum order quantity is ${p.min_order_qty} ${p.unit}` });
      continue;
    }
    const tracked = !!business.track_inventory && p.stock_qty != null;
    if (tracked && line.quantity > (p.stock_qty as number)) {
      issues.push({ productId: p.id, name: p.name, message: p.stock_qty === 0 ? `${p.name} is out of stock` : `${p.name}: only ${p.stock_qty} ${p.unit} in stock` });
      continue;
    }
    if (!tracked && resolveAvailability(p, business) === "out_of_stock") {
      issues.push({ productId: p.id, name: p.name, message: `${p.name} is out of stock` });
      continue;
    }
    const lineSubtotal = p.effective_price_paise * line.quantity;
    const gstRateBp = business.gst_enabled ? p.gst_rate_bp : 0;
    priced.push({ product: p, quantity: line.quantity, lineSubtotal, gstRateBp, gst: gstAmount(lineSubtotal, gstRateBp), deductStock: tracked });
  }
  const subtotal = priced.reduce((s, l) => s + l.lineSubtotal, 0);
  const tax = priced.reduce((s, l) => s + l.gst, 0);
  return { priced, issues, subtotal, tax };
}

export async function createOrder(
  db: D1Database,
  args: {
    business: BusinessRow; retailerId: string; retailerName: string; retailerUserId: string | null;
    lines: { productId: string; quantity: number }[]; note?: string | null; actor: AuthUser; source: "retailer" | "owner";
    discountPaise?: number; deliveryPaise?: number; clearCartId?: string; useSpecialPrices: boolean;
  },
) {
  const { business, actor } = args;
  // merge duplicate product lines
  const merged = new Map<string, number>();
  for (const l of args.lines) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.quantity);
  const lines = [...merged].map(([productId, quantity]) => ({ productId, quantity }));
  if (!lines.length) throw invalid("Your cart is empty");
  if (lines.length > MAX_ORDER_LINES) throw invalid(`An order can contain at most ${MAX_ORDER_LINES} different products`);

  const products = await pricedProducts(db, business.id, args.retailerId, lines.map((l) => l.productId), args.useSpecialPrices);
  const { priced, issues, subtotal, tax } = priceLines(business, products, lines);
  if (issues.length) throw new AppError(422, "ORDER_INVALID", issues[0].message, issues);

  const discount = args.discountPaise ?? 0;
  const delivery = args.deliveryPaise ?? 0;
  if (discount > subtotal + tax + delivery) throw invalid("Discount cannot be more than the order value");
  const total = subtotal + tax - discount + delivery;

  const seq = await db
    .prepare("UPDATE businesses SET next_order_seq = next_order_seq + 1 WHERE id = ? RETURNING next_order_seq - 1 AS seq, order_prefix")
    .bind(business.id)
    .first<{ seq: number; order_prefix: string }>();
  if (!seq) throw notFound("Business");
  const orderNumber = `${seq.order_prefix}${seq.seq}`;
  const orderId = uuid();
  const ts = now();

  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO orders (id, business_id, retailer_id, order_number, status, payment_status, subtotal_paise, tax_paise, discount_paise, delivery_paise,
         total_paise, retailer_note, source, placed_by_user_id, created_at, updated_at) VALUES (?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(orderId, business.id, args.retailerId, orderNumber, total === 0 ? "paid" : "unpaid", subtotal, tax, discount, delivery, total, args.note ?? null, args.source, actor.id, ts, ts),
    db.prepare("INSERT INTO order_status_history (id, order_id, business_id, from_status, to_status, actor_user_id, actor_role, note, created_at) VALUES (?,?,?,NULL,'pending',?,?,?,?)")
      .bind(uuid(), orderId, business.id, actor.id, actor.role, args.source === "owner" ? "Order created by wholesaler" : null, ts),
  ];
  for (const l of priced) {
    stmts.push(
      db.prepare(
        `INSERT INTO order_items (id, order_id, business_id, product_id, product_name, sku, unit, unit_price_paise, quantity, line_subtotal_paise,
           gst_rate_bp, gst_amount_paise, stock_deducted, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(uuid(), orderId, business.id, l.product.id, l.product.name, l.product.sku, l.product.unit, l.product.effective_price_paise, l.quantity, l.lineSubtotal, l.gstRateBp, l.gst, l.deductStock ? 1 : 0, ts),
    );
    if (l.deductStock) {
      // If a concurrent order took the stock, the CHECK (stock_qty >= 0) fails and the whole batch rolls back.
      stmts.push(db.prepare("UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ? AND business_id = ?").bind(l.quantity, ts, l.product.id, business.id));
    }
  }
  if (args.clearCartId) stmts.push(db.prepare("DELETE FROM cart_items WHERE cart_id = ?").bind(args.clearCartId));
  stmts.push(auditStmt(db, { businessId: business.id, actorId: actor.id, action: "order.created", entityType: "order", entityId: orderId, metadata: { orderNumber, total, source: args.source } }));
  if (args.source === "retailer") {
    for (const uid of await businessUserIds(db, business.id)) {
      stmts.push(notifyStmt(db, { userId: uid, businessId: business.id, type: "order_new", title: `New order ${orderNumber}`, body: `${args.retailerName} placed an order worth ${inr(total)}.`, link: `/dashboard/orders/${orderId}` }));
    }
  } else if (args.retailerUserId) {
    stmts.push(notifyStmt(db, { userId: args.retailerUserId, businessId: business.id, type: "order_new", title: `Order ${orderNumber} created for you`, body: `${business.name} created an order worth ${inr(total)}.`, link: `/retailer/orders/${orderId}` }));
  }

  try {
    await db.batch(stmts); // D1 batches are transactional: all statements commit or none do
  } catch (e) {
    if (isConstraintError(e, "CHECK")) throw conflict("Stock changed while placing your order. Please review your cart and try again.");
    throw e;
  }
  return { id: orderId, order_number: orderNumber, total_paise: total, status: "pending" };
}

export async function changeOrderStatus(
  db: D1Database,
  args: { business: BusinessRow; orderId: string; to: OrderStatus; actor: AuthUser; note?: string | null; retailerId?: string },
) {
  const { business, actor, to } = args;
  const order = await db
    .prepare(
      `SELECT o.id, o.status, o.order_number, o.amount_paid_paise, o.retailer_id, r.user_id AS retailer_user_id, r.business_name AS retailer_name
       FROM orders o JOIN retailer_profiles r ON r.id = o.retailer_id WHERE o.id = ? AND o.business_id = ?`,
    )
    .bind(args.orderId, business.id)
    .first<{ id: string; status: OrderStatus; order_number: string; amount_paid_paise: number; retailer_id: string; retailer_user_id: string | null; retailer_name: string }>();
  // A retailer asking about someone else's order gets the same 404 as a non-existent order.
  if (!order || (args.retailerId && order.retailer_id !== args.retailerId)) throw notFound("Order");

  if (actor.role === "retailer") {
    if (to !== "cancelled") throw forbidden("Retailers can only cancel orders");
    if (order.status !== "pending") throw conflict("This order has already been accepted and can no longer be cancelled. Please contact your wholesaler.");
  } else if (!ORDER_TRANSITIONS[order.status].includes(to)) {
    throw conflict(`An order that is ${ORDER_STATUS_LABELS[order.status].toLowerCase()} cannot be moved to ${ORDER_STATUS_LABELS[to].toLowerCase()}.`);
  }
  const voiding = to === "cancelled" || to === "rejected";
  if (voiding && order.amount_paid_paise > 0) {
    throw conflict("Payments are recorded against this order. Reverse those payments before cancelling or rejecting it.");
  }

  const ts = now();
  // The UPDATE is guarded on the status we read; the follow-up statements only apply if that UPDATE won the race
  // (they look for the exact status + timestamp this request wrote).
  const applied = "EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = ? AND updated_at = ?)";
  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND business_id = ? AND status = ?${voiding ? " AND amount_paid_paise = 0" : ""}`)
      .bind(to, ts, order.id, business.id, order.status),
    db.prepare(
      `INSERT INTO order_status_history (id, order_id, business_id, from_status, to_status, actor_user_id, actor_role, note, created_at)
       SELECT ?,?,?,?,?,?,?,?,? WHERE ${applied}`,
    ).bind(uuid(), order.id, business.id, order.status, to, actor.id, actor.role, args.note ?? null, ts, order.id, to, ts),
  ];
  if (voiding) {
    // return reserved stock
    stmts.push(
      db.prepare(
        `UPDATE products SET stock_qty = stock_qty + (SELECT oi.quantity FROM order_items oi WHERE oi.order_id = ? AND oi.product_id = products.id AND oi.stock_deducted = 1)
         WHERE business_id = ? AND stock_qty IS NOT NULL
           AND id IN (SELECT product_id FROM order_items WHERE order_id = ? AND stock_deducted = 1) AND ${applied}`,
      ).bind(order.id, business.id, order.id, order.id, to, ts),
    );
  }
  const res = await db.batch(stmts);
  if (!res[0].meta.changes) throw conflict("This order was just updated by someone else. Refresh and try again.");

  const after: D1PreparedStatement[] = [
    auditStmt(db, { businessId: business.id, actorId: actor.id, action: "order.status_changed", entityType: "order", entityId: order.id, metadata: { from: order.status, to } }),
  ];
  const label = ORDER_STATUS_LABELS[to].toLowerCase();
  if (actor.role === "retailer") {
    for (const uid of await businessUserIds(db, business.id)) {
      after.push(notifyStmt(db, { userId: uid, businessId: business.id, type: "order_status", title: `Order ${order.order_number} cancelled`, body: `${order.retailer_name} cancelled this order.`, link: `/dashboard/orders/${order.id}` }));
    }
  } else if (order.retailer_user_id) {
    after.push(notifyStmt(db, { userId: order.retailer_user_id, businessId: business.id, type: "order_status", title: `Order ${order.order_number} is ${label}`, body: args.note ?? undefined, link: `/retailer/orders/${order.id}` }));
  }
  await db.batch(after);
  return { id: order.id, status: to, order_number: order.order_number };
}

/** Full order view. `forRetailer` scopes to that retailer and strips wholesaler-only fields. */
export async function orderDetail(db: D1Database, businessId: string, orderId: string, forRetailer?: string) {
  const order = await db
    .prepare(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.subtotal_paise, o.tax_paise, o.discount_paise, o.delivery_paise, o.total_paise,
              o.amount_paid_paise, o.retailer_note, o.internal_note, o.source, o.created_at, o.updated_at, o.retailer_id,
              r.business_name AS retailer_name, r.contact_person AS retailer_contact, r.phone AS retailer_phone, r.address AS retailer_address,
              r.city AS retailer_city, r.state AS retailer_state, r.gstin AS retailer_gstin
       FROM orders o JOIN retailer_profiles r ON r.id = o.retailer_id WHERE o.id = ? AND o.business_id = ?`,
    )
    .bind(orderId, businessId)
    .first<any>();
  if (!order || (forRetailer && order.retailer_id !== forRetailer)) throw notFound("Order");
  const [items, history, payments] = await db.batch([
    db.prepare(
      `SELECT id, product_id, product_name, sku, unit, unit_price_paise, quantity, line_subtotal_paise, gst_rate_bp, gst_amount_paise
       FROM order_items WHERE order_id = ? ORDER BY product_name`,
    ).bind(orderId),
    db.prepare(
      `SELECT h.id, h.from_status, h.to_status, h.actor_role, h.note, h.created_at, u.name AS actor_name
       FROM order_status_history h JOIN users u ON u.id = h.actor_user_id WHERE h.order_id = ? ORDER BY h.created_at, h.rowid`,
    ).bind(orderId),
    db.prepare(
      `SELECT p.id, p.payment_date, p.method, p.reference, p.status, a.amount_paise
       FROM payment_allocations a JOIN payments p ON p.id = a.payment_id WHERE a.order_id = ? ORDER BY p.created_at`,
    ).bind(orderId),
  ]);
  if (forRetailer) delete order.internal_note;
  return { ...order, items: items.results, history: history.results, payments: payments.results };
}

/** Purchases, payments and what is still owed for one retailer. Void orders are excluded throughout. */
export async function retailerLedger(db: D1Database, businessId: string, retailerId: string) {
  const [totals, open, payments] = await db.batch([
    db.prepare(
      `SELECT COUNT(*) AS order_count, COALESCE(SUM(total_paise),0) AS total_purchases_paise, COALESCE(SUM(amount_paid_paise),0) AS total_paid_paise,
              COALESCE(SUM(total_paise - amount_paid_paise),0) AS outstanding_paise
       FROM orders WHERE business_id = ? AND retailer_id = ? AND ${NOT_VOID}`,
    ).bind(businessId, retailerId),
    db.prepare(
      `SELECT id, order_number, status, payment_status, total_paise, amount_paid_paise, total_paise - amount_paid_paise AS outstanding_paise, created_at
       FROM orders WHERE business_id = ? AND retailer_id = ? AND ${NOT_VOID} AND total_paise > amount_paid_paise ORDER BY created_at`,
    ).bind(businessId, retailerId),
    db.prepare(
      `SELECT p.id, p.payment_date, p.amount_paise, p.method, p.reference, p.notes, p.status, p.created_at,
              (SELECT group_concat(o.order_number, ', ') FROM payment_allocations a JOIN orders o ON o.id = a.order_id WHERE a.payment_id = p.id) AS order_numbers,
              adj.reason AS reversal_reason, adj.created_at AS reversed_at
       FROM payments p LEFT JOIN payment_adjustments adj ON adj.payment_id = p.id
       WHERE p.business_id = ? AND p.retailer_id = ? ORDER BY p.created_at DESC LIMIT 200`,
    ).bind(businessId, retailerId),
  ]);
  return { totals: totals.results[0], openOrders: open.results, payments: payments.results };
}
