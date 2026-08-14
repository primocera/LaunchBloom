# Threat model — Scalvya (v18 X06)

A consolidated, threat-driven security overview for a paid **multi-tenant** SaaS
that shares a Stripe account with sibling products (Mellowa, Frost). It does not
replace the deeper artifacts — it links them and states, per abuse case, the
control, the behavioural test that proves it, and the residual owner action.

**Non-claim:** this is an engineering threat model, not a legal/compliance
certification. Items marked *owner/legal* need a human decision, not code.

## Assets & trust boundaries

| Asset | Sensitivity | Boundary |
|-------|-------------|----------|
| Supabase session cookies (`sb_access`/`sb_refresh`, HttpOnly) | high | browser ↔ API |
| Stable user UUID + workspace ownership | high | API ↔ Supabase (service_role bypasses RLS → **the route is the security boundary**) |
| Campaign/brief/asset content, brand profile | medium (customer IP) | per-workspace |
| Stripe billing objects on a **shared** account | high | webhook ↔ mirror |
| Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_*`, `ANTHROPIC_API_KEY`, `SESSION_SECRET`) | critical | server-only, never client |
| Analytics/ops signals | low (must stay PII-free) | server → logs |

**Roles:** anonymous, authenticated user (owns their workspace(s)), admin
(`ADMIN_EMAILS` allowlist, read-only default), Stripe (billing truth), AI
provider (untrusted output).

## Deeper artifacts (authoritative detail)

- Cross-app / shared-Stripe isolation: [XAPP_ISOLATION_MATRIX.md](./XAPP_ISOLATION_MATRIX.md), [XAPP_ISOLATION_MATRIX_V16.md](./XAPP_ISOLATION_MATRIX_V16.md)
- Billing state semantics: [BILLING_STATE_MATRIX.md](./BILLING_STATE_MATRIX.md)
- Incident response & reconciliation: [RUNBOOK_INCIDENTS.md](./RUNBOOK_INCIDENTS.md)
- SLOs & alert thresholds: [SLOS.md](./SLOS.md)
- Entitlement policy: [decisions/2026-08-02-canonical-entitlement.md](./decisions/2026-08-02-canonical-entitlement.md)

## Abuse cases → control → evidence → residual

| # | Abuse case | Control | Evidence (behavioural test) | Residual / owner action |
|---|-----------|---------|------------------------------|-------------------------|
| 1 | **Cross-account access** (tenant A reads B) | every service_role query scoped by `user_id` (+ legacy email fallback); route is the boundary | `xapp-account-isolation.test.js`, `cross-app-isolation.test.js` | keep new routes scoped; add a test per new table |
| 2 | **IDOR** (guess an id) | `ownedCampaign`/workspace resolution rejects non-owned ids before any read/write | `billing-customer-ownership.test.js`, campaign/library ownership tests | no dedicated IDOR fuzz suite — *candidate hardening* |
| 3 | **Webhook forgery** | Stripe signature verified on **raw** body before `express.json()`; idempotency ledger (`stripe_events`) | `webhooks.test.js`, `webhook-ordering.test.js` | rotate `STRIPE_WEBHOOK_SECRET` per env (*owner*) |
| 4 | **Shared-billing contamination** (a peer product's object mutates us) | exact ownership rule `ownsSubscription` (discriminator `source=launchbloom`/`scalvya=1`; foreign stamp → drop; narrow legacy price fallback only) | `webhook-isolation.test.js` (foreign event: zero mutation/email/analytics), `webhook-reconcile.test.js` (foreign never adopted) | v18 S05 pull-reconciler reuses the same rule |
| 5 | **Missed/replayed/out-of-order webhook** | idempotency + `isStaleSubscriptionEvent` ordering guard; v18 pull reconciler detects `missing_local`/`status_drift` | `webhook-ordering.test.js`, `webhook-reconcile.test.js` | run `npm run reconcile:webhooks` after a failure spike (*owner*) |
| 6 | **Prompt injection** (user text steers the model) | brief context passed as delimited data, not concatenated into system copy; structured JSON-schema output; safety check | `safety-check.js`, golden evals | never make one model both sole generator and sole judge |
| 7 | **XSS / export injection** | HTML/filename sanitization, CSV formula-injection guard, zip-slip prevention in the export path | `handoff-export-integrity.test.js`, `safe-path.test.js` | keep export deterministic; no raw HTML passthrough |
| 8 | **Open redirect** (`?redirect=`/`next=`) | single internal-navigation validator `safe-path.js` refuses off-origin values (the React-Router advisory payloads) | `safe-path.test.js` | route every new redirect param through it |
| 9 | **CSRF** | HttpOnly cookies + CORS allowlist (`ALLOWED_ORIGINS`); state-changing routes require auth | `auth-routes.test.js`, CORS config in `server.js` | confirm allowlist per deploy env (*owner*) |
| 10 | **SSRF** | no user-supplied URL is server-fetched; AI provider host is fixed | n/a (no fetch-by-user-URL surface) | re-check if any "import from URL" feature is added |
| 11 | **Rate abuse / cost** | `express-rate-limit` (api/payment/ai limiters); AI spend ceiling + per-day BRAKE; cohort caps fail closed | `spend-ceiling-gate.test.js`, `cohort-control.test.js` | tune limits from real traffic (*owner*) |
| 12 | **Account enumeration** | signup/login return non-committal errors; rate-limited | `auth.test.js`, `auth-routes.test.js` | verify email-exists timing parity |
| 13 | **Token / secret leakage** | secrets server-only; logger + analytics + ops-signal redact tokens/email/content | `analytics-privacy.test.js`, `billing-privacy.test.js`, `logger.js` redaction | rotate on any suspected exposure (*owner*) |
| 14 | **Deletion failure** (data survives request) | account deletion propagates across owned tables + emits a receipt | `account-deletion-receipt.test.js` | confirm AI-provider retention with vendor (*owner/legal*) |

## Data lifecycle

- **Inventory:** brand profiles, campaigns/briefs, five asset tables, analytics
  events (ids only), subscriptions/customers (billing), lifecycle email outbox.
- **Minimisation to AI provider:** only the brief context needed for the next
  output; no secrets, no unrelated workspace data.
- **Retention/deletion:** account deletion removes owned rows and issues a
  receipt; analytics carries no content, so deletion propagation there is n/a.
- **Provider retention** (Anthropic/Stripe/Resend/Supabase): documented settings
  require **owner** confirmation — not asserted here.

## Priority residuals (no P0/P1 open without an owner decision)

1. **IDOR fuzz suite** (#2) — ownership is enforced and tested per route, but a
   negative-id fuzz pass across all `/api/*` object routes would raise assurance.
2. **CORS allowlist + webhook secret per environment** (#3, #9) — configuration,
   owner-verified at deploy.
3. **AI-provider data-retention confirmation** (#6, #14) — owner/legal.

These are hardening candidates, not known exploits. Anything discovered at P0/P1
must be recorded here with an explicit owner decision and expiry before release.
