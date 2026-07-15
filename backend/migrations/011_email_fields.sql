-- ---------------------------------------------------------------------------
-- Migration 011 — Email blueprint fields (audit Prompt 11)
--
-- Adds the per-email fields the rebuilt Email Studio produces: the email's
-- objective, an optional secondary CTA, personalization tokens and segment
-- exclusions. Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

alter table public.email_assets
  add column if not exists objective text,
  add column if not exists secondary_cta text,
  add column if not exists personalization_tokens jsonb,
  add column if not exists exclusions text;
