# Owner-ready evidence template — ordered post-G refund (transition H)

> **Status: EMPTY / NOT RUN.** This is a blank owner supplement created by v23
> SV-23-04. Claude Code never performs a live charge, refund or cancellation — the
> owner runs it and records the result here. Until the fields below are filled with
> a genuine post-G refund, `public_paid` stays **CONDITIONAL GO** on the accepted
> `live-money` risk.

## Why this exists

The recorded rehearsal `docs/evidence/2026-09-05-rehearsal-record.json` exercised
all A–H transitions, but its H (refund) row is timestamped `2026-09-04T23:36:28Z`
— **before** E (`00:37`), F (`00:58`) and G (`01:15`) on 2026-09-05. H's
precondition is *"row F active with a real charge"*, so a refund observed before
the recovery is not the ordered post-G H the public_paid track requires. The
rehearsal validator (`npm run rehearsal:validate`) now fails that record as
unordered (H before G). The historical record is KEPT as evidence of the
individual steps; this file captures the missing **ordered** H.

## What the owner does (owner-only; not automated)

1. On the same live test subscription, after G (the late `payment_failed` replay)
   has been observed, **refund the last recovery charge** in Stripe.
2. Confirm the refund is `succeeded` in Stripe, and that **entitlement is
   unchanged by the refund alone** (still active unless separately cancelled).
3. Record the fields below. Use a **shortened / opaque** Stripe id (e.g.
   `re_…last4`). **Never** paste an email, card number, or any `sk_`/`whsec_`/`rk_`
   secret.

## Evidence to record (fill in)

| Field | Value |
|---|---|
| Refund id (redacted) | `re_…` |
| Charge refunded (redacted) | `ch_…` |
| Observed at (UTC, ISO-8601, **after G**) | `2026-__-__T__:__:__Z` |
| Refund status | `succeeded` / … |
| Entitlement after refund | `unchanged (active)` / … |
| Operator (owner) | Primoz Cerar |
| Candidate SHA | `<v23 candidate full sha>` |

## After recording

1. Update the **H** row in `docs/evidence/2026-09-05-rehearsal-record.json` (or a
   new dated record) so `observed_at_utc` is the real post-G time above and
   `evidence` is the redacted refund id. Do **not** invent a timestamp — use the
   real one.
2. Run `npm run rehearsal:validate -- <record.json> --candidate <full-sha>` — it
   must now pass (time-monotone A–H, `liveRehearsalCompleteness` complete).
3. In `docs/launch/launch-state.json`: set `owner_evidence` `live_money_rehearsal`
   `status` → `observed` (remove its `accepted_risk`), and close blocker
   `P1-live-money-unrehearsed`. Run `npm run launch:render` + `npm run launch:gate`
   — `public_paid` then computes **GO**.
