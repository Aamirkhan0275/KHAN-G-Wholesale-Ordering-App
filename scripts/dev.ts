/**
 * One-command local development: embedded PostgreSQL + API (auto-reload) + Vite.
 *   npm run dev   ->  http://localhost:5173   (API on :8787)
 * Uses DATABASE_URL instead of the embedded database when it is set.
 */
import { spawn } from 'node:child_process';
import { startEmbeddedPostgres } from './dev-db.js';

let pg: Awaited<ReturnType<typeof startEmbeddedPostgres>>['pg'] | null = null;
let databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  const r = await startEmbeddedPostgres();
  pg = r.pg;
  databaseUrl = r.url;
  console.log(`[dev] embedded PostgreSQL at ${databaseUrl}`);
}
const env = { ...process.env, DATABASE_URL: databaseUrl, SEED_DEMO: process.env.SEED_DEMO ?? 'true', PORT: process.env.PORT ?? '8787' };
const kids = [
  spawn('npx', ['tsx', 'watch', 'server/node.ts'], { stdio: 'inherit', env }),
  spawn('npx', ['vite', '--host'], { stdio: 'inherit', env }),
];
const stop = async () => { kids.forEach((k) => k.kill('SIGTERM')); if (pg) await pg.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
