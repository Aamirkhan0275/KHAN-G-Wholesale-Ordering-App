import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { Sql } from './db.js';

export const SESSION_COOKIE = 'kg_session';
export const SESSION_DAYS = 30;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export interface SessionUser {
  id: string;
  role: 'admin' | 'shopkeeper';
  full_name: string;
  phone: string;
  status: 'pending' | 'active' | 'inactive';
  language: 'en' | 'ur';
  theme: 'system' | 'light' | 'dark';
  reminders_opt_out: boolean;
  must_change_password: boolean;
  shop_id: string | null;
  shop_name: string | null;
}

const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 10);

export function hashPassword(pw: string) { return bcrypt.hash(pw, 10); }
export function verifyPassword(pw: string, hash: string) { return bcrypt.compare(pw, hash); }
export function dummyVerify(pw: string) { return bcrypt.compare(pw, DUMMY_HASH); }

/** Passwords: 6-64 chars. A 6+ digit PIN is allowed so it is easy to type on a phone. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'password_required';
  if (pw.length < 6) return 'password_too_short';
  if (pw.length > 64) return 'password_too_long';
  if (/^(\d)\1+$/.test(pw) || ['123456', '1234567', '12345678', '654321', 'password', '111111'].includes(pw.toLowerCase())) return 'password_too_simple';
  return null;
}

export async function signSession(secret: string, userId: string, version: number): Promise<string> {
  return new SignJWT({ v: version })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(new TextEncoder().encode(secret));
}

export async function readSession(secret: string, token: string): Promise<{ sub: string; v: number } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.v !== 'number') return null;
    return { sub: payload.sub, v: payload.v };
  } catch {
    return null;
  }
}

/** Loaded with the trusted system connection; also re-checks status on every request. */
export async function loadSessionUser(sql: Sql, userId: string, version: number): Promise<SessionUser | null> {
  const rows = await sql<(SessionUser & { session_version: number })[]>`
    select u.id, u.role, u.full_name, u.phone, u.status, u.language, u.theme, u.reminders_opt_out,
           c.must_change_password, c.session_version, s.id as shop_id, s.name as shop_name
    from app_users u
    join auth_credentials c on c.user_id = u.id
    left join shops s on s.owner_user_id = u.id
    where u.id = ${userId}`;
  const u = rows[0];
  if (!u || u.session_version !== version || u.status !== 'active') return null;
  if (u.role === 'shopkeeper' && !u.shop_id) return null;
  const { session_version: _v, ...rest } = u;
  return rest;
}
