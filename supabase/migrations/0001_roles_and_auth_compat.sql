-- 0001 Roles and auth compatibility layer
--
-- On Supabase the roles `anon` / `authenticated` and the function `auth.uid()`
-- already exist; this migration only creates them when they are missing (plain
-- PostgreSQL for local development, tests and preview deployments).
--
-- How identity reaches the database: the API server opens a transaction per
-- request, runs `SET LOCAL ROLE authenticated` and stores the signed-in user's
-- id in `request.jwt.claims` (exactly what Supabase/PostgREST do). Row Level
-- Security policies then read it through auth.uid().

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
END $$;

-- The connecting (owner) role must be allowed to switch into `authenticated`.
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'authenticated', 'MEMBER') THEN
    EXECUTE format('GRANT authenticated TO %I', current_user);
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $body$
        SELECT nullif(
          coalesce(
            nullif(current_setting('request.jwt.claim.sub', true), ''),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
          ), ''
        )::uuid
      $body$
    $fn$;
  END IF;
END $$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
