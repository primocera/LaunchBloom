-- ---------------------------------------------------------------------------
-- Migration 013 — Asset Library, versions & generation runs (audit Prompt 13)
--
-- Adds library metadata (favourite/archived), a generation_run_id so each
-- generation's outputs stay grouped (never mixed into older results), and an
-- immutable asset_versions history: every edit snapshots the previous state so
-- it can be restored. Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

alter table public.website_pages
  add column if not exists favourite boolean not null default false,
  add column if not exists archived boolean not null default false,
  add column if not exists generation_run_id uuid;

alter table public.email_assets
  add column if not exists favourite boolean not null default false,
  add column if not exists archived boolean not null default false,
  add column if not exists generation_run_id uuid;

alter table public.social_assets
  add column if not exists favourite boolean not null default false,
  add column if not exists archived boolean not null default false,
  add column if not exists generation_run_id uuid;

alter table public.creative_assets
  add column if not exists favourite boolean not null default false,
  add column if not exists archived boolean not null default false,
  add column if not exists generation_run_id uuid;

alter table public.seo_assets
  add column if not exists status text not null default 'draft',
  add column if not exists favourite boolean not null default false,
  add column if not exists archived boolean not null default false,
  add column if not exists generation_run_id uuid;

-- Immutable version history: a snapshot of the row BEFORE each edit.
create table if not exists public.asset_versions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  asset_table   text not null,
  asset_id      uuid not null,
  snapshot      jsonb not null,
  created_at    timestamptz not null default now()
);

create index if not exists asset_versions_asset_idx on public.asset_versions (asset_table, asset_id, created_at);

alter table public.asset_versions enable row level security;
