# Evidence — unsubscribe suppression verified in production

**Item:** `owner_evidence.resend_suppression` (`docs/OWNER_EVIDENCE_V11.md` §B)
**Date (UTC):** 2026-07-28
**Verified by:** owner
**Environment:** production — live Resend, live Supabase
**Test address:** `mon.prim@gmail.com` (owner-controlled, not the admin account)

## Observed sequence

Read from `email_events` in the production database:

| Time (UTC) | `email_type` | `category` | `status` |
|---|---|---|---|
| 10:44:12 | `welcome` | marketing | **sent** — delivered, carried the unsubscribe footer |
| 10:45:06 | *(one-click unsubscribe)* | — | row written to `email_suppressions`, `reason = 'unsubscribed'` |
| 10:50:40 | `deletion_completed` | transactional | **sent** — delivered *after* the suppression existed |
| 10:51:29 | `welcome` | marketing | **suppressed** |

The two `welcome` rows are different accounts (`39004046…` then `548e4126…`),
so the second send was genuinely attempted rather than deduplicated away. That
is what makes the `suppressed` result meaningful: the message was built, the
consent gate was consulted, and it refused.

## What this proves

Both directions, which is the whole point of the test:

- **Marketing is blocked** after a withdrawal of consent, without a login and in
  one click, per `List-Unsubscribe-Post`.
- **Transactional still arrives.** `deletion_completed` was delivered 5 minutes
  *after* the suppression row existed. Suppressing everything would be a failure
  in the other direction — withholding a receipt or an account record from
  someone who is entitled to it.
- `suppressed` is recorded as its own terminal state, distinct from `failed`. A
  message correctly not sent is not a delivery failure, and the ledger says so.

It also confirms migration `036` is applied and functioning end to end: both the
`email_suppressions` table and the `email_events.category` column are in use.

## Prerequisite bug found and fixed during this test

This test could not have been run before today. Production `email_events`
contained no `welcome` row in its entire history — the only marketing email the
product sends had never been sent, so consent had never been exercised.

Cause: every signup consequence in `backend/routes/auth.js` was gated on
`type === 'signup'`, a query parameter that only exists on the `token_hash` link
form. Supabase's default template sends `{{ .ConfirmationURL }}` → `?code=…`
with no `type`, so a confirmed signup sent no welcome email, fired no `verified`
analytics event, and skipped Brand Profile onboarding. Fixed in `afa7749`;
verified here by the 10:44:12 row, the first `welcome` this product has sent.

## Limits of this evidence

- **One address, one provider, one round.** Not a test of Resend's own
  suppression list, bounce handling or complaint feedback loops.
- **Row 6 of §B was not performed** — nobody checked the Resend dashboard to
  confirm the suppressed send is recorded as suppressed rather than bounced.
  The application-side ledger is correct; the provider-side view is unverified.
- **`activation_nudge` is never triggered anywhere in the codebase**, so
  `welcome` is currently the only marketing email that exists. If a second one
  is added later, this evidence does not cover it — the consent gate is shared,
  but the classification in `CATEGORY` is per-template and an unclassified type
  defaults to marketing.
