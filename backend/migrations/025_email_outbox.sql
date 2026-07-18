-- 025: Real lifecycle-email outbox (playbook v6, Prompt 6).
-- Turns email_events from a failure log into a retryable outbox: attempts,
-- backoff schedule, lease-based claiming so two workers can't double-send,
-- and a dead_letter terminal state that operators can replay.

alter table email_events add column if not exists attempts integer not null default 0;
alter table email_events add column if not exists next_attempt_at timestamptz;
alter table email_events add column if not exists locked_until timestamptz;
alter table email_events add column if not exists payload jsonb; -- template params only (dates, plan label) — never generated content
-- status now also allows: 'sending' (claimed by a worker) and 'dead_letter'.

create index if not exists email_events_due_idx
  on email_events (next_attempt_at)
  where status in ('pending', 'failed');

-- Atomically claim up to p_limit due rows for one worker. FOR UPDATE SKIP
-- LOCKED means concurrent workers never claim the same row; the lease
-- (locked_until) recovers rows from a worker that died mid-send.
create or replace function claim_email_outbox(p_limit integer, p_lease_seconds integer)
returns setof email_events
language sql
security definer
set search_path = public
as $$
  update email_events e
     set status = 'sending',
         locked_until = now() + make_interval(secs => p_lease_seconds)
   where e.id in (
     select id from email_events
      where (
              (status in ('pending', 'failed') and (next_attempt_at is null or next_attempt_at <= now()))
           or (status = 'sending' and locked_until < now())  -- expired lease
            )
      order by created_at
      limit p_limit
      for update skip locked
   )
  returning e.*;
$$;
