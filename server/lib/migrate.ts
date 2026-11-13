import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Sql } from './db.js';
import { log } from './log.js';

/** Apply supabase/migrations/*.sql in filename order, each exactly once. */
export async function migrate(sql: Sql, dir: string): Promise<string[]> {
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(724113)`;
    await tx`create table if not exists app_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())`;
    const done = new Map((await tx<{ name: string; checksum: string }[]>`select name, checksum from app_migrations`).map((r) => [r.name, r.checksum]));
    for (const f of files) {
      const body = readFileSync(join(dir, f), 'utf8');
      const sum = createHash('sha256').update(body).digest('hex');
      if (done.has(f)) {
        if (done.get(f) !== sum) log('warning', 'migration_changed_after_apply', { file: f });
        continue;
      }
      await tx.unsafe(body);
      await tx`insert into app_migrations (name, checksum) values (${f}, ${sum})`;
      applied.push(f);
    }
  });
  if (applied.length) log('info', 'migrations_applied', { files: applied });
  return applied;
}
