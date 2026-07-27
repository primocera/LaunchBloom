-- ---------------------------------------------------------------------------
-- Migration 037 — capped-beta feedback (v11 SC-07)
--
-- Two moments, asked once each per workspace: after the first handoff, and
-- after a cancel or refund. The point of the beta is to learn whether the
-- campaign-control loop reduces real rework and produces something worth
-- paying for — feature requests are not that evidence.
--
-- Privacy shape, deliberately:
--   * the bounded CATEGORY columns are what analytics ever sees;
--   * `notes` is optional free text that lives ONLY in this table. It is never
--     copied into analytics_events, never into an event property, and never
--     into a log line. Free text is where a user writes a client's name.
--
-- Run in the Supabase SQL editor. Safe to run once.
-- ---------------------------------------------------------------------------

create table if not exists public.beta_feedback (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_email    text not null,
  -- 'handoff' (after the first export) | 'cancel' (after cancel or refund)
  moment        text not null,
  -- bounded categories, validated server-side against ALLOWED in
  -- backend/routes/feedback.js; the check constraint is the second line of
  -- defence, not the first.
  job_done      text,
  manual_work   text,
  price_view    text,
  -- optional, never analysed in aggregate, never leaves this table
  notes         text,
  created_at    timestamptz not null default now(),

  constraint beta_feedback_moment_chk check (moment in ('handoff', 'cancel')),
  constraint beta_feedback_job_chk check (
    job_done is null or job_done in ('full_campaign', 'part_of_campaign', 'single_asset', 'nothing_usable')
  ),
  constraint beta_feedback_manual_chk check (
    manual_work is null or manual_work in ('almost_none', 'light_editing', 'heavy_editing', 'rewrote_most')
  ),
  constraint beta_feedback_price_chk check (
    price_view is null or price_view in ('worth_more', 'about_right', 'too_high', 'would_not_pay')
  ),
  constraint beta_feedback_notes_len check (notes is null or char_length(notes) <= 2000)
);

-- One answer per workspace per moment: a second prompt for the same moment is
-- nagging, and a second row would double-count the cohort denominator.
create unique index if not exists beta_feedback_once_idx
  on public.beta_feedback (workspace_id, moment);

create index if not exists beta_feedback_created_idx on public.beta_feedback (created_at);

alter table public.beta_feedback enable row level security;
