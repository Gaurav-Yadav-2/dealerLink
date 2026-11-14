import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { AppError, body, now, ok, uuid, type AppEnv } from "../lib/http";
import { rateLimit } from "../lib/util";
import { requireFeature } from "../lib/features";
import { b64u, pushConfigured, sendToTargets, type PushTarget } from "../lib/webpush";

/** Phone / desktop push alerts. A subscription belongs to the signed-in user and the browser that created it. */
export const pushRoutes = new Hono<AppEnv>();

// Only the browser vendors' push services are accepted, so the server never sends requests to arbitrary URLs.
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const endpointSchema = z
  .string()
  .max(1000)
  .refine((u) => {
    try {
      const url = new URL(u);
      return url.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(url.hostname));
    } catch {
      return false;
    }
  }, "This browser's push service is not supported");
/** Browsers send base64url keys; accept standard base64 and '=' padding too, and store the canonical unpadded base64url form. */
const b64urlKey = (min: number, max: number, message: string) =>
  z
    .string()
    .transform((s) => s.trim().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""))
    .refine((s) => new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`).test(s), message);
const subscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: b64urlKey(86, 88, "Invalid browser key"),
    auth: b64urlKey(21, 24, "Invalid browser secret"),
  }),
});
const endpointOnly = z.object({ endpoint: z.string().max(1000) });
const MAX_DEVICES_PER_USER = 5;

const homeFor = (role: string) => (role === "owner" ? "/dashboard" : role === "retailer" ? "/retailer/dashboard" : "/admin");

pushRoutes.get("/key", (c) => ok(c, { enabled: pushConfigured(c.env), publicKey: c.env.VAPID_PUBLIC_KEY ?? null }));

/** Whether this browser's subscription currently delivers alerts to the signed-in user. */
pushRoutes.post("/status", async (c) => {
  const { user } = requireAuth(c);
  const input = await body(c, endpointOnly);
  const row = await c.env.DB.prepare("SELECT 1 FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(input.endpoint, user.id).first();
  return ok(c, { subscribed: !!row });
});

pushRoutes.post("/subscribe", async (c) => {
  const { user } = requireAuth(c);
  if (!pushConfigured(c.env)) throw new AppError(409, "PUSH_DISABLED", "Alerts are not set up on this site yet.");
  requireFeature(c, "phoneAlerts");
  await rateLimit(c, "push-subscribe", user.id, 20, 3600);
  let input: z.infer<typeof subscriptionSchema>;
  try {
    input = await body(c, subscriptionSchema);
  } catch (e) {
    // Log why (and which push service) without logging the subscription's tokens, to diagnose browser-specific failures.
    const raw = (await c.req.json().catch(() => null)) as { endpoint?: unknown } | null;
    let host = "unknown";
    try {
      host = new URL(String(raw?.endpoint)).hostname;
    } catch {
      /* not a URL */
    }
    console.warn("Push subscribe rejected:", host, e instanceof Error ? e.message : "invalid");
    throw e;
  }
  const key = b64u.decode(input.keys.p256dh);
  if (key.length !== 65 || key[0] !== 4) throw new AppError(422, "VALIDATION_ERROR", "Invalid browser key");
  const db = c.env.DB;
  const ts = now();
  await db.batch([
    // One browser = one endpoint. If someone else signed in on this browser before, alerts now go to the current user.
    db.prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at`,
    ).bind(uuid(), user.id, input.endpoint, input.keys.p256dh, input.keys.auth, ts, ts),
    // keep only the most recent devices per user
    db.prepare(
      `DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN
         (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ${MAX_DEVICES_PER_USER})`,
    ).bind(user.id, user.id),
  ]);
  return ok(c, { subscribed: true }, undefined, 201);
});

pushRoutes.post("/unsubscribe", async (c) => {
  const { user } = requireAuth(c);
  const input = await body(c, endpointOnly);
  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(input.endpoint, user.id).run();
  return ok(c, { subscribed: false });
});

/** Sends a test alert to the signed-in user's own devices. */
pushRoutes.post("/test", async (c) => {
  const { user } = requireAuth(c);
  if (!pushConfigured(c.env)) throw new AppError(409, "PUSH_DISABLED", "Alerts are not set up on this site yet.");
  requireFeature(c, "phoneAlerts");
  await rateLimit(c, "push-test", user.id, 5, 600);
  const { results } = await c.env.DB.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?").bind(user.id).all<PushTarget>();
  if (!results.length) throw new AppError(409, "NO_DEVICES", "Alerts are not turned on for any of your devices.");
  const origin = new URL(c.req.url).origin;
  const sent = await sendToTargets(
    c.env,
    results.map((target) => ({ target, message: { title: "DealerLink alerts are on", body: "You will get order updates on this device.", url: homeFor(user.role), tag: "dl-test" } })),
    c.env.VAPID_SUBJECT || origin,
  );
  return ok(c, { sent });
});
