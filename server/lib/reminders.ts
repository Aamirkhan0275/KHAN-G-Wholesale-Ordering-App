import type { Sql } from './db.js';
import { isoWeekKey, timeToMinutes, weekStartLocalDate, zonedParts } from '../../shared/zoned.js';
import { log } from './log.js';

/**
 * Smart Weekly Reorder Reminders (in-app).
 *
 * Rule per shop, evaluated in the business timezone (app_settings.timezone):
 *   weekday = shops.reminder_weekday (admin override)
 *          ?? (settings.reminder_rule = 'fixed' ? settings.reminder_default_weekday
 *                                               : weekday of the shop's latest non-cancelled order)
 *   A reminder is due on that weekday once local time >= settings.reminder_time.
 *   Cycle = ISO week (Mon-Sun) in the business timezone, e.g. 2026-W46.
 *   At most ONE reminder_log row per shop per cycle (unique constraint), so a
 *   shop can never get a duplicate reminder in the same week.
 *   Only shops with at least one previous non-cancelled order are considered.
 *   No reminder if: reminders disabled globally / for the shop (admin), the
 *   shopkeeper opted out, or the shop already placed a non-cancelled order in
 *   the current cycle (logged as skipped_already_ordered).
 *
 * This creates IN-APP notifications only. It never sends WhatsApp messages.
 */
export interface ReminderRunResult {
  ran_at: string;
  cycle: string;
  local_weekday: number;
  due_after: string;
  enabled: boolean;
  sent: number;
  skipped: Record<string, number>;
  not_due: number;
}

export async function runReminders(sql: Sql, now: Date = new Date(), opts: { shopId?: string } = {}): Promise<ReminderRunResult> {
  const [settings] = await sql<any[]>`select business_name, timezone, reminders_enabled, reminder_time::text as reminder_time,
    reminder_rule, reminder_default_weekday from app_settings where id = 1`;
  const tz = settings.timezone as string;
  const local = zonedParts(now, tz);
  const cycle = isoWeekKey(local.year, local.month, local.day);
  const result: ReminderRunResult = {
    ran_at: now.toISOString(), cycle, local_weekday: local.weekday, due_after: settings.reminder_time,
    enabled: settings.reminders_enabled, sent: 0, skipped: {}, not_due: 0,
  };
  if (!settings.reminders_enabled) return result;
  const dueNow = local.hour * 60 + local.minute >= timeToMinutes(settings.reminder_time);
  const weekStart = weekStartLocalDate(now, tz);
  const nowIso = now.toISOString();

  const shops = await sql<any[]>`
    select s.id, s.name, s.reminder_enabled, s.reminder_weekday, u.id as user_id, u.reminders_opt_out,
      lo.submitted_at as last_order_at,
      extract(dow from lo.submitted_at at time zone ${tz})::int as last_order_dow,
      to_char(lo.submitted_at at time zone ${tz}, 'YYYY-MM-DD') as last_order_date,
      exists (select 1 from orders o where o.shop_id = s.id and o.status <> 'cancelled'
              and o.submitted_at >= (${weekStart}::date)::timestamp at time zone ${tz}
              and o.submitted_at <= ${nowIso}::timestamptz) as ordered_this_cycle,
      exists (select 1 from reminder_log r where r.shop_id = s.id and r.cycle_key = ${cycle}) as already_logged
    from shops s
    join app_users u on u.id = s.owner_user_id and u.role = 'shopkeeper' and u.status = 'active'
    left join lateral (
      select submitted_at from orders o where o.shop_id = s.id and o.status <> 'cancelled'
        and o.submitted_at <= ${nowIso}::timestamptz
      order by submitted_at desc limit 1
    ) lo on true
    where ${opts.shopId ? sql`s.id = ${opts.shopId}` : sql`true`}`;

  for (const s of shops) {
    if (s.already_logged) continue;
    // Only shops with an eligible (non-cancelled) previous order get reminders, so the
    // message ("you ordered last …" / "your usual order day") is always true.
    if (!s.last_order_at) { result.not_due++; continue; }
    const weekday: number | null = s.reminder_weekday ?? (settings.reminder_rule === 'fixed' ? settings.reminder_default_weekday : s.last_order_dow);
    if (weekday === null || weekday === undefined || weekday !== local.weekday || !dueNow) { result.not_due++; continue; }

    let status: 'sent' | 'skipped_already_ordered' | 'skipped_opted_out' | 'skipped_disabled';
    if (!s.reminder_enabled) status = 'skipped_disabled';
    else if (s.reminders_opt_out) status = 'skipped_opted_out';
    else if (s.ordered_this_cycle) status = 'skipped_already_ordered';
    else status = 'sent';

    const data = {
      weekday, business_name: settings.business_name, last_order_date: s.last_order_date,
      last_order_weekday: s.last_order_dow, cycle,
    };
    const inserted = await sql.begin(async (tx) => {
      const [log] = await tx<any[]>`insert into reminder_log (shop_id, cycle_key, weekday, status, details)
        values (${s.id}, ${cycle}, ${weekday}, ${status}, ${tx.json(data as any)})
        on conflict (shop_id, cycle_key) do nothing returning id`;
      if (!log) return false;            // another run got there first
      if (status === 'sent') {
        const [n] = await tx<any[]>`insert into notifications (user_id, kind, data, link)
          values (${s.user_id}, 'reorder_reminder', ${tx.json(data as any)}, '/?reorder=1') returning id`;
        await tx`update reminder_log set notification_id = ${n.id} where id = ${log.id}`;
      }
      return true;
    });
    if (!inserted) continue;
    if (status === 'sent') result.sent++;
    else result.skipped[status] = (result.skipped[status] ?? 0) + 1;
  }
  if (result.sent || Object.keys(result.skipped).length) log('info', 'reminders_run', { ...result, shop: opts.shopId });
  return result;
}
