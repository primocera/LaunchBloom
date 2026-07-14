-- ---------------------------------------------------------------------------
-- Migration 008 — Legal consent log (audit Prompt 14)
--
-- Records that a user accepted the current Terms + Privacy at signup: who,
-- which version, when, and (where lawful) the source IP. Auditable proof of
-- consent. Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

create table if not exists public.legal_consents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,
  email        text,
  terms_version text not null,
  accepted_at  timestamptz not null default now(),
  ip           text
);

create index if not exists legal_consents_email_idx on public.legal_consents (email);

alter table public.legal_consents enable row level security;
