# Runbook — Paid Transaction Rehearsal (owner-operated)

> ✅ **STATUS: COMPLETED 2026-09-05.** The owner executed the full eight-transition
> ordered recovery sequence (steps A–H) against real live Stripe under enforcement
> (`STRIPE_OWNERSHIP_ENFORCED=1`, readiness `ownership.state=enforcement_active`),
> including E (past_due), F (recovery), G (late `payment_failed` after recovery,
> out-of-order) and H (refund leaves entitlement unchanged). Anonymized evidence:
> `docs/evidence/2026-09-05-rehearsal-record.json` (validator: complete for
> public_paid) and `docs/evidence/2026-09-05-live-money-rehearsal.md`. This closed
> blocker `P1-live-money-unrehearsed` and moved `live_money_rehearsal` to
> `observed`; with the router-RSC advisory also closed, `public_paid` is **full GO**
> (see `docs/launch/launch-state.json`). The procedure below is retained for
> re-runs and future candidates.

**Purpose:** prove, on a frozen commit, that every real money path works before
expanding acquisition. Automated release checks (`npm run check`,
`npm run release:evidence`, `GET /api/admin/readiness`) are necessary but **not a
GO**. This rehearsal is the GO.

> ⚠️ Claude Code must not run any step that mutates live Stripe, Supabase,
> Vercel, Resend, DNS or cron. Every step below is **owner-operated** with
> explicit authorization. Refunds and destructive actions are never automated.

## Freeze

- Frozen commit SHA: `993ac5e` (shipping candidate; byte-identical product tree to prior candidate f8acb2a)
- `/api/admin/readiness` `ready: true`, `blockers: 0`: ✅ confirmed in production 2026-08-29 (`mode=production`, `ownership.state=enforcement_active`)

### Production config gate — owner-run (v10 SC-00)

This project deliberately keeps **no secret-bearing CI job**, so the production
configuration gate is run by the owner against the production environment and
its output pasted here. CI proves the *code*; this proves the *configuration*.

```bash
# In a shell carrying the PRODUCTION env (never commit the output verbatim —
# it is presence-only by design, but treat it as operational data).
node backend/scripts/release-check.js --evidence
```

- Result (`ready` / blocker list): ✅ `ready=true`, blockers=0, all 14 config checks ok, `ownership.state=enforcement_active`
- Run at (UTC): 2026-08-29  ·  Against commit: production deploy (byte-identical to candidate 993ac5e)
- Status word for this run: **`rehearsed live`** (owner ran the live A–H money path against production).

## Journeys to rehearse (record anonymized IDs only — never card data)

Record the UTC timestamp of the *observed system state*, not of the Stripe
action — an out-of-order delivery is only proven by the gap between them.

Filled from the completed 2026-09-05 live A–H run (opaque ids mirror
`docs/evidence/2026-09-05-rehearsal-record.json`). Owner = Primoz Cerar. Only the
journeys exercised in the live money-path run are listed; the numbers are the
original catalog ids (so "Journey 13" below still refers to the same row).

| # | Journey | Expected system state | Evidence (event/entitlement/receipt ID) | Observed at (UTC) | Owner | Result |
|---|---------|----------------------|------------------------------------------|-------------------|-------|--------|
| 1 | Eligible 3-day trial starts | `trialing`, entitlement = trial limits | `sub_1TzxNX0YzvSNMCpNAlIaa0ts` (step A) | 2026-08-02 | Primoz | ☑ |
| 2 | Prior-trial user pays today | charged today, no second trial | `pi_3TzxNY0YzvSNMCpN1NthVGd1` (step B); email-change guard 409 `ALREADY_SUBSCRIBED` | 2026-08-02 | Primoz | ☑ |
| 4 | Delayed webhook (out of order) | reconciles to correct plan | `evt_1UC7c70YzvSNMCpNIVSobB4p` (step G, late `payment_failed` replay) | 2026-09-05T01:15Z | Primoz | ☑ |
| 5 | Active subscription | plan entitlement active | `pi_3TzxNY0YzvSNMCpN1NthVGd1` (step B, Starter active) | 2026-08-02 | Primoz | ☑ |
| 6 | Cancel at period end | access until period end, then downgrade | `evt_1UC6Zf0YzvSNMCpNBoqhqR9F` (step C, "Cancels Oct 2") | 2026-09-04T23:31Z | Primoz | ☑ |
| 8 | Payment failed | dunning state, entitlement held per policy | `evt_1UC7c70YzvSNMCpN5fquoJCO` (step E, past_due; signed-in generate BLOCKED) | 2026-09-05T00:37Z | Primoz | ☑ |
| 9 | Recovery / reactivate | entitlement restored, no double charge | `evt_1UC7wS0YzvSNMCpN9H0IoKjb` (step F) + `evt_1UC6cp0YzvSNMCpNljGMQ3g4` (step D reactivate) | 2026-09-05T00:58Z | Primoz | ☑ |
| 11 | Refund / support (manual) | owner-authorized, receipt recorded | `re_3UBD6L0YzvSNMCpN0vM9Dkc4` (step H, €11.31; entitlement unchanged) | 2026-09-04T23:36Z | Primoz | ☑ |
| 12 | Duplicate webhook event | idempotent, no double entitlement/charge | out-of-order replay at step G left one row active; no duplicate customer/charge observed; ledger `stripe_events` + `backend/tests/webhook-isolation.test.js` | 2026-09-05T01:15Z | Primoz | ☑ |
| 13 | Late `payment_failed` after recovery | stays `active` — entitlement **not** revoked | `evt_1UC7c70YzvSNMCpNIVSobB4p` (step G, stayed active, out-of-order guard held) | 2026-09-05T01:15Z | Primoz | ☑ |

Journey 13 is the v10 SC-00 regression: replay a `invoice.payment_failed` whose
`created` predates the recovery `invoice.paid` (Stripe CLI
`stripe events resend <evt_id>`). Covered locally by
`backend/tests/webhook-ordering.test.js`; this row is the live confirmation.

## SC-V12-04 · Ordered recovery sequence — the canonical live-money rehearsal (run as one continuous rehearsal)

> **This eight-transition ordered sequence (steps A–H) is the canonical
> live-money rehearsal** the launch state (`docs/launch/launch-state.json`,
> owner-evidence `live_money_rehearsal`) refers to. The 13-row journey catalog
> above is the broader set of paths to spot-check; the eight lettered steps are
> the money-path rehearsal that gates `public_paid`, and the late
> `payment_failed`-after-recovery regression is **step G** (the 7th step).

Run these transitions **in order on a single subscription**, using a real
low-value Scalvya plan, only after the owner deliberately starts the run. Record
the observed app entitlement (`/api/admin/readiness` and a signed-in check of
`planFor`) and the lifecycle email for each. **$ = costs real money; C = requires
explicit owner confirmation before proceeding.** Never put secrets, full customer
identifiers or card data in evidence.

**RUN COMPLETED 2026-09-05** — one continuous run on `sub_1TzxNX0YzvSNMCpNAlIaa0ts`
(Starter €11.31/mo, owner test account) against live Stripe, enforcement active.
All eight rows `live_rehearsed`; every live_required row (B, E, F, G, H) carries a
distinct opaque id (mirrors `docs/evidence/2026-09-05-rehearsal-record.json`).

| Step | Action | Cost/Confirm | Expected Stripe state | Expected app entitlement | Expected email | Evidence (opaque id) · observed |
|---|---|---|---|---|---|---|
| A | Start eligible trial | C | `trialing` | `trial` limits | `trial_started` | ✅ `sub_1TzxNX0YzvSNMCpNAlIaa0ts` · trial→active |
| B | Trial converts to paid | $ | `active` | mapped plan | `payment_succeeded` | ✅ `pi_3TzxNY0YzvSNMCpN1NthVGd1` · Starter active |
| C | Cancel at period end | C | `active`, `cancel_at_period_end=true` | plan held to period end | `cancellation_scheduled` | ✅ `evt_1UC6Zf0YzvSNMCpNBoqhqR9F` · "Cancels Oct 2", access kept |
| D | Reactivate (undo cancel) | C | `active`, `cancel_at_period_end=false` | plan continues | (none required) | ✅ `evt_1UC6cp0YzvSNMCpNljGMQ3g4` · next billing Oct 2, access continued |
| E | Force a failed payment | $ | `past_due` | **entitlement withheld** | `payment_failed` | ✅ `evt_1UC7c70YzvSNMCpN5fquoJCO` · signed-in generate BLOCKED while past_due |
| F | Recover (pay open invoice) | $ | `active` | plan restored | `payment_recovered` | ✅ `evt_1UC7wS0YzvSNMCpN9H0IoKjb` · Starter active again |
| G | Replay a LATE `payment_failed` (created before F) | C | **stays `active`** | **entitlement NOT revoked** | (none) | ✅ `evt_1UC7c70YzvSNMCpNIVSobB4p` · stayed active (out-of-order guard held) |
| H | Refund the last charge | $, C | `active` unless you also cancel | unchanged by the refund alone | (none) | ✅ `re_3UBD6L0YzvSNMCpN0vM9Dkc4` · €11.31 refunded, "Starter is active" unchanged |

**Abort conditions — stop the run and follow Rollback below if:**
- entitlement is granted while `past_due` (step E), or withheld while `active`;
- step G flips the subscription back to `past_due` (the regression);
- any step sends a duplicate email or double-charges;
- `/api/admin/readiness` shows `webhook_failures_24h > 0` attributable to the run.

**What proves G:** the operator log shows a
`ops-signal {"signal":"reconciliation_correction",…"reason":"stale_out_of_order_skipped"}`
line for the late event and the row stays `active`. Covered locally by
`backend/tests/webhook-ordering.test.js` and `webhook-lifecycle.test.js`; this
sequence is the live confirmation. Refunds and disputes are acknowledged but
change no entitlement on their own (`backend/tests/webhook-lifecycle.test.js`).

## Recording the rehearsal (SC-04 schema)

Record the run as a machine-checkable JSON file, copying
`docs/evidence/rehearsal-record.template.json`. Each of the eight rows (A–H)
takes a `status` (`not_run` · `blocked` · `failed` · `test_mode_rehearsed` ·
`live_rehearsed`), an **opaque** `evidence` id (a Stripe event/subscription/
invoice/charge id — **never** an email, card number, webhook secret or customer
text) and the `observed_at_utc` of the system state. Then validate it:

```bash
npm run rehearsal:validate -- docs/evidence/<your-file>.json --candidate <sha>
```

The validator (`backend/lib/rehearsal.js`) rejects a candidate mismatch, a
missing/duplicate row, a rehearsed row with no observation, **reused** evidence,
any PII/secret in evidence, and a **live_required** row (B, E, F, G, H)
satisfied only in test mode. A `test_mode_rehearsed` proof never satisfies a
live row, and a schema-valid but incomplete record still exits non-zero — a
partial rehearsal supports **CONDITIONAL GO**, never a clean GO, and the
`live-money` accepted risk stays visible until every live_required row is
`live_rehearsed`. **Refund verification (row H): whenever money moved, confirm
the refund in Stripe and record its opaque refund id** before closing the row.

## Rollback (per journey)

If any journey above lands in a wrong state, the customer comes first and the
code second:

1. **Restore the customer** — set the correct entitlement manually in Stripe,
   confirm it in `/api/admin/readiness`, and tell the customer what happened and
   what was preserved. Never leave a paid customer without access while
   debugging.
2. **Stop the bleed** — if the wrong state is reachable by others, revert the
   offending commit (v10 commits are independent and additive) and redeploy.
3. **Requeue, don't re-charge** — replay the missed events with
   `stripe events resend`; the `stripe_events` ledger makes replay safe. Never
   create a second charge to "fix" a first one.
4. **Record it** — event IDs, timestamps and the corrective action go in the
   incident log (`RUNBOOK_INCIDENTS.md`); no customer content, no card data.

## Data-rights drills

- Account export across every v8/v9 table produced: `__________` (owner)
- Account delete produced a deletion receipt; re-export returns empty: `__________`
- Cancellation + deletion **failure** cannot report false success — verified: ☐

## Sign-off

- Owner: Primoz Cerar  Date: 2026-09-05
- Verdict: ☑ GO for cohort expansion (public_paid full GO) ☐ NO-GO (blockers below)
- Open blockers (owner, deadline, acceptance evidence, rollback): none — `P1-live-money-unrehearsed` and `P1-router-rsc-csrf-advisory` closed; see `docs/launch/launch-state.json`
