-- ---------------------------------------------------------------------------
-- Migration 030 — v8 LB-S03: stale-asset review decisions.
--
-- Stale state itself is DERIVED (current brief vs each asset's snapshot).
-- This table records only the explicit user decision to keep a snapshot,
-- keyed by the diff fingerprint: any further material brief change produces a
-- new fingerprint and reopens the review automatically. Customer-facing asset
-- statuses are never overloaded. Run in the Supabase SQL editor. Safe once.
-- ---------------------------------------------------------------------------

create table if not exists public.asset_brief_reviews (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  campaign_id      uuid not null references public.campaigns (id) on delete cascade,
  asset_table      text not null,
  asset_id         uuid not null,
  diff_fingerprint text not null,
  decision         text not null default 'keep_snapshot' check (decision in ('keep_snapshot')),
  reviewer         text,
  reviewed_at      timestamptz not null default now(),
  unique (campaign_id, asset_table, asset_id)
);

create index if not exists asset_brief_reviews_campaign_idx on public.asset_brief_reviews (campaign_id);
create index if not exists asset_brief_reviews_workspace_idx on public.asset_brief_reviews (workspace_id);

alter table public.asset_brief_reviews enable row level security;
