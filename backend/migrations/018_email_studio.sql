-- ---------------------------------------------------------------------------
-- Migration 018 — Email Studio unification (v5 Prompt 9)
--
-- Adds the fields the unified Email Studio produces on top of 011:
--   subject_options  — 2–3 distinct subject-line options per email
--   campaign_type    — promotion / product_launch / flash_offer / restock / …
--   promo_details    — real promotion facts (discount, code, min spend, window, timezone)
--   email_length     — selectable length used for generation
--   tone             — selectable tone used for generation
-- Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

alter table public.email_assets
  add column if not exists subject_options jsonb,
  add column if not exists campaign_type   text,
  add column if not exists promo_details   jsonb,
  add column if not exists email_length    text,
  add column if not exists tone            text;
