-- ---------------------------------------------------------------------------
-- Migration 031 — v8 LB-S04: evidence locker + asset links.
--
-- Evidence records are user-recorded proof references (who checked what,
-- when) reused across assets. LaunchBloom never scrapes sources or asserts
-- truth. Links reference evidence by id — evidence text is never copied into
-- asset rows. Soft delete via archived. Run in Supabase SQL editor. Safe once.
-- ---------------------------------------------------------------------------

create table if not exists public.evidence (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  -- review | testimonial | statistic | certification | press | internal_data | other
  type             text not null default 'other',
  label            text not null,
  source_url       text,          -- sanitized http(s) only
  source_ref       text,          -- offline reference (document, email, ...)
  permitted_claim  text,          -- the exact claim the user allows from this evidence
  checked_date     date not null, -- when the USER verified it
  review_by_date   date,          -- optional expiry/re-check reminder
  archived         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists evidence_workspace_idx on public.evidence (workspace_id);

create table if not exists public.asset_evidence_links (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  evidence_id   uuid not null references public.evidence (id) on delete cascade,
  campaign_id   uuid references public.campaigns (id) on delete set null,
  asset_table   text not null,
  asset_id      uuid not null,
  created_at    timestamptz not null default now(),
  unique (evidence_id, asset_table, asset_id)
);

create index if not exists asset_evidence_links_workspace_idx on public.asset_evidence_links (workspace_id);
create index if not exists asset_evidence_links_campaign_idx on public.asset_evidence_links (campaign_id);

alter table public.evidence enable row level security;
alter table public.asset_evidence_links enable row level security;
