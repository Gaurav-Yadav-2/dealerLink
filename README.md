# DealerLink

B2B wholesale ordering and dealer management for Indian wholesalers and distributors.

A wholesaler creates a private online store, adds products, invites retailers, receives structured orders, processes them, and tracks outstanding payments. A retailer signs in, sees **their own** price list, places orders from a phone, and tracks order and payment status.

Runs entirely on Cloudflare's free tier: one Worker (API + static frontend) and one D1 database. No paid services, no payment gateway, no WhatsApp Business API, no email provider.

## What's included

| Area | Features |
|---|---|
| **Wholesaler dashboard** | KPIs and charts from live data, product catalogue (CSV import/export, archive, stock), categories, retailers and invitations, retailer-specific price lists with bulk discounts, order processing with status history, manual order entry, payments with FIFO on-account allocation and reversals, reports with date ranges and CSV export, settings, audit log |
| **Retailer portal** | Mobile-first catalogue with search and categories, server-side cart, checkout, order tracking, cancel (while pending), reorder, payment ledger, profile, English / Hindi toggle |
| **Platform admin** | Usage statistics, health check, suspend/activate businesses and users, issue password-reset links, platform audit feed |
| **Cross-cutting** | Multi-tenant isolation, role-based access, CSRF protection, rate limiting, in-app notifications with automatic phone push alerts, WhatsApp click-to-chat messages, client-side order PDF, optional GST on orders |

## Tech stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, React Router, TanStack Query, React Hook Form, Zod, Radix primitives (shadcn-style components), Lucide icons, Recharts, jsPDF
- **Backend:** Cloudflare Workers, Hono, TypeScript, REST
- **Database:** Cloudflare D1 (SQLite) with SQL migrations
- **Tests:** Vitest running inside the real Workers runtime (`workerd`) against a real local D1

## Local development

Requirements: Node.js 20+ and npm. No Cloudflare account is needed to run locally.

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Open http://localhost:5173. The API runs on port 8787 and Vite proxies `/api` to it.

### Demo accounts (local only)

`npm run db:seed` creates one demo wholesaler, two demo retailers and a demo admin. In a development build the sign-in page shows one-click buttons for them.

| Role | Email |
|---|---|
| Wholesaler | `demo.owner@dealerlink.test` |
| Retailer A (special prices) | `demo.retailer1@dealerlink.test` |
| Retailer B (special prices) | `demo.retailer2@dealerlink.test` |
| Platform admin | `demo.admin@dealerlink.test` |

Password for all four: `Demo@12345`

**These cannot become production accounts.** Every demo user is flagged `is_demo = 1`, every demo name is labelled "(Demo)", the seed script refuses `--remote`, and the API rejects demo logins unless `ALLOW_DEMO_ACCOUNTS="true"` — which is set only in your local `.dev.vars` and is `"false"` in `wrangler.jsonc`.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (wrangler) + frontend (Vite) together |
| `npm test` | All unit, API, scenario and tenant-isolation tests |
| `npm run typecheck` | TypeScript check for worker and frontend |
| `npm run build` | Production frontend build into `dist/client` |
| `npm run db:migrate` | Apply migrations to the local database |
| `npm run db:seed` | Load the demo business (local only) |
| `npm run db:reset` | Delete the local database, re-migrate and re-seed |
| `npm run create-admin -- --email … --name … --password …` | Create a platform admin (add `--remote` for production) |
| `npm run deploy` | Build and deploy to Cloudflare |

## Environment variables

Local values live in `.dev.vars` (git-ignored). Production values are the `vars` in `wrangler.jsonc`. There are **no secrets to configure** — sessions are random tokens stored hashed in D1, so no signing key is needed.

| Variable | Local | Production | Purpose |
|---|---|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:5173` | `""` | Extra origins allowed to call the API. Leave empty when the frontend and API share one origin (the default deployment). |
| `ALLOW_DEMO_ACCOUNTS` | `true` | `false` | Allows `is_demo` users to sign in. **Never enable in production.** |
| `DEV_SHOW_RESET_LINKS` | `true` | `false` | Returns the reset link from the forgot-password API so you can test the flow without help from another account. **Never enable in production.** |
| `PASSWORD_HASH_ITERATIONS` | unset | unset | Optional. PBKDF2 iterations (10,000–100,000; default and maximum 100,000). See "Free-tier limits". |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | from `npm run push:keys` | Cloudflare secrets via `npm run push:keys -- --remote` | Keys for phone alerts (Web Push). Unset = alerts off. The private key is a secret: never commit it. |
| `VAPID_SUBJECT` | unset | unset | Optional contact the push services can use (`mailto:` or `https:`). Defaults to the site's own URL. |

Bindings (in `wrangler.jsonc`): `DB` (D1 database) and `ASSETS` (static frontend).

## Deploying to Cloudflare (free tier)

You need a free Cloudflare account. No credit card is required for Workers Free and D1 Free.

1. Sign in:

```bash
npx wrangler login
```

2. Create the database and copy the `database_id` it prints into `wrangler.jsonc` (replacing the all-zero placeholder):

```bash
npx wrangler d1 create dealerlink
```

3. Apply the schema to the remote database:

```bash
npm run db:migrate:remote
```

4. Build and deploy:

```bash
npm run deploy
```

5. Create your platform admin (choose your own email and a long password):

```bash
npm run create-admin -- --email you@example.com --name "Your Name" --password "choose-a-long-passphrase-123" --remote
```

6. Switch on phone alerts (optional, free — see "Phone alerts" below):

```bash
npm run push:keys -- --remote
```

Wrangler prints your URL (`https://dealerlink.<your-subdomain>.workers.dev`). Wholesalers register at `/register`; retailers join through invitation links.

## Phone alerts (automatic notifications)

Every in-app notification is also sent automatically to the recipient's phone or computer as a push alert, even when DealerLink is closed:

- **Retailers:** order accepted / processing / ready / dispatched / delivered / rejected / cancelled, orders created for them, payments recorded.
- **Wholesalers:** new orders, orders cancelled by a retailer, retailers who join, password-reset requests.

It uses the browsers' built-in Web Push service, which is free (no WhatsApp API, SMS or paid provider). Each person turns it on once per device: retailers from the banner on their home screen or **Profile → Order alerts**, wholesalers from **Settings → Order alerts on this device**. Tapping an alert opens the order.

**Setup.** Alerts need one key pair, created by a script (no account or signup):

- Local: `npm run push:keys` (writes `.dev.vars`), then restart `npm run dev`.
- Live site: run `npm run db:migrate:remote` (adds the alert tables), then `npm run push:keys -- --remote` (stores the keys as Cloudflare secrets), then deploy.

Keep the same keys: replacing them (`--force`) means every device must turn alerts on again. Without keys, alerts are switched off and everything else works as before.

**Where it works:** Chrome, Edge, Firefox and Samsung Internet on Android and desktop. **iPhone/iPad** (iOS 16.4+) only after the user adds DealerLink to the Home Screen (Share → Add to Home Screen) and opens it from there; the app shows these instructions. Alert text is in English for now, even when the retailer uses the Hindi interface.

**Not WhatsApp.** These are phone notifications, not WhatsApp messages. The WhatsApp buttons still open a ready-made message you send yourself. Fully automatic WhatsApp needs Meta's paid WhatsApp Business API, which is not included.

To deploy from GitHub instead, push the repository and connect it under **Workers & Pages → Create → Import a repository** with build command `npm run build` and deploy command `npx wrangler deploy`.

### Free-tier limits to know about

- **Requests:** Workers Free allows 100,000 requests/day. D1 Free allows 5 million row reads and 100,000 row writes per day, 5 GB storage.
- **CPU time:** Workers Free allows 10 ms of CPU per request. Password hashing (PBKDF2, 100,000 iterations) is the one operation that may approach or exceed this on login/registration. **This has not been measured on a deployed free-plan Worker.** If sign-in fails with error 1102 ("exceeded CPU limit"), set `PASSWORD_HASH_ITERATIONS` to a lower value such as `50000` in `wrangler.jsonc` (weaker hashing for new passwords), or move to the Workers Paid plan. Existing passwords keep working either way because the iteration count is stored with each hash.
- **Rate limiting** is implemented in D1 (fixed window), which costs one write per limited request.

## Documented limitations

- **Sessions are per browser tab.** Each tab signs in on its own, so you can be a wholesaler in one tab and a retailer in another, and signing out of one tab leaves the others signed in. Trade-offs: a new tab (opened from a link or bookmark) starts signed out; a duplicated tab copies the login, so both then share one session; closing a tab ends its session; and because the token is in `sessionStorage` (readable by page scripts, unlike an `HttpOnly` cookie) an XSS bug would be more serious. The strict CSP and React's output escaping reduce that risk, but it is a deliberate departure from cookie sessions.

- **Password reset has no email.** No email provider is configured (by design — no paid services). A retailer's forgot-password request notifies their wholesaler, who creates a one-time reset link from the retailer's page and shares it (typically on WhatsApp). A wholesaler's request notifies the platform admin, who issues the link from **Admin → Users**. Links are single-use and expire in 60 minutes.
- **No advance credit.** A payment can never exceed what is outstanding (on the order, or across the retailer's orders for on-account payments).
- **Payments are records, not transactions.** There is no payment gateway. Wholesalers record cash/UPI/bank/cheque payments by hand.
- **Corrections are reversals.** A payment is never edited or deleted; reverse it (with a reason) and record a new one.
- **Orders with payments cannot be cancelled or rejected** until those payments are reversed.
- **GST is simplified.** When enabled, each product's GST rate is added on top of its price. There is no CGST/SGST/IGST split and no HSN codes; the PDF is an order summary, not a statutory tax invoice. Order-level discounts are applied after tax.
- **One retailer account per wholesaler.** A retailer login is tied to a single wholesaler; a shop buying from two DealerLink wholesalers needs two emails.
- **One owner login per business.** Staff accounts with limited permissions are not built yet.
- **Product images are URLs.** There is no image upload; products without an image show a placeholder.
- **All dates use India Standard Time** for "today", daily reports and date filters.
- **WhatsApp messages are click-to-chat links** (`wa.me`): WhatsApp opens with the message pre-filled and the user presses send. Nothing is sent automatically.
- **Hindi covers the retailer portal** only; product names and notes appear as entered.

## Security summary

Implemented and covered by automated tests: PBKDF2-SHA256 password hashing with per-password salts; opaque session tokens stored only as SHA-256 hashes; **per-tab sessions** (the token lives in each tab's `sessionStorage` and is sent in an `X-DL-Session` header — no cookies, so tabs never share or end each other's sessions); three-layer CSRF protection (Origin allow-list, custom header, per-session token); server-side role checks on every route; tenant scoping on every query; Zod validation; parameterised SQL only; D1-backed rate limiting on auth and invitation endpoints; hashed, single-use, expiring invitation and reset tokens; safe error messages; audit logging.

This MVP has **not** had an independent security review or penetration test. Treat it as a carefully built MVP, not a certified system. See `docs/ARCHITECTURE.md` for details and `TODO.md` for known gaps.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture decisions, security model, request flow, REST API reference
- [`docs/DATABASE.md`](docs/DATABASE.md) — full schema, relationships, constraints and invariants
- [`TODO.md`](TODO.md) — completed, pending and blocked work

## Project layout

```
migrations/        SQL migrations (D1)
scripts/           seed, create-admin, local reset
src/shared/        constants, money helpers and Zod schemas used by both sides
src/worker/        Hono API: lib/ (auth, crypto, orders, http) and routes/
src/web/           React app: components/, layouts/, lib/, pages/
tests/             unit, auth/security, business scenarios, tenant isolation
```
