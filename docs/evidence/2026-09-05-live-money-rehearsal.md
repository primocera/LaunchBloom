# Live-money rehearsal — 2026-09-05 (continuation of 2026-08-02)

Owner-executed live billing evidence against **real (live) Stripe**, extending
`docs/evidence/2026-08-02-live-money-rehearsal.md`. The owner performed every live
charge/refund/replay; Claude only recorded the attested Stripe evidence. Opaque
IDs only (no card data, no customer text). Run against current production with
`STRIPE_OWNERSHIP_ENFORCED=1` (readiness `ownership.state=enforcement_active`).

Subscription under test: `sub_1TzxNX0YzvSNMCpNAlIaa0ts` (Starter, €11.31/mo,
owner's own test account). Enforcement was active throughout.

> NOTE: an earlier draft of this file (written mid-session, before E/F/G were run)
> listed E/F/G as "pending (test-mode)". That was stale. **All of E/F/G were then
> run in REAL LIVE Stripe** and are corrected below. This file now matches the
> machine record `docs/evidence/2026-09-05-rehearsal-record.json` (which passes
> `npm run rehearsal:validate`).

## Ordered recovery sequence (steps A–H) — ALL LIVE

| Step | Transition | Status | Evidence / observed state (all live) |
|---|---|---|---|
| A | Start eligible trial | ✅ live_rehearsed | subscription `sub_1TzxNX0YzvSNMCpNAlIaa0ts` |
| B | Trial converts to paid (charge) | ✅ live_rehearsed | payment intent `pi_3TzxNY0YzvSNMCpN1NthVGd1`, €11.31 **Succeeded**; app showed **Starter active** |
| C | Cancel at period end | ✅ live_rehearsed | `evt_1UC6Zf0YzvSNMCpNBoqhqR9F` (cancel_at_period_end=true); app showed **"Cancels Oct 2"** — access retained |
| D | Reactivate (undo cancel) — in-app | ✅ live_rehearsed | `evt_1UC6cp0YzvSNMCpNljGMQ3g4` (cancel_at_period_end=false); app → **"next billing Oct 2"**, access continued |
| E | Force failed payment (→ past_due) | ✅ **live_rehearsed** | `evt_1UC7c70YzvSNMCpN5fquoJCO` (subscription → **past_due**). Forced via a real `stripe.subscriptions.update(billing_cycle_anchor=now, payment_behavior=allow_incomplete)` on the LIVE key; the card **declined** (owner had disabled NLB online payments). **Entitlement withheld — proven live:** a signed-in generation attempt was **BLOCKED** while past_due. Failed invoice `in_1UC7c40YzvSNMCpNuqGVzEEN` (€0.96). |
| F | Recover (pay open invoice → active) | ✅ **live_rehearsed** | `evt_1UC7wS0YzvSNMCpN9H0IoKjb` (subscription → **active**). Owner re-enabled online payments and paid the open €0.96 invoice `in_1UC7c40YzvSNMCpNuqGVzEEN`; app showed **Starter active** again. |
| G | Late `payment_failed` replay (created before F) | ✅ **live_rehearsed** | `evt_1UC7c70YzvSNMCpNIVSobB4p` (the pre-recovery `invoice.payment_failed`) **resent** from the Stripe events log; subscription **stayed active** (the out-of-order guard held) — the late failure did **not** revoke access. |
| H | Refund last charge — entitlement unchanged | ✅ live_rehearsed | refund `re_3UBD6L0YzvSNMCpN0vM9Dkc4` (€11.31); app **still showed "Starter is active"** — refund did NOT remove access |

## Result

- **All eight rows A–H are `live_rehearsed` in real Stripe.** All five
  `live_required` rows (B, E, F, G, H) are satisfied by live evidence — **not**
  test mode. The machine record `docs/evidence/2026-09-05-rehearsal-record.json`
  carries a distinct opaque id per row and passes `npm run rehearsal:validate`
  (`liveRehearsalCompleteness` = complete).
- Key live proofs: E drove the subscription to **past_due** and the app
  **withheld access** (a signed-in generate was blocked); F restored it on
  payment; G resent a stale `payment_failed` and the subscription **stayed active**
  (out-of-order guard); H refunded and entitlement was **unchanged**. No duplicate
  customer, no double charge, no wrong downgrade.
- With the rehearsal complete, the manifest is now set to **official full GO**:
  owner_evidence `live_money_rehearsal` → `observed`, blocker
  `P1-live-money-unrehearsed` → `closed`, and (owner decision) the router-RSC
  advisory `P1-router-rsc-csrf-advisory` → `closed`. `npm run launch:gate` then
  recomputes `public_paid` = **GO** (both `reasons` and `accepted_risks` empty).
  The candidate stays the certified, frozen `f8acb2a` — no product code moved
  since it (the only later commits are docs/evidence), and the authenticated
  matrix already ran green in CI at f8acb2a with a SHA-pinned artifact — so the
  GO is recorded against the same fully-checked candidate rather than relocating
  identical code to a new SHA.

## Wallet note — OWNER ACTIONS (updated 2026-09-21)

| Action | Status | Detail |
|---|---|---|
| Ordered post-G H (refund after G) | ✅ **DONE** | refund `re_3UBD6L…` confirmed in Stripe at **2026-09-05T16:11Z** (after G at 01:15Z); entitlement unchanged by the refund alone. The record's earlier `2026-09-04T23:36:28Z` was a data-entry error, corrected to this real Stripe time. |
| Cancel the test subscription | ✅ **DONE** | Stripe shows the subscription **scheduled to cancel Oct 5, 2026** (`cancel_at_period_end`), so it will not renew. |
| Refund the €0.96 recovery charge | owner-confirmed | invoice `in_1UC7c4…` — owner reported refunded in step 1. |

Recorded with **redacted** ids only — no email, card number or secret.

## Data-rights drill — OWNER-ONLY, PENDING (NOT RUN)

The live account **export** and a test-account **delete** (deletion receipt, and a
re-export returning no user data) have **not** been drilled live. These stay
**owner-only pending** — they are not marked completed anywhere — until the owner
runs them on a dedicated test account. If cancellation or delete fails, the UI must
not show a false success. See the owner checklist `docs/evidence/OWNER_CHECKLIST_v23.md`.
