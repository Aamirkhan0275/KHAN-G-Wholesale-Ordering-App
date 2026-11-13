import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestApp, CRON_SECRET, type TestCtx, type Client } from './helpers';
import { runReminders } from '../../server/lib/reminders';

/**
 * Business timezone Asia/Karachi (UTC+5). Reminder time 10:00 local.
 * Dates used: Mon 2026-11-09 (W46) and Mon 2026-11-16 (W47).
 */
let ctx: TestCtx;
let admin: Client;
const at = (iso: string) => new Date(iso);
const MON_W46_0900_PKT = '2026-11-09T04:00:00Z';
const MON_W47_0905_PKT = '2026-11-16T04:05:00Z';   // before 10:00 local
const MON_W47_1005_PKT = '2026-11-16T05:05:00Z';   // after 10:00 local
const TUE_W47_1100_PKT = '2026-11-17T06:00:00Z';

async function orderAt(phone: string, when: string) {
  const c = await ctx.login(phone);
  const o = await ctx.placeOrder(c, [{ product_id: ctx.products.p1, qty: 1 }]);
  await ctx.sql`update orders set submitted_at = ${when} where id = ${o.id}`;
  return o;
}
const logFor = (shopId: string) => ctx.sql`select cycle_key, weekday, status, notification_id from reminder_log where shop_id = ${shopId} order by created_at`;

beforeAll(async () => {
  ctx = await setupTestApp('reminders');
  admin = await ctx.login('03000000009');
});
beforeEach(async () => {
  await ctx.sql`delete from reminder_log`; await ctx.sql`delete from notifications`; await ctx.sql`delete from order_status_history`;
  await ctx.sql`delete from order_items`; await ctx.sql`delete from orders`;
  await ctx.sql`update shops set reminder_enabled = true, reminder_weekday = null`;
  await ctx.sql`update app_users set reminders_opt_out = false`;
  await ctx.sql`update app_settings set reminders_enabled = true, reminder_time = '10:00', reminder_rule = 'latest_order', reminder_default_weekday = null, timezone = 'Asia/Karachi'`;
});
afterAll(async () => { await ctx.close(); });

describe('weekly reorder reminders', () => {
  it('sends one in-app reminder on the weekday of the last order, after the configured time', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    expect((await runReminders(ctx.sql, at(MON_W47_0905_PKT))).sent).toBe(0);            // too early
    const r = await runReminders(ctx.sql, at(MON_W47_1005_PKT));
    expect(r).toMatchObject({ sent: 1, cycle: '2026-W47', local_weekday: 1 });
    const log = await logFor(ctx.shopA.shopId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ cycle_key: '2026-W47', weekday: 1, status: 'sent' });
    const shop = await ctx.login('03001000001');
    const n = (await shop.get('/api/notifications')).body.notifications.filter((x: any) => x.kind === 'reorder_reminder');
    expect(n).toHaveLength(1);
    expect(n[0].data).toMatchObject({ weekday: 1, last_order_weekday: 1, business_name: 'KHAN G', last_order_date: '2026-11-09' });
    expect(n[0].link).toBe('/?reorder=1');
    // the other shop (no orders) gets nothing
    const other = await ctx.login('03001000002');
    expect((await other.get('/api/notifications')).body.notifications).toEqual([]);
  });

  it('never sends a duplicate in the same week (repeat runs, concurrent runs)', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    await Promise.all([runReminders(ctx.sql, at(MON_W47_1005_PKT)), runReminders(ctx.sql, at(MON_W47_1005_PKT)), runReminders(ctx.sql, at(MON_W47_1005_PKT))]);
    await runReminders(ctx.sql, at('2026-11-16T12:00:00Z'));
    expect(await logFor(ctx.shopA.shopId)).toHaveLength(1);
    expect((await ctx.sql`select count(*)::int as n from notifications where kind = 'reorder_reminder'`)[0].n).toBe(1);
  });

  it('is not due on other weekdays', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    const r = await runReminders(ctx.sql, at(TUE_W47_1100_PKT));
    expect(r.sent).toBe(0);
    expect(await logFor(ctx.shopA.shopId)).toHaveLength(0);
  });

  it('skips (and logs) when the shop already ordered in the current week', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    await orderAt('03001000001', '2026-11-16T03:30:00Z'); // Mon W47 08:30 local, before the reminder
    // latest order is now Monday W47 -> due Monday; already ordered this cycle
    const r = await runReminders(ctx.sql, at(MON_W47_1005_PKT));
    expect(r.sent).toBe(0);
    expect(r.skipped.skipped_already_ordered).toBe(1);
    expect((await logFor(ctx.shopA.shopId))[0].status).toBe('skipped_already_ordered');
  });

  it('a cancelled order does not count as ordering this week', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    const o = await orderAt('03001000001', '2026-11-16T03:30:00Z');
    await ctx.sql`update orders set status = 'cancelled' where id = ${o.id}`;
    expect((await runReminders(ctx.sql, at(MON_W47_1005_PKT))).sent).toBe(1);
  });

  it('respects shopkeeper opt-out (set from the app)', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    const shop = await ctx.login('03001000001');
    await shop.patch('/api/me/preferences', { reminders_opt_out: true });
    const r = await runReminders(ctx.sql, at(MON_W47_1005_PKT));
    expect(r.sent).toBe(0);
    expect((await logFor(ctx.shopA.shopId))[0].status).toBe('skipped_opted_out');
  });

  it('respects the admin per-shop switch and weekday override', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    await admin.patch(`/api/admin/shops/${ctx.shopA.shopId}`, { reminder_enabled: false });
    expect((await runReminders(ctx.sql, at(MON_W47_1005_PKT))).skipped.skipped_disabled).toBe(1);
    await ctx.sql`delete from reminder_log`;
    await admin.patch(`/api/admin/shops/${ctx.shopA.shopId}`, { reminder_enabled: true, reminder_weekday: 2 }); // Tuesday
    expect((await runReminders(ctx.sql, at(MON_W47_1005_PKT))).sent).toBe(0);
    const r = await runReminders(ctx.sql, at(TUE_W47_1100_PKT));
    expect(r.sent).toBe(1);
    const [n] = await ctx.sql`select data from notifications where kind = 'reorder_reminder'`;
    expect(n.data).toMatchObject({ weekday: 2, last_order_weekday: 1 }); // "usual day" wording
  });

  it('admin can change the reminder time and the global rule', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    await admin.patch('/api/admin/settings', { reminder_time: '08:30' });
    expect((await runReminders(ctx.sql, at(MON_W47_0905_PKT))).sent).toBe(1); // 09:05 > 08:30
    await ctx.sql`delete from reminder_log`; await ctx.sql`delete from notifications`;
    await admin.patch('/api/admin/settings', { reminder_rule: 'fixed', reminder_default_weekday: 2 });
    expect((await runReminders(ctx.sql, at(MON_W47_1005_PKT))).sent).toBe(0);
    expect((await runReminders(ctx.sql, at(TUE_W47_1100_PKT))).sent).toBe(1); // shop B has never ordered: no reminder
  });

  it('global switch off sends nothing', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    await admin.patch('/api/admin/settings', { reminders_enabled: false });
    const r = await runReminders(ctx.sql, at(MON_W47_1005_PKT));
    expect(r).toMatchObject({ enabled: false, sent: 0 });
  });

  it('inactive shops get no reminders', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    await ctx.sql`update app_users set status = 'inactive' where id = ${ctx.shopA.userId}`;
    expect((await runReminders(ctx.sql, at(MON_W47_1005_PKT))).sent).toBe(0);
    await ctx.sql`update app_users set status = 'active' where id = ${ctx.shopA.userId}`;
  });

  it('“next app visit”: /auth/me evaluates the shop’s reminder', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    ctx.setNow(at(MON_W47_1005_PKT));
    const shop = await ctx.login('03001000001');
    await shop.get('/api/auth/me');
    ctx.setNow(null);
    expect((await shop.get('/api/notifications')).body.notifications.filter((n: any) => n.kind === 'reorder_reminder')).toHaveLength(1);
  });

  it('cron endpoint requires the secret; admin "run now" works and is audited', async () => {
    expect((await ctx.client().req('POST', '/api/cron/reminders', undefined, { csrf: false })).status).toBe(403);
    expect((await ctx.client().req('POST', '/api/cron/reminders', undefined, { csrf: false, headers: { authorization: 'Bearer nope' } })).status).toBe(403);
    const ok = await ctx.client().req('POST', '/api/cron/reminders', undefined, { csrf: false, headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('cycle');
    await orderAt('03001000001', MON_W46_0900_PKT);
    const r = await admin.post('/api/admin/reminders/run', { at: MON_W47_1005_PKT });
    expect(r.body.sent).toBe(1);
    const h = (await admin.get('/api/admin/reminders')).body;
    expect(h.log[0]).toMatchObject({ status: 'sent', cycle_key: '2026-W47', shop: 'Shop A' });
    expect(h.plan.find((p: any) => p.id === ctx.shopA.shopId).last_order_dow).toBe(1);
    expect((await ctx.sql`select count(*)::int as n from audit_log where action = 'reminders_run'`)[0].n).toBe(1);
  });

  it('a new week gives a new reminder', async () => {
    await orderAt('03001000001', MON_W46_0900_PKT);
    expect((await runReminders(ctx.sql, at(MON_W47_1005_PKT))).sent).toBe(1);
    expect((await runReminders(ctx.sql, at('2026-11-23T05:05:00Z'))).sent).toBe(1);
    expect((await logFor(ctx.shopA.shopId)).map((l: any) => l.cycle_key)).toEqual(['2026-W47', '2026-W48']);
  });
});
