# LaunchBloom — Development, Testing & CI

This is the reproducible build/test workflow added in Phase 1 (audit Prompt 1).

## One-command setup

```bash
npm ci            # root deps (Vite frontend + shared tooling)
cd backend && npm ci && cd ..   # backend runtime deps
```

Backend needs a `.env` — copy `backend/.env.example` and fill it in. Unit tests do **not** need any secrets (see below).

## Scripts (root `package.json`)

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Express API (`backend/server.js`, port 3002). |
| `npm run dev:app` | Start the Vite dev server (port 3000, proxies `/api` → 3002). |
| `npm run build:app` | Production build of `app-src/` → committed `app/` bundle. |
| `npm run lint` | ESLint over `backend`, `app-src`, `api` (flat config, warnings allowed). |
| `npm test` | Node's built-in test runner over `backend/tests/*.test.js`. No secrets required. |
| `npm run test:integration` | Same suite (integration tests share the runner). |
| `npm run test:e2e` | Placeholder until the Playwright suite lands (audit Prompt 17). |
| `npm run check:app-fresh` | Rebuild `app/` and fail if it drifts from `app-src/`. |

## Testing model

Tests use `node:test` + `assert` with `supertest` for HTTP routes. They run
**without any real Supabase/Stripe/Anthropic credentials**: `backend/tests/helpers.js`
swaps the lazy `lib/supabase` and `lib/stripe` proxies in `require.cache` for
in-memory fakes before the module under test is required. Stripe webhook
signature tests use the real SDK's local HMAC verification (no network).

Current coverage: auth middleware + session/password crypto, plan resolution
(`planFor`, `pricePlans`), plan gates and limits, checkout validation
(tampered/missing email, unknown plan, auth requirement, redirect origin),
and webhook signature handling.

Add a test file as `backend/tests/<area>.test.js`; it is picked up automatically.

## The committed `app/` bundle

Vercel serves the pre-built `app/` directory statically (there is intentionally
no `build` script — see the comment in `package.json`). Because `app/` is
committed, it can drift from `app-src/`. Two guards:

1. `npm run check:app-fresh` locally before committing frontend changes.
2. CI (`.github/workflows/ci.yml`) rebuilds `app/` and fails the job if
   `git status` shows any change under `app/`.

**Rule: after editing anything in `app-src/`, run `npm run build:app` and commit
the regenerated `app/` output in the same change.**

## Authentication (Supabase Auth)

Auth is **Supabase Auth** with **server-managed HttpOnly cookies** — there is no
token in localStorage. The backend (`backend/lib/auth.js` + `lib/session.js`)
validates the `sb_access` cookie against Supabase on every request and silently
refreshes it with `sb_refresh` when expired. The frontend never sees the token;
`app-src/lib/api.js` just sends `credentials: 'include'`.

Flows live in `backend/routes/auth.js`: signup, email verification, login,
logout (server-side revocation), forgot/reset password, resend verification, and
an email-link `/api/auth/callback` (uses `verifyOtp` with `token_hash`).

Setup requires `SUPABASE_ANON_KEY` plus enabling the Email provider and editing
the confirm/recovery email templates to the token_hash callback form — see
`backend/.env.example`. Run migration `backend/migrations/005_supabase_auth.sql`
(adds `workspaces.user_id`, backfills it, documents the forced-reset path for
existing scrypt users — their hashes cannot be imported into Supabase Auth).

Unit tests fake the auth client, so no live Supabase is needed to run them; a
true end-to-end (real verification email → cookie → refresh) needs the Email
provider enabled and the anon key set.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every PR:
clean `npm ci` → `lint` → `test` → `build:app` → stale-bundle check. No secrets
are configured or needed; the pipeline fails on broken source or a stale `app/`.
