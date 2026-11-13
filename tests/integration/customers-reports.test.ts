import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestCtx, type Client } from './helpers';

let ctx: TestCtx;
let admin: Client, shopA: Client, shopB: Client;
beforeAll(async () => {
  ctx = await setupTestApp('custrep');
  admin = await ctx.login('03000000009');
  shopA = await ctx.login('03001000001');
  shopB = await ctx.login('03001000002');
});
afterAll(async () => { await ctx.close(); });

describe('customer details', () => {
  it('admin saves full customer details when creating a shop (normalized)', async () => {
    const r = await admin.post('/api/admin/shops', {
      full_name: 'Hamid Ullah', phone: '0345 1112223', shop_name: 'Hamid Traders', password: '583920',
      address: 'Shop 12, Qissa Khwani Bazaar', location_note: 'Near the mosque', city: 'Peshawar', area: 'Qissa Khwani',
      alternate_phone: '0300-7778889', whatsapp_phone: '+92 345 1112223', email: 'Hamid@Example.com', cnic: '17301 1234567 1',
      ntn: '1234567-8', shop_type: 'Karyana / general store',
    });
    expect(r.status).toBe(201);
    const p = (await admin.get(`/api/admin/shops/${r.body.shop.id}`)).body.shop;
    expect(p).toMatchObject({
      name: 'Hamid Traders', full_name: 'Hamid Ullah', phone: '+923451112223', city: 'Peshawar', area: 'Qissa Khwani',
      alternate_phone: '+923007778889', whatsapp_phone: '+923451112223', email: 'hamid@example.com', cnic: '17301-1234567-1',
      ntn: '1234567-8', shop_type: 'Karyana / general store', address: 'Shop 12, Qissa Khwani Bazaar', location_note: 'Near the mosque',
    });
  });

  it.each([
    ['alternate_phone', '12345', 'invalid_alternate_phone'],
    ['whatsapp_phone', 'abc', 'invalid_whatsapp_phone'],
    ['email', 'not-an-email', 'invalid_email'],
    ['cnic', '1730112345', 'invalid_cnic'],
  ])('rejects invalid %s', async (field, value, code) => {
    const r = await admin.patch(`/api/admin/shops/${ctx.shopA.shopId}`, { [field]: value });
    expect(r).toMatchObject({ status: 400, body: { error: code } });
  });

  it('admin edits and clears details; shop sees its own record read-only', async () => {
    expect((await admin.patch(`/api/admin/shops/${ctx.shopA.shopId}`, { city: 'Mardan', area: 'Main Bazaar', email: 'a@shop.pk' })).status).toBe(200);
    const own = (await shopA.get('/api/shop/profile')).body.profile;
    expect(own).toMatchObject({ shop_name: 'Shop A', full_name: 'Ali A', city: 'Mardan', area: 'Main Bazaar', email: 'a@shop.pk' });
    expect(own.notes).toBeUndefined();
    await admin.patch(`/api/admin/shops/${ctx.shopA.shopId}`, { email: null });
    expect((await shopA.get('/api/shop/profile')).body.profile.email).toBeNull();
    // shopkeepers cannot edit the record
    expect((await shopA.patch(`/api/admin/shops/${ctx.shopA.shopId}`, { city: 'X' })).status).toBe(403);
    await expect(ctx.asUser(ctx.shopA.userId, (tx) => tx`update shops set city = 'Hacked' where id = ${ctx.shopA.shopId} returning id`)).resolves.toEqual([]);
  });

  it('admin-only notes and credit limit are invisible to the shop (API and database)', async () => {
    const r = await admin.req('PUT', `/api/admin/shops/${ctx.shopA.shopId}/admin-details`, { notes: 'Pays late; call before delivery', credit_limit: 50000 });
    expect(r.status).toBe(200);
    expect((await admin.get(`/api/admin/shops/${ctx.shopA.shopId}`)).body.admin_details).toMatchObject({ notes: 'Pays late; call before delivery', credit_limit: 50000 });
    expect(JSON.stringify((await shopA.get('/api/shop/profile')).body)).not.toContain('Pays late');
    const rows = await ctx.asUser(ctx.shopA.userId, (tx) => tx`select * from shop_admin_details`);
    expect(rows).toEqual([]);
    expect((await admin.req('PUT', `/api/admin/shops/${ctx.shopA.shopId}/admin-details`, { notes: null, credit_limit: -5 })).status).toBe(400);
  });

  it('one shop cannot read another shop’s customer record', async () => {
    const b = (await shopB.get('/api/shop/profile')).body.profile;
    expect(b.shop_name).toBe('Shop B');
    const leak = await ctx.asUser(ctx.shopB.userId, (tx) => tx`select city from shops where id = ${ctx.shopA.shopId}`);
    expect(leak).toEqual([]);
  });

  it('customer search by city/area and CSV export with all details', async () => {
    const found = (await admin.get('/api/admin/shops?q=mardan')).body.shops.map((s: any) => s.name);
    expect(found).toEqual(['Shop A']);
    const csv = await admin.get('/api/admin/shops?format=csv');
    expect(csv.res.headers.get('content-type')).toContain('text/csv');
    const text = await csv.res.text();
    expect(text.split('\r\n')[0]).toContain('shop,owner,mobile,whatsapp,alternate_phone,email,city,area,address');
    expect(text).toContain('Hamid Traders');
    expect(text).toContain('17301-1234567-1');
  });
});

describe('business contact number shown to shopkeepers', () => {
  it('admin sets WhatsApp + phone; every shopkeeper receives them', async () => {
    const s = await admin.patch('/api/admin/settings', { business_whatsapp: '0311 2223334', business_phone: '091-1234567' });
    expect(s.body.settings.business_whatsapp).toBe('+923112223334');
    for (const c of [shopA, shopB]) {
      const me = (await c.get('/api/auth/me')).body.settings;
      expect(me).toMatchObject({ business_whatsapp: '+923112223334', business_phone: '091-1234567' });
      expect((await c.get('/api/shop/catalogue')).body.settings.business_whatsapp).toBe('+923112223334');
    }
    expect((await admin.patch('/api/admin/settings', { business_whatsapp: '12' })).body.error).toBe('invalid_whatsapp_number');
    expect((await shopA.patch('/api/admin/settings', { business_whatsapp: '03000000000' })).status).toBe(403);
  });
});

describe('daily / weekly / monthly / yearly sales report', () => {
  beforeAll(async () => {
    // Orders + invoices spread over 2025-2026, plus one cancelled order.
    const mk = async (when: string, qty: number, status: 'confirm' | 'cancel' | 'open') => {
      const o = await ctx.placeOrder(shopA, [{ product_id: ctx.products.p1, qty }]);
      if (status !== 'open') {
        const lines = (await admin.get(`/api/admin/orders/${o.id}`)).body.items;
        await admin.post(`/api/admin/orders/${o.id}/review`, { items: lines.map((l: any) => ({ id: l.id, approved_qty: l.requested_qty })) });
        if (status === 'confirm') {
          await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'confirmed' });
          await admin.post(`/api/admin/orders/${o.id}/invoice`);
        } else await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'cancelled' });
      }
      await ctx.sql`update orders set submitted_at = ${when}::timestamptz where id = ${o.id}`;
      await ctx.sql`update invoices set issue_date = (${when}::timestamptz at time zone 'Asia/Karachi')::date where order_id = ${o.id}`;
      await ctx.sql`update ledger_entries set entry_date = (${when}::timestamptz at time zone 'Asia/Karachi')::date where invoice_id in (select id from invoices where order_id = ${o.id})`;
    };
    await ctx.sql`update products set stock_qty = 1000 where id = ${ctx.products.p1}`;
    await mk('2026-03-02T06:00:00Z', 2, 'confirm'); // Mon, W10, March
    await mk('2026-03-03T06:00:00Z', 3, 'confirm'); // Tue, W10
    await mk('2026-03-10T06:00:00Z', 1, 'confirm'); // W11
    await mk('2026-04-15T06:00:00Z', 4, 'confirm'); // April
    await mk('2026-04-16T06:00:00Z', 9, 'cancel');  // cancelled: excluded
    await mk('2025-12-31T18:30:00Z', 5, 'confirm'); // 23:30 PKT on 31 Dec 2025 -> year 2025
    await mk('2025-12-31T19:30:00Z', 6, 'open');    // 00:30 PKT on 1 Jan 2026 -> year 2026
    await admin.post(`/api/admin/shops/${ctx.shopA.shopId}/payments`, { amount: 250, entry_date: '2026-03-04' });
  });
  const get = async (period: string, from: string, to: string) => (await admin.get(`/api/admin/reports/sales-by-period?period=${period}&from=${from}&to=${to}`)).body;

  it('daily buckets include empty days and exact values', async () => {
    const r = await get('day', '2026-03-01', '2026-03-04');
    expect(r.rows.map((x: any) => [x.period, x.orders, x.invoiced_total, x.payments_total])).toEqual([
      ['2026-03-01', 0, 0, 0], ['2026-03-02', 1, 200, 0], ['2026-03-03', 1, 300, 0], ['2026-03-04', 0, 0, 250],
    ]);
  });

  it('weekly buckets are ISO weeks (Monday start)', async () => {
    const r = await get('week', '2026-03-01', '2026-03-15');
    expect(r.rows.map((x: any) => [x.period, x.period_start, x.orders, x.confirmed_units])).toEqual([
      ['2026-W09', '2026-02-23', 0, 0], ['2026-W10', '2026-03-02', 2, 5], ['2026-W11', '2026-03-09', 1, 1],
    ]);
  });

  it('monthly buckets exclude cancelled orders and use invoice money only', async () => {
    const r = await get('month', '2026-03-01', '2026-04-30');
    expect(r.rows.map((x: any) => [x.period, x.orders, x.cancelled, x.invoiced_total])).toEqual([['2026-03', 3, 0, 600], ['2026-04', 1, 1, 400]]);
    expect(r.totals).toMatchObject({ orders: 4, cancelled: 1, invoiced_total: 1000, payments_total: 250 });
  });

  it('yearly buckets follow the business time zone (Asia/Karachi)', async () => {
    const r = await get('year', '2025-01-01', '2026-12-31');
    const y = Object.fromEntries(r.rows.map((x: any) => [x.period, x]));
    expect(y['2025'].orders).toBe(1);
    expect(y['2026'].orders).toBe(5); // 4 non-cancelled 2026 orders + the 00:30 1-Jan order
    expect(y['2025'].invoiced_total).toBe(500);
  });

  it('returns the previous period for comparison, CSV, and validates input', async () => {
    const r = await get('month', '2026-04-01', '2026-04-30');
    expect(r.previous).toMatchObject({ from: '2026-03-01', to: '2026-03-31' });
    expect(r.previous.totals.orders).toBe(3);
    const csv = await admin.get('/api/admin/reports/sales-by-period?period=week&from=2026-03-01&to=2026-03-15&format=csv');
    expect(await csv.res.text()).toContain('period_start,period_end,period,orders');
    expect((await admin.get('/api/admin/reports/sales-by-period?period=hour&from=2026-03-01&to=2026-03-02')).body.error).toBe('invalid_period');
    expect((await admin.get('/api/admin/reports/sales-by-period?period=day&from=2024-01-01&to=2026-03-02')).body.error).toBe('range_too_long');
    expect((await admin.get('/api/admin/reports/sales-by-period?period=year&from=2017-01-01&to=2026-03-02')).status).toBe(200);
    expect((await shopA.get('/api/admin/reports/sales-by-period?period=day')).status).toBe(403);
  });
});
