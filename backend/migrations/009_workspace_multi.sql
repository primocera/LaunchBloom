-- ---------------------------------------------------------------------------
-- Migration 009 — Real multi-workspace support (audit Prompt 7)
--
-- Adds an `archived` flag so workspaces over a downgraded plan limit can be
-- kept (read-only) instead of deleted. Ownership is already keyed on user_id
-- (migration 005). Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

alter table public.workspaces
  add column if not exists archived boolean not null default false;

create index if not exists workspaces_user_active_idx
  on public.workspaces (user_id, archived);
