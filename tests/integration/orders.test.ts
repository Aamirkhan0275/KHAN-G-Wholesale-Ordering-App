import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestCtx, type Client } from './helpers';

let ctx: TestCtx;
let shop: Client, admin: Client;
beforeAll(async () => {
  ctx = await setupTestApp('orders');
  shop = await ctx.login('03001000001');
  admin = await ctx.login('03000000009');
});
afterAll(async () => { await ctx.close(); });

const stockOf = async (id: string) => (await ctx.sql`select stock_qty from products where id = ${id}`)[0].stock_qty as number;
const reviewAll = async (orderId: string, map: (l: any) => number = (l) => l.requested_qty) => {
  const lines = (await admin.get(`/api/admin/orders/${orderId}`)).body.items;
  return admin.post(`/api/admin/orders/${orderId}/review`, { items: lines.map((l: any) => ({ id: l.id, approved_qty: map(l) })) });
};

describe('placing an order', () => {
  it('saves the order with a human-friendly reference, snapshots and server-side prices', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 3 }, { product_id: ctx.products.p2, qty: 2 }], 'Before noon');
    expect(o.ref).toMatch(/^KG-\d{6}-\d{4}$/);
    expect(o.status).toBe('submitted');
    expect(o.item_count).toBe(2);
    expect(o.total_requested_qty).toBe(5);
    expect(o.requested_total).toBe(3 * 100 + 2 * 250);
    expect(o.shop_name_snapshot).toBe('Shop A');
    expect(o.customer_name_snapshot).toBe('Ali A');
    expect(o.customer_note).toBe('Before noon');
    expect(o.items.map((i: any) => [i.name_en_snapshot, i.requested_qty, i.unit_price_snapshot])).toEqual([['Product P1', 3, 100], ['Product P2', 2, 250]]);
    const [h] = await ctx.sql`select to_status from order_status_history where order_id = ${o.id}`;
    expect(h.to_status).toBe('submitted');
    // stock is NOT reserved at submission (documented behaviour)
    expect(await stockOf(ctx.products.p1)).toBe(50);
  });

  it('references are unique and sequential', async () => {
    const a = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    const b = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    expect(a.ref).not.toBe(b.ref);
    expect(Number(b.ref.slice(-4))).toBe(Number(a.ref.slice(-4)) + 1);
  });

  it('later catalogue changes do not rewrite the order snapshot', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    await admin.patch(`/api/admin/products/${ctx.products.p1}`, { price: 999, name_en: 'Renamed Product' });
    const d = (await shop.get(`/api/shop/orders/${o.id}`)).body.order;
    expect(d.items[0]).toMatchObject({ name_en_snapshot: 'Product P1', unit_price_snapshot: 100 });
    await admin.patch(`/api/admin/products/${ctx.products.p1}`, { price: 100, name_en: 'Product P1' });
  });

  it.each([
    ['empty cart', { items: [] }, 'empty_cart'],
    ['zero quantity', { items: [{ product_id: 'P1', qty: 0 }] }, 'invalid_input'],
    ['negative quantity', { items: [{ product_id: 'P1', qty: -2 }] }, 'invalid_input'],
    ['fractional quantity', { items: [{ product_id: 'P1', qty: 1.5 }] }, 'invalid_input'],
    ['string quantity', { items: [{ product_id: 'P1', qty: '3' }] }, 'invalid_input'],
    ['huge quantity', { items: [{ product_id: 'P1', qty: 1000 }] }, 'invalid_input'],
    ['client-sent price (tampering)', { items: [{ product_id: 'P1', qty: 1, price: 1 }] }, 'invalid_input'],
    ['client-sent shop id', { items: [{ product_id: 'P1', qty: 1 }], shop_id: 'x' }, 'invalid_input'],
    ['bad product id', { items: [{ product_id: 'not-a-uuid', qty: 1 }] }, 'invalid_input'],
  ])('rejects %s', async (_n, body: any, code) => {
    const b = JSON.parse(JSON.stringify(body).replace(/"P1"/g, `"${ctx.products.p1}"`));
    const before = (await ctx.sql`select count(*)::int as n from orders`)[0].n;
    const r = await shop.post('/api/shop/orders', b);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(code);
    expect((await ctx.sql`select count(*)::int as n from orders`)[0].n).toBe(before);
  });

  it('rejects duplicate lines for the same product', async () => {
    const r = await shop.post('/api/shop/orders', { items: [{ product_id: ctx.products.p1, qty: 1 }, { product_id: ctx.products.p1, qty: 2 }] });
    expect(r).toMatchObject({ status: 400, body: { error: 'duplicate_item' } });
  });

  it.each([['out of stock', 'out'], ['inactive', 'inactive'], ['archived', 'archived']])('rejects a %s product (whole order rolls back)', async (_n, key) => {
    const before = (await ctx.sql`select count(*)::int as n from orders`)[0].n;
    const r = await shop.post('/api/shop/orders', { items: [{ product_id: ctx.products.p1, qty: 1 }, { product_id: (ctx.products as any)[key], qty: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('product_unavailable');
    expect(r.body.details.productId).toBe((ctx.products as any)[key]);
    expect((await ctx.sql`select count(*)::int as n from orders`)[0].n).toBe(before);
  });

  it('database function enforces the same rules if called directly (defence in depth)', async () => {
    await expect(ctx.asUser(ctx.shopA.userId, (tx) => tx`select place_order(${tx.json([{ product_id: ctx.products.p1, qty: 0 }] as any)}, null)`)).rejects.toThrow(/invalid_quantity/);
    await expect(ctx.asUser(ctx.shopA.userId, (tx) => tx`select place_order(${tx.json([{ product_id: ctx.products.p1, qty: 'abc' }] as any)}, null)`)).rejects.toThrow(/invalid_quantity/);
    await expect(ctx.asUser(ctx.shopA.userId, (tx) => tx`select place_order(${tx.json([] as any)}, null)`)).rejects.toThrow(/empty_cart/);
    await expect(ctx.asUser(ctx.shopA.userId, (tx) => tx`select place_order(${tx.json([{ product_id: 'x', qty: 1 }] as any)}, null)`)).rejects.toThrow(/invalid_item/);
  });

  it('when prices are hidden, the shop never receives prices (catalogue or order)', async () => {
    await admin.patch('/api/admin/settings', { show_prices: false });
    const cat = (await shop.get('/api/shop/catalogue')).body;
    expect(cat.products.every((p: any) => p.price === null)).toBe(true);
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 2 }]);
    expect(o.requested_total).toBeNull();
    expect(o.items[0].unit_price_snapshot).toBeNull();
    const d = (await shop.get(`/api/shop/orders/${o.id}`)).body.order;
    expect(d.items[0].unit_price_snapshot).toBeNull();
    // the business still has the price snapshot for invoicing
    const [row] = await ctx.sql`select unit_price_snapshot from order_items where order_id = ${o.id}`;
    expect(row.unit_price_snapshot).toBe(100);
    await admin.patch('/api/admin/settings', { show_prices: true });
    // per-product hide
    await admin.patch(`/api/admin/products/${ctx.products.p2}`, { show_price: false });
    const cat2 = (await shop.get('/api/shop/catalogue')).body.products;
    expect(cat2.find((p: any) => p.id === ctx.products.p2).price).toBeNull();
    expect(cat2.find((p: any) => p.id === ctx.products.p1).price).toBe(100);
    await admin.patch(`/api/admin/products/${ctx.products.p2}`, { show_price: true });
  });

  it('shop can cancel only while the order is still “submitted”', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    expect((await shop.post(`/api/shop/orders/${o.id}/cancel`)).status).toBe(200);
    expect((await shop.get(`/api/shop/orders/${o.id}`)).body.order.status).toBe('cancelled');
    const o2 = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    await admin.post(`/api/admin/orders/${o2.id}/status`, { to: 'checking' });
    expect((await shop.post(`/api/shop/orders/${o2.id}/cancel`)).body.error).toBe('cannot_cancel');
  });

  it('records that WhatsApp was opened (not that it was sent)', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    expect((await shop.post(`/api/shop/orders/${o.id}/whatsapp`)).status).toBe(200);
    const [r] = await ctx.sql`select whatsapp_opened_at from orders where id = ${o.id}`;
    expect(r.whatsapp_opened_at).toBeInstanceOf(Date);
  });
});

describe('order history window', () => {
  it('shows the last 15 days by default and older orders on request', async () => {
    const recent = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    const old = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    const edge = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    await ctx.sql`update orders set submitted_at = now() - interval '16 days' where id = ${old.id}`;
    await ctx.sql`update orders set submitted_at = now() - interval '14 days 23 hours' where id = ${edge.id}`;
    const ids15 = (await shop.get('/api/shop/orders')).body.orders.map((o: any) => o.id);
    expect(ids15).toContain(recent.id);
    expect(ids15).toContain(edge.id);
    expect(ids15).not.toContain(old.id);
    const ids30 = (await shop.get('/api/shop/orders?days=30')).body.orders.map((o: any) => o.id);
    expect(ids30).toContain(old.id);
  });
});

describe('admin availability review, status flow and stock', () => {
  it('partial / unavailable lines keep the original request and are visible to the shop', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 5 }, { product_id: ctx.products.p2, qty: 2 }]);
    const lines = (await admin.get(`/api/admin/orders/${o.id}`)).body.items;
    const r = await admin.post(`/api/admin/orders/${o.id}/review`, {
      items: [{ id: lines[0].id, approved_qty: 3, customer_note: 'Only 3 today' }, { id: lines[1].id, approved_qty: 0 }],
    });
    expect(r.status).toBe(200);
    const d = (await shop.get(`/api/shop/orders/${o.id}`)).body.order;
    expect(d.status).toBe('checking');
    expect(d.items.map((i: any) => [i.requested_qty, i.approved_qty, i.line_status])).toEqual([[5, 3, 'partial'], [2, 0, 'unavailable']]);
    expect(d.items[0].customer_note).toBe('Only 3 today');
    expect(d.total_approved_qty).toBe(3);
    expect(d.approved_total).toBe(300);
    const [a] = await ctx.sql`select details from audit_log where action = 'order_review' and entity_id = ${o.id}`;
    expect(a.details.changes.length).toBe(2);
    expect((await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'needs_confirmation', note: 'Please confirm partial' })).status).toBe(200);
    const n = (await shop.get('/api/notifications')).body.notifications.find((x: any) => x.kind === 'order_status' && x.data.ref === o.ref);
    expect(n.data).toMatchObject({ status: 'needs_confirmation', note: 'Please confirm partial' });
  });

  it('approved quantity above the request is refused', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 2 }]);
    const r = await reviewAll(o.id, () => 3);
    expect(r).toMatchObject({ status: 400, body: { error: 'approved_qty_out_of_range' } });
  });

  it('cannot confirm before every line is reviewed', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 2 }]);
    expect(await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'confirmed' })).toMatchObject({ status: 409, body: { error: 'review_required' } });
  });

  it('confirming deducts stock with movement records; cancelling puts it back', async () => {
    const before1 = await stockOf(ctx.products.p1);
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 4 }]);
    await reviewAll(o.id);
    expect((await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'confirmed' })).status).toBe(200);
    expect(await stockOf(ctx.products.p1)).toBe(before1 - 4);
    const mv = await ctx.sql`select change, reason, stock_after, actor_id from inventory_movements where order_id = ${o.id}`;
    expect(mv).toEqual([{ change: -4, reason: 'order_deduction', stock_after: before1 - 4, actor_id: ctx.admin.userId }]);
    // locked after confirmation
    expect((await reviewAll(o.id, () => 1)).body.error).toBe('order_locked');
    expect((await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'cancelled', note: 'Shop closed' })).status).toBe(200);
    expect(await stockOf(ctx.products.p1)).toBe(before1);
    const mv2 = await ctx.sql`select change, reason from inventory_movements where order_id = ${o.id} order by created_at`;
    expect(mv2.map((m: any) => m.reason)).toEqual(['order_deduction', 'order_cancel_restore']);
  });

  it('refuses to confirm when stock is insufficient and says which product', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p2, qty: 5 }]); // stock 3
    await reviewAll(o.id);
    const r = await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'confirmed' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('insufficient_stock');
    expect(r.body.details.products[0]).toMatchObject({ sku: 'P2', stock: 3, needed: 5 });
    expect(await stockOf(ctx.products.p2)).toBe(3);
  });

  it('refuses to confirm when nothing is approved', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    await reviewAll(o.id, () => 0);
    expect((await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'confirmed' })).body.error).toBe('nothing_approved');
  });

  it('enforces the status model (no going back from delivered)', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    await reviewAll(o.id);
    for (const s of ['confirmed', 'ready', 'delivered']) expect((await admin.post(`/api/admin/orders/${o.id}/status`, { to: s })).status, s).toBe(200);
    expect((await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'checking' })).body.error).toBe('invalid_transition');
    expect((await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'cancelled' })).body.error).toBe('invalid_transition');
    expect((await admin.post(`/api/admin/orders/${o.id}/status`, { to: 'bogus' })).status).toBe(400);
    const hist = (await shop.get(`/api/shop/orders/${o.id}`)).body.order.history.map((h: any) => h.to_status);
    expect(hist).toEqual(['submitted', 'checking', 'confirmed', 'ready', 'delivered']);
  });

  it('substitutions are explicit extra lines; the original request is preserved', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p2, qty: 2 }]);
    const [line] = (await admin.get(`/api/admin/orders/${o.id}`)).body.items;
    const r = await admin.post(`/api/admin/orders/${o.id}/review`, {
      items: [{ id: line.id, approved_qty: 0 }],
      substitutes: [{ for_item_id: line.id, product_id: ctx.products.p1, qty: 2, customer_note: 'Similar item' }],
    });
    expect(r.status).toBe(200);
    const items = (await shop.get(`/api/shop/orders/${o.id}`)).body.order.items;
    expect(items.map((i: any) => [i.name_en_snapshot, i.requested_qty, i.approved_qty, i.line_status])).toEqual([
      ['Product P2', 2, 0, 'substituted'], ['Product P1', 0, 2, 'added'],
    ]);
    expect(items[1].substitute_for_item_id).toBe(items[0].id);
  });

  it('internal notes are stored for admins only', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: ctx.products.p1, qty: 1 }]);
    expect((await admin.post(`/api/admin/orders/${o.id}/notes`, { note: 'Check credit first' })).status).toBe(201);
    expect((await admin.get(`/api/admin/orders/${o.id}`)).body.notes[0].note).toBe('Check credit first');
    expect(JSON.stringify((await shop.get(`/api/shop/orders/${o.id}`)).body)).not.toContain('Check credit first');
  });

  it('admin can filter orders by status, shop and date', async () => {
    const all = (await admin.get('/api/admin/orders')).body.orders;
    expect(all.length).toBeGreaterThan(5);
    const subm = (await admin.get('/api/admin/orders?status=submitted')).body.orders;
    expect(subm.every((o: any) => o.status === 'submitted')).toBe(true);
    const open = (await admin.get('/api/admin/orders?status=open')).body.orders;
    expect(open.every((o: any) => ['submitted', 'checking', 'needs_confirmation'].includes(o.status))).toBe(true);
    expect((await admin.get(`/api/admin/orders?shop=${ctx.shopB.shopId}`)).body.orders).toEqual([]);
    expect((await admin.get('/api/admin/orders?from=2000-01-01&to=2000-01-02')).body.orders).toEqual([]);
    expect((await admin.get('/api/admin/orders?status=hacked')).status).toBe(400);
    expect((await admin.get('/api/admin/orders?from=13-13-2020')).status).toBe(400);
  });
});
