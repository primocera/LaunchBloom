-- ---------------------------------------------------------------------------
-- Migration 023 — Admin audit log (v5 Prompt 18)
--
-- Every admin/support view access is recorded here. Admin endpoints are
-- read-only; any future recovery action must be a separate, explicitly audited
-- endpoint. Stores who looked, what they looked at, and when — never customer
-- content.
-- Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_audit (
  id          uuid primary key default gen_random_uuid(),
  admin_email text not null,
  action      text not null,       -- e.g. user_lookup, failed_generations, scorecard
  target      text,                -- the email/id inspected, if any
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_created_at_idx on public.admin_audit (created_at desc);
