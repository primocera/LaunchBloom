-- ---------------------------------------------------------------------------
-- Migration 012 — Campaign Studio (audit Prompt 12)
--
-- Campaigns are the organizing layer: one brief (objective, audience, offer,
-- dates, message hierarchy) that linked assets are generated from, so landing
-- copy, emails, social posts and ads stay consistent on discount, dates, CTA
-- and audience. Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

create table if not exists public.campaigns (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  offer_id           uuid references public.offers (id) on delete set null,
  name               text not null,
  objective          text,
  audience           text,
  offer_summary      text,
  products           text,
  start_date         date,
  end_date           date,
  channels           jsonb,          -- ["email","social","ads","landing"]
  promo_terms        text,           -- discount / promo details
  -- AI-generated strategy (message hierarchy, proof, objections, calendar)
  strategy           jsonb,
  brief_approved     boolean not null default false,
  status             text not null default 'draft', -- draft | active | completed | archived
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists campaigns_workspace_idx on public.campaigns (workspace_id);

alter table public.campaigns enable row level security;

-- Link generated assets back to their campaign.
alter table public.website_pages  add column if not exists campaign_id uuid references public.campaigns (id) on delete set null;
alter table public.email_assets   add column if not exists campaign_id uuid references public.campaigns (id) on delete set null;
alter table public.social_assets  add column if not exists campaign_id uuid references public.campaigns (id) on delete set null;
alter table public.creative_assets add column if not exists campaign_id uuid references public.campaigns (id) on delete set null;
alter table public.seo_assets     add column if not exists campaign_id uuid references public.campaigns (id) on delete set null;
