/** Environment configuration. Nothing secret or business-specific is hard-coded. */
export interface Env {
  databaseUrl: string;
  sessionSecret: string;
  port: number;
  production: boolean;
  cookieSecure: boolean;
  autoMigrate: boolean;
  seedDemo: boolean;
  adminPhone?: string;
  adminPassword?: string;
  adminName: string;
  businessName?: string;
  businessWhatsapp?: string;
  cronSecret?: string;
  reminderIntervalSeconds: number;
  notifyUrl?: string;
  notifyToken?: string;
  appOrigin?: string;
}

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v == null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function databaseUrlFrom(e: Record<string, string | undefined>): string | undefined {
  if (e.DATABASE_URL) return e.DATABASE_URL;
  if (e.POSTGRES_URL) return e.POSTGRES_URL;
  if (e.PGHOST) {
    const user = encodeURIComponent(e.PGUSER ?? 'postgres');
    const pass = e.PGPASSWORD ? ':' + encodeURIComponent(e.PGPASSWORD) : '';
    return `postgres://${user}${pass}@${e.PGHOST}:${e.PGPORT ?? '5432'}/${e.PGDATABASE ?? 'postgres'}`;
  }
  return undefined;
}

export function loadEnv(e: Record<string, string | undefined> = process.env): Env {
  const production = e.NODE_ENV === 'production';
  const databaseUrl = databaseUrlFrom(e);
  if (!databaseUrl) throw new Error('DATABASE_URL is not set (see .env.example)');
  let sessionSecret = e.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    if (production) throw new Error('SESSION_SECRET must be at least 32 characters in production');
    sessionSecret = 'dev-only-session-secret-change-me-0123456789';
  }
  return {
    databaseUrl,
    sessionSecret,
    port: Number(e.PORT ?? 8787),
    production,
    cookieSecure: bool(e.COOKIE_SECURE, production),
    autoMigrate: bool(e.AUTO_MIGRATE, true),
    seedDemo: bool(e.SEED_DEMO, false),
    adminPhone: e.ADMIN_PHONE,
    adminPassword: e.ADMIN_PASSWORD,
    adminName: e.ADMIN_NAME ?? 'Owner',
    businessName: e.BUSINESS_NAME,
    businessWhatsapp: e.BUSINESS_WHATSAPP,
    cronSecret: e.CRON_SECRET,
    reminderIntervalSeconds: Number(e.REMINDER_INTERVAL_SECONDS ?? 300),
    notifyUrl: e.DEVBENCH_NOTIFY_URL,
    notifyToken: e.DEVBENCH_NOTIFY_TOKEN,
    appOrigin: e.APP_ORIGIN ?? e.RENDER_EXTERNAL_URL, // Render provides its public https URL
  };
}
