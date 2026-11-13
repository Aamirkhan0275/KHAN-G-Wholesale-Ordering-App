import type { Tx } from './db.js';

/**
 * Report definitions (all dates inclusive, in the business timezone):
 *  - Orders: non-cancelled orders by submitted date. Cancelled orders are
 *    counted separately and never included in quantities or values.
 *  - Sales value: totals of ISSUED (not void) invoices by invoice date. Orders
 *    without an invoice have no confirmed money value, so none is invented.
 *  - Product quantities: approved quantities on confirmed/ready/delivered orders.
 *  - Payments: ledger payment entries by entry date.
 */
export interface Range { from: string; to: string; tz: string }

const startTs = (tx: Tx, r: Range) => tx`((${r.from}::date)::timestamp at time zone ${r.tz})`;
const endTs = (tx: Tx, r: Range) => tx`(((${r.to}::date) + 1)::timestamp at time zone ${r.tz})`;

export async function summary(tx: Tx, r: Range) {
  const [o] = await tx<any[]>`
    select count(*) filter (where status <> 'cancelled') as orders,
           count(*) filter (where status = 'cancelled') as cancelled,
           count(*) filter (where status in ('submitted','checking','needs_confirmation')) as open_orders,
           coalesce(sum(total_requested_qty) filter (where status <> 'cancelled'), 0) as requested_units,
           coalesce(sum(total_approved_qty) filter (where status in ('confirmed','ready','delivered')), 0) as approved_units,
           count(distinct shop_id) filter (where status <> 'cancelled') as ordering_shops
    from orders where submitted_at >= ${startTs(tx, r)} and submitted_at < ${endTs(tx, r)}`;
  const [i] = await tx<any[]>`
    select count(*) as invoices, coalesce(sum(total), 0) as invoiced_total
    from invoices where status = 'issued' and issue_date between ${r.from}::date and ${r.to}::date`;
  const [p] = await tx<any[]>`
    select count(*) as payments, coalesce(sum(credit), 0) as payments_total
    from ledger_entries where kind = 'payment' and entry_date between ${r.from}::date and ${r.to}::date`;
  const [b] = await tx<any[]>`
    select coalesce(sum(balance) filter (where balance > 0), 0) as outstanding_total,
           count(*) filter (where balance > 0) as shops_owing
    from shop_balances`;
  return { ...o, ...i, ...p, ...b };
}

export async function salesByDay(tx: Tx, r: Range) {
  return tx<any[]>`
    with days as (select d::date as day from generate_series(${r.from}::date, ${r.to}::date, interval '1 day') d)
    select to_char(days.day, 'YYYY-MM-DD') as day,
      (select count(*) from orders o where o.status <> 'cancelled'
         and (o.submitted_at at time zone ${r.tz})::date = days.day) as orders,
      (select coalesce(sum(o.total_requested_qty), 0) from orders o where o.status <> 'cancelled'
         and (o.submitted_at at time zone ${r.tz})::date = days.day) as requested_units,
      (select coalesce(sum(i.total), 0) from invoices i where i.status = 'issued' and i.issue_date = days.day) as invoiced_total,
      (select coalesce(sum(l.credit), 0) from ledger_entries l where l.kind = 'payment' and l.entry_date = days.day) as payments_total
    from days order by days.day`;
}

export async function salesByShop(tx: Tx, r: Range) {
  return tx<any[]>`
    select s.id as shop_id, s.name as shop, u.phone,
      (select count(*) from orders o where o.shop_id = s.id and o.status <> 'cancelled'
         and o.submitted_at >= ${startTs(tx, r)} and o.submitted_at < ${endTs(tx, r)}) as orders,
      (select coalesce(sum(o.total_approved_qty), 0) from orders o where o.shop_id = s.id and o.status in ('confirmed','ready','delivered')
         and o.submitted_at >= ${startTs(tx, r)} and o.submitted_at < ${endTs(tx, r)}) as approved_units,
      (select coalesce(sum(i.total), 0) from invoices i where i.shop_id = s.id and i.status = 'issued'
         and i.issue_date between ${r.from}::date and ${r.to}::date) as invoiced_total,
      (select coalesce(sum(l.credit), 0) from ledger_entries l where l.shop_id = s.id and l.kind = 'payment'
         and l.entry_date between ${r.from}::date and ${r.to}::date) as payments_total,
      coalesce((select balance from shop_balances b where b.shop_id = s.id), 0) as balance
    from shops s join app_users u on u.id = s.owner_user_id
    order by invoiced_total desc, orders desc, s.name`;
}

export async function productQuantities(tx: Tx, r: Range) {
  return tx<any[]>`
    select coalesce(p.sku, oi.sku_snapshot) as sku, coalesce(p.name_en, oi.name_en_snapshot) as product,
      count(distinct o.id) as orders,
      coalesce(sum(oi.requested_qty), 0) as requested_qty,
      coalesce(sum(oi.approved_qty) filter (where o.status in ('confirmed','ready','delivered')), 0) as approved_qty
    from order_items oi join orders o on o.id = oi.order_id
    left join products p on p.id = oi.product_id
    where o.status <> 'cancelled' and o.submitted_at >= ${startTs(tx, r)} and o.submitted_at < ${endTs(tx, r)}
    group by 1, 2 order by approved_qty desc, requested_qty desc, product limit 500`;
}

export async function balances(tx: Tx) {
  return tx<any[]>`
    select s.id as shop_id, s.name as shop, u.full_name as owner, u.phone, u.status,
      coalesce(b.balance, 0) as balance, coalesce(b.total_debit, 0) as total_invoiced, coalesce(b.total_credit, 0) as total_credited,
      (select max(entry_date) from ledger_entries l where l.shop_id = s.id and l.kind = 'payment') as last_payment_date,
      (select max(submitted_at) from orders o where o.shop_id = s.id and o.status <> 'cancelled') as last_order_at
    from shops s join app_users u on u.id = s.owner_user_id
    left join shop_balances b on b.shop_id = s.id
    order by balance desc, s.name`;
}

export async function lowStock(tx: Tx) {
  return tx<any[]>`
    select p.id, p.sku, p.name_en as product, p.name_ur, c.name_en as category, p.stock_qty, p.low_stock_threshold, p.is_active
    from products p left join categories c on c.id = p.category_id
    where p.archived_at is null and p.stock_qty <= p.low_stock_threshold
    order by p.stock_qty, p.name_en`;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection guard
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
}
