-- ---------------------------------------------------------------------------
-- Migration 034 — v9 SC-04: acknowledgment audit trail for the Review workbench.
--
-- Additive only. The unified Review workbench must show an audit trail for each
-- explicit human decision ("Acknowledged by you", when, by whom). We already
-- store note_category on consistency_findings; this adds who and when so the
-- handoff record can attribute the acknowledgment. Snapshot-keep decisions
-- already carry reviewer + reviewed_at in asset_brief_reviews (migration 030),
-- so no change is needed there.
--
-- No data is rewritten and no existing finding is affected. Run once in the
-- Supabase SQL editor.
-- ---------------------------------------------------------------------------

alter table public.consistency_findings
  add column if not exists acknowledged_by  text,
  add column if not exists acknowledged_at  timestamptz;
