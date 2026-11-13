import { join } from 'node:path';
import { createDb } from '../server/lib/db.js';
import { loadEnv } from '../server/lib/env.js';
import { migrate } from '../server/lib/migrate.js';
import { bootstrap } from '../server/lib/bootstrap.js';

const env = loadEnv();
const sql = createDb(env.databaseUrl, 1);
const applied = await migrate(sql, join(process.cwd(), 'supabase', 'migrations'));
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
await bootstrap(sql, env);
await sql.end();
