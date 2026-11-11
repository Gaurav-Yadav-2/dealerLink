-- DealerLink initial schema (Cloudflare D1 / SQLite)
-- Conventions:
--   * ids are UUID v4 strings
--   * money is stored as INTEGER paise (1 rupee = 100 paise); never floats
--   * GST rates are stored as basis points (18% = 1800)
--   * timestamps are ISO-8601 UTC strings
--   * every tenant-owned table carries business_id

-- ───────────────────────── identity ─────────────────────────
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('owner','retailer','admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  is_demo       INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,          -- SHA-256 of the cookie token; raw token is never stored
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_by TEXT REFERENCES users(id),     -- who issued the link (owner/admin) or NULL for self-service
  created_at TEXT NOT NULL
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);

CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);

-- ───────────────────────── tenants ─────────────────────────
CREATE TABLE businesses (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL COLLATE NOCASE,
  slug                TEXT NOT NULL,
  owner_user_id       TEXT NOT NULL REFERENCES users(id),
  phone               TEXT,
  email               TEXT,
  address             TEXT,
  city                TEXT,
  state               TEXT,
  gstin               TEXT,
  about               TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  suspension_reason   TEXT,
  track_inventory     INTEGER NOT NULL DEFAULT 1 CHECK (track_inventory IN (0,1)),
  low_stock_threshold INTEGER NOT NULL DEFAULT 10 CHECK (low_stock_threshold >= 0),
  gst_enabled         INTEGER NOT NULL DEFAULT 0 CHECK (gst_enabled IN (0,1)),
  order_prefix        TEXT NOT NULL DEFAULT 'DL',
  next_order_seq      INTEGER NOT NULL DEFAULT 1000,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_businesses_name ON businesses(name);
CREATE UNIQUE INDEX idx_businesses_slug ON businesses(slug);

CREATE TABLE business_members (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  created_at  TEXT NOT NULL,
  UNIQUE (business_id, user_id)
);
CREATE UNIQUE INDEX idx_business_members_user ON business_members(user_id);

CREATE TABLE retailer_profiles (
  id             TEXT PRIMARY KEY,
  business_id    TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id        TEXT UNIQUE REFERENCES users(id),   -- NULL until the retailer accepts an invitation
  business_name  TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  phone          TEXT NOT NULL,
  email          TEXT,
  address        TEXT,
  city           TEXT,
  state          TEXT,
  gstin          TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  registered_at  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_retailers_business ON retailer_profiles(business_id, status);
CREATE UNIQUE INDEX idx_retailers_business_phone ON retailer_profiles(business_id, phone);

CREATE TABLE retailer_invitations (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  retailer_id TEXT NOT NULL REFERENCES retailer_profiles(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at  TEXT,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_invitations_retailer ON retailer_invitations(retailer_id);

-- ───────────────────────── catalogue ─────────────────────────
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL COLLATE NOCASE,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_categories_name ON categories(business_id, name) WHERE deleted_at IS NULL;

CREATE TABLE products (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id   TEXT REFERENCES categories(id),
  name          TEXT NOT NULL,
  sku           TEXT NOT NULL COLLATE NOCASE,
  description   TEXT,
  unit          TEXT NOT NULL DEFAULT 'piece',
  price_paise   INTEGER NOT NULL CHECK (price_paise >= 0),
  mrp_paise     INTEGER CHECK (mrp_paise IS NULL OR mrp_paise >= 0),
  gst_rate_bp   INTEGER NOT NULL DEFAULT 0 CHECK (gst_rate_bp BETWEEN 0 AND 10000),
  min_order_qty INTEGER NOT NULL DEFAULT 1 CHECK (min_order_qty >= 1),
  -- NULL = quantity not tracked for this product. The CHECK makes overselling roll back the order batch.
  stock_qty     INTEGER CHECK (stock_qty IS NULL OR stock_qty >= 0),
  -- manual availability, used when inventory tracking is off or stock_qty is NULL
  availability  TEXT NOT NULL DEFAULT 'in_stock' CHECK (availability IN ('in_stock','low_stock','out_of_stock')),
  image_url     TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  archived_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_products_sku ON products(business_id, sku) WHERE archived_at IS NULL;
CREATE INDEX idx_products_business ON products(business_id, archived_at, is_active);
CREATE INDEX idx_products_category ON products(business_id, category_id);
CREATE INDEX idx_products_name ON products(business_id, name);

CREATE TABLE retailer_product_prices (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  retailer_id TEXT NOT NULL REFERENCES retailer_profiles(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (retailer_id, product_id)
);
CREATE INDEX idx_rpp_business ON retailer_product_prices(business_id);
CREATE INDEX idx_rpp_product ON retailer_product_prices(product_id);

-- ───────────────────────── cart ─────────────────────────
CREATE TABLE carts (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  retailer_id TEXT NOT NULL UNIQUE REFERENCES retailer_profiles(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE cart_items (
  id          TEXT PRIMARY KEY,
  cart_id     TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (cart_id, product_id)
);

-- ───────────────────────── orders ─────────────────────────
CREATE TABLE orders (
  id                TEXT PRIMARY KEY,
  business_id       TEXT NOT NULL REFERENCES businesses(id),
  retailer_id       TEXT NOT NULL REFERENCES retailer_profiles(id),
  order_number      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                      ('pending','accepted','rejected','processing','ready_for_dispatch','dispatched','delivered','cancelled')),
  payment_status    TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid')),
  subtotal_paise    INTEGER NOT NULL CHECK (subtotal_paise >= 0),
  tax_paise         INTEGER NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  discount_paise    INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  delivery_paise    INTEGER NOT NULL DEFAULT 0 CHECK (delivery_paise >= 0),
  total_paise       INTEGER NOT NULL CHECK (total_paise >= 0),
  amount_paid_paise INTEGER NOT NULL DEFAULT 0,
  retailer_note     TEXT,
  internal_note     TEXT,                    -- never returned to retailers
  source            TEXT NOT NULL DEFAULT 'retailer' CHECK (source IN ('retailer','owner')),
  placed_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (business_id, order_number),
  -- overpayment guard: a payment batch that would exceed the order total is rolled back
  CHECK (amount_paid_paise >= 0 AND amount_paid_paise <= total_paise)
);
CREATE INDEX idx_orders_business_created ON orders(business_id, created_at DESC);
CREATE INDEX idx_orders_business_status ON orders(business_id, status);
CREATE INDEX idx_orders_retailer ON orders(retailer_id, created_at DESC);

CREATE TABLE order_items (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  business_id         TEXT NOT NULL REFERENCES businesses(id),
  product_id          TEXT NOT NULL REFERENCES products(id),
  -- snapshots: historical orders never change when the catalogue does
  product_name        TEXT NOT NULL,
  sku                 TEXT NOT NULL,
  unit                TEXT NOT NULL,
  unit_price_paise    INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  line_subtotal_paise INTEGER NOT NULL CHECK (line_subtotal_paise >= 0),
  gst_rate_bp         INTEGER NOT NULL DEFAULT 0,
  gst_amount_paise    INTEGER NOT NULL DEFAULT 0 CHECK (gst_amount_paise >= 0),
  stock_deducted      INTEGER NOT NULL DEFAULT 0 CHECK (stock_deducted IN (0,1)),
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(business_id, product_id);

CREATE TABLE order_status_history (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  business_id   TEXT NOT NULL REFERENCES businesses(id),
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  actor_role    TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_osh_order ON order_status_history(order_id, created_at);

-- ───────────────────────── payments ─────────────────────────
CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id),
  retailer_id  TEXT NOT NULL REFERENCES retailer_profiles(id),
  order_id     TEXT REFERENCES orders(id),   -- set when recorded against one order; NULL = on-account
  reference    TEXT,
  payment_date TEXT NOT NULL,                -- YYYY-MM-DD
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash','upi','bank_transfer','cheque','other')),
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','reversed')),
  recorded_by  TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_payments_business ON payments(business_id, created_at DESC);
CREATE INDEX idx_payments_retailer ON payments(retailer_id, created_at DESC);
CREATE INDEX idx_payments_order ON payments(order_id);

-- How each payment was applied to orders (one row per order touched).
CREATE TABLE payment_allocations (
  id           TEXT PRIMARY KEY,
  payment_id   TEXT NOT NULL REFERENCES payments(id),
  order_id     TEXT NOT NULL REFERENCES orders(id),
  business_id  TEXT NOT NULL REFERENCES businesses(id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX idx_alloc_order ON payment_allocations(order_id);

-- Financial records are never deleted; a reversal is an explicit, attributable record.
CREATE TABLE payment_adjustments (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id),
  payment_id   TEXT NOT NULL UNIQUE REFERENCES payments(id),
  type         TEXT NOT NULL DEFAULT 'reversal' CHECK (type IN ('reversal')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  reason       TEXT NOT NULL,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_adjustments_business ON payment_adjustments(business_id, created_at DESC);

-- ───────────────────────── notifications & audit ─────────────────────────
CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at DESC);

CREATE TABLE audit_logs (
  id            TEXT PRIMARY KEY,
  business_id   TEXT REFERENCES businesses(id),
  actor_user_id TEXT REFERENCES users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  metadata      TEXT,                        -- JSON; never contains secrets
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_audit_business ON audit_logs(business_id, created_at DESC);
