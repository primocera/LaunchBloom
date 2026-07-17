-- v5 Prompt 14: idempotent lifecycle-email ledger.
-- One row per logical email (dedupe_key). Webhook redeliveries and retries
-- can never send the same email twice; failed sends stay 'failed' and can be
-- retried by the admin tooling without re-sending succeeded ones.

create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,        -- e.g. 'trial_started:sub_123'
  email_type text not null,               -- trial_started | trial_ending | ...
  recipient text not null,
  status text not null default 'pending', -- pending | sent | failed | skipped
  provider_id text,                       -- Resend message id when sent
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists email_events_type_idx on email_events (email_type, status);
