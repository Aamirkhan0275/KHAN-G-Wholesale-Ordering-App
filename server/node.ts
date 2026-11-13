/**
 * Node.js entry point (local development, Docker, DevBench preview, any VPS).
 * Serves the API and the built PWA from dist/, runs migrations on start and the
 * weekly reminder job on an interval.
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDb } from './lib/db.js';
import { loadEnv } from './lib/env.js';
import { migrate } from './lib/migrate.js';
import { bootstrap } from './lib/bootstrap.js';
import { alert, configureAlerts, log } from './lib/log.js';
import { runReminders } from './lib/reminders.js';
import { seedDemo } from '../scripts/seed-demo-lib.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv();
configureAlerts(env.notifyUrl, env.notifyToken);
const sql = createDb(env.databaseUrl);

if (env.autoMigrate) await migrate(sql, join(root, 'supabase', 'migrations'));
await bootstrap(sql, env);
if (env.seedDemo) await seedDemo(sql, { onlyIfEmpty: true });

const api = createApp({ sql, env });
const server = new Hono();
server.route('/', api);

const dist = join(root, 'dist');
if (existsSync(dist)) {
  server.use('/*', serveStatic({
    root: './dist',
    onFound: (path, c) => {
      if (path.endsWith('sw.js') || path.endsWith('.webmanifest') || path.endsWith('index.html')) c.header('Cache-Control', 'no-cache');
      else if (path.includes('/assets/')) c.header('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  server.get('*', (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(readFileSync(join(dist, 'index.html'), 'utf8')); // re-read: picks up new builds
  });
}

serve({ fetch: server.fetch, port: env.port, hostname: '0.0.0.0' }, (info) => {
  log('info', 'server_started', { port: info.port, static: existsSync(dist) });
});

// Scheduler: evaluates weekly reminders every REMINDER_INTERVAL_SECONDS (default 5 min).
let failures = 0;
const tick = async () => {
  try {
    await runReminders(sql);
    failures = 0;
  } catch (e) {
    failures++;
    log('error', 'reminder_job_failed', { error: String(e), failures });
    if (failures >= 3) void alert('reminder_job', `KHAN G reminder job failed ${failures} times in a row: ${String(e).slice(0, 200)}`);
  }
};
if (env.reminderIntervalSeconds > 0) {
  setTimeout(tick, 10_000);
  setInterval(tick, env.reminderIntervalSeconds * 1000);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => { log('info', 'shutdown', { sig }); await sql.end({ timeout: 5 }); process.exit(0); });
}
