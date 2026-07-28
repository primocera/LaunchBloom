# Handoff — state of Scalvya at launch (v11 closed)

For whoever writes the v12 prompt pack. Read `docs/launch/launch-state.json`
first; it is the machine-checkable version of everything below and it wins on
any disagreement.

## Verdict

| Track | Verdict | On what |
|---|---|---|
| Capped beta | **GO** | evidence |
| Public paid launch | **GO** | evidence **plus three accepted risks** |

Public launch is **not** fully evidenced, and the record says so rather than
implying otherwise. Three conditions were not met and the owner accepted them
on 2026-07-28, each with a named rationale in `blockers[].accepted_risk`. Every
accepted item keeps its true status — `skipped`, `open`, `not_run` — so the
document still states what is actually the case. Withdrawing any acceptance
returns the verdict to NO-GO automatically; a test asserts exactly that.

## What is proven, and how

| Claim | Evidence |
|---|---|
| Migrations `001`–`037` applied | `CHECK_APPLIED.sql` against production, all rows true · `docs/evidence/2026-07-28-migrations-applied.md` |
| Production configuration correct | `/api/admin/readiness`, `mode: production`, 13/13 ok, 0 blockers · `docs/evidence/2026-07-28-production-readiness.md` |
| Unsubscribe honours consent both ways | marketing `suppressed`, transactional `sent` after suppression · `docs/evidence/2026-07-28-resend-suppression.md` |
| Signed-in product works | owner walked signup → trial → access → cancel → generation on live Stripe · `docs/evidence/2026-07-28-owner-production-walkthrough.md` |
| AI spend bounded | ceiling live at $15; brake is `MAX_AI_CALLS_PER_DAY=300` ≈ $13/day |
| Code health at candidate | 575 unit tests, 52 browser journeys, lint 0 errors, bundle fresh |

## The three accepted risks — v12's actual backlog

**1 · No automated signed-in browser matrix.** Built (`e2e/authenticated/`,
desktop + phone + keyboard) and never executed, at any commit. Unproven: phone
layout, keyboard-only operation, cross-account isolation driven in a browser,
and failure paths — session expiry, provider timeout mid-generation, reload
during export. Blocked on a database that has opted in via
`backend/migrations/E2E_MARKER.sql`; the free plan allows a second project.
`docs/RUNBOOK_AUTH_E2E.md`.

**2 · Hero text below WCAG AA.** 4.70:1 at the top of the hero, 1.99:1 at the
bottom of the text band, against 4.5:1. The v11 fix (scrim + opaque surfaces)
was **reverted at the owner's instruction** — it dulled the approved blue and
read as glass cards. **Do not re-apply it.** Options that leave the blue alone
are written down under UX-V11-CONTRAST in `docs/UX_DEFECT_LEDGER_V11.md`.

**3 · Live billing never rehearsed end to end.** Trial start, access and cancel
were run live; the nine-transition matrix was not. The case that matters is a
late `payment_failed` arriving *after* a recovery — Stripe guarantees neither
ordering nor exactly-once delivery, and if the v10 SC-00 fix is wrong a paying
customer loses access. `docs/OWNER_EVIDENCE_V11.md` §A.

## Defects found and fixed in v11

Six were live in production or shipping to users.

1. **Every acquisition CTA led to a login screen.** Header, hero and closing
   "Create my campaign" pointed at `/app`, which redirects anonymous visitors to
   a login for an account they do not have.
2. **`welcome` had never been sent — not once.** Every signup consequence was
   gated on `type === 'signup'`, a parameter Supabase's default
   `{{ .ConfirmationURL }}` template does not send. So a confirmed signup sent
   no welcome email, fired no `verified` analytics event (silently zeroing that
   row of the beta funnel), and skipped Brand Profile onboarding. Found by
   running the unsubscribe test.
3. **A long word ran off the PDF page.** `wrap()` never broke words longer than
   the line width, so a long URL or unbroken campaign name was clipped at the
   page edge in every reader — a client receives a truncated deliverable with no
   error anywhere.
4. **The E2E seed endpoint could reach production.** Its three guards all
   described the *process*, not the *database*; a local run pointed at the live
   project passed all of them and would have created real auth users there. The
   runbook claimed this was impossible. Fixed with a marker table the
   environment cannot fake.
5. **`release:check` never loaded `.env`**, so the production configuration gate
   reported every variable missing and printed BLOCKED regardless of
   configuration. A gate that is red unconditionally teaches you to ignore it.
6. **Signup consent checkboxes stretched across the card**, and the verification
   screen described a same-device restriction the backend does not have.

Plus `beta_feedback` missing from `WORKSPACE_TABLES` — caught by the existing
v10 drift guard, which would have left the table behind on an account erasure.

## Rules that hold for v12

- **Do not touch the landing hero's blue or add surfaces behind hero text.**
  Rejected twice: commit `445d29e`, then again in v11. The prompt pack said not
  to change working surfaces; that was ignored once and should not be again.
- `docs/launch/launch-state.json` is the only release truth. Edit it, run
  `npm run launch:render`, never hand-edit `docs/LAUNCH_STATE.md`. A declared
  verdict that disagrees with the computed one fails CI.
- Verdicts are computed, never declared. The only routes to GO are evidence or
  an `accepted_risk` with a named person, a date, the tracks it applies to and a
  rationale of substance.
- A candidate is invalidated by code changes, not by documentation. The exempt
  list is `docs/` and the prompt packs; a test forbids ever adding `app/`,
  `backend/`, `app-src/`, `e2e/`, `api/` or `package.json` to it.
- Never report an unrun check as passing. `skipped`, `not_run`, `unknown` and
  `configured` are all distinct from a pass, and none of them rounds up.
- Prices stay $12.99 / $24.99 / $59.00. Five creation paths. Never invent
  customer proof, outcomes, urgency, integrations or performance.

## First things to watch now that signup is open

`/api/admin/readiness` — `webhook_failures_24h`, `outbox_backlog`,
`ai_spend_24h_usd` against the $15 ceiling. `AI_GENERATION_PAUSED=1` is the kill
switch; it stops new reservations and touches nothing in billing. Incident
paths: `docs/RUNBOOK_INCIDENTS.md`.

`docs/BETA_SCORECARD_V11.md` still works as a weekly sheet even without an
invited cohort — the three bold rows (three channel types, export completed,
subscription renewed) are the questions worth answering before building
anything else.
