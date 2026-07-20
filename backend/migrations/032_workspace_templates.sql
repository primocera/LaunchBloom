-- ---------------------------------------------------------------------------
-- Migration 032 — v8 LB-S06: workspace campaign templates.
--
-- User-saved, sanitized reuse of an existing campaign: chosen brief fields +
-- the deliverable plan only. Approval state, statuses, strategy, evidence
-- ownership and performance claims never transfer. Templates are workspace-
-- scoped; there is no public marketplace. Run in Supabase SQL editor. Safe once.
-- ---------------------------------------------------------------------------

create table if not exists public.workspace_templates (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  name                text not null,
  -- provenance: which campaign it was saved from (kept even if that campaign goes)
  source_campaign_id  uuid,
  version             integer not null default 1,
  -- { brief: {objective, audience, ...chosen fields}, deliverables: [{deliverable_code, requirement_state}] }
  data                jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists workspace_templates_workspace_idx on public.workspace_templates (workspace_id);

alter table public.workspace_templates enable row level security;
