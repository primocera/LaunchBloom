-- ---------------------------------------------------------------------------
-- Migration 021 — Honest "SEO content ideas" (v5 Prompt 12)
--
-- SEO output is ideation, not researched keyword data. Adds honest structure
-- fields to seo_items (no fabricated metrics — no volume/difficulty/CPC):
--   topic_cluster       — the content cluster/theme
--   search_intent       — informational / commercial / transactional / navigational
--   secondary_keywords  — related keyword ideas
-- Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

alter table public.seo_items
  add column if not exists topic_cluster      text,
  add column if not exists search_intent      text,
  add column if not exists secondary_keywords jsonb;
