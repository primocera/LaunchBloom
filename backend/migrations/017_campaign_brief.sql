-- v5 Prompt 6: campaigns become the central brief. Extra brief fields,
-- archive flag, and per-asset brief snapshot + prompt version for traceability.

alter table public.campaigns
  add column if not exists markets text,
  add column if not exists language text,
  add column if not exists key_message text,
  add column if not exists proof text,
  add column if not exists restrictions text,
  add column if not exists deadline date,
  add column if not exists archived boolean not null default false;

alter table public.website_pages   add column if not exists brief_snapshot jsonb, add column if not exists prompt_version text;
alter table public.email_assets    add column if not exists brief_snapshot jsonb, add column if not exists prompt_version text;
alter table public.social_assets   add column if not exists brief_snapshot jsonb, add column if not exists prompt_version text;
alter table public.creative_assets add column if not exists brief_snapshot jsonb, add column if not exists prompt_version text;
alter table public.seo_assets      add column if not exists brief_snapshot jsonb, add column if not exists prompt_version text;
