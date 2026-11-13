import type { Context } from 'hono';
import type { Sql } from './lib/db.js';
import type { Env } from './lib/env.js';
import type { SessionUser } from './lib/auth.js';

export interface Deps { sql: Sql; env: Env; now?: () => Date }
export type AppEnv = { Variables: { user: SessionUser; deps: Deps } };
export type Ctx = Context<AppEnv>;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
