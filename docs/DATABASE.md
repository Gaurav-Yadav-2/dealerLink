# DealerLink database schema

Cloudflare D1 (SQLite). Source of truth: [`migrations/0001_init.sql`](../migrations/0001_init.sql).

## Conventions

- **Ids:** UUID v4 strings.
- **Money:** `INTEGER` paise (₹1 = 100 paise). Column names end in `_paise`. Never floats.
- **GST rates:** basis points (`gst_rate_bp`; 18% = 1800).
- **Timestamps:** ISO-8601 UTC text. `payment_date` is a `YYYY-MM-DD` India date.
- **Tenancy:** every tenant-owned table has `business_id NOT NULL`.
- **Soft deletion:** `products.archived_at`, `categories.deleted_at`. Orders, payments and audit rows are never deleted.
- **Foreign keys** are enforced by D1.

## Relationships

```
users ──1:1── business_members ──N:1── businesses        (owner)
users ──1:1── retailer_profiles ──N:1── businesses        (retailer; user_id NULL until invited retailer registers)

businesses 1─N categories 1─N products
businesses 1─N retailer_profiles 1─N retailer_invitations
retailer_profiles N─M products          via retailer_product_prices (price override)
retailer_profiles 1─1 carts 1─N cart_items N─1 products
retailer_profiles 1─N orders 1─N order_items N─1 products (snapshot)
orders 1─N order_status_history
retailer_profiles 1─N payments 1─N payment_allocations N─1 orders
payments 1─0..1 payment_adjustments     (reversal)
users 1─N sessions, password_resets, notifications
```

## Tables

### Identity

**users** — `id`, `email` (unique, case-insensitive), `password_hash`, `name`, `phone`, `role` (`owner`|`retailer`|`admin`), `status` (`active`|`suspended`), `is_demo`, `last_login_at`, `created_at`, `updated_at`

**sessions** — `id`, `user_id`→users (cascade), `token_hash` (unique; SHA-256 of the session token), `csrf_token`, `expires_at`, `created_at`

**password_resets** — `id`, `user_id`→users, `token_hash` (unique), `expires_at`, `used_at`, `created_by`→users (who issued it), `created_at`

**rate_limits** — `key` (PK: limiter name + IP + subject), `window_start`, `count`

### Tenants

**businesses** — `id`, `name` (unique, case-insensitive), `slug` (unique), `owner_user_id`→users, `phone`, `email`, `address`, `city`, `state`, `gstin`, `about`, `status` (`active`|`suspended`), `suspension_reason`, `track_inventory`, `low_stock_threshold`, `gst_enabled`, `order_prefix`, `next_order_seq`, timestamps

**business_members** — `id`, `business_id`→businesses, `user_id`→users (unique: one business per owner login), `role` (`owner`), `created_at`

**retailer_profiles** — `id`, `business_id`→businesses, `user_id`→users (unique, nullable), `business_name`, `contact_person`, `phone` (unique per business), `email`, `address`, `city`, `state`, `gstin`, `status` (`active`|`inactive`), `registered_at`, timestamps

**retailer_invitations** — `id`, `business_id`, `retailer_id`→retailer_profiles, `token_hash` (unique), `expires_at`, `accepted_at`, `revoked_at`, `created_by`→users, `created_at`

### Catalogue

**categories** — `id`, `business_id`, `name` (unique per business among non-deleted), `deleted_at`, timestamps

**products** — `id`, `business_id`, `category_id`→categories (nullable), `name`, `sku` (unique per business among non-archived, case-insensitive), `description`, `unit`, `price_paise` (standard wholesale price), `mrp_paise`, `gst_rate_bp`, `min_order_qty` (≥ 1), `stock_qty` (nullable = not counted; `CHECK ≥ 0`), `availability` (manual: `in_stock`|`low_stock`|`out_of_stock`), `image_url`, `is_active`, `archived_at`, timestamps

**retailer_product_prices** — `id`, `business_id`, `retailer_id`→retailer_profiles, `product_id`→products, `price_paise`, timestamps. Unique (`retailer_id`, `product_id`).

### Cart

**carts** — `id`, `business_id`, `retailer_id` (unique), timestamps

**cart_items** — `id`, `cart_id`→carts, `business_id`, `product_id`→products, `quantity` (> 0), timestamps. Unique (`cart_id`, `product_id`). **No price is stored in the cart.**

### Orders

**orders** — `id`, `business_id`, `retailer_id`, `order_number` (unique per business, e.g. `DL1024`), `status`, `payment_status` (`unpaid`|`partial`|`paid`), `subtotal_paise`, `tax_paise`, `discount_paise`, `delivery_paise`, `total_paise`, `amount_paid_paise`, `retailer_note`, `internal_note` (wholesaler-only), `source` (`retailer`|`owner`), `placed_by_user_id`→users, timestamps

`total_paise = subtotal_paise + tax_paise − discount_paise + delivery_paise`

**order_items** — `id`, `order_id`→orders, `business_id`, `product_id`→products, snapshots `product_name`, `sku`, `unit`, `unit_price_paise`, `gst_rate_bp`; `quantity`, `line_subtotal_paise`, `gst_amount_paise`, `stock_deducted`, `created_at`

**order_status_history** — `id`, `order_id`→orders, `business_id`, `from_status`, `to_status`, `actor_user_id`→users, `actor_role`, `note`, `created_at`. One row per status change, including the initial `pending`.

### Payments

**payments** — `id`, `business_id`, `retailer_id`, `order_id`→orders (set when recorded against one order; `NULL` = on account), `reference`, `payment_date`, `amount_paise` (> 0), `method` (`cash`|`upi`|`bank_transfer`|`cheque`|`other`), `notes`, `status` (`recorded`|`reversed`), `recorded_by`→users, `created_at`

**payment_allocations** — `id`, `payment_id`→payments, `order_id`→orders, `business_id`, `amount_paise` (> 0), `created_at`. How a payment was applied; allocations of a payment sum to its amount.

**payment_adjustments** — `id`, `business_id`, `payment_id`→payments (**unique** — a payment can be reversed once), `type` (`reversal`), `amount_paise`, `reason`, `created_by`→users, `created_at`

### Notifications and audit

**notifications** — `id`, `user_id`→users, `business_id`, `type`, `title`, `body`, `link`, `read_at`, `pushed_at` (set when the phone-alert step has handled it; prevents double sends), `created_at`

**push_subscriptions** (migration 0002) — `id`, `user_id`→users (cascade), `endpoint` (unique; one per browser), `p256dh`, `auth` (the browser's public key and secret used to encrypt alerts), `created_at`, `updated_at`

**audit_logs** — `id`, `business_id` (nullable for platform actions), `actor_user_id`, `action`, `entity_type`, `entity_id`, `metadata` (JSON, never secrets), `created_at`

## Invariants enforced by the database

| Invariant | Mechanism |
|---|---|
| Stock never goes negative | `CHECK (stock_qty IS NULL OR stock_qty >= 0)` — an overselling order batch rolls back |
| An order is never overpaid | `CHECK (amount_paid_paise >= 0 AND amount_paid_paise <= total_paise)` |
| A payment is reversed at most once | `UNIQUE (payment_id)` on `payment_adjustments` |
| One invitation acceptance per retailer | `UNIQUE (user_id)` on `retailer_profiles` + guarded update |
| Unique SKUs per business (active catalogue) | Partial unique index `WHERE archived_at IS NULL` |
| Unique order numbers per business | `UNIQUE (business_id, order_number)` |
| One special price per retailer per product | `UNIQUE (retailer_id, product_id)` |
| Valid enumerations | `CHECK` on every status / role / method column |
| Amounts and quantities are sane | `CHECK >= 0` / `> 0` on money and quantity columns |

## Invariants enforced by the application (and tested)

- `orders.amount_paid_paise` = Σ allocations of non-reversed payments for that order.
- `orders.payment_status` is recomputed in the same statement that changes `amount_paid_paise` or `total_paise`.
- Rejected and cancelled orders always have `amount_paid_paise = 0` (cancellation is blocked while payments exist).
- Every statement on a tenant table includes `business_id = <session business>`.

## Indexes

Lookups by tenant and recency (`orders(business_id, created_at DESC)`, `payments(business_id, created_at DESC)`), by status (`orders(business_id, status)`), by retailer (`orders(retailer_id, created_at DESC)`, `payments(retailer_id, …)`), catalogue browsing (`products(business_id, archived_at, is_active)`, `products(business_id, category_id)`, `products(business_id, name)`), and all token hashes (unique).

## Migrations

Add a new numbered file in `migrations/` (for example `0002_add_staff.sql`) and run `npm run db:migrate` locally, then `npm run db:migrate:remote` for production. Never edit a migration that has already been applied to a deployed database.
