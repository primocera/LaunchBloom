# Capped-beta interview guide (SC-P1-12)

Short, qualitative companion to the value scorecard. Numbers can rise on
novelty; interviews are the only way to confirm the coordinated campaign
actually saves meaningful rework. Run 20–30 minutes with each activated beta
user. Ask, then listen — do not pitch. Capture quotes, not scores.

Do not record any answer into product analytics; interview notes live outside
the ledger and never carry customer content into KPIs.

## Questions

1. **Previous workflow** — Before Scalvya, how did you produce a campaign across
   channels? What tools, and who was involved?
2. **Time / rework** — How long did that take, and how much of it was redoing
   work to keep messaging consistent across assets?
3. **Point of confusion** — Where in Scalvya did you hesitate, get lost, or
   expect something to happen that did not?
4. **Asset quality after review** — After you reviewed and edited, were the
   assets good enough to actually send? What did you still have to fix yourself?
5. **Willingness to pay** — Knowing what it does now, what would you expect to
   pay, and what would make that feel fair vs. too much?
6. **Repeated use case** — What is the next campaign you would run in it, and how
   often would you realistically come back?
7. **Cancellation trigger** — What would make you cancel — a missing capability,
   a quality bar, a price, a failure?

## What to look for

- **Confirm / deny the rework hypothesis** (gate `qualitative_confirmation`):
  does the coordinated campaign remove work they used to redo by hand?
- Separate **product-quality** complaints (output needs too much fixing) from
  **technical-failure** complaints (it broke) from **fit** complaints (not for
  my kind of work). These map to three different decisions.
- A concrete, near-term "next campaign" answer is stronger repeat-value evidence
  than an enthusiastic score.

Record findings against the same week's cohort in `BETA_SCORECARD_V13.md`. Do
not turn a single strong interview into a launch claim.
