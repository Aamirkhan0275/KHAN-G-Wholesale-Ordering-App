import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context.js';
import { asUser } from '../lib/db.js';
import { forbidden, notFound } from '../lib/errors.js';
import { parse, uuidParam, zUuid } from '../lib/validate.js';
import { log } from '../lib/log.js';
import { MAX_LINE_QTY } from '../../shared/cart.js';

/** Shopkeeper API. Every query runs as the user under Row Level Security. */
export const shopRoutes = new Hono<AppEnv>();

shopRoutes.use('*', async (c, next) => {
  if (c.get('user').role !== 'shopkeeper') throw forbidden('shopkeepers_only');
  await next();
});

/** Strip prices from an order the shop was not shown prices for. */
function customerSafeOrder(o: any) {
  if (o.prices_visible) return o;
  const { requested_total: _r, approved_total: _a, ...rest } = o;
  return { ...rest, requested_total: null, approved_total: null };
}
function customerSafeItem(i: any, pricesVisible: boolean) {
  return pricesVisible ? i : { ...i, unit_price_snapshot: null };
}

shopRoutes.get('/catalogue', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const data = await asUser(sql, user.id, async (tx) => {
    const categories = await tx`select id, name_en, name_ur, sort_order from categories where is_active order by sort_order, name_en`;
    const products = await tx`select * from catalogue_products order by sort_order, name_en`;
    const favourites = await tx`select product_id from favourites where shop_id = ${user.shop_id}`;
    const [settings] = await tx`select business_name, business_name_ur, business_whatsapp, currency, show_prices from app_settings where id = 1`;
    return { categories, products, favourites: favourites.map((f: any) => f.product_id), settings };
  });
  return c.json(data);
});

shopRoutes.post('/favourites/:productId', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const pid = uuidParam(c.req.param('productId'));
  await asUser(sql, user.id, async (tx) => {
    const [p] = await tx`select id from catalogue_products where id = ${pid}`;
    if (!p) throw notFound();
    await tx`insert into favourites (shop_id, product_id) values (${user.shop_id}, ${pid}) on conflict do nothing`;
  });
  return c.json({ ok: true });
});

shopRoutes.delete('/favourites/:productId', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const pid = uuidParam(c.req.param('productId'));
  await asUser(sql, user.id, (tx) => tx`delete from favourites where shop_id = ${user.shop_id} and product_id = ${pid}`);
  return c.json({ ok: true });
});

const orderBody = z.object({
  items: z.array(z.object({
    product_id: zUuid,
    qty: z.number().int().min(1).max(MAX_LINE_QTY),
  }).strict()).min(1).max(250),
  note: z.string().trim().max(300).nullish(),
}).strict();

shopRoutes.post('/orders', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const raw = await c.req.json().catch(() => ({}));
  if (Array.isArray(raw?.items) && raw.items.length === 0) return c.json({ error: 'empty_cart' }, 400);
  const body = parse(orderBody, raw);
  // Prices, names, shop and status are decided by the database function, never by the client.
  const order = await asUser(sql, user.id, async (tx) => {
    const [{ id }] = await tx`select place_order(${tx.json(body.items as any)}, ${body.note ?? null}) as id`;
    const [o] = await tx`select id, ref, status, submitted_at, item_count, total_requested_qty, requested_total,
      prices_visible, currency, shop_name_snapshot, customer_name_snapshot, customer_note from orders where id = ${id}`;
    const items = await tx`select id, line_no, product_id, name_en_snapshot, name_ur_snapshot, unit_label_en_snapshot,
      unit_label_ur_snapshot, unit_price_snapshot, requested_qty from order_items where order_id = ${id} order by line_no`;
    return { ...customerSafeOrder(o), items: items.map((i) => customerSafeItem(i, o.prices_visible)) };
  });
  log('info', 'order_placed', { ref: order.ref, shop: user.shop_id, lines: order.item_count, qty: order.total_requested_qty });
  return c.json({ order }, 201);
});

shopRoutes.get('/orders', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 15) || 15, 1), 365);
  const rows = await asUser(sql, user.id, (tx) => tx`
    select o.id, o.ref, o.status, o.submitted_at, o.updated_at, o.item_count, o.total_requested_qty, o.total_approved_qty,
           o.requested_total, o.approved_total, o.prices_visible, o.currency,
           (select i.id from invoices i where i.order_id = o.id and i.status = 'issued') as invoice_id,
           exists (select 1 from order_items oi where oi.order_id = o.id and oi.line_status in ('partial','unavailable','substituted')) as has_changes
    from orders o
    where o.shop_id = ${user.shop_id} and o.submitted_at >= now() - ${days + ' days'}::interval
    order by o.submitted_at desc limit 200`);
  return c.json({ days, orders: rows.map(customerSafeOrder) });
});

shopRoutes.get('/orders/:id', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const id = uuidParam(c.req.param('id'));
  const data = await asUser(sql, user.id, async (tx) => {
    const [o] = await tx`select id, ref, status, submitted_at, updated_at, confirmed_at, delivered_at, cancelled_at,
      item_count, total_requested_qty, total_approved_qty, requested_total, approved_total, prices_visible, currency,
      shop_name_snapshot, customer_name_snapshot, customer_note, whatsapp_opened_at
      from orders where id = ${id} and shop_id = ${user.shop_id}`;
    if (!o) return null;
    const items = await tx`select oi.id, oi.line_no, oi.product_id, oi.name_en_snapshot, oi.name_ur_snapshot,
        oi.unit_label_en_snapshot, oi.unit_label_ur_snapshot, oi.unit_price_snapshot, oi.requested_qty, oi.approved_qty,
        oi.line_status, oi.substitute_for_item_id, oi.customer_note, cp.image_id, cp.availability
      from order_items oi left join catalogue_products cp on cp.id = oi.product_id
      where oi.order_id = ${id} order by oi.line_no`;
    const history = await tx`select to_status, note, changed_at from order_status_history where order_id = ${id} order by changed_at`;
    const [inv] = await tx`select id, invoice_no from invoices where order_id = ${id} and status = 'issued'`;
    return { ...customerSafeOrder(o), items: items.map((i) => customerSafeItem(i, o.prices_visible)), history, invoice: inv ?? null };
  });
  if (!data) throw notFound();
  return c.json({ order: data });
});

shopRoutes.post('/orders/:id/cancel', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const id = uuidParam(c.req.param('id'));
  await asUser(sql, user.id, (tx) => tx`select cancel_my_order(${id})`);
  log('info', 'order_cancelled_by_shop', { order: id, shop: user.shop_id });
  return c.json({ ok: true });
});

shopRoutes.post('/orders/:id/whatsapp', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const id = uuidParam(c.req.param('id'));
  await asUser(sql, user.id, (tx) => tx`select mark_order_whatsapp_opened(${id})`);
  return c.json({ ok: true });
});

shopRoutes.get('/ledger', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const data = await asUser(sql, user.id, async (tx) => {
    const entries = await tx`
      select l.id, l.entry_date, l.kind, l.debit, l.credit, l.reference, l.note, l.payment_method, l.invoice_id,
             i.invoice_no,
             sum(l.debit - l.credit) over (order by l.entry_date, l.created_at, l.id) as running_balance
      from ledger_entries l left join invoices i on i.id = l.invoice_id
      where l.shop_id = ${user.shop_id}
      order by l.entry_date, l.created_at, l.id`;
    const [bal] = await tx`select coalesce(balance, 0) as balance from shop_balances where shop_id = ${user.shop_id}`;
    const [s] = await tx`select currency from app_settings where id = 1`;
    return { balance: bal?.balance ?? 0, currency: s?.currency ?? 'PKR', entries: entries.reverse() };
  });
  return c.json(data);
});

shopRoutes.get('/invoices', async (c) => {
  const { sql } = c.get('deps');
  const user = c.get('user');
  const rows = await asUser(sql, user.id, (tx) => tx`
    select id, invoice_no, order_ref, issue_date, total, currency, status from invoices
    where shop_id = ${user.shop_id} order by issue_date desc, created_at desc limit 200`);
  return c.json({ invoices: rows });
});
