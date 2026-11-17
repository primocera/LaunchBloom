# Scalvya engineering audit (2026-11-15)

Read-only review of `main` at `b3429c8`. No code was changed. Nothing here was run against production; every finding comes from reading the code and migrations.

## How to read this

| File | Covers |
|---|---|
| [01-billing-and-webhooks.md](01-billing-and-webhooks.md) | Stripe checkout, webhook mirror, account deletion, ownership regime |
| [02-metering-and-ai.md](02-metering-and-ai.md) | Plan gate, usage ledger, spend guard, AI orchestration, idempotency |
| [03-auth-and-data.md](03-auth-and-data.md) | Sessions, rate limits, workspaces, RLS, error handling, headers |
| [04-tests-debt-architecture.md](04-tests-debt-architecture.md) | Missing tests, dead code, architecture decisions worth challenging |
| [05-blueprint-comparison.md](05-blueprint-comparison.md) | The project measured against the original OfferFlow blueprint (one page available) |
| [NEXT_SESSION.md](NEXT_SESSION.md) | Handoff: ordered task list with file/line anchors |

Each finding has an ID, a severity and a confidence:

- **Confirmed**: the defect is visible in the code as written.
- **Needs live check**: the code allows it, but the outcome depends on production state (database grants, env vars, Stripe settings).

## Scope and limits

Read in full: `server.js`, `lib/auth.js`, `lib/session.js`, `routes/auth.js`, `lib/plan-limits.js`, `lib/usage.js`, `routes/customers.js`, `routes/payments.js`, `routes/webhooks.js`, `lib/stripe-ownership.js`, `lib/subscription-state.js`, `routes/account.js`, `lib/supabase.js`, `lib/spend-guard.js`, `lib/idempotency.js`, `lib/ai.js`, `routes/email-preferences.js`, `routes/events.js`, the first 330 lines of `routes/workspaces.js`.

Sampled by search only: `routes/library.js`, `routes/campaigns.js`, `routes/assets.js`, `routes/admin.js`, migrations, CI workflows, `app-src/lib/api.js`.

Not reviewed: the React app beyond its fetch client, `lib/launch-state.js`, `lib/lifecycle-email.js`, `lib/handoff-docs.js`, the export path, prompt quality, the test files themselves.

## Top priorities

Ordered by damage if left alone. Details are in the linked files.

| # | ID | Severity | Problem | Why it matters |
|---|---|---|---|---|
| 1 | B1 | High | A returning or email-colliding user can never check out (`customers.email` is UNIQUE, upsert conflicts on `app_user_id`) | Lost revenue from exactly the people trying to pay again |
| 2 | B2 | High | A subscription webhook can overwrite `customer_id` with null | A paying customer silently drops to Free for up to a billing cycle |
| 3 | B3 | High | Account deletion continues when the Stripe cancel fails | Customer keeps being charged with no account to log in to |
| 4 | M1 | High | Usage counting and reservation fail open on a database error | Unmetered AI spend during any Supabase hiccup |
| 5 | M2 | High | Stuck `reserved` usage rows count forever | Users lose quota permanently after a timeout; trial users worst hit |
| 6 | D1 | High | `ensureWorkspace` creates a new workspace when its read fails, and races on first login | Users see an empty app ("my work is gone"); duplicate workspaces |
| 7 | D2 | High, needs live check | Five tables have no RLS in the migrations | Recipient emails and audit data readable with the anon key |
| 8 | B4 | High | Out-of-order webhooks in the same second can leave a stale status | Paid subscriber mirrored as `incomplete`, no access |
| 9 | S1 | Medium | Rate limiters are in-memory on serverless, and the 100 requests per 15 minutes cap is per IP | Brute-force limits are weak, while an agency office behind one IP can be throttled |
| 10 | B5 | Medium | `STRIPE_OWNERSHIP_ENFORCED` defaults off and is not validated at startup | One missing env var silently reverts billing identity to email |
| 11 | A1 | Medium | Work fired after the response is sent (idempotency result, analytics) can be lost on Vercel | Double generations and undercounted funnel metrics |
| 12 | A3 | Medium | Global daily AI cap (default 300 calls) has no per-user share | One heavy user can stop generation for everyone |

## What is in good shape

Worth saying so it is not reworked: Stripe signature verification and raw-body mounting, the typed ownership classifier, fail-closed entitlement (`unavailable` is never read as `free`), server-derived checkout identity and return URLs, HttpOnly cookies with SameSite=Lax, the recovery-marker guard on password reset, account-enumeration-safe auth responses, the library table allowlist with workspace-scoped lookups, and the atomic daily spend ledger.

## A note on the standing "no new engineering pack" rule

`CLAUDE.md` says not to invent hardening work by auditing the repo unasked. This audit was requested directly by the owner, so it exists; but none of it is authorised for implementation yet. Before fixing anything, the owner should name which findings to take. The first six in the table are defects that affect paying customers, not hardening.
