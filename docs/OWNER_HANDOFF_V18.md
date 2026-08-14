# Owner handoff — v18

**Candidate:** `163fd6d47583dd93dcc413a8646d2be8f6488a36` (branch `main`, frozen 2026-08-14)
**Bundle:** `index-C2TMZ4Jk.js` + `index-KNfjvmSJ.css`
**Machine truth:** [`docs/LAUNCH_STATE.md`](LAUNCH_STATE.md), generated from
[`docs/launch/launch-state.json`](launch/launch-state.json). Where this prose and
the manifest ever disagree, **the manifest wins**. Supersedes
[`docs/OWNER_HANDOFF_V15.md`](OWNER_HANDOFF_V15.md).

**Gate verdict (computed by `npm run launch:gate`, not declared):**
- **capped_beta: GO** — supervised, invited accounts behind `BETA_INVITE_CAP`.
- **public_paid: CONDITIONAL GO** — proceeds only over two named, visible accepted
  risks (below); it is not a clean GO.

---

## TL;DR

v18 executed the whole Scale Prompt Pack and confirmed the product build is **done
for launch**. Almost everything the pack asked for was already shipped in v6–v17;
only **seven genuine gaps** remained. They are built, tested and merged. Every
automated gate is green at the candidate, including the authenticated browser
matrix (45/45) and a clean `npm audit`.

**The next focus should not be another prompt pack — it should be marketing and
getting users.** See "What comes next" below.

---

## What v18 delivered (only the real gaps)

Built strictly on top of the existing code — nothing re-done that already existed:

| ID | Gap closed | Where |
|----|------------|-------|
| **X01** | Cohort funnel now excludes the staff/test roster **before** counting (reuses the existing beta-scorecard roster — no second registry) | `backend/lib/cohort.js`, `backend/routes/admin.js` |
| **S06** | Server-only `first_value_reached` analytics event on the first real handoff export, behind a default-on `first_value_event` flag | `backend/lib/analytics.js`, `backend/lib/flags.js`, `backend/routes/campaigns.js` |
| **S13** | Frozen paywall-reason contract (7 reasons) surfaced by the trial paywall — UPGRADE/CREDITS map to explicit, honest copy | `app-src/lib/paywall-reasons.js`, `app-src/components/TrialPaywall.jsx` |
| **S05** | Read-only pull-based Stripe webhook reconciler — detects a missed/stale local mirror, reuses the **one** canonical `subscriptionMirrorRow` projection + exact `isOurSubscription` ownership rule; `--apply` is owner-gated (`RECONCILE_OWNER_MODE=1`) | `backend/scripts/reconcile-stripe-webhooks.js`, `backend/lib/webhook-reconcile.js` |
| **X02** | W3C `traceparent` / `x-trace-id` propagation in the logger + SLO/alert doc | `backend/lib/logger.js`, `docs/SLOS.md` |
| **X04** | axe-core accessibility scan on the public routes — **found and fixed three real WCAG-2.2-AA contrast misses** on landing/login/signup | `e2e/a11y-axe.spec.js`, `app-src/landing.css`, `app-src/styles.css` |
| **X06** | Consolidated threat model (14 abuse cases → control → evidence test → residual) | `docs/THREAT_MODEL.md` |

Plus one release-hygiene fix: the authenticated RC runner now runs **single-worker**
so shared-webServer contention can never flake the gate (`scripts/e2e-auth.mjs`).

Out of scope by instruction: the Mellowa repo (separate product) and the owner-only
prompts (O01–O04).

---

## Every check, re-run at the candidate `163fd6d`

| Check | Result |
|-------|--------|
| ESLint | **0 errors / 0 warnings** |
| Unit / contract / safety tests | **961 / 961 pass** (+29 v18 suites) |
| Production build | success — `index-C2TMZ4Jk.js` + `index-KNfjvmSJ.css` |
| Stale-bundle detection | `app/` fresh vs `app-src/` |
| Public browser journeys | **57 pass** (workers:2), incl. the new axe scan |
| **Authenticated seeded matrix** | **45 / 45 pass** (desktop + mobile + keyboard), single-worker, against a disposable non-production EU Supabase — pinned in `test-results/e2e-auth-evidence.json` |
| DOCX/PDF/ZIP export integrity | **15 / 15 pass** |
| Hero contrast (WCAG AA) | **8 / 8 pass** |
| Router RSC-advisory reachability guard | clean — pure client SPA |
| `npm audit --omit=dev` | **0 vulnerabilities** (was 2 high at the v17 record; the react-router advisory no longer surfaces) |
| Launch-state integrity (`launch:verify`) | OK |
| Code drift (`launch:drift`) | none — HEAD matches candidate except docs |

Production config gate (`release_config`) and the migration-applied evidence are
**carried forward** from the prior candidate — valid because
`git diff 64e7691..163fd6d` over `backend/migrations/` and over the config-gate
files (`backend/lib/launch-config.js`, `backend/scripts/release-check.js`) is
**empty**. The v18 `webhooks.js` refactor is not in those files and is covered by
the re-run webhook test suites.

---

## Owner actions still open before **public paid**

These are owner decisions; Claude must not perform them.

1. **Live-money rehearsal (accepted risk, not satisfied).** A real $11.31 charge
   already confirmed the live trial→paid conversion. What remains is the full
   eight-transition ordered sequence in
   [`docs/RUNBOOK_TRANSACTION_REHEARSAL.md`](RUNBOOK_TRANSACTION_REHEARSAL.md) —
   the refund and the late `payment_failed`-after-recovery (step G) with
   out-of-order webhooks. Complete it to convert this accepted risk to satisfied.
2. **Re-confirm production readiness** at the deployed candidate: `GET
   /api/admin/readiness` should report `ready=true`, `0` blockers. Do this after
   deploying `163fd6d` and after any production config change.
3. **Router advisory (accepted risk).** `npm audit` is now clean, so you may
   choose to close blocker `P1-router-rsc-csrf-advisory` outright — that closure
   is your call, not the build's.
4. Confirm on a live paid account that it shows its plan and a real renewal date.

For a **capped, supervised beta**, none of the above blocks you: keep the cohort
behind `BETA_INVITE_CAP`, watch `/api/admin/readiness` daily.

---

## What comes next — marketing, not more code

The build has reached diminishing returns. The constraint on the business is no
longer engineering; it is **users**. The recommended next focus:

- **Positioning & landing conversion** — sharpen the one-outcome promise for
  freelance marketers / boutique agencies; measure signup→activation.
- **First cohort** — get real invited users in behind the beta cap; watch the
  value loop (brief approved → assets generated → **first handoff export**, now
  instrumented via `first_value_reached`).
- **Activation & retention** — use the cohort scorecard and funnel (staff excluded)
  to find where users stall, and fix *that* — not a hypothetical feature.
- **Pricing experiments** — starter/pro/studio, monthly/yearly, trial conversion.
- **Channels** — content/SEO, relevant communities, targeted outbound,
  agency partnerships.

Ship a new feature again only when real user evidence points at a specific one.
Before writing any future prompt pack, read
[`docs/LAUNCH_STATE.md`](LAUNCH_STATE.md) and
[`docs/CONFIGURED_STATE.md`](CONFIGURED_STATE.md) so it asks to *verify X and build
only the gap*, never to rebuild what already exists.
