-- Prompt 22: the SEO studio lets users mark items "planned". seo_items had no
-- status column in the initial schema, so add it. (ad_ideas, content_items and
-- email_items already carry status; weekly_tasks uses `completed`.)

alter table public.seo_items
  add column if not exists status text not null default 'planned';
