# Lifecycle email — the canonical map (v10 SC-06)

Every message Scalvya can send, what triggers it, how it is deduplicated, and
whether it can be unsubscribed from. **A message not in this table does not
exist**: adding a template without adding a row here means it has no defined
trigger, and templates with no real trigger were deliberately not built.

## Categories

| Category | Meaning | Suppressible | Footer |
|---|---|---|---|
| **transactional** | Billing, access and account records. A paying customer is entitled to these. | **No** | States why it was sent and that it is not optional |
| **marketing** | Optional nudges and product news. | **Yes** | One-click unsubscribe |

Both directions of this are failures. Gating a transactional message on a
marketing preference silently withholds a receipt or a charge notice from
someone who paid. Failing to gate a marketing message ignores a withdrawal of
consent. `backend/tests/email-consent.test.js` asserts both.

An unclassified template defaults to **marketing** — the safe direction, since
the worst case is a missed nudge rather than an ignored opt-out.

## The map

| State change | Trigger | Template | Category | Dedupe key | Retry |
|---|---|---|---|---|---|
| Account verified | signup verification | `welcome` | marketing | `welcome:{userId}` | outbox |
| Setup step outstanding | server-derived missing step | `activation_nudge` | marketing | `activation_nudge:{workspaceId}:{step}` | outbox |
| Trial begins | `customer.subscription.created` (trialing) | `trial_started` | transactional | `trial_started:{subId}` | outbox |
| Trial about to convert | `customer.subscription.trial_will_end` | `trial_ending` | transactional | `trial_ending:{subId}` | outbox |
| Invoice paid (routine) | `invoice.paid`, total > 0 | `payment_succeeded` | transactional | `payment_succeeded:{invoiceId}` | outbox |
| Invoice paid **after** past_due | `invoice.paid` where prior status was `past_due` | `payment_recovered` | transactional | `payment_recovered:{invoiceId}` | outbox |
| Payment fails | `invoice.payment_failed` | `payment_failed` | transactional | `payment_failed:{invoiceId}` | outbox |
| Cancel scheduled | `cancel_at_period_end` false → true | `cancellation_scheduled` | transactional | `cancellation_scheduled:{subId}:{periodEnd}` | outbox |
| Subscription ends | `customer.subscription.deleted` | `cancellation_completed` | transactional | `cancellation_completed:{subId}` | outbox |
| Plan changes | price id changes on update | `plan_changed` | transactional | `plan_changed:{subId}:{priceId}` | outbox |
| Account deleted | deletion job completes | `deletion_completed` | transactional | `deletion_completed:{userId}` | outbox |

### Why the dedupe keys look like that

Each key is the **state that justifies the message**, not a timestamp. A
redelivered or replayed webhook produces the same key and the unique constraint
on `email_events.dedupe_key` makes the second send a no-op. `cancellation_
scheduled` includes the period end because rescheduling to a genuinely
different date is a genuinely different message.

### Retry and dead-letter

All sends go through the existing outbox (`processEmailOutbox`): exponential
backoff from `EMAIL_RETRY_BASE_MS`, `EMAIL_MAX_ATTEMPTS` (default 5), then
dead-letter, replayable from the admin route. Delivery never blocks billing —
a failed send marks the row and returns; the webhook still completes.

### Statuses

`pending` → `sent` · `failed` (retryable) · `skipped` (no `RESEND_API_KEY`) ·
`suppressed` (correctly not sent — distinct from failing to send).

## What is deliberately NOT sent

- **No "you haven't logged in" re-engagement.** There is no threshold that
  distinguishes a lapsed user from a busy one, so any such message would be a
  guess dressed as a service.
- **No campaign or asset content in any email.** Emails carry state and dates.
  Logs and analytics store the template key, state, provider id and category —
  never subject lines, body copy or customer content.
- **No usage or performance claims.** Nothing in these templates asserts a
  result, a benchmark or a comparison.

## Unsubscribe

`GET /api/email/unsubscribe?token=…` — public and unauthenticated by design.
The link is clicked from a mail client, often on a device that has never signed
in; requiring a login to stop receiving email is a dark pattern. Safety comes
from the HMAC-signed token, which names the address it applies to, so it cannot
be guessed or transferred to another address.

`GET /api/email/resubscribe?token=…` reverses it with the same token.

Suppression is keyed on the **address**, not the account, so someone who
unsubscribes stays unsubscribed even if they later delete and recreate an
account.

## Owner-run Resend rehearsal

Claude Code cannot send live email. These steps are owner-operated; record
anonymised evidence (message ids, timestamps — never recipient content).

| # | Step | Expected | Evidence | Done |
|---|---|---|---|---|
| 1 | Apply migration `036_email_suppressions.sql` | table + column exist | | ☐ |
| 2 | Verify sender domain in Resend (SPF/DKIM) | domain verified | | ☐ |
| 3 | Trigger a trial start on a test account | `trial_started` arrives, exact charge date + timezone | | ☐ |
| 4 | Click unsubscribe in an optional email | confirmation page names the address | | ☐ |
| 5 | Trigger `activation_nudge` for that address | **not** sent; ledger row `suppressed` | | ☐ |
| 6 | Trigger a billing message for that address | **still delivered** | | ☐ |
| 7 | Re-subscribe via the link | optional email resumes | | ☐ |
| 8 | Replay a Stripe webhook | no duplicate email | | ☐ |
| 9 | Force a send failure (bad key) | row `failed`, retried, dead-lettered after max attempts | | ☐ |
| 10 | Inspect logs | no subject lines, body copy or customer content | | ☐ |

Step 6 is the one to be strict about: if a billing message is ever withheld
because of a marketing opt-out, stop and fix it before launch.
