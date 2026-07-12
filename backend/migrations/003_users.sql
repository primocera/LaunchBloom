-- Prompt 8: email/password accounts. The HMAC session (lib/auth.js) stays the
-- session mechanism; this table adds the password credential check at login.
-- Run in the Supabase SQL editor.

create table if not exists public.users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  password_hash  text not null, -- scrypt: salt:hash (hex)
  created_at     timestamptz not null default now()
);

create index if not exists users_email_idx on public.users (email);

alter table public.users enable row level security;
