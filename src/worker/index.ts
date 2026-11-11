import { Hono } from "hono";
import { loadAuth } from "./lib/auth";
import { AppError, ok, type AppEnv } from "./lib/http";
import { authRoutes } from "./routes/auth";
import { bizRoutes } from "./routes/biz";
import { catalogRoutes } from "./routes/catalog";
import { retailerMgmtRoutes } from "./routes/retailers";
import { orderRoutes } from "./routes/orders";
import { paymentRoutes } from "./routes/payments";
import { reportRoutes } from "./routes/reports";
import { portalRoutes } from "./routes/portal";
import { adminRoutes } from "./routes/admin";
import { notificationRoutes } from "./routes/notifications";

const app = new Hono<AppEnv>();

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Endpoints used before a session exists; protected by Origin + custom-header checks and rate limits instead of a session CSRF token. */
const CSRF_TOKEN_EXEMPT = [/^\/api\/auth\/(login|register|forgot-password|reset-password)$/, /^\/api\/auth\/invitations\/[^/]+\/accept$/];

app.use("/api/*", async (c, next) => {
  const url = new URL(c.req.url);
  const origin = c.req.header("origin");
  const allowed = new Set([url.origin, ...(c.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)]);
  const crossOrigin = !!origin && origin !== url.origin;

  // CORS: only explicitly configured origins may call the API with credentials.
  if (crossOrigin && allowed.has(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
    if (c.req.method === "OPTIONS") {
      c.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE");
      c.header("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-DL-Client");
      c.header("Access-Control-Max-Age", "600");
      return c.body(null, 204);
    }
  }

  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");

  const auth = await loadAuth(c);
  c.set("auth", auth);

  if (MUTATING.has(c.req.method)) {
    // CSRF layer 1: browsers always send Origin on cross-site mutations; reject anything not allow-listed.
    if (origin && !allowed.has(origin)) throw new AppError(403, "BAD_ORIGIN", "Request origin is not allowed");
    // CSRF layer 2: a custom header cannot be set by a cross-site form and forces a CORS preflight for fetch.
    if (c.req.header("x-dl-client") !== "web") throw new AppError(403, "CSRF", "Missing client header");
    // CSRF layer 3: per-session token for every authenticated mutation.
    const exempt = CSRF_TOKEN_EXEMPT.some((re) => re.test(url.pathname));
    if (auth && !exempt && c.req.header("x-csrf-token") !== auth.csrfToken) {
      throw new AppError(403, "CSRF", "Your session has expired. Refresh the page and try again.");
    }
  }
  await next();
});

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return ok(c, { status: row?.ok === 1 ? "ok" : "degraded", time: new Date().toISOString() });
});

/** Public storefront card: deliberately minimal — no products, prices or retailer data. */
app.get("/api/public/store/:slug", async (c) => {
  const store = await c.env.DB.prepare(
    `SELECT b.name, b.slug, b.city, b.state, b.about,
            (SELECT COUNT(*) FROM categories WHERE business_id = b.id AND deleted_at IS NULL) AS category_count,
            (SELECT COUNT(*) FROM products WHERE business_id = b.id AND archived_at IS NULL AND is_active = 1) AS product_count
     FROM businesses b WHERE b.slug = ? AND b.status = 'active'`,
  )
    .bind(c.req.param("slug").toLowerCase())
    .first();
  if (!store) throw new AppError(404, "NOT_FOUND", "Store not found");
  return ok(c, store);
});

app.route("/api/auth", authRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/biz", bizRoutes);
app.route("/api/biz", catalogRoutes);
app.route("/api/biz", retailerMgmtRoutes);
app.route("/api/biz", orderRoutes);
app.route("/api/biz", paymentRoutes);
app.route("/api/biz", reportRoutes);
app.route("/api/retailer", portalRoutes);
app.route("/api/admin", adminRoutes);

app.all("/api/*", () => {
  throw new AppError(404, "NOT_FOUND", "Endpoint not found");
});

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, err.status);
  }
  // Never leak internals (SQL, stack traces) to clients; log only the message server-side.
  console.error("Unhandled error:", err instanceof Error ? err.message : "unknown");
  return c.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } }, 500);
});

// Non-API requests fall through to the static SPA assets.
app.notFound((c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text("Not found", 404)));

export default app;
