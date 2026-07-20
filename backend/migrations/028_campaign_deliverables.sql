-- ---------------------------------------------------------------------------
-- Migration 028 — v8 LB-S01: campaign deliverable plan.
--
-- Each campaign declares which outcomes it needs. Absence of rows means the
-- campaign is "unplanned" (conservative backfill: we never infer that every
-- channel is required), so no data backfill statement is needed.
-- Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

create table if not exists public.campaign_deliverables (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns (id) on delete cascade,
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  -- landing_page | email_flow | social_set | creative_brief | seo_ideas
  deliverable_code  text not null,
  -- required | optional | not_needed
  requirement_state text not null check (requirement_state in ('required', 'optional', 'not_needed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (campaign_id, deliverable_code)
);

create index if not exists campaign_deliverables_campaign_idx on public.campaign_deliverables (campaign_id);
create index if not exists campaign_deliverables_workspace_idx on public.campaign_deliverables (workspace_id);

alter table public.campaign_deliverables enable row level security;
