import type { MiddlewareHandler } from "hono";
import { SESSION_IDLE_HOURS, SESSION_TTL_DAYS } from "../../shared/constants";
import { randomToken, sha256Hex } from "./crypto";
import { AppError, forbidden, now, uuid, type AppEnv, type Ctx } from "./http";
import type { FeatureSet } from "../../shared/features";
import { loadFeatures } from "./features";

/**
 * Sessions are per browser tab. The web app keeps the session token in the tab's own sessionStorage and sends it in
 * this header on every request. No cookie is used, so one tab signing in or out never affects another tab.
 */
export const SESSION_HEADER = "x-dl-session";
const sessionToken = (c: Ctx) => c.req.header(SESSION_HEADER) || null;

export type BusinessRow = {
  id: string; name: string; slug: string; phone: string | null; email: string | null; address: string | null;
  city: string | null; state: string | null; gstin: string | null; about: string | null; status: string;
  track_inventory: number; low_stock_threshold: number; gst_enabled: number; order_prefix: string; created_at: string;
};
export type RetailerRow = {
  id: string; business_id: string; user_id: string | null; business_name: string; contact_person: string; phone: string;
  email: string | null; address: string | null; city: string | null; state: string | null; gstin: string | null;
  status: string; registered_at: string | null; created_at: string;
};
export type AuthUser = { id: string; email: string; name: string; phone: string | null; role: "owner" | "retailer" | "admin"; is_demo: number };
/** `features` is the business's feature switches (null for the platform admin, who has no business). */
export type AuthCtx = { sessionId: string; csrfToken: string; user: AuthUser; business: BusinessRow | null; retailer: RetailerRow | null; features: FeatureSet | null };

export const BUSINESS_COLS =
  "b.id, b.name, b.slug, b.phone, b.email, b.address, b.city, b.state, b.gstin, b.about, b.status, b.track_inventory, b.low_stock_threshold, b.gst_enabled, b.order_prefix, b.created_at";
export const RETAILER_COLS =
  "r.id, r.business_id, r.user_id, r.business_name, r.contact_person, r.phone, r.email, r.address, r.city, r.state, r.gstin, r.status, r.registered_at, r.created_at";

/** Creates a session. The raw `token` is returned once to the caller; only its SHA-256 hash is stored. */
export async function createSession(c: Ctx, userId: string): Promise<{ id: string; csrf: string; token: string }> {
  const id = uuid();
  const token = randomToken();
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400000);
  const ts = now();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at, last_seen_at) VALUES (?,?,?,?,?,?,?)")
    .bind(id, userId, await sha256Hex(token), csrf, expires.toISOString(), ts, ts)
    .run();
  return { id, csrf, token };
}

/** Ends only the session the request is using (this tab's), never the user's other sessions. */
export async function destroySession(c: Ctx) {
  const token = sessionToken(c);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

/** Resolves the caller purely from the session header. Nothing identity-related is read from the request body. */
export async function loadAuth(c: Ctx): Promise<AuthCtx | null> {
  const token = sessionToken(c);
  if (!token) return null;
  const db = c.env.DB;
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, COALESCE(s.last_seen_at, s.created_at) AS last_seen_at, u.id, u.email, u.name, u.phone, u.role, u.is_demo, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await sha256Hex(token), now())
    .first<{ session_id: string; csrf_token: string; last_seen_at: string | null; status: string } & AuthUser>();
  if (!row || row.status !== "active") return null;
  if (row.is_demo && c.env.ALLOW_DEMO_ACCOUNTS !== "true") return null;

  // Idle timeout: a session unused for SESSION_IDLE_HOURS is ended. Activity is recorded at most every 5 minutes
  // so normal browsing costs at most one small write per 5 minutes per session.
  const idleMs = Date.now() - Date.parse(row.last_seen_at ?? "1970-01-01T00:00:00Z");
  if (idleMs > SESSION_IDLE_HOURS * 3600_000) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(row.session_id).run();
    return null;
  }
  if (idleMs > 5 * 60_000) await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(now(), row.session_id).run();

  const user: AuthUser = { id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role, is_demo: row.is_demo };
  return authForUser(db, user, row.session_id, row.csrf_token);
}

/** Attaches the tenant (business / retailer profile) a user belongs to. This is the only place tenancy is resolved. */
export async function authForUser(db: D1Database, user: AuthUser, sessionId: string, csrfToken: string): Promise<AuthCtx> {
  let business: BusinessRow | null = null;
  let retailer: RetailerRow | null = null;
  if (user.role === "owner") {
    business = await db
      .prepare(`SELECT ${BUSINESS_COLS} FROM business_members m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ?`)
      .bind(user.id)
      .first<BusinessRow>();
  } else if (user.role === "retailer") {
    retailer = await db.prepare(`SELECT ${RETAILER_COLS} FROM retailer_profiles r WHERE r.user_id = ?`).bind(user.id).first<RetailerRow>();
    if (retailer) {
      business = await db.prepare(`SELECT ${BUSINESS_COLS} FROM businesses b WHERE b.id = ?`).bind(retailer.business_id).first<BusinessRow>();
    }
  }
  const features = business ? await loadFeatures(db, business.id) : null;
  // GST switched off by the admin overrides the wholesaler's own GST setting everywhere (pricing, cart, orders).
  if (business && features && !features.gst) business = { ...business, gst_enabled: 0 };
  return { sessionId, csrfToken, user, business, retailer, features };
}

export function requireAuth(c: Ctx): AuthCtx {
  const auth = c.get("auth");
  if (!auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue");
  return auth;
}

export type OwnerCtx = AuthCtx & { business: BusinessRow };
export type RetailerCtx = AuthCtx & { business: BusinessRow; retailer: RetailerRow };

export function ownerCtx(c: Ctx): OwnerCtx {
  const auth = requireAuth(c);
  if (auth.user.role !== "owner" || !auth.business) throw forbidden();
  if (auth.business.status !== "active") throw new AppError(403, "BUSINESS_SUSPENDED", "This business account has been suspended. Contact DealerLink support.");
  return auth as OwnerCtx;
}

export function retailerCtx(c: Ctx): RetailerCtx {
  const auth = requireAuth(c);
  if (auth.user.role !== "retailer" || !auth.retailer || !auth.business) throw forbidden();
  if (auth.business.status !== "active") throw new AppError(403, "BUSINESS_SUSPENDED", "This wholesaler's account is currently unavailable.");
  if (auth.retailer.status !== "active") throw new AppError(403, "ACCOUNT_INACTIVE", "Your account has been deactivated by the wholesaler.");
  return auth as RetailerCtx;
}

export function adminCtx(c: Ctx): AuthCtx {
  const auth = requireAuth(c);
  if (auth.user.role !== "admin") throw forbidden();
  return auth;
}

export const ownerOnly: MiddlewareHandler<AppEnv> = async (c, next) => { ownerCtx(c); await next(); };
export const retailerOnly: MiddlewareHandler<AppEnv> = async (c, next) => { retailerCtx(c); await next(); };
export const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => { adminCtx(c); await next(); };

/** Shape of the authenticated user returned to the browser. Contains no secrets. */
export function publicAuth(auth: AuthCtx) {
  return { user: auth.user, business: auth.business, retailer: auth.retailer, csrfToken: auth.csrfToken, features: auth.features };
}
