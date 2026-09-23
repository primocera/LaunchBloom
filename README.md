# Scalvya

<!-- ───────────────────────────────────────────────────────────────────────── -->
<!-- Prompt authors / LLMs: the engineering build (v6–v23) is complete and       -->
<!-- certified — capped-beta GO and public-paid GO (docs/launch/launch-state.json).-->
<!-- The next prompt pack is marketing / distribution / GTM, not engineering.     -->
<!-- Brief: docs/V20_MOVING_TOWARD_MARKETING.md                                   -->
<!-- ───────────────────────────────────────────────────────────────────────── -->

> **The engineering build is complete and certified — capped-beta GO / public-paid GO.**
> The next prompt pack is **marketing / distribution / GTM**, not another engineering
> one. Start from **[docs/V20_MOVING_TOWARD_MARKETING.md](docs/V20_MOVING_TOWARD_MARKETING.md)**.

**Turn one offer into a launch-ready campaign.**

An AI marketing workspace for freelance marketers, boutique agencies and solo
founders. One approved campaign brief drives connected website copy, emails,
social posts, ad briefs and SEO ideas — with automatic consistency review and a
client-ready handoff packet.

*Launch-ready* means structured, connected and ready for human review. It never
means published, approved, fact-checked or compliant. Publishing stays with the
user.

---

## Status: the build is certified; the focus is distribution

The release gate is **capped-beta GO / public-paid GO** — computed, not declared,
by `npm run launch:gate` from `docs/launch/launch-state.json`. As of the v23 re-cut
(2026-09-21) the pinned candidate is CI-green on every required check: dependency
audit 0 (after the v23 security patch), lint, the full unit and contract suite,
build, the public and authenticated browser matrices, and launch integrity. The
live-money recovery rehearsal (the ordered A–H sequence) is complete against real
Stripe with the refund confirmed after the late-failure step, and Stripe-ownership
enforcement is probe-verified. The re-cut is done; what remains is
owner-operational rather than code — deploy the pinned candidate and run the
data-rights export/delete drill.

The constraint on this business is no longer code — it is users. The next work is
**marketing and distribution**: positioning and landing conversion, getting the
first cohort of freelance marketers and boutique agencies in, activation and the
value loop, pricing experiments, and channels (content, communities, outbound,
partnerships). Build features again only when real user evidence asks for a
specific one.

**End-to-end testing is complete.** The public and authenticated (desktop, mobile,
keyboard, real non-production Supabase) browser matrices pass green in CI and gate
the release. If a pack asks to "add E2E tests," verify the existing suites at the
current candidate rather than rebuilding them; add a spec only for a genuinely new,
uncovered user flow.

## Before writing a prompt pack

This repo has been built through successive prompt packs (v6 → v23). The most
common source of wasted work is a pack asking for something **that already
exists**, because the pack was written from the product vision rather than from
the code.

**Before specifying a feature, check the two files that record reality:**

| File | What it tells you |
|---|---|
| [`docs/CONFIGURED_STATE.md`](docs/CONFIGURED_STATE.md) | What is already configured in production (Stripe, Resend, legal config, cron). Verified from the live readiness endpoint, with a date. |
| [`docs/LAUNCH_STATE.md`](docs/LAUNCH_STATE.md) | The current release gate: what is proven, what was accepted as risk, what is outstanding. Generated from `docs/launch/launch-state.json`. |

**Please phrase prompts as "verify X, build only the gap"** rather than
"build X". Recent examples where the ask was already satisfied:

- *"Add a production readiness endpoint"* — shipped in v9; met the bar unchanged.
- *"Add cross-channel consistency checks"* — the v8 engine already covers CTA,
  URLs, promo terms, dates, audience, unsupported claims and stale snapshots.
- *"Add an email outbox with retry and dead-letter"* — present since v6.

Each of those cost a full read of the codebase to discover the work was done.

---

## What is built

### The workflow
Brand Profile → Campaign Brief → Create → Review → Library → Export/Handoff.
Exactly five creation paths: **Website, Email, Social, Ads & Creative, SEO Ideas**.

### Capabilities in the codebase today

| Area | State | Where |
|---|---|---|
| Campaign brief, approval, snapshots, versioning | built | `backend/routes/campaigns.js` |
| Five generator studios, plan-gated | built | `backend/routes/assets.js` |
| Deterministic consistency engine (rules `v8.1`) | built | `backend/lib/consistency.js` |
| Quality checks, claim provenance, fabricated-metric rejection | built | `backend/lib/quality-checks.js` |
| Golden campaign eval corpus (14 fixtures) | built | `backend/tests/fixtures/golden-campaigns.js` |
| Review queue, evidence locker, findings audit | built | `backend/routes/campaigns.js` |
| Handoff export — Markdown, JSON, HTML, **DOCX, PDF, ZIP** | built | `backend/lib/handoff-docs.js` |
| Asset Library: versions, diff, restore, AI rewrite, export | built | `app-src/components/AssetDrawer.jsx` |
| Stripe: 3-day paid trial, plan gating, webhooks with idempotency | built | `backend/routes/{payments,webhooks}.js` |
| Lifecycle email: outbox, backoff, dead-letter, **unsubscribe + suppression** | built | `backend/lib/{lifecycle-email,email-consent}.js` |
| Analytics: canonical event registry, value funnel, dedupe, PII redaction | built | `backend/lib/analytics.js` |
| Admin: scorecard, readiness, cohort funnel maths | built | `backend/lib/cohort.js`, `backend/routes/admin.js` |
| Prompt registry (immutable, append-only) | built | `backend/lib/prompt-registry.js` |

### Deliberately NOT built, and why

These are not oversights. Re-requesting them needs an argument, not a prompt.

- **Publishing or scheduling to any channel.** Social plans content; it never
  posts. Ads produce briefs, not live campaigns.
- **SEO metrics.** Keyword volume, difficulty and rankings are not available
  from a trustworthy free source, so SEO output is ideation plus a research
  workflow. Fabricated metrics are actively rejected.
- **Re-engagement email on inactivity.** No threshold distinguishes a lapsed
  user from a busy one.
- **Signed shareable download URLs.** Exports stream to the authenticated user;
  there is no link to leak or expire.
- **A prompt-version bump without live evaluation.** Bumping the version claims
  output improved; that claim needs the credentialed eval harness.

## Stack

Node.js + Express (CommonJS, plain JS) · Supabase Postgres · Anthropic Claude
with structured JSON output · Stripe Checkout + webhooks · Resend · Vite +
React frontend in `app-src/`, built to `app/`.

No TypeScript, no Zod, no ORM. The route is the security boundary — the
service-role client bypasses RLS, so **every workspace-scoped query filters on
both id and owner**.

## Working on it

```bash
npm ci               # at the repo root — the ONE dependency manifest (root package.json + package-lock.json)
npm run dev          # node --watch backend/server.js, port 3002
npm test             # unit + contract tests, no credentials needed
npm run lint
npm run build:app    # rebuild app/ from app-src/
npm run check:app-fresh
npx playwright test  # public-page e2e (no credentials; signed-in journeys need live Supabase)
```

`npm test` needs no secrets and no network. Signed-in browser journeys cannot
run here: auth validates against Supabase Auth and the e2e harness is
credential-free by design, so logic behind the login is covered by pure unit
tests instead.

Migrations in `backend/migrations/` are **owner-applied** — nothing runs them
automatically.

## Documentation

| Doc | Purpose |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Architecture and rules for AI coding agents |
| [`docs/CONFIGURED_STATE.md`](docs/CONFIGURED_STATE.md) | What is already set up in production |
| [`docs/GO_NO_GO_V10.md`](docs/GO_NO_GO_V10.md) | Historical v10 gate (SUPERSEDED) |
| [`docs/V10_PLAN.md`](docs/V10_PLAN.md) | The v10 execution plan |
| [`docs/GOLDEN_EVAL_V10.md`](docs/GOLDEN_EVAL_V10.md) | What the quality gate does and does not measure |
| [`docs/LIFECYCLE_EMAIL_V10.md`](docs/LIFECYCLE_EMAIL_V10.md) | Every email, its trigger, dedupe key and category |
| [`docs/RUNBOOK_TRANSACTION_REHEARSAL.md`](docs/RUNBOOK_TRANSACTION_REHEARSAL.md) | Owner-run live money rehearsal — ordered A–H COMPLETE (v23: H/refund real Stripe time 2026-09-05T16:11Z, after G) |
| [`docs/prompts/v16/HANDOFF.md`](docs/prompts/v16/HANDOFF.md) | **Start here.** Current owner/next-writer handoff: state, closed work, accepted risks, next focus |
| [`docs/OWNER_HANDOFF_V15.md`](docs/OWNER_HANDOFF_V15.md) | Prior owner handoff (SUPERSEDED by v16) |
| [`docs/LAUNCH_STATE.md`](docs/LAUNCH_STATE.md) | Generated launch truth — never edit by hand |
| [`docs/RUNBOOK_AUTH_E2E.md`](docs/RUNBOOK_AUTH_E2E.md) | Running the signed-in browser matrix |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) · [`DEVELOPMENT.md`](DEVELOPMENT.md) | Deploy and local setup |

## Status

The launch verdict is **computed, not declared here** — from
[`docs/launch/launch-state.json`](docs/launch/launch-state.json), by
`npm run launch:gate`. This README states product capability and links to that
canonical truth; it does not independently declare a track open or GO. The two
tracks are not on the same footing, and accepted risk never produces a full GO:

| Track | Verdict | On what |
|---|---|---|
| Capped beta | NO-GO (pending owner RC) | v24 changed code; no candidate is frozen at an exact SHA yet |
| Public paid launch | NO-GO (pending owner RC) | needs a green RC run, deploy and readiness at the exact v24 FINAL SHA |

This is a release-integrity hold, not a product regression: every P0/P1 blocker
stays closed and the owner evidence below carries forward (the v24 diff touches
no billing, webhook, AI or migration runtime). The owner steps that restore GO
are in [`docs/evidence/OWNER_CHECKLIST_v24.md`](docs/evidence/OWNER_CHECKLIST_v24.md).

Proven against production: migrations `001`–`040` applied (001-037 verified
2026-07-28; 038-040 verified by the 2026-09-21 read-only owner probe), Stripe
ownership **enforcement** live (`app_user_id` arbiter non-partial UNIQUE,
`stripe_ownership_uniqueness_ready()` = true), configuration verified via
`/api/admin/readiness` (`mode: production`, all readiness checks green, 0
blockers), unsubscribe suppression honoured in both directions, and a daily AI
spend ceiling live.

The automated signed-in browser matrix runs against a disposable non-production
Supabase and ran **green in CI** on the v23 line (release-candidate runs on the
docs-only descendants of the v23 tree) — the `P0-no-authenticated-e2e` blocker is
**closed**; for v24 it must run again at the exact FINAL SHA. The router RSC advisory is
**closed** (guard green, no RSC entry point). The live billing rehearsal — the
canonical eight-transition **ordered** A–H matrix — is **complete**: after the v23
ordering validator caught a data-entry timestamp on H, the owner's Stripe evidence
showed the refund (`re_3UBD6L…`) actually occurred `2026-09-05T16:11Z`, ~15h after
G; corrected to that real time, `npm run rehearsal:validate` passes (time-monotone,
complete) and the refund alone left entitlement unchanged. No P0/P1 blocker remains
open or accepted. v23 computed a full GO, but its CI provenance was not exact-SHA
(no release-candidate run ever had the v23 candidate's own head SHA, and `/health`
exposed no version), so v24 re-establishes it at one FINAL SHA — `GET /health` now
reports the deployed commit's short SHA. (Exact counts and the full blocker list
live in the canonical launch-state, not here.)

Start with [`docs/prompts/v16/HANDOFF.md`](docs/prompts/v16/HANDOFF.md) for the
full picture and what to pick up next. Earlier GO/NO-GO and handoff documents
(`v9`, `v10`, `v12`, `v15`) are historical and carry SUPERSEDED banners.
