-- ---------------------------------------------------------------------------
-- Migration 007 — Usage metering ledger (audit Prompt 6)
--
-- Replaces "count rows in the asset tables" with an explicit ledger where ONE
-- successful user-triggered generation = ONE AI action, regardless of how many
-- items it produced. A row is reserved before the expensive call, finalized on
-- success, and released/failed otherwise — so failed generations never consume
-- quota and concurrent requests can't quietly exceed the limit.
--
-- Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

create table if not exists public.usage_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid,
  workspace_id   uuid not null,
  feature        text not null,          -- positioning | offer_generations | launch_kits | asset_generations | regenerate_section
  action         text not null default 'generate',
  request_id     text,                   -- idempotency / correlation key
  units          integer not null default 1,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  estimated_cost numeric,
  status         text not null default 'reserved', -- reserved | succeeded | released | failed
  created_at     timestamptz not null default now()
);

-- Hot path: count reserved+succeeded actions for a workspace within a window.
create index if not exists usage_events_ws_status_idx
  on public.usage_events (workspace_id, status, created_at);

create index if not exists usage_events_ws_feature_idx
  on public.usage_events (workspace_id, feature, status);

alter table public.usage_events enable row level security;
