# Tests, technical debt and architecture

## T1. The suite is wide but mostly mocked (Medium)

137 test files, about 1,000 tests. Almost all run against a mocked Supabase client; one (`pg-app-user-id-uniqueness`) uses real Postgres through pglite. That one test is the one that caught the v21 `ON CONFLICT` defect. The findings in this audit are the same kind: they depend on real constraints, real concurrency or a real error object, which a mock that returns `{ data }` cannot show.

**Recommendation:** grow the pglite layer for the few places where the database is the logic. Do not add more mocked tests for these.

## T2. Missing tests, by finding

| Finding | Test |
|---|---|
| B1 | pglite: upsert on `app_user_id` when the email already exists on another row |
| B2 | Subscription update with a failing customer lookup throws; a lookup miss keeps the existing `customer_id` |
| B3 | Deletion with a failing Stripe cancel deletes nothing |
| B4 | `created(incomplete)` delivered after `updated(active)` with the same `event.created` ends `active`; two concurrent deliveries of one event process once |
| B6 | `invoice.payment_failed` after a newer `subscription.updated` still queues the email |
| M1 | Count query error returns 503, not a free generation |
| M2 | A `reserved` row older than the TTL does not count |
| M3 | Window start is the same before and after an email change |
| A1 | Idempotency result is stored before the response is sent |
| A4 | Total generation time never exceeds the deadline |
| D1 | pglite: ten parallel `ensureWorkspace` calls create one workspace; a read error creates none |
| D2 | Migration test: every `create table` has RLS enabled |

## T3. The signed-in end-to-end run

Project notes say the authenticated e2e job on `rc/v25` was failing with the cause unread, possibly a paused test Supabase project. Until that is green, nothing exercises the real cookie flow, real Stripe test mode or the real schema together. This is the highest-value existing test and it should be repaired before new ones are written.

## T4. Dead and duplicate code to remove

| Item | Where | Note |
|---|---|---|
| Credit gate from ConversionForge | `lib/gate.js`, credit helpers and Storage JSON in `lib/auth.js:19-42,96-110` | Not mounted anywhere; racy by design |
| Storage-JSON spend fallback | `lib/spend-guard.js:77-108` | Only for a database without migration 024 |
| Pre-enforcement billing branches | payments, webhooks, customers, account | Remove after B5 |
| Legacy price-only ownership fallback | `stripe-ownership.js` `LEGACY_PRICE` | Already off under enforcement |
| Lifetime `payments` grant | `routes/customers.js:208-218` | B7 |
| Unused endpoints | B9 | |
| Legacy price env vars | `STRIPE_PRICE_STARTER/_PRO/_BUSINESS` | Confirm unset in production first |
| Identical scripts | `test`, `test:unit`, `test:integration` in `package.json` | Same command three times |
| "Migration not applied" tolerances | `usage.js`, `idempotency.js`, `account.js` | Each is a fail-open path kept for a state production is no longer in |
| Untracked root clutter | `.docx` packs, PNGs, `scripts/_*.tmp.mjs`, `env local.txt` | `env local.txt` is git-ignored but holds secrets in a file with a space in its name; move it to `backend/.env` |

Removing these shrinks the billing files noticeably and deletes several fail-open branches outright.

## T5. Decisions worth challenging

**The release process outweighs the product risk it guards.** `lib/launch-state.js` is 1,073 lines, larger than any product module except campaigns. There are 138 tracked docs, 19 evidence files, and tests that check documents agree with each other. Meanwhile the defects above sat in the main paths. The process verifies that claims match evidence; it does not find bugs. Suggestion: freeze it as is, stop extending it, and put that effort into the pglite tests and the e2e run.

**Two regimes for one behaviour.** Feature flags that are permanently on in production (`STRIPE_OWNERSHIP_ENFORCED`) and tolerances for unapplied migrations double the code paths in the most sensitive files. Each was right during rollout. They should now be collapsed.

**Service-role everywhere.** Every query bypasses RLS, so each route is its own security boundary, and one forgotten `.eq('workspace_id', ...)` is a data leak. The library route does this well. A cheap structural guard: a `scoped(ws)` query helper that always applies the workspace filter, used for all workspace tables, plus a test that greps routes for raw `supabase.from(<workspace table>)`.

**Committed build output.** `app/` is built locally and committed, with a freshness check. It works, but every frontend change produces a bundle diff and a forgotten rebuild fails CI. Vercel can build with an explicit output directory; the note in `package.json` says an earlier attempt failed on `dist/` detection, which `outputDirectory` in `vercel.json` addresses. Low priority.

**Shared Stripe account.** See B11.

**Proxying all auth through Express.** It gives HttpOnly cookies, which is good. The costs are S1 (Supabase's IP limits stop working), a network call per request, and hand-written cookie and refresh logic. Keep the design; fix S1 and S5.

## T6. Dependencies

- `stripe ^14` with API `2023-10-16` against an account on a 2026 API version (B8).
- `express ^4` with manual overrides for `body-parser`, `qs`, `zod`. Works, but each advisory needs a hand edit; Express 5 removes two of the overrides.
- `@anthropic-ai/sdk ^0.71`: fine; check it still matches the structured-output parameters in use when the model changes.
