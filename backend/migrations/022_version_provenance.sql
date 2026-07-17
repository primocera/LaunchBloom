-- ---------------------------------------------------------------------------
-- Migration 022 — Version provenance (v5 Prompt 13)
--
-- Records who/what produced each asset_versions snapshot so history is
-- traceable: source (edit | rewrite | restore | delete | generation) and the
-- author's email. The brief snapshot already lives inside the row snapshot.
-- Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

alter table public.asset_versions
  add column if not exists source       text,
  add column if not exists author_email text;
