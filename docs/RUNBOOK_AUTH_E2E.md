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

A **non-production** Supabase project with the full migration set applied. The
seed endpoint refuses to run under a production launch mode, so pointing this at
the live project cannot work even by accident.

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | the non-production project |
| `SUPABASE_ANON_KEY` | sign-in from the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | seeding and cleanup |
| `E2E_SEED_SECRET` | 24+ characters; authenticates every seed request |
| `E2E_AUTH=1` | adds the authenticated projects to the Playwright config |

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
