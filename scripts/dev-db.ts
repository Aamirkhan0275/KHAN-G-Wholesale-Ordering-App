/**
 * Local PostgreSQL without Docker or root: downloads nothing at runtime (binaries
 * come from the embedded-postgres npm package). Used by `npm run dev`, tests and CI.
 *   npm run db:start   -> starts on port 54329 and keeps running
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function startEmbeddedPostgres(opts: { dir?: string; port?: number; fresh?: boolean } = {}) {
  const dir = opts.dir ?? join(process.cwd(), '.pgdata');
  const port = opts.port ?? 54329;
  const pg = new EmbeddedPostgres({
    databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: !opts.fresh,
    initdbFlags: ['--encoding=UTF8', '--locale=C.UTF-8'],
    onLog: () => {}, onError: () => {},
  });
  if (!existsSync(join(dir, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  return { pg, url };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pg, url } = await startEmbeddedPostgres();
  console.log(`PostgreSQL running: ${url}\n(Ctrl+C to stop)`);
  const stop = async () => { await pg.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
