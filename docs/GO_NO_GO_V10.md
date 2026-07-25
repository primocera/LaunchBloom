# GO / NO-GO — Scalvya v10 Release Candidate

**Status legend (kept distinct, never conflated):** `TESTED LOCALLY` ·
`CONFIGURED` · `VERIFIED IN CI` · `REHEARSED LIVE` · `OBSERVED OVER TIME` ·
`OUTSTANDING (owner)`.

Sealed by SC-V10-08. No features were added during this gate.

## Frozen RC

- Reviewed baseline: `4b6d55d` (v9 merge to `main`) — confirmed as the `v10`
  branch point; **no drift**.
- RC content commit: `fd354ad` (SC-V10-08 privacy fix), sealed by this gate
  commit on branch `v10`.
- v10 range: `4b6d55d..HEAD` — **14 commits**, SC-00 → SC-08.
- Migrations on disk: **37** (`001`–`036` plus `CHECK_APPLIED.sql`).
  v10 adds one: `036_email_suppressions.sql`.
- Built bundle: `index-CkEWUQmF.js` · `index-Cp3C9z19.css`.
- Rules pinned: consistency `v8.1`, dependencies `v8.1`, packet `handoff-1`,
  prompts `v2`, golden corpus `v10.1`.

## Automated evidence — `TESTED LOCALLY` at the frozen commit

| Check | Command | Result |
|---|---|---|
| Unit / contract / safety | `npm test` | **451 pass / 0 fail** |
| Browser journeys | `npx playwright test` | **27 pass / 0 fail** |
| Lint | `npm run lint` | 0 errors (10 pre-existing warnings) |
| Production build | `npm run build:app` | success |
| Bundle freshness | `npm run check:app-fresh` | matches `app-src/` vs HEAD |
| Whitespace | `git diff --check` | clean |

Test growth over v10: 355 → 451 (**+96**). New suites: webhook-ordering,
asset-rows, handoff-docs, landing-contrast, email-consent, cohort,
workspace-data, plus the golden campaign corpus.

## Migrations — applied, not merely present

`release-check` reports migrations as "present", meaning **on disk**. It never
connects to the database. On 2026-07-26 that distinction turned out to matter:
`034`, `035` and `036` were unapplied in production, `034`/`035` since v9
shipped three days earlier. Handoff staleness had never worked, and nothing
surfaced it — the client swallows that write error by design.

**Owner ran `backend/migrations/CHECK_APPLIED.sql` on 2026-07-26: all 36
migrations now return `applied = true`.** `VERIFIED` — against the database.

**Gate rule:** migration evidence must come from `CHECK_APPLIED.sql`, never
from `release-check`.

## Production configuration — `CONFIGURED`

Per `/api/admin/readiness` on 2026-07-26: `mode: production`, `ready: true`,
`blockers: 0`, `external: 0`. Stripe prices, Resend delivery, legal identity
and cron secret all configured. Recorded in `docs/CONFIGURED_STATE.md`.

Run locally at the frozen commit, `release-check` reports `cron:secret` and
`email:delivery` as missing — this is the fail-closed design working in a shell
with no production secrets, **not** a regression. There is deliberately no
secret-bearing CI job (free tier; a red job would consume paid minutes and mail
the owner), so production config is `CONFIGURED`, never `VERIFIED IN CI`.

## P0s found and fixed during v10

Both were live defects, not hypotheticals.

1. **Entitlement revoked on an out-of-order webhook** (SC-00). `invoice.
   payment_failed` was the only Stripe handler with no staleness guard and
   never stamped `stripe_event_at`. A late failure delivered after the recovery
   `invoice.paid` flipped a recovered subscription back to `past_due`, cutting
   off a customer who had just paid. Stripe guarantees neither ordering nor
   exactly-once delivery, so this was reachable in normal operation.
   Fixed, guarded, 7 regression tests.

2. **Account export and deletion missed 10 tables** (SC-08). `WORKSPACE_TABLES`
   had drifted for thirty migrations, omitting `campaigns`, `brand_profiles`,
   `evidence`, `asset_versions` and six more. Erasure returned a receipt
   reporting success while the user's campaigns and brand facts remained in the
   database. Invisible because both operations skip missing tables by design.
   Fixed, ordered children-first, and the coverage test now derives the list
   from the migrations so it cannot drift again.

## Accessibility defect found and fixed

The hero eyebrow carried both `.lp-eyebrow` and `.lp-hero-eyebrow` at equal
specificity, with the generic rule declared later — so it rendered blue on the
blue sky at **1.10:1**, effectively invisible, and had been shipping that way.
Hero copy also used translucent white measuring as low as 2.07:1. Both fixed;
guarded by a stylesheet contrast test and a browser assertion on computed
colour. The CSS test alone did **not** catch the cascade conflict — only the
browser did.

## Risk register

**P0 (block release): none open.** Both P0s above are fixed and tested.

**P1 (before cohort expansion):**
- **Live money rehearsal unrecorded** — charge → cancel → reactivate → recover
  → refund, journeys 1–13 in `RUNBOOK_TRANSACTION_REHEARSAL.md`. *Owner.*
  Journey 13 specifically confirms the SC-00 ordering fix against live Stripe.
- **Resend behaviour after `036`** — an unsubscribe must suppress optional mail
  while billing mail still arrives. *Owner.*
- **`AI_SPEND_DAILY_CEILING_USD` unset** — no daily spend cap before real users
  generate. *Owner.*

**P2 (documented, not built):**
- No signed shareable download URLs (exports stream to the authenticated user).
- No live/semantic model eval; prompts stay at `v2` because improvement cannot
  be measured without the credentialed harness. A version bump would be a claim
  with no evidence.
- Interview consent flow is documented, not built as UI.
- Pruning candidates in `BETA_PLAN_V10.md` await beta usage data.

## Coverage this gate does NOT claim

Stated plainly rather than buried:

- **No signed-in browser journey exists.** Auth validates against Supabase Auth
  and the Playwright harness is credential-free by design, so every signed-in
  route redirects to login. The Create resolver, campaign asset drawer, deep
  links, admin cohort view and keyboard paths are covered by **pure unit tests
  only**. Rendering, focus order and mobile layout behind the login are
  unverified.
- **No load or concurrency testing.** A 0-row outbox backlog and 0 webhook
  failures describe a healthy idle system, not throughput.
- **DOCX/PDF verified by parsing, not by opening.** The `.docx` was extracted
  with .NET's OPC zip stack and its XML parsed; every PDF xref offset and
  stream length was checked. Neither has been opened in Word or Acrobat.

## Rollback

- v10 commits are independent and additive; revert the offending commit.
- Only one migration (`036`) is additive — a new table and a nullable column.
  Safe to leave applied if application code is rolled back.
- The SC-00 webhook guard fails safe in the conservative direction: if it
  misfires it **preserves** entitlement rather than revoking it.
- `BETA_INVITE_CAP` unset reopens signup instantly; it fails open by design.
- Stale bundle on `main` → `npm run check:app-fresh` fails the gate; rebuild.

## Verdict

- **GO** to merge the v10 RC to `main` on automated evidence: full gate green
  at `fd354ad`, no P0 open, migrations verified applied against the database.
- **NO-GO for public paid launch** until the owner records the live money
  rehearsal (P1), confirms Resend suppression behaviour, and sets a daily AI
  spend ceiling.
- **NO-GO for cohort expansion beyond the 15–25 cap** in `BETA_PLAN_V10.md`
  until the funnel shows accounts reaching handoff export.

Automated readiness is not a paid-launch GO. It never was, and the two P0s
found during this gate — both invisible to every existing check — are the
argument for why.

Signed: Claude Code (automated gate) · Owner sign-off: `__________`  Date: `__________`
