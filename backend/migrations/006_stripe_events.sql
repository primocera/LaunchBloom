-- ---------------------------------------------------------------------------
-- Migration 006 — Stripe webhook idempotency (audit Prompt 5)
--
-- Records every Stripe event so redelivered events are processed exactly once,
-- and lets the handler return 5xx (Stripe retries) on transient failures
-- without double-applying anything. Also adds an event timestamp on
-- subscriptions so out-of-order deliveries can't overwrite newer state.
--
-- Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

create table if not exists public.stripe_events (
  event_id      text primary key,           -- Stripe event id (evt_...)
  type          text,
  status        text not null default 'processing', -- processing | processed | failed
  attempts      integer not null default 1,
  processed_at  timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

-- Timestamp of the Stripe event that last wrote this subscription row, so we
-- can ignore an out-of-order (older) event that arrives after a newer one.
alter table public.subscriptions
  add column if not exists stripe_event_at timestamptz;
