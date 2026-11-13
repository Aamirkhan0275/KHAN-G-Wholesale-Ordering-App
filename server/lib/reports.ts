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

export type Period = 'day' | 'week' | 'month' | 'year';
export const PERIOD_MAX_DAYS: Record<Period, number> = { day: 366, week: 3 * 366, month: 10 * 366, year: 10 * 366 };

/**
 * Sales grouped by day / ISO week (Mon-Sun) / month / year, in the business timezone.
 * Same rules as the other reports: cancelled orders excluded, money only from issued
 * invoices (by invoice date) and recorded payments (by payment date).
 */
export async function salesByPeriod(tx: Tx, r: Range, period: Period) {
  const unit = period;
  const step = `1 ${period}`;
  const rows = await tx<any[]>`
    with b as (
      select g::date as start, (g + ${step}::interval)::date as next
      from generate_series(date_trunc(${unit}, ${r.from}::date::timestamp), date_trunc(${unit}, ${r.to}::date::timestamp), ${step}::interval) g
    ),
    o as (
      select date_trunc(${unit}, (submitted_at at time zone ${r.tz}))::date as start,
             count(*) filter (where status <> 'cancelled') as orders,
             count(*) filter (where status = 'cancelled') as cancelled,
             coalesce(sum(total_requested_qty) filter (where status <> 'cancelled'), 0) as requested_units,
             coalesce(sum(total_approved_qty) filter (where status in ('confirmed','ready','delivered')), 0) as confirmed_units,
             count(distinct shop_id) filter (where status <> 'cancelled') as shops
      from orders
      where submitted_at >= ((${r.from}::date)::timestamp at time zone ${r.tz}) and submitted_at < (((${r.to}::date) + 1)::timestamp at time zone ${r.tz})
      group by 1
    ),
    i as (
      select date_trunc(${unit}, issue_date::timestamp)::date as start, count(*) as invoices, coalesce(sum(total), 0) as invoiced_total
      from invoices where status = 'issued' and issue_date between ${r.from}::date and ${r.to}::date group by 1
    ),
    p as (
      select date_trunc(${unit}, entry_date::timestamp)::date as start, coalesce(sum(credit), 0) as payments_total
      from ledger_entries where kind = 'payment' and entry_date between ${r.from}::date and ${r.to}::date group by 1
    )
    select to_char(b.start, 'YYYY-MM-DD') as period_start,
           to_char(greatest(least(b.next - 1, ${r.to}::date), b.start), 'YYYY-MM-DD') as period_end,
           case ${period}::text when 'day' then to_char(b.start, 'YYYY-MM-DD') when 'week' then to_char(b.start, 'IYYY-"W"IW')
                when 'month' then to_char(b.start, 'YYYY-MM') else to_char(b.start, 'YYYY') end as period,
           coalesce(o.orders, 0) as orders, coalesce(o.cancelled, 0) as cancelled, coalesce(o.shops, 0) as shops,
           coalesce(o.requested_units, 0) as requested_units, coalesce(o.confirmed_units, 0) as confirmed_units,
           coalesce(i.invoices, 0) as invoices, coalesce(i.invoiced_total, 0) as invoiced_total,
           coalesce(p.payments_total, 0) as payments_total
    from b left join o on o.start = b.start left join i on i.start = b.start left join p on p.start = b.start
    order by b.start`;
  const sum = (k: string) => rows.reduce((s, x) => s + Number(x[k] ?? 0), 0);
  const totals = {
    orders: sum('orders'), cancelled: sum('cancelled'), requested_units: sum('requested_units'), confirmed_units: sum('confirmed_units'),
    invoices: sum('invoices'), invoiced_total: Math.round(sum('invoiced_total') * 100) / 100, payments_total: Math.round(sum('payments_total') * 100) / 100,
  };
  return { rows, totals };
}

/**
 * The range to compare with. Whole calendar months/years shift by the same number of
 * months/years (e.g. April -> March, 2026 -> 2025); anything else uses the same number
 * of days immediately before.
 */
export function previousRange(from: string, to: string, period: Period): { prevFrom: string; prevTo: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const lastOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() === d.getUTCDate();
  const prevTo = iso(new Date(f.getTime() - 86400000));
  if ((period === 'month' || period === 'year') && f.getUTCDate() === 1 && lastOfMonth(t)) {
    const months = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + (t.getUTCMonth() - f.getUTCMonth()) + 1;
    const shift = period === 'year' && f.getUTCMonth() === 0 && t.getUTCMonth() === 11 ? Math.ceil(months / 12) * 12 : months;
    return { prevFrom: iso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - shift, 1))), prevTo };
  }
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
  return { prevFrom: iso(new Date(f.getTime() - days * 86400000)), prevTo };
}
