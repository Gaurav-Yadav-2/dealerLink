import { Hono } from "hono";
import { adminStatusSchema } from "../../shared/schemas";
import { adminCtx, adminOnly, requireAuth } from "../lib/auth";
import { body, conflict, forbidden, istDate, istDateSql, like, notFound, now, ok, pageParams, type AppEnv } from "../lib/http";
import { auditStmt, rateLimit } from "../lib/util";
import { issueResetToken } from "./auth";

/** Platform administration. Kept entirely separate from the tenant (/api/biz) API. */
export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", adminOnly);

adminRoutes.get("/stats", async (c) => {
  const db = c.env.DB;
  const d30 = istDate(new Date(Date.now() - 29 * 86400000));
  const started = Date.now();
  const [counts, recent, signups] = await db.batch([
    db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM businesses) AS businesses,
        (SELECT COUNT(*) FROM businesses WHERE status = 'suspended') AS suspended_businesses,
        (SELECT COUNT(*) FROM users WHERE role = 'owner') AS owners,
        (SELECT COUNT(*) FROM users WHERE role = 'retailer') AS retailers,
        (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspended_users,
        (SELECT COUNT(*) FROM products WHERE archived_at IS NULL) AS products,
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COUNT(*) FROM orders WHERE ${istDateSql("created_at")} >= ?1) AS orders_30d,
        (SELECT COALESCE(SUM(total_paise),0) FROM orders WHERE status NOT IN ('rejected','cancelled') AND ${istDateSql("created_at")} >= ?1) AS order_value_30d_paise,
        (SELECT COUNT(*) FROM sessions WHERE expires_at > ?2) AS active_sessions`,
    ).bind(d30, now()),
    db.prepare(
      `SELECT b.id, b.name, b.city, b.status, b.created_at, u.name AS owner_name FROM businesses b JOIN users u ON u.id = b.owner_user_id ORDER BY b.created_at DESC LIMIT 5`,
    ),
    db.prepare(`SELECT ${istDateSql("created_at")} AS day, COUNT(*) AS businesses FROM businesses WHERE ${istDateSql("created_at")} >= ? GROUP BY day ORDER BY day`).bind(d30),
  ]);
  return ok(c, {
    counts: counts.results[0],
    recentBusinesses: recent.results,
    signups: signups.results,
    health: { database: "ok", query_ms: Date.now() - started, checked_at: now() },
  });
});

adminRoutes.get("/businesses", async (c) => {
  const { page, pageSize, offset } = pageParams(c);
  const where = ["1=1"];
  const params: unknown[] = [];
  const status = c.req.query("status");
  if (status === "active" || status === "suspended") {
    where.push("b.status = ?");
    params.push(status);
  }
  const q = c.req.query("q")?.trim();
  if (q) {
    where.push("(b.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')");
    params.push(like(q), like(q), like(q));
  }
  const w = where.join(" AND ");
  const from = "FROM businesses b JOIN users u ON u.id = b.owner_user_id";
  const db = c.env.DB;
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${w}`).bind(...params),
    db.prepare(
      `SELECT b.id, b.name, b.slug, b.city, b.state, b.status, b.suspension_reason, b.created_at, u.name AS owner_name, u.email AS owner_email, u.is_demo,
              (SELECT COUNT(*) FROM retailer_profiles r WHERE r.business_id = b.id) AS retailer_count,
              (SELECT COUNT(*) FROM products p WHERE p.business_id = b.id AND p.archived_at IS NULL) AS product_count,
              (SELECT COUNT(*) FROM orders o WHERE o.business_id = b.id) AS order_count,
              (SELECT MAX(o.created_at) FROM orders o WHERE o.business_id = b.id) AS last_order_at
       ${from} WHERE ${w} ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...params, pageSize, offset),
  ]);
  return ok(c, rows.results, { page, pageSize, total: (count.results[0] as any).n });
});

adminRoutes.post("/businesses/:id/status", async (c) => {
  const admin = adminCtx(c);
  const input = await body(c, adminStatusSchema);
  const db = c.env.DB;
  const id = c.req.param("id");
  const res = await db.batch([
    db.prepare("UPDATE businesses SET status = ?, suspension_reason = ?, updated_at = ? WHERE id = ?").bind(input.status, input.status === "suspended" ? input.reason ?? null : null, now(), id),
    auditStmt(db, { businessId: id, actorId: admin.user.id, action: `admin.business_${input.status === "suspended" ? "suspended" : "activated"}`, entityType: "business", entityId: id, metadata: { reason: input.reason ?? null } }),
  ]);
  if (!res[0].meta.changes) throw notFound("Business");
  return ok(c, { id, status: input.status });
});

adminRoutes.get("/users", async (c) => {
  const { page, pageSize, offset } = pageParams(c);
  const where = ["1=1"];
  const params: unknown[] = [];
  const role = c.req.query("role");
  if (role === "owner" || role === "retailer" || role === "admin") {
    where.push("u.role = ?");
    params.push(role);
  }
  const status = c.req.query("status");
  if (status === "active" || status === "suspended") {
    where.push("u.status = ?");
    params.push(status);
  }
  const q = c.req.query("q")?.trim();
  if (q) {
    where.push("(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
    params.push(like(q), like(q));
  }
  const w = where.join(" AND ");
  const db = c.env.DB;
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${w}`).bind(...params),
    db.prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.is_demo, u.last_login_at, u.created_at,
              COALESCE(
                (SELECT b.name FROM business_members m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = u.id),
                (SELECT b.name FROM retailer_profiles r JOIN businesses b ON b.id = r.business_id WHERE r.user_id = u.id)
              ) AS business_name
       FROM users u WHERE ${w} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...params, pageSize, offset),
  ]);
  return ok(c, rows.results, { page, pageSize, total: (count.results[0] as any).n });
});

adminRoutes.post("/users/:id/status", async (c) => {
  const admin = adminCtx(c);
  const input = await body(c, adminStatusSchema);
  const db = c.env.DB;
  const id = c.req.param("id");
  const target = await db.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first<{ id: string; role: string }>();
  if (!target) throw notFound("User");
  if (target.id === admin.user.id) throw conflict("You cannot change your own account status.");
  if (target.role === "admin") throw forbidden("Administrator accounts cannot be suspended from the panel.");
  const stmts = [
    db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").bind(input.status, now(), id),
    auditStmt(db, { businessId: null, actorId: admin.user.id, action: `admin.user_${input.status === "suspended" ? "suspended" : "activated"}`, entityType: "user", entityId: id, metadata: { reason: input.reason ?? null } }),
  ];
  if (input.status === "suspended") stmts.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  await db.batch(stmts);
  return ok(c, { id, status: input.status });
});

adminRoutes.post("/users/:id/reset-link", async (c) => {
  const admin = requireAuth(c);
  await rateLimit(c, "admin-reset-link", admin.user.id, 30, 3600);
  const db = c.env.DB;
  const target = await db.prepare("SELECT id, role FROM users WHERE id = ?").bind(c.req.param("id")).first<{ id: string; role: string }>();
  if (!target) throw notFound("User");
  if (target.role === "admin" && target.id !== admin.user.id) throw forbidden("You cannot reset another administrator's password.");
  const token = await issueResetToken(db, target.id, admin.user.id);
  await auditStmt(db, { businessId: null, actorId: admin.user.id, action: "admin.reset_link_created", entityType: "user", entityId: target.id }).run();
  return ok(c, { token }, undefined, 201);
});

/** Recent sensitive activity across the platform, for abuse review. */
adminRoutes.get("/audit", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.entity_type, a.created_at, u.name AS actor_name, u.email AS actor_email, b.name AS business_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id LEFT JOIN businesses b ON b.id = a.business_id
     ORDER BY a.created_at DESC LIMIT 60`,
  ).all();
  return ok(c, results);
});
