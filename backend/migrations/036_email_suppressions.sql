-- v10 SC-06: unsubscribe / suppression for OPTIONAL email.
--
-- Additive only: one new table, one new nullable column. Nothing is backfilled
-- and no existing row changes meaning, so this is safe to leave in place if the
-- application code is rolled back.
--
-- The distinction this encodes matters legally and practically:
--   transactional — billing, security and account records. A paying customer
--                   must receive these; they are not marketing and carry no
--                   unsubscribe link. Suppression does NOT apply.
--   marketing     — optional nudges and product news. Always suppressible, and
--                   every one carries a one-click unsubscribe.
--
-- Suppression is keyed on the email address rather than an account, because a
-- person who unsubscribes must stay unsubscribed even if they later delete and
-- recreate an account.

create table if not exists email_suppressions (
  email text primary key,
  -- unsubscribed | bounced | complained | manual
  reason text not null default 'unsubscribed',
  -- Which message prompted it, for support questions. Template key only —
  -- never subject lines, body copy or any customer content.
  source_template text,
  created_at timestamptz not null default now()
);

create index if not exists email_suppressions_created_idx on email_suppressions (created_at desc);

-- Records the category a message was sent under, so the ledger can prove a
-- transactional email was never gated by a marketing preference.
alter table email_events add column if not exists category text;

-- 'suppressed' joins pending | sent | failed | skipped as a terminal state:
-- the message was correctly not sent, which is distinct from failing to send.
comment on column email_events.status is
  'pending | sent | failed | skipped | suppressed';
