import { createDb } from '../server/lib/db.js';
import { loadEnv } from '../server/lib/env.js';
import { seedDemo, DEMO_ADMIN, DEMO_SHOPS } from './seed-demo-lib.js';

const env = loadEnv();
const sql = createDb(env.databaseUrl, 2);
const r = await seedDemo(sql, { onlyIfEmpty: true });
console.log(r.seeded ? r : 'Products already exist - demo seed skipped.');
console.log(`Demo admin: ${DEMO_ADMIN.phone} / ${DEMO_ADMIN.password} (only if no admin existed)`);
console.log(`Demo shops: ${DEMO_SHOPS.map((s) => `${s.phone} (${s.status})`).join(', ')} / password ${DEMO_SHOPS[0].password}`);
await sql.end();
