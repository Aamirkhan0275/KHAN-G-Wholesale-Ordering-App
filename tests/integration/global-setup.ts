import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import postgres from 'postgres';
import { startEmbeddedPostgres } from '../../scripts/dev-db';
import { createDb } from '../../server/lib/db';
import { migrate } from '../../server/lib/migrate';

/** Starts a throwaway PostgreSQL 17 and builds a migrated template database for the test files. */
export default async function setup({ provide }: any) {
  const dir = join(tmpdir(), `kg-test-pg-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  const port = 54400 + (process.pid % 500);
  const { pg, url } = await startEmbeddedPostgres({ dir, port, fresh: true });
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  await admin.unsafe('create database kg_template');
  await admin.end();
  const tpl = createDb(url.replace(/\/postgres$/, '/kg_template'), 1);
  await migrate(tpl, join(process.cwd(), 'supabase', 'migrations'));
  await tpl.end();
  provide('pgBaseUrl', url);
  return async () => { await pg.stop(); rmSync(dir, { recursive: true, force: true }); };
}
