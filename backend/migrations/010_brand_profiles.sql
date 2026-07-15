-- ---------------------------------------------------------------------------
-- Migration 010 — Brand Profile (audit Prompt 9)
--
-- One reusable brand profile per workspace, consumed by every AI studio so
-- output stays on-brand and consistent. Stored as jsonb so the shape can grow
-- without migrations. Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

create table if not exists public.brand_profiles (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null unique,
  data          jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

create index if not exists brand_profiles_workspace_idx on public.brand_profiles (workspace_id);

alter table public.brand_profiles enable row level security;
