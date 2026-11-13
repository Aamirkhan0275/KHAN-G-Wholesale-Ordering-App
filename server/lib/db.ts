import postgres from 'postgres';

export type Sql = postgres.Sql<Record<string, never>>;
export type Tx = postgres.TransactionSql<Record<string, never>>;
export type Q = Sql | Tx;

export function createDb(url: string, max = 10): Sql {
  return postgres(url, {
    max,
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
