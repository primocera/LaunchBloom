# NEXT_SESSION: continue from the 2026-11-15 audit

Read this file first. It is enough to start implementing without repeating the analysis. Full reasoning is in the numbered files beside it.

## Context

- Audit of `main` at `b3429c8`, read-only. No code changed, no tests run, nothing checked against production.
- `CLAUDE.md` forbids self-directed hardening work. On 2026-11-17 the owner authorised implementing this list (no push; skip the three product decisions; leave 042). See Status for what is done.
- Standing owner rules that apply to these fixes: build on top, never rename or rework existing limits, fields or copy; billing and migration changes need confirmation before push; a non-empty billing diff means checking `OWNER_CHECKLIST_v24` step 7 before claiming no re-rehearsal is needed.
- Tasks 1 to 4, 8 and 9 touch billing files, so they change the billing diff.

## Status (updated 2026-11-17, end of session 2)

**Where things are:** all work is on the local branch `audit-batch1`, committed (one commit per fix), **not pushed, not deployed**. Last code commit `edd6eb2`. `npm run lint` clean, `npm test` 1241/1241 at the end. Nothing was checked against real Supabase or Stripe.

**Progress:** of the 21 listed tasks, 15 are DONE, 5 are PARTIAL (each waits on an owner action or decision, listed below) and 1 (T4) is NOT DONE, waiting for the owner's go-ahead.

**Do not push without the owner.** Commits 6c6a576, 7343a57, 6191fb4, 7d3afbe, b63e2dd, d58c3c1 and e0bfb6f touch billing files (`webhooks.js`, `account.js`, `payments.js`, `usage.js`, `stripe-ownership.js`, `launch-config.js`), so the billing-diff rule (`OWNER_CHECKLIST_v24` step 7) and a release-candidate run apply before deploy.

### Every task: what had to be done, what was done

Legend: **DONE** = implemented, tested, committed. **PARTIAL** = part done, rest listed. **NOT DONE** = left, with the reason.

| # | ID | Had to be done | What was done (commit) | Still open |
|---|---|---|---|---|
| 1 | B2 | Throw on customer read error; never null `customer_id` | **DONE** in session 1, committed in `6c6a576` | none |
| 2 | B1 | Drop UNIQUE on `customers.email`; tolerate conflict in `customer.updated` | **PARTIAL** `6c6a576`: deletion replaces the kept row's email with `deleted-<id>@deleted.invalid`; `customer.updated` acknowledges a 23505 conflict | UNIQUE constraint **kept** (the pre-enforcement path still upserts on email). A new user who registers an address another live row holds can still fail checkout. Drop the constraint after T4 removes the email upsert. No pglite test yet |
| 3 | B3 | Abort deletion unless the Stripe cancel is ok or missing | **DONE** `6c6a576`: 503 `DELETE_BILLING_UNCONFIRMED`; a provably foreign link still proceeds | none |
| 4 | M2 | Ignore `reserved` rows older than 10 min | **DONE** `6c6a576` | none |
| 5 | M1 | Count and reserve errors throw; gate 503 | **DONE** `6c6a576`: gate 503 `USAGE_UNAVAILABLE`; account page shows 0 instead of failing | none |
| 6 | D1 | `ensureWorkspace`/`listWorkspaces` check errors, oldest first, race-safe | **DONE** `6c6a576`: 503 `WORKSPACE_LOOKUP_FAILED` | Mock test only, no pglite test |
| 7 | D2 | Migration enabling RLS on 5 tables + test | **PARTIAL** `6c6a576`: `042_enable_rls_remaining_tables.sql` written; migration test that every `create table` has RLS | **042 applied in production and on the CI throwaway** (owner, 2026-11-17). Not added to `CHECK_APPLIED.sql` (that file stops at 037) |
| 8 | B4 | Mirror the subscription refetched from Stripe; atomic `claimEvent` | **DONE** `7343a57`: `onSubscriptionUpdated` mirrors `stripe.subscriptions.retrieve()` (falls back to the payload with an ops signal if Stripe is unreachable). `claimEvent` claims with the INSERT and takes over with a conditional UPDATE; a redelivery inside a 2-minute lease gets **409** so Stripe retries | `onSubscriptionDeleted` still uses the payload + stale check (deletion is terminal, so ordering matters less) |
| 9 | B6 | Remove the cross-object stale guard from invoice emails | **DONE** `6191fb4`: `invoice.paid` guard removed (emails deduped on invoice id); `invoice.payment_failed` now skips only when Stripe says that invoice is `paid` (unreadable = send) | none |
| 10 | M3 | `windowStart({ userId, email })` via `findCustomerRow` | **DONE** `7d3afbe`: the gate answers 503 on an unreadable customer or subscription instead of using the calendar month; the account display still falls back | none |
| 11 | A1 | Await the idempotency result write; await or `waitUntil` analytics | **DONE** `d173dd0`: result row written before the response (wait capped at 3 s, `IDEMPOTENCY_STORE_TIMEOUT_MS`); `track()` hands its promise to Vercel's request context (`waitUntil`) when present, no new dependency | Not verified on real Vercel that the request context is present |
| 12 | A4, A5 | One ~240 s deadline; detect `max_tokens` truncation | **DONE** `c1b8355`: `AI_DEADLINE_MS` (240 s) shared by all attempts, a retry with less than `AI_MIN_ATTEMPT_MS` (15 s) left is skipped; `stop_reason: max_tokens` gives `AI_TRUNCATED` with one retry at 1.5x the limit; failed-attempt tokens now count in the cost meta, the ledger finalize and the error log | A fully failed generation's tokens are logged but not written to the spend ledger (needs a change to the migration 024 functions) |
| 13 | A3 | Per-user daily share of the global AI cap | **DONE** `02b368e`: the gate refuses past `AI_USER_DAILY_SHARE` (default 0.25) of `MAX_AI_CALLS_PER_DAY` per UTC day with **429 `USER_DAILY_LIMIT`**, counted in actions from the usage ledger (no migration). The 80% and 100% budget thresholds now also emit an ops signal | Owner: confirm the production `MAX_AI_CALLS_PER_DAY` (live check 7). With the default 300 the share is 75 actions per account per day. It counts actions, not calls, so it caps one account; it is not an exact split. Frontend shows the generic error for the new code |
| 14 | S2 | `vercel.json` headers, then CSP | **DONE** frame/nosniff/referrer in `6c6a576`; CSP on every non-`/api` path in `215c800` (same-origin scripts, fonts and connections, `frame-ancestors 'none'`, inline styles allowed). A test checks the built `app/index.html` has no external or inline script | Check the live site after deploy: landing, sign-in, app, Stripe checkout redirect, billing portal. The Vercel preview toolbar is blocked on previews (harmless) |
| 15 | S1 | User-keyed general limiter; shared store for the auth limiters; Turnstile | **PARTIAL** `bd1b991`: general limit (100 / 15 min, unchanged) keyed by the token's user id; per-IP backstop 600 / 15 min mounted once on `/api` after the webhook; login, signup and email-send limiters on a Postgres store (**new migration `043_rate_limit_hits.sql`**, keys SHA-256 hashed, RLS on, execute revoked from anon/authenticated). Until 043 is applied they count per instance, as before | **043 applied in production and on the CI throwaway** (owner, 2026-11-17), so the shared counters are live once this code is deployed. **Turnstile not done:** needs a Cloudflare widget, site and secret keys from the owner, and a frontend change |
| 16 | B5 | Enforcement on by default + production startup check | **DONE** `b63e2dd`: in live production (`NODE_ENV=production` + `sk_live`) an unset `STRIPE_OWNERSHIP_ENFORCED` enforces; any other explicit value is a blocking launch-config problem. Dev and test unchanged (only `1` enforces) | The pre-enforcement branches are still in the code (task 18) |
| 17 | S3, S4 | Recovery marker from the verified token only; password before account delete | **DONE** S3 `83b39f6`: `token_hash` links trust only `type`; code links need `amr` to include `recovery` (a token without an `amr` claim keeps the old `flow` behaviour). S4 `d58c3c1`: delete requires the password (400 `PASSWORD_REQUIRED`, 401 `PASSWORD_INCORRECT`, 503 `PASSWORD_CHECK_UNAVAILABLE`), 10 tries per 15 min per user; the Account page has a password field in the confirm row; `app/` rebuilt | **Live check after deploy:** request a password reset and click the email link. It must land on the reset page. If it lands on `/app`, Supabase's code-flow session has no `recovery` amr: revert the code-flow branch in the `routes/auth.js` callback. S3 login CSRF (a confirm page that POSTs) not done; the audit marks it "consider" |
| 18 | T4 | Delete pre-enforcement branches, legacy price fallback, credit gate, Storage fallbacks, B9 endpoints, B7 lifetime grant | **NOT DONE** | Deleting billing code and files is a rework that `CLAUDE.md` says to ask about first, and it depends on live checks 3 (payments table empty) and 7 (legacy price env unset). Needs the owner's go-ahead |
| 19 | D3 | `must()` helper; convert decision reads; test that flags data-only reads | **DONE** `e0bfb6f`: `backend/lib/must.js`; converted the account export workspace list, `payments.js` `ownsSubscription`, and in webhooks the lifecycle-email customer lookup, the charge ownership lookup and the `invoice.paid` recovery check. Ratchet test (`d3-must.test.js`) fails if any `routes/` or `lib/` file gains a data-only read | About 80 display-only reads remain (baseline in the test). Lower the baseline as they are converted |
| 20 | A6 | Parallelise the gate reads, or one SQL function | **PARTIAL** `edd6eb2`: window + top-ups in parallel, then the three counts in parallel (two waits instead of up to five) | The single SQL gate function is not done (needs a migration) |
| 21 | A7 | Fix the `CLAUDE.md` model line and "planFor cached"; align `BASE_SYSTEM` | **PARTIAL** `31578d7`: both `CLAUDE.md` lines corrected | The `BASE_SYSTEM` audience change is a prompt change: route it through the prompt registry and golden evals (prompt owner). The `claude-haiku-5-5` cost row was not checked against current pricing |

Skipped on purpose (owner decisions): P2 retire or connect the old flow, P5 app colours, P6 a free result before the card. Not touched (not on the task list, or decisions): B7, B8, B9, B10, B11, D4, S5, T3, T5.

### New tests this session

`audit-batch2.test.js` (B4, B6, M3, A1 analytics, D3 webhooks), `ai-deadline.test.js` (A4/A5), `ai-daily-share.test.js` (A3, A6), `rate-limit-shared.test.js` (S1), `ownership-enforced-default.test.js` (B5), `security-headers.test.js` (S2), `d3-must.test.js` (D3); additions in `idempotency.test.js` (A1), `auth-recovery.test.js` (S3), `account-routes.test.js` (S4). Older webhook tests now stub `stripe.subscriptions.retrieve` and `stripe.invoices.retrieve` as unreachable so they make no network call; the four deletion test files now send a password.

### Owner actions this work needs

1. Billing-diff rule + release-candidate run before any push or deploy (see top).
2. ~~Apply 042 and 043~~ done in both projects (owner, 2026-11-17).
3. Confirm `MAX_AI_CALLS_PER_DAY` in Vercel (the A3 share is 25% of it), and whether `AI_USER_DAILY_SHARE` should differ.
4. After deploy: the password-reset email link lands on the reset page (S3); delete-account asks for the password (S4); landing, app and Stripe checkout still load with the CSP (S2); generate once and confirm the account usage counter moves (M1/M2).
5. Turnstile keys, if you want the CAPTCHA part of S1.
6. Go-ahead, or not, on the T4 deletions.

### Found during this session (not on the audit list)

- `backend/tests/topup-gate.test.js` failed once under the full parallel run and passed on rerun and alone: a flaky test, cause not investigated.
- Frontend: the new codes `USER_DAILY_LIMIT`, `PASSWORD_*`, `USAGE_UNAVAILABLE`, `WORKSPACE_LOOKUP_FAILED` and `DELETE_BILLING_UNCONFIRMED` show the backend message through the generic error display; there is no special UI for them.
- `CHECK_APPLIED.sql` has no rows for 038 to 043.
- **041 (top-up packs) was never applied in production** until 2026-11-17, so packs could not be granted (the gate counted 0 extra actions, nothing broke). The owner applied it that day (`action_topups` exists = true); no pack had ever been bought (0 users). The CI throwaway project may still lack 041.
- **2026-11-17 migrations, per owner:** **042 and 043 are applied in both projects, production and the CI throwaway** (owner's statement, recorded in `docs/launch/launch-state.json`; no production query result was seen in this session). Before that, the throwaway had `admin_audit` without RLS and no `rate_limit_hits`. To verify any project: `select relname, relrowsecurity from pg_class where relname = 'admin_audit';` (true = 042) and `select to_regclass('public.rate_limit_hits') is not null;` (true = 043).

## Live checks to run before coding (owner, about 10 minutes)

1. **RLS (D2):** in the Supabase SQL editor:
   ```sql
   select relname from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;
   ```
   Expected if the finding holds: `analytics_events`, `email_events`, `admin_audit`, `email_suppressions`, `stripe_object_ownership`.
2. **Email constraint (B1):** `select conname from pg_constraint where conrelid = 'public.customers'::regclass;` Look for `customers_email_key`.
3. **Lifetime grant (B7):** `select count(*) from payments where status = 'succeeded';` Expected 0.
4. **Stuck reservations (M2):** `select count(*) from usage_events where status = 'reserved' and created_at < now() - interval '15 minutes';`
5. **Unlinked subscriptions (B2):** `select count(*) from subscriptions where customer_id is null and status in ('active','trialing');`
6. **Duplicate workspaces (D1):** `select user_id, count(*) from workspaces group by 1 having count(*) > 1;` Compare with each user's plan limit.
7. **Vercel env:** `STRIPE_OWNERSHIP_ENFORCED=1` present, `MAX_AI_CALLS_PER_DAY` value, legacy `STRIPE_PRICE_STARTER/_PRO/_BUSINESS` unset.
8. **Outbox cron:** the external scheduler calling `/api/cron/email-outbox` exists and is succeeding.
9. **Authenticated e2e:** read the failing `rc/v25` run and find the cause (T3).

## Recommended task order

Each task is small and independent unless stated. Write the test first; the test for each is listed in `04-tests-debt-architecture.md` (T2).

### Batch 1: defects that hurt paying customers

| # | ID | Change | Files |
|---|---|---|---|
| 1 | B2 | In `onSubscriptionUpdated`, throw on a customer read error; omit `customer_id` from the upsert when no customer is found | `backend/routes/webhooks.js:708-717` |
| 2 | B1 | Migration 042: drop UNIQUE on `customers.email`, keep a plain index. Make `onCustomerUpdated` tolerate conflicts | new migration, `webhooks.js:906-915` |
| 3 | B3 | Abort account deletion before destructive steps unless Stripe cancellation is `ok` or the billing account is `missing` | `backend/routes/account.js:266-302` |
| 4 | M2 | Count `reserved` rows only when `created_at` is within 10 minutes | `backend/lib/usage.js` `countActions`, `countUserActions` |
| 5 | M1 | Throw on count or reserve errors; gate answers 503 | `backend/lib/usage.js:160,178,199`, `backend/lib/plan-limits.js` |
| 6 | D1 | `ensureWorkspace` and `listWorkspaces`: check errors, order by `created_at`, make first creation race-safe | `backend/routes/workspaces.js:21-98` |
| 7 | D2 | Migration enabling RLS on the five tables; add the check to `CHECK_APPLIED.sql`; migration test that every table has RLS | new migration |

### Batch 2: correctness under load and ordering

| # | ID | Change | Files |
|---|---|---|---|
| 8 | B4 | Subscription handlers mirror the subscription refetched from Stripe; atomic `claimEvent` | `backend/routes/webhooks.js:313-347,698-788` |
| 9 | B6 | Remove the cross-object stale guard from invoice email handlers | `webhooks.js:825-831,894-900` |
| 10 | M3 | `windowStart` takes `{ userId, email }` and uses `findCustomerRow` | `backend/lib/usage.js:62-75`, callers in `plan-limits.js` |
| 11 | A1 | Await the idempotency result write before responding; await or `waitUntil` analytics | `backend/lib/idempotency.js:99-113` |
| 12 | A4, A5 | One overall generation deadline (about 240 s); detect `max_tokens` truncation | `backend/lib/ai.js:341-410` |
| 13 | A3 | Per-user daily share of the global AI cap | `backend/lib/spend-guard.js`, migration 024 functions |

### Batch 3: security posture

| # | ID | Change | Files |
|---|---|---|---|
| 14 | S2 | `headers` block in `vercel.json` (frame, nosniff, referrer, then CSP) | `vercel.json` |
| 15 | S1 | General limiter keyed by user id; auth limiters on a shared store; Turnstile on signup and forgot-password | `backend/server.js:31-62`, `backend/routes/auth.js:39-78` |
| 16 | B5 | Enforcement on by default plus a production startup check | `backend/lib/stripe-ownership.js:59`, `backend/lib/launch-config.js` |
| 17 | S3, S4 | Recovery marker from verified token type only; password confirmation on account delete | `backend/routes/auth.js:345-406`, `account.js` |

### Batch 4: cleanup (after batch 3, task 16)

| # | ID | Change |
|---|---|---|
| 18 | T4 | Delete pre-enforcement branches, legacy price fallback, credit gate, Storage fallbacks, unused endpoints (B9), lifetime grant (B7) |
| 19 | D3 | `must()` helper for Supabase reads; convert decision-making reads; test that flags data-only destructuring in routes |
| 20 | A6 | Parallelise gate reads or move the gate into one SQL function |
| 21 | A7 | Update `CLAUDE.md` model line and the "planFor is cached" claim; align `BASE_SYSTEM` with the current audience (prompt change: route through the prompt registry and golden evals) |

## From the blueprint comparison (`05-blueprint-comparison.md`)

Compared from screenshots of `OfferFlow_AI_blueprint.docx`: sections 1 to 6, 8 to 11, 13 to 16 and part of 7. Section 12 was not visible.

- **P1 (High):** blueprint section 13 says validate with 10 to 20 people before building; it was skipped, and the repositioned product is untested too. After batch 1, run it with the current audience before any new feature. Bar: 10 people pay or ask to keep access.
- **P2 (High):** two products in one app. Blueprint flow: `/flow`, `/kits/:id`, `/weekly-plan`, `/landing-page`, `/content-plan`, `/email-sequence`, `/ads`, `routes/ai.js`, nine tables. Campaign flow: everything in the sidebar. They share no data. Owner decides retire or connect.
- **P3 (Medium):** blueprint leftovers: `BASE_SYSTEM` (`backend/lib/ai.js:22-36`), tagline "From Idea to Offer to Launch" (`app-src/brand.js`, `backend/lib/brand.js`), yoga mock samples with € prices, `content_plan_days` on the free plan, lifetime grant (B7). Also check the landing headline word "launch-ready" against the honest-copy rule.
- **P4 (Medium):** the weekly plan was the blueprint's retention feature; the campaign flow has no weekly reason to return. Ask interviewees; build nothing yet.
- **P5 (Medium):** three visual systems. Landing: white, `#111111`, `#2F6CEB`, Instrument Serif. Sign-in: blue. App: `#FAF8F5`, brown text `#2B2320`, beige borders (`app-src/styles.css:2-13`). Proposal: move the app's base tokens to the landing system; needs owner sign-off.
- **P6 (Medium):** free plan has zero AI actions and a card wall before any output; the blueprint's free plan gave one result. Pricing decision for the owner. No Google sign-in.
- Agencies will share logins while team access stays out of scope, so do task 15 before onboarding one.

## Open decisions for the owner

0. From the blueprint comparison: retire or connect the blueprint flow (P2)? Adopt the landing palette in the app (P5)? Allow one free result before the card (P6)?
1. Which batches are authorised, given the no-engineering default?
2. Separate Stripe account for Scalvya (B11)? Cheapest while the paying cohort is near zero.
3. After deletion, anonymise the local `customers` row or document its retention (D4)?
4. Stop extending the launch-state and evidence tooling (T5)?
5. Is reusing a trial with a new account acceptable for now (B10)?

## Finding index

| ID | Severity | One line | File |
|---|---|---|---|
| B1 | High | Email UNIQUE blocks checkout for returning or colliding users | 01 |
| B2 | High | Webhook nulls `customer_id` | 01 |
| B3 | High | Deletion proceeds after failed cancel | 01 |
| B4 | High | Same-second and concurrent webhook ordering | 01 |
| B5 | Medium | Enforcement flag default off, unvalidated | 01 |
| B6 | Medium | Invoice emails dropped by wrong stale guard | 01 |
| B7 | Medium | Dormant lifetime-Pro grant | 01 |
| B8 | Low-Med | Stripe API version mismatch, period end in emails | 01 |
| B9 | Low | Unused billing endpoints | 01 |
| B10 | Low | Trial reuse, top-up refund policy | 01 |
| B11 | Decision | Shared Stripe account | 01 |
| M1 | High | Usage ledger fails open | 02 |
| M2 | High | Reservations never expire | 02 |
| M3 | Medium | Metering window keyed by email | 02 |
| A1 | Medium | Post-response writes lost on Vercel | 02 |
| A2 | Low | Idempotency key not bound to body | 02 |
| A3 | Medium | Global daily cap, no per-user share | 02 |
| A4 | Medium | Retry budget exceeds 300 s | 02 |
| A5 | Low | Truncation retried blindly, failed-attempt cost unrecorded | 02 |
| A6 | Low | About 12 sequential reads per generation | 02 |
| A7 | Low | Docs and system prompt drift | 02 |
| D1 | High | `ensureWorkspace` creates on read error and races | 03 |
| D2 | High (live check) | Five tables without RLS | 03 |
| D3 | Medium | Read errors treated as not found | 03 |
| D4 | Medium | Deletion keeps local billing row | 03 |
| S1 | Medium | In-memory, per-IP rate limits | 03 |
| S2 | Medium | No security headers on the app shell | 03 |
| S3 | Low-Med | Callback login CSRF, `flow=recovery` | 03 |
| S4 | Low-Med | No re-auth for account delete | 03 |
| S5 | Low | Parallel refresh, per-request `getUser` | 03 |
| S6 | Low | Unescaped email in HTML, XFF IP, CORS 500 | 03 |
| T1-T6 | Mixed | Tests, dead code, architecture | 04 |

## Not yet reviewed

React app beyond `app-src/lib/api.js`, `lib/lifecycle-email.js` and the outbox, `lib/handoff-docs.js` and the export path, `routes/campaigns.js` and `routes/assets.js` in full, `routes/admin.js` queries, prompt and schema quality. A second pass should start with the outbox (retry and locking) and the export path.
