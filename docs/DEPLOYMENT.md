# Deploying KHAN G online (free-first)

The app is developed and tested locally. Shopkeepers can only use it from their own phones once it is **deployed to the internet** — an app running on the owner’s laptop is not reachable by shops.

> Nothing here buys a domain, enables a paid plan or publishes data by itself. Each step that could cost money is marked **(owner approval)**.

## What runs where

```
Phone / laptop browser ──HTTPS──▶  App server (Hono: API + PWA files)  ──TLS──▶  PostgreSQL (Supabase)
```

The browser only talks to the app server. The database connection string and session secret stay on the server.

## Option A — tested path: Node server (Docker) + Supabase

This is exactly what the automated tests and the DevBench preview run.

1. **Database:** create a free Supabase project, copy its connection string (see README → *Supabase setup*).
2. **Server:** any host that runs a Docker image or Node 20, e.g. a small VPS, Render/Koyeb/Fly free or low tiers (limits change — check them; free web services often sleep when idle and wake on the first request, which takes some seconds).
   ```bash
   docker build -t khan-g .
   docker run -p 8080:8080 \
     -e DATABASE_URL='postgres://…supabase…' \
     -e SESSION_SECRET="$(openssl rand -base64 48)" \
     -e ADMIN_PHONE='03xx xxxxxxx' -e ADMIN_PASSWORD='…' \
     -e BUSINESS_WHATSAPP='+92…' \
     khan-g
   ```
   On start it applies migrations (`AUTO_MIGRATE=true`), creates the owner account if none exists, serves the PWA and runs the reminder check every 5 minutes.
3. Put it behind **HTTPS** (most hosts do this automatically). PWAs, service workers and secure cookies require HTTPS.
4. Production settings: `NODE_ENV=production` (forces secure cookies and a strong `SESSION_SECRET`), `SEED_DEMO=false`.

## Option B — Cloudflare (Pages for the app, Workers for the API)

The API is written with Hono and the `postgres` driver so it can run on Cloudflare Workers; **this path has not been deployed or tested yet** (see TEST_REPORT.md). Outline:

1. Cloudflare account (free). **Pages** project from this repo: build command `npm run build`, output directory `dist`.
2. A **Worker** for `/api/*` that imports `createApp` from `server/app.ts` with `nodejs_compat` enabled and `DATABASE_URL`/`SESSION_SECRET` as Worker secrets (`wrangler secret put`). Route `yourdomain/api/*` to the Worker so the app and API share one origin (cookies stay first-party).
3. Migrations on Workers cannot read files: run `npm run db:migrate` from a laptop/CI against the Supabase URL instead.
4. Reminders: add a **Cron Trigger** (e.g. every 15 minutes) that calls the same `runReminders()` or `POST /api/cron/reminders` with `Authorization: Bearer $CRON_SECRET`.
5. Free-tier notes: Workers free plan has daily request and CPU-time limits; bcrypt password checks and PDF generation are CPU-heavy, so verify they fit, or keep Option A.

## Custom domain (high level) — **(owner approval)**

1. Buy a domain (e.g. `khang.pk` or a `.com`) from any registrar — paid, owner decides.
2. Add the domain to Cloudflare (free plan) and change the registrar’s nameservers to Cloudflare’s.
3. DNS: point `app.yourdomain` (or the root) to the host — a CNAME to the Pages/host address, or an A record for a VPS. Turn on the orange-cloud proxy if using Cloudflare.
4. SSL/TLS mode **Full (strict)**; enable *Always use HTTPS*.
5. Set the production URL on the server (`APP_ORIGIN=https://app.yourdomain`) and redeploy.
6. Supabase: nothing to change for auth (Supabase Auth is not used). If you later enable Supabase Auth, add the domain to Authentication → URL configuration.
7. Verify: open `https://app.yourdomain` on a phone, sign in, install the app, place a test order, open the WhatsApp link.

## Scheduled reminders in production

- **Option A:** built-in — the server checks every `REMINDER_INTERVAL_SECONDS` (default 300). If the host sleeps when idle, also add a free external scheduler (e.g. cron-job.org) calling `POST https://…/api/cron/reminders` with header `Authorization: Bearer <CRON_SECRET>` every 15 minutes.
- Reminders are also evaluated when a shopkeeper opens the app.
- Duplicate protection is in the database (one reminder per shop per ISO week), so several schedulers running at once are safe.

## Production alerts

Set `DEVBENCH_NOTIFY_URL` and `DEVBENCH_NOTIFY_TOKEN` (from the DevBench workspace → Production notifications) on the server. Unhandled API errors and repeated reminder-job failures then appear in the team chat.

## Checklist before giving the link to shops

- [ ] `NODE_ENV=production`, strong `SESSION_SECRET`, `SEED_DEMO=false`
- [ ] Owner account created; demo accounts **not** present
- [ ] Settings: business name (EN/UR), WhatsApp number, address, invoice footer, show-prices choice
- [ ] Real products and photos added; stock counts entered
- [ ] Test shop account: order → WhatsApp → confirm → invoice → payment
- [ ] Backups: weekly `pg_dump` scheduled and tested restore
