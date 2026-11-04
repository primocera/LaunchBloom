# Code + compliance review, 2026-11 (Scalvya + Mellowa)

Owner-requested pass (2026-11-03/04): a legal compliance check, then a full code
review of both repos by six parallel read-only agents (auth & data ownership,
billing & webhooks, AI / limits / frontend - per repo). The most serious
findings were re-verified by reading the code before anything was changed.

**Status: committed locally, NOT pushed, NOT live.** Going live needs the
test-mode billing plan and an exact-SHA release-candidate run (below).

## Scalvya - fixed

| Commit | Area | What changed |
|---|---|---|
| `6111cf9` | Legal | `/legal/*` served directly (was 404 outside in-app clicks), `/terms` and `/privacy` redirect; Terms: content/IP ownership, auto-renewal + cancellation, full refund for EU/UK consumer withdrawal, liability carve-outs, consumer home-law, 30-day change notice; Privacy: everything collected, client data, AI training, honest retention, Slovenian DPA; cookie/storage list; model withdrawal form; renewal wording + links before checkout; `BRAND_LEGAL_REG_NO` / `BRAND_VAT_ID`; fonts self-hosted; welcome mail transactional, marketing mail needs the signup opt-in |
| `a0f8fda` | Billing (email only) | Invoice webhooks resolve the dahlia subscription reference and send receipt / payment-failed / recovered email (were silently skipped); invoice events never write subscription status; payment-failed copy no longer promises access during dunning |
| `a0f8fda` | Metering | Yearly plans meter the monthly allowance per monthly cycle (were metered per year); `usage.resets_at` |
| `a0f8fda` | Request path | AI limiter keyed by verified user (was a JWT prefix every user shared); limiters count a request once (was up to ~8x); campaigns/evidence 16kb and library 32kb JSON limits actually apply; workspace e-mail fallback only for legacy rows; signup per-IP (5/h) + per-address (3/day) limits, honeypot, reset/resend cap (3/h), 429 + Retry-After |
| `a0f8fda` | Data rights | Account delete + export include `generation_jobs` |
| `9e54397` | Evidence | `docs/evidence/BILLING_TEST_MODE_PLAN_2026-11.md` - the separate billing plan OWNER_CHECKLIST_v24 step 7 requires |
| this commit | Auth | Password reset requires the recovery-link marker (`sb_recovery`, signed, 15 min) and ends other sessions; logout revokes via the refresh token when the access token expired; admin routes require a confirmed e-mail; cron secret compared in constant time |
| this commit | Ownership | Campaign PATCH checks offer ownership; custom weekly tasks need an own launch kit and the dashboard reads them workspace-scoped; `/api/campaigns/:id/strategy` gets the launch-readiness gate |
| this commit | Library / export | Version restore restores content only (not status, campaign, archive, planned date); bulk "ready" enforces the creative compliance gate; failed workspace deletes are reported (no false "ok" receipt); export links carry the active workspace; PDF keeps EU letters; DOCX strips XML-invalid control chars; CSV neutralises formula-leading cells |

Every fix has a test; 1119/1119 pass, lint clean, build fresh. No migration was
needed - every column used exists in migrations 001-040 (checked).

## Scalvya - open (billing; needs the owner's OK and adds to the step-7 diff)

- launch-kit sub-cap can be exceeded by parallel requests (`plan-limits.js`)
- metering fails open on a ledger read/insert error (`usage.js`)
- `subscription.updated` overwrites the customer link with null on a read error (`webhooks.js`)
- `deleted` before `created` can resurrect a canceled subscription (`webhooks.js`)
- a past_due user can buy a second subscription; open checkout sessions have no expiry (`payments.js`)
- re-signup with the same e-mail after deletion breaks checkout (`customers.email` unique)
- AI provider timeouts can strand reserved quota; the spend cap counts calls, not billed attempts (`ai.js`, `usage.js`)
- idempotency status update is not awaited before the response (`idempotency.js`)
- trial / receipt emails show the USD base price for EUR buyers (EUR is off)
- `customer.updated` can retry forever on a duplicate e-mail
- `weekly_plan` regeneration deletes user-added tasks (needs a `source` column = migration)

## Mellowa - found, not fixed here

Owner has a paste-ready fix prompt (this session). Highest:
1. users can write their own `subscriptions` row (free Premium, new trial)
2. users can insert `ai_usage_events` with any cost - one user blocks AI for everyone
3. the fallback plan and regenerate/repair ignore the severe-allergy flag
4. data export returns 500 for every user (orders by a missing `id` column)
5. `/api/ai/safety-check` is an unmetered AI call; journal runs it before the premium check
6. `claim_*` functions only enforce ownership for role `authenticated`

Plus duplicate subscriptions via parallel checkouts, deletion -> webhook FK
failure, reminders to cancelled trials, deletable sample-limit rows, editable
`safety_events`, allergen matcher gaps, consent checkpoint bypass, and missing
signup flood protection.

## Going live (Scalvya)

1. Run `docs/evidence/BILLING_TEST_MODE_PLAN_2026-11.md` (Stripe test mode,
   non-production Supabase) and record T1-T5.
2. Freeze the FINAL SHA (no commits after it), push it to `main` and to an
   `rc/**` branch so `release-candidate.yml` runs at that exact SHA - green,
   including `authenticated-e2e` (unpause the e2e Supabase project first).
3. Deploy that exact SHA on Vercel; `GET /health` must report its 12-hex prefix.
4. Readiness record + `rc_runs` entry in `docs/launch/launch-state.json` on the
   evidence branch; `npm run launch:gate`.
5. Set `BRAND_LEGAL_NAME` / `BRAND_LEGAL_ADDRESS` (full address) and optionally
   `BRAND_LEGAL_REG_NO` / `BRAND_VAT_ID` on Vercel before the deploy.
