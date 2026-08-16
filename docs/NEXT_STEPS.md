# NEXT STEPS — read this first (for the next LLM / prompt author)

**The code is done. Stop writing engineering prompt packs. The next work is
DISTRIBUTION / MARKETING, not coding.**

Scalvya has now been through v6–v19 of hardening. As of the v19 candidate
(`24d350c`, on `main`): capped-beta **GO**, public-paid **CONDITIONAL GO**, full
gate green (lint 0/0 · 967 unit · public E2E 57 · axe 5 · authenticated matrix
45/45 · npm audit 0 · launch integrity OK). The single source of truth is
`docs/launch/launch-state.json` (rendered to `docs/LAUNCH_STATE.md`).

## Do NOT
- Do **not** generate another LB-*/XAPP-*/S*/X* engineering prompt pack. The genuine
  gaps are closed; more code = more regression risk before launch (owner's words).
- Do **not** add features, refactors, migrations, or "elevation/closure/hardening"
  passes. If you think you found a gap, it was almost certainly already handled in
  v6–v19 — check the git history and `launch-state.json` before proposing anything.
- Do **not** re-open verdicts or re-run release ceremony. It's cut and certified.

## The only remaining OWNER-ONLY technical item (not a coding task)
- **Live-money rehearsal** — the 8-transition A–H sequence (incl. step G + refund)
  per `docs/RUNBOOK_TRANSACTION_REHEARSAL.md`. Owner runs it against live Stripe;
  no LLM/code action. Clearing it turns public-paid from CONDITIONAL GO → clean GO.
- (Optional, low priority, revisit ~2026-11-16: the LB-01 ownership-architecture
  trio and IDOR fuzz suite — deliberately deferred by the owner. Leave them unless
  the owner explicitly asks.)

## FOCUS HERE INSTEAD — marketing / distribution
The product works; nobody knows it exists yet. Prompts and effort should go to:
- **Positioning & messaging** for the ICP: freelance marketers & boutique agencies
  (solo founders/small brands secondary). Keep claims honest — Scalvya does not
  publish/post/send, reports no SEO volume/ranking, gives no legal approval, and
  "export" means packaging the user's approved drafts. See `CLAUDE.md` boundaries.
- **Channels:** where these buyers actually are (agency/freelance communities,
  marketing subreddits, LinkedIn, cold outreach, partnerships, content/SEO of our own).
- **Landing → trial conversion:** copy tests, the 3-day paid trial framing, onboarding
  narrative — content/marketing work, not app code.
- **Getting the first bounded beta cohort** (invited, behind `BETA_INVITE_CAP`, owner
  watching) per `docs/BETA_COHORT_PLAN_V17.md`, then the weekly decision engine
  (`docs/BETA_WEEKLY_DECISION_V16.md`) drives expand/iterate — that is a DATA/GTM
  loop, not a coding loop.

**Bottom line for the next LLM:** treat the codebase as frozen and shipped. Write
marketing, positioning, outreach, and GTM material. Only touch code if the owner
reports a real production bug.
