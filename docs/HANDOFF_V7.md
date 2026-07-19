# Handoff — LaunchBloom, post-v7 (for the next agent)

> You are picking up `primocera/LaunchBloom` after the **v7 playbook** pass.
> This note tells you exactly what exists, the rules you must not break, the
> honest gaps in how v7 was executed, and where to improve. Read all of it
> before touching code. When in doubt, the backend + tests are the source of
> truth, not any prose (including this note).

---

## 0. Current state (facts)

- **Branch:** `main` @ `0d3a103` (v7 tip). Local `v7` == `main`. Pushed to origin.
- **Tests green:** `npm run check` passes — lint (0 errors), 242 backend tests
  (`node --test backend/tests/*.test.js`), Vite build, `check:app-fresh`.
  Playwright: 18/18 (`npm run test:e2e`).
- **Stack:** Node + Express (CommonJS, plain JS, no TS, no Zod), Supabase
  (service_role), Stripe Checkout + webhooks, Anthropic (`claude-opus-4-8`,
  structured JSON output), optional Resend. Frontend: Vite + React under
  `app-src/`, built into committed `app/`.
- **The whole product contract lives in `CLAUDE.md`** — read it first.

---

## 1. What v7 did (13 modular prompts + LB-00 master), by commit

- `67a0cf2` — LB-00/LB-01/LB-05/LB-11: shared status vocabulary
  (`app-src/lib/status-labels.js`), retired "launch kit" → "campaign package /
  full launch campaign" on all customer surfaces, `content-contract.test.js`
  (promise, five Create paths, banned claims, trial disclosure), bundle rebuild.
- `8e507fd` — LB-12/LB-13: prior-trial **pay-today** copy
  (`GET /api/account/billing` now returns `trial_eligible`), honest
  checkout-success banner (trialing vs active vs webhook-delay),
  `docs/BETA_GO_NO_GO.md` v7 addendum.
- `ab1e7ea` — LB-03/LB-04: Brand Profile minimum-baseline line + snapshot
  semantics; Campaign Brief approvable **without** paying for AI strategy;
  "Reopen brief" confirm explaining downstream + snapshot behaviour.
- (latest) — LB-02 + LB-06..LB-10: hero defines "launch-ready"; signup routes to
  `/app/brand?welcome=1`; page-type / flow-type / ad-format descriptions;
  "LaunchBloom does not send emails"; Social calendar **plans, never schedules**;
  Creative outputs are **briefs, not media**; SEO export honesty; shared export
  note in the generator shell.

Real defects fixed along the way: forced-strategy-to-approve, prior-trial fake
trial promise, status-label mismatch, calendar "schedule" wording, signup dead
end.

---

## 2. HONEST process gaps (please shore these up)

The v7 doc prescribes a strict method. It was **not fully** followed:

1. **Prompts were NOT executed verbatim START→END as isolated units.** The doc
   was read once, requirements extracted, and implemented as a checklist. If the
   owner wants documentary rigor, re-run specific prompts verbatim, each as its
   own commit.
2. **No per-prompt diff/test gate.** Verification (`npm run check`, targeted
   tests, e2e) ran **per commit-batch**, not between every individual prompt.
   Several prompts share one commit.
3. **Master + modular hybrid.** The doc says run LB-00 **or** the modular prompts
   — not both. Here LB-00 ran first, then all modular on top (with inspection,
   not blindly). More coverage, but not the doc's either/or.
4. **LB-00's route-by-route audit MATRIX was never produced as an artifact.** The
   analysis was done to find fixes, but the matrix (route → intent → current
   promise → actual capability → risk → replacement → verification) is missing.
   **Good first task for you:** write `docs/V7_ROUTE_AUDIT.md`.

What WAS done properly: changes are implemented (not just recommended), covered
by regression tests, verified with the real check suite, and external blockers
are stated honestly (see §8).

---

## 3. Product contract — NON-NEGOTIABLE copy rules

Enforced by `backend/tests/content-contract.test.js`. Do not regress:

- **Promise:** "Turn one offer into a launch-ready campaign." Launch-ready =
  structured + review-ready. Never published/compliant/guaranteed.
- **Journey:** Brand Profile → Campaign Brief → Create → Review → Library →
  Export.
- **Exactly five Create paths:** Website, Email, Social, Ads & Creative, SEO
  Ideas. **No sixth canonical card.**
- **Statuses:** Draft, Needs review, Ready to export, Published. Published is
  **user-declared** — the app never publishes/sends/schedules.
- **Free setup** (account, workspace, Brand Profile, Campaign Brief) vs
  **paid trial** (3 days, 20 AI actions, 1 campaign, payment method required).
  Prior-trial users get pay-today copy, never a second trial.
- **Prices/limits come ONLY from `backend/lib/plan-catalog.js` +
  `plan-limits.js`**, served via `GET /api/plans`. Never hard-code a second copy.
  Starter $12.99/mo|$99/yr · Pro $24.99/mo|$199/yr · Studio $59/mo|$499/yr.
- **Banned language:** "production-ready", "send-ready", "ready to paste",
  "fully compliant", "will rank", "will publish", "no card needed", outcome
  guarantees, invented testimonials/counts/discounts/urgency/SEO metrics.

---

## 4. Architecture rules (from CLAUDE.md — do not violate)

- Never expose `SUPABASE_SERVICE_ROLE_KEY` or any secret to client code.
- Every workspace-scoped query filters by **both** id AND `user_email`
  (service_role bypasses RLS — the route IS the security boundary).
- Every AI route is wrapped in `planGate(feature)` (`backend/lib/plan-limits.js`)
  — it authenticates, resolves plan via `planFor()`, reserves an action, and
  releases it on failure. Failed generations never consume quota.
- Plan truth = `routes/customers.js` `planFor(email)` (Stripe-backed).
- AI generation = `backend/lib/ai.js` `generateJson({system, prompt, schema})`;
  schemas in `backend/lib/schemas.js` mirror the Supabase jsonb 1:1.
- `server.js` mount order matters: Stripe webhook (raw body) BEFORE
  `express.json()`, then routes with own parsers, then CORS allowlist.
- Don't trust client-supplied priceId/email/entitlement. Unknown Stripe price
  fails closed.

---

## 5. Key files map

- Contract/tests: `backend/tests/content-contract.test.js`
- Status labels (shared): `app-src/lib/status-labels.js`
- Plan catalog / limits: `backend/lib/plan-catalog.js`, `backend/lib/plan-limits.js`
- Billing route (has `trial_eligible`): `backend/routes/account.js`
- Payments / no-double-trial: `backend/routes/payments.js`
  (`hadTrialOrActiveSubscription`, exported)
- Usage metering (the ledger): `backend/lib/usage.js` (+ `spend-guard.js`)
- Generator shell (all 5 studios): `app-src/routes/studios/generator.jsx`
- Studios: `app-src/routes/studios/{WebsiteStudio,EmailFlowStudio,SocialStudio,CreativeStudio,SeoStudio}.jsx`
- Home next-actions logic: `app-src/lib/next-actions.js`
  (`minimumViableProfile`, `homePlan`)
- Landing/Signup/Paywall: `app-src/routes/Landing.jsx`, `Signup.jsx`,
  `app-src/components/TrialPaywall.jsx`
- Go/no-go: `docs/BETA_GO_NO_GO.md`

---

## 6. How to verify (always run before claiming done)

```bash
npm run check        # lint + backend tests + vite build + app-fresh hash check
npm run test:e2e     # Playwright (public/anon journeys; needs Chromium)
```

- **You MUST rebuild + commit the `app/` bundle after any `app-src/` change.**
  `check:app-fresh` compares normalized hashes vs HEAD and fails if stale.
- Backend has no live keys locally — auth/generation/Stripe journeys are proven
  by unit/integration tests + mocked AI, not live calls.

---

## 7. Known traps

- **CRLF↔LF loop on `app/index.html`.** The committed bundle is LF; the working
  tree renormalizes to CRLF, so it shows "modified" and blocks local ff-merges /
  branch switches. It is EOL-only (zero content change under `--ignore-all-space`).
  If it blocks you, push the branch commit straight to the target
  (`git push origin <branch>:main`) or force-switch — never assume real content
  changed. A leftover git stash may hold this same artifact; it's harmless.
- **There is NO `GET /api/plans/canonical`.** The endpoint is `GET /api/plans`;
  the source of truth is `backend/lib/plan-catalog.js`. (Old docs say otherwise.)
- **Metering is `backend/lib/usage.js`**, not a file named "usage-ledger".
- Legacy surfaces (`ContentStudio.jsx`, `LandingStudio.jsx`, `Flow.jsx`,
  `KitDetail.jsx`, `/app/weekly-plan`) are intentionally kept and **subordinated**
  to the five canonical studios — do not delete; they hold existing user data.
- The landing **AskBox** was intentionally removed in v6 for the one-promise/
  one-CTA hero. The v7 doc still references an AskBox handoff — this is a known
  divergence; confirm with the owner before "restoring" it.

---

## 8. External blockers (NOT code — do not try to "fix" in code)

These gate paid launch and cannot be produced from the dev environment:

- Live Stripe prices set in env: `STRIPE_PRICE_{STARTER,PRO,STUDIO}_{MONTHLY,YEARLY}`.
- `PUBLIC_URL` (real domain) + `ENFORCE_LAUNCH_CONFIG=1` once legal config is real.
- Verified Resend sending domain.
- Email outbox trigger: cron-job.org calling `GET /api/cron/email-outbox` with
  `Authorization: Bearer ${CRON_SECRET}` (Vercel crons need a paid plan).
- Legal entity + support config (drives `/api/legal`, checkout gate).
- **One manual end-to-end test-mode checkout** (signup → trial → checkout →
  webhook → generation) before inviting paying users.

---

## 9. Suggested next improvements (prioritized)

1. **Write `docs/V7_ROUTE_AUDIT.md`** — the missing LB-00 audit matrix (read-only,
   no code change). Closes the biggest process gap.
2. If documentary rigor is wanted: re-run chosen prompts **verbatim START→END**,
   one commit each, with an explicit "diff + test results" note before the next.
3. Deeper per-field passes are optional — the contract already holds and is
   tested; only churn copy if it fixes a real defect.
4. Never add a duplicate source of truth for prices/limits/statuses; extend the
   existing catalog / `status-labels.js` / `content-contract.test.js` instead.

---

## 10. Definition of done (every change)

Read repo instructions + git status first · implement justified changes in the
app (not just recommendations) · no invented features/proof/prices/limits · no
destructive removal of existing user data · critical promises + entitlements +
safety have regression tests · run lint/tests/build honestly and report results
truthfully · list anything you could NOT verify (browser, Stripe webhook, email
delivery, legal, prod config) as an **external blocker, not a passed check** ·
review the final diff with `git diff --check`, no secrets/debug/drift.
