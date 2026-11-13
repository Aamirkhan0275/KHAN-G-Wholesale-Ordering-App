import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Ctx } from '../context.js';
import { asUser, type Tx } from '../lib/db.js';
import { bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { parse, uuidParam, zDate, zMoney, zOptText, zUuid } from '../lib/validate.js';
import { hashPassword, passwordProblem } from '../lib/auth.js';
import { normalizePhone } from '../../shared/phone.js';
import { ORDER_STATUSES } from '../../shared/status.js';
import { audit, changeStatus, generateInvoice, reviewOrder, shopBalance } from '../lib/orders.js';
import * as reports from '../lib/reports.js';
import { runReminders } from '../lib/reminders.js';
import { localDateString } from '../../shared/zoned.js';
import { log } from '../lib/log.js';
import { customerDetailsPatch, customerDetailsShape } from '../lib/customer.js';

/** Owner/Admin API. Requests run as the admin under RLS (policies require an active admin). */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', async (c, next) => {
  if (c.get('user').role !== 'admin') throw forbidden('admins_only');
  await next();
});

const run = <T>(c: Ctx, fn: (tx: Tx, adminId: string) => Promise<T>) => {
  const { sql } = c.get('deps');
  const id = c.get('user').id;
  return asUser(sql, id, (tx) => fn(tx, id));
};
const body = async (c: Ctx) => c.req.json().catch(() => ({}));

// ============================================================== dashboard
adminRoutes.get('/dashboard', async (c) => {
  const data = await run(c, async (tx) => {
    const [settings] = await tx<any[]>`select timezone, currency from app_settings where id = 1`;
    const [counts] = await tx<any[]>`
      select count(*) filter (where status = 'submitted') as new_orders,
             count(*) filter (where status in ('checking','needs_confirmation')) as needs_action,
             count(*) filter (where status in ('confirmed','ready')) as to_deliver,
             count(*) filter (where status <> 'cancelled' and (submitted_at at time zone ${settings.timezone})::date
                              = (now() at time zone ${settings.timezone})::date) as today_orders
      from orders`;
    const [shops] = await tx<any[]>`
      select count(*) filter (where u.status = 'active') as active, count(*) filter (where u.status = 'pending') as pending,
             count(*) filter (where u.status = 'inactive') as inactive
      from shops s join app_users u on u.id = s.owner_user_id`;
    const [money] = await tx<any[]>`
      select coalesce(sum(balance) filter (where balance > 0), 0) as outstanding, count(*) filter (where balance > 0) as shops_owing
      from shop_balances`;
    const [week] = await tx<any[]>`select coalesce(sum(total), 0) as invoiced_7d, count(*) as invoices_7d from invoices
      where status = 'issued' and issue_date > (now() at time zone ${settings.timezone})::date - 7`;
    const recent = await tx`select o.id, o.ref, o.status, o.submitted_at, o.item_count, o.total_requested_qty, o.shop_name_snapshot as shop
      from orders o order by o.submitted_at desc limit 8`;
    const lowStock = await tx`select id, sku, name_en, name_ur, stock_qty, low_stock_threshold from products
      where archived_at is null and is_active and stock_qty <= low_stock_threshold order by stock_qty, name_en limit 8`;
    const [lowCount] = await tx<any[]>`select count(*) as n from products where archived_at is null and is_active and stock_qty <= low_stock_threshold`;
    const owing = await tx`select s.id, s.name, b.balance from shop_balances b join shops s on s.id = b.shop_id
      where b.balance > 0 order by b.balance desc limit 5`;
    return { counts, shops, money, week, recent, lowStock, lowStockCount: lowCount.n, owing, currency: settings.currency };
  });
  return c.json(data);
});

adminRoutes.get('/pending-count', async (c) => {
  const [r] = await run(c, (tx) => tx`select count(*) as n from orders where status = 'submitted'`);
  return c.json({ unread: r.n });
});

// ============================================================= categories
const categoryBody = z.object({
  name_en: z.string().trim().min(1).max(60),
  name_ur: zOptText(60),
  sort_order: z.number().int().min(-9999).max(9999).optional(),
  is_active: z.boolean().optional(),
}).strict();

adminRoutes.get('/categories', async (c) => {
  const rows = await run(c, (tx) => tx`select c.*, (select count(*) from products p where p.category_id = c.id and p.archived_at is null) as product_count
    from categories c order by c.sort_order, c.name_en`);
  return c.json({ categories: rows });
});

adminRoutes.post('/categories', async (c) => {
  const b = parse(categoryBody, await body(c));
  const row = await run(c, async (tx, admin) => {
    const [r] = await tx`insert into categories ${tx({ name_en: b.name_en, name_ur: b.name_ur, sort_order: b.sort_order ?? 0, is_active: b.is_active ?? true })} returning *`;
    await audit(tx, admin, 'category_create', 'category', r.id, b);
    return r;
  });
  return c.json({ category: row }, 201);
});

adminRoutes.patch('/categories/:id', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(categoryBody.partial(), await body(c));
  const row = await run(c, async (tx, admin) => {
    const [r] = await tx`update categories set ${tx(b as any)} where id = ${id} returning *`;
    if (!r) throw notFound();
    await audit(tx, admin, 'category_update', 'category', id, b);
    return r;
  });
  return c.json({ category: row });
});

adminRoutes.delete('/categories/:id', async (c) => {
  const id = uuidParam(c.req.param('id'));
  await run(c, async (tx, admin) => {
    const [{ n }] = await tx<any[]>`select count(*) as n from products where category_id = ${id}`;
    if (n > 0) throw conflict('category_has_products');
    const r = await tx`delete from categories where id = ${id} returning id`;
    if (!r.length) throw notFound();
    await audit(tx, admin, 'category_delete', 'category', id);
  });
  return c.json({ ok: true });
});

// =============================================================== products
const productBody = z.object({
  sku: z.string().trim().regex(/^[A-Za-z0-9._-]{1,32}$/),
  name_en: z.string().trim().min(2).max(120),
  name_ur: zOptText(120),
  description_en: zOptText(500),
  description_ur: zOptText(500),
  category_id: zUuid.nullish(),
  unit_type: z.enum(['carton', 'box', 'pack', 'dozen', 'piece']).optional(),
  unit_label_en: z.string().trim().min(1).max(30).optional(),
  unit_label_ur: z.string().trim().min(1).max(30).optional(),
  pieces_per_unit: z.number().int().min(1).max(100000).nullish(),
  price: zMoney.nullish(),
  show_price: z.boolean().optional(),
  low_stock_threshold: z.number().int().min(0).max(100000).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(-99999).max(99999).optional(),
  initial_stock: z.number().int().min(0).max(1000000).optional(),
}).strict();

adminRoutes.get('/products', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 60);
  const cat = c.req.query('category');
  const filter = c.req.query('filter') ?? 'all'; // all | active | inactive | archived | low | out
  const rows = await run(c, (tx) => tx`
    select p.id, p.sku, p.name_en, p.name_ur, p.category_id, c.name_en as category_name, p.unit_label_en, p.unit_label_ur,
           p.price, p.show_price, p.stock_qty, p.low_stock_threshold, p.is_active, p.archived_at, p.image_id, p.sort_order, p.updated_at
    from products p left join categories c on c.id = p.category_id
    where (${q} = '' or p.name_en ilike ${'%' + q + '%'} or coalesce(p.name_ur, '') ilike ${'%' + q + '%'} or p.sku ilike ${'%' + q + '%'})
      and (${cat ?? null}::uuid is null or p.category_id = ${cat && /^[0-9a-f-]{36}$/i.test(cat) ? cat : null}::uuid)
      and case ${filter}
            when 'archived' then p.archived_at is not null
            when 'active' then p.archived_at is null and p.is_active
            when 'inactive' then p.archived_at is null and not p.is_active
            when 'low' then p.archived_at is null and p.stock_qty <= p.low_stock_threshold and p.stock_qty > 0
            when 'out' then p.archived_at is null and p.stock_qty <= 0
            else p.archived_at is null end
    order by p.sort_order, p.name_en limit 1000`);
  return c.json({ products: rows });
});

adminRoutes.get('/products/:id', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const data = await run(c, async (tx) => {
    const [p] = await tx`select * from products where id = ${id}`;
    if (!p) throw notFound();
    const movements = await tx`select m.*, u.full_name as actor from inventory_movements m left join app_users u on u.id = m.actor_id
      where m.product_id = ${id} order by m.created_at desc limit 50`;
    const [{ n }] = await tx<any[]>`select count(*) as n from order_items where product_id = ${id}`;
    return { product: p, movements, order_lines: n };
  });
  return c.json(data);
});

adminRoutes.post('/products', async (c) => {
  const b = parse(productBody, await body(c));
  const row = await run(c, async (tx, admin) => {
    const { initial_stock, ...fields } = b;
    const [s] = await tx<any[]>`select low_stock_default from app_settings where id = 1`;
    const values: Record<string, unknown> = { low_stock_threshold: s.low_stock_default, ...fields, stock_qty: initial_stock ?? 0 };
    const [p] = await tx`insert into products ${tx(values as any)} returning *`;
    if (initial_stock) {
      await tx`insert into inventory_movements (product_id, change, stock_after, reason, actor_id)
        values (${p.id}, ${initial_stock}, ${initial_stock}, 'initial', ${admin})`;
    }
    await audit(tx, admin, 'product_create', 'product', p.id, { sku: p.sku });
    return p;
  });
  return c.json({ product: row }, 201);
});

adminRoutes.patch('/products/:id', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(productBody.omit({ initial_stock: true }).partial(), await body(c));
  if (!Object.keys(b).length) throw bad('nothing_to_update');
  const row = await run(c, async (tx, admin) => {
    const [before] = await tx<any[]>`select * from products where id = ${id}`;
    if (!before) throw notFound();
    const [p] = await tx`update products set ${tx(b as any)} where id = ${id} returning *`;
    const changed = Object.fromEntries(Object.entries(b).filter(([k, v]) => before[k] !== v).map(([k, v]) => [k, { from: before[k], to: v }]));
    await audit(tx, admin, 'product_update', 'product', id, changed);
    return p;
  });
  return c.json({ product: row });
});

adminRoutes.post('/products/:id/archive', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const row = await run(c, async (tx, admin) => {
    const [p] = await tx`update products set archived_at = coalesce(archived_at, now()), is_active = false where id = ${id} returning *`;
    if (!p) throw notFound();
    await audit(tx, admin, 'product_archive', 'product', id);
    return p;
  });
  return c.json({ product: row });
});

adminRoutes.post('/products/:id/restore', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const row = await run(c, async (tx, admin) => {
    const [p] = await tx`update products set archived_at = null where id = ${id} returning *`;
    if (!p) throw notFound();
    await audit(tx, admin, 'product_restore', 'product', id);
    return p;
  });
  return c.json({ product: row });
});

/** Hard delete only for products never used in an order; otherwise archive. */
adminRoutes.delete('/products/:id', async (c) => {
  const id = uuidParam(c.req.param('id'));
  await run(c, async (tx, admin) => {
    const [{ n }] = await tx<any[]>`select count(*) as n from order_items where product_id = ${id}`;
    if (n > 0) throw conflict('product_in_orders_archive_instead');
    const r = await tx`delete from products where id = ${id} returning sku`;
    if (!r.length) throw notFound();
    await audit(tx, admin, 'product_delete', 'product', id, { sku: r[0].sku });
  });
  return c.json({ ok: true });
});

const MAX_IMAGE_BYTES = 1_500_000;
function sniffImage(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** Upload/replace a product photo: JSON { data: base64 } (the browser resizes first). SVG is not accepted. */
adminRoutes.post('/products/:id/image', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(z.object({ data: z.string().min(10).max(2_100_000) }).strict(), await body(c));
  const buf = Buffer.from(b.data.replace(/^data:[^,]+,/, ''), 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw bad('image_too_large');
  const type = sniffImage(buf);
  if (!type) throw bad('image_type_not_allowed');
  const row = await run(c, async (tx, admin) => {
    const [p] = await tx<any[]>`select id, image_id from products where id = ${id} for update`;
    if (!p) throw notFound();
    const [img] = await tx`insert into product_images (product_id, content_type, data, byte_size, uploaded_by)
      values (${id}, ${type}, ${buf}, ${buf.length}, ${admin}) returning id, content_type, byte_size`;
    await tx`update products set image_id = ${img.id} where id = ${id}`;
    if (p.image_id) await tx`delete from product_images where id = ${p.image_id}`;
    await audit(tx, admin, 'product_image', 'product', id, { bytes: buf.length, type });
    return img;
  });
  return c.json({ image: row }, 201);
});

adminRoutes.delete('/products/:id/image', async (c) => {
  const id = uuidParam(c.req.param('id'));
  await run(c, async (tx, admin) => {
    const [p] = await tx<any[]>`select image_id from products where id = ${id} for update`;
    if (!p) throw notFound();
    await tx`update products set image_id = null where id = ${id}`;
    if (p.image_id) await tx`delete from product_images where id = ${p.image_id}`;
    await audit(tx, admin, 'product_image_remove', 'product', id);
  });
  return c.json({ ok: true });
});

// ================================================================== stock
const stockBody = z.union([
  z.object({ change: z.number().int().min(-1000000).max(1000000).refine((v) => v !== 0, 'zero'), reason: z.enum(['restock', 'adjustment', 'damage', 'return']), note: zOptText(300) }).strict(),
  z.object({ set_to: z.number().int().min(0).max(1000000), reason: z.enum(['adjustment', 'restock']).optional(), note: zOptText(300) }).strict(),
]);

adminRoutes.post('/products/:id/stock', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(stockBody, await body(c));
  const result = await run(c, async (tx, admin) => {
    const [p] = await tx<any[]>`select id, stock_qty from products where id = ${id} for update`;
    if (!p) throw notFound();
    const change = 'set_to' in b ? b.set_to - p.stock_qty : b.change;
    if (change === 0) return { stock_qty: p.stock_qty, change: 0 };
    const after = p.stock_qty + change;
    if (after < 0) throw bad('stock_cannot_go_negative', { stock: p.stock_qty });
    const reason = 'set_to' in b ? b.reason ?? 'adjustment' : b.reason;
    await tx`update products set stock_qty = ${after} where id = ${id}`;
    await tx`insert into inventory_movements (product_id, change, stock_after, reason, note, actor_id)
      values (${id}, ${change}, ${after}, ${reason}, ${b.note ?? null}, ${admin})`;
    return { stock_qty: after, change };
  });
  log('info', 'stock_adjusted', { product: id, ...result });
  return c.json(result);
});

adminRoutes.get('/stock/movements', async (c) => {
  const rows = await run(c, (tx) => tx`
    select m.id, m.change, m.stock_after, m.reason, m.note, m.created_at, p.sku, p.name_en, o.ref as order_ref, u.full_name as actor
    from inventory_movements m join products p on p.id = m.product_id
    left join orders o on o.id = m.order_id left join app_users u on u.id = m.actor_id
    order by m.created_at desc limit 200`);
  return c.json({ movements: rows });
});

// ================================================================== shops
const createShopBody = z.object({
  full_name: z.string().trim().min(2).max(80),
  phone: z.string().max(40),
  shop_name: z.string().trim().min(2).max(100),
  address: zOptText(300),
  location_note: zOptText(300),
  language: z.enum(['en', 'ur']).optional(),
  password: z.string().max(100),
  activate: z.boolean().optional(),
  must_change_password: z.boolean().optional(),
  opening_balance: zMoney.optional(),
  ...customerDetailsShape,
}).strict();

adminRoutes.get('/shops', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 60);
  const status = c.req.query('status') ?? 'all';
  const rows = await run(c, (tx) => tx`
    select s.id, s.name, s.address, s.city, s.area, s.location_note, s.alternate_phone, s.whatsapp_phone, s.email, s.cnic, s.ntn, s.shop_type,
      s.reminder_enabled, s.created_at, u.id as user_id, u.full_name, u.phone, u.status, u.language,
      u.last_login_at, coalesce(b.balance, 0) as balance,
      (select max(submitted_at) from orders o where o.shop_id = s.id and o.status <> 'cancelled') as last_order_at,
      (select count(*) from orders o where o.shop_id = s.id and o.status <> 'cancelled') as order_count
    from shops s join app_users u on u.id = s.owner_user_id left join shop_balances b on b.shop_id = s.id
    where (${q} = '' or s.name ilike ${'%' + q + '%'} or u.full_name ilike ${'%' + q + '%'} or coalesce(s.city, '') ilike ${'%' + q + '%'}
           or coalesce(s.area, '') ilike ${'%' + q + '%'} or coalesce(s.address, '') ilike ${'%' + q + '%'}
           or (${q.replace(/\D/g, '')} <> '' and u.phone like ${'%' + q.replace(/\D/g, '').replace(/^0/, '') + '%'}))
      and (${status} = 'all' or u.status = ${status})
    order by case u.status when 'pending' then 0 when 'active' then 1 else 2 end, s.name`);
  if (c.req.query('format') === 'csv') {
    return csv(c, 'khan-g-customers.csv', rows.map((r: any) => ({
      shop: r.name, owner: r.full_name, mobile: r.phone, whatsapp: r.whatsapp_phone, alternate_phone: r.alternate_phone, email: r.email,
      city: r.city, area: r.area, address: r.address, location_note: r.location_note, shop_type: r.shop_type, cnic: r.cnic, ntn: r.ntn,
      status: r.status, language: r.language, balance: r.balance, orders: r.order_count, last_order_at: r.last_order_at, created_at: r.created_at,
    })));
  }
  return c.json({ shops: rows });
});

adminRoutes.post('/shops', async (c) => {
  const b = parse(createShopBody, await body(c));
  const phone = normalizePhone(b.phone);
  if (!phone.ok) throw bad('invalid_phone');
  const problem = passwordProblem(b.password);
  if (problem) throw bad(problem);
  const details = customerDetailsPatch(b);
  const hash = await hashPassword(b.password);
  const shop = await run(c, async (tx, admin) => {
    const [dupe] = await tx`select id from app_users where phone = ${phone.e164}`;
    if (dupe) throw conflict('phone_already_registered');
    const status = b.activate === false ? 'pending' : 'active';
    const [u] = await tx<any[]>`insert into app_users (role, full_name, phone, status, language)
      values ('shopkeeper', ${b.full_name}, ${phone.e164}, ${status}, ${b.language ?? 'ur'}) returning id`;
    // Credentials are written by the trusted connection (no RLS role has access to them).
    await tx`set local role none`;
    await tx`insert into auth_credentials (user_id, password_hash, must_change_password) values (${u.id}, ${hash}, ${b.must_change_password ?? false})`;
    await tx`set local role authenticated`;
    const [s] = await tx<any[]>`insert into shops (owner_user_id, name, address, location_note, approved_at, approved_by)
      values (${u.id}, ${b.shop_name}, ${b.address}, ${b.location_note}, ${status === 'active' ? tx`now()` : null}, ${status === 'active' ? admin : null})
      returning *`;
    if (Object.keys(details).length) await tx`update shops set ${tx(details as any)} where id = ${s.id}`;
    if (b.opening_balance && b.opening_balance > 0) {
      await tx`insert into ledger_entries (shop_id, entry_date, kind, debit, note, created_by)
        values (${s.id}, current_date, 'opening_balance', ${b.opening_balance}, 'Opening balance', ${admin})`;
    }
    await audit(tx, admin, 'shop_create', 'shop', s.id, { phone: phone.e164, status });
    return s;
  });
  log('info', 'shop_created', { shop: shop.id });
  return c.json({ shop }, 201);
});

adminRoutes.get('/shops/:id', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 15) || 15, 1), 365);
  const data = await run(c, async (tx) => {
    const [shop] = await tx`select s.*, u.full_name, u.phone, u.status, u.language, u.theme, u.reminders_opt_out, u.last_login_at
      from shops s join app_users u on u.id = s.owner_user_id where s.id = ${id}`;
    if (!shop) throw notFound();
    const [stats] = await tx`
      select count(*) filter (where status <> 'cancelled') as orders_all,
        count(*) filter (where status <> 'cancelled' and submitted_at >= now() - ${days + ' days'}::interval) as orders_period,
        coalesce(sum(total_requested_qty) filter (where status <> 'cancelled' and submitted_at >= now() - ${days + ' days'}::interval), 0) as units_period,
        max(submitted_at) filter (where status <> 'cancelled') as last_order_at
      from orders where shop_id = ${id}`;
    const [inv] = await tx`select coalesce(sum(total) filter (where status = 'issued'), 0) as total_purchases,
        coalesce(sum(total) filter (where status = 'issued' and issue_date >= current_date - ${days}::int), 0) as purchases_period
      from invoices where shop_id = ${id}`;
    const balance = await shopBalance(tx, id);
    const orders = await tx`select id, ref, status, submitted_at, item_count, total_requested_qty, approved_total
      from orders where shop_id = ${id} and submitted_at >= now() - ${days + ' days'}::interval order by submitted_at desc`;
    const payments = await tx`select id, entry_date, credit as amount, payment_method, reference, note, created_at
      from ledger_entries where shop_id = ${id} and kind = 'payment' order by entry_date desc, created_at desc limit 50`;
    const reminders = await tx`select cycle_key, weekday, status, created_at from reminder_log where shop_id = ${id} order by created_at desc limit 12`;
    const [adminDetails] = await tx`select notes, credit_limit, updated_at from shop_admin_details where shop_id = ${id}`;
    return { shop, stats: { ...stats, ...inv, balance, days }, orders, payments, reminders, admin_details: adminDetails ?? { notes: null, credit_limit: null } };
  });
  return c.json(data);
});

const updateShopBody = z.object({
  shop_name: z.string().trim().min(2).max(100).optional(),
  address: zOptText(300).optional(),
  location_note: zOptText(300).optional(),
  full_name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().max(40).optional(),
  status: z.enum(['pending', 'active', 'inactive']).optional(),
  language: z.enum(['en', 'ur']).optional(),
  reminder_enabled: z.boolean().optional(),
  reminder_weekday: z.number().int().min(0).max(6).nullable().optional(),
  ...customerDetailsShape,
}).strict();

adminRoutes.patch('/shops/:id', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(updateShopBody, await body(c));
  const result = await run(c, async (tx, admin) => {
    const [s] = await tx<any[]>`select s.*, u.status from shops s join app_users u on u.id = s.owner_user_id where s.id = ${id} for update of s`;
    if (!s) throw notFound();
    const shopPatch: Record<string, unknown> = {};
    if (b.shop_name !== undefined) shopPatch.name = b.shop_name;
    for (const k of ['address', 'location_note', 'reminder_enabled', 'reminder_weekday'] as const) if (b[k] !== undefined) shopPatch[k] = b[k];
    Object.assign(shopPatch, customerDetailsPatch(b));
    if (b.status === 'active' && s.status !== 'active' && !s.approved_at) { shopPatch.approved_at = new Date(); shopPatch.approved_by = admin; }
    const userPatch: Record<string, unknown> = {};
    if (b.full_name !== undefined) userPatch.full_name = b.full_name;
    if (b.status !== undefined) userPatch.status = b.status;
    if (b.language !== undefined) userPatch.language = b.language;
    if (b.phone !== undefined) {
      const p = normalizePhone(b.phone);
      if (!p.ok) throw bad('invalid_phone');
      const [dupe] = await tx`select id from app_users where phone = ${p.e164} and id <> ${s.owner_user_id}`;
      if (dupe) throw conflict('phone_already_registered');
      userPatch.phone = p.e164;
    }
    if (Object.keys(shopPatch).length) await tx`update shops set ${tx(shopPatch as any)} where id = ${id}`;
    if (Object.keys(userPatch).length) await tx`update app_users set ${tx(userPatch as any)} where id = ${s.owner_user_id}`;
    await audit(tx, admin, b.status && b.status !== s.status ? `shop_status_${b.status}` : 'shop_update', 'shop', id, b);
    return { ok: true };
  });
  return c.json(result);
});

/** Admin-only customer facts (never visible to the shop). */
adminRoutes.put('/shops/:id/admin-details', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(z.object({ notes: zOptText(1000), credit_limit: zMoney.nullish() }).strict(), await body(c));
  const r = await run(c, async (tx, admin) => {
    const [s] = await tx`select id from shops where id = ${id}`;
    if (!s) throw notFound();
    const [row] = await tx`insert into shop_admin_details (shop_id, notes, credit_limit, updated_by, updated_at)
      values (${id}, ${b.notes}, ${b.credit_limit ?? null}, ${admin}, now())
      on conflict (shop_id) do update set notes = excluded.notes, credit_limit = excluded.credit_limit, updated_by = excluded.updated_by, updated_at = now()
      returning notes, credit_limit, updated_at`;
    await audit(tx, admin, 'shop_admin_details', 'shop', id, { credit_limit: b.credit_limit ?? null });
    return row;
  });
  return c.json({ admin_details: r });
});

adminRoutes.post('/shops/:id/reset-password', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(z.object({ password: z.string().max(100), must_change_password: z.boolean().optional() }).strict(), await body(c));
  const problem = passwordProblem(b.password);
  if (problem) throw bad(problem);
  const hash = await hashPassword(b.password);
  await run(c, async (tx, admin) => {
    const [s] = await tx<any[]>`select owner_user_id from shops where id = ${id}`;
    if (!s) throw notFound();
    await audit(tx, admin, 'shop_password_reset', 'shop', id);
    await tx`set local role none`; // credentials table: trusted connection only
    await tx`update auth_credentials set password_hash = ${hash}, must_change_password = ${b.must_change_password ?? true},
      failed_attempts = 0, locked_until = null, session_version = session_version + 1, password_changed_at = now()
      where user_id = ${s.owner_user_id}`;
  });
  return c.json({ ok: true });
});

adminRoutes.get('/shops/:id/ledger', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const data = await run(c, async (tx) => {
    const entries = await tx`
      select l.*, i.invoice_no, u.full_name as created_by_name,
        sum(l.debit - l.credit) over (order by l.entry_date, l.created_at, l.id) as running_balance
      from ledger_entries l left join invoices i on i.id = l.invoice_id left join app_users u on u.id = l.created_by
      where l.shop_id = ${id} order by l.entry_date, l.created_at, l.id`;
    return { entries: entries.reverse(), balance: await shopBalance(tx, id) };
  });
  if (c.req.query('format') === 'csv') return csv(c, `ledger-${id.slice(0, 8)}.csv`, data.entries);
  return c.json(data);
});

const paymentBody = z.object({
  amount: zMoney.refine((v) => v > 0, 'positive'),
  entry_date: zDate.optional(),
  payment_method: z.enum(['cash', 'bank', 'mobile_wallet', 'cheque', 'other']).optional(),
  reference: zOptText(80),
  note: zOptText(300),
}).strict();

adminRoutes.post('/shops/:id/payments', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(paymentBody, await body(c));
  const result = await run(c, async (tx, admin) => {
    const [s] = await tx<any[]>`select s.id, s.owner_user_id from shops s where s.id = ${id}`;
    if (!s) throw notFound();
    const [{ today }] = await tx<any[]>`select (now() at time zone (select timezone from app_settings where id = 1))::date as today`;
    const [e] = await tx`insert into ledger_entries (shop_id, entry_date, kind, credit, payment_method, reference, note, created_by)
      values (${id}, ${b.entry_date ?? today}, 'payment', ${b.amount}, ${b.payment_method ?? 'cash'}, ${b.reference}, ${b.note}, ${admin}) returning *`;
    const balance = await shopBalance(tx, id);
    await tx`insert into notifications (user_id, kind, data, link) values (${s.owner_user_id}, 'payment',
      ${tx.json({ amount: b.amount, balance } as any)}, '/account')`;
    await audit(tx, admin, 'payment_record', 'shop', id, { amount: b.amount, entry: e.id });
    return { entry: e, balance };
  });
  log('info', 'payment_recorded', { shop: id, amount: b.amount });
  return c.json(result, 201);
});

const adjustmentBody = z.object({
  kind: z.enum(['opening_balance', 'adjustment']),
  direction: z.enum(['debit', 'credit']),
  amount: zMoney.refine((v) => v > 0, 'positive'),
  entry_date: zDate.optional(),
  note: z.string().trim().min(2).max(300),
}).strict();

adminRoutes.post('/shops/:id/adjustments', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(adjustmentBody, await body(c));
  const result = await run(c, async (tx, admin) => {
    const [s] = await tx<any[]>`select id from shops where id = ${id}`;
    if (!s) throw notFound();
    const [e] = await tx`insert into ledger_entries (shop_id, entry_date, kind, debit, credit, note, created_by)
      values (${id}, ${b.entry_date ?? tx`current_date`}, ${b.kind}, ${b.direction === 'debit' ? b.amount : 0},
              ${b.direction === 'credit' ? b.amount : 0}, ${b.note}, ${admin}) returning *`;
    await audit(tx, admin, 'ledger_adjustment', 'shop', id, b);
    return { entry: e, balance: await shopBalance(tx, id) };
  });
  return c.json(result, 201);
});

// ================================================================= orders
adminRoutes.get('/orders', async (c) => {
  const status = c.req.query('status') ?? 'all';
  const shop = c.req.query('shop');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const q = (c.req.query('q') ?? '').trim().slice(0, 40);
  if (status !== 'all' && status !== 'open' && !(ORDER_STATUSES as readonly string[]).includes(status)) throw bad('invalid_status');
  for (const d of [from, to]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw bad('invalid_date');
  const shopId = shop && /^[0-9a-f-]{36}$/i.test(shop) ? shop : null;
  const rows = await run(c, async (tx) => {
    const [{ timezone: tz }] = await tx<any[]>`select timezone from app_settings where id = 1`;
    return tx`
      select o.id, o.ref, o.status, o.submitted_at, o.item_count, o.total_requested_qty, o.total_approved_qty,
        o.requested_total, o.approved_total, o.currency, o.shop_id, o.shop_name_snapshot as shop, o.whatsapp_opened_at,
        (select invoice_no from invoices i where i.order_id = o.id and i.status = 'issued') as invoice_no
      from orders o
      where (${status} = 'all' or (${status} = 'open' and o.status in ('submitted','checking','needs_confirmation')) or o.status = ${status})
        and (${shopId}::uuid is null or o.shop_id = ${shopId}::uuid)
        and (${from ?? null}::date is null or o.submitted_at >= ((${from ?? null}::date)::timestamp at time zone ${tz}))
        and (${to ?? null}::date is null or o.submitted_at < (((${to ?? null}::date) + 1)::timestamp at time zone ${tz}))
        and (${q} = '' or o.ref ilike ${'%' + q + '%'} or o.shop_name_snapshot ilike ${'%' + q + '%'})
      order by o.submitted_at desc limit 500`;
  });
  return c.json({ orders: rows });
});

adminRoutes.get('/orders/:id', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const data = await run(c, async (tx) => {
    const [o] = await tx`select o.*, u.full_name as placed_by_name from orders o join app_users u on u.id = o.placed_by where o.id = ${id}`;
    if (!o) throw notFound();
    const items = await tx`select oi.*, p.stock_qty as current_stock, p.image_id, p.is_active as product_active, p.archived_at as product_archived_at
      from order_items oi left join products p on p.id = oi.product_id where oi.order_id = ${id} order by oi.line_no`;
    const history = await tx`select h.*, u.full_name as changed_by_name from order_status_history h left join app_users u on u.id = h.changed_by
      where h.order_id = ${id} order by h.changed_at`;
    const notes = await tx`select n.*, u.full_name as author from order_internal_notes n left join app_users u on u.id = n.author_id
      where n.order_id = ${id} order by n.created_at`;
    const [invoice] = await tx`select id, invoice_no, status, total, issue_date from invoices where order_id = ${id}`;
    return { order: o, items, history, notes, invoice: invoice ?? null };
  });
  return c.json(data);
});

const reviewBody = z.object({
  items: z.array(z.object({
    id: zUuid,
    approved_qty: z.number().int().min(0).max(999),
    customer_note: zOptText(200),
    unit_price: zMoney.nullish(),
  }).strict()).max(500),
  substitutes: z.array(z.object({
    for_item_id: zUuid, product_id: zUuid, qty: z.number().int().min(1).max(999), customer_note: zOptText(200),
  }).strict()).max(100).optional(),
}).strict();

adminRoutes.post('/orders/:id/review', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(reviewBody, await body(c));
  const r = await run(c, (tx, admin) => reviewOrder(tx, admin, id, b));
  return c.json(r);
});

adminRoutes.post('/orders/:id/status', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(z.object({ to: z.enum(ORDER_STATUSES), note: zOptText(300) }).strict(), await body(c));
  const r = await run(c, (tx, admin) => changeStatus(tx, admin, id, b.to, b.note));
  log('info', 'order_status_changed', { order: id, to: b.to });
  return c.json(r);
});

adminRoutes.post('/orders/:id/notes', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const b = parse(z.object({ note: z.string().trim().min(1).max(1000) }).strict(), await body(c));
  const r = await run(c, async (tx, admin) => {
    const [o] = await tx`select id from orders where id = ${id}`;
    if (!o) throw notFound();
    const [n] = await tx`insert into order_internal_notes (order_id, note, author_id) values (${id}, ${b.note}, ${admin}) returning *`;
    return n;
  });
  return c.json({ note: r }, 201);
});

adminRoutes.post('/orders/:id/invoice', async (c) => {
  const id = uuidParam(c.req.param('id'));
  const r = await run(c, (tx, admin) => generateInvoice(tx, admin, id));
  if (r.created) log('info', 'invoice_created', { order: id, invoice: r.invoice.invoice_no });
  return c.json(r, r.created ? 201 : 200);
});

adminRoutes.get('/invoices', async (c) => {
  const shop = c.req.query('shop');
  const shopId = shop && /^[0-9a-f-]{36}$/i.test(shop) ? shop : null;
  const rows = await run(c, (tx) => tx`
    select i.id, i.invoice_no, i.order_id, i.order_ref, i.issue_date, i.total, i.currency, i.status, s.name as shop
    from invoices i join shops s on s.id = i.shop_id
    where (${shopId}::uuid is null or i.shop_id = ${shopId}::uuid)
    order by i.issue_date desc, i.created_at desc limit 500`);
  return c.json({ invoices: rows });
});

// ================================================================ reports
function csv(c: Ctx, filename: string, rows: Record<string, unknown>[]) {
  return new Response(reports.toCsv(rows), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'private, no-store' },
  });
}

adminRoutes.get('/reports/:name', async (c) => {
  const name = c.req.param('name');
  const data = await run(c, async (tx) => {
    const [{ timezone: tz }] = await tx<any[]>`select timezone from app_settings where id = 1`;
    const today = localDateString(new Date(), tz);
    const from = c.req.query('from') ?? new Date(Date.parse(today) - 29 * 86400000).toISOString().slice(0, 10);
    const to = c.req.query('to') ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw bad('invalid_range');
    const period = (c.req.query('period') ?? 'day') as reports.Period;
    if (name === 'sales-by-period' && !(period in reports.PERIOD_MAX_DAYS)) throw bad('invalid_period');
    const maxDays = name === 'sales-by-period' ? reports.PERIOD_MAX_DAYS[period] : 366;
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > maxDays) throw bad('range_too_long');
    const r = { from, to, tz };
    switch (name) {
      case 'sales-by-period': {
        const cur = await reports.salesByPeriod(tx, r, period);
        // Same-length range just before, for "compared with previous period".
        const { prevFrom, prevTo } = reports.previousRange(from, to, period);
        const prev = await reports.salesByPeriod(tx, { from: prevFrom, to: prevTo, tz }, period);
        return { range: r, period, rows: cur.rows, totals: cur.totals, previous: { from: prevFrom, to: prevTo, totals: prev.totals } };
      }
      case 'summary': return { range: r, rows: [await reports.summary(tx, r)] };
      case 'sales-by-day': return { range: r, rows: await reports.salesByDay(tx, r) };
      case 'sales-by-shop': return { range: r, rows: await reports.salesByShop(tx, r) };
      case 'products': return { range: r, rows: await reports.productQuantities(tx, r) };
      case 'balances': return { range: r, rows: await reports.balances(tx) };
      case 'low-stock': return { range: r, rows: await reports.lowStock(tx) };
      default: throw notFound();
    }
  });
  if (c.req.query('format') === 'csv') return csv(c, `khan-g-${name}-${data.range.from}-to-${data.range.to}.csv`, data.rows);
  return c.json(data);
});

// ============================================================== settings
const settingsBody = z.object({
  business_name: z.string().trim().min(1).max(80),
  business_name_ur: zOptText(80),
  business_phone: zOptText(30),
  business_whatsapp: z.string().max(30).nullish(),
  business_address: zOptText(300),
  business_email: z.string().trim().email().max(120).nullish().or(z.literal('')).transform((v) => v || null),
  invoice_footer: zOptText(300),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  show_prices: z.boolean(),
  timezone: z.string().max(60),
  reminders_enabled: z.boolean(),
  reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  reminder_rule: z.enum(['latest_order', 'fixed']),
  reminder_default_weekday: z.number().int().min(0).max(6).nullable(),
  low_stock_default: z.number().int().min(0).max(100000),
}).partial().strict();

adminRoutes.get('/settings', async (c) => {
  const [s] = await run(c, (tx) => tx`select *, reminder_time::text as reminder_time from app_settings where id = 1`);
  return c.json({ settings: { ...s, reminder_time: String(s.reminder_time).slice(0, 5) } });
});

adminRoutes.patch('/settings', async (c) => {
  const b = parse(settingsBody, await body(c));
  const patch: Record<string, unknown> = { ...b };
  if (b.business_whatsapp !== undefined) {
    if (!b.business_whatsapp) patch.business_whatsapp = null;
    else {
      const p = normalizePhone(b.business_whatsapp);
      if (!p.ok) throw bad('invalid_whatsapp_number');
      patch.business_whatsapp = p.e164;
    }
  }
  if (b.timezone) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: b.timezone }); } catch { throw bad('invalid_timezone'); }
  }
  const s = await run(c, async (tx, admin) => {
    const [r] = await tx`update app_settings set ${tx({ ...patch, updated_at: new Date() } as any)} where id = 1 returning *, reminder_time::text as reminder_time`;
    await audit(tx, admin, 'settings_update', 'settings', '1', patch);
    return r;
  });
  return c.json({ settings: { ...s, reminder_time: String(s.reminder_time).slice(0, 5) } });
});

// ============================================================== reminders
adminRoutes.get('/reminders', async (c) => {
  const data = await run(c, async (tx) => {
    const log = await tx`select r.id, r.cycle_key, r.weekday, r.status, r.created_at, s.name as shop, s.id as shop_id,
        n.read_at
      from reminder_log r join shops s on s.id = r.shop_id left join notifications n on n.id = r.notification_id
      order by r.created_at desc limit 200`;
    const [{ timezone: tz }] = await tx<any[]>`select timezone from app_settings where id = 1`;
    const plan = await tx`
      select s.id, s.name, s.reminder_enabled, s.reminder_weekday, u.reminders_opt_out,
        (select extract(dow from o.submitted_at at time zone ${tz})::int from orders o where o.shop_id = s.id and o.status <> 'cancelled'
          order by o.submitted_at desc limit 1) as last_order_dow,
        (select max(o.submitted_at) from orders o where o.shop_id = s.id and o.status <> 'cancelled') as last_order_at
      from shops s join app_users u on u.id = s.owner_user_id where u.status = 'active' order by s.name`;
    return { log, plan };
  });
  return c.json(data);
});

/** Run the reminder job now (same code the scheduler runs). `at` lets the owner test a specific time. */
adminRoutes.post('/reminders/run', async (c) => {
  const b = parse(z.object({ at: z.string().datetime({ offset: true }).optional() }).strict(), await body(c));
  const { sql } = c.get('deps');
  const result = await runReminders(sql, b.at ? new Date(b.at) : c.get('deps').now?.() ?? new Date());
  await run(c, (tx, admin) => audit(tx, admin, 'reminders_run', 'reminders', null, result));
  return c.json(result);
});

adminRoutes.get('/audit', async (c) => {
  const rows = await run(c, (tx) => tx`select a.*, u.full_name as actor from audit_log a left join app_users u on u.id = a.actor_id
    order by a.id desc limit 200`);
  return c.json({ entries: rows });
});
