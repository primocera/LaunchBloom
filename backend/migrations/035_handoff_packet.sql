-- ---------------------------------------------------------------------------
-- Migration 035 — v9 SC-07: handoff packet staleness tracking.
--
-- Additive only. When a user exports a handoff packet we record the packet's
-- deterministic fingerprint and time on the campaign, so a later material brief
-- or asset change can surface "Handoff packet is older than current campaign"
-- WITHOUT deleting the download they already have. The packet itself is always
-- composed server-side from canonical state — these columns only remember what
-- was last exported. No content is stored here, only a hash and a timestamp.
--
-- Run once in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

alter table public.campaigns
  add column if not exists last_handoff_fingerprint  text,
  add column if not exists last_handoff_at           timestamptz,
  add column if not exists last_handoff_format        text;
