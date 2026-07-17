-- ---------------------------------------------------------------------------
-- Migration 019 — Social Studio channel-aware output + calendar (v5 Prompt 10)
--
-- Adds per-format structure and planning fields to social_assets:
--   pillar        — content pillar/angle (education, proof, objection, …)
--   slides        — carousel slide-by-slide copy
--   video_script  — reel/short-video hook, spoken script, on-screen text, shots, b-roll
--   planned_date  — calendar planning date (schedule without exporting)
-- Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

alter table public.social_assets
  add column if not exists pillar        text,
  add column if not exists slides        jsonb,
  add column if not exists video_script  jsonb,
  add column if not exists planned_date  date;

create index if not exists social_assets_planned_date_idx on public.social_assets (planned_date);
