import { Hono } from "hono";
import { ownerCtx, ownerOnly } from "../lib/auth";
import { dateRange, istDateSql, ok, type AppEnv } from "../lib/http";
import { NOT_VOID } from "../lib/orders";

export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use("*", ownerOnly);

const day = istDateSql("o.created_at");
const PERIODS: Record<string, string> = {
  day,
  // Monday of the week the order falls in
  week: `date(${day}, 'weekday 0', '-6 days')`,
  month: `substr(${day}, 1, 7)`,
};

/** Headline numbers for the selected range. */
reportRoutes.get("/reports/summary", async (c) => {
  const { business } = ownerCtx(c);
  const { from, to } = dateRange(c);
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS orders,
            SUM(CASE WHEN o.${NOT_VOID} THEN 1 ELSE 0 END) AS valid_orders,
            COALESCE(SUM(CASE WHEN o.${NOT_VOID} THEN o.total_paise ELSE 0 END),0) AS sales_paise,
            COALESCE(SUM(CASE WHEN o.${NOT_VOID} THEN o.amount_paid_paise ELSE 0 END),0) AS collected_paise,
            SUM(CASE WHEN o.status IN ('cancelled','rejected') THEN 1 ELSE 0 END) AS cancelled_orders,
            COUNT(DISTINCT CASE WHEN o.${NOT_VOID} THEN o.retailer_id END) AS active_retailers
     FROM orders o WHERE o.business_id = ? AND ${day} BETWEEN ? AND ?`,
  ).bind(business.id, from, to).first();
  return ok(c, { ...row, from, to });
});

reportRoutes.get("/reports/orders", async (c) => {
  const { business } = ownerCtx(c);
  const { from, to } = dateRange(c);
  const group = c.req.query("group") ?? "day";
  const period = PERIODS[group] ?? PERIODS.day;
  const { results } = await c.env.DB.prepare(
    `SELECT ${period} AS period, COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN o.${NOT_VOID} THEN o.total_paise ELSE 0 END),0) AS sales_paise,
            SUM(CASE WHEN o.status IN ('cancelled','rejected') THEN 1 ELSE 0 END) AS cancelled_orders,
            SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END) AS delivered_orders
     FROM orders o WHERE o.business_id = ? AND ${day} BETWEEN ? AND ? GROUP BY period ORDER BY period`,
  ).bind(business.id, from, to).all();
  return ok(c, results, { from, to, group: PERIODS[group] ? group : "day" });
});

reportRoutes.get("/reports/sales-by-retailer", async (c) => {
  const { business } = ownerCtx(c);
  const { from, to } = dateRange(c);
  const { results } = await c.env.DB.prepare(
    `SELECT r.id AS retailer_id, r.business_name AS retailer_name, r.city, COUNT(*) AS orders, SUM(o.total_paise) AS sales_paise,
            SUM(o.amount_paid_paise) AS paid_paise, SUM(o.total_paise - o.amount_paid_paise) AS outstanding_paise
     FROM orders o JOIN retailer_profiles r ON r.id = o.retailer_id
     WHERE o.business_id = ? AND o.${NOT_VOID} AND ${day} BETWEEN ? AND ?
     GROUP BY r.id ORDER BY sales_paise DESC LIMIT 1000`,
  ).bind(business.id, from, to).all();
  return ok(c, results, { from, to });
});

reportRoutes.get("/reports/sales-by-product", async (c) => {
  const { business } = ownerCtx(c);
  const { from, to } = dateRange(c);
  const { results } = await c.env.DB.prepare(
    `SELECT oi.product_id, oi.product_name, oi.sku, oi.unit, SUM(oi.quantity) AS quantity, COUNT(DISTINCT o.id) AS orders,
            SUM(oi.line_subtotal_paise) AS sales_paise
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.business_id = ? AND o.${NOT_VOID} AND ${day} BETWEEN ? AND ?
     GROUP BY oi.product_id ORDER BY sales_paise DESC LIMIT 1000`,
  ).bind(business.id, from, to).all();
  return ok(c, results, { from, to });
});

/** Who owes what right now. Not date-ranged: a balance is a point-in-time fact. */
reportRoutes.get("/reports/outstanding", async (c) => {
  const { business } = ownerCtx(c);
  const { results } = await c.env.DB.prepare(
    `SELECT r.id AS retailer_id, r.business_name AS retailer_name, r.contact_person, r.phone, r.city,
            COUNT(*) AS open_orders, SUM(o.total_paise - o.amount_paid_paise) AS outstanding_paise, MIN(${day}) AS oldest_unpaid_date
     FROM orders o JOIN retailer_profiles r ON r.id = o.retailer_id
     WHERE o.business_id = ? AND o.${NOT_VOID} AND o.total_paise > o.amount_paid_paise
     GROUP BY r.id ORDER BY outstanding_paise DESC LIMIT 1000`,
  ).bind(business.id).all();
  return ok(c, results);
});

reportRoutes.get("/reports/cancelled", async (c) => {
  const { business } = ownerCtx(c);
  const { from, to } = dateRange(c);
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.order_number, o.status, o.total_paise, ${day} AS order_date, r.business_name AS retailer_name,
            (SELECT h.actor_role FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = o.status ORDER BY h.created_at DESC LIMIT 1) AS cancelled_by,
            (SELECT h.note FROM order_status_history h WHERE h.order_id = o.id AND h.to_status = o.status ORDER BY h.created_at DESC LIMIT 1) AS reason
     FROM orders o JOIN retailer_profiles r ON r.id = o.retailer_id
     WHERE o.business_id = ? AND o.status IN ('cancelled','rejected') AND ${day} BETWEEN ? AND ?
     ORDER BY o.created_at DESC LIMIT 1000`,
  ).bind(business.id, from, to).all();
  return ok(c, results, { from, to });
});
