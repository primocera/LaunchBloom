-- ---------------------------------------------------------------------------
-- Migration 042 — enable row-level security on the tables that never had it
--
-- Migrations 014, 015, 023, 036 and 038 created tables without an
-- `enable row level security` statement. In Supabase a public-schema table
-- without RLS is readable and writable through the REST API by anyone holding
-- the anon key, and the anon key is not designed to be a secret. email_events
-- and email_suppressions hold recipient addresses; admin_audit holds admin
-- emails.
--
-- No policies are added on purpose: the backend uses the service_role key,
-- which bypasses RLS, and no anon/authenticated client reads these tables. RLS
-- with no policy therefore denies every other caller, the same posture as the
-- tables in migration 001.
--
-- Safe to re-run. A table that does not exist yet (its migration is not
-- applied) is skipped, never created here.
--
-- Verify afterwards (expect zero rows):
--   select relname from pg_class
--   where relnamespace = 'public'::regnamespace and relkind = 'r'
--     and not relrowsecurity;
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'analytics_events',
    'email_events',
    'admin_audit',
    'email_suppressions',
    'stripe_object_ownership'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end;
$$;
