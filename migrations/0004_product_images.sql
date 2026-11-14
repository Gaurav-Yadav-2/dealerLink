-- Product photos uploaded from a phone or computer. The browser resizes and compresses each photo
-- (typically 50-150 KB) before upload, so they fit comfortably in D1 without a separate storage service.
CREATE TABLE product_images (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/webp','image/jpeg','image/png')),
  bytes        INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 400000),
  data         BLOB NOT NULL,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_product_images_business ON product_images(business_id);
