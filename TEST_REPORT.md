# KHAN G Wholesale Ordering App — Test Report

| | |
|---|---|
| **Date** | 13 November 2026 |
| **Version / commit** | branch `devbench/khan-g-wholesale-ordering-app`, code commit `97ff9cd` (this report is added in the next commit) |
| **Tester** | Claude (AI coding agent) in a DevBench workspace — automated tests plus screenshot review. No human tester, no physical phones. |
| **Environment** | Linux container · Node.js 20.19.2 · PostgreSQL 17.2 (embedded, fresh database per test file, Supabase-compatible roles/`auth.uid()` layer) · Chromium 156 headless (desktop 1280–1366 px, phone emulation 320 px and 390 px) |
| **How to repeat** | `npm test` (unit + integration) · `npm run build && npm run test:e2e` (browser) |

## Summary

| Suite | Tests | Passed | Failed |
|---|---:|---:|---:|
| Unit (`tests/unit`) — phone numbers, WhatsApp message, cart maths, time zones/ISO weeks, status model, translations, CSV, env | 44 | 44 | 0 |
| Integration (`tests/integration`) — real API + real PostgreSQL: auth, RLS isolation, products, orders, stock, invoices/PDF, ledger, reports, reminders | 122 | 122 | 0 |
| Browser end-to-end (`tests/e2e/run-e2e.ts`) — real Chromium against the built PWA and server with demo data | 29 | 29 | 0 |
| **Total** | **195** | **195** | **0** |

All 195 pass on the final code. Getting there took fixes: the tests found **7 defects** (one critical security bug) and all 7 were fixed and re-tested (see *Bugs found and fixed*). Screenshots from the browser run are in [`docs/screenshots/`](docs/screenshots). A narrated 3½-minute video of the main flow was recorded against a local server.

**Not tested:** real Android phones, iPhones/iPads, Windows Edge, real WhatsApp sending, a hosted Supabase project, and Cloudflare. *Known limitations* has the full list.

---

## Test scenarios

Evidence: **U** = unit test file, **I** = integration test file, **E** = browser step id (results in `test-results/e2e-results.json`, screenshots `docs/screenshots/eNN-*.png`).

### Access, accounts and authorization

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Admin sign-in (local number format `0300 0000009`) | Signed in; admin API allowed; cookie httpOnly + SameSite=Lax | As expected | Pass | I auth; E16 |
| 2 | Approved shopkeeper sign-in | Sees own shop only, no password hash in response | As expected | Pass | I auth; E04 |
| 3 | Unapproved (pending) shopkeeper | Refused with “waiting for approval” | 403 `pending_approval`; Urdu message shown | Pass | I auth; E03 |
| 4 | Inactive shopkeeper | Refused | 403 `account_inactive`; Urdu message shown | Pass | I auth; E03 |
| 5 | Wrong password / unknown number | Same generic error (no account enumeration) | Both 401 `wrong_credentials` | Pass | I auth; E02 |
| 6 | 5 wrong passwords | Account locked 15 min | 5th attempt → 429 `locked`; correct password also refused until unlocked | Pass | I auth |
| 7 | Deactivate shop while it is signed in | Existing session stops working immediately | Next request 401 | Pass | I auth |
| 8 | Admin approves pending shop | Can then sign in; approver + time recorded | As expected | Pass | I auth |
| 9 | Shopkeeper calls admin API / opens admin pages | 403 / redirected | 403 on 7 admin endpoints; UI redirects to catalogue | Pass | I auth; E13 |
| 10 | Forged/tampered session cookie | Rejected | 401 | Pass | I auth |
| 11 | POST without CSRF header; POST from foreign Origin (with `APP_ORIGIN`) | Refused | 403 `csrf_header_missing` / `bad_origin` | Pass | I auth |
| 12 | Temporary password must be changed | Only change-password works until changed; weak/wrong rejected | As expected | Pass | I auth; E23 |
| 13 | Mobile number validation | `0300-1234567`, `+92 300…`, `3001234567`, Urdu digits → `+923001234567`; landlines, short/long, letters rejected | 21 cases as expected | Pass | U phone |
| 14 | Duplicate mobile on account creation | Refused | 409 `phone_already_registered` | Pass | I auth |
| 15 | Shopkeeper edits own profile | Language/theme/reminder opt-out allowed; role/status/name/phone refused | As expected (API and database) | Pass | I auth, I rls |

### Row Level Security (database-level isolation)

Tested directly in PostgreSQL as the `authenticated` role with the user id in `request.jwt.claims`, the same mechanism Supabase uses.

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 16 | Shop A reads orders, order items, status history, invoices, invoice items, ledger, notifications, favourites, shops, users | Only shop A’s rows; 0 rows of shop B | As expected for all 10 tables | Pass | I rls |
| 17 | Positive control: shop B reads its own invoice/ledger/notifications | Visible | As expected | Pass | I rls |
| 18 | Internal notes, stock movements, audit log, reminder log | Admin only | Shops see 0 rows | Pass | I rls |
| 19 | Raw products table (stock numbers) | Hidden from shops; catalogue view has no stock columns | 0 rows; view exposes only *in/low/out* | Pass | I rls |
| 20 | Password hashes | Unreadable to shopkeepers **and** admins | `permission denied` | Pass | I rls |
| 21 | Shop writes orders/items/ledger/notifications directly | Refused | Insert denied; updates affect 0 rows | Pass | I rls |
| 22 | Role escalation (shop → admin; admin creates admin) | Refused | `role_change_not_allowed` / `role_not_allowed` | Pass (after fix of bug #1) | I rls |
| 23 | Pending/inactive account, unknown user id, `anon` role | See nothing; cannot place orders | As expected | Pass | I rls |
| 24 | Guessing another shop’s order/invoice id via API | 404, no data | 404 for order, invoice, PDF, cancel, WhatsApp-mark | Pass | I rls; E21 |
| 25 | SQL-injection-style id | Clean 400, no SQL in error | 400 `invalid_id` | Pass | I rls |

### Catalogue, products, photos, stock

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 26 | 150–200 photo products | Catalogue loads quickly | 190 demo cards in browser; 200+ products in one API call < 2 s | Pass | E04; I catalogue |
| 27 | Search by English, Urdu, code; category chips | Filtered | `mango`=6, `بسکٹ`=28, `NIM-`=24, Toffees=21; empty state for no match | Pass | E05; I catalogue |
| 28 | Add/edit product, Urdu fields, units, opening stock | Saved; movement recorded | As expected | Pass | I catalogue; E22 |
| 29 | Validation: bad SKU, short name, negative price, unknown field, bad unit, duplicate SKU | Refused | 400 / 409 | Pass | I catalogue |
| 30 | Photo upload/replace (browser resize) | Shown in catalogue; old photo removed | As expected | Pass | I catalogue; E22 |
| 31 | SVG/HTML disguised as image, oversize file | Refused | `image_type_not_allowed` / 400 | Pass | I catalogue |
| 32 | Inactive product | Disappears from catalogue; cannot be ordered | As expected | Pass | I catalogue |
| 33 | Archive vs delete | Ordered products cannot be deleted (archive instead); old orders keep their lines | As expected | Pass | I catalogue |
| 34 | Stock adjust with reason; negative stock refused | Movements with actor | As expected | Pass | I catalogue |
| 35 | Low-stock list / availability badges | Threshold respected; *Limited* / *Out of stock* shown with icon + text | As expected | Pass | I catalogue; E07 |
| 36 | Out-of-stock product | Cannot be added in UI or ordered via API | Disabled button; 400 `product_unavailable` | Pass | E07; I orders |
| 37 | Categories and favourites | CRUD; category with products not deletable; favourites per shop | As expected | Pass | I catalogue |

### Cart and ordering

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 38 | +/− controls | 1→3→0; 0 removes item | As expected; typed 5000 clamped to ≤ 999 | Pass | E06; U cart |
| 39 | Cart totals | Lines, units, price only if every line priced | As expected | Pass | U cart; E08 |
| 40 | Remove with confirmation; empty cart | Confirmation dialog; empty cart has no submit | As expected | Pass | E08, E11 |
| 41 | Zero, negative, fractional, string, > 999 quantities, duplicate lines | Refused; nothing saved | 400; order count unchanged | Pass | I orders |
| 42 | Price tampering (client sends price/shop id) | Refused; prices only from DB | 400 `invalid_input`; snapshot = DB price | Pass | I orders |
| 43 | Same rules when the DB function is called directly | Refused | `invalid_quantity`, `empty_cart`, `invalid_item` | Pass | I orders |
| 44 | Order snapshot | Ref `KG-YYMMDD-NNNN`, time, shop, names, prices kept when catalogue changes later | As expected | Pass | I orders; E08 |
| 45 | Stock changes between browsing and ordering | Product gone out of stock → whole order rejected, cart refreshed | 400 `product_unavailable`, rollback | Pass | I orders, I catalogue |
| 46 | Prices hidden by owner | Shop never receives prices (catalogue/order); business keeps snapshot | As expected (global and per product) | Pass | I orders |
| 47 | Repeat last order | Cart refilled; unavailable items skipped | 2 lines restored | Pass | E12 |
| 48 | Shop cancels | Only while *Order received* | As expected | Pass | I orders |

### WhatsApp click-to-chat

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 49 | Message content | Shop, customer, reference, each item with qty/unit, totals, note; Urdu or English | As expected | Pass | U whatsapp; E09 |
| 50 | Link | `https://wa.me/923001234567?text=…` correctly encoded | As expected | Pass | U whatsapp; E09 |
| 51 | No WhatsApp number / not installed | Order still saved and visible; warning instead of button | As expected (order is saved before WhatsApp) | Pass | U whatsapp; E10 |
| 52 | Real delivery in WhatsApp | — | **Not tested** (no phone with WhatsApp in this environment) | Not tested | — |

### Order history, status flow, availability approval

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 53 | Shop history window | Last 15 days by default (14 d 23 h shown, 16 d hidden); older on request | As expected | Pass | I orders; E10 |
| 54 | Admin filters | Status, open, shop, date range, reference; invalid filters refused | As expected | Pass | I orders |
| 55 | Partial / unavailable lines | Request and approved qty both kept; shop sees badges + note | As expected | Pass | I orders; E17, E20 |
| 56 | Approve more than requested | Refused | 400 | Pass | I orders |
| 57 | Confirm before review / nothing approved | Refused | 409 `review_required` / `nothing_approved` | Pass | I orders |
| 58 | Status model | Normal path allowed; no going back from Delivered/Cancelled | As expected; full history shown to shop | Pass | I orders; U status |
| 59 | Substitution | Extra *Replacement* line; original marked *Replaced* | As expected | Pass | I orders |
| 60 | Internal notes | Admin only | Not present in shop API | Pass | I orders |
| 61 | Stock on confirm / cancel | Deducted on confirm with movement; restored on cancel | As expected | Pass | I orders; E17 |
| 62 | Insufficient stock on confirm | Refused, names product | 409 with SKU, stock, needed | Pass | I orders |
| 63 | Shop notified of status change | Notification with status + message | As expected | Pass | I orders; E20 |

### Invoices, ledger, reports

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 64 | Invoice before confirmation | Refused | 409 | Pass | I billing |
| 65 | Invoice from approved quantities | Correct lines/total/balances; ledger debit; repeat call returns same invoice | As expected | Pass | I billing; E18 |
| 66 | Snapshot preserved | Later price/name/business-name changes do not change the invoice | As expected | Pass | I billing |
| 67 | PDF | Valid PDF, correct filename, `no-store`; identical bytes on repeat; multi-page for 40 lines | As expected | Pass | I billing; E18 |
| 68 | PDF privacy | Admin + owning shop only; other shop 404; signed-out 401 | As expected | Pass | I billing, I rls; E21 |
| 69 | Cancel invoiced order | Invoice void, ledger credit | As expected | Pass | I billing |
| 70 | Missing price | Invoice refused until rate set | 409 `missing_prices` | Pass | I billing |
| 71 | Payments | Balance drops, running balance correct, shop notified; invalid amounts refused | As expected (Rs 72,050 → 71,050 in UI) | Pass | I billing; E19 |
| 72 | Adjustments / opening balance | Note required; balance changes | As expected | Pass | I billing |
| 73 | Shop profile | Balance, purchases, order counts, payments | As expected | Pass | I billing; E19 |
| 74 | Reports | Cancelled excluded; money only from issued invoices/payments; all 6 reports + CSV; bad ranges refused | As expected | Pass | I billing; E25 |
| 75 | CSV safety | Quotes/commas escaped; formula injection guarded | As expected | Pass | U misc |
| 76 | Dashboard | Counts match database | As expected | Pass | I billing; E16 |

### Language, theme, layout

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 77 | Urdu default, RTL | `<html dir="rtl" lang="ur">`, Nastaliq font, mirrored layout | As expected | Pass | E01, E04 |
| 78 | Switch to English | LTR; persists after reload | As expected | Pass | E14 |
| 79 | Translations complete | Same keys, same placeholders, Urdu script, every used key exists | As expected | Pass | U i18n |
| 80 | Dark mode | Persists after reload (device + account) | As expected | Pass | E15 |
| 81 | 320 px phone | No sideways scroll; tap targets ≥ 44 px | As expected | Pass | E26 |
| 82 | Laptop width | 4-column catalogue; admin sidebar | As expected | Pass | E27, E16 |
| 83 | No JavaScript errors during full run | None | None | Pass | E29 |

### PWA / installation

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 84 | Manifest + icons | standalone, start_url, 192/512/maskable icons reachable | As expected | Pass | E28 |
| 85 | Service worker | Registers and controls page | As expected (Chromium) | Pass | E28 |
| 86 | Offline reopen | App shell + cached catalogue + offline notice; no sign-out | As expected (after fix of bug #2) | Pass | E28 |
| 87 | Install on Android Chrome / Windows Chrome-Edge / iPhone Safari | Install works | **Not tested on real devices**; instructions written (EN/UR) | Not tested | — |

### Weekly reminders

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 88 | Weekday from latest order, after configured time | One in-app reminder at the right day/time | Sent Monday 10:05 PKT; not at 09:05 or on Tuesday | Pass | I reminders |
| 89 | Duplicate prevention | One per shop per ISO week, even with 3 concurrent runs | As expected | Pass | I reminders; E24 |
| 90 | Already ordered this week | Skipped and logged; cancelled orders don’t count | As expected | Pass | I reminders |
| 91 | Opt-out, admin per-shop off, weekday override, time change, fixed-day rule, global off, inactive shop | Respected | As expected | Pass | I reminders |
| 92 | Shop with no order history | No reminder | As expected (after fix of bug #3) | Pass | I reminders |
| 93 | On next app visit | Evaluated when the app opens | As expected | Pass | I reminders |
| 94 | Cron endpoint + admin “run now” + history | Secret required; audited; history shown | As expected | Pass | I reminders; E24 |
| 95 | Reminder in the app | Banner text *“You ordered from KHAN G last Monday…”*; button opens repeat-order cart | As expected | Pass | E24 |

### Deployment configuration

| # | Scenario | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|
| 96 | Env validation | Production refuses weak `SESSION_SECRET`; `DATABASE_URL` required; PG* fallback | As expected | Pass | U misc |
| 97 | Migrations on a fresh database | Apply once, in order | Applied to fresh DB in every run | Pass | all suites |
| 98 | DevBench preview deploy | Live preview URL | **Not done**: workspace has no deploy config and the agent lacks the “Can manage deployments” permission | Blocked | — |
| 99 | Supabase hosted project, Cloudflare Workers/Pages | — | **Not tested** (no accounts used; nothing published or paid) | Not tested | — |

---

## Bugs found and fixed

| # | Severity | Found by | Problem | Fix |
|---|---|---|---|---|
| 1 | **Critical** | `rls.test.ts` | The trigger protecting user profiles ran as `SECURITY DEFINER`, so inside it the caller always looked like the trusted server. A shopkeeper (or admin) with database access through the `authenticated` role could change their own `role` to `admin`. | Trigger changed to `SECURITY INVOKER` (`0003_security_rls.sql`), with a comment and regression tests. Fixed before the first commit; never released. |
| 2 | Medium | E2E E28 | Opening the installed app without internet sent the shopkeeper to the sign-in page instead of the cached catalogue. | Last profile is cached on the device; network errors keep the user signed in (server still checks the session online). |
| 3 | Medium | `reminders.test.ts` | With the “fixed weekday” rule, shops that had never ordered got a “your usual order day” reminder (untrue message). | Reminders only for shops with at least one previous non-cancelled order. |
| 4 | Low | Manual browser check | After a rebuild, the server kept serving the old `index.html` → blank page until restart. | Fallback reads `index.html` per request. |
| 5 | Low | Screenshot review | Urdu font misaligned the + / − symbols in quantity buttons. | Quantity controls use the Latin font. |
| 6 | Low | Code review | On first load the empty cart could overwrite the saved cart in device storage. | Save only after the stored cart for that user is loaded. |
| 7 | Low | E2E runner | The test server process was left running after the browser tests (runner hung). | Server started directly with Node and stopped reliably. |

## Open issues

None of the defects found are open. Limitations by design or scope are below.

## Known limitations, free-tier constraints, untested items

| Area | Limitation | Impact / what to do |
|---|---|---|
| Real devices | Only headless Chromium (desktop + phone emulation) was used. Android Chrome, iPhone/iPad Safari, Windows Edge, the install prompts and touch behaviour on real phones are **untested**. | Do the manual checks below before giving the link to shops. |
| WhatsApp | Click-to-chat link and message are verified; **actual sending in WhatsApp was not tested**. The app never sends WhatsApp messages by itself; reminders are in-app only. | Manual check on a phone. Automatic WhatsApp needs the WhatsApp Business Platform (approval, templates, usually paid). |
| PDF | Invoice PDF uses a built-in Latin font: Urdu text (Urdu product names, Urdu shop names) is left out of the PDF. The in-app invoice page (printable) shows Urdu correctly. | Keep English names filled in for every product/shop. |
| Hosting | No live deployment was made. DevBench preview blocked by permissions; Supabase and Cloudflare not used (no accounts, nothing paid). The Cloudflare Workers path is documented but **not built or tested**. | Option A in `docs/DEPLOYMENT.md` (Docker/Node + Supabase) matches what was tested. |
| Supabase | Tested on PostgreSQL 17 with a Supabase-compatible layer (`anon`/`authenticated` roles, `auth.uid()`); not yet run on a Supabase project. | Run `npm run db:migrate` against the new project and re-run `npm test` pointed at it if possible. |
| Free tiers | Supabase free: 500 MB DB, no automatic backups, projects can pause when inactive. Free web hosts may sleep when idle (slow first request). | Weekly `pg_dump`; consider a small paid host when shops depend on it (owner decision). |
| Stock | No reservation when an order is submitted; stock is deducted on owner confirmation. | Documented; the owner reviews availability anyway. |
| Offline | Ordering needs internet (orders are not queued offline). Add/+ buttons still work offline; placing the order then shows a “no internet” error. | Documented in the app’s install help. |
| Web Push | Not implemented (optional in the requirements). | Future work. |
| Accessibility | Large tap targets, text+icon statuses, focus rings and labels were built in; no screen-reader audit or automated contrast measurement was done. | Optional manual audit. |
| Load | No load/performance test beyond 200 products in one request. | Expected load (one business, tens of shops) is small. |
| Photos | Stored in the database; fine for a few hundred products. | Move to object storage if the catalogue grows to thousands. |
| Accounting | The ledger is a customer account record, not tax/accounting software. | — |
| Log noise | `@hono/node-server` sometimes logs “Failed to find Response internal state key”; responses are correct (tested). | Cosmetic. |

## Manual steps remaining (need a person)

1. Deploy online (see `docs/DEPLOYMENT.md`) — needs owner decisions on host, domain and costs.
2. On a real Android phone (Chrome): sign in, install, place an order, tap **Send order on WhatsApp**, press Send, confirm the message arrives on the business number.
3. Same on an iPhone (Safari → Share → Add to Home Screen) and a Windows laptop (Edge/Chrome install).
4. Enter real business settings, products, photos and stock; create real shop accounts; remove demo data (demo data is only loaded when `SEED_DEMO=true`).
5. Set up weekly database backups.

## Release-readiness statement

On the tested environment, all 195 automated tests pass: 44 unit, 122 API/database and 29 browser tests. Every defect found during testing was fixed, including one critical role-escalation bug. The code is ready for a **pilot** deployment with a few shops once the manual device checks above pass. It has not been deployed, not run on real phones, and real WhatsApp delivery has not been confirmed, so this report does not claim production readiness. These results do not rule out future bugs.
