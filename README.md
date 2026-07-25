# Scalvya

**Turn one offer into a launch-ready campaign.**

An AI marketing workspace for freelance marketers, boutique agencies and solo
founders. One approved campaign brief drives connected website copy, emails,
social posts, ad briefs and SEO ideas — with automatic consistency review and a
client-ready handoff packet.

*Launch-ready* means structured, connected and ready for human review. It never
means published, approved, fact-checked or compliant. Publishing stays with the
user.

---

## 📌 Writing the next prompt pack? Read this section first.

This repo has been built through successive prompt packs (v6 → v10). The most
common source of wasted work is a pack asking for something **that already
exists**, because the pack was written from the product vision rather than from
the code.

**Before specifying a feature, check the two files that record reality:**

| File | What it tells you |
|---|---|
| [`docs/CONFIGURED_STATE.md`](docs/CONFIGURED_STATE.md) | What is already configured in production (Stripe, Resend, legal config, cron). Verified from the live readiness endpoint, with a date. |
| [`docs/GO_NO_GO_V10.md`](docs/GO_NO_GO_V10.md) | The current release gate: what is proven, what is outstanding, what is deliberately deferred. |

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
cd backend
npm install
npm run dev          # nodemon, port 3002
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
| [`docs/GO_NO_GO_V10.md`](docs/GO_NO_GO_V10.md) | Current release gate and open risks |
| [`docs/V10_PLAN.md`](docs/V10_PLAN.md) | The v10 execution plan |
| [`docs/GOLDEN_EVAL_V10.md`](docs/GOLDEN_EVAL_V10.md) | What the quality gate does and does not measure |
| [`docs/LIFECYCLE_EMAIL_V10.md`](docs/LIFECYCLE_EMAIL_V10.md) | Every email, its trigger, dedupe key and category |
| [`docs/RUNBOOK_TRANSACTION_REHEARSAL.md`](docs/RUNBOOK_TRANSACTION_REHEARSAL.md) | Owner-run live money rehearsal |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) · [`DEVELOPMENT.md`](DEVELOPMENT.md) | Deploy and local setup |

## Status

Pre-launch. Automated gates are green; a live charge → cancel → recover →
refund rehearsal with owner-recorded evidence is required before public launch.
See [`docs/GO_NO_GO_V10.md`](docs/GO_NO_GO_V10.md) for the current verdict.
