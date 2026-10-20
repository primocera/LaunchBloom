# Release notes for agents and prompt authors

Moved out of the root `README.md` so the README stays a product overview. Nothing
here changed in substance; read it before writing or executing a prompt pack.

> Prompt authors / LLMs: the engineering build (v6–v23) is complete and
> certified — capped-beta GO and public-paid GO (`docs/launch/launch-state.json`).
> The next prompt pack is marketing / distribution / GTM, not engineering.
> Brief: [`docs/V20_MOVING_TOWARD_MARKETING.md`](../V20_MOVING_TOWARD_MARKETING.md)

> **The engineering build is complete and certified — capped-beta GO / public-paid GO.**
> The next prompt pack is **marketing / distribution / GTM**, not another engineering
> one. Start from **[docs/V20_MOVING_TOWARD_MARKETING.md](../V20_MOVING_TOWARD_MARKETING.md)**.

The current verdict is always the computed one from `npm run launch:gate` — see
[Release gate status](#release-gate-status) below and `CLAUDE.md`'s scope note.

---

## Status: the build is certified; the focus is distribution

The release gate is **capped-beta GO / public-paid GO** — computed, not declared,
by `npm run launch:gate` from `docs/launch/launch-state.json`. As of the v23 re-cut
(2026-09-21) the pinned candidate is CI-green on every required check: dependency
audit 0 (after the v23 security patch), lint, the full unit and contract suite,
build, the public and authenticated browser matrices, and launch integrity. The
live-money recovery rehearsal (the ordered A–H sequence) is complete against real
Stripe with the refund confirmed after the late-failure step, and Stripe-ownership
enforcement is probe-verified. The re-cut is done; what remains is
owner-operational rather than code — deploy the pinned candidate and run the
data-rights export/delete drill.

The constraint on this business is no longer code — it is users. The next work is
**marketing and distribution**: positioning and landing conversion, getting the
first cohort of freelance marketers and boutique agencies in, activation and the
value loop, pricing experiments, and channels (content, communities, outbound,
partnerships). Build features again only when real user evidence asks for a
specific one.

**End-to-end testing is complete.** The public and authenticated (desktop, mobile,
keyboard, real non-production Supabase) browser matrices pass green in CI and gate
the release. If a pack asks to "add E2E tests," verify the existing suites at the
current candidate rather than rebuilding them; add a spec only for a genuinely new,
uncovered user flow.

## Before writing a prompt pack

This repo has been built through successive prompt packs (v6 → v23). The most
common source of wasted work is a pack asking for something **that already
exists**, because the pack was written from the product vision rather than from
the code.

**Before specifying a feature, check the two files that record reality:**

| File | What it tells you |
|---|---|
| [`docs/CONFIGURED_STATE.md`](../CONFIGURED_STATE.md) | What is already configured in production (Stripe, Resend, legal config, cron). Verified from the live readiness endpoint, with a date. |
| [`docs/LAUNCH_STATE.md`](../LAUNCH_STATE.md) | The current release gate: what is proven, what was accepted as risk, what is outstanding. Generated from `docs/launch/launch-state.json`. |

**Please phrase prompts as "verify X, build only the gap"** rather than
"build X". Recent examples where the ask was already satisfied:

- *"Add a production readiness endpoint"* — shipped in v9; met the bar unchanged.
- *"Add cross-channel consistency checks"* — the v8 engine already covers CTA,
  URLs, promo terms, dates, audience, unsupported claims and stale snapshots.
- *"Add an email outbox with retry and dead-letter"* — present since v6.

Each of those cost a full read of the codebase to discover the work was done.

## Release gate status

The launch verdict is **computed, not declared here** — from
[`docs/launch/launch-state.json`](../launch/launch-state.json), by
`npm run launch:gate`. This file links to that canonical truth; it does not
independently declare a track open or GO. The two tracks are not on the same
footing, and accepted risk never produces a full GO:

| Track | Verdict | On what |
|---|---|---|
| Capped beta | NO-GO (pending owner RC) | v24 changed code; no candidate is frozen at an exact SHA yet |
| Public paid launch | NO-GO (pending owner RC) | needs a green RC run, deploy and readiness at the exact v24 FINAL SHA |

This is a release-integrity hold, not a product regression: every P0/P1 blocker
stays closed and the owner evidence below carries forward (the v24 diff touches
no billing, webhook, AI or migration runtime). The owner steps that restore GO
are in [`docs/evidence/OWNER_CHECKLIST_v24.md`](../evidence/OWNER_CHECKLIST_v24.md).

Proven against production: migrations `001`–`040` applied (001-037 verified
2026-07-28; 038-040 verified by the 2026-09-21 read-only owner probe), Stripe
ownership **enforcement** live (`app_user_id` arbiter non-partial UNIQUE,
`stripe_ownership_uniqueness_ready()` = true), configuration verified via
`/api/admin/readiness` (`mode: production`, all readiness checks green, 0
blockers), unsubscribe suppression honoured in both directions, and a daily AI
spend ceiling live.

The automated signed-in browser matrix runs against a disposable non-production
Supabase and ran **green in CI** on the v23 line (release-candidate runs on the
docs-only descendants of the v23 tree) — the `P0-no-authenticated-e2e` blocker is
**closed**; for v24 it must run again at the exact FINAL SHA. The router RSC advisory is
**closed** (guard green, no RSC entry point). The live billing rehearsal — the
canonical eight-transition **ordered** A–H matrix — is **complete**: after the v23
ordering validator caught a data-entry timestamp on H, the owner's Stripe evidence
showed the refund (`re_3UBD6L…`) actually occurred `2026-09-05T16:11Z`, ~15h after
G; corrected to that real time, `npm run rehearsal:validate` passes (time-monotone,
complete) and the refund alone left entitlement unchanged. No P0/P1 blocker remains
open or accepted. v23 computed a full GO, but its CI provenance was not exact-SHA
(no release-candidate run ever had the v23 candidate's own head SHA, and `/health`
exposed no version), so v24 re-establishes it at one FINAL SHA — `GET /health` now
reports the deployed commit's short SHA. (Exact counts and the full blocker list
live in the canonical launch-state, not here.)

Start with [`docs/prompts/v16/HANDOFF.md`](../prompts/v16/HANDOFF.md) for the
full picture and what to pick up next. Earlier GO/NO-GO and handoff documents
(`v9`, `v10`, `v12`, `v15`) are historical and carry SUPERSEDED banners.

## Internal files in this folder

- [`handoff-scalvya.md`](handoff-scalvya.md) — 2026-07-27 cross-product handoff
  (shared Stripe account, defects to re-check). Formerly at the repo root.
- `Scalvya_*_Prompts_*.docx`, `Scalvya_Master_Prompt_Pack_v13.docx` — the
  v9–v15 prompt packs. Formerly at the repo root.
