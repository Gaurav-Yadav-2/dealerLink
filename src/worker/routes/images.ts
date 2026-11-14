import { Hono } from "hono";
import { AppError, type AppEnv } from "../lib/http";
import { blobBytes } from "../lib/images";

/**
 * Public read access to uploaded product photos. <img> tags cannot send the per-tab session header, so photos are
 * served by an unguessable random id (like most image CDNs). Nothing but the image bytes is ever returned.
 */
export const imageRoutes = new Hono<AppEnv>();

imageRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new AppError(404, "NOT_FOUND", "Image not found");
  const row = await c.env.DB.prepare("SELECT content_type, data FROM product_images WHERE id = ?").bind(id).first<{ content_type: string; data: unknown }>();
  if (!row) throw new AppError(404, "NOT_FOUND", "Image not found");
  const bytes = blobBytes(row.data);
  c.header("Content-Type", row.content_type);
  // ids never change content, so browsers may keep the photo for a year
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  c.header("Content-Security-Policy", "default-src 'none'; sandbox");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(bytes as unknown as ArrayBuffer);
});
