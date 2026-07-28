# GO / NO-GO — Scalvya v11

> Generated conclusions in this file are derived from
> `docs/launch/launch-state.json`. If this document and that file ever
> disagree, the JSON wins and `npm run launch:verify` fails the build.

**Candidate SHA:** `86d1f2cc82688c23f258b3667564201394599603` · branch `v11`
**Bundle:** `index-B3BfQ7jf.js` · `index-BX-HQ_o_.css`
**Migrations on disk:** 37 numbered (`001`–`037`) plus `CHECK_APPLIED.sql`
**Reviewed baseline:** `445d29e` · drift `0ba7362`, `77009bc` (both verified, not re-implemented)

---

## Verdict

| Track | Verdict |
|---|---|
| Capped beta (15–25 accounts) | **NO-GO** |
| Unrestricted public paid launch | **NO-GO** |

Two different risk decisions, decided separately. Neither is close, and the
reasons are not the same for each.

### Why capped beta is NO-GO

| Blocker | Owner | Closure |
|---|---|---|
| Authenticated E2E has never run | owner | non-production Supabase project + `E2E_SEED_SECRET`, then `npm run test:e2e:auth` (`docs/RUNBOOK_AUTH_E2E.md`) |
| Production configuration unverified | owner | run `npm run release:check` in the production environment |
| `AI_SPEND_DAILY_CEILING_USD` unset | owner | set it; it is now a hard production release blocker |

**Closed 2026-07-28 —** migration applied-state. The owner applied `037` and
ran `CHECK_APPLIED.sql` against production; all rows `001`–`037` report
`applied = true`. That resolves the `034`/`035`/`036` contradiction in favour of
`GO_NO_GO_V10.md`: `CONFIGURED_STATE.md`'s migration table was wrong, not merely
stale. Evidence: `docs/evidence/2026-07-28-migrations-applied.md`.

### Additionally for public paid launch

| Blocker | Owner | Closure |
|---|---|---|
| Live money never rehearsed | owner | `docs/OWNER_EVIDENCE_V11.md` §A, all nine transitions |
| Resend suppression unverified after `036` | owner | `docs/OWNER_EVIDENCE_V11.md` §B |

Every remaining blocker is **owner-only**. There is no code work left in the
v11 scope that would move either verdict.

---

## What was verified at this SHA

Run locally at `86d1f2c`. **Not CI-verified** — the browser and export suites
are deliberately outside the lean CI job, and there is no secret-bearing CI job
by design, so production configuration can only ever be `configured`, never
`verified in CI`.

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | 0 errors (59 pre-existing warnings) |
| Unit / contract / safety | `npm test` | **562 pass / 0 fail / 0 skipped** |
| Public browser journeys | `npx playwright test` | **54 pass / 0 fail** |
| Export integrity | `node --test backend/tests/handoff-export-integrity.test.js` | 15 pass / 0 fail |
| Hero contrast | `node --test backend/tests/landing-contrast.test.js` | 11 pass / 0 fail |
| Production build | `npm run build:app` | success |
| Bundle freshness | `npm run check:app-fresh` | matches `app-src/` at HEAD |
| Launch-state integrity | `npm run launch:verify` | OK |
| Whitespace | `git diff --check` | clean |

Test count over v11: 493 → **562** (+69). New suites: launch-state, signup
conversion, e2e seeding, product proof, export integrity, spend-ceiling gate,
beta feedback.

---

## Defects found and fixed during v11

Four were live, not hypothetical.

1. **Every acquisition CTA led to a login screen.** "Create my campaign" in the
   header, hero and closing section pointed at `/app`, where an anonymous
   visitor is redirected to login — for an account they do not have. A silent
   conversion detour at the highest-intent moment on the site.

2. **Hero helper text and proof cards were unreadable.** White text measured
   4.10:1 at 26% of the gradient and 2.49:1 at 62%, against a 4.5:1 threshold.
   Fixed locally — a hero-scoped scrim plus background-independent surfaces —
   without another unapproved rebrand.

3. **A long word ran off the PDF page.** `wrap()` never broke a word longer
   than the line width, so a long URL in `proof` or an unbroken campaign name
   was clipped by the page edge in every reader. A client receives a truncated
   deliverable with no error raised anywhere.

4. **Signup consent checkboxes were stretched across the card** by an unscoped
   `.login-card input { width: 100% }`, and the verification screen described a
   same-device restriction the backend does not have.

Plus one caught by an existing guard: `beta_feedback` was missing from
`WORKSPACE_TABLES`, so the new table would not have left with an account export
or gone with an erasure. That is the v10 SC-08 drift test doing exactly its job.

---

## Coverage this gate does NOT claim

Stated plainly rather than buried.

- **No signed-in browser journey has ever executed.** The matrix now exists —
  desktop, phone and keyboard, over per-run seeded data — but it has not been
  run, at this SHA or any other. Rendering, focus order, mobile layout and
  recovery behind the login remain unverified. `docs/UX_DEFECT_LEDGER_V11.md`
  is incomplete by definition until that walk happens.
- **DOCX and PDF are validated by parsing, not by opening.** Archives are
  checked against their own CRCs and the PDF's object graph is verified, but
  neither file has been opened in Word or Acrobat. No such renderer exists in
  this environment.
- **No load or concurrency testing.** Export limits are measured
  single-threaded on one machine (`docs/EXPORT_LIMITS_V11.md`).
- **Production configuration is unverified.** `release-check` run here has no
  production secrets and reports blockers by design. That is the fail-closed
  behaviour working; it is not evidence about production.
- **Migration applied-state is unverified.** `CHECK_APPLIED.sql` covers the
  full `001`–`037` range, including `037`'s unique index, but it has not been
  run against the database from here and cannot be.

---

## Rollback

- v11 commits are independent and additive; revert the offending commit and
  rebuild `app/`.
- `037_beta_feedback.sql` is additive — a new table with a unique index. Safe
  to leave applied if application code is rolled back.
- The seeding route cannot exist in production: it refuses under a production
  launch mode and is only mounted behind `E2E_SEED_ENABLED=1`.
- The hero scrim is a single CSS block; reverting it restores the previous
  appearance and the previous contrast failure together.
- `BETA_INVITE_CAP` unset reopens signup; it fails open by design.
- Incident paths: `docs/RUNBOOK_INCIDENTS.md`.

---

## How this verdict can change

Only by evidence, and only at a candidate SHA that matches HEAD. Edit
`docs/launch/launch-state.json`, run `npm run launch:render`, then
`npm run launch:gate`. The gate recomputes both verdicts from the facts; a
declared verdict that disagrees with the computed one fails
`npm run launch:verify` in CI.

Any further commit creates a new candidate and invalidates every check pinned
to this SHA. That is the intended behaviour — a deploy badge and a test count
are not a launch decision.

Signed: Claude Code (automated gate) · Owner sign-off: `__________` Date: `__________`
