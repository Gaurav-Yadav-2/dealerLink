import { Hono } from "hono";
import { AVAILABILITIES } from "../../shared/constants";
import { rupeesToPaise } from "../../shared/money";
import { categorySchema, productImportRowSchema, productImportSchema, productPatchSchema, productSchema } from "../../shared/schemas";
import { ownerCtx, ownerOnly, type BusinessRow } from "../lib/auth";
import { body, conflict, invalid, like, notFound, now, ok, pageParams, uuid, type AppEnv } from "../lib/http";
import { auditStmt, isConstraintError, rateLimit, resolveAvailability } from "../lib/util";
import { requireFeature } from "../lib/features";
import { imagesBelongTo, internalImageId, MAX_IMAGE_BYTES, MAX_IMAGES_PER_BUSINESS, sniffImageType } from "../lib/images";

export const catalogRoutes = new Hono<AppEnv>();
catalogRoutes.use("*", ownerOnly);

// ── Categories ────────────────────────────────────────────────────────

catalogRoutes.get("/categories", async (c) => {
  const { business } = ownerCtx(c);
  const { results } = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.created_at,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.archived_at IS NULL) AS product_count
     FROM categories c WHERE c.business_id = ? AND c.deleted_at IS NULL ORDER BY c.name`,
  ).bind(business.id).all();
  return ok(c, results);
});

catalogRoutes.post("/categories", async (c) => {
  const { business, user } = ownerCtx(c);
  const input = await body(c, categorySchema);
  const id = uuid();
  const ts = now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO categories (id, business_id, name, created_at, updated_at) VALUES (?,?,?,?,?)").bind(id, business.id, input.name, ts, ts),
      auditStmt(c.env.DB, { businessId: business.id, actorId: user.id, action: "category.created", entityType: "category", entityId: id }),
    ]);
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict("A category with this name already exists.");
    throw e;
  }
  return ok(c, { id, name: input.name, product_count: 0, created_at: ts }, undefined, 201);
});

catalogRoutes.patch("/categories/:id", async (c) => {
  const { business } = ownerCtx(c);
  const input = await body(c, categorySchema);
  try {
    const res = await c.env.DB.prepare("UPDATE categories SET name = ?, updated_at = ? WHERE id = ? AND business_id = ? AND deleted_at IS NULL")
      .bind(input.name, now(), c.req.param("id"), business.id).run();
    if (!res.meta.changes) throw notFound("Category");
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict("A category with this name already exists.");
    throw e;
  }
  return ok(c, { id: c.req.param("id"), name: input.name });
});

catalogRoutes.delete("/categories/:id", async (c) => {
  const { business, user } = ownerCtx(c);
  const db = c.env.DB;
  const id = c.req.param("id");
  const res = await db.batch([
    db.prepare("UPDATE categories SET deleted_at = ?, updated_at = ? WHERE id = ? AND business_id = ? AND deleted_at IS NULL").bind(now(), now(), id, business.id),
    // products keep existing; they simply become uncategorised
    db.prepare("UPDATE products SET category_id = NULL WHERE category_id = ? AND business_id = ?").bind(id, business.id),
    auditStmt(db, { businessId: business.id, actorId: user.id, action: "category.deleted", entityType: "category", entityId: id }),
  ]);
  if (!res[0].meta.changes) throw notFound("Category");
  return ok(c, { deleted: true });
});

// ── Products ──────────────────────────────────────────────────────────

const PRODUCT_COLS = `p.id, p.category_id, c.name AS category_name, p.name, p.sku, p.description, p.unit, p.price_paise, p.mrp_paise,
  p.gst_rate_bp, p.min_order_qty, p.stock_qty, p.availability, p.image_url, p.is_active, p.archived_at, p.created_at, p.updated_at`;
const PRODUCT_FROM = "FROM products p LEFT JOIN categories c ON c.id = p.category_id AND c.deleted_at IS NULL";

const decorate = (p: any, biz: BusinessRow) => ({ ...p, availability_status: resolveAvailability(p, biz) });

const SORTS: Record<string, string> = {
  name: "p.name COLLATE NOCASE ASC",
  "-name": "p.name COLLATE NOCASE DESC",
  price: "p.price_paise ASC",
  "-price": "p.price_paise DESC",
  newest: "p.created_at DESC",
  stock: "p.stock_qty IS NULL, p.stock_qty ASC",
};

/** An uploaded photo may only be used by products of the business that uploaded it. */
async function assertImageOwned(db: D1Database, businessId: string, url: string | null | undefined) {
  const id = internalImageId(url);
  if (id && !(await imagesBelongTo(db, businessId, [url])).has(id)) {
    throw invalid("imageUrl: This photo was not found in your catalogue. Upload it again.", [{ path: "imageUrl", message: "Photo not found" }]);
  }
}

async function assertCategory(db: D1Database, businessId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const row = await db.prepare("SELECT 1 FROM categories WHERE id = ? AND business_id = ? AND deleted_at IS NULL").bind(categoryId, businessId).first();
  if (!row) throw invalid("categoryId: Choose a valid category");
}

catalogRoutes.get("/products", async (c) => {
  const { business } = ownerCtx(c);
  const { page, pageSize, offset } = pageParams(c);
  const where = ["p.business_id = ?"];
  const params: unknown[] = [business.id];
  const status = c.req.query("status") ?? "current";
  if (status === "archived") where.push("p.archived_at IS NOT NULL");
  else {
    where.push("p.archived_at IS NULL");
    if (status === "active") where.push("p.is_active = 1");
    if (status === "inactive") where.push("p.is_active = 0");
  }
  const q = c.req.query("q")?.trim();
  if (q) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')");
    params.push(like(q), like(q));
  }
  const categoryId = c.req.query("categoryId");
  if (categoryId === "none") where.push("p.category_id IS NULL");
  else if (categoryId) {
    where.push("p.category_id = ?");
    params.push(categoryId);
  }
  const order = SORTS[c.req.query("sort") ?? "name"] ?? SORTS.name;
  const w = where.join(" AND ");
  const db = c.env.DB;
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${w}`).bind(...params),
    db.prepare(`SELECT ${PRODUCT_COLS} ${PRODUCT_FROM} WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...params, pageSize, offset),
  ]);
  return ok(c, (rows.results as any[]).map((p) => decorate(p, business)), { page, pageSize, total: (count.results[0] as any).n });
});

/** Full catalogue for CSV export (the browser builds the file). */
catalogRoutes.get("/products/export", async (c) => {
  const { business } = ownerCtx(c);
  requireFeature(c, "csv");
  const { results } = await c.env.DB.prepare(`SELECT ${PRODUCT_COLS} ${PRODUCT_FROM} WHERE p.business_id = ? AND p.archived_at IS NULL ORDER BY p.name LIMIT 5000`)
    .bind(business.id).all();
  return ok(c, results);
});

catalogRoutes.get("/products/:id", async (c) => {
  const { business } = ownerCtx(c);
  const p = await c.env.DB.prepare(`SELECT ${PRODUCT_COLS} ${PRODUCT_FROM} WHERE p.id = ? AND p.business_id = ?`).bind(c.req.param("id"), business.id).first();
  if (!p) throw notFound("Product");
  return ok(c, decorate(p, business));
});

catalogRoutes.post("/products", async (c) => {
  const { business, user } = ownerCtx(c);
  const input = await body(c, productSchema);
  const db = c.env.DB;
  await assertCategory(db, business.id, input.categoryId);
  await assertImageOwned(db, business.id, input.imageUrl);
  const id = uuid();
  const ts = now();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO products (id, business_id, category_id, name, sku, description, unit, price_paise, mrp_paise, gst_rate_bp, min_order_qty,
           stock_qty, availability, image_url, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        id, business.id, input.categoryId ?? null, input.name, input.sku, input.description ?? null, input.unit, input.pricePaise,
        input.mrpPaise ?? null, input.gstRateBp, input.minOrderQty, input.stockQty ?? null, input.availability, input.imageUrl ?? null,
        input.isActive ? 1 : 0, ts, ts,
      ),
      auditStmt(db, { businessId: business.id, actorId: user.id, action: "product.created", entityType: "product", entityId: id, metadata: { sku: input.sku } }),
    ]);
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict(`SKU “${input.sku}” is already used by another product.`, [{ path: "sku", message: "SKU already in use" }]);
    throw e;
  }
  const p = await db.prepare(`SELECT ${PRODUCT_COLS} ${PRODUCT_FROM} WHERE p.id = ?`).bind(id).first();
  return ok(c, decorate(p, business), undefined, 201);
});

const PATCH_COLUMNS: Record<string, string> = {
  name: "name", sku: "sku", description: "description", categoryId: "category_id", unit: "unit", pricePaise: "price_paise",
  mrpPaise: "mrp_paise", gstRateBp: "gst_rate_bp", minOrderQty: "min_order_qty", stockQty: "stock_qty", availability: "availability",
  imageUrl: "image_url", isActive: "is_active",
};

catalogRoutes.patch("/products/:id", async (c) => {
  const { business, user } = ownerCtx(c);
  const id = c.req.param("id");
  const raw = await c.req.json().catch(() => ({}));
  const input = await body(c, productPatchSchema);
  const db = c.env.DB;
  const existing = await db
    .prepare("SELECT price_paise, image_url FROM products WHERE id = ? AND business_id = ? AND archived_at IS NULL")
    .bind(id, business.id)
    .first<{ price_paise: number; image_url: string | null }>();
  if (!existing) throw notFound("Product");
  if ("categoryId" in input) await assertCategory(db, business.id, input.categoryId);
  if ("imageUrl" in raw) await assertImageOwned(db, business.id, input.imageUrl);
  // When a product's uploaded photo is replaced or removed, delete the old one (unless another product still uses it).
  const oldImage = internalImageId(existing.image_url);
  const dropOldImage =
    "imageUrl" in raw && oldImage && internalImageId(input.imageUrl) !== oldImage
      ? db
          .prepare("DELETE FROM product_images WHERE id = ? AND business_id = ? AND NOT EXISTS (SELECT 1 FROM products WHERE business_id = ? AND image_url = ?)")
          .bind(oldImage, business.id, business.id, existing.image_url)
      : null;

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(PATCH_COLUMNS)) {
    // only touch fields the client actually sent (zod defaults must not overwrite stored values)
    if (!(key in raw)) continue;
    let v = (input as any)[key];
    if (typeof v === "boolean") v = v ? 1 : 0;
    sets.push(`${col} = ?`);
    params.push(v ?? null);
  }
  if (!sets.length) throw invalid("Nothing to update");
  try {
    await db.batch([
      db.prepare(`UPDATE products SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND business_id = ?`).bind(...params, now(), id, business.id),
      ...(dropOldImage ? [dropOldImage] : []),
      auditStmt(db, {
        businessId: business.id, actorId: user.id, action: "product.updated", entityType: "product", entityId: id,
        metadata: input.pricePaise != null && input.pricePaise !== existing.price_paise ? { priceFrom: existing.price_paise, priceTo: input.pricePaise } : undefined,
      }),
    ]);
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict("That SKU is already used by another product.", [{ path: "sku", message: "SKU already in use" }]);
    throw e;
  }
  const p = await db.prepare(`SELECT ${PRODUCT_COLS} ${PRODUCT_FROM} WHERE p.id = ?`).bind(id).first();
  return ok(c, decorate(p, business));
});

/**
 * Upload a product photo. The body is the raw image (the browser has already resized and compressed it).
 * The file type is checked from its bytes, not from what the browser claims.
 */
catalogRoutes.post("/images", async (c) => {
  const { business, user } = ownerCtx(c);
  requireFeature(c, "productPhotos");
  await rateLimit(c, "image-upload", business.id, 120, 3600);
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) throw invalid(`Photo is too large (max ${MAX_IMAGE_BYTES / 1000} KB after compression).`);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length) throw invalid("No photo was received.");
  if (bytes.length > MAX_IMAGE_BYTES) throw invalid(`Photo is too large (max ${MAX_IMAGE_BYTES / 1000} KB after compression).`);
  const type = sniffImageType(bytes);
  if (!type) throw invalid("Only JPG, PNG or WebP photos can be uploaded.");
  const db = c.env.DB;
  const count = await db.prepare("SELECT COUNT(*) AS n FROM product_images WHERE business_id = ?").bind(business.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_IMAGES_PER_BUSINESS) throw conflict(`You have reached the limit of ${MAX_IMAGES_PER_BUSINESS} product photos.`);
  const id = uuid();
  await db.batch([
    db.prepare("INSERT INTO product_images (id, business_id, content_type, bytes, data, created_by, created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(id, business.id, type, bytes.length, bytes, user.id, now()),
    auditStmt(db, { businessId: business.id, actorId: user.id, action: "product.photo_uploaded", entityType: "image", entityId: id, metadata: { bytes: bytes.length, type } }),
  ]);
  return ok(c, { id, url: `/api/images/${id}`, bytes: bytes.length, contentType: type }, undefined, 201);
});

/** Products are archived, never hard-deleted, so past orders keep their references. */
catalogRoutes.delete("/products/:id", async (c) => {
  const { business, user } = ownerCtx(c);
  const db = c.env.DB;
  const id = c.req.param("id");
  const res = await db.batch([
    db.prepare("UPDATE products SET archived_at = ?, is_active = 0, updated_at = ? WHERE id = ? AND business_id = ? AND archived_at IS NULL").bind(now(), now(), id, business.id),
    db.prepare("DELETE FROM cart_items WHERE product_id = ? AND business_id = ?").bind(id, business.id),
    auditStmt(db, { businessId: business.id, actorId: user.id, action: "product.archived", entityType: "product", entityId: id }),
  ]);
  if (!res[0].meta.changes) throw notFound("Product");
  return ok(c, { archived: true });
});

catalogRoutes.post("/products/:id/restore", async (c) => {
  const { business, user } = ownerCtx(c);
  const db = c.env.DB;
  const id = c.req.param("id");
  try {
    const res = await db.batch([
      db.prepare("UPDATE products SET archived_at = NULL, is_active = 1, updated_at = ? WHERE id = ? AND business_id = ? AND archived_at IS NOT NULL").bind(now(), id, business.id),
      auditStmt(db, { businessId: business.id, actorId: user.id, action: "product.restored", entityType: "product", entityId: id }),
    ]);
    if (!res[0].meta.changes) throw notFound("Product");
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict("Another product now uses this SKU. Change that product's SKU first.");
    throw e;
  }
  return ok(c, { restored: true });
});

// ── CSV import ────────────────────────────────────────────────────────
// The browser parses the file into string records; all validation happens here.
// Nothing is written unless every row is valid and `commit` is true.

const str = (v: unknown) => (v == null ? "" : String(v).trim());

function convertRow(raw: Record<string, unknown>): { value: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const money = (label: string, v: string, required: boolean) => {
    if (!v) {
      if (required) errors.push(`${label} is required`);
      return null;
    }
    const p = rupeesToPaise(v);
    if (p == null) errors.push(`${label} “${v}” is not a valid amount`);
    return p;
  };
  const int = (label: string, v: string, fallback: number | null) => {
    if (!v) return fallback;
    if (!/^\d+$/.test(v)) {
      errors.push(`${label} “${v}” must be a whole number`);
      return fallback;
    }
    return Number(v);
  };
  const gstRaw = str(raw.gst_rate).replace("%", "");
  let gstRateBp = 0;
  if (gstRaw) {
    const n = Number(gstRaw);
    if (!Number.isFinite(n) || n < 0 || n > 28) errors.push(`gst_rate “${str(raw.gst_rate)}” must be between 0 and 28`);
    else gstRateBp = Math.round(n * 100);
  }
  const availRaw = str(raw.availability).toLowerCase().replace(/\s+/g, "_");
  if (availRaw && !(AVAILABILITIES as readonly string[]).includes(availRaw)) errors.push(`availability must be in_stock, low_stock or out_of_stock`);
  const activeRaw = str(raw.active).toLowerCase();
  return {
    errors,
    value: {
      name: str(raw.name),
      sku: str(raw.sku),
      description: str(raw.description),
      category: str(raw.category),
      unit: str(raw.unit).toLowerCase() || "piece",
      pricePaise: money("price", str(raw.price), true) ?? 0,
      mrpPaise: money("mrp", str(raw.mrp), false),
      gstRateBp,
      minOrderQty: int("min_order_qty", str(raw.min_order_qty), 1),
      stockQty: int("stock_qty", str(raw.stock_qty), null),
      availability: availRaw || "in_stock",
      imageUrl: str(raw.image_url),
      isActive: !["no", "false", "0", "inactive"].includes(activeRaw),
    },
  };
}

catalogRoutes.post("/products/import", async (c) => {
  const { business, user } = ownerCtx(c);
  requireFeature(c, "csv");
  const input = await body(c, productImportSchema);
  const db = c.env.DB;

  const { results: existing } = await db.prepare("SELECT sku FROM products WHERE business_id = ? AND archived_at IS NULL").bind(business.id).all<{ sku: string }>();
  const existingSkus = new Set(existing.map((r) => r.sku.toLowerCase()));
  const seen = new Map<string, number>();
  const errors: { row: number; sku: string; messages: string[] }[] = [];
  const valid: any[] = [];
  // uploaded photos referenced in the file must belong to this business (e.g. from its own CSV export)
  const ownedImages = await imagesBelongTo(db, business.id, input.rows.map((r) => str((r as Record<string, unknown> | null)?.image_url)));

  input.rows.forEach((raw, i) => {
    const rowNo = i + 2; // +1 for the header line, +1 for 1-based numbering — matches the spreadsheet row
    const conv = convertRow((raw ?? {}) as Record<string, unknown>);
    const messages = [...conv.errors];
    const imageId = internalImageId(String(conv.value.imageUrl ?? ""));
    if (imageId && !ownedImages.has(imageId)) messages.push("image_url: this uploaded photo is not in your catalogue");
    const parsed = productImportRowSchema.safeParse(conv.value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) messages.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    const sku = String(conv.value.sku).toLowerCase();
    if (sku) {
      if (existingSkus.has(sku)) messages.push(`SKU “${conv.value.sku}” already exists in your catalogue`);
      if (seen.has(sku)) messages.push(`Duplicate SKU — also used on row ${seen.get(sku)}`);
      else seen.set(sku, rowNo);
    }
    if (messages.length) errors.push({ row: rowNo, sku: String(conv.value.sku), messages });
    else valid.push(parsed.data);
  });

  if (errors.length || !input.commit) {
    return ok(c, { committed: false, total: input.rows.length, validCount: valid.length, errors });
  }

  // Resolve categories by name, creating any that do not exist yet.
  const { results: cats } = await db.prepare("SELECT id, name FROM categories WHERE business_id = ? AND deleted_at IS NULL").bind(business.id).all<{ id: string; name: string }>();
  const catIds = new Map(cats.map((r) => [r.name.toLowerCase(), r.id]));
  const ts = now();
  const stmts: D1PreparedStatement[] = [];
  for (const row of valid) {
    const key = row.category?.toLowerCase();
    if (key && !catIds.has(key)) {
      const id = uuid();
      catIds.set(key, id);
      stmts.push(db.prepare("INSERT INTO categories (id, business_id, name, created_at, updated_at) VALUES (?,?,?,?,?)").bind(id, business.id, row.category, ts, ts));
    }
  }
  for (const row of valid) {
    stmts.push(
      db.prepare(
        `INSERT INTO products (id, business_id, category_id, name, sku, description, unit, price_paise, mrp_paise, gst_rate_bp, min_order_qty,
           stock_qty, availability, image_url, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        uuid(), business.id, row.category ? catIds.get(row.category.toLowerCase()) : null, row.name, row.sku, row.description ?? null, row.unit,
        row.pricePaise, row.mrpPaise ?? null, row.gstRateBp, row.minOrderQty, row.stockQty ?? null, row.availability, row.imageUrl ?? null,
        row.isActive ? 1 : 0, ts, ts,
      ),
    );
  }
  stmts.push(auditStmt(db, { businessId: business.id, actorId: user.id, action: "product.imported", entityType: "product", metadata: { count: valid.length } }));
  try {
    await db.batch(stmts); // atomic: either every row is imported or none
  } catch (e) {
    if (isConstraintError(e, "UNIQUE")) throw conflict("The catalogue changed while importing. Please re-upload the file.");
    throw e;
  }
  return ok(c, { committed: true, total: valid.length, validCount: valid.length, errors: [] }, undefined, 201);
});
