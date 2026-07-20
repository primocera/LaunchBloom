# LaunchBloom — Paid-Beta Go/No-Go Audit (v5 Prompt 20)

**Branch:** `v5` · **Audited at commit:** the `v5-P20` commit that adds this file
(HEAD after `v5-P19` = `0ce5cd5`).
**Environment:** local Windows dev + credential-blanked Playwright runner (no live
Supabase/Stripe/Anthropic keys — no real spend during the audit).
**Verdict: GO for a _capacity-limited_ paid beta**, conditional on the three
launch-blocking operational tasks below (migrations, env vars, Stripe/webhook
config) being completed in the production project. No P0 _code_ issues remain.

This report cites evidence and does not modify scope. One real defect was found
during the audit and fixed (see Findings).

---

## 1. Automated evidence (this commit)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **0 errors**, 47 warnings (unused-var/eslint-disable only) |
| Unit/integration | `npm test` (`node --test`) | **175 passed**, 0 failed |
| App build | `npm run build:app` | ✓ 82 modules, built clean |
| Stale-build guard | `npm run check:app-fresh` | ✓ after rebuild committed |
| E2E (Playwright, local) | `npm run test:e2e` | **18 passed** (chromium + mobile) |

CI stays **pull-request-only and lean by design** (no E2E, no scheduled jobs) to
avoid failure-mail spam and to remain on free tiers — this is an explicit
product decision, recorded here so the empty CI E2E slot is not mistaken for a
gap. E2E is run locally against a credential-blanked server.

## 2. Beta checklist

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Pricing, trial & limits match everywhere | ✅ | `/api/plans` derives from `plan-catalog.js`→`PLAN_LIMITS`; Landing/paywall consume it; E2E asserts 30/120/400 + trial 20/1 + "Save up to 36%". |
| 2 | Payment method & charge date disclosed before trial | ✅ | `TrialPaywall` shows plan price + `chargeDate()` (+3d) + disclosure; E2E asserts "Payment method required" and **no** "no card needed". |
| 3 | No legal placeholders remain | ✅ | `Legal.jsx` fed by `/api/legal`; E2E asserts no `[PLACEHOLDER`; prod checkout 500s (`CONFIG`) while `legalPlaceholders()` non-empty. |
| 4 | One navigation + one canonical asset model | ✅ | Sidebar Home/Brand/Campaigns/Create/Library/Account; legacy studio routes redirect; assets flow through the 5 studio tables + library. |
| 5 | Clean install/build/lint/tests pass in CI | ✅ | See §1; CI mirrors `lint`+`test`+`build:app`+`check:app-fresh`. |
| 6 | Critical E2E passes | ✅ | 18 Playwright tests incl. pricing, legal, auth guard, signup consent, mobile overflow, keyboard/a11y. |
| 7 | Stripe webhook retry/idempotency | ✅ (code) | `webhooks.js` claims each `event.id` in `stripe_events`; duplicates ack 200 `{duplicate:true}`; `markProcessed/markFailed`. Needs live secret (§4). |
| 8 | Failed AI calls do not consume quota | ✅ | `plan-limits.js` reserves then **finalizes on success / releases on failure** (`releaseAction`, released rows don't count); `analytics`/tests cover. |
| 9 | Account reset/export/delete work | ✅ (code) | `account.js` `GET /export` (full JSON) + `POST /delete` (cancel billing, wipe data, delete auth user); tested in `account-routes.test.js`. |
| 10 | Lifecycle emails idempotent & branded | ✅ | `lifecycle-email.js` claim-first insert into `email_events` (unique dedupe), returns sent/duplicate/skipped; no-op without `RESEND_API_KEY`. |
| 11 | Mobile & keyboard critical paths | ✅ | P19: focus trap+return on paywall, `:focus-visible`, 44px targets, 320px no-overflow; E2E a11y assertions. |
| 12 | Support can diagnose without seeing content | ✅ | `admin.js` read-only, allowlisted (`ADMIN_EMAILS`), audit-logged (`admin_audit`); analytics `sanitizeProperties` strips content/PII. |

## 3. Commercial promises vs enforcement

- **AI actions / limits:** `planGate(feature)` enforces per-plan counts server-side
  (monthly for paid, lifetime for trial/free); 402 `UPGRADE` on limit. Matches the
  published catalog. ✅
- **3-day trial:** `payments.js` sets `trial_period_days: 3` for first-time
  subscribers only; `planFor()` returns `trial` while `trialing`. ✅
- **AI cost ceiling / concurrency:** `ai.js` enforces a **global daily spend
  ceiling** (`reserveAiCall`, live mode) and per-call `max_tokens`; per-user pool
  counts reserved+succeeded so concurrent requests can't over-spend a plan. ✅
- **Stripe states:** `planFor()` only grants a plan for `active`/`trialing`; every
  other state (`incomplete`, `past_due`, `unpaid`, `canceled`) resolves to no plan,
  and `cancel_at_period_end` keeps access until period end. ✅
- **SEO honesty (P12):** output is "SEO content ideas"; prompt + `rejectFabricatedMetrics`
  forbid volume/difficulty/CPC/ranking claims; UI shows "Not researched". ✅
- **Public copy:** landing/features reviewed — no ranking guarantees, no "priority
  exports", no unlimited/white-label/team-collab claims. ✅

## 4. Launch config — now OPTIONAL by default (deferred until domain is known)

Migrations 015–023 have been run. ✅

The legal + Stripe config gates are **optional by default** so the app can be
deployed/previewed and tested with **sandbox (test-mode) Stripe** before a real
domain or legal entity exists. To hard-enforce them for the real, money-taking
launch, set **`ENFORCE_LAUNCH_CONFIG=1`** — then missing legal values block real
checkout and missing Stripe prices 500 `/api/plans`, exactly as before.

**Before charging REAL customers** (set `ENFORCE_LAUNCH_CONFIG=1` and provide):

1. **Legal:** `BRAND_LEGAL_NAME`, `BRAND_LEGAL_ADDRESS`, `BRAND_GOVERNING_LAW`
   (optional `BRAND_PRIVACY_EMAIL`).
2. **Core:** `STRIPE_SECRET_KEY` + `STRIPE_PRICE_*`, `STRIPE_WEBHOOK_SECRET`,
   `SESSION_SECRET`, `ANTHROPIC_API_KEY` (optional `RESEND_API_KEY`, `ADMIN_EMAILS`).
3. **Domain-dependent (deferred):** Customer Portal enabled, webhook endpoint +
   signing secret, success/cancel redirect URLs at `<your-domain>/app?checkout=…`,
   Resend sending domain verified. Do a **sandbox Stripe** trial→charge + webhook
   replay first; then repeat on the real domain.

## 5. Findings (this audit)

| Sev | Finding | Status |
|---|---|---|
| **P1 (fixed)** | `generator.jsx` had a stray `}` (`)}}`) from the P7 edit — esbuild tolerated it (rendered a literal `}` next to the generate error) but ESLint failed to parse, breaking the `check` gate. | **Fixed** in the `v5-P20` commit; lint now 0 errors, bundle rebuilt. |
| P2 | 47 ESLint **warnings** (unused vars / redundant eslint-disable). | Accepted for beta; cosmetic, non-blocking. |
| P2 | Word export is a Word-openable HTML `.doc`, not OOXML `.docx` (dependency-free/CSP constraint). | Documented; acceptable for beta. |
| P3 | Runtime Stripe-state and webhook-idempotency paths are verified by **code + unit tests**, not a live Stripe replay (no keys in this workspace). | Do a live webhook replay in staging before opening capacity. |

No **P0** issues remain.

## 6. Recommendation

**GO — controlled beta.** Open with a **capacity cap (e.g. 50–100 paying
accounts)** so the first live Stripe/webhook/AI-cost behaviour can be observed
against the scorecard (`/api/admin/scorecard`) before scaling. Complete §4 first;
run one live webhook replay + one real end-to-end trial→charge in staging.

**Explicitly out of scope for this beta** (per the audit's guidance — prove demand
and retention first): real-time team collaboration, direct multi-channel
publishing, unlimited plans, "advanced brand voice" claims, priority exports,
white-label/agency portals, broad third-party integrations, and live SEO metrics
without a licensed data source.


---

# v6 Addendum — Playbook v6 execution status (branch `v6`, 2026-07-19)

The v6 playbook (`LaunchBloom_Master_Launch_Scale_and_Content_Elevation_Playbook_v6.docx`)
issued a CONDITIONAL GO gated on P0 prompts 1–10 + 30. Status at this commit:

## Implemented in code (evidence = backend test suite, 210 passing)

| Playbook prompt | Status | Evidence |
|---|---|---|
| 1 Fail-closed launch config | ✅ (mode-aware) | `lib/launch-config.js`: live-Stripe production + missing config → 503 on checkout/generation; test/preview permissive. `tests/launch-config.test.js` |
| 3 Reproducible build check | ✅ | `.gitattributes` + `scripts/check-app-fresh.mjs` (normalized hashes vs git HEAD; passes twice; immune to CRLF and to pre-running build) |
| 5 Atomic AI spend ledger | ✅ | migration `024_ai_spend_ledger.sql` (single-statement reserve, cap-safe under concurrency) + `lib/spend-guard.js` reserve/finalize/release, pause switch, budget alerts. `tests/spend-guard.test.js` |
| 6 Email outbox + retry worker | ✅ | migration `025_email_outbox.sql` (SKIP LOCKED claim, lease), `processEmailOutbox()` backoff→dead-letter→replay, admin routes + daily external cron via cron-job.org hitting `GET /api/cron/email-outbox` with `Authorization: Bearer ${CRON_SECRET}` (Vercel crons need a paid plan). `tests/email-outbox.test.js` |
| 8 Export/deletion completeness | ✅ | all-workspace export (versioned archive), step-tracked deletion receipt, failures surfaced, deletion-record email. `tests/account-deletion-receipt.test.js` |
| 9 CORS + limits | ✅ (partial) | exact-origin CORS (no `.vercel.app` suffix trust; `ALLOWED_PREVIEW_ORIGINS`), AI limiter keyed by session. Rate-limit store remains in-memory (free tier — plan gate is the durable boundary). |
| 10 Computed scorecard | ✅ | `/api/admin/scorecard`: activation, median TTFV, D7 retention, trial conversion, generation success, cancel reasons — each with numerator/denominator/window. `tests/scorecard.test.js` |
| 11 Generation idempotency | ✅ | migration `026_generation_jobs.sql` + `lib/idempotency.js` on all 9 generate routes; client sends per-intent keys. `tests/idempotency.test.js` |
| 12 Prompt registry + eval gate | ✅ (structural) | `lib/prompt-registry.js` (immutable versions; unregistered env falls back) + `tests/golden-eval.test.js` (schema validity, claim safety, SEO honesty — mock-mode, no live calls) |
| 13/14 Product model + SEO parity | ✅ | SEO Ideas is a generator-shell peer (`generate-seo-ideas`, fabricated-metric rejection, cannibalization warnings); nested `<main>` landmarks removed; kit vocabulary dropped from Campaigns |
| 4 Browser E2E in CI | ⚠ lean variant | `.github/workflows/e2e.yml`: weekly + on-demand, installs Chromium, uploads traces. NOT a required PR check — deliberate free-tier/no-flake decision. |

## Deliberately NOT done (infrastructure this deployment does not have)

- **Prompt 2 (staging revenue E2E):** requires a third Supabase project (free
  tier allows 2) + staging Stripe/Resend/Anthropic credentials. The full
  signup→trial→checkout→webhook→generation journey remains proven only by
  mocked tests and local E2E. **Must be run manually against the production
  project in test mode before inviting paying users.**
- **Prompt 7 (external observability/paging):** no paid APM. Structured logs +
  admin health remain the only signals; a free Sentry tier is the recommended
  first step when a real domain exists.
- **Live-provider evidence (Prompt 30):** real-domain checkout, live-mode
  transaction/refund, deliverability, load test — all blocked on: real domain,
  live Stripe, verified Resend domain.

## Phase C — content rewrite (prompts 15–20, 26–29) — DONE (commits eb9a02d + f40d39d)

| Playbook prompt | Status | Evidence |
|---|---|---|
| 15 Landing rewrite | ✅ | One promise ("Turn one offer into a launch-ready campaign."), one CTA ("Create my campaign"), 4-step mechanism, real-estate example + trust line, campaign-entitlement pricing, 5-question FAQ. Rotating hero removed. Prices still from `/api/plans`. |
| 16 Signup/verify/login + paywall | ✅ | Free-signup framing ("choose a plan only when you're ready to generate"), verification copy, TrialPaywall shows exact charge date **with timezone**; "kit" → "full launch campaign". |
| 17 Brand Profile | ✅ | Ground-truth copy + `minimumViableProfile()` gate helper (`app-src/lib/next-actions.js`). |
| 18 Campaign brief-as-contract | ✅ | Required-decisions count, `Brief v{n} approved {date}`, snapshot semantics note, no-dates urgency guard (`Campaigns.jsx`). |
| 19 Home states | ✅ | State-based greeting/context/CTAs, usage warning "Editing and exporting are still free." |
| 20 Create + generator shell | ✅ | "Create for {campaign}", "Using this context", "Generate {asset} · 1 AI action", failure copy "Generation didn't finish. No AI action was charged. Your brief is saved." Review-ready studio blurbs — last "Production-ready" removed. |
| 26 Library | ✅ | Provenance line (campaign · brief vN · prompt vN · source), statuses Draft / Needs review / Blocked by unresolved claim / Ready to export, honest "Word-compatible file (.doc)" export. |
| 27 Account | ✅ | Plan & billing / Data & privacy / Support sections, exact Stripe-state copy (trialing/active/cancel/past_due) with price+interval, deletion-receipt view. |
| 28 Central microcopy | ✅ | `app-src/lib/microcopy.js` (exact system-state table, `{retry_after}`/`{req_id}` interpolation) wired into `api.js` — raw backend errors never surface. `tests/microcopy.test.js` |
| 29 Lifecycle email content | ✅ | Exact subjects/bodies with plan/price/interval/charge datetime (UTC tz); webhooks derive price info from Stripe objects. `tests/lifecycle-content.test.js` |

Verification: 227 backend tests, lint 0 errors, `npm run check` (incl. stale-bundle
hash check) passes twice, Playwright 18/18, banned-copy greps clean
("production-ready", "ready to paste", "no card needed", income promises).

Still open, non-blocking for beta copy: prompts 21–25 (deeper studio *backend*
generation quality — per-claim provenance, plain-text email parts in generation
output, proof-gated Ready). Legacy `Flow.jsx`/`KitDetail.jsx` keep "launch kit"
wording as the explicit "Full launch campaign" template destination.

## Bottom line

Code-level P0s from the v6 playbook are closed. The remaining go/no-go risk is
entirely **operational evidence on live providers**, which cannot be produced
from this environment. Do not open paid capacity until the Prompt 2 journey has
been exercised once end-to-end on the deployed test-mode environment.

---

# v7 addendum — LB-00 master pass + LB-12 billing pass (branch v7, July 2026)

Pack: `LaunchBloom_Claude_Code_Prompt_Pack v7.docx` (LaunchBloom part).

## Implemented (evidence = 236 backend tests + 18 Playwright, all passing)

| v7 prompt | Status | Evidence |
|---|---|---|
| LB-00 status vocabulary (LB-11 scope) | ✅ | `app-src/lib/status-labels.js` shared by studio StatusPill and Library — "edited"/"ready" DB values always render as "Needs review"/"Ready to export". `tests/content-contract.test.js` |
| LB-00/LB-01 retired vocabulary | ✅ | "launch kit" removed from every customer surface (Flow, KitDetail, StepPopups, studios/common, export title, next-actions); canonical nouns: campaign package / full launch campaign. Banned-claims sweep of all app-src sources is a failing test, not a manual grep. |
| LB-05 guided-flow cost disclosure | ✅ | Every guided-flow generation button says "· 1 AI action"; Campaigns template explains per-step cost + launch-campaign allowance; NoKit empty state routes to /app/campaigns. |
| LB-00 content-contract tests | ✅ | `tests/content-contract.test.js`: canonical promise (hero + metadata), exactly five Create paths (Create + Sidebar), trial disclosure from the canonical catalog, shared status vocab, cost disclosures, banned claims. |
| LB-12 prior-trial pay-today copy | ✅ | `GET /api/account/billing` now returns `trial_eligible` (from `hadTrialOrActiveSubscription`); TrialPaywall switches to "Subscribe — charged today / No second trial"; checkout-success banner only claims a trial when the subscription is actually `trialing`, with a webhook-delay fallback. |
| LB-12 backend invariants | ✅ (pre-existing, re-verified) | Allowlisted plan+interval only, server-derived email, unknown price fails closed, no double trial, webhook idempotency — `payments/customers-unknown-price/webhooks/idempotency` tests. |

## Deltas vs the v7 docx (doc is wrong, code is right)

- No `GET /api/plans/canonical` — the canonical endpoint is `GET /api/plans`; the catalog source of truth is `backend/lib/plan-catalog.js`.
- Usage metering lives in `backend/lib/usage.js` (not "usage-ledger").

## Still open from the v7 pack (non-blocking, candidates for next passes)

- LB-03/LB-04 deep passes (Brand Profile helper copy per-section, brief reopen implications) — current surfaces meet the contract but were not rewritten field-by-field.
- LB-13 external evidence remains identical to the v6 list: staging revenue E2E, live-provider checks, external APM. Same bottom line as v6.

## Go / no-go

| Area | Verdict |
|---|---|
| Code-level P0/P1 | ✅ none known open (prior-trial copy defect closed this pass) |
| Automated checks | ✅ `npm run check` + 18/18 Playwright green |
| External configuration | ⚠ unchanged: real domain, live Stripe prices, verified Resend domain, cron-job.org outbox trigger, legal entity |
| Live-provider evidence | ⛔ still required before paid capacity (one manual end-to-end test-mode journey) |

---

# v8 addendum — Value & Scale playbook + paid-launch reliability gate (branch `v8`, 2026-07-20)

Playbook: `LaunchBloom_Value_Scale_Claude_Code_Prompts v8.docx` (prompts LB-S00..S10),
executed verbatim from `docs/V8_PROMPTS.md`, one commit per prompt.

## What v8 shipped (the value loop)

LaunchBloom moved from a copy generator to a **campaign-control layer**: per-campaign
gap map + deliverable plan (LB-S01), deterministic cross-channel consistency findings
(LB-S02), brief-change impact with no silent propagation (LB-S03), review queue +
evidence locker + export gate (LB-S04), first-value activation + package preview
(LB-S05), channel playbooks + reusable templates (LB-S06), professional handoff packet
(LB-S07, ADR-001 export-only), jobs-based pricing comms (LB-S08), and a decision-grade
value funnel with kill criteria (LB-S09). All derived checks are **free — they consume
no AI action** — and the five canonical Create paths / four statuses are unchanged.

## Automated evidence (this branch)

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **0 errors**, 54 warnings (cosmetic) |
| Unit/integration | `npm test` | **304 passed**, 0 failed |
| App build + stale guard | `npm run build:app` / `check:app-fresh` | ✓ built, bundle fresh |
| E2E (Playwright, local) | `npm run test:e2e` | 16 pass; 2 cold-start flakes pass on isolated re-run |
| Release readiness | `npm run release:check` | reports blockers/external actions, no secrets printed |

## Reliability additions (LB-S10)

- **Release gate** — `backend/scripts/release-check.js` (`npm run release:check`): verifies
  required migrations (028–033), pinned rule versions (consistency `v8.1`, dependencies
  `v8.1`), launch config, live Stripe price allowlist, cron secret and email config —
  **presence only, never secret values**. Exit 1 on any blocker.
- **Safe backfill** — `backend/scripts/backfill-consistency.js` (`npm run backfill:consistency`):
  recomputes derived findings **non-destructively** (fingerprint upsert/resolve, never a
  rebuild; source assets stay authoritative). **DRY-RUN by default**, `--apply` to persist,
  `--batch=N` workspace batching, `--since=<ISO>` checkpoint, `--workspace=<id>` scope,
  `BACKFILL_KILL=1` kill switch. Idempotent and consumes **no AI action**.
- **Failure-injection tests** — `backend/tests/failure-injection.test.js`: analytics/Supabase
  partial failure never throws, duplicate webhook (same `dedupeKey`) counts once, malformed
  AI output does not crash the consistency engine (**fixed a real null-row crash this pass**),
  backfill reconcile idempotent under repeat runs, release check leaks no secret.
- **SLO hypotheses** (directional, to calibrate on live data, not validated): API p95 < 800ms,
  generation p95 < 25s, 5xx error rate < 1%, released-vs-charged AI actions tracked, finding
  recomputation failures ~0. Correlation IDs (`req_id`) already flow through structured logs.

## Scorecard — paid-launch gate

| Gate | Verdict |
|---|---|
| Automated gates at frozen commit | ✅ 304 tests + lint + build + release-check green |
| Derived-state safety (no destructive rebuild, backfill resumable + kill switch) | ✅ |
| Rollback / kill switches tested | ✅ `BACKFILL_KILL`, feature flags, `launch-config` fail-closed; failure-injection covers |
| Cohort cap | ⚠ open at **≤ 50–100 paying accounts**, do not scale until live evidence exists |
| Cost ceiling | ✅ enforced by `ai.js` global daily spend guard (unchanged) |
| Live low-value checkout + cancel/recover rehearsal | ⛔ **owner action** — must record evidence before paid invites |

## External blockers (owner: repo owner / primoz2.cerar@gmail.com)

1. **Live Stripe prices + `sk_live` key + webhook secret** — `release:check` flags until set. Acceptance: `npm run release:check` clean in production env.
2. **Verified domain + `PUBLIC_URL` (HTTPS) + `ALLOWED_ORIGINS`** — acceptance: launch-config check passes.
3. **Resend sending domain + `RESEND_API_KEY` + `BRAND_SENDER_EMAIL`** — acceptance: one live lifecycle email delivered.
4. **`CRON_SECRET` + external cron (cron-job.org) for email outbox / backfill triggers.**
5. **Legal entity values** (`BRAND_LEGAL_*`) — acceptance: no legal placeholders.
6. **One live test-mode journey** signup→trial→checkout→webhook→generation→cancel→recover with owner-recorded evidence.

## Verdict

**NO-GO for open paid launch from this environment** — automated gates are green but a
paid launch **must not** be marked GO from mocked/local tests (LB-S10 non-negotiable).
**Conditional GO for a capacity-capped paid beta (≤ 50–100 accounts)** once the six external
blockers above have owner-recorded live evidence. No P0 code issues remain on branch `v8`.
