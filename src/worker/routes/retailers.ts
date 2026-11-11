import { Hono } from "hono";
import { INVITATION_TTL_DAYS } from "../../shared/constants";
import { bulkPriceSchema, retailerPatchSchema, retailerPricesSchema, retailerSchema } from "../../shared/schemas";
import { ownerCtx, ownerOnly, RETAILER_COLS, type RetailerRow } from "../lib/auth";
import { randomToken, sha256Hex } from "../lib/crypto";
import { body, conflict, invalid, like, notFound, now, ok, pageParams, uuid, type AppEnv } from "../lib/http";
import { NOT_VOID, retailerLedger } from "../lib/orders";
import { auditStmt, isConstraintError, rateLimit } from "../lib/util";
import { issueResetToken } from "./auth";

export const retailerMgmtRoutes = new Hono<AppEnv>();
retailerMgmtRoutes.use("*", ownerOnly);

/** Loads a retailer only if it belongs to the caller's business; otherwise behaves as if it does not exist. */
export async function getRetailer(db: D1Database, businessId: string, id: string): Promise<RetailerRow> {
  const r = await db.prepare(`SELECT ${RETAILER_COLS} FROM retailer_profiles r WHERE r.id = ? AND r.business_id = ?`).bind(id, businessId).first<RetailerRow>();
  if (!r) throw notFound("Retailer");
  return r;
}

const INVITE_STATE = `CASE
    WHEN r.user_id IS NOT NULL THEN 'registered'
    WHEN EXISTS (SELECT 1 FROM retailer_invitations i WHERE i.retailer_id = r.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?) THEN 'invited'
    ELSE 'not_invited' END`;

retailerMgmtRoutes.get("/retailers", async (c) => {
  const { business } = ownerCtx(c);
  const { page, pageSize, offset } = pageParams(c);
  const where = ["r.business_id = ?"];
  const params: unknown[] = [business.id];
  const status = c.req.query("status");
  if (status === "active" || status === "inactive") {
    where.push("r.status = ?");
    params.push(status);
  }
  const q = c.req.query("q")?.trim();
  if (q) {
    where.push("(r.business_name LIKE ? ESCAPE '\\' OR r.contact_person LIKE ? ESCAPE '\\' OR r.phone LIKE ? ESCAPE '\\' OR r.city LIKE ? ESCAPE '\\')");
    params.push(like(q), like(q), like(q), like(q));
  }
  const w = where.join(" AND ");
  const db = c.env.DB;
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM retailer_profiles r WHERE ${w}`).bind(...params),
    db.prepare(
      `SELECT ${RETAILER_COLS}, ${INVITE_STATE} AS invite_state,
              (SELECT COUNT(*) FROM orders o WHERE o.retailer_id = r.id AND o.${NOT_VOID}) AS order_count,
              (SELECT COALESCE(SUM(o.total_paise),0) FROM orders o WHERE o.retailer_id = r.id AND o.${NOT_VOID}) AS total_purchases_paise,
              (SELECT COALESCE(SUM(o.total_paise - o.amount_paid_paise),0) FROM orders o WHERE o.retailer_id = r.id AND o.${NOT_VOID}) AS outstanding_paise
       FROM retailer_profiles r WHERE ${w} ORDER BY r.business_name COLLATE NOCASE LIMIT ? OFFSET ?`,
    ).bind(now(), ...params, pageSize, offset),
  ]);
  return ok(c, rows.results, { page, pageSize, total: (count.results[0] as any).n });
});

retailerMgmtRoutes.post("/retailers", async (c) => {
  const { business, user } = ownerCtx(c);
  const input = await body(c, retailerSchema);
  const db = c.env.DB;
  const id = uuid();
  const ts = now();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO retailer_profiles (id, business_id, business_name, contact_person, phone, email, address, city, state, gstin, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(id, business.id, input.businessName, input.contactPerson, input.phone, input.email ?? null, input.address ?? null, input.city ?? null, input.state ?? null, input.gstin ?? null, ts, ts),
      auditStmt(db, { businessId: business.id, actorId: user.id, action: "retailer.created", entityType: "retailer", entityId: id }),
    ]);
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict("You already have a retailer with this phone number.", [{ path: "phone", message: "Phone number already in use" }]);
    throw e;
  }
  return ok(c, await getRetailer(db, business.id, id), undefined, 201);
});

retailerMgmtRoutes.get("/retailers/:id", async (c) => {
  const { business } = ownerCtx(c);
  const db = c.env.DB;
  const retailer = await getRetailer(db, business.id, c.req.param("id"));
  const invitation = await db
    .prepare("SELECT id, expires_at, created_at FROM retailer_invitations WHERE retailer_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
    .bind(retailer.id, now())
    .first();
  const account = retailer.user_id
    ? await db.prepare("SELECT email, name, last_login_at FROM users WHERE id = ?").bind(retailer.user_id).first()
    : null;
  const ledger = await retailerLedger(db, business.id, retailer.id);
  const overrides = await db.prepare("SELECT COUNT(*) AS n FROM retailer_product_prices WHERE retailer_id = ? AND business_id = ?").bind(retailer.id, business.id).first<{ n: number }>();
  return ok(c, {
    ...retailer,
    invite_state: retailer.user_id ? "registered" : invitation ? "invited" : "not_invited",
    invitation,
    account,
    totals: ledger.totals,
    price_override_count: overrides?.n ?? 0,
  });
});

retailerMgmtRoutes.patch("/retailers/:id", async (c) => {
  const { business, user } = ownerCtx(c);
  const db = c.env.DB;
  const retailer = await getRetailer(db, business.id, c.req.param("id"));
  const raw = await c.req.json().catch(() => ({}));
  const input = await body(c, retailerPatchSchema);
  const cols: Record<string, string> = {
    businessName: "business_name", contactPerson: "contact_person", phone: "phone", email: "email", address: "address",
    city: "city", state: "state", gstin: "gstin", status: "status",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(cols)) {
    if (!(key in raw)) continue;
    sets.push(`${col} = ?`);
    params.push((input as any)[key] ?? null);
  }
  if (!sets.length) throw invalid("Nothing to update");
  const stmts = [
    db.prepare(`UPDATE retailer_profiles SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND business_id = ?`).bind(...params, now(), retailer.id, business.id),
    auditStmt(db, { businessId: business.id, actorId: user.id, action: input.status && input.status !== retailer.status ? `retailer.${input.status === "active" ? "activated" : "deactivated"}` : "retailer.updated", entityType: "retailer", entityId: retailer.id }),
  ];
  // Deactivating a retailer signs them out immediately.
  if (input.status === "inactive" && retailer.user_id) stmts.push(db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(retailer.user_id));
  try {
    await db.batch(stmts);
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict("You already have a retailer with this phone number.", [{ path: "phone", message: "Phone number already in use" }]);
    throw e;
  }
  return ok(c, await getRetailer(db, business.id, retailer.id));
});

// ── Invitations ───────────────────────────────────────────────────────

retailerMgmtRoutes.post("/retailers/:id/invite", async (c) => {
  const { business, user } = ownerCtx(c);
  await rateLimit(c, "invite-create", user.id, 60, 3600);
  const db = c.env.DB;
  const retailer = await getRetailer(db, business.id, c.req.param("id"));
  if (retailer.user_id) throw conflict("This retailer has already registered.");
  if (retailer.status !== "active") throw conflict("Activate this retailer before inviting them.");
  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86400000).toISOString();
  await db.batch([
    // only one live invitation per retailer: issuing a new link invalidates older ones
    db.prepare("UPDATE retailer_invitations SET revoked_at = ? WHERE retailer_id = ? AND accepted_at IS NULL AND revoked_at IS NULL").bind(now(), retailer.id),
    db.prepare("INSERT INTO retailer_invitations (id, business_id, retailer_id, token_hash, expires_at, created_by, created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(uuid(), business.id, retailer.id, await sha256Hex(token), expiresAt, user.id, now()),
    auditStmt(db, { businessId: business.id, actorId: user.id, action: "retailer.invited", entityType: "retailer", entityId: retailer.id }),
  ]);
  // The raw token is returned exactly once; only its hash is stored.
  return ok(c, { token, expiresAt }, undefined, 201);
});

retailerMgmtRoutes.delete("/retailers/:id/invite", async (c) => {
  const { business, user } = ownerCtx(c);
  const db = c.env.DB;
  const retailer = await getRetailer(db, business.id, c.req.param("id"));
  const res = await db.batch([
    db.prepare("UPDATE retailer_invitations SET revoked_at = ? WHERE retailer_id = ? AND business_id = ? AND accepted_at IS NULL AND revoked_at IS NULL").bind(now(), retailer.id, business.id),
    auditStmt(db, { businessId: business.id, actorId: user.id, action: "retailer.invitation_revoked", entityType: "retailer", entityId: retailer.id }),
  ]);
  return ok(c, { revoked: res[0].meta.changes });
});

retailerMgmtRoutes.post("/retailers/:id/reset-link", async (c) => {
  const { business, user } = ownerCtx(c);
  await rateLimit(c, "reset-link", user.id, 20, 3600);
  const db = c.env.DB;
  const retailer = await getRetailer(db, business.id, c.req.param("id"));
  if (!retailer.user_id) throw conflict("This retailer has not registered yet. Send them an invitation instead.");
  const token = await issueResetToken(db, retailer.user_id, user.id);
  await auditStmt(db, { businessId: business.id, actorId: user.id, action: "retailer.reset_link_created", entityType: "retailer", entityId: retailer.id }).run();
  return ok(c, { token }, undefined, 201);
});

retailerMgmtRoutes.get("/retailers/:id/ledger", async (c) => {
  const { business } = ownerCtx(c);
  const retailer = await getRetailer(c.env.DB, business.id, c.req.param("id"));
  return ok(c, await retailerLedger(c.env.DB, business.id, retailer.id));
});

// ── Retailer-specific pricing ─────────────────────────────────────────

retailerMgmtRoutes.get("/retailers/:id/prices", async (c) => {
  const { business } = ownerCtx(c);
  const db = c.env.DB;
  const retailer = await getRetailer(db, business.id, c.req.param("id"));
  const { page, pageSize, offset } = pageParams(c, 50);
  const where = ["p.business_id = ?", "p.archived_at IS NULL"];
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
  if (c.req.query("onlyOverrides") === "1") where.push("rp.id IS NOT NULL");
  if (c.req.query("activeOnly") === "1") where.push("p.is_active = 1");
  const join = "LEFT JOIN retailer_product_prices rp ON rp.product_id = p.id AND rp.retailer_id = ? AND rp.business_id = p.business_id";
  const w = where.join(" AND ");
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM products p ${join} WHERE ${w}`).bind(retailer.id, ...params),
    db.prepare(
      `SELECT p.id, p.name, p.sku, p.unit, p.is_active, p.min_order_qty, p.stock_qty, p.availability, p.gst_rate_bp,
              p.price_paise AS standard_price_paise, rp.price_paise AS override_price_paise,
              COALESCE(rp.price_paise, p.price_paise) AS effective_price_paise
       FROM products p ${join} WHERE ${w} ORDER BY p.name COLLATE NOCASE LIMIT ? OFFSET ?`,
    ).bind(retailer.id, ...params, pageSize, offset),
  ]);
  return ok(c, rows.results, { page, pageSize, total: (count.results[0] as any).n });
});

retailerMgmtRoutes.put("/retailers/:id/prices", async (c) => {
  const { business, user } = ownerCtx(c);
  const db = c.env.DB;
  const retailer = await getRetailer(db, business.id, c.req.param("id"));
  const input = await body(c, retailerPricesSchema);
  const ids = [...new Set(input.items.map((i) => i.productId))];
  // Every product must belong to this business — ids from another tenant are rejected outright.
  const owned = await db.prepare(`SELECT COUNT(*) AS n FROM products WHERE business_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(business.id, ...ids).first<{ n: number }>();
  if (owned?.n !== ids.length) throw notFound("Product");
  const ts = now();
  const stmts = input.items.map((item) =>
    item.pricePaise == null
      ? db.prepare("DELETE FROM retailer_product_prices WHERE retailer_id = ? AND product_id = ? AND business_id = ?").bind(retailer.id, item.productId, business.id)
      : db.prepare(
          `INSERT INTO retailer_product_prices (id, business_id, retailer_id, product_id, price_paise, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(retailer_id, product_id) DO UPDATE SET price_paise = excluded.price_paise, updated_at = excluded.updated_at`,
        ).bind(uuid(), business.id, retailer.id, item.productId, item.pricePaise, ts, ts),
  );
  stmts.push(auditStmt(db, { businessId: business.id, actorId: user.id, action: "pricing.updated", entityType: "retailer", entityId: retailer.id, metadata: { count: input.items.length } }));
  await db.batch(stmts);
  return ok(c, { updated: input.items.length });
});

retailerMgmtRoutes.post("/retailers/:id/prices/bulk", async (c) => {
  const { business, user } = ownerCtx(c);
  const db = c.env.DB;
  const retailer = await getRetailer(db, business.id, c.req.param("id"));
  const input = await body(c, bulkPriceSchema);
  const catFilter = input.categoryId ? " AND p.category_id = ?" : "";
  const catParam = input.categoryId ? [input.categoryId] : [];
  let stmt: D1PreparedStatement;
  if (input.mode === "clear") {
    stmt = db.prepare(
      `DELETE FROM retailer_product_prices WHERE retailer_id = ? AND business_id = ?
       AND product_id IN (SELECT p.id FROM products p WHERE p.business_id = ?${catFilter})`,
    ).bind(retailer.id, business.id, business.id, ...catParam);
  } else {
    const keepBp = 10000 - Math.round(input.percent! * 100);
    const ts = now();
    // rounded half-up to the paisa; CAST because D1 binds JS numbers as REAL, which would make this a float division
    stmt = db.prepare(
      `INSERT INTO retailer_product_prices (id, business_id, retailer_id, product_id, price_paise, created_at, updated_at)
       SELECT lower(hex(randomblob(16))), p.business_id, ?, p.id, CAST((p.price_paise * ? + 5000) / 10000 AS INTEGER), ?, ?
       FROM products p WHERE p.business_id = ? AND p.archived_at IS NULL${catFilter}
       ON CONFLICT(retailer_id, product_id) DO UPDATE SET price_paise = excluded.price_paise, updated_at = excluded.updated_at`,
    ).bind(retailer.id, keepBp, ts, ts, business.id, ...catParam);
  }
  const res = await db.batch([
    stmt,
    auditStmt(db, { businessId: business.id, actorId: user.id, action: "pricing.bulk_updated", entityType: "retailer", entityId: retailer.id, metadata: { mode: input.mode, percent: input.percent ?? null, categoryId: input.categoryId ?? null } }),
  ]);
  return ok(c, { affected: res[0].meta.changes });
});
