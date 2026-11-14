import { Hono } from "hono";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "../../shared/constants";
import { manualOrderSchema, orderPatchSchema, orderStatusSchema } from "../../shared/schemas";
import { ownerCtx, ownerOnly } from "../lib/auth";
import { body, conflict, invalid, istDateSql, like, notFound, now, ok, pageParams, type AppEnv } from "../lib/http";
import { changeOrderStatus, createOrder, orderDetail } from "../lib/orders";
import { auditStmt, isConstraintError } from "../lib/util";
import { getRetailer } from "./retailers";
import { featureOn, requireFeature } from "../lib/features";

export const orderRoutes = new Hono<AppEnv>();
orderRoutes.use("*", ownerOnly);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

orderRoutes.get("/orders", async (c) => {
  const { business } = ownerCtx(c);
  const { page, pageSize, offset } = pageParams(c);
  const where = ["o.business_id = ?"];
  const params: unknown[] = [business.id];
  const status = c.req.query("status");
  if (status && (ORDER_STATUSES as readonly string[]).includes(status)) {
    where.push("o.status = ?");
    params.push(status);
  }
  const pay = c.req.query("paymentStatus");
  if (pay && (PAYMENT_STATUSES as readonly string[]).includes(pay)) {
    where.push("o.payment_status = ? AND o.status NOT IN ('rejected','cancelled')");
    params.push(pay);
  }
  const retailerId = c.req.query("retailerId");
  if (retailerId) {
    where.push("o.retailer_id = ?");
    params.push(retailerId);
  }
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (from && DATE_RE.test(from)) {
    where.push(`${istDateSql("o.created_at")} >= ?`);
    params.push(from);
  }
  if (to && DATE_RE.test(to)) {
    where.push(`${istDateSql("o.created_at")} <= ?`);
    params.push(to);
  }
  const q = c.req.query("q")?.trim();
  if (q) {
    where.push("(o.order_number LIKE ? ESCAPE '\\' OR r.business_name LIKE ? ESCAPE '\\')");
    params.push(like(q.replace(/^#/, "")), like(q));
  }
  const w = where.join(" AND ");
  const from_ = "FROM orders o JOIN retailer_profiles r ON r.id = o.retailer_id";
  const db = c.env.DB;
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n ${from_} WHERE ${w}`).bind(...params),
    db.prepare(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.total_paise, o.amount_paid_paise, o.source, o.created_at,
              o.retailer_id, r.business_name AS retailer_name,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
       ${from_} WHERE ${w} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...params, pageSize, offset),
  ]);
  return ok(c, rows.results, { page, pageSize, total: (count.results[0] as any).n });
});

/** Wholesaler creates an order on a retailer's behalf (e.g. taken over the phone). Prices still come from the resolver. */
orderRoutes.post("/orders", async (c) => {
  const { business, user } = ownerCtx(c);
  requireFeature(c, "manualOrders");
  const input = await body(c, manualOrderSchema);
  const retailer = await getRetailer(c.env.DB, business.id, input.retailerId);
  if (retailer.status !== "active") throw conflict("This retailer is inactive. Activate them before creating an order.");
  const order = await createOrder(c.env.DB, {
    business, retailerId: retailer.id, retailerName: retailer.business_name, retailerUserId: retailer.user_id,
    lines: input.items, note: input.note, actor: user, source: "owner", discountPaise: input.discountPaise, deliveryPaise: input.deliveryPaise,
    useSpecialPrices: featureOn(c, "retailerPricing"),
  });
  return ok(c, order, undefined, 201);
});

orderRoutes.get("/orders/:id", async (c) => {
  const { business } = ownerCtx(c);
  return ok(c, await orderDetail(c.env.DB, business.id, c.req.param("id")));
});

orderRoutes.post("/orders/:id/status", async (c) => {
  const { business, user } = ownerCtx(c);
  const input = await body(c, orderStatusSchema);
  return ok(c, await changeOrderStatus(c.env.DB, { business, orderId: c.req.param("id"), to: input.status, actor: user, note: input.note }));
});

/** Internal notes and order-level charges (discount / delivery). */
orderRoutes.patch("/orders/:id", async (c) => {
  const { business, user } = ownerCtx(c);
  const db = c.env.DB;
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => ({}));
  const input = await body(c, orderPatchSchema);
  const order = await db.prepare("SELECT status, subtotal_paise, tax_paise, discount_paise, delivery_paise, amount_paid_paise FROM orders WHERE id = ? AND business_id = ?")
    .bind(id, business.id).first<any>();
  if (!order) throw notFound("Order");

  const sets: string[] = [];
  const params: unknown[] = [];
  if ("internalNote" in raw) {
    sets.push("internal_note = ?");
    params.push(input.internalNote ?? null);
  }
  if (input.discountPaise != null || input.deliveryPaise != null) {
    if (["rejected", "cancelled", "delivered"].includes(order.status)) throw conflict("Charges can no longer be changed on this order.");
    const discount = input.discountPaise ?? order.discount_paise;
    const delivery = input.deliveryPaise ?? order.delivery_paise;
    const gross = order.subtotal_paise + order.tax_paise + delivery;
    if (discount > gross) throw invalid("Discount cannot be more than the order value");
    const total = gross - discount;
    if (total < order.amount_paid_paise) throw conflict("The new total would be less than what has already been paid on this order.");
    sets.push("discount_paise = ?", "delivery_paise = ?", "total_paise = ?", "payment_status = CASE WHEN amount_paid_paise >= ? THEN 'paid' WHEN amount_paid_paise > 0 THEN 'partial' ELSE 'unpaid' END");
    params.push(discount, delivery, total, total);
  }
  if (!sets.length) throw invalid("Nothing to update");
  try {
    await db.batch([
      db.prepare(`UPDATE orders SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND business_id = ?`).bind(...params, now(), id, business.id),
      auditStmt(db, { businessId: business.id, actorId: user.id, action: "order.updated", entityType: "order", entityId: id, metadata: { discountPaise: input.discountPaise, deliveryPaise: input.deliveryPaise } }),
    ]);
  } catch (e) {
    if (isConstraintError(e, "CHECK")) throw conflict("A payment was recorded while you were editing. Refresh and try again.");
    throw e;
  }
  return ok(c, await orderDetail(db, business.id, id));
});
