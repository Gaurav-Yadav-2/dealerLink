/** Product photos stored in D1. Uploaded photos are referenced from products as "/api/images/<id>". */
export const MAX_IMAGE_BYTES = 400_000;
export const MAX_IMAGES_PER_BUSINESS = 5000;
export const INTERNAL_IMAGE_RE = /^\/api\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Identifies the real file type from its first bytes; the browser-supplied Content-Type is never trusted. */
export function sniffImageType(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** The image id if `url` points at an uploaded photo, otherwise null (external links are left alone). */
export const internalImageId = (url: string | null | undefined): string | null => (url ? INTERNAL_IMAGE_RE.exec(url)?.[1] ?? null : null);

/** True if every uploaded photo referenced in `urls` belongs to this business. */
export async function imagesBelongTo(db: D1Database, businessId: string, urls: (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(urls.map(internalImageId).filter((x): x is string => !!x))];
  const owned = new Set<string>();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { results } = await db
      .prepare(`SELECT id FROM product_images WHERE business_id = ? AND id IN (${chunk.map(() => "?").join(",")})`)
      .bind(businessId, ...chunk)
      .all<{ id: string }>();
    for (const r of results) owned.add(r.id);
  }
  return owned;
}

/** D1 may return a BLOB column as an ArrayBuffer or as an array of byte values, depending on runtime version. */
export function blobBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Uint8Array.from(value as number[]);
}
