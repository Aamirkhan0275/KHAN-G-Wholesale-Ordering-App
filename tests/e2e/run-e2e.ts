/**
 * Browser end-to-end tests: real Chromium (playwright-core) against the built PWA
 * served by the real Node server on a fresh embedded PostgreSQL with demo data.
 *
 *   npm run build && npm run test:e2e
 *
 * Writes docs/screenshots/*.png and test-results/e2e-results.json.
 * CHROMIUM_PATH can point at any Chromium/Chrome binary (default /usr/bin/chromium).
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEmbeddedPostgres } from '../../scripts/dev-db';
import { DEMO_ADMIN, DEMO_SHOPS } from '../../scripts/seed-demo-lib';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = join(process.cwd(), 'docs', 'screenshots');
const results: { id: string; name: string; ok: boolean; ms: number; detail?: string }[] = [];
mkdirSync(SHOTS, { recursive: true });
mkdirSync('test-results', { recursive: true });

if (!existsSync('dist/index.html')) { console.error('Run `npm run build` first.'); process.exit(2); }

function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function step(id: string, name: string, fn: () => Promise<string | void>) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, ok: true, ms: Date.now() - t0, detail: detail || undefined });
    console.log(`  ✓ ${id} ${name}`);
  } catch (e) {
    results.push({ id, name, ok: false, ms: Date.now() - t0, detail: String((e as Error).message ?? e).slice(0, 500) });
    console.log(`  ✗ ${id} ${name}\n      ${String((e as Error).message ?? e).split('\n')[0]}`);
  }
}

const shot = (p: Page, name: string, fullPage = false) => p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage });

async function login(p: Page, phone: string, password: string) {
  await p.goto(`${BASE}/login`);
  await p.fill('input[name=phone]', phone);
  await p.fill('input[name=password]', password);
  await p.click('button[type=submit]');
}

const shopA = DEMO_SHOPS[0]; // Madina General Store (ur)
const shopC = DEMO_SHOPS[2]; // City Mart (en)

async function main() {
  const dir = join(tmpdir(), `kg-e2e-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  const { pg, url } = await startEmbeddedPostgres({ dir, port: 54390, fresh: true });
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/node.ts'], {
    env: { ...process.env, DATABASE_URL: url, PORT: String(PORT), SEED_DEMO: 'true', REMINDER_INTERVAL_SECONDS: '0', LOG_QUIET: '1', SESSION_SECRET: 'e2e-'.padEnd(48, 'x') },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let browser: Browser | null = null;
  try {
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium' });
    await run(browser);
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 800));
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function run(browser: Browser) {
  const phone = (): Promise<BrowserContext> => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ur-PK', serviceWorkers: 'block' });
  const errors: string[] = [];
  const watch = (p: Page) => { p.on('pageerror', (e) => errors.push(String(e))); };

  // ------------------------------------------------------------ shopkeeper (Urdu, phone)
  const ctx = await phone();
  const p = await ctx.newPage();
  watch(p);
  let orderRef = '';
  let waHref = '';

  await step('E01', 'Login screen opens in Urdu with right-to-left layout', async () => {
    await p.goto(`${BASE}/login`);
    await p.waitForSelector('input[name=phone]');
    const [dir, lang] = await p.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
    assert(dir === 'rtl' && lang === 'ur', `dir=${dir} lang=${lang}`);
    await shot(p, 'e01-login-ur');
  });

  await step('E02', 'Wrong password shows a clear Urdu error', async () => {
    await login(p, shopA.phone, 'wrong-password');
    const msg = await p.locator('.error-box').innerText();
    assert(msg.includes('غلط'), `got: ${msg}`);
  });

  await step('E03', 'Inactive and pending shop accounts cannot sign in', async () => {
    await login(p, DEMO_SHOPS[5].phone, DEMO_SHOPS[5].password);
    const a = await p.locator('.error-box').innerText();
    await login(p, DEMO_SHOPS[6].phone, DEMO_SHOPS[6].password);
    const b = await p.locator('.error-box').innerText();
    assert(a.includes('منظوری') && b.includes('فعال نہیں'), `${a} | ${b}`);
  });

  await step('E04', 'Approved shopkeeper signs in (local number format) and sees the photo catalogue', async () => {
    await login(p, '0300 1110001', shopA.password);
    await p.waitForSelector('[data-testid=product-card]');
    const n = await p.locator('[data-testid=product-card]').count();
    assert(n >= 150, `only ${n} products`);
    await p.waitForTimeout(800);
    await shot(p, 'e04-catalogue-ur');
    return `${n} product cards`;
  });

  await step('E05', 'Search by English name, Urdu name and code; category chips filter', async () => {
    await p.fill('[data-testid=search]', 'mango');
    const en = await p.locator('[data-testid=product-card]').count();
    await p.fill('[data-testid=search]', 'بسکٹ');
    const ur = await p.locator('[data-testid=product-card]').count();
    await p.fill('[data-testid=search]', 'NIM-');
    const sku = await p.locator('[data-testid=product-card]').count();
    await p.fill('[data-testid=search]', 'zzzz-nothing');
    const none = await p.locator('.empty').count();
    await p.fill('[data-testid=search]', '');
    await p.locator('.chip', { hasText: 'ٹافیاں' }).click();
    const cat = await p.locator('[data-testid=product-card]').count();
    await p.locator('.chip', { hasText: 'سب' }).first().click();
    assert(en > 0 && en < 20 && ur > 0 && sku > 0 && none === 1 && cat > 0 && cat < 30, `en=${en} ur=${ur} sku=${sku} none=${none} cat=${cat}`);
    return `mango=${en}, بسکٹ=${ur}, NIM-=${sku}, Toffees=${cat}`;
  });

  await step('E06', 'Large +/− buttons change carton quantity; 0 removes the item; cart bar updates', async () => {
    const card = p.locator('[data-testid=product-card]:not(.out)').first();
    await card.locator('[data-testid=add-btn]').click();
    await card.locator('.stepper .plus').click();
    await card.locator('.stepper .plus').click();
    const v = await card.locator('.stepper input').inputValue();
    await card.locator('.stepper .minus').click();
    await card.locator('.stepper .minus').click();
    await card.locator('.stepper .minus').click();
    const gone = await card.locator('[data-testid=add-btn]').count();
    const bar = await p.locator('[data-testid=cart-bar]').count();
    assert(v === '3' && gone === 1 && bar === 0, `v=${v} gone=${gone} bar=${bar}`);
    // typed quantity is clamped to 999 and non-digits are ignored
    await card.locator('[data-testid=add-btn]').click();
    await card.locator('.stepper input').fill('5000');
    await card.locator('.stepper input').press('Enter');
    const clamped = await card.locator('.stepper input').inputValue();
    await card.locator('.stepper input').fill('2');
    await card.locator('.stepper input').press('Enter');
    assert(clamped === '500' || clamped === '999', `clamped=${clamped}`);
  });

  await step('E07', 'Out-of-stock products are visibly marked and cannot be added', async () => {
    const out = p.locator('[data-testid=product-card].out').first();
    assert(await out.count() === 1, 'no out-of-stock card in demo');
    assert(await out.locator('button:has-text("ختم")').isDisabled(), 'button not disabled');
    assert((await out.locator('.badge-bad').innerText()).includes('ختم'), 'badge text missing');
  });

  await step('E08', 'Cart review: totals, remove-with-confirmation, place order', async () => {
    const cards = p.locator('[data-testid=product-card]:not(.out)');
    await cards.nth(1).locator('[data-testid=add-btn]').click();
    await cards.nth(2).locator('[data-testid=add-btn]').click();
    await cards.nth(2).locator('.stepper .plus').click();
    await p.click('[data-testid=cart-bar]');
    await p.waitForSelector('[data-testid=cart-line]');
    const lines = await p.locator('[data-testid=cart-line]').count();
    const units = await p.locator('[data-testid=total-units]').innerText();
    assert(lines === 3 && units.trim() === '5', `lines=${lines} units=${units}`);
    await shot(p, 'e08-cart-ur', true);
    await p.locator('[data-testid=cart-line]').last().locator('.btn-danger').click();
    await p.click('[data-testid=confirm-yes]');
    assert(await p.locator('[data-testid=cart-line]').count() === 2, 'remove failed');
    await p.click('[data-testid=place-order]');
    await p.waitForSelector('[data-testid=order-ref]');
    orderRef = (await p.locator('[data-testid=order-ref]').innerText()).trim();
    assert(/^KG-\d{6}-\d{4}$/.test(orderRef), `ref ${orderRef}`);
    await shot(p, 'e08-order-done-ur');
    return orderRef;
  });

  await step('E09', 'WhatsApp click-to-chat link has the business number, reference, shop, items and totals', async () => {
    waHref = (await p.locator('[data-testid=send-wa]').getAttribute('data-href')) ?? '';
    const text = decodeURIComponent(waHref.split('text=')[1] ?? '');
    assert(waHref.startsWith('https://wa.me/923001234567?text='), waHref.slice(0, 60));
    for (const s of [orderRef, 'Madina General Store', 'Aamir Khan', '1.', '2.', 'کل: 2 اشیاء']) assert(text.includes(s), `missing "${s}" in ${text}`);
    return text.split('\n').slice(0, 3).join(' | ');
  });

  await step('E10', 'Order stays in the app without WhatsApp: visible in “My orders” with a clear status', async () => {
    await p.goto(`${BASE}/orders`);
    await p.waitForSelector('[data-testid=order-row]');
    const first = await p.locator('[data-testid=order-row]').first().innerText();
    assert(first.includes(orderRef) && first.includes('آرڈر موصول'), first);
    const n = await p.locator('[data-testid=order-row]').count();
    await shot(p, 'e10-orders-ur');
    return `${n} orders in last 15 days`;
  });

  await step('E11', 'Empty cart cannot be submitted (empty state instead of a submit button)', async () => {
    await p.goto(`${BASE}/cart`);
    await p.waitForSelector('.empty');
    assert(await p.locator('[data-testid=place-order]').count() === 0, 'submit visible on empty cart');
  });

  await step('E12', 'Repeat last order fills the cart from the previous order', async () => {
    await p.goto(`${BASE}/`);
    await p.click('[data-testid=repeat-last]');
    await p.waitForURL(/\/cart$/);
    const n = await p.locator('[data-testid=cart-line]').count();
    assert(n === 2, `cart lines ${n}`);
    await p.click('text=ٹوکری خالی کریں'); await p.click('[data-testid=confirm-yes]');
  });

  await step('E13', 'Shopkeeper cannot open admin screens (redirected to catalogue)', async () => {
    await p.goto(`${BASE}/admin/orders`);
    await p.waitForSelector('[data-testid=product-card]');
    assert(!p.url().includes('/admin'), p.url());
    const r = await p.evaluate(async () => (await fetch('/api/admin/orders')).status);
    assert(r === 403, `api status ${r}`);
  });

  await step('E14', 'Language switch to English flips to left-to-right and persists after reload', async () => {
    await p.click('[data-testid=lang-toggle]');
    await p.waitForFunction(() => document.documentElement.dir === 'ltr');
    await p.reload();
    await p.waitForSelector('[data-testid=product-card]');
    const [dir, lang] = await p.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
    const label = await p.locator('.bottom-nav a').first().innerText();
    assert(dir === 'ltr' && lang === 'en' && label.includes('Order'), `${dir} ${lang} ${label}`);
    await shot(p, 'e14-catalogue-en');
  });

  await step('E15', 'Dark mode persists after reload (device + account preference)', async () => {
    await p.goto(`${BASE}/account`);
    await p.click('[data-testid=theme-dark]');
    await p.reload();
    await p.waitForSelector('[data-testid=theme-dark]');
    const theme = await p.evaluate(() => document.documentElement.dataset.theme);
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(theme === 'dark' && bg !== 'rgb(244, 246, 245)', `${theme} ${bg}`);
    await p.goto(`${BASE}/`); await p.waitForSelector('[data-testid=product-card]'); await p.waitForTimeout(500);
    await shot(p, 'e15-catalogue-dark');
    await p.goto(`${BASE}/account`);
    await p.click('[data-testid=theme-light]');
    await p.click('[data-testid=lang-ur]');
  });

  // ------------------------------------------------------------ admin (desktop, English)
  const actx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US', acceptDownloads: true, serviceWorkers: 'block' });
  const a = await actx.newPage();
  watch(a);
  await a.addInitScript(() => { try { if (!localStorage.getItem('kg.lang')) localStorage.setItem('kg.lang', 'en'); } catch { /* */ } });
  let invoiceNo = '';

  await step('E16', 'Admin signs in and sees the dashboard with pending orders and low stock', async () => {
    await login(a, DEMO_ADMIN.phone, DEMO_ADMIN.password);
    await a.waitForSelector('[data-testid=stat-new]');
    const n = await a.locator('[data-testid=stat-new] .value').innerText();
    assert(Number(n) >= 2, `new orders ${n}`);
    await a.waitForTimeout(500);
    await shot(a, 'e16-admin-dashboard');
    return `${n} new orders`;
  });

  await step('E17', 'Admin reviews availability (partial), confirms, and stock is deducted', async () => {
    await a.goto(`${BASE}/admin/orders?q=${orderRef}`);
    await a.locator('[data-testid=admin-orders] tbody tr').first().click();
    await a.waitForSelector('[data-testid=review-table]');
    await a.click('[data-testid=approve-all]');
    const firstQty = a.locator('[data-testid=review-line] input[type=number]').first();
    const req = Number(await firstQty.inputValue());
    if (req > 1) await firstQty.fill(String(req - 1));
    await a.locator('[data-testid=review-line] input:not([type=number])').first().fill('Only part available today');
    await a.click('[data-testid=save-review]');
    await a.waitForSelector('text=Saved');
    await a.click('[data-testid=to-confirmed]');
    await a.click('[data-testid=apply-status]');
    await a.waitForSelector('text=Quantities are locked after confirmation');
    await shot(a, 'e17-admin-order-confirmed', true);
  });

  await step('E18', 'Admin creates the invoice and downloads a real PDF', async () => {
    await a.click('[data-testid=create-invoice]');
    await a.waitForSelector('[data-testid=invoice-link]');
    invoiceNo = (await a.locator('[data-testid=invoice-link]').innerText()).match(/INV-\d{4}-\d{5}/)?.[0] ?? '';
    await a.click('[data-testid=invoice-link]');
    await a.waitForSelector('[data-testid=invoice-sheet]');
    await shot(a, 'e18-invoice-view');
    const [dl] = await Promise.all([a.waitForEvent('download'), a.click('[data-testid=invoice-pdf]')]);
    const path = join('test-results', dl.suggestedFilename());
    await dl.saveAs(path);
    const head = (await import('node:fs')).readFileSync(path).subarray(0, 5).toString();
    assert(head === '%PDF-' && dl.suggestedFilename() === `${invoiceNo}.pdf`, `${head} ${dl.suggestedFilename()}`);
    return invoiceNo;
  });

  await step('E19', 'Admin records a payment and the shop balance updates', async () => {
    await a.goto(`${BASE}/admin/shops`);
    await a.click('text=Madina General Store');
    await a.waitForSelector('[data-testid=shop-balance]');
    const before = await a.locator('[data-testid=shop-balance]').innerText();
    await a.click('[data-testid=record-payment]');
    await a.fill('[data-testid=payment-amount]', '1000');
    await a.click('[data-testid=payment-save]');
    await a.waitForFunction((b) => document.querySelector('[data-testid=shop-balance]')?.textContent !== b, before);
    const after = await a.locator('[data-testid=shop-balance]').innerText();
    const num = (s: string) => Number(s.replace(/[^\d.-]/g, ''));
    assert(num(before) - num(after) === 1000, `${before} -> ${after}`);
    await shot(a, 'e19-admin-shop-ledger', true);
    return `${before} → ${after}`;
  });

  await step('E20', 'Shopkeeper sees the changed quantity note, the invoice and the notification', async () => {
    await p.goto(`${BASE}/orders`);
    await p.waitForSelector('[data-testid=order-row]');
    const row = await p.locator('[data-testid=order-row]').first().innerText();
    await p.locator('[data-testid=order-row]').first().click();
    await p.waitForSelector('[data-testid=order-line]');
    const body = await p.locator('main').innerText();
    assert(row.includes('کنفرم') && body.includes('Only part available today') && body.includes(invoiceNo), `${row} / ${body.slice(0, 200)}`);
    await shot(p, 'e20-shop-order-detail-ur', true);
    const bell = await p.locator('[data-testid=bell] .dot').innerText().catch(() => '0');
    assert(Number(bell.replace('+', '')) >= 1, `bell ${bell}`);
    const status = await p.evaluate(async (no) => {
      const list = await (await fetch('/api/shop/invoices')).json();
      const inv = list.invoices.find((i: any) => i.invoice_no === no);
      return (await fetch(`/api/invoices/${inv.id}/pdf`)).status;
    }, invoiceNo);
    assert(status === 200, `pdf ${status}`);
  });

  await step('E21', 'Another shop cannot open this invoice (private)', async () => {
    const other = await phone();
    const o = await other.newPage();
    await login(o, shopC.phone, shopC.password);
    await o.waitForSelector('[data-testid=product-card]');
    const ids = await p.evaluate(async () => (await (await fetch('/api/shop/invoices')).json()).invoices.map((i: any) => i.id));
    const statuses = await o.evaluate(async (list) => Promise.all(list.map(async (id: string) => (await fetch(`/api/invoices/${id}/pdf`)).status)), ids);
    await other.close();
    assert(statuses.length > 0 && statuses.every((s: number) => s === 404), JSON.stringify(statuses));
    return `${statuses.length} invoices of shop A → 404 for shop C`;
  });

  await step('E22', 'Admin adds a product with a photo upload; it appears in the shop catalogue', async () => {
    await a.goto(`${BASE}/admin/products/new`);
    await a.fill('input[name=sku]', 'E2E-NEW');
    await a.fill('input[name=name_en]', 'E2E Test Biscuits');
    await a.fill('input[name=name_ur]', 'ٹیسٹ بسکٹ');
    await a.fill('input[name=price]', '1234');
    await a.fill('input[name=initial_stock]', '40');
    await a.click('[data-testid=save-product]');
    await a.waitForSelector('[data-testid=photo-input]', { state: 'attached' });
    await a.setInputFiles('[data-testid=photo-input]', 'public/icons/icon-512.png');
    await a.waitForSelector('[data-testid=product-photo]');
    await shot(a, 'e22-admin-product-edit');
    await p.goto(`${BASE}/`);
    await p.fill('[data-testid=search]', 'E2E');
    await p.waitForSelector('[data-testid=product-card][data-sku=E2E-NEW] img');
  });

  await step('E23', 'Admin creates a shopkeeper; first sign-in forces a new password', async () => {
    await a.goto(`${BASE}/admin/shops/new`);
    await a.fill('input[name=full_name]', 'Test Shopkeeper');
    await a.fill('input[name=phone]', '0333 4445556');
    await a.fill('input[name=shop_name]', 'E2E Store');
    await a.fill('input[name=password]', '852963');
    await a.click('[data-testid=create-shop]');
    await a.waitForURL(/\/admin\/shops\/[0-9a-f-]{36}$/);
    const n = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const np = await n.newPage();
    await login(np, '03334445556', '852963');
    await np.waitForURL(/change-password/);
    await np.fill('input[name=current]', '852963');
    await np.fill('input[name=next]', 'MyOwnPass9');
    await np.click('button.btn-primary');
    await np.waitForSelector('[data-testid=product-card]');
    await n.close();
  });

  await step('E24', 'Weekly reminder appears for the right shop and opens the repeat-order flow', async () => {
    const plan = await a.evaluate(async () => (await (await fetch('/api/admin/reminders')).json()).plan);
    const city = plan.find((s: any) => s.name === 'City Mart Peshawar');
    assert(city && city.last_order_dow !== null, 'no plan for City Mart');
    // next week's same weekday, 10:05 Pakistan time
    const now = new Date();
    const pkt = new Date(now.getTime() + 5 * 3600e3);
    let d = new Date(Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate() + 7));
    while (d.getUTCDay() !== city.last_order_dow) d = new Date(d.getTime() + 86400e3);
    const at = new Date(d.getTime() + (10 * 60 + 5 - 5 * 60) * 60e3).toISOString();
    const r = await a.evaluate(async (atIso) => (await fetch('/api/admin/reminders/run', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kg-csrf': '1' }, body: JSON.stringify({ at: atIso }) })).json(), at);
    assert(r.sent >= 1, JSON.stringify(r));
    const r2 = await a.evaluate(async (atIso) => (await fetch('/api/admin/reminders/run', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kg-csrf': '1' }, body: JSON.stringify({ at: atIso }) })).json(), at);
    assert(r2.sent === 0, `duplicate: ${JSON.stringify(r2)}`);
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', serviceWorkers: 'block' });
    const cp = await c.newPage();
    await login(cp, shopC.phone, shopC.password);
    await cp.waitForSelector('[data-testid=reminder-banner]');
    const text = await cp.locator('[data-testid=reminder-banner]').innerText();
    await shot(cp, 'e24-reminder-banner-en');
    await cp.locator('[data-testid=reminder-banner] .btn-primary').click();
    await cp.waitForURL(/\/cart$/);
    await c.close();
    await a.goto(`${BASE}/admin/reminders`);
    await a.waitForSelector('[data-testid=reminder-log]');
    await shot(a, 'e24-admin-reminders');
    return text.split('\n')[0];
  });

  await step('E25', 'Sales reports: daily / weekly / monthly / yearly with totals, comparison and CSV', async () => {
    await a.goto(`${BASE}/admin/reports`);
    await a.waitForSelector('[data-testid=period-totals]');
    const counts: string[] = [];
    for (const [preset, period] of [['thisMonth', 'day'], ['last12', 'month'], ['last5y', 'year']] as const) {
      await a.click(`[data-testid=preset-${preset}]`);
      await a.waitForFunction((p) => document.querySelector(`[data-testid=period-${p}]`)?.getAttribute('aria-pressed') === 'true', period);
      await a.waitForTimeout(400);
      counts.push(`${period}:${await a.locator('[data-testid=period-chart] .bar').count()}`);
    }
    await a.click('[data-testid=preset-thisMonth]');
    await a.click('[data-testid=period-week]');
    await a.waitForTimeout(500);
    counts.push(`week:${await a.locator('[data-testid=period-chart] .bar').count()}`);
    await a.click('[data-testid=preset-last12]');
    await a.waitForTimeout(500);
    await shot(a, 'e25-admin-reports-monthly', true);
    const href = await a.locator('[data-testid=export-csv]').getAttribute('href');
    const csv = await a.evaluate(async (h) => { const r = await fetch(h!); return [r.status, r.headers.get('content-type'), (await r.text()).slice(0, 80)]; }, href);
    assert(csv[0] === 200 && String(csv[1]).includes('text/csv') && String(csv[2]).includes('period'), JSON.stringify(csv));
    const yearBars = Number(counts.find((c) => c.startsWith('year'))!.split(':')[1]);
    const monthBars = Number(counts.find((c) => c.startsWith('month'))!.split(':')[1]);
    assert(monthBars === 12 && yearBars === 5, counts.join(' '));
    await a.click('[data-testid=tab-summary]');
    await a.waitForSelector('[data-testid=report-summary]');
    return counts.join(', ');
  });

  await step('E30', 'Owner sets the WhatsApp/contact number; shopkeepers see it (sign-in, account, after ordering)', async () => {
    await a.goto(`${BASE}/admin/settings`);
    await a.fill('[data-testid=set-whatsapp]', '0312 9876543');
    await a.fill('[data-testid=set-phone]', '091 2345678');
    await a.click('[data-testid=save-settings]');
    await a.waitForSelector('text=Saved');
    await shot(a, 'e30-admin-settings-contact');
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ur-PK', serviceWorkers: 'block' });
    const s = await c.newPage();
    await s.goto(`${BASE}/login`);
    const loginWa = await s.locator('[data-testid=contact-whatsapp]').innerText();
    await login(s, shopA.phone, shopA.password);
    await s.waitForSelector('[data-testid=product-card]');
    await s.goto(`${BASE}/account`);
    await s.waitForSelector('[data-testid=contact-card] a[href^="https://wa.me/923129876543"]');
    const accWa = await s.locator('[data-testid=contact-whatsapp]').innerText();
    await s.waitForSelector('[data-testid=my-details]');
    await shot(s, 'e30-shop-account-contact-ur', true);
    // the order's WhatsApp button now goes to the new number
    await s.goto(`${BASE}/`);
    await s.locator('[data-testid=product-card]:not(.out) [data-testid=add-btn]').first().click();
    await s.click('[data-testid=cart-bar]');
    await s.click('[data-testid=place-order]');
    await s.waitForSelector('[data-testid=send-wa]');
    const href = await s.locator('[data-testid=send-wa]').getAttribute('data-href');
    await c.close();
    assert(loginWa.includes('0312 9876543') && accWa.includes('0312 9876543') && href!.startsWith('https://wa.me/923129876543?'), `${loginWa} | ${accWa} | ${href?.slice(0, 40)}`);
  });

  await step('E31', 'Owner records full customer details; shopkeeper sees them read-only; private notes stay private', async () => {
    await a.goto(`${BASE}/admin/shops`);
    await a.click('text=Madina General Store');
    await a.waitForSelector('[data-testid=customer-details]');
    await a.click('button:has-text("Edit")');
    for (const [k, v] of [['city', 'Peshawar'], ['area', 'Qissa Khwani'], ['whatsapp_phone', '0300 1110001'], ['alternate_phone', '0333 1234567'], ['email', 'madina@example.pk'], ['cnic', '1730112345671'], ['shop_type', 'Karyana']]) {
      await a.fill(`.modal input[name=${k}]`, v);
    }
    await a.click('[data-testid=edit-save]');
    await a.waitForSelector('[data-testid=customer-details] >> text=17301-1234567-1');
    await a.fill('[data-testid=admin-notes] textarea', 'Private: pays on Fridays');
    await a.fill('[data-testid=admin-notes] input[name=credit_limit]', '1000');
    await a.click('[data-testid=admin-notes-save]');
    await a.waitForSelector('[data-testid=over-limit]');
    await shot(a, 'e31-admin-customer-details', true);
    const csv = await a.evaluate(async () => (await (await fetch('/api/admin/shops?format=csv')).text()));
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', serviceWorkers: 'block' });
    const s = await c.newPage();
    await login(s, shopA.phone, shopA.password);
    await s.waitForSelector('[data-testid=product-card]');
    await s.goto(`${BASE}/account`);
    await s.waitForSelector('[data-testid=my-details]');
    const mine = await s.locator('[data-testid=my-details]').innerText();
    const page = await s.locator('main').innerText();
    await c.close();
    assert(mine.includes('Peshawar') && mine.includes('Qissa Khwani') && mine.includes('17301-1234567-1'), mine);
    assert(!page.includes('pays on Fridays'), 'private note leaked to shop');
    assert(csv.includes('Qissa Khwani') && csv.includes('madina@example.pk'), 'csv missing details');
  });

  await step('E26', 'Narrow phones (320 px) have no sideways scrolling; tap targets ≥ 44 px', async () => {
    const c = await browser.newContext({ viewport: { width: 320, height: 640 }, locale: 'ur-PK', serviceWorkers: 'block' });
    const s = await c.newPage();
    await login(s, shopA.phone, shopA.password);
    await s.waitForSelector('[data-testid=product-card]');
    const overflow = await s.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const small = await s.evaluate(() => [...document.querySelectorAll('.product-card button, .bottom-nav a')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44); }).length);
    await shot(s, 'e26-catalogue-320px');
    await s.goto(`${BASE}/orders`); await s.waitForSelector('[data-testid=order-row]');
    const overflow2 = await s.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await c.close();
    assert(overflow <= 0 && overflow2 <= 0 && small === 0, `overflow=${overflow}/${overflow2} small=${small}`);
  });

  await step('E27', 'Laptop width uses a multi-column grid (5 columns at 1280 px)', async () => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const s = await c.newPage();
    await login(s, shopA.phone, shopA.password);
    await s.waitForSelector('[data-testid=product-card]');
    const cols = await s.evaluate(() => getComputedStyle(document.querySelector('.product-grid')!).gridTemplateColumns.split(' ').length);
    await shot(s, 'e27-catalogue-desktop-ur');
    await c.close();
    assert(cols === 5, `cols=${cols}`);
  });

  // ------------------------------------------------------------ PWA
  await step('E28', 'PWA manifest, icons and service worker; app shell opens offline', async () => {
    const m = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
    assert(m.display === 'standalone' && m.start_url === '/' && m.icons.some((i: any) => i.sizes === '512x512') && m.icons.some((i: any) => i.purpose === 'maskable'), JSON.stringify(m).slice(0, 200));
    for (const i of m.icons) assert((await fetch(`${BASE}${i.src}`)).ok, `icon ${i.src}`);
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const s = await c.newPage();
    await login(s, shopA.phone, shopA.password);
    await s.waitForSelector('[data-testid=product-card]');
    await s.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 20000 });
    await s.reload(); await s.waitForSelector('[data-testid=product-card]');
    const controlled = await s.evaluate(() => !!navigator.serviceWorker.controller);
    await c.setOffline(true);
    await s.reload();
    await s.waitForSelector('#root > *', { timeout: 15000 });
    await s.waitForSelector('.offline-bar', { timeout: 15000 });
    const cards = await s.locator('[data-testid=product-card]').count();
    await shot(s, 'e28-offline-shell');
    await c.close();
    assert(controlled, 'service worker not controlling the page');
    return `offline: app shell + offline notice shown; ${cards} cached catalogue cards visible (orders still need internet)`;
  });

  await step('E32', 'Responsive on every screen size: no sideways scrolling on any page (phones, landscape, tablets, laptops)', async () => {
    const sizes: [string, number, number, boolean][] = [
      ['small-phone', 320, 568, true], ['android-360', 360, 740, true], ['iphone-390', 390, 844, true], ['pixel-412', 412, 915, true],
      ['phone-landscape', 844, 390, true], ['tablet-portrait', 768, 1024, true], ['tablet-landscape', 1024, 768, true],
      ['laptop-1366', 1366, 768, false], ['desktop-1920', 1920, 1080, false],
    ];
    const shopPages = ['/', '/cart', '/orders', '/account', '/notifications', '/install'];
    const adminPages = ['/admin', '/admin/orders', '/admin/products', '/admin/products/new', '/admin/shops', '/admin/shops/new', '/admin/invoices', '/admin/reports', '/admin/reminders', '/admin/settings', '/admin/stock', '/admin/categories', '/admin/more'];
    const problems: string[] = [];
    let checked = 0;
    for (const [name, w, h, touch] of sizes) {
      for (const [who, phoneNo, pw, pages, lang] of [['shop', shopA.phone, shopA.password, shopPages, 'ur'], ['admin', DEMO_ADMIN.phone, DEMO_ADMIN.password, adminPages, 'en']] as const) {
        const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch && w < 900, hasTouch: touch, serviceWorkers: 'block' });
        await c.addInitScript((l) => { try { localStorage.setItem('kg.lang', l); } catch { /* */ } }, lang);
        const s = await c.newPage();
        await login(s, phoneNo, pw);
        await s.waitForSelector(who === 'shop' ? '[data-testid=product-card]' : '[data-testid=stat-new]');
        const detail = who === 'admin' ? await s.evaluate(async () => {
          const o = (await (await fetch('/api/admin/orders')).json()).orders[0];
          const sh = (await (await fetch('/api/admin/shops')).json()).shops[0];
          return [`/admin/orders/${o.id}`, `/admin/shops/${sh.id}`];
        }) : await s.evaluate(async () => [`/orders/${(await (await fetch('/api/shop/orders')).json()).orders[0].id}`]);
        for (const path of [...pages, ...detail]) {
          await s.goto(`${BASE}${path}`);
          await s.waitForSelector('main', { timeout: 15000 });
          await s.waitForTimeout(350);
          // Measure against the real screen width (mobile emulation can widen innerWidth to fit
          // overflowing content) and also catch elements that stick out but are clipped.
          const over = await s.evaluate((vw) => {
            const page = document.documentElement.scrollWidth - vw;
            let worst = 0; let what = '';
            document.querySelectorAll('main *').forEach((el) => {
              if ((el as HTMLElement).closest('.table-wrap, .chips, .bars, .segmented')) return; // these scroll on purpose
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) return;
              const out = Math.max(r.right - vw, -r.left);
              if (out > worst) { worst = out; what = `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ')[0]}`; }
            });
            return { page, worst: Math.round(worst), what };
          }, w);
          checked++;
          if (over.page > 1 || over.worst > 1) problems.push(`${name} ${path} page+${over.page} el+${over.worst} ${over.what}`);
        }
        if (['small-phone', 'tablet-portrait', 'phone-landscape', 'desktop-1920'].includes(name)) {
          await s.goto(`${BASE}${who === 'shop' ? '/' : detail[0]}`);
          await s.waitForTimeout(500);
          await shot(s, `e32-${name}-${who}`);
        }
        await c.close();
      }
    }
    assert(problems.length === 0, problems.join('; '));
    return `${checked} page × size checks, ${sizes.length} sizes, 0 overflow`;
  });

  await step('E33', 'Android app mode: the web app recognises the KHAN G app (no "install" instructions inside the app)', async () => {
    const c = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 KhanGApp/1.0.0' });
    const s = await c.newPage();
    await s.goto(`${BASE}/install`);
    await s.waitForSelector('[data-testid=in-android-app]');
    await c.close();
  });

  await step('E29', 'No uncaught JavaScript errors during the whole run', async () => {
    assert(errors.length === 0, errors.join('\n'));
  });

  await ctx.close();
  await actx.close();
}

await main();
const passed = results.filter((r) => r.ok).length;
writeFileSync('test-results/e2e-results.json', JSON.stringify({ when: new Date().toISOString(), browser: 'Chromium (headless)', passed, failed: results.length - passed, results }, null, 2));
console.log(`\nE2E: ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
