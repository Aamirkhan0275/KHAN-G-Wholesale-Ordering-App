import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestApp, PW, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await setupTestApp('auth'); });
afterAll(async () => { await ctx.close(); });

describe('sign-in and account access', () => {
  it('admin signs in with a local-format number; cookie is httpOnly + SameSite', async () => {
    const c = ctx.client();
    const r = await c.post('/api/auth/login', { phone: '0300 0000009', password: PW });
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('admin');
    const set = r.res.headers.get('set-cookie')!;
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect((await c.get('/api/admin/dashboard')).status).toBe(200);
  });

  it('approved shopkeeper signs in and gets their own shop', async () => {
    const c = await ctx.login('03001000001');
    const me = await c.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ role: 'shopkeeper', shop_id: ctx.shopA.shopId });
    expect(me.body.user.password_hash).toBeUndefined();
  });

  it('wrong password and unknown number give the same generic error', async () => {
    const a = await ctx.client().post('/api/auth/login', { phone: '03001000001', password: 'nope-nope' });
    const b = await ctx.client().post('/api/auth/login', { phone: '03009999999', password: 'nope-nope' });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.body.error).toBe('wrong_credentials'); expect(b.body.error).toBe('wrong_credentials');
  });

  it('invalid phone format is rejected before lookup', async () => {
    const r = await ctx.client().post('/api/auth/login', { phone: '12ab', password: PW });
    expect(r).toMatchObject({ status: 400, body: { error: 'invalid_phone' } });
  });

  it('pending (unapproved) shopkeeper cannot sign in', async () => {
    const r = await ctx.client().post('/api/auth/login', { phone: ctx.pending.phone, password: PW });
    expect(r).toMatchObject({ status: 403, body: { error: 'pending_approval' } });
  });

  it('inactive shopkeeper cannot sign in', async () => {
    const r = await ctx.client().post('/api/auth/login', { phone: ctx.inactive.phone, password: PW });
    expect(r).toMatchObject({ status: 403, body: { error: 'account_inactive' } });
  });

  it('locks the account for 15 minutes after 5 wrong passwords', async () => {
    const c = ctx.client();
    const results: number[] = [];
    for (let i = 0; i < 5; i++) results.push((await c.post('/api/auth/login', { phone: '03001000002', password: 'wrong-' + i })).status);
    expect(results).toEqual([401, 401, 401, 401, 429]);
    const locked = await c.post('/api/auth/login', { phone: '03001000002', password: PW });
    expect(locked).toMatchObject({ status: 429, body: { error: 'locked' } });
    await ctx.sql`update auth_credentials set locked_until = null where user_id = ${ctx.shopB.userId}`;
    expect((await c.post('/api/auth/login', { phone: '03001000002', password: PW })).status).toBe(200);
  });

  it('deactivating a shop ends its existing session immediately', async () => {
    const shop = await ctx.login('03001000001');
    const admin = await ctx.login('03000000009');
    expect((await shop.get('/api/shop/catalogue')).status).toBe(200);
    expect((await admin.patch(`/api/admin/shops/${ctx.shopA.shopId}`, { status: 'inactive' })).status).toBe(200);
    expect((await shop.get('/api/shop/catalogue')).status).toBe(401);
    expect((await admin.patch(`/api/admin/shops/${ctx.shopA.shopId}`, { status: 'active' })).status).toBe(200);
  });

  it('admin approves a pending shop; then it can sign in', async () => {
    const admin = await ctx.login('03000000009');
    const r = await admin.patch(`/api/admin/shops/${ctx.pending.shopId}`, { status: 'active' });
    expect(r.status).toBe(200);
    const [s] = await ctx.sql`select approved_at, approved_by from shops where id = ${ctx.pending.shopId}`;
    expect(s.approved_at).not.toBeNull();
    expect(s.approved_by).toBe(ctx.admin.userId);
    expect((await ctx.client().post('/api/auth/login', { phone: ctx.pending.phone, password: PW })).status).toBe(200);
    await admin.patch(`/api/admin/shops/${ctx.pending.shopId}`, { status: 'pending' });
  });

  it('requests without a session get 401; shopkeepers get 403 on admin API; admins 403 on shop API', async () => {
    expect((await ctx.client().get('/api/shop/catalogue')).status).toBe(401);
    expect((await ctx.client().get('/api/admin/orders')).status).toBe(401);
    const shop = await ctx.login('03001000001');
    for (const p of ['/api/admin/dashboard', '/api/admin/orders', '/api/admin/shops', '/api/admin/products', '/api/admin/reports/summary', '/api/admin/settings']) {
      expect((await shop.get(p)).status, p).toBe(403);
    }
    expect((await shop.post('/api/admin/reminders/run', {})).status).toBe(403);
    const admin = await ctx.login('03000000009');
    expect((await admin.get('/api/shop/catalogue')).status).toBe(403);
  });

  it('tampered or forged session cookies are rejected', async () => {
    const c = await ctx.login('03001000001');
    const forged = c.cookie().slice(0, -3) + 'abc';
    const r = await ctx.app.request('/api/auth/me', { headers: { cookie: forged } });
    expect(r.status).toBe(401);
  });

  it('state-changing requests without the CSRF header are refused', async () => {
    const c = await ctx.login('03001000001');
    const r = await c.req('POST', '/api/shop/orders', { items: [{ product_id: ctx.products.p1, qty: 1 }] }, { csrf: false });
    expect(r).toMatchObject({ status: 403, body: { error: 'csrf_header_missing' } });
  });

  it('temporary password must be changed before using the app', async () => {
    const admin = await ctx.login('03000000009');
    expect((await admin.post(`/api/admin/shops/${ctx.shopB.shopId}/reset-password`, { password: '739104', must_change_password: true })).status).toBe(200);
    const shop = await ctx.login('03001000002', '739104');
    expect((await shop.get('/api/shop/catalogue')).body.error).toBe('must_change_password');
    expect((await shop.post('/api/auth/change-password', { current: '739104', next: '12345' })).body.error).toBe('password_too_short');
    expect((await shop.post('/api/auth/change-password', { current: 'wrong-one', next: 'abc12345' })).body.error).toBe('wrong_current_password');
    expect((await shop.post('/api/auth/change-password', { current: '739104', next: PW })).status).toBe(200);
    expect((await shop.get('/api/shop/catalogue')).status).toBe(200);
  });

  it('shopkeeper can change preferences but not protected profile fields', async () => {
    const c = await ctx.login('03001000001');
    const r = await c.patch('/api/me/preferences', { language: 'en', theme: 'dark', reminders_opt_out: true });
    expect(r.body.preferences).toEqual({ language: 'en', theme: 'dark', reminders_opt_out: true });
    expect((await c.patch('/api/me/preferences', { role: 'admin' })).status).toBe(400);
    expect((await c.patch('/api/me/preferences', { status: 'active', full_name: 'x' })).status).toBe(400);
    await c.patch('/api/me/preferences', { reminders_opt_out: false });
  });
});

describe('shop account creation by admin', () => {
  it('normalizes the phone, refuses duplicates and weak passwords', async () => {
    const admin = await ctx.login('03000000009');
    const base = { full_name: 'New Person', shop_name: 'New Shop', password: '582014' };
    expect((await admin.post('/api/admin/shops', { ...base, phone: '0301-55 55 555' })).status).toBe(201);
    const [u] = await ctx.sql`select phone, status from app_users where full_name = 'New Person'`;
    expect(u).toEqual({ phone: '+923015555555', status: 'active' });
    expect(await admin.post('/api/admin/shops', { ...base, phone: '+92 301 5555555' })).toMatchObject({ status: 409, body: { error: 'phone_already_registered' } });
    expect(await admin.post('/api/admin/shops', { ...base, phone: '0301 77' })).toMatchObject({ status: 400, body: { error: 'invalid_phone' } });
    expect(await admin.post('/api/admin/shops', { ...base, phone: '03017777777', password: '123456' })).toMatchObject({ status: 400, body: { error: 'password_too_simple' } });
    expect((await admin.post('/api/admin/shops', { ...base, phone: '03018888888', activate: false })).status).toBe(201);
    const [p] = await ctx.sql`select status from app_users where phone = '+923018888888'`;
    expect(p.status).toBe('pending');
  });
});
