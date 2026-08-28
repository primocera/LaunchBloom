-- ---------------------------------------------------------------------------
-- Migration 040 — corrective, non-partial uniqueness for canonical billing
--                 identity  (SV-22-01 / v22)
--
-- FORWARD-ONLY correction of migration 039. It is ADDITIVE to behaviour,
-- IDEMPOTENT and REVERSIBLE, moves no money and deletes no rows.
--
-- WHY THIS EXISTS
--   Migration 039 created a PARTIAL unique index
--       customers_app_user_id_key ON customers(app_user_id) WHERE app_user_id IS NOT NULL
--   but the runtime (payments.ensureStripeCustomer, webhooks.onCheckoutSessionCompleted)
--   and PostgREST/Supabase upsert with `onConflict: 'app_user_id'`, which emits a
--   plain `ON CONFLICT (app_user_id)` with NO predicate. PostgreSQL will NOT infer
--   a PARTIAL index as the conflict arbiter unless the statement repeats the same
--   WHERE predicate, so under STRIPE_OWNERSHIP_ENFORCED every canonical customer
--   upsert would fail with:
--       "there is no unique or exclusion constraint matching the ON CONFLICT
--        specification".
--   A normal (non-partial) UNIQUE index is a valid arbiter for that statement, and
--   PostgreSQL already permits MULTIPLE NULLs under a normal UNIQUE index — so the
--   partial predicate that caused the mismatch was never needed to keep legacy
--   NULL rows. This migration swaps the partial index for a non-partial one of the
--   SAME NAME, so the invariant `customers_app_user_id_key` that 039's VERIFY and
--   the readiness probe reference is preserved, now as an inferable arbiter.
--
-- Requires migration 038 applied first (adds customers.app_user_id + backfill).
-- Supersedes the index created by 039; 039 is left in place (historical) and is a
-- no-op after this runs. Never rewrite 039 in place — this is the forward fix.
--
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- PREFLIGHT (read-only — run BEFORE applying; the DO block below ALSO enforces it
-- and aborts safely if it returns any row, so a duplicate can never be silently
-- collapsed by an arbitrary winner):
--   select app_user_id, count(*) as rows
--     from public.customers
--    where app_user_id is not null
--    group by app_user_id
--   having count(*) > 1;
--
-- VERIFY (run AFTER applying):
--   -- the index still exists AND is now non-partial (indpred is null):
--   select i.indisunique, i.indpred is null as non_partial
--     from pg_index i
--     join pg_class ic on ic.oid = i.indexrelid
--    where ic.relname = 'customers_app_user_id_key';
--   -- the runtime-facing readiness probe agrees (expects TRUE):
--   select public.stripe_ownership_uniqueness_ready();
--
-- ROLLBACK (data-safe — restores the 039 partial index; drops only this fix. Note
-- the partial index re-introduces the onConflict mismatch, so DO NOT run the
-- runtime under enforcement after rolling back):
--   drop function if exists public.stripe_ownership_uniqueness_ready();
--   drop index if exists public.customers_app_user_id_key;
--   create unique index if not exists customers_app_user_id_key
--     on public.customers (app_user_id) where app_user_id is not null;
-- ---------------------------------------------------------------------------

-- 1. Fail-closed preflight + corrective swap in ONE transactional DO block so the
--    partial index is never dropped unless the non-partial one can be created.
do $$
declare
  dup_count integer;
  is_partial boolean;
begin
  -- Never create uniqueness over duplicated data. Stop with an explicit message;
  -- the operator reconciles the duplicates by hand (see docs/RUNBOOK_STRIPE_OWNERSHIP.md).
  select count(*) into dup_count from (
    select app_user_id
      from public.customers
     where app_user_id is not null
     group by app_user_id
    having count(*) > 1
  ) d;
  if dup_count > 0 then
    raise exception
      'migration 040 preflight: % app_user_id value(s) appear on more than one customer row. Reconcile these by hand before applying uniqueness — this migration will NOT pick an arbitrary winner or delete rows.', dup_count
      using errcode = 'raise_exception';
  end if;

  -- Is the currently-present index the PARTIAL one from 039? (indpred not null).
  select (i.indpred is not null) into is_partial
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
   where ic.relname = 'customers_app_user_id_key';

  -- Only drop when it is the partial variant; if it is already non-partial (this
  -- migration re-run) leave it untouched so re-runs are cheap no-ops.
  if is_partial is true then
    execute 'drop index if exists public.customers_app_user_id_key';
  end if;

  -- Create the non-partial single-column UNIQUE index. NULL app_user_id legacy
  -- rows remain permitted (PostgreSQL allows multiple NULLs under a normal UNIQUE
  -- index); two non-null rows sharing an id are rejected — the same guarantee 039
  -- intended, now as a valid `ON CONFLICT (app_user_id)` arbiter.
  execute 'create unique index if not exists customers_app_user_id_key '
       || 'on public.customers (app_user_id)';
end $$;

-- 2. Runtime-facing probe: does the deployed schema carry a NON-PARTIAL,
--    single-column UNIQUE index on customers(app_user_id) — i.e. an index
--    PostgREST's `onConflict: 'app_user_id'` can actually infer as the arbiter?
--    The admin readiness endpoint calls this so paid readiness verifies the EXACT
--    uniqueness invariant, not merely that the column exists. Returns TRUE only
--    when a real arbiter is present, so an un-fixed (039-only) or absent index
--    fails closed.
create or replace function public.stripe_ownership_uniqueness_ready()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
      from pg_index i
      join pg_class c  on c.oid  = i.indrelid
      join pg_class ic on ic.oid = i.indexrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'customers'
       and i.indisunique
       and i.indpred is null      -- NON-partial: a valid ON CONFLICT arbiter
       and i.indnatts = 1         -- single-column
       and (
         select a.attname
           from pg_attribute a
          where a.attrelid = c.oid
            and a.attnum = i.indkey[0]
       ) = 'app_user_id'
  );
$$;
