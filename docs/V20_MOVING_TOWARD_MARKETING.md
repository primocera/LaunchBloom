# v20 — Moving Toward Marketing (next pack) — read this first

**If your job is "the previous prompts are done, check the repo and write the next
prompt pack" — then write a MARKETING / DISTRIBUTION / GTM pack. NOT another
engineering pack.** The v6–v19 engineering packs are done and shipped; writing a v20
*engineering* pack is the wrong move. Write the v20 *marketing* pack instead.

**The code is in strong shape. The PRIMARY focus now is DISTRIBUTION / MARKETING.**
Coding is still open (real bugs, small polish, owner requests) — this is a priority,
not a freeze. Just don't churn out another engineering pack for its own sake.

## What the next prompt pack should cover (write prompts for THESE)
1. **Positioning & core messaging** — sharpen the promise for the ICP (freelance
   marketers & boutique agencies; solo founders/small brands secondary). Honest claims
   only (see boundaries below).
2. **Channel plan & outreach** — pick 2–3 channels where these buyers actually are
   (agency/freelance communities, marketing subreddits, LinkedIn, cold email,
   partnerships, our own content/SEO) and write the actual outreach/content assets.
3. **Landing → trial conversion** — headline/subhead/CTA variants, the 3-day paid
   trial framing, objection handling, onboarding narrative.
4. **First bounded beta cohort** — invite copy + running the cohort (behind
   `BETA_INVITE_CAP`) and reading the weekly decision engine to decide expand/iterate.
5. **Content/SEO of our own** — topics, angles, and a publishing cadence for inbound.

Frame these as GTM/marketing prompts (copy, plans, experiments, outreach), not code.

Scalvya has been through v6–v19 of hardening. As of the v19 candidate (`24d350c`, on
`main`): capped-beta **GO**, public-paid **CONDITIONAL GO**, full gate green (lint 0/0 ·
967 unit · public E2E 57 · axe 5 · authenticated matrix 45/45 · npm audit 0 · launch
integrity OK). The single source of truth is `docs/launch/launch-state.json` (rendered
to `docs/LAUNCH_STATE.md`).

## Default to marketing, not more engineering packs
- The big engineering gaps (LB-*/XAPP-*/S*/X*) are closed. Before proposing any new
  code work, check the git history + `launch-state.json` — most "gaps" were already
  handled across v6–v19. More code right before launch = more regression risk.
- Real production bugs, small polish, and anything the owner asks for are of course
  fair game — fix them. Just don't invent another elevation/closure/hardening pass.
- If you do ship code, keep the release ceremony honest: re-run the affected checks
  and re-cut the candidate via `npm run launch:gate` / `launch:render` (that's what
  keeps the launch truth trustworthy).

## Remaining OWNER-ONLY technical item (not a coding task)
- **Live-money rehearsal** — the 8-transition A–H sequence (incl. step G + refund) per
  `docs/RUNBOOK_TRANSACTION_REHEARSAL.md`. Owner runs it against live Stripe; no
  LLM/code action. Clearing it turns public-paid from CONDITIONAL GO → clean GO.
- Deferred by owner, low priority (revisit ~2026-11-16): the LB-01 ownership-architecture
  trio and an IDOR fuzz suite. Leave unless the owner asks.

## Where the real leverage is now — marketing / distribution
The product works; almost nobody knows it exists. Point prompts and effort here:
- **Positioning & messaging** for the ICP: freelance marketers & boutique agencies
  (solo founders/small brands secondary). Keep claims honest — Scalvya does not
  publish/post/send, reports no SEO volume/ranking, gives no legal approval, and
  "export" means packaging the user's approved drafts. See `CLAUDE.md` boundaries.
- **Channels:** where these buyers actually are (agency/freelance communities,
  marketing subreddits, LinkedIn, cold outreach, partnerships, our own content/SEO).
- **Landing → trial conversion:** copy tests, the 3-day paid trial framing, onboarding
  narrative.
- **First bounded beta cohort** (invited, behind `BETA_INVITE_CAP`, owner watching) per
  `docs/BETA_COHORT_PLAN_V17.md`; then the weekly decision engine
  (`docs/BETA_WEEKLY_DECISION_V16.md`) drives expand/iterate — a data/GTM loop.

**Bottom line:** the build is solid and shippable — put the energy into getting it in
front of buyers. Touch code when there's a real reason, not to generate more packs.
