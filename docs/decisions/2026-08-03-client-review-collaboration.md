# Decision record — client-review / collaboration loop for Scalvya

- **Prompt:** SC-P2-13 (v13 master pack)
- **Date:** 2026-08-03
- **Status:** **BLOCKED — awaiting capped-beta evidence. No build decision can be made yet, and no collaboration code is added in this prompt.**
- **Decision owner:** Primoz Cerar (owner)

## Why this is BLOCKED, not decided

SC-P2-13's own prerequisites are *at least 10 target-user pilots plus the SC-P1-12
analytics data, and interviews with 5+ users who exported or completed a campaign.*
As of this date **no capped beta has run and no real user evidence exists** — the
value scorecard (SC-P1-12, `backend/lib/beta-scorecard.js`) is instrumented but has
collected nothing. The global contract of this pack treats missing evidence as a
blocker, and forbids fabricating customer evidence or interviews. Therefore this
record is a **scaffold**: it fixes the options, the evidence to collect, and the
no-go criteria *before* results arrive, so the eventual decision cannot be
back-fitted to intuition. **Do not turn customer requests into an automatic roadmap
commitment.**

The core launch must not be delayed for this. Collaboration is a post-beta expansion
question only.

## Immutable framing

Scalvya stays *campaign control for one offer* (Brand Profile → Campaign Brief →
Create → Review → Library → Export). Any collaboration feature must serve that loop —
specifically the **Review** and **Export/handoff** steps where a freelancer or
boutique agency shows a client the campaign packet and needs sign-off. It must not
turn Scalvya into a generic collaboration suite. **Do not implement a broad
collaboration suite.**

## Options to compare (evaluate only against real pilot evidence)

### Option A — No collaboration (do nothing new)
- **Value:** none added; zero new attack surface, data model, or support load.
- **Privacy/abuse:** unchanged. Assets never leave the authenticated workspace.
- **Support/data model:** none.
- **Pricing impact:** none.
- **What today's code already supports:** export to DOCX/PDF/ZIP (the paid handoff
  path, `test:export`) and the user-managed **Published** status. A freelancer can
  already export and send the packet by their own channel.
- **When this wins:** if pilots show review happens rarely, with one reviewer, on
  non-sensitive assets, and export-and-email is "good enough."

### Option B — Read-only expiring review link (shareable, unauthenticated, time-boxed)
- **Value:** a client sees the campaign packet with Review/Ready-to-export statuses
  without an account; lowest-friction sign-off signal.
- **Privacy/abuse:** **highest risk.** An unauthenticated link is a standing data-
  exposure vector. Requires: short expiry, revocation, per-link scope (one campaign,
  read-only), no index/enumeration, rate limiting, and no PII/brand-voice text beyond
  what the owner deliberately shares. Must reuse the same ownership boundary as the
  rest of the app (route IS the security boundary; service_role bypasses RLS).
- **Support/data model:** new `review_links` table (token, campaign_id, user_email
  owner, expires_at, revoked_at, scope); token must be unguessable and never a
  sequential id. New public read route with its own guardrails, mounted before the
  restrictive CORS allowlist per server.js mount order.
- **Pricing impact:** plausibly a Pro/Studio gate; measure willingness to pay.
- **When this wins:** pilots show frequent *external* review, reviewers unwilling to
  create accounts, and assets not sensitive enough to require authentication.

### Option C — Authenticated comments / approval history
- **Value:** highest — durable approval record, per-reviewer identity, comment
  threads, audit trail. Strongest retention/monetization story for agencies.
- **Privacy/abuse:** lower exposure than B (authenticated), but far larger surface:
  invited-reviewer identity model, per-comment authorization, notification mail
  (Resend), and an approval-history data model that may carry legal/operational
  weight.
- **Support/data model:** reviewer accounts or scoped invites, `review_comments`,
  `approvals` (who/when/what version), workspace-scoped throughout. Significant build.
- **Pricing impact:** a clear Studio-tier feature; must justify the build cost against
  measured retention lift.
- **When this wins:** pilots show multiple reviewers, sensitive assets, and a real
  need for *who approved what, when* (approval history is legally/operationally
  important to the user).

## Evidence to quantify during the beta (interview + analytics checklist)

For each of ≥5 users who exported or completed a campaign, record:

1. How they collect client feedback **today** (tool, channel, friction).
2. Where campaign **coherence breaks** when feedback comes back (which of
   offer/audience/angle/proof/CTA/tone drifts).
3. How often review is **external** (client outside the workspace) vs internal.
4. **Number of reviewers** per campaign (drives B vs C).
5. **Sensitivity** of the assets shown (drives authenticated vs unauthenticated).
6. Whether **authentication / link expiry / revocation** is required by them or their
   client.
7. Whether **approval history** ("who approved what, when") is legally or
   operationally important.
8. **Willingness to pay** for a review loop, and at which tier.
9. What would make them **cancel** or distrust the feature.

Cross-check against SC-P1-12 metrics: `first_export`, `campaign_reached_ready`,
`second_campaign_created`, D7/D30 return, per-workspace export frequency. A
collaboration bet is only justified if review friction is a measured cause of drop-off
or of not returning for a second campaign.

## No-go criteria (decide BEFORE reading results; these are hypotheses)

- **No build (choose Option A)** if any of: fewer than a majority of activated pilots
  do external client review; review is typically single-reviewer on non-sensitive
  assets; or export-and-email already satisfies them. List smaller workflow
  improvements instead (e.g. a cleaner export layout, a per-asset Review summary).
- **Do not choose Option B** if pilots report the shared assets are sensitive, or if
  any requirement for expiry/revocation/authentication surfaces — an unauthenticated
  link would then be the wrong risk. B requires expiry, revocation, access controls,
  audit, and abuse mitigation *by construction* — never ship it without them.
- **Do not choose Option C** unless multiple reviewers **and** an explicit approval-
  history need are both evidenced; its build cost is not justified by convenience
  alone.
- **Kill regardless of demand** if the security model cannot guarantee no cross-user /
  cross-workspace exposure, or if it would delay the capped-beta learning loop.

## If a build is later approved

Produce a **separate implementation plan** (data model, security model, rollout flag,
migration/rollback, success metric, explicit no-go). Do **not** add collaboration code
under this prompt or fold it into the launch candidate. Any unauthenticated surface
must ship with expiry, revocation, access controls, audit logging and abuse
considerations, gated behind a flag defaulting off.

## Verdict

**BLOCKED.** No option is selected. Re-open this record once the capped beta has run
with ≥10 target users and ≥5 completed interviews, then decide against the criteria
above — evidence, not intuition, closes it.
