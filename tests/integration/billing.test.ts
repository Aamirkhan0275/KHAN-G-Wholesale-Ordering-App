import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { setupTestApp, type TestCtx, type Client } from './helpers';

let ctx: TestCtx;
let shopA: Client, shopB: Client, admin: Client;
beforeAll(async () => {
  ctx = await setupTestApp('billing');
  shopA = await ctx.login('03001000001');
  shopB = await ctx.login('03001000002');
  admin = await ctx.login('03000000009');
});
afterAll(async () => { await ctx.close(); });

async function confirmedOrder(c: Client, items: { product_id: string; qty: number }[], approve?: (l: any) => number) {
  const o = await ctx.placeOrder(c, items);
  const lines = (await admin.get(`/api/admin/orders/${o.id}`)).body.items;
  await admin.post(`/api/admin/orders/${o.id}/review`, { items: lines.map((l: any) => ({ id: l.id, approved_qty: approve ? approve(l) : l.requested_qty })) });
  const s = await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'confirmed' });
  if (s.status !== 200) throw new Error(JSON.stringify(s.body));
  return o;
}

describe('invoices', () => {
  it('cannot invoice an unconfirmed order', async () => {
    const o = await ctx.placeOrder(shopA, [{ product_id: ctx.products.p1, qty: 1 }]);
    expect(await admin.post(`/api/admin/orders/${o.id}/invoice`)).toMatchObject({ status: 409, body: { error: 'order_not_confirmed' } });
  });

  it('creates an invoice from APPROVED quantities, posts a ledger debit, and is repeatable', async () => {
    const o = await confirmedOrder(shopA, [{ product_id: ctx.products.p1, qty: 4 }, { product_id: ctx.products.p2, qty: 2 }], (l) => (l.sku_snapshot === 'P1' ? 3 : 2));
    const r = await admin.post(`/api/admin/orders/${o.id}/invoice`);
    expect(r.status).toBe(201);
    const inv = r.body.invoice;
    expect(inv.invoice_no).toMatch(/^INV-\d{4}-\d{5}$/);
    expect(inv.total).toBe(3 * 100 + 2 * 250);
    expect(inv.balance_before).toBe(0);
    expect(inv.balance_after).toBe(800);
    expect(inv.business_snapshot.name).toBe('KHAN G');
    expect(inv.shop_snapshot.name).toBe('Shop A');
    const items = await ctx.sql`select sku, qty, unit_price, line_total from invoice_items where invoice_id = ${inv.id} order by line_no`;
    expect(items).toEqual([{ sku: 'P1', qty: 3, unit_price: 100, line_total: 300 }, { sku: 'P2', qty: 2, unit_price: 250, line_total: 500 }]);
    const again = await admin.post(`/api/admin/orders/${o.id}/invoice`);
    expect(again.status).toBe(200);
    expect(again.body.invoice.id).toBe(inv.id);
    expect((await ctx.sql`select count(*)::int as n from ledger_entries where invoice_id = ${inv.id}`)[0].n).toBe(1);
    const ledger = (await shopA.get('/api/shop/ledger')).body;
    expect(ledger.balance).toBe(800);
    expect(ledger.entries[0]).toMatchObject({ kind: 'invoice', debit: 800, invoice_no: inv.invoice_no, running_balance: 800 });
    const notif = (await shopA.get('/api/notifications')).body.notifications.find((n: any) => n.kind === 'invoice');
    expect(notif.data.invoice_no).toBe(inv.invoice_no);
  });

  it('invoice snapshot is not rewritten by later catalogue/settings changes', async () => {
    const o = await confirmedOrder(shopA, [{ product_id: ctx.products.p1, qty: 1 }]);
    const inv = (await admin.post(`/api/admin/orders/${o.id}/invoice`)).body.invoice;
    await admin.patch(`/api/admin/products/${ctx.products.p1}`, { price: 555, name_en: 'Changed Name' });
    await admin.patch('/api/admin/settings', { business_name: 'Renamed Biz' });
    const view = (await shopA.get(`/api/invoices/${inv.id}`)).body.invoice;
    expect(view.items[0]).toMatchObject({ name_en: 'Product P1', unit_price: 100 });
    expect(view.business_snapshot.name).toBe('KHAN G');
    await admin.patch(`/api/admin/products/${ctx.products.p1}`, { price: 100, name_en: 'Product P1' });
    await admin.patch('/api/admin/settings', { business_name: 'KHAN G' });
  });

  it('PDF is a valid, private download for admin and the owning shop only', async () => {
    const o = await confirmedOrder(shopA, [{ product_id: ctx.products.p1, qty: 2 }]);
    const inv = (await admin.post(`/api/admin/orders/${o.id}/invoice`)).body.invoice;
    for (const c of [admin, shopA]) {
      const r = await c.get(`/api/invoices/${inv.id}/pdf`);
      expect(r.status).toBe(200);
      expect(r.res.headers.get('content-type')).toBe('application/pdf');
      expect(r.res.headers.get('content-disposition')).toContain(`${inv.invoice_no}.pdf`);
      expect(r.res.headers.get('cache-control')).toContain('no-store');
      const bytes = new Uint8Array(await r.res.arrayBuffer());
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getTitle()).toBe(`Invoice ${inv.invoice_no}`);
    }
    expect((await shopB.get(`/api/invoices/${inv.id}/pdf`)).status).toBe(404);
    expect((await ctx.client().get(`/api/invoices/${inv.id}/pdf`)).status).toBe(401);
  });

  it('PDF generation is deterministic for the same invoice (repeatable)', async () => {
    const [inv] = await ctx.sql`select id from invoices limit 1`;
    const a = new Uint8Array(await (await admin.get(`/api/invoices/${inv.id}/pdf`)).res.arrayBuffer());
    const b = new Uint8Array(await (await admin.get(`/api/invoices/${inv.id}/pdf`)).res.arrayBuffer());
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('long invoices paginate', async () => {
    const ids = [];
    for (let i = 0; i < 40; i++) {
      const [p] = await ctx.sql`insert into products (sku, name_en, price, stock_qty) values (${'BULK' + i}, ${'Bulk item number ' + i}, 10, 100) returning id`;
      ids.push(p.id);
    }
    const o = await confirmedOrder(shopB, ids.map((id) => ({ product_id: id, qty: 1 })));
    const inv = (await admin.post(`/api/admin/orders/${o.id}/invoice`)).body.invoice;
    const bytes = new Uint8Array(await (await shopB.get(`/api/invoices/${inv.id}/pdf`)).res.arrayBuffer());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it('cancelling an invoiced order voids the invoice and credits the ledger', async () => {
    const before = (await shopA.get('/api/shop/ledger')).body.balance;
    const o = await confirmedOrder(shopA, [{ product_id: ctx.products.p1, qty: 2 }]);
    const inv = (await admin.post(`/api/admin/orders/${o.id}/invoice`)).body.invoice;
    expect((await shopA.get('/api/shop/ledger')).body.balance).toBe(before + 200);
    await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'cancelled' });
    const [v] = await ctx.sql`select status from invoices where id = ${inv.id}`;
    expect(v.status).toBe('void');
    expect((await shopA.get('/api/shop/ledger')).body.balance).toBe(before);
    expect((await admin.post(`/api/admin/orders/${o.id}/invoice`)).status).toBe(409);
  });

  it('cannot invoice lines without a price until the admin sets a rate', async () => {
    const o = await confirmedOrder(shopA, [{ product_id: ctx.products.noprice, qty: 2 }]).catch(async () => null);
    // confirm works (no price needed); invoice needs a rate
    const order = o ?? (await ctx.sql`select id from orders order by submitted_at desc limit 1`)[0];
    const r = await admin.post(`/api/admin/orders/${order.id}/invoice`);
    expect(r).toMatchObject({ status: 409, body: { error: 'missing_prices' } });
  });
});

describe('ledger and payments', () => {
  it('records a payment, updates running balance and notifies the shop', async () => {
    const before = (await shopA.get('/api/shop/ledger')).body.balance;
    const r = await admin.post(`/api/admin/shops/${ctx.shopA.shopId}/payments`, { amount: 300, payment_method: 'bank', reference: 'TX-77', note: 'part payment' });
    expect(r.status).toBe(201);
    expect(r.body.balance).toBe(before - 300);
    const l = (await shopA.get('/api/shop/ledger')).body;
    expect(l.balance).toBe(before - 300);
    expect(l.entries[0]).toMatchObject({ kind: 'payment', credit: 300, reference: 'TX-77', running_balance: before - 300 });
    expect((await shopA.get('/api/notifications')).body.notifications.some((n: any) => n.kind === 'payment' && n.data.amount === 300)).toBe(true);
  });

  it.each([[0], [-50], ['100'], [1e9]])('rejects invalid payment amount %s', async (amount) => {
    expect((await admin.post(`/api/admin/shops/${ctx.shopA.shopId}/payments`, { amount })).status).toBe(400);
  });

  it('opening balance / adjustments need a note and change the balance', async () => {
    const before = (await admin.get(`/api/admin/shops/${ctx.shopB.shopId}/ledger`)).body.balance;
    expect((await admin.post(`/api/admin/shops/${ctx.shopB.shopId}/adjustments`, { kind: 'opening_balance', direction: 'debit', amount: 1000 })).status).toBe(400);
    const r = await admin.post(`/api/admin/shops/${ctx.shopB.shopId}/adjustments`, { kind: 'opening_balance', direction: 'debit', amount: 1000, note: 'Old khata' });
    expect(r.body.balance).toBe(before + 1000);
    const r2 = await admin.post(`/api/admin/shops/${ctx.shopB.shopId}/adjustments`, { kind: 'adjustment', direction: 'credit', amount: 50, note: 'Damaged goods returned' });
    expect(r2.body.balance).toBe(before + 950);
  });

  it('ledger CSV export works for admins', async () => {
    const r = await admin.get(`/api/admin/shops/${ctx.shopA.shopId}/ledger?format=csv`);
    expect(r.res.headers.get('content-type')).toContain('text/csv');
    const text = await r.res.text();
    expect(text).toContain('running_balance');
    expect(text).toContain('TX-77');
  });

  it('shop profile shows balance, purchases and order counts', async () => {
    const p = (await admin.get(`/api/admin/shops/${ctx.shopA.shopId}`)).body;
    expect(p.shop.name).toBe('Shop A');
    expect(p.stats.balance).toBe((await shopA.get('/api/shop/ledger')).body.balance);
    expect(p.stats.orders_all).toBeGreaterThan(0);
    expect(p.stats.total_purchases).toBeGreaterThan(0);
    expect(p.payments[0]).toMatchObject({ amount: 300, payment_method: 'bank' });
  });
});

describe('reports and dashboard', () => {
  it('summary excludes cancelled orders and only counts issued invoices as money', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = (await admin.get(`/api/admin/reports/summary?from=2026-01-01&to=${today}`)).body.rows[0];
    const [db] = await ctx.sql`select count(*) filter (where status <> 'cancelled')::int as orders, count(*) filter (where status = 'cancelled')::int as cancelled from orders`;
    expect(r.orders).toBe(db.orders);
    expect(r.cancelled).toBe(db.cancelled);
    const [inv] = await ctx.sql`select coalesce(sum(total), 0)::float as t from invoices where status = 'issued'`;
    expect(r.invoiced_total).toBe(inv.t);
    expect(r.payments_total).toBe(300);
  });

  it('sales by day / by shop / products / balances / low stock all return rows and CSV', async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const name of ['sales-by-day', 'sales-by-shop', 'products', 'balances', 'low-stock']) {
      const r = await admin.get(`/api/admin/reports/${name}?from=2026-01-01&to=${today}`);
      expect(r.status, name).toBe(200);
      expect(r.body.rows.length, name).toBeGreaterThan(0);
      const c = await admin.get(`/api/admin/reports/${name}?from=2026-01-01&to=${today}&format=csv`);
      expect(c.res.headers.get('content-disposition'), name).toContain('.csv');
    }
    const low = (await admin.get('/api/admin/reports/low-stock')).body.rows.map((r: any) => r.sku);
    expect(low).toContain('OUT');
  });

  it('rejects bad report ranges', async () => {
    expect((await admin.get('/api/admin/reports/summary?from=2026-02-01&to=2026-01-01')).status).toBe(400);
    expect((await admin.get('/api/admin/reports/summary?from=2020-01-01&to=2026-01-01')).body.error).toBe('range_too_long');
    expect((await admin.get('/api/admin/reports/unknown')).status).toBe(404);
  });

  it('dashboard counts match the database', async () => {
    const d = (await admin.get('/api/admin/dashboard')).body;
    const [c] = await ctx.sql`select count(*) filter (where status = 'submitted')::int as n from orders`;
    expect(d.counts.new_orders).toBe(c.n);
    expect(d.lowStockCount).toBeGreaterThan(0);
    expect(d.money.outstanding).toBeGreaterThan(0);
  });
});
