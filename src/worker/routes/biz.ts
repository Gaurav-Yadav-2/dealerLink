import { Hono } from "hono";
import { businessSettingsSchema } from "../../shared/schemas";
import { BUSINESS_COLS, ownerCtx, ownerOnly } from "../lib/auth";
import { body, conflict, istDate, istDateSql, now, ok, type AppEnv } from "../lib/http";
import { auditStmt, isConstraintError } from "../lib/util";
import { featureOn } from "../lib/features";

export const bizRoutes = new Hono<AppEnv>();
bizRoutes.use("*", ownerOnly);

const NOT_VOID = "status NOT IN ('rejected','cancelled')";

/** Everything on the dashboard is computed from live rows; there are no hardcoded figures anywhere. */
bizRoutes.get("/dashboard", async (c) => {
  const { business } = ownerCtx(c);
  const db = c.env.DB;
  const bid = business.id;
  const today = istDate(new Date());
  const monthStart = today.slice(0, 7) + "-01";
  const d14 = istDate(new Date(Date.now() - 13 * 86400000));
  const d30 = istDate(new Date(Date.now() - 29 * 86400000));
  const m6 = istDate(new Date(Date.now() - 160 * 86400000)).slice(0, 7) + "-01";
  const od = istDateSql("created_at");

  const [kpi, daily, monthly, top, statuses, latest, awaiting, retailers, payments] = await db.batch([
    db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM retailer_profiles WHERE business_id = ?1 AND status = 'active') AS total_retailers,
        (SELECT COUNT(*) FROM products WHERE business_id = ?1 AND archived_at IS NULL) AS total_products,
        (SELECT COUNT(*) FROM orders WHERE business_id = ?1 AND ${od} = ?2) AS orders_today,
        (SELECT COUNT(*) FROM orders WHERE business_id = ?1 AND status = 'pending') AS pending_orders,
        (SELECT COALESCE(SUM(total_paise),0) FROM orders WHERE business_id = ?1 AND ${NOT_VOID} AND ${od} >= ?3) AS monthly_sales_paise,
        (SELECT COALESCE(SUM(total_paise - amount_paid_paise),0) FROM orders WHERE business_id = ?1 AND ${NOT_VOID}) AS outstanding_paise`,
    ).bind(bid, today, monthStart),
    db.prepare(
      `SELECT ${od} AS day, COUNT(*) AS orders, COALESCE(SUM(CASE WHEN ${NOT_VOID} THEN total_paise ELSE 0 END),0) AS sales_paise
       FROM orders WHERE business_id = ? AND ${od} >= ? GROUP BY day ORDER BY day`,
    ).bind(bid, d14),
    db.prepare(
      `SELECT substr(${od},1,7) AS month, COUNT(*) AS orders, COALESCE(SUM(total_paise),0) AS sales_paise
       FROM orders WHERE business_id = ? AND ${NOT_VOID} AND ${od} >= ? GROUP BY month ORDER BY month`,
    ).bind(bid, m6),
    db.prepare(
      `SELECT oi.product_id, oi.product_name, SUM(oi.quantity) AS quantity, SUM(oi.line_subtotal_paise) AS sales_paise
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.business_id = ? AND o.${NOT_VOID} AND ${istDateSql("o.created_at")} >= ?
       GROUP BY oi.product_id ORDER BY sales_paise DESC LIMIT 5`,
    ).bind(bid, d30),
    db.prepare("SELECT status, COUNT(*) AS count FROM orders WHERE business_id = ? GROUP BY status").bind(bid),
    db.prepare(
      `SELECT o.id, o.order_number, o.status, o.payment_status, o.total_paise, o.created_at, r.business_name AS retailer_name
       FROM orders o JOIN retailer_profiles r ON r.id = o.retailer_id WHERE o.business_id = ? ORDER BY o.created_at DESC LIMIT 6`,
    ).bind(bid),
    db.prepare(
      `SELECT o.id, o.order_number, o.total_paise, o.created_at, r.business_name AS retailer_name
       FROM orders o JOIN retailer_profiles r ON r.id = o.retailer_id WHERE o.business_id = ? AND o.status = 'pending' ORDER BY o.created_at LIMIT 6`,
    ).bind(bid),
    db.prepare(
      "SELECT id, business_name, city, registered_at FROM retailer_profiles WHERE business_id = ? AND registered_at IS NOT NULL ORDER BY registered_at DESC LIMIT 5",
    ).bind(bid),
    db.prepare(
      `SELECT p.id, p.amount_paise, p.method, p.payment_date, p.created_at, r.business_name AS retailer_name, r.id AS retailer_id
       FROM payments p JOIN retailer_profiles r ON r.id = p.retailer_id WHERE p.business_id = ? AND p.status = 'recorded' ORDER BY p.created_at DESC LIMIT 5`,
    ).bind(bid),
  ]);

  // Fill the 14-day series so days with no orders show as zero rather than disappearing.
  const byDay = new Map((daily.results as any[]).map((r) => [r.day, r]));
  const ordersOverTime = Array.from({ length: 14 }, (_, i) => {
    const day = istDate(new Date(Date.now() - (13 - i) * 86400000));
    const r = byDay.get(day);
    return { day, orders: r?.orders ?? 0, sales_paise: r?.sales_paise ?? 0 };
  });

  return ok(c, {
    kpis: kpi.results[0],
    ordersOverTime,
    monthlySales: monthly.results,
    topProducts: top.results,
    statusDistribution: statuses.results,
    latestOrders: latest.results,
    awaitingApproval: awaiting.results,
    newRetailers: retailers.results,
    recentPayments: payments.results,
  });
});

bizRoutes.get("/settings", (c) => ok(c, ownerCtx(c).business));

bizRoutes.patch("/settings", async (c) => {
  const { business, user } = ownerCtx(c);
  const input = await body(c, businessSettingsSchema);
  const db = c.env.DB;
  try {
    await db.batch([
      db.prepare(
        `UPDATE businesses SET name = ?, phone = ?, email = ?, address = ?, city = ?, state = ?, gstin = ?, about = ?,
           track_inventory = ?, low_stock_threshold = ?, gst_enabled = CASE WHEN ? = 1 THEN ? ELSE gst_enabled END,
           order_prefix = ?, updated_at = ? WHERE id = ?`,
      ).bind(
        input.name, input.phone ?? null, input.email ?? null, input.address ?? null, input.city ?? null, input.state ?? null,
        input.gstin ?? null, input.about ?? null, input.trackInventory ? 1 : 0, input.lowStockThreshold,
        // while GST is switched off by the admin, keep the wholesaler's own GST choice untouched for when it returns
        featureOn(c, "gst") ? 1 : 0, input.gstEnabled ? 1 : 0,
        input.orderPrefix, now(), business.id,
      ),
      auditStmt(db, { businessId: business.id, actorId: user.id, action: "business.settings_updated", entityType: "business", entityId: business.id }),
    ]);
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict("Another business already uses this name.");
    throw e;
  }
  const fresh = await db.prepare(`SELECT ${BUSINESS_COLS} FROM businesses b WHERE b.id = ?`).bind(business.id).first();
  return ok(c, fresh);
});

bizRoutes.get("/audit-log", async (c) => {
  const { business } = ownerCtx(c);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at, u.name AS actor_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.business_id = ? ORDER BY a.created_at DESC LIMIT 50`,
  ).bind(business.id).all();
  return ok(c, results);
});
