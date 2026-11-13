/** Production-like local run: embedded PostgreSQL + built PWA (npm run build first). */
import { startEmbeddedPostgres } from './dev-db.js';
const dir = process.env.PGDATA_DIR;
const { url } = await startEmbeddedPostgres({ dir, port: Number(process.env.PGPORT_LOCAL ?? 54329) });
process.env.DATABASE_URL = url;
process.env.SEED_DEMO ??= 'true';
await import('../server/node.js');
