import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, type TestCtx, type Client } from './helpers';

let ctx: TestCtx;
let shop: Client, admin: Client;
beforeAll(async () => {
  ctx = await setupTestApp('catalogue');
  shop = await ctx.login('03001000001');
  admin = await ctx.login('03000000009');
});
afterAll(async () => { await ctx.close(); });

// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]).toString('base64');

describe('product administration', () => {
  let id: string;
  it('adds a product with opening stock and records the movement', async () => {
    const r = await admin.post('/api/admin/products', {
      sku: 'NEW-1', name_en: 'Salted Crackers', name_ur: 'نمکین کریکرز', category_id: ctx.categoryId, price: 450,
      unit_type: 'box', unit_label_en: 'Box', unit_label_ur: 'ڈبہ', pieces_per_unit: 24, initial_stock: 30, low_stock_threshold: 4,
    });
    expect(r.status).toBe(201);
    id = r.body.product.id;
    expect(r.body.product).toMatchObject({ stock_qty: 30, unit_type: 'box', is_active: true });
    const [m] = await ctx.sql`select change, reason, stock_after from inventory_movements where product_id = ${id}`;
    expect(m).toEqual({ change: 30, reason: 'initial', stock_after: 30 });
    const cat = (await shop.get('/api/shop/catalogue')).body.products.find((p: any) => p.id === id);
    expect(cat).toMatchObject({ name_ur: 'نمکین کریکرز', unit_label_ur: 'ڈبہ', price: 450, availability: 'in' });
  });

  it.each([
    ['bad sku', { sku: 'has space', name_en: 'Abc' }],
    ['short name', { sku: 'OK1', name_en: 'A' }],
    ['negative price', { sku: 'OK2', name_en: 'Abc', price: -1 }],
    ['unknown field', { sku: 'OK3', name_en: 'Abc', stock_qty: 5 }],
    ['bad unit', { sku: 'OK4', name_en: 'Abc', unit_type: 'truck' }],
  ])('validates: %s', async (_n, body) => {
    expect((await admin.post('/api/admin/products', body)).status).toBe(400);
  });

  it('duplicate SKU (case-insensitive) is refused', async () => {
    expect(await admin.post('/api/admin/products', { sku: 'new-1', name_en: 'Dupe' })).toMatchObject({ status: 409, body: { error: 'duplicate' } });
  });

  it('edits price and availability; inactive products leave the catalogue', async () => {
    await admin.patch(`/api/admin/products/${id}`, { price: 480 });
    expect((await shop.get('/api/shop/catalogue')).body.products.find((p: any) => p.id === id).price).toBe(480);
    await admin.patch(`/api/admin/products/${id}`, { is_active: false });
    expect((await shop.get('/api/shop/catalogue')).body.products.some((p: any) => p.id === id)).toBe(false);
    expect((await shop.post('/api/shop/orders', { items: [{ product_id: id, qty: 1 }] })).body.error).toBe('product_unavailable');
    await admin.patch(`/api/admin/products/${id}`, { is_active: true });
  });

  it('uploads/replaces a photo (JPEG/PNG only), served to shops with safe headers', async () => {
    const r1 = await admin.post(`/api/admin/products/${id}/image`, { data: `data:image/png;base64,${PNG}` });
    expect(r1.status).toBe(201);
    const r2 = await admin.post(`/api/admin/products/${id}/image`, { data: JPEG });
    expect(r2.body.image.content_type).toBe('image/jpeg');
    expect((await ctx.sql`select count(*)::int as n from product_images where product_id = ${id}`)[0].n).toBe(1); // old one removed
    const p = (await shop.get('/api/shop/catalogue')).body.products.find((x: any) => x.id === id);
    const img = await shop.get(`/api/images/${p.image_id}`);
    expect(img.status).toBe(200);
    expect(img.res.headers.get('content-type')).toBe('image/jpeg');
    expect(img.res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(img.res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await ctx.client().get(`/api/images/${p.image_id}`)).status).toBe(401);
  });

  it('rejects SVG/HTML disguised as images and oversize files', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    expect((await admin.post(`/api/admin/products/${id}/image`, { data: `data:image/png;base64,${svg}` })).body.error).toBe('image_type_not_allowed');
    const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
    expect((await admin.post(`/api/admin/products/${id}/image`, { data: html })).body.error).toBe('image_type_not_allowed');
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1_550_000)]).toString('base64');
    expect((await admin.post(`/api/admin/products/${id}/image`, { data: big })).status).toBe(400);
  });

  it('archives instead of deleting products used in orders; old orders keep their lines', async () => {
    const o = await ctx.placeOrder(shop, [{ product_id: id, qty: 2 }]);
    expect(await admin.del(`/api/admin/products/${id}`)).toMatchObject({ status: 409, body: { error: 'product_in_orders_archive_instead' } });
    expect((await admin.post(`/api/admin/products/${id}/archive`)).status).toBe(200);
    expect((await shop.get('/api/shop/catalogue')).body.products.some((p: any) => p.id === id)).toBe(false);
    expect((await admin.get('/api/admin/products?filter=archived')).body.products.map((p: any) => p.id)).toContain(id);
    const d = (await shop.get(`/api/shop/orders/${o.id}`)).body.order;
    expect(d.items[0]).toMatchObject({ name_en_snapshot: 'Salted Crackers', requested_qty: 2 });
    expect((await admin.post(`/api/admin/products/${id}/restore`)).body.product.archived_at).toBeNull();
  });

  it('hard-deletes a product that was never ordered', async () => {
    const r = await admin.post('/api/admin/products', { sku: 'TMP-DEL', name_en: 'Temp product' });
    expect((await admin.del(`/api/admin/products/${r.body.product.id}`)).status).toBe(200);
  });

  it('admin search finds by English name, Urdu name and SKU', async () => {
    const q = async (s: string) => (await admin.get(`/api/admin/products?q=${encodeURIComponent(s)}`)).body.products.map((p: any) => p.sku);
    expect(await q('crack')).toContain('NEW-1');
    expect(await q('کریکرز')).toContain('NEW-1');
    expect(await q('new-')).toContain('NEW-1');
  });
});

describe('stock and low-stock', () => {
  it('adjusts stock with a reason and refuses negative stock', async () => {
    const pid = ctx.products.p2; // stock 3
    expect((await admin.post(`/api/admin/products/${pid}/stock`, { change: 10, reason: 'restock', note: 'truck 12' })).body.stock_qty).toBe(13);
    expect((await admin.post(`/api/admin/products/${pid}/stock`, { change: -20, reason: 'damage' })).body.error).toBe('stock_cannot_go_negative');
    expect((await admin.post(`/api/admin/products/${pid}/stock`, { set_to: 2 })).body).toMatchObject({ stock_qty: 2, change: -11 });
    expect((await admin.post(`/api/admin/products/${pid}/stock`, { change: 0, reason: 'restock' })).status).toBe(400);
    const mv = await ctx.sql`select change, reason, note, actor_id from inventory_movements where product_id = ${pid} order by created_at`;
    expect(mv.map((m: any) => [m.change, m.reason])).toEqual([[10, 'restock'], [-11, 'adjustment']]);
    expect(mv[0].actor_id).toBe(ctx.admin.userId);
  });

  it('low-stock list and catalogue availability follow the threshold; out of stock is not orderable', async () => {
    const low = (await admin.get('/api/admin/reports/low-stock')).body.rows.map((r: any) => r.sku);
    expect(low).toEqual(expect.arrayContaining(['P2', 'OUT']));
    expect(low).not.toContain('P1');
    const cat = (await shop.get('/api/shop/catalogue')).body.products;
    expect(cat.find((p: any) => p.sku === 'P2').availability).toBe('low');
    expect(cat.find((p: any) => p.sku === 'OUT').availability).toBe('out');
    await admin.post(`/api/admin/products/${ctx.products.p2}/stock`, { set_to: 0 });
    expect((await shop.post('/api/shop/orders', { items: [{ product_id: ctx.products.p2, qty: 1 }] })).body.error).toBe('product_unavailable');
  });

  it('a catalogue of 200 products loads in one request', async () => {
    const values = Array.from({ length: 200 }, (_, i) => ({ sku: `CAT-${i}`, name_en: `Catalogue item ${i}`, price: 100 + i, stock_qty: 20 }));
    await ctx.sql`insert into products ${ctx.sql(values as any)}`;
    const t0 = Date.now();
    const r = await shop.get('/api/shop/catalogue');
    expect(r.body.products.length).toBeGreaterThanOrEqual(200);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('categories and favourites', () => {
  it('category CRUD; cannot delete a category that has products', async () => {
    const c = await admin.post('/api/admin/categories', { name_en: 'Nimko', name_ur: 'نمکو' });
    expect(c.status).toBe(201);
    expect((await admin.post('/api/admin/categories', { name_en: 'nimko' })).status).toBe(409);
    expect((await admin.del(`/api/admin/categories/${ctx.categoryId}`)).body.error).toBe('category_has_products');
    expect((await admin.patch(`/api/admin/categories/${c.body.category.id}`, { is_active: false })).status).toBe(200);
    expect((await shop.get('/api/shop/catalogue')).body.categories.map((x: any) => x.name_en)).not.toContain('Nimko');
    expect((await admin.del(`/api/admin/categories/${c.body.category.id}`)).status).toBe(200);
  });

  it('favourites are per shop', async () => {
    expect((await shop.post(`/api/shop/favourites/${ctx.products.p1}`)).status).toBe(200);
    expect((await shop.get('/api/shop/catalogue')).body.favourites).toEqual([ctx.products.p1]);
    const other = await ctx.login('03001000002');
    expect((await other.get('/api/shop/catalogue')).body.favourites).toEqual([]);
    expect((await shop.del(`/api/shop/favourites/${ctx.products.p1}`)).status).toBe(200);
    expect((await shop.post(`/api/shop/favourites/${ctx.products.archived}`)).status).toBe(404);
  });
});
