import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppEnv, Deps } from './context.js';
import { UUID_RE } from './context.js';
import { ApiError, fromPgError, forbidden, notFound } from './lib/errors.js';
import { alert, log } from './lib/log.js';
import {
  SESSION_COOKIE, SESSION_DAYS, MAX_FAILED_LOGINS, LOCK_MINUTES,
  dummyVerify, hashPassword, loadSessionUser, passwordProblem, readSession, signSession, verifyPassword,
} from './lib/auth.js';
import { normalizePhone } from '../shared/phone.js';
import { asUser } from './lib/db.js';
import { parse, uuidParam } from './lib/validate.js';
import { shopRoutes } from './routes/shop.js';
import { adminRoutes } from './routes/admin.js';
import { commonRoutes } from './routes/common.js';
import { runReminders } from './lib/reminders.js';

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  const { sql, env } = deps;

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
    if (c.req.path.startsWith('/api/') && !c.res.headers.get('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  app.onError((err, c) => {
    const api = err instanceof ApiError ? err : fromPgError(err);
    if (api) {
      if (api.status >= 500) log('error', 'api_error', { path: c.req.path, code: api.code });
      return c.json({ error: api.code, details: api.details ?? null }, api.status as any);
    }
    const id = Math.random().toString(36).slice(2, 10);
    log('error', 'unhandled_error', { id, path: c.req.path, method: c.req.method, error: String((err as any)?.stack ?? err) });
    void alert(`500:${c.req.method}:${c.req.routePath ?? c.req.path}`,
      `KHAN G API error ${id} on ${c.req.method} ${c.req.path}: ${String((err as any)?.message ?? err).slice(0, 300)}`);
    return c.json({ error: 'server_error', details: { id } }, 500);
  });

  // CSRF protection: state-changing API calls must carry a custom header that a
  // cross-site form or image cannot send. (Cookies are also SameSite=Lax.)
  app.use('/api/*', async (c, next) => {
    const m = c.req.method;
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && !c.req.path.startsWith('/api/cron/')) {
      if (c.req.header('x-kg-csrf') !== '1') return c.json({ error: 'csrf_header_missing' }, 403);
      // In production, also require the browser's Origin to be our own site when it is sent.
      const origin = c.req.header('origin');
      if (env.appOrigin && origin && origin !== env.appOrigin) return c.json({ error: 'bad_origin' }, 403);
    }
    await next();
  });

  app.get('/api/health', async (c) => {
    await sql`select 1`;
    return c.json({ ok: true, time: new Date().toISOString() });
  });

  app.get('/api/public/settings', async (c) => {
    const [s] = await sql`select business_name, business_name_ur from app_settings where id = 1`;
    return c.json({ business_name: s?.business_name ?? 'KHAN G', business_name_ur: s?.business_name_ur ?? null });
  });

  // ---------------------------------------------------------------- auth
  const cookieOpts = () => ({
    httpOnly: true, secure: env.cookieSecure, sameSite: 'Lax' as const, path: '/', maxAge: SESSION_DAYS * 86400,
  });

  app.post('/api/auth/login', async (c) => {
    const body = parse(z.object({ phone: z.string().max(40), password: z.string().max(100) }), await c.req.json().catch(() => ({})));
    const phone = normalizePhone(body.phone);
    if (!phone.ok) return c.json({ error: 'invalid_phone' }, 400);
    const [row] = await sql<any[]>`
      select u.id, u.status, u.role, c.password_hash, c.failed_attempts, c.locked_until, c.session_version
      from app_users u join auth_credentials c on c.user_id = u.id where u.phone = ${phone.e164}`;
    if (!row) {
      await dummyVerify(body.password);
      log('info', 'login_failed', { reason: 'unknown_phone' });
      return c.json({ error: 'wrong_credentials' }, 401);
    }
    if (row.locked_until && new Date(row.locked_until) > new Date()) {
      return c.json({ error: 'locked', details: { until: row.locked_until } }, 429);
    }
    const ok = await verifyPassword(body.password, row.password_hash);
    if (!ok) {
      const attempts = row.failed_attempts + 1;
      const lock = attempts >= MAX_FAILED_LOGINS;
      await sql`update auth_credentials set failed_attempts = ${lock ? 0 : attempts},
        locked_until = ${lock ? sql`now() + ${LOCK_MINUTES + ' minutes'}::interval` : null} where user_id = ${row.id}`;
      log('info', 'login_failed', { reason: 'bad_password', user: row.id, locked: lock });
      return c.json({ error: lock ? 'locked' : 'wrong_credentials' }, lock ? 429 : 401);
    }
    await sql`update auth_credentials set failed_attempts = 0, locked_until = null where user_id = ${row.id}`;
    if (row.status === 'pending') return c.json({ error: 'pending_approval' }, 403);
    if (row.status !== 'active') return c.json({ error: 'account_inactive' }, 403);
    const user = await loadSessionUser(sql, row.id, row.session_version);
    if (!user) return c.json({ error: 'account_inactive' }, 403);
    await sql`update app_users set last_login_at = now() where id = ${row.id}`;
    setCookie(c, SESSION_COOKIE, await signSession(env.sessionSecret, row.id, row.session_version), cookieOpts());
    log('info', 'login_ok', { user: row.id, role: row.role });
    return c.json({ user });
  });

  app.post('/api/auth/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // Session middleware for everything else under /api (except public + cron).
  app.use('/api/*', async (c, next) => {
    const p = c.req.path;
    if (p === '/api/health' || p.startsWith('/api/public/') || p === '/api/auth/login' || p === '/api/auth/logout' || p.startsWith('/api/cron/')) {
      return next();
    }
    const token = getCookie(c, SESSION_COOKIE);
    const sess = token ? await readSession(env.sessionSecret, token) : null;
    const user = sess && UUID_RE.test(sess.sub) ? await loadSessionUser(sql, sess.sub, sess.v) : null;
    if (!user) {
      if (token) deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.json({ error: 'not_signed_in' }, 401);
    }
    c.set('user', user);
    // Until a temporary password is changed, only allow what is needed to change it.
    if (user.must_change_password && !['/api/auth/me', '/api/auth/change-password', '/api/me/preferences'].includes(p)) {
      return c.json({ error: 'must_change_password' }, 403);
    }
    await next();
  });

  app.get('/api/auth/me', async (c) => {
    const user = c.get('user');
    if (user.role === 'shopkeeper' && user.shop_id && !user.must_change_password) {
      // "Reminder on next app visit": evaluate this shop's weekly reminder now.
      try { await runReminders(sql, deps.now?.() ?? new Date(), { shopId: user.shop_id }); }
      catch (e) { log('error', 'reminder_on_visit_failed', { error: String(e) }); }
    }
    const [settings] = await asUser(sql, user.id, (tx) => tx`
      select business_name, business_name_ur, business_whatsapp, currency, show_prices, timezone from app_settings where id = 1`);
    return c.json({ user, settings: settings ?? null });
  });

  app.post('/api/auth/change-password', async (c) => {
    const user = c.get('user');
    const body = parse(z.object({ current: z.string().max(100), next: z.string().max(100) }), await c.req.json().catch(() => ({})));
    const [cred] = await sql<any[]>`select password_hash, session_version from auth_credentials where user_id = ${user.id}`;
    if (!cred || !(await verifyPassword(body.current, cred.password_hash))) return c.json({ error: 'wrong_current_password' }, 400);
    const problem = passwordProblem(body.next);
    if (problem) return c.json({ error: problem }, 400);
    if (body.next === body.current) return c.json({ error: 'password_unchanged' }, 400);
    const version = cred.session_version + 1;
    await sql`update auth_credentials set password_hash = ${await hashPassword(body.next)}, must_change_password = false,
      password_changed_at = now(), session_version = ${version} where user_id = ${user.id}`;
    setCookie(c, SESSION_COOKIE, await signSession(env.sessionSecret, user.id, version), cookieOpts());
    log('info', 'password_changed', { user: user.id });
    return c.json({ ok: true });
  });

  app.patch('/api/me/preferences', async (c) => {
    const user = c.get('user');
    const body = parse(z.object({
      language: z.enum(['en', 'ur']).optional(),
      theme: z.enum(['system', 'light', 'dark']).optional(),
      reminders_opt_out: z.boolean().optional(),
    }).strict(), await c.req.json().catch(() => ({})));
    const patch: Record<string, unknown> = {};
    for (const k of ['language', 'theme', 'reminders_opt_out'] as const) if (body[k] !== undefined) patch[k] = body[k];
    if (!Object.keys(patch).length) return c.json({ ok: true });
    const [row] = await asUser(sql, user.id, (tx) => tx`
      update app_users set ${tx(patch)} where id = ${user.id} returning language, theme, reminders_opt_out`);
    return c.json({ preferences: row });
  });

  // ------------------------------------------------------------- images
  app.get('/api/images/:id', async (c) => {
    const id = uuidParam(c.req.param('id'));
    const user = c.get('user');
    const [img] = await asUser(sql, user.id, (tx) => tx<{ content_type: string; data: Buffer }[]>`
      select content_type, data from product_images where id = ${id}`);
    if (!img) throw notFound();
    return new Response(new Uint8Array(img.data), {
      headers: {
        'Content-Type': img.content_type,
        'Cache-Control': 'private, max-age=604800, immutable',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  // ------------------------------------------------- scheduled reminders
  app.post('/api/cron/reminders', async (c) => {
    if (!env.cronSecret || c.req.header('authorization') !== `Bearer ${env.cronSecret}`) throw forbidden();
    const result = await runReminders(sql, deps.now?.() ?? new Date());
    return c.json(result);
  });

  app.route('/api', commonRoutes);
  app.route('/api/shop', shopRoutes);
  app.route('/api/admin', adminRoutes);

  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
  return app;
}
