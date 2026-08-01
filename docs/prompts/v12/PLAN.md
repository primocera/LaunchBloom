# V12 Launch Hardening — Orchestration Plan

Source: `Scalvya_Launch_Hardening_Claude_Code_Prompts_V12.docx` (Scalvya prompts only;
MW-V12-01..09 belong to the Mellowa repo and are not executed here).
Execution branch: `v12` (branched from `main` @ 8a0b2f3).
Ground truth before starting any prompt: `docs/launch/launch-state.json` and `docs/HANDOFF_V12.md`.

## Execution rule
One prompt = one focused commit on `v12` (or a sub-branch merged back), executed **strictly in
order**. Before each prompt: clean tree, read the prompt file, read `docs/HANDOFF_V12.md`, inspect
existing code — do not rebuild what exists. After each prompt: `node -c` changed files, run the
focused tests named in the prompt, then the full unit suite, and record starting SHA, ending SHA,
files changed, pass/fail/skip counts and residual risk in the commit message / evidence notes.

Global protocol (applies to every prompt):
- Never print, copy, rotate or invent secrets. Never run real charges, refunds, production
  restores or destructive production migrations.
- `skipped` / `blocked` / `not_run` / `configured` / `unknown` are never `passed`.
- Accepted risk never equals verified. Full GO only with zero open/accepted required P0/P1.
- Any product-code change after the frozen candidate invalidates earlier evidence.

## Sequence, scope and recommended agent

| # | Prompt file | Scope | Agent |
|---|---|---|---|
| 1 | [SC-V12-01](SC-V12-01.md) | Truthful verdicts: GO / CONDITIONAL GO / NO-GO in launch-state engine | main session (touches release semantics; review with security-reviewer after) |
| 2 | [SC-V12-02](SC-V12-02.md) | Hero contrast fix to real WCAG AA, keep approved blue, no scrim | frontend-builder |
| 3 | [SC-V12-03](SC-V12-03.md) | Auth E2E: PASS/FAIL/BLOCKED, DB marker guard, full journey matrix | main session + qa-reviewer verification |
| 4 | [SC-V12-04](SC-V12-04.md) | Billing state machine, webhook ordering/idempotency, live rehearsal runbook | main session + security-reviewer after |
| 5 | [SC-V12-05](SC-V12-05.md) | Reproducible fail-closed release-candidate workflow (CI) | main session |
| 6 | [SC-V12-06](SC-V12-06.md) | Agency-first conversion copy pass, no fabricated proof | frontend-builder + product-architect review |
| 7 | [SC-V12-07](SC-V12-07.md) | Scale-safe limits, Stripe isolation, spend brakes, readiness, incident runbook | main session + security-reviewer |
| 8 | [SC-V12-08](SC-V12-08.md) | Freeze new candidate, run all gates at one SHA, honest final verdict | main session (release-evidence task, run LAST) |
| 9 | [XAPP-V12-01](XAPP-V12-01.md) | Cross-app Scalvya↔Mellowa isolation review (needs Mellowa candidate) | read-only review; blocked until MW-V12-09 done in Mellowa repo |

## Gates between prompts
- 01 must land before 02–08: all later work reports verdicts through the new semantics.
- 02–07 are product/code prompts; 08 is the freeze — no product commit may follow 08 without re-freezing.
- 03 and 04 each end with an **owner-only** item (non-prod E2E env run; live money rehearsal).
  Code work completes, launch item stays open — do not mark passed.
- Expected final verdict per the pack: capped beta GO when all candidate-pinned tests are green;
  public paid at most CONDITIONAL GO while any accepted required P0/P1 risk remains.

## Owner-only checklist (Claude prepares runbooks, never executes)
- Full live billing recovery + refund rehearsal (SC-V12-04 runbook).
- Authenticated E2E run against the opted-in non-production database (SC-V12-03 runbook).
- Confirm production migrations and readiness without sharing secrets.
