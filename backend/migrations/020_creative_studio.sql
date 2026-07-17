-- ---------------------------------------------------------------------------
-- Migration 020 — Ads & Creative Studio depth (v5 Prompt 11)
--
-- Adds production-ready brief structures and compliance handling to
-- creative_assets:
--   angle           — the distinct concept angle/mechanism
--   designer_notes  — static/carousel composition + overlay notes
--   video_timeline  — first-frame hook, scene-by-scene timeline, b-roll, audio, end card
--   slides          — carousel cover + slide-by-slide + CTA slide
--   search_ad       — headlines/descriptions (char-limited) + keyword groups by intent
--   test_matrix     — variable / hypothesis / control / success metric
--   compliance_flags— high-risk claims needing proof/acknowledgement
--   compliance_ack  — user acknowledgement ({ acknowledged, at })
-- Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

alter table public.creative_assets
  add column if not exists angle            text,
  add column if not exists designer_notes   text,
  add column if not exists video_timeline   jsonb,
  add column if not exists slides           jsonb,
  add column if not exists search_ad        jsonb,
  add column if not exists test_matrix      jsonb,
  add column if not exists compliance_flags jsonb,
  add column if not exists compliance_ack   jsonb;
