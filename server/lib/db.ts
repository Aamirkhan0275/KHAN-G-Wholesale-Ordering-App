import postgres from 'postgres';

export type Sql = postgres.Sql<Record<string, never>>;
export type Tx = postgres.TransactionSql<Record<string, never>>;
export type Q = Sql | Tx;

/**
 * Hosted databases (Neon, Supabase) give URLs like
 *   postgresql://user:pw@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
 * The driver would send unknown query parameters (channel_binding) to the server as
 * settings, so they are removed here and turned into driver options instead:
 *  - sslmode=require/verify-* -> TLS required
 *  - a connection-pooler host (PgBouncer, transaction mode) -> no prepared statements
 */
export function dbConnectionOptions(raw: string): { url: string; ssl: false | 'require' | 'verify-full'; prepare: boolean } {
  let u: URL;
  try { u = new URL(raw); } catch { return { url: raw, ssl: false, prepare: true }; }
  const mode = (u.searchParams.get('sslmode') ?? '').toLowerCase();
  for (const k of ['sslmode', 'channel_binding', 'sslrootcert', 'pgbouncer', 'options']) u.searchParams.delete(k);
  const host = u.hostname.toLowerCase();
  const local = ['localhost', '127.0.0.1', '::1'].includes(host) || host.startsWith('[');
  const ssl: false | 'require' | 'verify-full' =
    mode === 'disable' ? false : mode === 'verify-full' || mode === 'verify-ca' ? 'verify-full' : mode ? 'require' : local ? false : 'require';
  const pooled = /-pooler\.|pooler\.supabase\.com$|:6543$/.test(host + ':' + (u.port || ''));
  return { url: u.toString(), ssl, prepare: !pooled };
}

export function createDb(rawUrl: string, max = 10): Sql {
  const { url, ssl, prepare } = dbConnectionOptions(rawUrl);
  return postgres(url, {
    max,
    ssl: ssl || undefined,
    prepare,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    types: {
      // numeric -> JS number (amounts stay well inside double precision)
      numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => parseFloat(x) },
      // bigint (count(*)) -> number
      int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
      // date -> 'YYYY-MM-DD' string (no timezone surprises)
      date: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x },
    },
  }) as unknown as Sql;
}

/**
 * Run `fn` inside a transaction as the Postgres role `authenticated`, with the
 * user id in request.jwt.claims — the same mechanism Supabase uses — so every
 * query is filtered by Row Level Security.
 */
export async function asUser<T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
    await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('role', 'authenticated', true)`;
    return fn(tx as unknown as Tx);
  }) as Promise<T>;
}
