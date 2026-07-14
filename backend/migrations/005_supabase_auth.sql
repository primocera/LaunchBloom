-- ---------------------------------------------------------------------------
-- Migration 005 — Supabase Auth (audit Prompt 3)
--
-- Moves identity from the custom scrypt `users` table + HMAC tokens to Supabase
-- Auth (auth.users). Workspace ownership is re-keyed onto the stable auth user
-- UUID so a later email change cannot orphan data. Safe to run once; the
-- backfill/adopt statements are idempotent.
--
-- Run in the Supabase SQL editor.
-- ---------------------------------------------------------------------------

-- 1. Stable owner id on workspaces (nullable during transition; user_email kept
--    for display + legacy fallback). References Supabase's auth.users.
alter table public.workspaces
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

create index if not exists workspaces_user_id_idx on public.workspaces (user_id);

-- 2. Backfill: adopt any legacy workspace to the auth user with the same email.
--    Only fills rows that don't already have an owner id. Re-runnable.
update public.workspaces w
set user_id = u.id
from auth.users u
where w.user_id is null
  and lower(u.email) = lower(w.user_email);

-- ---------------------------------------------------------------------------
-- FORCED-RESET MIGRATION FOR EXISTING USERS
--
-- scrypt hashes in the old public.users table CANNOT be imported into Supabase
-- Auth. Existing customers must set a new password via the reset flow:
--
--   1. In the Supabase dashboard enable Email auth and (recommended) require
--      email confirmation.
--   2. For each legacy email in public.users, create a corresponding auth user
--      (Dashboard → Authentication → Add user, "auto-confirm" OFF) OR send them
--      an invite. A scripted path:
--        - insert rows via the Admin API (auth.admin.createUser) with a random
--          password, email_confirm=false, then trigger resetPasswordForEmail.
--   3. Users click the reset link, set a password, and are logged in. Their
--      workspace is adopted automatically on first authenticated request
--      (ensureWorkspace backfills user_id from user_email — see step 2 above,
--      which also runs on demand in code).
--
-- The old public.users table is now DEPRECATED (kept read-only for reference /
-- audit). Do NOT drop it until every active account has completed a reset.
-- ---------------------------------------------------------------------------

comment on table public.users is
  'DEPRECATED after migration 005 — identity is now Supabase Auth (auth.users). Kept for reference during the forced-reset transition; do not write new rows.';
