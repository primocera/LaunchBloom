-- Upgrade Prompt 5: marketing-asset tables for the new studios.
--
-- These COEXIST with the existing per-item launch-kit tables (content_items,
-- email_items, ad_ideas, seo_items, weekly_tasks); they are not replacements.
-- Same security model as the rest of the schema: every row hangs off
-- workspaces.id, the backend filters by workspace_id + user_email, and the
-- service_role key bypasses RLS (which is enabled here for defense-in-depth).
--
-- Run in the Supabase SQL editor AFTER 001, 002 and 003.

-- =========================================================================
-- Website Studio — home / product / cart / about / faq / landing pages
-- =========================================================================

create table if not exists public.website_pages (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  launch_kit_id     uuid references public.launch_kits (id) on delete set null,
  offer_id          uuid references public.offers (id) on delete set null,
  page_type         text, -- home, product, collection, cart, about, faq, thank_you, contact, landing
  title             text,
  seo_title         text,
  meta_description  text,
  sections          jsonb,
  cta               text,
  status            text not null default 'draft',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists website_pages_workspace_id_idx on public.website_pages (workspace_id);
create index if not exists website_pages_launch_kit_id_idx on public.website_pages (launch_kit_id);
create index if not exists website_pages_offer_id_idx on public.website_pages (offer_id);

-- =========================================================================
-- Email Studio — lifecycle flows + campaign emails
-- =========================================================================

create table if not exists public.email_assets (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  launch_kit_id  uuid references public.launch_kits (id) on delete set null,
  offer_id       uuid references public.offers (id) on delete set null,
  flow_type      text, -- welcome, abandon_cart, browse_abandon, post_purchase, review_request, winback, campaign, launch, last_chance
  email_order    integer,
  subject_line   text,
  preheader      text,
  headline       text,
  body_copy      text,
  cta            text,
  send_timing    text,
  segment        text,
  design_notes   text,
  status         text not null default 'draft',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists email_assets_workspace_id_idx on public.email_assets (workspace_id);
create index if not exists email_assets_launch_kit_id_idx on public.email_assets (launch_kit_id);
create index if not exists email_assets_offer_id_idx on public.email_assets (offer_id);

-- =========================================================================
-- Captions Studio — social content
-- =========================================================================

create table if not exists public.social_assets (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  launch_kit_id     uuid references public.launch_kits (id) on delete set null,
  offer_id          uuid references public.offers (id) on delete set null,
  platform          text, -- instagram, tiktok, linkedin, pinterest, facebook
  content_type      text, -- caption, carousel, reel, story, short_video
  hook              text,
  caption           text,
  cta               text,
  visual_direction  text,
  hashtags          jsonb,
  status            text not null default 'draft',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists social_assets_workspace_id_idx on public.social_assets (workspace_id);
create index if not exists social_assets_launch_kit_id_idx on public.social_assets (launch_kit_id);
create index if not exists social_assets_offer_id_idx on public.social_assets (offer_id);

-- =========================================================================
-- Creative Studio — ad hooks / static / video / UGC briefs
-- =========================================================================

create table if not exists public.creative_assets (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  launch_kit_id     uuid references public.launch_kits (id) on delete set null,
  offer_id          uuid references public.offers (id) on delete set null,
  platform          text, -- meta, tiktok, google, pinterest
  creative_type     text, -- static, video, ugc, carousel, search_ad
  hook              text,
  headline          text,
  primary_text      text,
  visual_direction  text,
  shot_list         jsonb,
  text_overlays     jsonb,
  cta               text,
  testing_angle     text,
  status            text not null default 'draft',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists creative_assets_workspace_id_idx on public.creative_assets (workspace_id);
create index if not exists creative_assets_launch_kit_id_idx on public.creative_assets (launch_kit_id);
create index if not exists creative_assets_offer_id_idx on public.creative_assets (offer_id);

-- =========================================================================
-- SEO Studio — keyword / page SEO plans
-- =========================================================================

create table if not exists public.seo_assets (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  launch_kit_id     uuid references public.launch_kits (id) on delete set null,
  offer_id          uuid references public.offers (id) on delete set null,
  page_type         text,
  keyword           text,
  keyword_intent    text,
  seo_title         text,
  meta_description  text,
  h1                text,
  h2s               jsonb,
  faq               jsonb,
  internal_links    jsonb,
  priority          text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists seo_assets_workspace_id_idx on public.seo_assets (workspace_id);
create index if not exists seo_assets_launch_kit_id_idx on public.seo_assets (launch_kit_id);
create index if not exists seo_assets_offer_id_idx on public.seo_assets (offer_id);

-- =========================================================================
-- updated_at triggers + RLS (same pattern as 001_initial_schema.sql)
-- =========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'website_pages','email_assets','social_assets','creative_assets','seo_assets'
  ] loop
    execute format('create or replace trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;
