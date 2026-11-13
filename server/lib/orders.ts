import type { Tx } from './db.js';
import { ApiError, bad, conflict, notFound } from './errors.js';
import { canTransition, LOCKED_STATUSES, lineStatusFor, type OrderStatus } from '../../shared/status.js';

/**
 * Admin order operations. All of them run inside an `asUser(admin)` transaction,
 * so RLS still applies (an inactive admin can do nothing).
 *
 * Inventory rule (documented in README): stock is deducted when an order moves to
 * `confirmed` (approved quantities are then locked). Cancelling a confirmed/ready
 * order puts the stock back. Delivered orders are final.
 */

export interface ReviewInput {
  items: { id: string; approved_qty: number; customer_note?: string | null; unit_price?: number | null }[];
  substitutes?: { for_item_id: string; product_id: string; qty: number; customer_note?: string | null }[];
}

export async function audit(tx: Tx, actor: string, action: string, entity: string, entityId: string | null, details: unknown = {}) {
  await tx`insert into audit_log (actor_id, action, entity, entity_id, details) values (${actor}, ${action}, ${entity}, ${entityId}, ${tx.json(details as any)})`;
}

async function lockOrder(tx: Tx, orderId: string) {
  const [o] = await tx<any[]>`select * from orders where id = ${orderId} for update`;
  if (!o) throw notFound();
  return o;
}

export async function recomputeTotals(tx: Tx, orderId: string) {
  await tx`
    update orders o set
      total_approved_qty = t.approved_qty,
      approved_total = case when t.unpriced then null else t.approved_total end
    from (
      select sum(coalesce(approved_qty, 0)) filter (where approved_qty is not null) as approved_qty,
             bool_or(coalesce(approved_qty, 0) > 0 and unit_price_snapshot is null) as unpriced,
             sum(coalesce(approved_qty, 0) * coalesce(unit_price_snapshot, 0)) as approved_total
      from order_items where order_id = ${orderId}
    ) t
    where o.id = ${orderId}`;
}

export async function reviewOrder(tx: Tx, adminId: string, orderId: string, input: ReviewInput) {
  const order = await lockOrder(tx, orderId);
  if (LOCKED_STATUSES.includes(order.status) || order.status === 'cancelled') throw conflict('order_locked');
  const lines = await tx<any[]>`select * from order_items where order_id = ${orderId} order by line_no`;
  const byId = new Map(lines.map((l) => [l.id, l]));
  const changes: unknown[] = [];

  const subFor = new Set((input.substitutes ?? []).map((s) => s.for_item_id));
  for (const it of input.items) {
    const line = byId.get(it.id);
    if (!line) throw bad('unknown_item', { itemId: it.id });
    const max = line.line_status === 'added' ? 999 : line.requested_qty;
    if (!Number.isInteger(it.approved_qty) || it.approved_qty < 0 || it.approved_qty > max) {
      throw bad('approved_qty_out_of_range', { itemId: it.id, max });
    }
    const hasSub = subFor.has(line.id) || lines.some((l) => l.substitute_for_item_id === line.id && (l.approved_qty ?? 0) > 0);
    const status = line.line_status === 'added' ? 'added' : hasSub && it.approved_qty < line.requested_qty ? 'substituted' : lineStatusFor(line.requested_qty, it.approved_qty);
    const price = it.unit_price !== undefined && it.unit_price !== null ? it.unit_price : line.unit_price_snapshot;
    await tx`update order_items set approved_qty = ${it.approved_qty}, line_status = ${status},
      customer_note = ${it.customer_note ?? line.customer_note ?? null}, unit_price_snapshot = ${price},
      reviewed_by = ${adminId}, reviewed_at = now() where id = ${line.id}`;
    if (line.approved_qty !== it.approved_qty || price !== line.unit_price_snapshot) {
      changes.push({ item: line.id, sku: line.sku_snapshot, requested: line.requested_qty, from: line.approved_qty, to: it.approved_qty,
        price_from: line.unit_price_snapshot, price_to: price });
    }
  }

  let nextLine = Math.max(0, ...lines.map((l) => l.line_no)) + 1;
  for (const s of input.substitutes ?? []) {
    const orig = byId.get(s.for_item_id);
    if (!orig || orig.line_status === 'added') throw bad('unknown_item', { itemId: s.for_item_id });
    if (!Number.isInteger(s.qty) || s.qty < 1 || s.qty > 999) throw bad('approved_qty_out_of_range');
    const [p] = await tx<any[]>`select * from products where id = ${s.product_id} and archived_at is null`;
    if (!p) throw bad('unknown_product');
    await tx`insert into order_items (order_id, line_no, product_id, sku_snapshot, name_en_snapshot, name_ur_snapshot,
        unit_label_en_snapshot, unit_label_ur_snapshot, unit_price_snapshot, requested_qty, approved_qty, line_status,
        substitute_for_item_id, customer_note, reviewed_by, reviewed_at)
      values (${orderId}, ${nextLine++}, ${p.id}, ${p.sku}, ${p.name_en}, ${p.name_ur}, ${p.unit_label_en}, ${p.unit_label_ur},
        ${p.price}, 0, ${s.qty}, 'added', ${orig.id}, ${s.customer_note ?? null}, ${adminId}, now())`;
    await tx`update order_items set line_status = case when coalesce(approved_qty, 0) < requested_qty then 'substituted' else line_status end
      where id = ${orig.id}`;
    changes.push({ substitute_for: orig.id, product: p.sku, qty: s.qty });
  }

  await recomputeTotals(tx, orderId);
  if (order.status === 'submitted') {
    await tx`update orders set status = 'checking' where id = ${orderId}`;
    await tx`insert into order_status_history (order_id, from_status, to_status, changed_by) values (${orderId}, 'submitted', 'checking', ${adminId})`;
  }
  if (changes.length) await audit(tx, adminId, 'order_review', 'order', orderId, { changes });
  return { changed: changes.length };
}

async function notifyShop(tx: Tx, order: any, kind: string, data: Record<string, unknown>) {
  const [u] = await tx<any[]>`select owner_user_id from shops where id = ${order.shop_id}`;
  if (!u) return;
  await tx`insert into notifications (user_id, kind, data, link) values (${u.owner_user_id}, ${kind}, ${tx.json(data as any)}, ${'/orders/' + order.id})`;
}

export async function changeStatus(tx: Tx, adminId: string, orderId: string, to: OrderStatus, note: string | null) {
  const order = await lockOrder(tx, orderId);
  const from = order.status as OrderStatus;
  if (from === to) return { status: to, unchanged: true };
  if (!canTransition(from, to)) throw new ApiError(409, 'invalid_transition', 'invalid_transition', { from, to });

  const lines = await tx<any[]>`select * from order_items where order_id = ${orderId} order by line_no`;
  const needsReview = ['needs_confirmation', 'confirmed'].includes(to) || (LOCKED_STATUSES.includes(to) && !order.stock_deducted_at);
  if (needsReview && lines.some((l) => l.approved_qty === null)) throw conflict('review_required');

  // Deduct stock when the order first becomes confirmed.
  if (LOCKED_STATUSES.includes(to) && !order.stock_deducted_at) {
    const approved = lines.filter((l) => (l.approved_qty ?? 0) > 0);
    if (!approved.length) throw conflict('nothing_approved');
    const perProduct = new Map<string, number>();
    for (const l of approved) {
      if (!l.product_id) throw conflict('product_missing');
      perProduct.set(l.product_id, (perProduct.get(l.product_id) ?? 0) + l.approved_qty);
    }
    const ids = [...perProduct.keys()];
    const prods = await tx<any[]>`select id, sku, name_en, stock_qty from products where id = any(${ids}::uuid[]) order by id for update`;
    const short = prods.filter((p) => p.stock_qty < (perProduct.get(p.id) ?? 0))
      .map((p) => ({ sku: p.sku, name: p.name_en, stock: p.stock_qty, needed: perProduct.get(p.id) }));
    if (short.length) throw new ApiError(409, 'insufficient_stock', 'insufficient_stock', { products: short });
    for (const p of prods) {
      const qty = perProduct.get(p.id)!;
      const [{ stock_qty }] = await tx<any[]>`update products set stock_qty = stock_qty - ${qty} where id = ${p.id} returning stock_qty`;
      await tx`insert into inventory_movements (product_id, change, stock_after, reason, note, order_id, actor_id)
        values (${p.id}, ${-qty}, ${stock_qty}, 'order_deduction', ${order.ref}, ${orderId}, ${adminId})`;
    }
    await tx`update orders set stock_deducted_at = now(), confirmed_at = coalesce(confirmed_at, now()) where id = ${orderId}`;
  }

  if (to === 'cancelled') {
    if (order.stock_deducted_at) {
      const moves = await tx<any[]>`select product_id, sum(change) as change from inventory_movements
        where order_id = ${orderId} group by product_id having sum(change) <> 0`;
      for (const m of moves) {
        const [{ stock_qty }] = await tx<any[]>`update products set stock_qty = stock_qty - ${m.change} where id = ${m.product_id} returning stock_qty`;
        await tx`insert into inventory_movements (product_id, change, stock_after, reason, note, order_id, actor_id)
          values (${m.product_id}, ${-m.change}, ${stock_qty}, 'order_cancel_restore', ${order.ref}, ${orderId}, ${adminId})`;
      }
      await tx`update orders set stock_deducted_at = null where id = ${orderId}`;
    }
    const [inv] = await tx<any[]>`select * from invoices where order_id = ${orderId} and status = 'issued'`;
    if (inv) {
      await tx`update invoices set status = 'void', voided_at = now() where id = ${inv.id}`;
    }
    if (inv && Number(inv.total) > 0) {
      await tx`insert into ledger_entries (shop_id, entry_date, kind, credit, invoice_id, reference, note, created_by)
        values (${order.shop_id}, current_date, 'invoice_void', ${inv.total}, ${inv.id}, ${inv.invoice_no}, 'Order cancelled', ${adminId})`;
    }
    await tx`update orders set cancelled_at = now() where id = ${orderId}`;
  }
  if (to === 'delivered') await tx`update orders set delivered_at = now() where id = ${orderId}`;

  await tx`update orders set status = ${to} where id = ${orderId}`;
  await tx`insert into order_status_history (order_id, from_status, to_status, note, changed_by)
    values (${orderId}, ${from}, ${to}, ${note}, ${adminId})`;
  await notifyShop(tx, order, 'order_status', { ref: order.ref, status: to, note });
  await audit(tx, adminId, 'order_status', 'order', orderId, { from, to });
  return { status: to };
}

export async function shopBalance(tx: Tx, shopId: string): Promise<number> {
  const [r] = await tx<any[]>`select coalesce(sum(debit) - sum(credit), 0) as balance from ledger_entries where shop_id = ${shopId}`;
  return Number(r?.balance ?? 0);
}

export async function generateInvoice(tx: Tx, adminId: string, orderId: string) {
  const order = await lockOrder(tx, orderId);
  if (!LOCKED_STATUSES.includes(order.status)) throw conflict('order_not_confirmed');
  const [existing] = await tx<any[]>`select * from invoices where order_id = ${orderId}`;
  if (existing) {
    if (existing.status === 'issued') return { invoice: existing, created: false };
    throw conflict('invoice_void');
  }
  const lines = await tx<any[]>`select * from order_items where order_id = ${orderId} and coalesce(approved_qty, 0) > 0 order by line_no`;
  if (!lines.length) throw conflict('nothing_approved');
  const missing = lines.filter((l) => l.unit_price_snapshot === null);
  if (missing.length) throw new ApiError(409, 'missing_prices', 'missing_prices', { skus: missing.map((l) => l.sku_snapshot) });

  const [settings] = await tx<any[]>`select * from app_settings where id = 1`;
  const [shop] = await tx<any[]>`select s.name, s.address, s.location_note, u.full_name, u.phone
    from shops s join app_users u on u.id = s.owner_user_id where s.id = ${order.shop_id}`;
  const [{ seq }] = await tx<any[]>`select nextval('invoice_no_seq') as seq`;
  const [{ today }] = await tx<any[]>`select (now() at time zone ${settings.timezone})::date as today`;
  const invoiceNo = `INV-${String(today).slice(2, 4)}${String(today).slice(5, 7)}-${String(seq).padStart(5, '0')}`;

  const items = lines.map((l, i) => {
    const lineTotal = Math.round(l.approved_qty * Number(l.unit_price_snapshot) * 100) / 100;
    return { line_no: i + 1, sku: l.sku_snapshot, name_en: l.name_en_snapshot, name_ur: l.name_ur_snapshot,
      unit_label: l.unit_label_en_snapshot, qty: l.approved_qty, unit_price: Number(l.unit_price_snapshot), line_total: lineTotal };
  });
  const total = Math.round(items.reduce((s, i) => s + i.line_total, 0) * 100) / 100;
  const before = await shopBalance(tx, order.shop_id);
  const business = {
    name: settings.business_name, name_ur: settings.business_name_ur, phone: settings.business_phone,
    whatsapp: settings.business_whatsapp, address: settings.business_address, email: settings.business_email,
    footer: settings.invoice_footer,
  };
  const [inv] = await tx<any[]>`insert into invoices (invoice_no, order_id, shop_id, issue_date, currency, business_snapshot,
      shop_snapshot, order_ref, subtotal, total, balance_before, balance_after, created_by)
    values (${invoiceNo}, ${orderId}, ${order.shop_id}, ${today}, ${settings.currency}, ${tx.json(business as any)},
      ${tx.json(shop as any)}, ${order.ref}, ${total}, ${total}, ${before}, ${before + total}, ${adminId})
    returning *`;
  for (const it of items) {
    await tx`insert into invoice_items (invoice_id, line_no, sku, name_en, name_ur, unit_label, qty, unit_price, line_total)
      values (${inv.id}, ${it.line_no}, ${it.sku}, ${it.name_en}, ${it.name_ur}, ${it.unit_label}, ${it.qty}, ${it.unit_price}, ${it.line_total})`;
  }
  if (total > 0) {
    await tx`insert into ledger_entries (shop_id, entry_date, kind, debit, invoice_id, reference, created_by)
      values (${order.shop_id}, ${today}, 'invoice', ${total}, ${inv.id}, ${invoiceNo}, ${adminId})`;
  }
  await notifyShop(tx, order, 'invoice', { ref: order.ref, invoice_no: invoiceNo, invoice_id: inv.id, total });
  await audit(tx, adminId, 'invoice_create', 'invoice', inv.id, { order: order.ref, total });
  return { invoice: inv, created: true };
}
