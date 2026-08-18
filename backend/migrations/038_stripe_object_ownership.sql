-- ---------------------------------------------------------------------------
-- Migration 038 — explicit Stripe object ownership  (SV-01 / v20)
--
-- Completes the ownership-architecture trio that was DEFERRED by owner decision
-- at v19 (see docs/launch/launch-state.json). It is ADDITIVE, IDEMPOTENT and
-- REVERSIBLE. It does NOT move money, delete rows, guess ownership from email or
-- price, or change any runtime behaviour on its own. The runtime keeps using the
-- narrow price-only legacy fallback until the owner backfills legacy objects
-- (scripts/backfill-stripe-ownership.js) and then flips the fallback off — that
-- switch is a SEPARATE, owner-only change, NOT this migration.
--
-- Two additive facts:
--   1. customers.app_user_id — the stable Supabase user UUID that already lives
--      in customers.metadata.app_user_id, promoted to a first-class, indexable
--      column so ownership reads are exact and cheap instead of jsonb lookups.
--   2. stripe_object_ownership — an explicit, owner-verified legacy mapping. A
--      row here means "this pre-stamp Stripe object IS Scalvya's" and is the
--      ONLY way an unstamped object may be adopted once the price fallback is
--      sunset. Ambiguous legacy objects are deliberately left UNMAPPED so they
--      block paid expansion instead of being adopted by guesswork.
--
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- PREFLIGHT (read-only — run BEFORE applying, record the counts):
--   select count(*)                             as customers_total,
--          count(*) filter (where metadata ? 'app_user_id') as with_meta_user,
--          count(*) filter (where stripe_customer_id is not null) as with_stripe
--     from public.customers;
--
-- VERIFY (run AFTER applying):
--   select count(*) as backfilled_app_user_id
--     from public.customers where app_user_id is not null;
--   -- expect: equals with_meta_user from preflight (metadata → column copy).
--   select to_regclass('public.stripe_object_ownership') is not null as table_exists;
--
-- ROLLBACK (data-safe — drops only what this migration added):
--   drop table if exists public.stripe_object_ownership;
--   alter table public.customers drop column if exists app_user_id;
-- ---------------------------------------------------------------------------

-- 1. Promote the stable user id to a first-class column (nullable & additive).
alter table public.customers
  add column if not exists app_user_id uuid;

-- Backfill from the metadata already stamped by ensureStripeCustomer. This copies
-- an existing, self-supplied fact — it never derives ownership from email/price.
-- Guarded so a malformed metadata value can never abort the migration.
update public.customers
   set app_user_id = (metadata ->> 'app_user_id')::uuid
 where app_user_id is null
   and metadata ? 'app_user_id'
   and (metadata ->> 'app_user_id') ~ '^[0-9a-fA-F-]{36}$';

create index if not exists customers_app_user_id_idx
  on public.customers (app_user_id);

-- 2. Explicit, owner-verified legacy ownership map. Every adoption of a pre-stamp
--    object must be recorded here with provenance; nothing writes it automatically.
create table if not exists public.stripe_object_ownership (
  id              uuid primary key default gen_random_uuid(),
  -- 'customer' | 'subscription' | 'invoice' | 'charge'
  object_type     text not null,
  stripe_object_id text not null,
  -- always 'launchbloom' here; the column exists so a shared-account audit can
  -- see at a glance which app each mapped object was verified into.
  app_source      text not null default 'launchbloom',
  -- the stable Supabase user UUID this object was verified to belong to.
  app_user_id     uuid,
  -- how ownership was established: 'metadata_stamp' | 'stripe_search' |
  -- 'owner_manual' | 'db_link'. Free-guess values are rejected server-side.
  provenance      text not null,
  -- 'mapped' (verified ours) | 'ambiguous' (needs owner reconciliation, blocks
  -- paid expansion) | 'foreign' (verified NOT ours, recorded to stop re-review).
  status          text not null default 'mapped'
                    check (status in ('mapped', 'ambiguous', 'foreign')),
  first_seen_at   timestamptz not null default now(),
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (object_type, stripe_object_id)
);

create index if not exists stripe_object_ownership_user_idx
  on public.stripe_object_ownership (app_user_id);
create index if not exists stripe_object_ownership_status_idx
  on public.stripe_object_ownership (status);
