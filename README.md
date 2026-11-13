# KHAN G Wholesale Ordering App

A mobile-first, installable web app (PWA) for **KHAN G**, a wholesale business selling sealed cartons/boxes of biscuits, candies, toffees, nimko, snacks and other packaged goods. Approved shopkeepers order cartons with big **+ / −** buttons, send the order to KHAN G on **WhatsApp (click-to-chat)**, and follow its status. The owner reviews availability, manages stock, issues private PDF invoices, keeps a per-shop ledger and sees reports.

- **Languages:** Urdu (right-to-left, Nastaliq font) and English, switchable anywhere.
- **Themes:** light, dark, or automatic (follows the phone); saved per device and per account.
- **Devices:** phones first; also tablets and Windows laptops. Installable on Android, iPhone/iPad and Windows, plus an **Android APK** ([docs/ANDROID.md](docs/ANDROID.md)).
- **Responsive:** the browser tests check 9 screen sizes, from 320 px phones through phone landscape and tablets to 1920 px desktops, on every screen.

> Test results: see [TEST_REPORT.md](TEST_REPORT.md).

---

## Roles

| Role | Can do |
|---|---|
| **Owner / Admin** | Everything: dashboard, products & photos, categories, stock, shops (create, approve, deactivate, reset password), orders (availability review, substitutions, status, internal notes), invoices (PDF), ledger & payments, reports (CSV), reminder settings, business settings. |
| **Approved shopkeeper** | Sign in with mobile number + password/PIN; browse/search the catalogue; cart; place orders; send on WhatsApp; see own orders (last 15 days by default, older on request), own invoices, own ledger/balance, notifications; set language, theme and reminder opt-out. |

Shopkeepers **cannot** see other shops’ orders, invoices, balances, payments or notifications, nor internal stock numbers. This is enforced in the database with Row Level Security (RLS) and tested (`tests/integration/rls.test.ts`).

There is **no public sign-up**. The owner creates each shop’s account; an account can be created as *waiting for approval* and approved later. Pending and inactive accounts cannot sign in.

---

## Technology (free-first)

| Part | Choice | Why |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite, hand-written accessible CSS (logical properties → correct RTL) | Small bundle (~85 KB gzip main chunk), mature PWA tooling (`vite-plugin-pwa`/Workbox). |
| API | [Hono](https://hono.dev) (TypeScript) | Runs on Node today and is Cloudflare-Workers-compatible later. |
| Database | PostgreSQL — **Supabase free tier** in production; embedded PostgreSQL 17 locally | Migrations in `supabase/migrations/` use Supabase conventions (`auth.uid()`, roles `anon`/`authenticated`). |
| Auth | Mobile number + password/PIN, bcrypt hashes, signed httpOnly session cookie | **Free**: no SMS costs. (Supabase phone OTP needs a paid SMS provider such as Twilio — not used.) |
| Photos | Stored in PostgreSQL (`product_images`), resized in the browser to ≤ 800 px JPEG | Works on any PostgreSQL incl. Supabase free tier, no second service. ~190 photos × ~80 KB ≈ 15 MB of the 500 MB free DB. |
| PDF | [pdf-lib](https://pdf-lib.js.org) (open source), generated on request from the stored invoice snapshot | Repeatable output; no stored public file; works in Node and Workers. |
| Hosting (later) | Cloudflare Pages/Workers or any Node host | See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). |

**Why not Supabase Auth + Storage directly from the browser?** It would require exposing table-level APIs to the browser and SMS OTP costs money. Instead the browser talks only to our API; the API runs every request inside PostgreSQL as the `authenticated` role with the user id in `request.jwt.claims` — the same mechanism Supabase uses — so the RLS policies are the real security boundary and work unchanged on Supabase. The service-role key is never needed or exposed.

---

## Quick start (local)

Requirements: Node.js 20+. No Docker needed.

```bash
npm install
npm run dev            # embedded PostgreSQL + API (:8787) + web app (:5173), demo data loaded
```

Open http://localhost:5173.

Demo accounts (local/preview demo data only — **never use in production**):

| Who | Mobile | Password |
|---|---|---|
| Owner (admin) | 0300 0000001 | `KhanG@admin1` |
| Shopkeeper (Urdu) | 0300 1110001 | `shop1234` |
| Shopkeeper (English) | 0300 1110003 | `shop1234` |
| Waiting approval | 0300 1110006 | `shop1234` (cannot sign in) |
| Inactive | 0300 1110007 | `shop1234` (cannot sign in) |

Production-like local run (built app served by the API):

```bash
npm run build
npx tsx scripts/serve-local.ts     # http://localhost:8787
```

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev: embedded PostgreSQL, API with auto-reload, Vite dev server |
| `npm run build` | Builds the PWA into `dist/` (incl. service worker + manifest) |
| `npm start` | Runs the production server (`DATABASE_URL` required) |
| `npm run db:migrate` | Applies `supabase/migrations/*.sql` in order, once each; creates the first admin from env |
| `npm run db:seed-demo` | Loads demo data (only if there are no products yet) |
| `npm test` | Unit + integration tests (starts its own throw-away PostgreSQL) |
| `npm run test:e2e` | Browser end-to-end tests (needs `npm run build` and Chromium; `CHROMIUM_PATH` to override) |
| `npm run typecheck` | TypeScript check |
| `npm run icons` | Regenerates app icons |

### Environment variables

See [.env.example](.env.example). Never commit `.env`. Required in production:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL / Supabase connection string (server-side only) |
| `SESSION_SECRET` | ≥ 32 random characters (`openssl rand -base64 48`) |
| `ADMIN_PHONE`, `ADMIN_PASSWORD` | First owner account, created once when no admin exists |
| `BUSINESS_WHATSAPP` | Number that receives WhatsApp orders (also editable in Settings) |
| `APP_ORIGIN` | Recommended: the public URL, e.g. `https://app.example.com`; POSTs from other sites are refused |
| `CRON_SECRET` | Only if an external scheduler calls `/api/cron/reminders` |
| `DEVBENCH_NOTIFY_URL`, `DEVBENCH_NOTIFY_TOKEN` | Optional: production failure alerts to the team chat |

Nothing business-specific (WhatsApp number, business name, address) is hard-coded: it lives in **Admin → Settings** and is seeded from env on first start.

---

## Supabase setup (production database)

1. Create a free project at supabase.com (choose a region close to Pakistan, e.g. Mumbai/Singapore).
2. **Authentication → Providers:** you can leave Email/Phone disabled — this app does not use Supabase Auth. Disable sign-ups.
3. Copy the database connection string (Project Settings → Database). Put it in `DATABASE_URL` on the server only.
4. Run migrations: `DATABASE_URL=... npm run db:migrate` (or set `AUTO_MIGRATE=true`, the default, and start the server). The migrations detect that `anon`, `authenticated` and `auth.uid()` already exist on Supabase.
5. Do **not** put any Supabase key in the frontend. The browser never talks to Supabase directly.

Free-tier limits to know: 500 MB database, free projects can be paused after a period of inactivity (check Supabase’s current policy; a paused project is resumed from the dashboard), daily backups are **not** included on the free plan — export regularly (see *Backups*).

---

## How the owner works

**Create and approve shopkeepers** — Admin → Shops → *Add shop*: shopkeeper name, mobile (any common format, e.g. `0300-1234567`; stored as `+923001234567`), shop name, optional address/location note, language, and a password/PIN (a random 6-digit PIN is suggested). Tick *Approve now* or leave it waiting and press **Approve** later. Optionally force a new password at first sign-in. Duplicate mobile numbers are refused. **Deactivate** signs the shop out immediately.

**Products and photos** — Admin → Products → *Add product*: code (SKU), English/Urdu names and descriptions, category, unit (Carton/Box/Pack/Dozen/Piece; labels editable), pieces per unit, wholesale price, *show price to shops*, opening stock, low-stock alert level, sort order. After saving, **Upload photo** (camera or file; JPEG/PNG/WebP; resized automatically). Products used in past orders are **archived**, never deleted, so old orders and invoices stay intact.

**Customer details** — each shop record holds shop name, owner name, mobile, WhatsApp number, other phone, address, area/market, city, location note, shop type, email, CNIC and NTN (all except name/mobile optional; phones, email and CNIC are validated and normalized). The owner can also keep **private notes and a credit limit** (never visible to the shop; an *Over credit limit* warning shows on the shop page). Admin → Shops → **Export customers (CSV)** downloads the full list. Shopkeepers see their own record read-only in Account → *My shop details*.

**Contact number shown to shopkeepers** — Admin → Settings → *Contact number for shopkeepers*: the WhatsApp number (orders are sent there) and a phone number, with a live preview. Shopkeepers see it on the sign-in screen, in Account (*Chat on WhatsApp* / *Call* buttons) and after placing an order.

**Categories** — Admin → Categories: add, rename, hide. A category with products cannot be deleted.

**Stock** — Admin → Stock (or a product): *Adjust stock* with a reason (restock, count correction, damaged/expired, returned). Every change is recorded with who/when/why.

---

## How ordering works

1. Shopkeeper opens the app (signed in for 30 days per device) and sees the catalogue: photo, name, unit, availability badge (text + icon, not colour only), price if the owner shows prices.
2. Taps **Add**, then **+ / −** (or types a number; 1–999). Out-of-stock items cannot be added. A cart bar shows items and units.
3. **Cart**: change quantities, remove (with confirmation), optional note, estimated total (if prices shown). Empty carts cannot be submitted.
4. **Place order**: saved in the database first with a reference like `KG-261113-0042`, the time, shop, items and a **snapshot** of names and prices. The price always comes from the database, never from the phone.
5. **Send order on WhatsApp** opens WhatsApp with a pre-filled message to the business number (shop, customer, reference, every item with quantity and unit, total items/units). *The shopkeeper must press Send in WhatsApp — the app cannot send WhatsApp messages by itself.* If WhatsApp is not installed or the number is not set, the order is still saved and visible to the owner.
6. **My orders**: last 15 days (button for older), with clear status: *Order received → Checking stock → (Some items changed) → Confirmed → Ready for delivery → Delivered*, or *Cancelled*. Shops can cancel while the order is still *received*. **Repeat last order** refills the cart, skipping items that are now unavailable. Favourites (♥) filter.

### Owner order review

Admin → Orders (filter by status, shop, dates, reference). In an order: set the **approved quantity** per line (never above the request), optional rate and a note the shop will see; add an explicit **replacement** line (the original request stays visible as *Replaced*); add **internal notes** (never shown to shops); change status. Every review change is recorded in the audit log. Original requested and final approved quantities are both kept.

### Inventory rule (when stock changes)

- Submitting an order **does not reserve stock** (no real-time reservation is promised). The catalogue only shows *Available / Limited stock / Out of stock*; out-of-stock products cannot be ordered.
- Stock is **deducted when the owner confirms** the order (status → *Confirmed*), using the approved quantities. Confirmation is refused if stock is insufficient, naming the product.
- **Cancelling** a confirmed/ready order puts the stock back. *Delivered* is final.

### Invoices (private PDF)

After confirmation, **Create invoice**: number `INV-YYMM-00001`, issue date, business details (from Settings), shop details, approved lines, rates, total, previous balance and balance after. The invoice and its lines are stored as a snapshot, so later price/name/setting changes never alter it; the PDF is regenerated identically on demand. Only the owner and that shop can open it — there is no public or guessable URL (`/api/invoices/<id>/pdf` requires the session and passes RLS). The in-app invoice page also shows Urdu product names and can be printed. Cancelling an invoiced order voids the invoice and credits the ledger.

### Ledger and payments

Per shop: invoice (debit), payment (credit; cash/bank/mobile wallet/cheque/other, reference, note), adjustments and opening balance (with a required note), invoice voids. Running balance = debits − credits (positive = shop owes). The shop sees its own balance and history. This is a simple customer account record — **not tax or accounting-compliance software**.

### Reports

Admin → Reports → **Sales by period**: **Daily, Weekly (Mon–Sun), Monthly or Yearly** buckets with orders, cancelled, shops ordering, units asked/confirmed, invoices, invoiced value and payments, a bar chart, totals, and a comparison with the previous period (previous calendar month/year for whole months/years). Quick ranges: Today, This week, This month, Last month, This year, Last 12 months, Last 5 years, or any custom range. Other reports: summary, sales by shop, product quantities, balances, low stock. All export to CSV. **Cancelled orders are excluded.** Money values come only from issued invoices and recorded payments — no values are estimated.

### Weekly reorder reminders (in-app)

- Each shop’s reminder day = the weekday of its **latest non-cancelled order** (or an admin override per shop, or one fixed weekday for all shops), at the configured time (default 10:00, Asia/Karachi).
- On that day the shop gets an **in-app** reminder: *“You ordered from KHAN G last Monday. Would you like to place an order this week?”* It shows as a banner on the catalogue and in notifications; tapping it refills the cart from the last order.
- **No duplicates:** at most one reminder per shop per week (ISO week, database-enforced). If the shop already ordered this week, no reminder is sent (logged as skipped).
- Admin can switch reminders off globally or per shop, change the time/rule, and see the history; shopkeepers can turn reminders off in Account.
- Runs every 5 minutes inside the server, on every shop app visit, and via `POST /api/cron/reminders` (Bearer `CRON_SECRET`) for an external scheduler.
- **Not included:** automatic WhatsApp or SMS reminders (needs WhatsApp Business Platform approval, templates and usually costs). **Web Push** is not implemented yet (optional future work).

---

## Installing the app (shopkeepers)

The same steps are in the app (Account → *Install the app*) in Urdu and English.

| Device | Steps |
|---|---|
| **Android (Chrome)** | Open the app link in Chrome → ⋮ menu → *Install app* / *Add to Home screen* → Install. (Chrome may also show an Install button in the app.) |
| **iPhone / iPad (Safari)** | Open the link in **Safari** → Share button → *Add to Home Screen* → Add. iPhone has no install pop-up; Chrome on iPhone cannot install. |
| **Windows (Chrome / Edge)** | Open the link → install icon in the address bar (or menu → Apps → Install) → Install → open from Start menu. |

**Offline:** the app opens without internet and shows screens/catalogue already loaded, with an *offline* notice. Signing in, live stock, placing orders, invoices and WhatsApp **need internet**. Orders are never queued offline.

**Important:** remote shopkeepers can only use the app after it is deployed online (see below). An app running on the owner’s computer is not reachable from shops’ phones.

---

## Android app (APK)

`android/` contains a small native Android app (~45 KB) that opens the KHAN G server full-screen and hands WhatsApp/phone links to their apps; PDFs/CSVs download to *Downloads*. Build with `scripts/build-android.sh https://your-server` → `dist-android/KHAN-G.apk`. Details, signing key care, sharing and Play Store notes: [docs/ANDROID.md](docs/ANDROID.md).

## Security notes

- RLS is enabled on every table; policies are in `supabase/migrations/0003_security_rls.sql` and tested.
- Shopkeepers create orders only through `place_order()` which validates quantities (whole numbers 1–999), product availability and duplicates, and takes prices from the database.
- Password hashes live in a separate table no app role can read. Sessions: signed, httpOnly, SameSite=Lax cookies; state-changing requests need a custom header (CSRF protection); 5 wrong passwords lock the account for 15 minutes; deactivation ends sessions immediately.
- Errors returned to the browser never include SQL or stack traces.
- Uploaded photos are type-checked by content (JPEG/PNG/WebP only), served with `nosniff` and a sandbox CSP.
- **Never expose** `DATABASE_URL`, `SESSION_SECRET`, Supabase service-role keys or `DEVBENCH_NOTIFY_TOKEN` in the frontend or in git.

## Monitoring

Server logs are JSON lines (`order_placed`, `order_status_changed`, `invoice_created`, `payment_recorded`, `login_failed`, `reminders_run`, …). Unhandled API errors (HTTP 500) and repeated reminder-job failures are posted to the team chat when `DEVBENCH_NOTIFY_URL`/`DEVBENCH_NOTIFY_TOKEN` are set (throttled to one per error type per 10 minutes).

## Backups / export

- Supabase free plan has no automatic backups: run `pg_dump "$DATABASE_URL" > khan-g-$(date +%F).sql` regularly (weekly at least) and keep copies off the server.
- Reports and ledgers export to CSV from the admin screens.

## Deployment

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — Cloudflare + Supabase, custom domain, HTTPS, and what each free tier allows.

## Project layout

```
supabase/migrations/   SQL schema, RLS policies, order functions (applied in order, once each)
server/                Hono API (app.ts), Node entry (node.ts), lib/ (auth, orders, invoices, reports, reminders)
shared/                Code used by browser and server (phone numbers, WhatsApp message, cart, statuses, time zones)
src/                   React PWA (pages/shop, pages/admin, i18n en/ur, components)
scripts/               dev runner, embedded PostgreSQL, migrations, demo seed, icons
tests/unit|integration|e2e   Vitest unit + API/RLS tests, Playwright browser tests
```
