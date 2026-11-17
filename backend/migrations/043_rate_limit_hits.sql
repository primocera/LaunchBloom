-- ---------------------------------------------------------------------------
-- Migration 043 — shared counters for the sign-in and email rate limits
-- (audit S1, 2026-11-15)
--
-- The login, signup and email-send limiters used express-rate-limit's
-- in-memory store. On Vercel every instance has its own counters and they
-- reset on a cold start, so "20 attempts per 15 minutes" was really "20 per
-- warm instance". Because auth is proxied through the backend, Supabase's own
-- per-IP limits see Vercel's addresses and are no backstop either.
--
-- This adds one fixed-window counter per key, incremented atomically by
-- rate_limit_hit(). Keys are SHA-256 hashes computed by the backend
-- (backend/lib/rate-limit-store.js), so no email address or IP is stored.
--
-- Until this is applied the backend keeps using the per-instance memory
-- store (it detects the missing function), so applying it is the only step.
--
-- Additive and safe to re-run. RLS on, no policies: only the service_role
-- backend touches it. EXECUTE is revoked from anon/authenticated so nobody can
-- run up another person's counter through the REST API.
--
-- Rollback: drop function if exists public.rate_limit_hit(text, integer);
--           drop table if exists public.rate_limit_hits;
--
-- Verify afterwards:
--   select to_regclass('public.rate_limit_hits') is not null
--      and exists (select 1 from pg_proc where proname = 'rate_limit_hit');
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limit_hits (
  key       text primary key,          -- sha256 hex of limiter name + client key
  hits      integer not null default 0,
  reset_at  timestamptz not null
);

alter table public.rate_limit_hits enable row level security;

create index if not exists rate_limit_hits_reset_at_idx on public.rate_limit_hits (reset_at);

-- Count one hit for p_key in a fixed window of p_window_ms. A window that has
-- ended starts again at 1. Returns the hit count and when the window resets.
create or replace function public.rate_limit_hit(p_key text, p_window_ms integer)
returns table (hits integer, reset_at timestamptz)
language sql
security definer
set search_path = public
as $$
  insert into rate_limit_hits as r (key, hits, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_ms / 1000.0))
  on conflict (key) do update
    set hits = case when r.reset_at <= now() then 1 else r.hits + 1 end,
        reset_at = case when r.reset_at <= now()
                        then now() + make_interval(secs => p_window_ms / 1000.0)
                        else r.reset_at end
  returning r.hits, r.reset_at;
$$;

revoke execute on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer) to service_role;
