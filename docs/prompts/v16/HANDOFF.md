# v16 HANDOFF — for the next prompt-pack writer

Everything done in the v16 pass, the bugs fixed, and the exact launch state you
inherit. Read this before writing the next pack so you do not re-sell work that
is already closed.

Product candidate: **`948a6af`** (v16, cut 2026-08-10, branch `main`, pushed).
Bundle `index-KvmoZn9d`. Canonical GO/NO-GO: `docs/launch/launch-state.json`
(rendered to `docs/LAUNCH_STATE.md`). `launch:gate` → **capped_beta GO,
public_paid CONDITIONAL GO**.

---

## 1. What the v16 prompt pack executed (SC-95 / XAPP-95)

All committed earlier in the v16 lineage (see `git log`):

- **SC-95-01 / XAPP-95-01** — Stripe-customer ownership verified at *every*
  acceptance path: checkout, durable DB link, billing **portal**, account
  **delete**, and **webhook**. `isOwnedScalvyaCustomer()` predicate (not deleted
  + `metadata.source==='launchbloom'` + `metadata.app_user_id===userId`).
- **SC-95-02** — corrected the coding-agent architecture truth (Supabase Auth +
  HttpOnly cookies + stable user UUID; the stateless-HMAC model is retired) and
  added a scanner that fails release verification if a doc teaches the old model.
- **SC-95-03/04/05** — one executable value scorecard measuring repeat
  campaigns; handoff proves reduced rework; a weekly first-value/repeat-value
  beta decision loop.
- **XAPP-95-02** — evidence-based 9.5 re-score.

## 2. The headline v16 work — the authenticated E2E finally ran (and it was NOT green)

The authenticated seeded browser matrix (`npm run test:e2e:auth`,
`e2e/authenticated/*`) had been **owner-gated and recorded `skipped` since v11** —
it had **never actually executed** against a live Supabase. On 2026-08-10 it was
run for the first time against a disposable non-production EU Supabase project
(`E2E_MARKER.sql` opt-in). Result progression while fixing: **6 → 23 → 27 → 33 →
39 → 45 pass**. It is now **45/45 green** under the RC-gate runner (workers:2).

### Two real SHIPPED product bugs it caught (both fixed, `f37e0e1`)

1. **A transient plan-verification 503 bounced a signed-in user to `/app/login`.**
   `app-src/lib/auth.jsx` retried `/api/auth/me` on `PLAN_UNAVAILABLE` with a
   bare `return refresh(attempt+1)`. In an async function the outer call's
   `finally { setLoading(false) }` runs **before** the returned retry resolves,
   so React rendered `loading:false, planUnavailable:null` for one frame and the
   `App.jsx` guard redirected to login before the safe state was set. Fix:
   `return await`; and `App.jsx` now renders the retryable "We couldn't verify
   your plan" `ErrorState` instead of `<Navigate to="/app/login">` when
   `!account && planUnavailable`.
2. **The Library route `/app/assets` 404'd when the backend serves the SPA.**
   Vite emits build assets under `/app/assets/`, and `express.static`
   301-redirected the client route into that dir, which the SPA fallback
   excludes. Fix: `express.static(appDir, { redirect: false })` in
   `backend/server.js` (matches Vercel).

### Latent HARNESS bugs (the suite had never run) — all fixed

- `problems` watcher failed every navigating test on the browser's benign
  `Failed to load resource: 401` (the logged-out `/api/auth/me` probe) and
  nav-aborted requests → now catches `pageerror` + real `console.error` only.
- Login never actually authenticated: `waitForURL(/\/app(\/|$)/)` also matched
  `/app/login` → now waits for a real non-login `/app` route + `/api/auth/me==200`.
- The `request` fixture was a separate unauthenticated context → bound to
  `page.request`.
- `body.innerText()` read before React paints → `mainText(page, expected)`
  helper waits for the content.
- `keyboard.spec.js:76` had no `workspace` fixture (never logged in); selector
  fixes (`.first()`, `/brand name/i`); `/review` not the unused `/consistency`
  provider; seed fixture now carries `brand_name` (the UI key), not just `name`.

Full detail: **`docs/prompts/v16/E2E_AUTH_FINDINGS.md`**.

> **Effort note:** getting this matrix from its first run to 45/45 green took
> **over 10 hours** — the suite had never executed, so it was a layered dig
> (Supabase schema/grants + Auth rate limits, the SERVE_APP/bundle wiring, the
> harness bugs, then the two real product bugs). Budget accordingly if a future
> pack reopens the authenticated E2E.

## 3. The v16 candidate cut (release engineering)

Because v16 changed frontend source and the served bundle, the prior candidate's
frontend carry-forwards did **not** apply. Following the manifest's own
`how_to_create_a_new_candidate` runbook, **every** launch-critical check was
re-run at the candidate and re-pinned:

| check | result at `948a6af` |
|---|---|
| lint | 0 / 0 |
| unit | 914 / 914 |
| build | `index-KvmoZn9d.js` + `index-Ck_SQ1wq.css` |
| bundle-fresh | app/ == app-src/ |
| public E2E | 52 pass |
| **authenticated E2E** | **45 pass** |
| export | 15 / 15 |
| router reachability | 15 / 15 |
| hero contrast | 8 / 8 |
| release_config | carry-forward VALID (config-gate diff empty) |

Blocker **`P0-no-authenticated-e2e` → CLOSED**. `OWNER_HANDOFF_V15` superseded.

Note the two-commit dance: `948a6af` is the candidate because it carries the
`launch-state.test.js` change that is coupled to the manifest (and `backend/` is
not `docs/`-exempt); `38777d2` is a docs-only re-pin. Any future candidate cut
that touches a coupled self-test hits the same pattern.

## 4. What is STILL owner-gated — do NOT re-sell as undone automated work

`public_paid` is **CONDITIONAL GO**, resting on exactly two named accepted risks:

- **Live-money rehearsal — PARTIALLY DONE.** The owner took a **real $11.31
  charge** against live Stripe, confirming the live trial→paid conversion (the
  money moved). Status stays `not_run` because the gating item is the FULL
  eight-transition ordered sequence (A–H): the **refund**, and **step G** (a late
  `payment_failed` after a recovery) with out-of-order webhooks, remain. This is
  owner-only — Claude Code must never run a live charge/refund.
- **Router RSC advisory** `GHSA-qwww-vcr4-c8h2` — accepted, not reachable (no RSC),
  revisit at the react-router 8 / React 19 / Vite 7 migration.

`capped_beta` is **GO** for an invited, supervised cohort behind
`BETA_INVITE_CAP` — not public signup.

## 5. Guardrails that still hold

Verify against HEAD and build only the verified gap; no pricing / limit / trial /
status-enum / verdict edits; no new generators, share links, client accounts or
publishing; the canonical GO/NO-GO lives only in `docs/launch/launch-state.json`.
Editing anything outside `docs/` (or `*.docx`) after a candidate is pinned
invalidates it — the launch record commits must be documentation-only.
