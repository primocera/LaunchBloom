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

You do not need a paid plan, and you should not use the production project.

**Option A — a second free Supabase project.** The free plan includes two active
projects per organization, so this usually costs nothing. Create it, run every
numbered migration `001`–`037`, then run `E2E_MARKER.sql`. Takes about ten
minutes and matches production most closely.

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

## Running it

```bash
export SUPABASE_URL=...            # non-production project
export SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...
export E2E_SEED_SECRET="$(openssl rand -hex 20)"

E2E_AUTH=1 npx playwright test --project=authenticated
E2E_AUTH=1 npx playwright test --project=authenticated-mobile
E2E_AUTH=1 npx playwright test --project=authenticated-keyboard
```

Or all of them: `npm run test:e2e:auth`.

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
