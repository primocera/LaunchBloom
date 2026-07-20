-- v8 LB-S09: idempotency for server-confirmed funnel events.
-- Retries (webhook redelivery, client re-post, job re-run) must not double-count
-- once-per-account/campaign milestones. track({ dedupeKey }) writes this column;
-- a partial unique index makes a duplicate insert a no-op (ON CONFLICT DO NOTHING).
-- NULL dedupe_key (ordinary volume events) is unconstrained.

alter table analytics_events add column if not exists dedupe_key text;

create unique index if not exists analytics_events_dedupe_key_idx
  on analytics_events (dedupe_key)
  where dedupe_key is not null;
