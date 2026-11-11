# DealerLink — TODO

Status as of 2026-11-11. "Tested" means covered by the automated suite (`npm test`, 81 tests) unless marked *(UI: manual)*, which means verified by hand in a browser.

## Completed and tested

### Foundation
- [x] Project structure, Vite + React + Tailwind frontend, Hono Worker backend, single-origin deployment
- [x] D1 schema and migration (`migrations/0001_init.sql`), foreign keys, indexes, constraints
- [x] Shared Zod schemas, money helpers (integer paise), constants
- [x] Consistent API envelope, pagination, safe error handling

### Module 1 — Authentication and onboarding
- [x] Owner registration with business creation and unique slug
- [x] Login / logout, PBKDF2 hashing, hashed server-side sessions, HttpOnly + SameSite cookie
- [x] CSRF (origin allow-list + custom header + session token), CORS allow-list
- [x] Role-based access control for owner / retailer / admin
- [x] Retailer invitations: hashed, expiring, single-use, revocable
- [x] Password reset via shareable one-time links (no email — documented limitation)
- [x] Rate limiting on auth, invitation and reset endpoints
- [x] Account status: retailer deactivation, user suspension, business suspension
- [x] Two-step registration UI with live name availability *(UI: manual)*

### Module 2 — Business dashboard
- [x] Six KPIs, four charts, four activity lists, quick actions — all from live rows
- [x] Empty states and onboarding checklist for a new business *(UI: manual)*

### Module 3 — Product catalogue
- [x] Create, edit, archive, restore; search, category filter, status filter, sort, pagination
- [x] Duplicate-SKU protection
- [x] CSV import with validate-before-commit and per-row errors; CSV export
- [x] Stock: in / low / out; configurable inventory tracking; manual availability

### Module 4 — Retailer management
- [x] Add, edit, activate / deactivate, search, filter
- [x] Detail page: info, orders, payments and ledger, price list *(UI: manual)*
- [x] Invite, re-invite, revoke; password reset link

### Module 5 — Retailer-specific pricing
- [x] Standard prices, per-retailer overrides, server-side effective price resolution
- [x] Bulk percentage discount (all products or one category), clear overrides
- [x] Price list view and inline editor *(UI: manual)*
- [x] Unit-price snapshot on order items

### Module 6 — Retailer ordering portal
- [x] Catalogue with search, categories, product details, own prices
- [x] Server-side cart, quantity stepper, minimum quantity and stock validation
- [x] Checkout that sends no prices; tampered requests are ignored
- [x] English / Hindi toggle *(UI: manual)*

### Module 7 — Order management
- [x] Eight statuses with an enforced state machine and concurrency guard
- [x] Status history with actor and timestamp
- [x] Accept / reject / process / dispatch / deliver / cancel; retailer cancel while pending
- [x] Manual order entry by the wholesaler at the retailer's prices
- [x] Internal notes (hidden from retailers), discount and delivery charges
- [x] Reorder with reporting of unavailable items
- [x] Stock reservation on order and restoration on cancel / reject
- [x] Order PDF (client-side) *(UI: manual — generated without error; file contents not inspected automatically)*

### Module 8 — Payments
- [x] Manual payments: cash, UPI, bank transfer, cheque, other
- [x] Against one order, or on account with FIFO allocation
- [x] Overpayment prevented in the application and by a database constraint
- [x] Unpaid / partially paid / paid status
- [x] Reversal records instead of deletion
- [x] Ledger for wholesaler and retailer

### Module 9 — Notifications and WhatsApp
- [x] In-app notification centre for all roles
- [x] `wa.me` click-to-chat: order received, order status, order details, payment reminder, payment receipt, invitation, reset link *(UI: manual — links verified well-formed; not sent)*

### Module 10 — Reports
- [x] Orders by day / week / month, sales by retailer, sales by product, outstanding, cancelled
- [x] Date-range filter and presets, CSV export for every report

### Extras agreed during planning
- [x] On-account payments with FIFO allocation
- [x] GST on orders (per-product rate, per-line tax, business toggle)
- [x] Hindi UI for the retailer portal

### Platform admin
- [x] Statistics, health, businesses, users, suspend / activate, reset links, audit feed

### Security and isolation
- [x] Tenant-isolation tests: business ↔ business, retailer ↔ retailer, mixed-tenant writes
- [x] Scenario tests A–F from the specification
- [x] Audit logging

### Delivery
- [x] Seed data: one demo wholesaler, two demo retailers, demo admin — labelled and blocked outside dev
- [x] README, architecture, database and API documentation
- [x] Production build and `wrangler deploy --dry-run` succeed

## Pending

### Should do before real customers
- [ ] **Deploy to a real Cloudflare account and smoke-test.** Only a dry run has been done; no live deployment has been made or tested.
- [ ] **Measure password-hashing CPU time on the Workers free plan.** PBKDF2 at 100,000 iterations may exceed the 10 ms free-tier CPU limit. `PASSWORD_HASH_ITERATIONS` is the mitigation; the real behaviour is unverified.
- [ ] Automated browser (end-to-end) tests, e.g. Playwright. UI flows are currently verified by hand.
- [ ] Independent security review before handling real business data.
- [ ] Scheduled clean-up of expired `sessions`, `rate_limits` and `password_resets` rows (Cron Trigger).
- [ ] Terms of service and privacy policy pages.
- [ ] Have a native Hindi speaker review the translations.

### Product
- [ ] Staff logins with limited permissions (`business_members.role` already exists)
- [ ] Product image upload (Cloudflare R2 has a free tier; currently image URLs only)
- [ ] Edit order lines after placement (currently: cancel and re-create)
- [ ] Partial dispatch / back-orders
- [ ] Proper GST invoices: HSN codes, CGST/SGST/IGST split, invoice numbering
- [ ] Advance payments / credit balance and credit limits per retailer
- [ ] Retailer belonging to more than one wholesaler with one login
- [ ] Hindi for the wholesaler dashboard; more languages
- [ ] Abuse-report form for retailers (admins can currently suspend with a recorded reason)
- [ ] Optional email delivery for invitations and resets when a provider key is configured
- [ ] Print-friendly order view; multi-order PDF

### Technical
- [ ] Reduce the initial JavaScript bundle (currently ~145 kB gzipped before page chunks); audit shared dependencies
- [ ] Migrate `@cloudflare/vitest-pool-workers` to its renamed package `@cloudflare/vitest-plugin`
- [ ] Composite foreign keys including `business_id` for database-level tenant enforcement (currently enforced in queries and tests)
- [ ] Typed API client instead of `any` for response rows in the frontend
- [ ] Offline tolerance / retry queue for flaky mobile connections
- [ ] Accessibility audit with a screen reader

## Blocked

- Nothing is blocked. The two items that need the account owner are deployment (requires your Cloudflare login) and pushing to GitHub (requires your repository).

## Known limitations

See "Documented limitations" in `README.md`.
