import postgres from 'postgres';
import { inject } from 'vitest';
import { createApp } from '../../server/app';
import { createDb, asUser, type Sql } from '../../server/lib/db';
import { loadEnv } from '../../server/lib/env';
import { hashPassword } from '../../server/lib/auth';

export const PW = 'secret-pass-1';
export const CRON_SECRET = 'cron-secret-for-tests';

export interface Client {
  req: (method: string, path: string, body?: unknown, opts?: { csrf?: boolean; headers?: Record<string, string> }) => Promise<{ status: number; body: any; res: Response }>;
  get: (path: string) => Promise<{ status: number; body: any; res: Response }>;
  post: (path: string, body?: unknown) => Promise<{ status: number; body: any; res: Response }>;
  patch: (path: string, body?: unknown) => Promise<{ status: number; body: any; res: Response }>;
  del: (path: string) => Promise<{ status: number; body: any; res: Response }>;
  cookie: () => string;
}

export async function setupTestApp(name: string) {
  const base: string = inject('pgBaseUrl' as never);
  const dbName = `kg_${name}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = postgres(base, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${dbName} template kg_template`);
  await admin.end();
  const url = base.replace(/\/postgres$/, `/${dbName}`);
  const sql = createDb(url, 5);
  const env = loadEnv({ DATABASE_URL: url, SESSION_SECRET: 'x'.repeat(48), CRON_SECRET, NODE_ENV: 'test' });
  let nowOverride: Date | null = null;
  const app = createApp({ sql, env, now: () => nowOverride ?? new Date() });

  const hash = await hashPassword(PW);
  const mkUser = async (role: string, phone: string, name: string, status = 'active', shopName?: string) => {
    const [u] = await sql<any[]>`insert into app_users (role, full_name, phone, status) values (${role}, ${name}, ${phone}, ${status}) returning id`;
    await sql`insert into auth_credentials (user_id, password_hash) values (${u.id}, ${hash})`;
    let shopId: string | null = null;
    if (shopName) [{ id: shopId }] = await sql<any[]>`insert into shops (owner_user_id, name) values (${u.id}, ${shopName}) returning id`;
    return { userId: u.id as string, shopId: shopId as string, phone };
  };
  const adminU = await mkUser('admin', '+923000000009', 'Test Owner');
  const shopA = await mkUser('shopkeeper', '+923001000001', 'Ali A', 'active', 'Shop A');
  const shopB = await mkUser('shopkeeper', '+923001000002', 'Bano B', 'active', 'Shop B');
  const pending = await mkUser('shopkeeper', '+923001000003', 'Pending P', 'pending', 'Pending Shop');
  const inactive = await mkUser('shopkeeper', '+923001000004', 'Inactive I', 'inactive', 'Inactive Shop');
  await sql`update app_settings set business_whatsapp = '+923001234567', business_name = 'KHAN G'`;
  const [cat] = await sql<any[]>`insert into categories (name_en, name_ur) values ('Biscuits', 'بسکٹ') returning id`;
  const mkProduct = async (sku: string, extra: Record<string, unknown>) => {
    const [p] = await sql<any[]>`insert into products ${sql({ sku, name_en: `Product ${sku}`, name_ur: `چیز ${sku}`, category_id: cat.id, price: 100, stock_qty: 50, low_stock_threshold: 5, ...extra } as any)} returning id`;
    return p.id as string;
  };
  const products = {
    p1: await mkProduct('P1', { price: 100, stock_qty: 50 }),
    p2: await mkProduct('P2', { price: 250, stock_qty: 3 }),          // low stock
    out: await mkProduct('OUT', { stock_qty: 0 }),                  // out of stock
    inactive: await mkProduct('INACT', { is_active: false }),
    archived: await mkProduct('ARCH', { archived_at: new Date(), is_active: false }),
    noprice: await mkProduct('NOPRICE', { price: null }),
  };

  const client = (): Client => {
    let jar = '';
    const req: Client['req'] = async (method, path, body, opts = {}) => {
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      if (jar) headers.cookie = jar;
      if (opts.csrf !== false) headers['x-kg-csrf'] = '1';
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = res.headers.get('set-cookie');
      if (set) {
        const m = /kg_session=([^;]*)/.exec(set);
        if (m) jar = m[1] ? `kg_session=${m[1]}` : '';
      }
      const ct = res.headers.get('content-type') ?? '';
      const parsed = ct.includes('application/json') ? await res.clone().json() : null;
      return { status: res.status, body: parsed, res };
    };
    return {
      req, get: (p) => req('GET', p), post: (p, b) => req('POST', p, b ?? {}), patch: (p, b) => req('PATCH', p, b ?? {}), del: (p) => req('DELETE', p),
      cookie: () => jar,
    };
  };
  const login = async (phone: string, password = PW) => {
    const c = client();
    const r = await c.post('/api/auth/login', { phone, password });
    if (r.status !== 200) throw new Error(`login ${phone} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return c;
  };
  const placeOrder = async (c: Client, items: { product_id: string; qty: number }[], note?: string) => {
    const r = await c.post('/api/shop/orders', { items, note });
    if (r.status !== 201) throw new Error(`order failed ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.order;
  };
  return {
    app, sql, env, url, admin: adminU, shopA, shopB, pending, inactive, products, categoryId: cat.id as string,
    client, login, placeOrder,
    setNow: (d: Date | null) => { nowOverride = d; },
    asUser: (userId: string, fn: (tx: any) => any): Promise<any> => asUser(sql as Sql, userId, async (tx) => fn(tx)),
    close: async () => { await sql.end({ timeout: 2 }); },
  };
}
export type TestCtx = Awaited<ReturnType<typeof setupTestApp>>;
