-- Prompt 15: privacy-conscious product analytics ledger.
-- Never stores prompt text or generated content — only event names + small
-- non-content properties (plan, feature, interval, error codes, etc).

create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  user_id uuid,
  workspace_id uuid,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_event_idx on analytics_events (event, created_at desc);
create index if not exists analytics_events_user_idx on analytics_events (user_id, created_at desc);
