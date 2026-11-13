import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestCtx } from './helpers';

/**
 * Row Level Security tested directly in PostgreSQL as the `authenticated` role
 * (the same role/claims mechanism Supabase uses), plus API object-level checks.
 */
let ctx: TestCtx;
let orderA: any, orderB: any, invoiceB: string;

beforeAll(async () => {
  ctx = await setupTestApp('rls');
  const a = await ctx.login('03001000001');
  const b = await ctx.login('03001000002');
  orderA = await ctx.placeOrder(a, [{ product_id: ctx.products.p1, qty: 2 }]);
  orderB = await ctx.placeOrder(b, [{ product_id: ctx.products.p1, qty: 3 }, { product_id: ctx.products.p2, qty: 1 }]);
  const admin = await ctx.login('03000000009');
  const lines = (await admin.get(`/api/admin/orders/${orderB.id}`)).body.items;
  await admin.post(`/api/admin/orders/${orderB.id}/review`, { items: lines.map((l: any) => ({ id: l.id, approved_qty: l.requested_qty })) });
  await admin.post(`/api/admin/orders/${orderB.id}/status`, { to: 'confirmed' });
  invoiceB = (await admin.post(`/api/admin/orders/${orderB.id}/invoice`)).body.invoice.id;
  await admin.post(`/api/admin/shops/${ctx.shopB.shopId}/payments`, { amount: 100 });
  await admin.post(`/api/admin/orders/${orderA.id}/notes`, { note: 'internal: slow payer' });
  await ctx.sql`insert into favourites (shop_id, product_id) values (${ctx.shopB.shopId}, ${ctx.products.p1})`;
});
afterAll(async () => { await ctx.close(); });

const count = async (userId: string, table: string) =>
  ctx.asUser(userId, async (tx) => (await tx.unsafe(`select count(*)::int as n from ${table}`))[0].n as number);

describe('RLS: one shop cannot see another shop’s data', () => {
  it.each([
    ['orders'], ['order_items'], ['order_status_history'], ['invoices'], ['invoice_items'], ['ledger_entries'], ['notifications'], ['favourites'], ['shops'], ['app_users'],
  ])('%s: shop A sees only its own rows', async (table) => {
    const own = await ctx.asUser(ctx.shopA.userId, async (tx) => {
      const rows = await tx.unsafe(`select * from ${table}`);
      return rows as any[];
    });
    for (const r of own) {
      if ('shop_id' in r) expect(r.shop_id).toBe(ctx.shopA.shopId);
      if ('user_id' in r) expect(r.user_id).toBe(ctx.shopA.userId);
      if (table === 'shops') expect(r.id).toBe(ctx.shopA.shopId);
      if (table === 'app_users') expect(r.id).toBe(ctx.shopA.userId);
    }
    const leaked = await ctx.asUser(ctx.shopA.userId, (tx) => tx`
      select (select count(*) from orders where shop_id = ${ctx.shopB.shopId})::int as o,
             (select count(*) from invoices where shop_id = ${ctx.shopB.shopId})::int as i,
             (select count(*) from ledger_entries where shop_id = ${ctx.shopB.shopId})::int as l,
             (select count(*) from order_items where order_id = ${orderB.id})::int as oi,
             (select count(*) from notifications where user_id = ${ctx.shopB.userId})::int as n,
             (select count(*) from favourites where shop_id = ${ctx.shopB.shopId})::int as f`);
    expect(leaked[0]).toEqual({ o: 0, i: 0, l: 0, oi: 0, n: 0, f: 0 });
  });

  it('shop B sees its own invoice, ledger and notifications (positive control)', async () => {
    expect(await count(ctx.shopB.userId, 'invoices')).toBe(1);
    expect(await count(ctx.shopB.userId, 'ledger_entries')).toBe(2);
    expect(await count(ctx.shopB.userId, 'notifications')).toBeGreaterThan(0);
  });

  it('internal notes, stock movements, audit log and reminder log are admin-only', async () => {
    for (const t of ['order_internal_notes', 'inventory_movements', 'audit_log', 'reminder_log']) {
      expect(await count(ctx.shopA.userId, t), t).toBe(0);
      expect(await count(ctx.shopB.userId, t), t).toBe(0);
    }
    expect(await count(ctx.admin.userId, 'order_internal_notes')).toBe(1);
    expect(await count(ctx.admin.userId, 'inventory_movements')).toBeGreaterThan(0);
  });

  it('raw products table (stock, thresholds) is hidden from shops; catalogue view exposes no stock numbers', async () => {
    expect(await count(ctx.shopA.userId, 'products')).toBe(0);
    const cat = await ctx.asUser(ctx.shopA.userId, (tx) => tx`select * from catalogue_products`);
    // p1, p2, out-of-stock (shown as 'out') and the unpriced product; inactive + archived are hidden
    expect(cat.map((p: any) => p.sku).sort()).toEqual(['NOPRICE', 'OUT', 'P1', 'P2']);
    expect(cat.find((p: any) => p.sku === 'OUT').availability).toBe('out');
    expect(cat.find((p: any) => p.sku === 'P2').availability).toBe('low');
    expect(Object.keys(cat[0])).not.toContain('stock_qty');
    expect(Object.keys(cat[0])).not.toContain('low_stock_threshold');
  });

  it('password hashes are unreadable to every app role', async () => {
    await expect(ctx.asUser(ctx.shopA.userId, (tx) => tx`select * from auth_credentials`)).rejects.toThrow(/permission denied/);
    await expect(ctx.asUser(ctx.admin.userId, (tx) => tx`select * from auth_credentials`)).rejects.toThrow(/permission denied/);
  });

  it('shops cannot write orders/items/invoices/ledger directly (only via place_order)', async () => {
    await expect(ctx.asUser(ctx.shopA.userId, (tx) => tx`insert into orders (ref, shop_id, placed_by, shop_name_snapshot, customer_name_snapshot, customer_phone_snapshot, prices_visible, currency, item_count, total_requested_qty)
      values ('X', ${ctx.shopA.shopId}, ${ctx.shopA.userId}, 'a', 'b', 'c', true, 'PKR', 1, 1)`)).rejects.toThrow(/permission denied|row-level security/);
    const upd = await ctx.asUser(ctx.shopA.userId, (tx) => tx`update orders set status = 'delivered' where id = ${orderA.id} returning id`);
    expect(upd.length).toBe(0);
    const upd2 = await ctx.asUser(ctx.shopA.userId, (tx) => tx`update order_items set approved_qty = 999 where order_id = ${orderA.id} returning id`);
    expect(upd2.length).toBe(0);
    await expect(ctx.asUser(ctx.shopA.userId, (tx) => tx`insert into ledger_entries (shop_id, entry_date, kind, credit) values (${ctx.shopA.shopId}, current_date, 'payment', 1000)`)).rejects.toThrow(/row-level security/);
    await expect(ctx.asUser(ctx.shopA.userId, (tx) => tx`update notifications set kind = 'payment' where user_id = ${ctx.shopA.userId}`)).rejects.toThrow(/permission denied/);
  });

  it('a shopkeeper cannot change role, status or another user’s profile', async () => {
    await expect(ctx.asUser(ctx.shopA.userId, (tx) => tx`update app_users set role = 'admin' where id = ${ctx.shopA.userId}`)).rejects.toThrow(/role_change_not_allowed/);
    await expect(ctx.asUser(ctx.shopA.userId, (tx) => tx`update app_users set status = 'active', phone = '+923009999999' where id = ${ctx.shopA.userId}`)).rejects.toThrow(/protected_field/);
    const other = await ctx.asUser(ctx.shopA.userId, (tx) => tx`update app_users set language = 'en' where id = ${ctx.shopB.userId} returning id`);
    expect(other.length).toBe(0);
    const own = await ctx.asUser(ctx.shopA.userId, (tx) => tx`update app_users set language = 'en' where id = ${ctx.shopA.userId} returning id`);
    expect(own.length).toBe(1);
  });

  it('even an admin cannot promote anyone to admin through the app role', async () => {
    await expect(ctx.asUser(ctx.admin.userId, (tx) => tx`update app_users set role = 'admin' where id = ${ctx.shopA.userId}`)).rejects.toThrow(/role_change_not_allowed/);
    await expect(ctx.asUser(ctx.admin.userId, (tx) => tx`insert into app_users (role, full_name, phone) values ('admin', 'Sneaky', '+923005550000')`)).rejects.toThrow(/role_not_allowed/);
  });

  it('pending and inactive accounts match no policy', async () => {
    for (const u of [ctx.pending.userId, ctx.inactive.userId]) {
      expect(await count(u, 'catalogue_products')).toBe(0);
      expect(await count(u, 'orders')).toBe(0);
      expect(await count(u, 'app_settings')).toBe(0);
      await expect(ctx.asUser(u, (tx) => tx`select place_order(${tx.json([{ product_id: ctx.products.p1, qty: 1 }] as any)}, null)`)).rejects.toThrow(/not_allowed/);
    }
  });

  it('the anon role has no table access at all', async () => {
    await expect(ctx.sql.begin(async (tx) => { await tx`set local role anon`; return tx`select * from orders`; })).rejects.toThrow(/permission denied/);
    await expect(ctx.sql.begin(async (tx) => { await tx`set local role anon`; return tx`select * from catalogue_products`; })).rejects.toThrow(/permission denied/);
  });

  it('an authenticated JWT with an unknown user id sees nothing', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect(await count(ghost, 'orders')).toBe(0);
    expect(await count(ghost, 'catalogue_products')).toBe(0);
  });

  it('admin can read every shop’s data', async () => {
    expect(await count(ctx.admin.userId, 'orders')).toBe(2);
    expect(await count(ctx.admin.userId, 'products')).toBe(6);
  });
});

describe('API object-level authorization (guessing ids)', () => {
  it('shop A gets 404 for shop B’s order, invoice, PDF; cannot cancel or mark it', async () => {
    const a = await ctx.login('03001000001');
    expect((await a.get(`/api/shop/orders/${orderB.id}`)).status).toBe(404);
    expect((await a.get(`/api/invoices/${invoiceB}`)).status).toBe(404);
    expect((await a.get(`/api/invoices/${invoiceB}/pdf`)).status).toBe(404);
    expect((await a.post(`/api/shop/orders/${orderB.id}/cancel`)).status).toBe(404);
    expect((await a.post(`/api/shop/orders/${orderB.id}/whatsapp`)).status).toBe(404);
    const list = (await a.get('/api/shop/orders')).body.orders;
    expect(list.map((o: any) => o.id)).toEqual([orderA.id]);
    expect((await a.get('/api/shop/invoices')).body.invoices).toEqual([]);
    expect((await a.get('/api/shop/ledger')).body.entries).toEqual([]);
  });

  it('shop B can read its own invoice and PDF', async () => {
    const b = await ctx.login('03001000002');
    expect((await b.get(`/api/invoices/${invoiceB}`)).status).toBe(200);
    const pdf = await b.get(`/api/invoices/${invoiceB}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.res.headers.get('cache-control')).toContain('no-store');
  });

  it('malformed ids are rejected cleanly (no SQL errors leaked)', async () => {
    const a = await ctx.login('03001000001');
    const r = await a.get(`/api/shop/orders/1%20or%201=1`);
    expect(r).toMatchObject({ status: 400, body: { error: 'invalid_id' } });
    expect(JSON.stringify(r.body)).not.toMatch(/select|syntax|postgres/i);
  });
});
