-- ---------------------------------------------------------------------------
-- Opt-in marker for the authenticated E2E seeding endpoint.
--
-- NOT a numbered migration. Do NOT run this against production. It exists in
-- exactly one place: the database you are willing to have seeded and wiped.
--
-- Why a table instead of an environment variable: every other guard on the seed
-- endpoint (E2E_SEED_ENABLED, E2E_SEED_SECRET, launch mode) describes the
-- PROCESS. None of them describes the DATABASE. A local test run with
-- SUPABASE_URL pointed at production passes all of them, because NODE_ENV is
-- not production and the Stripe key is blank — so "it cannot hit production by
-- accident" was not true until this file existed.
--
-- A marker row lives in the target database itself, so pointing the harness at
-- the wrong project fails closed no matter how the environment is configured,
-- and the mistake cannot be made by exporting one wrong variable.
--
-- If you ever run this against production by mistake: drop the table
-- immediately (`drop table public.e2e_seed_marker;`). It holds no data and is
-- referenced by nothing else.
-- ---------------------------------------------------------------------------

create table if not exists public.e2e_seed_marker (
  id            boolean primary key default true,
  note          text not null,
  created_at    timestamptz not null default now(),
  constraint e2e_seed_marker_single check (id)
);

insert into public.e2e_seed_marker (id, note)
values (true, 'This database may be seeded and wiped by the authenticated E2E suite. It is NOT production.')
on conflict (id) do nothing;

alter table public.e2e_seed_marker enable row level security;
