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

## 4. Launch-blocking operational tasks (NOT code — must be done in prod)

These are the gate between "GO" and actually charging customers:

1. **Run migrations 015–023** on the production Supabase project (email events,
   marketing consent, campaign brief, email/social/creative studio fields, SEO
   ideas, version provenance, admin audit).
2. **Set env vars:** `BRAND_LEGAL_NAME`, `BRAND_LEGAL_ADDRESS`, `BRAND_GOVERNING_LAW`
   (checkout stays disabled until these are real), plus `STRIPE_PRICE_*`,
   `STRIPE_WEBHOOK_SECRET`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`; optional
   `BRAND_PRIVACY_EMAIL`, `RESEND_API_KEY`, `ADMIN_EMAILS`.
3. **Stripe/email config:** verify the webhook endpoint + signing secret, the
   Customer Portal (cancel/update payment) is enabled, success/cancel redirect
   URLs point at `/app?checkout=…`, and the Resend sending domain is verified.

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
