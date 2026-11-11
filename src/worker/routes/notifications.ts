import { Hono } from "hono";
import { requireAuth } from "../lib/auth";
import { now, ok, type AppEnv } from "../lib/http";

/** In-app notification centre. Rows are always scoped to the signed-in user. */
export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.get("/", async (c) => {
  const { user } = requireAuth(c);
  const db = c.env.DB;
  const [rows, unread] = await db.batch([
    db.prepare("SELECT id, type, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30").bind(user.id),
    db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(user.id),
  ]);
  return ok(c, rows.results, { unread: (unread.results[0] as any).n });
});

notificationRoutes.post("/read-all", async (c) => {
  const { user } = requireAuth(c);
  await c.env.DB.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now(), user.id).run();
  return ok(c, { read: true });
});

notificationRoutes.post("/:id/read", async (c) => {
  const { user } = requireAuth(c);
  await c.env.DB.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?").bind(now(), c.req.param("id"), user.id).run();
  return ok(c, { read: true });
});
