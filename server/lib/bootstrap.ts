import type { Sql } from './db.js';
import type { Env } from './env.js';
import { hashPassword, passwordProblem } from './auth.js';
import { normalizePhone } from '../../shared/phone.js';
import { log } from './log.js';

/**
 * First-run setup from environment variables (never hard-coded):
 *  - creates the owner/admin account from ADMIN_PHONE + ADMIN_PASSWORD if no admin exists
 *  - fills business name / WhatsApp number if they are still empty
 */
export async function bootstrap(sql: Sql, env: Env) {
  if (env.businessName) {
    await sql`update app_settings set business_name = ${env.businessName} where id = 1 and business_name = 'KHAN G' and ${env.businessName} <> 'KHAN G'`;
  }
  if (env.businessWhatsapp) {
    const p = normalizePhone(env.businessWhatsapp);
    if (p.ok) await sql`update app_settings set business_whatsapp = ${p.e164} where id = 1 and business_whatsapp is null`;
    else log('warning', 'bootstrap_invalid_business_whatsapp');
  }
  const [{ n }] = await sql<any[]>`select count(*) as n from app_users where role = 'admin'`;
  if (n > 0) return { adminCreated: false };
  if (!env.adminPhone || !env.adminPassword) {
    log('warning', 'no_admin_account', { hint: 'set ADMIN_PHONE and ADMIN_PASSWORD, then restart' });
    return { adminCreated: false };
  }
  const phone = normalizePhone(env.adminPhone);
  if (!phone.ok) throw new Error('ADMIN_PHONE is not a valid mobile number');
  const problem = passwordProblem(env.adminPassword);
  if (problem) throw new Error(`ADMIN_PASSWORD rejected: ${problem}`);
  const hash = await hashPassword(env.adminPassword);
  await sql.begin(async (tx) => {
    const [u] = await tx<any[]>`insert into app_users (role, full_name, phone, status, language)
      values ('admin', ${env.adminName}, ${phone.e164}, 'active', 'en') returning id`;
    await tx`insert into auth_credentials (user_id, password_hash) values (${u.id}, ${hash})`;
  });
  log('info', 'admin_created', { phone: phone.e164.slice(0, 6) + '…' });
  return { adminCreated: true };
}
