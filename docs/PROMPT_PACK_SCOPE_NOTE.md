# Note to the prompt-pack author — the code is done; the problem is distribution

> **🚦 STOP — read this first (as of v18, 2026-08).**
> **The product build is finished for launch. The constraint on this business is
> no longer code — it is users.** Every automated gate is green at the candidate,
> the authenticated + public browser E2E matrices pass, the react-router tree
> carries no open advisory (three unrelated moderate `qs` advisories remain, fix
> available), and
> the product evidence is complete (the ordered live-money A–H rehearsal — H/refund
> real Stripe time 2026-09-05T16:11Z, after G — Stripe ownership enforcement
> probe-verified, dependency audit 0, data-rights drill passed 2026-09-21). As of
> v24 (2026-09-23) the release gate is **PENDING OWNER RC** (computed NO-GO for both
> tracks) purely on release integrity: v23's CI provenance was not exact-SHA, so the
> owner freezes one v24 FINAL SHA, runs the release-candidate workflow on it,
> deploys exactly it (`GET /health` reports the version) and re-observes readiness
> — `docs/evidence/OWNER_CHECKLIST_v24.md`, all owner-operational.
>
> **Do not write another feature/hardening prompt pack.** The highest-value work
> now is **marketing and distribution**: landing conversion, getting the first
> cohort of freelance marketers / boutique agencies in, activation and the value
> loop (brief → assets → first handoff export, instrumented as `first_value_reached`),
> pricing experiments, and channels (content/SEO, communities, outbound,
> partnerships). Write a *code* pack again only when **real user evidence** points
> at one specific missing thing — never from the product vision.
>
> **E2E testing is complete.** Both browser matrices exist, pass, and gate the
> release. A pack asking to "add E2E tests" is **already satisfied** — verify the
> existing suites at the candidate and stop; do not rebuild them.

**If you are writing a pack anyway, read the rest of this note.**

> **Hard rule, up front:** if the pack you are about to write is about the
> **authenticated E2E matrix**, the **live-money rehearsal**, or the
> **react-router advisory** — **do not write it.** All three are owner-gated,
> already inventoried in `docs/launch/launch-state.json`, and cannot change
> status from a prompt. A pack whose spine is any of the three is a no-op. Stop
> and tell the owner to run the two live tasks (or deploy the beta) instead.

The last five packs (v11 → v15) keep circling the **same three items**: the
authenticated E2E matrix, the live-money rehearsal, and the react-router
advisory. Each new pack re-inventories them, adds more machinery *around* them,
and ships. That is motion, not closure — and it cannot become closure, because
**none of these three can be closed by a prompt.** They are gated on an owner
action in the real world. Writing them into another pack produces another green
build that describes the same gap more precisely.

This note draws the line between **real work** (keep doing) and **churn** (stop).

---

## The three recurring items — ALL CLOSED (live-money re-confirmed v23, 2026-09-21)

These were the three owner-gated items a pack could never close. All three are
closed; `public_paid` is a full GO.

| Item | Status | Note |
|---|---|---|
| **Authenticated E2E matrix** (`test:e2e:auth`) | ✅ **passed_ci** | ran GREEN in CI at the shipping candidate (release-candidate workflow on `rc/v22.2`, authenticated-e2e job, SHA-pinned `rc-auth-evidence` artifact, zero skips) |
| **Live-money rehearsal** (ordered A–H) | ✅ **complete (live)** | v23 added an ordering validator that caught a data-entry timestamp on H; the owner's Stripe evidence showed the refund `re_3UBD6L…` actually occurred `2026-09-05T16:11Z` (~15h after G), so corrected to the real time `npm run rehearsal:validate` passes (time-monotone, complete). `docs/evidence/2026-09-05-rehearsal-record.json` |
| **Router advisory** GHSA-qwww-vcr4-c8h2 | ✅ **closed** | owner decision: not reachable (pure client SPA, `npm run check:router` green) and absent from `npm audit`; blocker `P1-router-rsc-csrf-advisory` closed |

> Note: this is NOT a licence to write another engineering pack. All three items
> are owner-gated and settled. The v23 work was an explicit owner-named exception
> (dependency/security patch + release-truth honesty), already shipped. The default
> for a new pack remains **marketing / distribution**.

All three were **owner-gated by design** — Claude Code refused to run them (no
live money, no production DB seeding). The owner has now done them, and the
evidence is recorded in the canonical launch-state. There is nothing left to
build or run here.

### The rule for the next pack

> Do **not** open a new prompt for the E2E matrix, the live-money rehearsal, or
> the router advisory. They are inventoried once in
> `docs/launch/launch-state.json` as **accepted risks with owner actions**. A
> pack may reference them; a pack may **not** re-implement tooling for them. If a
> pack's only new content is another way to describe one of these three, don't
> write the pack.

---

## What *was* real (this is the work worth doing)

Not everything was churn. These were genuine defect fixes with genuine value —
this is the kind of thing a pack *should* contain:

- **v14** — billing fails closed on trial/customer uncertainty; billing errors
  redacted (no `err.message`, no full-email logs).
- **v15 SC-02** — idempotent Stripe customer creation + read-only orphan
  recovery (fixes a real duplicate-customer footgun on a shared Stripe account).
- **v15 XAPP-01** — cross-app Stripe isolation (Scalvya never adopts a
  Mellowa-owned customer/subscription/charge).

The test is simple: **did the pack fix or prevent a real defect, or did it
re-describe a gap that only the owner can close?** Ship the first. Skip the second.

---

## Where the launch actually stands (so the next pack starts from truth)

Single source of truth: `docs/launch/launch-state.json` (rendered:
`docs/LAUNCH_STATE.md`). As of the **v18** candidate (see the manifest for the
exact pinned SHA and the full owner handoff in `docs/OWNER_HANDOFF_V18.md`):

- **Capped beta: PENDING OWNER RC (v24).** No product blocker; the authenticated
  E2E matrix is closed and passed on the v23 line. It must run once more at the
  exact v24 FINAL SHA (owner RC).
- **Public paid: PENDING OWNER RC** (v24, 2026-09-23; v23 computed GO without
  exact-SHA CI provenance). The not-reachable router advisory
  (GHSA-qwww-vcr4-c8h2, absent from `npm audit`) is closed by owner decision. The
  ordered live-money A–H rehearsal is complete (H/refund real Stripe time
  2026-09-05T16:11Z, after G, once a data-entry timestamp was corrected), and the
  read-only migration 038-040 enforcement probe is verified. The only remaining
  steps are the owner-operational exact-SHA RC, deploy and readiness in
  `docs/evidence/OWNER_CHECKLIST_v24.md`. Never write a pack for them.

**Therefore:** the highest-value next step is not another pack. The product
conditions are met. The owner-operational close-out is the v24 exact-SHA RC,
deploy and readiness (`docs/evidence/OWNER_CHECKLIST_v24.md`), then the Prompt 4
independent certification. After that, the work is **marketing and
distribution**.

---

*If you're about to write v16 and its spine is "harden payments / finish the E2E
matrix / re-examine the router CVE" — stop. That pack already shipped, three
times. Point the owner at the two real tasks instead.*
