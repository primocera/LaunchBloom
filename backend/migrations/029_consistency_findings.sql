-- ---------------------------------------------------------------------------
-- Migration 029 — v8 LB-S02: consistency finding lifecycle.
--
-- Findings themselves are DERIVED (recomputed from assets + brief on demand,
-- free, deterministic). This table stores only lifecycle metadata keyed by
-- fingerprint: when a finding was first/last seen, whether the user
-- acknowledged it (human-review findings only) and when it stopped appearing.
-- Full asset text is never duplicated here. A finding whose fingerprint
-- changes is a new row — acknowledgments never carry over.
-- Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

create table if not exists public.consistency_findings (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  campaign_id    uuid not null references public.campaigns (id) on delete cascade,
  fingerprint    text not null,
  code           text not null,
  severity       text not null,
  rule_version   text not null,
  -- open | acknowledged | resolved  (resolved = no longer detected)
  status         text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  -- categorical note chosen at acknowledgment (never free text)
  note_category  text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  resolved_at    timestamptz,
  unique (campaign_id, fingerprint)
);

create index if not exists consistency_findings_campaign_idx on public.consistency_findings (campaign_id);
create index if not exists consistency_findings_workspace_idx on public.consistency_findings (workspace_id);

alter table public.consistency_findings enable row level security;
