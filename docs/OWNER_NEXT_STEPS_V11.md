# Owner: what only you can do next

Everything in the v11 code scope is done. Both launch verdicts are **NO-GO**,
and every remaining blocker needs credentials, a database or real money —
things Claude Code must not touch.

This is the shortest path from here to a capped beta. Work top to bottom; each
step unblocks the next. Re-run `npm run launch:gate` after each one to watch
the reasons disappear.

---

## 1 · ~~Apply the migrations, then prove they are applied~~ · **DONE 2026-07-28**

> Closed. `037` applied, `CHECK_APPLIED.sql` run against production, every row
> `001`–`037` reports `applied = true`. The `034`/`035`/`036` contradiction is
> resolved in favour of `GO_NO_GO_V10.md` — `CONFIGURED_STATE.md`'s migration
> table was wrong. Evidence: `docs/evidence/2026-07-28-migrations-applied.md`.
> Worth doing once: paste the query output into that file, so the claim ships
> with something a reader can check.
>
> The original instructions are kept below for the next time a migration lands.

Two things were unknown and one was new.

**Unknown:** `GO_NO_GO_V10.md` said migrations `034`–`036` were verified applied
on 2026-07-26. `CONFIGURED_STATE.md` said, for the same date, that they were
not. Nothing in the repository can settle it, so the launch record says
**unknown** rather than picking a side.

**New:** `037_beta_feedback.sql` ships with v11 and has never been applied.

```
1. Supabase SQL editor (production project)
2. Run backend/migrations/037_beta_feedback.sql
3. Run backend/migrations/CHECK_APPLIED.sql
4. Note every row where applied = false
```

`CHECK_APPLIED.sql` now covers `037` too, so one run reports the whole
`001`–`037` range. Order matters: apply `037` first, or its row comes back
`false` and tells you nothing you did not already know.

Then record it in `docs/launch/launch-state.json`:

```json
"applied_verification": {
  "status": "observed",
  "source": "backend/migrations/CHECK_APPLIED.sql",
  "last_run_utc": "2026-07-__T__:__Z",
  "verified_by": "owner"
}
```

and set `owner_evidence.migrations_applied.status` to `"observed"` with an
`evidence_ref`. Delete the `contradiction` field once it is resolved.

If `036` turns out **not** to be applied, unsubscribe writes fail and marketing
mail fails closed — safe, but it means the suppression test in step 4 would
pass for the wrong reason. Apply it first.

---

## 2 · Set the AI spend ceiling · **P0**

There is currently no daily cap on what a runaway loop or an abusive account
can spend. As of v11 its absence **blocks a production release**, and an
invalid value fails just as closed as a missing one.

```
Vercel → Project → Settings → Environment Variables
AI_SPEND_DAILY_CEILING_USD = <a number you would accept losing in one bad day>
```

Pick it deliberately: comfortably above a normal day for 15–25 beta accounts,
and a figure you would not mind losing once. Then redeploy and confirm:

```bash
npm run release:check     # expect [PASS] ai:spend_ceiling
```

Also agree the alert thresholds and the kill switch in
`docs/OWNER_EVIDENCE_V11.md` §D before anyone is invited. `AI_GENERATION_PAUSED=1`
stops new reservations.

---

## 3 · Run the authenticated browser matrix · **P0**

The signed-in product has never been executed in a browser — at any commit, in
any version. This is the single largest gap in the release.

You need a **non-production** Supabase project with the full migration set. The
seeding endpoint refuses to run under a production launch mode, so pointing it
at the live project cannot work even by accident.

```bash
export SUPABASE_URL=...              # non-production project
export SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...
export E2E_SEED_SECRET="$(openssl rand -hex 20)"

npm run test:e2e:auth
```

Full detail: `docs/RUNBOOK_AUTH_E2E.md`. Stripe, Resend and Anthropic keys stay
blank, so nothing can spend money or send mail.

**Expect failures on the first run.** These specs were written against the
source but have never executed, and the screens behind the login have never
been walked. Failures here are findings, not defects in the suite — record them
in `docs/UX_DEFECT_LEDGER_V11.md`, which is explicitly incomplete until this
step happens.

Then set `checks.e2e_authenticated` to `passed_locally` with
`observed_at_sha` set to the candidate SHA.

---

## 4 · Live money and email rehearsal · **P1, public launch only**

Not needed for a capped beta. Required before taking money from strangers.

Work through `docs/OWNER_EVIDENCE_V11.md`:

- **§A** — nine billing transitions, lowest-priced plan, refund yourself at the
  end. Row 7 (a late `payment_failed` arriving *after* recovery) is the live
  confirmation of the v10 webhook-ordering fix and matters most.
- **§B** — unsubscribe suppresses optional mail while billing and security mail
  still arrives. Both halves; suppressing everything is a failure in the other
  direction.

Record anonymized evidence only: no card numbers, no customer addresses, no
message bodies.

---

## 5 · Verify production configuration

`release-check` run locally has no production secrets and reports blockers by
design — that is the fail-closed behaviour, not a regression. Run it once in a
shell carrying the production environment and paste the result into the launch
record:

```bash
node backend/scripts/release-check.js --evidence
```

---

## 6 · Re-freeze and decide

Steps 1–3 change files, which means new commits, which means a **new
candidate**. That is intentional: evidence collected at one SHA does not
describe another.

```bash
# with all evidence recorded in docs/launch/launch-state.json
npm run launch:render     # regenerate the human-readable status
npm run launch:gate       # recomputes both verdicts from the facts
```

When `capped_beta` turns GO, invite the first cohort — cap 25, hard stop
(`docs/BETA_PLAN_V10.md`) — and start filling in
`docs/BETA_SCORECARD_V11.md` weekly. Feature work stays frozen during the beta;
only P0 safety/money/data issues and repeated P1 blockers get built.

`public_paid` stays NO-GO until step 4 is complete **and** the export and
renewal rows on the scorecard are non-suppressed and meeting target.

---

## Merging v11

The branch is `v11`, unmerged, with nine commits. Nothing is pushed. Review the
range and merge when you are satisfied:

```bash
git log --oneline main..v11
git diff main..v11
```

CI on the merge will run lint, unit tests, the production build, the
stale-bundle check and the new launch-state integrity check. It will **not**
run the browser suites — that is by design, to keep CI lean and non-flaky, and
it is exactly why the launch record distinguishes `passed_locally` from
`passed_ci`.
