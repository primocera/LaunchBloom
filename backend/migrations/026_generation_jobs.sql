-- 026: Generation idempotency jobs (playbook v6, Prompt 11).
-- One row per client generation intent (Idempotency-Key header). A repeated
-- key returns the stored result instead of re-running the provider call, so
-- double clicks, network retries and timed-out clients can't duplicate
-- assets or charges.

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  idempotency_key text not null,
  route text not null,
  status text not null default 'in_flight',  -- in_flight | succeeded | failed
  http_status integer,
  result jsonb,                              -- stored response body for replays
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table generation_jobs enable row level security; -- service_role only

create index if not exists generation_jobs_status_idx
  on generation_jobs (status, created_at);
