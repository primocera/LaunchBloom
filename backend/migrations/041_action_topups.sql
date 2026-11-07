-- ---------------------------------------------------------------------------
-- Migration 041 — AI-action top-ups (one-time packs)
--
-- A paying subscriber who has used this month's AI actions can buy a one-time
-- pack of extra AI actions (Stripe Checkout, mode=payment). Each paid pack is
-- ONE row here. The plan allowance and the usage_events ledger are unchanged;
-- valid packs only raise the current month's limit.
--
-- A pack is valid only for the monthly usage window it was bought in:
-- expires_at is the next reset of that window (monthly and yearly plans both
-- meter per monthly window). It never rolls over.
--
-- Idempotency: the webhook inserts with ON CONFLICT (stripe_checkout_session_id)
-- DO NOTHING, so a redelivered or concurrently processed Stripe event can never
-- grant the same pack twice. Packs are deliberately NOT written to `payments`
-- (resolveEntitlement reads any succeeded payment as lifetime access).
--
-- ADDITIVE, IDEMPOTENT, moves no money. Run once in the Supabase SQL editor.
-- Rollback: drop table public.action_topups;
-- ---------------------------------------------------------------------------

create table if not exists public.action_topups (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null,
  pack                       text not null,
  actions                    integer not null check (actions > 0),
  status                     text not null default 'active', -- active | refunded
  expires_at                 timestamptz not null,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id   text unique,
  amount_total               integer,
  currency                   text,
  created_at                 timestamptz not null default now()
);

-- Hot path: the active, unexpired packs for one user.
create index if not exists action_topups_user_expires_idx
  on public.action_topups (user_id, status, expires_at);

alter table public.action_topups enable row level security;
