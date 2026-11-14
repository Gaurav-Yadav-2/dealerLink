# DealerLink architecture

## Overview

```
Browser (React SPA)
   │  same-origin fetch, per-tab session header + CSRF header
   ▼
Cloudflare Worker (Hono)
   ├── /api/*      REST API ── D1 (SQLite)
   └── everything else ── static assets (dist/client), SPA fallback to index.html
```

One Worker serves both the API and the built frontend, so there is a single deployment, a single origin and no cross-origin cookies. In development Vite serves the frontend on port 5173 and proxies `/api` to `wrangler dev` on 8787.

## Key decisions

| Decision | Why |
|---|---|
| **Single Worker for API + assets** | One free deployment; same-origin removes most CORS and cookie complexity. |
| **Opaque server-side sessions in D1**, not JWTs | Sessions can be revoked instantly (logout, password change, deactivation, suspension) and no signing secret has to be managed. Only the SHA-256 hash of the token is stored. |
| **Per-tab sessions** (header token in `sessionStorage`, no cookie) | Requested behaviour: each tab is an independent login, so one person can be a wholesaler in one tab and a retailer in another, and logging out of one tab does not log out the others. Cookies are shared by all tabs of a browser, so they cannot do this. |
| **PBKDF2-SHA256 via WebCrypto** | The strongest password KDF available natively in the Workers runtime without shipping WASM. 100,000 iterations is the runtime maximum. |
| **Money as integer paise** | No floating-point arithmetic anywhere. GST and percentage discounts use integer maths with explicit half-up rounding. |
| **Atomic `batch()` + SQL `CHECK` constraints** for consistency | D1 has no interactive transactions. Each business operation is one `db.batch()` (all-or-nothing), and the database itself rejects impossible states: stock below zero, paid amount above the order total, double reversal. A violated constraint rolls the whole batch back. |
| **Guarded status updates** | `UPDATE orders SET status = ? WHERE id = ? AND status = <the status we read>`; follow-up statements in the same batch only apply if that update won. Two people acting on one order cannot both succeed. |
| **Prices resolved only on the server** | One function (`pricedProducts` in `src/worker/lib/orders.ts`) resolves a retailer's effective price. The cart stores product ids and quantities only; checkout sends nothing but an optional note. |
| **Snapshots on order items** | Name, SKU, unit, unit price and GST rate are copied onto each order line, so history never changes when the catalogue does. |
| **Payment allocations** | A payment is applied to one order or FIFO across the oldest unpaid orders. `payment_allocations` records exactly how, which makes reversals exact. |
| **Shared Zod schemas** (`src/shared`) | The same validation runs in the browser (fast feedback) and on the server (authoritative). |
| **Notifications by polling** | The bell refetches every 60 s. No WebSockets or Durable Objects, which keeps the app on the free tier. |
| **Phone alerts via Web Push, implemented with WebCrypto** | Automatic and free (browser vendors' push services). No library: RFC 8291 encryption + RFC 8292 VAPID in `src/worker/lib/webpush.ts`, tested against the RFC 8291 example vector. |
| **Per-business feature switches** | `business_features` stores only explicit switches (missing row = on). They are loaded with the session (`authForUser`) and exposed as `features` on `/api/auth/me`. Server checks use `requireFeature()`; price lookups take a `useSpecialPrices` flag; a GST switch-off overrides `gst_enabled` in the session's business row. One codebase for every customer — customisation is configuration, never forked code. |
| **One push hook for every notification** | Instead of calling push at each call site, the API middleware runs after every successful change and pushes the notifications that change created. Each row is claimed atomically (`UPDATE … SET pushed_at … RETURNING`), so nothing is pushed twice, and any future notification type gets phone alerts automatically. Sending happens in `waitUntil`, after the response. |
| **Charts: single hue, no pies, no dual axes** | Every chart shows one series; values are also available as tables. |

## Multi-tenancy and authorisation

Each wholesaler is a tenant (`businesses`). Every tenant-owned table has `business_id`.

**Identity is derived only from the session token (the `X-DL-Session` header).** `loadAuth()` resolves the user, then `authForUser()` attaches the business (for owners, via `business_members`) or the retailer profile and its business (for retailers). This is the single place tenancy is decided. Nothing identity-related is ever read from a request body, query string or header; extra fields such as `businessId` or `role` in a body are simply ignored.

Three guards wrap the three API areas:

| Prefix | Guard | Scope applied to every query |
|---|---|---|
| `/api/biz/*` | `ownerCtx` — role `owner`, business active | `business_id = <session business>` |
| `/api/retailer/*` | `retailerCtx` — role `retailer`, retailer active, business active | `business_id = <session business>` **and** `retailer_id = <session retailer>` |
| `/api/admin/*` | `adminCtx` — role `admin` | platform-wide, read-mostly |

Foreign ids are treated exactly like ids that do not exist: looking up another tenant's record returns `404`, never `403`, so the API does not reveal that the record exists.

What a retailer can never see: other retailers' data, the standard price when they have a special price, other retailers' special prices, internal notes, stock of other tenants. The portal queries select only the retailer's own effective price as `price_paise`.

`tests/isolation.test.ts` builds two complete businesses and attempts every cross-tenant and cross-retailer path.

## Security controls

| Control | Implementation |
|---|---|
| Password hashing | PBKDF2-HMAC-SHA256, 16-byte random salt, 100,000 iterations, constant-time comparison. A dummy hash is verified for unknown emails so timing does not reveal which emails exist. |
| Bot check | Optional Cloudflare Turnstile on register, login, forgot-password and invitation accept (`X-Turnstile-Token` header, verified server-side with `siteverify`; fails closed). Off until `TURNSTILE_SECRET_KEY` is set. |
| Sessions | 256-bit random token returned once at sign-in and kept by the browser in **that tab's `sessionStorage`**, sent in the `X-DL-Session` header; ends after 12 hours idle (`last_seen_at`, refreshed at most every 5 minutes) or 7 days absolute. `POST /api/auth/logout-all` ends every session of the user. No cookies are used, so every tab has an independent session and logout ends only the current tab's session. Only `sha256(token)` is stored. All of a user's sessions are deleted on password reset, deactivation and suspension. Trade-off versus an `HttpOnly` cookie: page scripts can read the token, so XSS would be more damaging; the CSP (`script-src 'self'`) and React escaping mitigate it. |
| CSRF | (1) `Origin` must be the app's own origin or in `ALLOWED_ORIGINS`; (2) every mutation must carry `X-DL-Client: web`, which a cross-site form cannot set; (3) every authenticated mutation must carry the per-session `X-CSRF-Token`. Pre-session endpoints (login, register, reset, accept-invite) are covered by 1 and 2 plus rate limits. |
| CORS | No cross-origin access unless the origin is explicitly listed in `ALLOWED_ORIGINS`. |
| Rate limiting | Fixed-window counters in D1 keyed by IP (and email where relevant): login 8 per 10 min per IP+email and 40 per IP; register 10/hour; forgot-password 3/hour per email; invitation view/accept; reset; order placement. |
| Tokens | Invitation (7 days) and reset (60 minutes) tokens are 256-bit, stored hashed, single-use. Issuing a new invitation revokes older ones. |
| Input | Zod on every body; all SQL is parameterised; `LIKE` wildcards are escaped; sort columns come from an allow-list. |
| Errors | `AppError` carries a safe message. Anything else returns a generic 500 and logs only the error message server-side. |
| Headers | `nosniff`, `no-store` on API responses; CSP, `X-Frame-Options: DENY`, `Referrer-Policy` on static assets via `public/_headers`. |
| Audit log | Registration, settings, products (with price changes), retailers, invitations, pricing, orders, payments, reversals, password changes and admin actions. |
| CSV export | Cells beginning with `= + - @` are prefixed to prevent spreadsheet formula injection. |

Not done: independent security review, penetration test, 2FA, account lockout beyond rate limiting, breach-password checks. See `TODO.md`.

## Core workflows

**Order creation** (`createOrder`): merge duplicate lines → load products with the retailer's effective prices (scoped by `business_id`) → validate active/min-quantity/stock → compute line totals, GST and total → take the next order number → one batch: insert order, items and first history row, decrement stock, clear cart, audit, notify. A stock `CHECK` failure rolls everything back and returns `409`.

**Status changes** (`changeOrderStatus`): validate against `ORDER_TRANSITIONS` (retailers may only cancel a pending order) → guarded update → history row → on cancel/reject, restore reserved stock. Cancel/reject is refused while payments are recorded against the order.

```
pending ──► accepted ──► processing ──► ready_for_dispatch ──► dispatched ──► delivered
   │            │             │  └──────────────────────────────►┘
   ├► rejected  └► cancelled  └► cancelled      (ready_for_dispatch ► cancelled)
   └► cancelled (retailer or wholesaler)
```

**Payments**: amount must be ≤ outstanding (order, or retailer total for on-account) → one batch: payment row, allocation rows, `amount_paid_paise` and `payment_status` on each order. The overpayment `CHECK` protects against two simultaneous payments. **Reversal**: adjustment row (unique per payment), payment marked `reversed`, allocations subtracted.

**Outstanding** = Σ (`total_paise − amount_paid_paise`) over orders that are not rejected or cancelled. Orders count from the moment they are placed.

## REST API

All responses are JSON: `{ "data": … , "meta"?: … }` on success, `{ "error": { "code", "message", "details"? } }` on failure. Lists accept `page` and `pageSize` (max 100) and return `meta: { page, pageSize, total }`. Keys are camelCase. Amounts are integer paise.

Status codes: `400` malformed, `401` not signed in, `403` wrong role / CSRF / suspended, `404` not found (including other tenants' records), `409` conflict with current state, `422` validation, `429` rate limited.

### Public and auth

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/public/store/:slug` | Minimal public store card |
| GET | `/api/auth/me` | Current session (or `null`) and CSRF token |
| GET | `/api/auth/check-business-name?name=` | Name availability and slug preview |
| POST | `/api/auth/register` | Register owner + business |
| POST | `/api/auth/login` · `/logout` · `/change-password` | Session management |
| GET | `/api/auth/invitations/:token` | Invitation details |
| POST | `/api/auth/invitations/:token/accept` | Retailer registration |
| POST | `/api/auth/forgot-password` · `/reset-password` | Password reset |

### Wholesaler — `/api/biz`

| Method | Path | Purpose |
|---|---|---|
| GET | `/dashboard` | KPIs, charts and recent activity |
| GET, PATCH | `/settings` | Business profile, inventory and GST settings |
| GET | `/audit-log` | Last 50 audit entries |
| GET, POST | `/categories` · PATCH, DELETE `/categories/:id` | Categories |
| GET, POST | `/products` (filters `q`, `categoryId`, `status`, `sort`) | Catalogue |
| GET, PATCH, DELETE | `/products/:id` · POST `/products/:id/restore` | Edit, archive, restore |
| GET | `/products/export` | All products for CSV export |
| POST | `/products/import` `{ rows, commit }` | Validate (and optionally commit) a CSV import |
| GET, POST | `/retailers` · GET, PATCH `/retailers/:id` | Retailers |
| POST, DELETE | `/retailers/:id/invite` | Create / revoke invitation |
| POST | `/retailers/:id/reset-link` | One-time password reset link |
| GET | `/retailers/:id/ledger` | Purchases, payments, outstanding |
| GET, PUT | `/retailers/:id/prices` · POST `/retailers/:id/prices/bulk` | Price list, overrides, bulk discount |
| GET, POST | `/orders` (filters `q`, `status`, `paymentStatus`, `retailerId`, `from`, `to`) | List, manual order |
| GET, PATCH | `/orders/:id` · POST `/orders/:id/status` | Detail, notes/charges, status |
| GET, POST | `/payments` · POST `/payments/:id/reverse` | Payments and reversals |
| GET | `/reports/summary` · `/orders?group=day\|week\|month` · `/sales-by-retailer` · `/sales-by-product` · `/outstanding` · `/cancelled` | Reports (`from`, `to`) |

### Retailer — `/api/retailer`

| Method | Path | Purpose |
|---|---|---|
| GET | `/store` · `/dashboard` | Store info, categories, summary |
| GET | `/products` · `/products/:id` | Catalogue with the retailer's prices |
| GET, DELETE | `/cart` · PUT `/cart/items` `{ productId, quantity }` | Cart |
| POST | `/orders` `{ note }` | Checkout from the cart |
| GET | `/orders` · `/orders/:id` | History and tracking |
| POST | `/orders/:id/cancel` · `/orders/:id/reorder` | Cancel (pending only), reorder |
| GET | `/ledger` | Purchases, payments, outstanding |
| GET, PATCH | `/profile` | Own profile |

### Shared and admin

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/notifications` · POST `/read-all` · POST `/:id/read` | Notification centre |
| GET | `/api/push/key` | Whether phone alerts are configured, and the public VAPID key |
| POST | `/api/push/subscribe` · `/unsubscribe` · `/status` · `/test` | Turn alerts on/off for this browser, check whose they are, send a test alert |

**Phone alert safeguards:** subscriptions are accepted only for the browser vendors' push hosts (Google, Mozilla, Apple, Microsoft) over HTTPS, so the server never posts to arbitrary URLs; at most 5 devices per user; at most 20 pushes per request (Workers Free allows 50 outbound requests); suspended users and deactivated retailers receive nothing; subscriptions the push service reports as gone (404/410) are deleted. One browser holds one subscription: if two accounts use the same browser, alerts go to whoever turned them on last.
| GET | `/api/admin/stats` · `/audit` | Platform statistics, health, audit feed |
| GET | `/api/admin/businesses` · POST `/businesses/:id/status` | Suspend / activate businesses |
| GET | `/api/admin/users` · POST `/users/:id/status` · POST `/users/:id/reset-link` | User management |

## Frontend

- **Routing and guards:** `App.tsx`; `RequireRole` redirects by role. The server enforces the same rules — guards are for navigation only.
- **Data:** TanStack Query through `useApi` / `useAction` (`src/web/lib/hooks.ts`). Every mutation invalidates cached lists so totals never go stale. A `401` on any query clears the cached session.
- **Filters** live in the URL (`useUrlFilters`), so they survive refresh and back/forward.
- **Code splitting:** each page is a lazy chunk; charts and jsPDF load only where used.
- **Design system:** tokens in `src/web/index.css`, components in `src/web/components/ui.tsx`.
- **i18n:** `src/web/lib/i18n.tsx` (English/Hindi) for the retailer portal.

## Testing

`npm test` runs 81 tests inside `workerd` with a real D1 database:

- `tests/unit.test.ts` — money, GST rounding, schemas, crypto, pricing rules
- `tests/auth.test.ts` — registration, sessions, CSRF, origin checks, RBAC, rate limiting, invitations, password reset, admin suspension
- `tests/scenarios.test.ts` — business scenarios A–F from the specification, stock, GST, FIFO payments, reversals, CSV import, reports
- `tests/isolation.test.ts` — cross-tenant and cross-retailer access attempts

The UI was verified manually in a browser for the main flows; there are no automated browser tests yet.
