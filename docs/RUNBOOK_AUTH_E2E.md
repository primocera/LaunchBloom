# Runbook — running the authenticated browser matrix

**Why this exists:** until v11 the signed-in product had no browser coverage at
all. Every authenticated route redirected the credential-free Playwright harness
to login, so the Create resolver, campaign workspace, review workbench, library
and handoff were verified by unit tests only. Rendering, focus order, mobile
layout and recovery behaviour behind the login were unverified — and the gate
said so honestly rather than claiming otherwise.

`npm run test:e2e` still runs credential-free and covers the public surface.
The authenticated matrix is opt-in **because it needs a real database**, not
because it is optional. Not running it is a release blocker.

## What you need

A **non-production** Supabase database with the full migration set applied, plus
`backend/migrations/E2E_MARKER.sql` run **against that database only**.

> **Corrected 2026-07-28.** This runbook previously said pointing the harness at
> the live project "cannot work even by accident". That was wrong. The seed
> endpoint's other guards check the *process* — launch mode, an enable flag, a
> secret — and a local run with `SUPABASE_URL` set to production passes all of
> them, because `NODE_ENV` is not production and the Stripe key is blank. It
> would have created rows and real auth users in production. The marker table
> fixes it: the database opts in from inside itself, and no environment variable
> can fake that.

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | the non-production database |
| `SUPABASE_ANON_KEY` | sign-in from the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | seeding and cleanup |
| `E2E_SEED_SECRET` | 24+ characters; authenticates every seed request |
| `E2E_AUTH=1` | adds the authenticated projects to the Playwright config |

## Getting a database if you are on the Supabase free plan

You do not need a paid plan, and you must not use the production project — nor
the Mellowa project, which is *its own* production for a different app. The
runner refuses both (see "Refusing the wrong target" below).

> **If both free slots are already used** (e.g. Scalvya-prod and Mellowa-prod):
> the free limit is **two active projects _per organization_, not per account**.
> Create a **new (free) Supabase organization** and you get two more free
> project slots at no cost — put the disposable Scalvya-E2E project there. This
> is the simplest path on Windows and needs no Docker.

**Option A — a second free Supabase project (new org if needed).** The free plan
includes two active projects per organization. Create the throwaway project, run
every numbered migration `001`–`037`, then run `E2E_MARKER.sql`. About ten
minutes, and it matches production most closely.

**Option B — a local Supabase stack.** Free and completely isolated, but needs
Docker Desktop (which on Windows 10 Home means WSL 2):

```bash
npm i -D supabase
npx supabase init
npx supabase start          # prints SUPABASE_URL and local anon/service keys
# apply 001-037, then E2E_MARKER.sql, against the printed connection
```

**Not an option: the production project.** The suite creates auth users and
deletes workspaces. Cleanup is prefix-scoped so it would not remove your real
data, but it writes real rows to the database your customers depend on, and a
half-finished run leaves them there. The marker table now refuses this outright.

Stripe, Resend and Anthropic keys are **deliberately blanked** by the config.
No test can spend money, send mail or call a model; entitlement states are
asserted against the server's refusal rather than by granting a plan.

## Refusing the wrong target (v12 SC-V12-03)

The database marker is the ultimate backstop: seeding fails closed unless the
target contains `public.e2e_seed_marker`. On top of it, the runner refuses known
production and other-app projects *before it writes anything*, so a mistyped
`SUPABASE_URL` never reaches the seeding round-trip.

List the project refs you never want seeded in `E2E_FORBIDDEN_SUPABASE_REFS`
(comma-separated). A "ref" is the subdomain of the Supabase URL —
`https://<ref>.supabase.co`:

```bash
# both of your live projects, so the runner refuses either by mistake
export E2E_FORBIDDEN_SUPABASE_REFS="scalvyaprodref,mellowaprodref"
```

If `SUPABASE_URL` resolves to a listed ref the runner exits non-zero with
`REFUSED`, printing only the *outcome* — never the ref or any key. A local stack
(`http://127.0.0.1:54321`) has no ref and is allowed; the marker still guards it.

## Running it

```bash
export SUPABASE_URL=...            # non-production project
export SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...
export E2E_SEED_SECRET="$(openssl rand -hex 20)"
export E2E_FORBIDDEN_SUPABASE_REFS="scalvyaprodref,mellowaprodref"   # recommended

npm run test:e2e:auth
```

`npm run test:e2e:auth` runs all three projects (desktop, mobile, keyboard)
through `scripts/e2e-auth.mjs`, which classifies the outcome as PASS, FAIL,
BLOCKED (missing env) or REFUSED (forbidden target) and writes redacted evidence
to `test-results/e2e-auth-evidence.json` — candidate SHA, environment class,
project names, pass/fail/skip counts and timestamps, no secrets.

### Release-candidate mode

Set `RC_GATE=1` when the run is the release-candidate gate. In that mode **any
skipped required test is a hard failure**, because a required journey that did
not execute is not evidence it works:

```bash
RC_GATE=1 npm run test:e2e:auth
```

Ordinary local runs (no `RC_GATE`) still fail on a real failure but tolerate a
skip; the release-candidate workflow (SC-V12-05) sets `RC_GATE=1`.

## What it does to the database

Each test seeds its own isolated dataset under a fresh run id and deletes it
afterwards. Every seeded identity is `e2e-run-<id>-<scenario>@e2e.invalid` —
`.invalid` is reserved by RFC 2606 and can never resolve, so a seeded account
cannot be mailed even if a lifecycle job picks it up. Cleanup is filtered by
that exact pattern, so it cannot remove a row it did not create.

If a run is interrupted, leftover rows are removed by re-running the suite or
by calling the cleanup endpoint directly:

```bash
curl -X DELETE -H "x-e2e-seed-secret: $E2E_SEED_SECRET" \
  http://127.0.0.1:3109/api/e2e/seed/<run-id>
```

## When it cannot run

The suite **fails** with a `BLOCKED` message naming the missing variables. It
does not skip. Record the result in `docs/launch/launch-state.json`:

```json
{ "id": "e2e_authenticated", "status": "skipped", "observed_at_sha": null, "evidence": null }
```

`npm run launch:gate` then reports NO-GO for both tracks, which is the correct
outcome: the paid journey has not been proven at this commit.

## Recording a successful run

Set the check to `passed_locally` (or `passed_ci`), pin `observed_at_sha` to the
exact commit and put the report path in `evidence`. Any later commit invalidates
it — the gate compares the manifest SHA against HEAD.
