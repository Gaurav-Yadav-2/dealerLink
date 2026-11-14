import { Hono } from "hono";
import { PAYMENT_METHODS } from "../../shared/constants";
import { paymentSchema, reversalSchema } from "../../shared/schemas";
import { ownerCtx, ownerOnly } from "../lib/auth";
import { body, conflict, invalid, istDate, like, notFound, now, ok, pageParams, uuid, type AppEnv } from "../lib/http";
import { NOT_VOID } from "../lib/orders";
import { auditStmt, inr, isConstraintError, notifyStmt } from "../lib/util";
import { getRetailer } from "./retailers";
import { requireFeature } from "../lib/features";

export const paymentRoutes = new Hono<AppEnv>();
paymentRoutes.use("*", ownerOnly);

/** New payment_status for an order after its paid amount changes by `delta` (SQLite evaluates SET against the old row). */
const payStatusSql = (deltaPlaceholder: string) =>
  `CASE WHEN amount_paid_paise + ${deltaPlaceholder} >= total_paise THEN 'paid' WHEN amount_paid_paise + ${deltaPlaceholder} > 0 THEN 'partial' ELSE 'unpaid' END`;

paymentRoutes.get("/payments", async (c) => {
  const { business } = ownerCtx(c);
  const { page, pageSize, offset } = pageParams(c);
  const where = ["p.business_id = ?"];
  const params: unknown[] = [business.id];
  const retailerId = c.req.query("retailerId");
  if (retailerId) {
    where.push("p.retailer_id = ?");
    params.push(retailerId);
  }
  const method = c.req.query("method");
  if (method && (PAYMENT_METHODS as readonly string[]).includes(method)) {
    where.push("p.method = ?");
    params.push(method);
  }
  const status = c.req.query("status");
  if (status === "recorded" || status === "reversed") {
    where.push("p.status = ?");
    params.push(status);
  }
  const q = c.req.query("q")?.trim();
  if (q) {
    where.push("(p.reference LIKE ? ESCAPE '\\' OR r.business_name LIKE ? ESCAPE '\\')");
    params.push(like(q), like(q));
  }
  const w = where.join(" AND ");
  const from = "FROM payments p JOIN retailer_profiles r ON r.id = p.retailer_id";
  const db = c.env.DB;
  const [count, rows, summary] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${w}`).bind(...params),
    db.prepare(
      `SELECT p.id, p.retailer_id, r.business_name AS retailer_name, p.order_id, p.reference, p.payment_date, p.amount_paise, p.method, p.notes,
              p.status, p.created_at, u.name AS recorded_by_name,
              (SELECT group_concat(o.order_number, ', ') FROM payment_allocations a JOIN orders o ON o.id = a.order_id WHERE a.payment_id = p.id) AS order_numbers,
              adj.reason AS reversal_reason, adj.created_at AS reversed_at
       ${from} JOIN users u ON u.id = p.recorded_by LEFT JOIN payment_adjustments adj ON adj.payment_id = p.id
       WHERE ${w} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...params, pageSize, offset),
    db.prepare(
      `SELECT
         (SELECT COALESCE(SUM(amount_paise),0) FROM payments WHERE business_id = ?1 AND status = 'recorded') AS total_received_paise,
         (SELECT COALESCE(SUM(total_paise - amount_paid_paise),0) FROM orders WHERE business_id = ?1 AND ${NOT_VOID}) AS outstanding_paise,
         (SELECT COALESCE(SUM(amount_paise),0) FROM payments WHERE business_id = ?1 AND status = 'recorded' AND payment_date >= ?2) AS received_this_month_paise`,
    ).bind(business.id, istDate(new Date()).slice(0, 7) + "-01"),
  ]);
  return ok(c, rows.results, { page, pageSize, total: (count.results[0] as any).n, summary: summary.results[0] });
});

/**
 * Record a payment. Two modes:
 *   - against one order: amount must not exceed that order's outstanding balance
 *   - on account (no orderId): applied to the retailer's oldest unpaid orders first (FIFO)
 * Advance credit is not supported: a payment can never exceed what the retailer owes.
 */
paymentRoutes.post("/payments", async (c) => {
  const { business, user } = ownerCtx(c);
  const input = await body(c, paymentSchema);
  if (!input.orderId) requireFeature(c, "onAccountPayments");
  const db = c.env.DB;
  const retailer = await getRetailer(db, business.id, input.retailerId);
  if (input.paymentDate > istDate(new Date())) throw invalid("paymentDate: Payment date cannot be in the future");

  type Open = { id: string; order_number: string; outstanding: number };
  let open: Open[];
  if (input.orderId) {
    const o = await db
      .prepare(`SELECT id, order_number, status, total_paise - amount_paid_paise AS outstanding FROM orders WHERE id = ? AND business_id = ? AND retailer_id = ?`)
      .bind(input.orderId, business.id, retailer.id)
      .first<Open & { status: string }>();
    if (!o) throw notFound("Order");
    if (o.status === "rejected" || o.status === "cancelled") throw conflict("Payments cannot be recorded against a rejected or cancelled order.");
    open = [o];
  } else {
    const { results } = await db
      .prepare(`SELECT id, order_number, total_paise - amount_paid_paise AS outstanding FROM orders WHERE business_id = ? AND retailer_id = ? AND ${NOT_VOID} AND total_paise > amount_paid_paise ORDER BY created_at, rowid`)
      .bind(business.id, retailer.id)
      .all<Open>();
    open = results;
  }
  const outstanding = open.reduce((s, o) => s + o.outstanding, 0);
  if (input.amountPaise > outstanding) {
    throw invalid(
      outstanding === 0
        ? "Nothing is outstanding here, so there is nothing to record a payment against."
        : `Amount exceeds the outstanding balance of ${inr(outstanding)}. Advance payments are not supported.`,
      [{ path: "amountPaise", message: `Maximum ${inr(outstanding)}` }],
    );
  }

  const paymentId = uuid();
  const ts = now();
  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO payments (id, business_id, retailer_id, order_id, reference, payment_date, amount_paise, method, notes, recorded_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(paymentId, business.id, retailer.id, input.orderId ?? null, input.reference ?? null, input.paymentDate, input.amountPaise, input.method, input.notes ?? null, user.id, ts),
  ];
  let remaining = input.amountPaise;
  const applied: { orderNumber: string; amountPaise: number }[] = [];
  for (const o of open) {
    if (remaining <= 0) break;
    const amt = Math.min(remaining, o.outstanding);
    remaining -= amt;
    applied.push({ orderNumber: o.order_number, amountPaise: amt });
    stmts.push(
      db.prepare("INSERT INTO payment_allocations (id, payment_id, order_id, business_id, amount_paise, created_at) VALUES (?,?,?,?,?,?)").bind(uuid(), paymentId, o.id, business.id, amt, ts),
      // CHECK (amount_paid_paise <= total_paise) rejects the whole batch if another payment landed first
      db.prepare(`UPDATE orders SET payment_status = ${payStatusSql("?")}, amount_paid_paise = amount_paid_paise + ?, updated_at = ? WHERE id = ? AND business_id = ? AND ${NOT_VOID}`)
        .bind(amt, amt, amt, ts, o.id, business.id),
    );
  }
  stmts.push(auditStmt(db, { businessId: business.id, actorId: user.id, action: "payment.recorded", entityType: "payment", entityId: paymentId, metadata: { amountPaise: input.amountPaise, method: input.method, retailerId: retailer.id } }));
  if (retailer.user_id) {
    stmts.push(notifyStmt(db, { userId: retailer.user_id, businessId: business.id, type: "payment_recorded", title: `Payment of ${inr(input.amountPaise)} recorded`, body: `Applied to ${applied.map((a) => a.orderNumber).join(", ")}.`, link: "/retailer/payments" }));
  }
  let res: D1Result[];
  try {
    res = await db.batch(stmts);
  } catch (e) {
    if (isConstraintError(e, "CHECK")) throw conflict("The outstanding balance changed while recording this payment. Refresh and try again.");
    throw e;
  }
  // every order UPDATE must have applied (an order could have been cancelled in between)
  const orderUpdates = res.filter((_, i) => i > 0 && i <= applied.length * 2 && i % 2 === 0);
  if (orderUpdates.some((r) => !r.meta.changes)) {
    await reverse(db, business.id, paymentId, user.id, "Automatic reversal: an order changed while the payment was being recorded");
    throw conflict("An order changed while recording this payment. Nothing was applied — please try again.");
  }
  return ok(c, { id: paymentId, amount_paise: input.amountPaise, applied }, undefined, 201);
});

/** Reverses a payment by writing an adjustment record and undoing its allocations. The payment row is kept. */
async function reverse(db: D1Database, businessId: string, paymentId: string, actorId: string, reason: string) {
  const payment = await db.prepare("SELECT id, amount_paise, status, retailer_id FROM payments WHERE id = ? AND business_id = ?").bind(paymentId, businessId)
    .first<{ id: string; amount_paise: number; status: string; retailer_id: string }>();
  if (!payment) throw notFound("Payment");
  if (payment.status !== "recorded") throw conflict("This payment has already been reversed.");
  const { results: allocs } = await db.prepare("SELECT order_id, amount_paise FROM payment_allocations WHERE payment_id = ?").bind(paymentId).all<{ order_id: string; amount_paise: number }>();
  const ts = now();
  const stmts: D1PreparedStatement[] = [
    // payment_id is UNIQUE here, so a concurrent second reversal fails and rolls back its batch
    db.prepare("INSERT INTO payment_adjustments (id, business_id, payment_id, type, amount_paise, reason, created_by, created_at) VALUES (?,?,?,'reversal',?,?,?,?)")
      .bind(uuid(), businessId, paymentId, payment.amount_paise, reason, actorId, ts),
    db.prepare("UPDATE payments SET status = 'reversed' WHERE id = ? AND business_id = ?").bind(paymentId, businessId),
  ];
  for (const a of allocs) {
    stmts.push(
      // only undo allocations whose order update actually applied (amount_paid never goes below zero thanks to the CHECK)
      db.prepare(`UPDATE orders SET payment_status = ${payStatusSql("-?")}, amount_paid_paise = amount_paid_paise - ?, updated_at = ? WHERE id = ? AND business_id = ? AND amount_paid_paise >= ?`)
        .bind(a.amount_paise, a.amount_paise, a.amount_paise, ts, a.order_id, businessId, a.amount_paise),
    );
  }
  stmts.push(auditStmt(db, { businessId, actorId, action: "payment.reversed", entityType: "payment", entityId: paymentId, metadata: { amountPaise: payment.amount_paise, reason } }));
  try {
    await db.batch(stmts);
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict("This payment has already been reversed.");
    throw e;
  }
  return payment;
}

paymentRoutes.post("/payments/:id/reverse", async (c) => {
  const { business, user } = ownerCtx(c);
  const input = await body(c, reversalSchema);
  const payment = await reverse(c.env.DB, business.id, c.req.param("id"), user.id, input.reason);
  return ok(c, { id: payment.id, status: "reversed" });
});
