import { AppError, now, uuid, type Ctx } from "./http";

/**
 * Fixed-window rate limiter backed by D1 (no paid add-ons needed).
 * Throws 429 once `limit` requests have been made for `key` within `windowSec`.
 */
export async function rateLimit(c: Ctx, name: string, subject: string, limit: number, windowSec: number) {
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = `${name}:${ip}:${subject}`.slice(0, 200);
  const row = await c.env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`,
  )
    .bind(key, window)
    .first<{ count: number }>();
  if (row && row.count > limit) {
    throw new AppError(429, "RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.");
  }
}

/** Prepared statement that appends an audit-log row; include it in the same batch as the change it records. */
export function auditStmt(
  db: D1Database,
  a: { businessId: string | null; actorId: string | null; action: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> },
) {
  return db
    .prepare("INSERT INTO audit_logs (id, business_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(uuid(), a.businessId, a.actorId, a.action, a.entityType ?? null, a.entityId ?? null, a.metadata ? JSON.stringify(a.metadata) : null, now());
}

export function notifyStmt(
  db: D1Database,
  n: { userId: string; businessId: string | null; type: string; title: string; body?: string; link?: string },
) {
  return db
    .prepare("INSERT INTO notifications (id, user_id, business_id, type, title, body, link, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(uuid(), n.userId, n.businessId, n.type, n.title, n.body ?? null, n.link ?? null, now());
}

/** User ids of everyone who manages a business (notification recipients). */
export async function businessUserIds(db: D1Database, businessId: string): Promise<string[]> {
  const { results } = await db.prepare("SELECT user_id FROM business_members WHERE business_id = ?").bind(businessId).all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "store"
  );
}

export async function uniqueSlug(db: D1Database, name: string): Promise<string> {
  const base = slugify(name);
  const { results } = await db.prepare("SELECT slug FROM businesses WHERE slug = ? OR slug LIKE ?").bind(base, `${base}-%`).all<{ slug: string }>();
  const taken = new Set(results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export const isConstraintError = (e: unknown, kind: "CHECK" | "UNIQUE") =>
  e instanceof Error && e.message.includes(`${kind} constraint failed`);

/** INR for server-generated notification text. */
export const inr = (paise: number) =>
  "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });

/** Availability shown to users, derived on the server from the business's inventory settings. */
export function resolveAvailability(
  p: { stock_qty: number | null; availability: string },
  biz: { track_inventory: number; low_stock_threshold: number },
): "in_stock" | "low_stock" | "out_of_stock" {
  if (biz.track_inventory && p.stock_qty != null) {
    if (p.stock_qty <= 0) return "out_of_stock";
    return p.stock_qty <= biz.low_stock_threshold ? "low_stock" : "in_stock";
  }
  return p.availability as "in_stock" | "low_stock" | "out_of_stock";
}
