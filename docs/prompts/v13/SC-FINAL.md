# SC-FINAL · Scalvya launch sign-off and owner packet

PriorityDepends on
Final gateAll required prompts complete
OutcomeRun mode
Truthful capped-beta or public-paid verdictOne focused branch/PR; stop on unsafe or production-only steps
PASTE INTO CLAUDE CODE
ROLE AND OBJECTIVE
Act as release manager. Produce the final Scalvya sign-off package from machine evidence and named owner observations. Do not change product code unless a newly discovered release-blocking defect requires returning to the appropriate prompt.
VERIFY
Clean main and exact candidate SHA; zero release drift; dependency lock; freshly built frontend bundle.
Lint, unit/contract/safety tests, export integrity, public E2E, authenticated non-production E2E, launch config validation, price catalog verification, and release gate.
Critical billing matrix: first trial, used trial, active, past_due, period-end cancellation, expired, overlap, DB outage, webhook replay/order, currency/config failure, portal.
Legal/support URLs, error monitoring, rollback, backup/restore responsibilities, incident contacts, cohort cap, and kill-switch/checkout-disable procedure.
OWNER-ONLY CHECKLIST
Prepare—do not execute without approval—a minimal Stripe live-mode rehearsal: small charge, portal access, cancel at period end, reactivate where supported, refund, webhook delivery, and entitlement reconciliation.
Prepare production environment verification and deploy/rollback commands with expected output and abort conditions.
For capped beta, name cohort size, contactability, monitoring window, support SLA, stop-loss conditions, and daily review owner.
VERDICT RULES
CAPPED BETA GO only when all code/security P0 items pass, the exact candidate gate is green, and any owner-only blocked item is explicitly bounded by a small contactable cohort with rollback.
PUBLIC PAID GO requires current authenticated E2E and successful owner production verification, price verification, and the approved minimal live billing rehearsal. Accepted risk must remain visible and named; it is never 'closed'.
If any condition is missing, issue CONDITIONAL/NO-GO with owner, evidence needed, and exact next action. Do not soften the verdict to match a target date.
FINAL OUTPUT
One-page executive verdict.
Evidence table with commit/environment/time/result/artifact.
Open risks with severity, owner, due date, mitigation and rollback.
First 72-hour monitoring plan and expansion/stop decision date.
Return: (1) exact files changed, (2) behavior before and after, (3) tests run with exact pass/fail counts, (4) commands not run and why, (5) residual risks, (6) documentation/evidence updated, and (7) whether the next prompt is safe to start.
Use PASS only for a command or production observation that actually ran against the stated commit and environment. Use BLOCKED, NOT RUN, or FAILED otherwise.
Do not claim launch readiness in prose. Report evidence; the repository's release gate and the owner determine the verdict.
END OF PROMPT
