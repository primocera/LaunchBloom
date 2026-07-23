# v9 Execution Tracker — Scalvya Product Elevation

Source of truth: `Scalvya_Product_Elevation_Claude_Code_Prompts_v9.docx` (repo root) → verbatim in `docs/V9_PROMPTS.md`. Each `SC-V9-XX.md` here is a standalone, copy-paste-ready prompt with the mandatory product contract and shared appendices (Priloga A/B) attached.

## Rules (from the playbook — do not skip)
- Every prompt runs against the real repo; one prompt = one reviewable commit + diff review + acceptance gate.
- SC-V9-00 freezes the baseline first (reviewed baseline commit `333951702b42f22b780db702dc599ae3e42f19ab`; confirm actual HEAD and record drift).
- Never rebuild something a newer commit already implements — verify, close the remaining gap, document drift.
- No live Stripe/Supabase/Vercel/Resend mutation without explicit owner authorization. No secrets/content in evidence, analytics or logs.
- SC-V9-12 is the closing RC gate and must not add scope.
- If the 4-week beta shows no completion/repeat use, stop new features and run interviews.

## Recommended sequence and gates

| Phase | Prompts | Gate |
|---|---|---|
| 0 · Freeze/P0 | SC-V9-00, SC-V9-10 | Legal/billing/CI/live evidence explicit; no hidden P0 |
| 1 · Core UX | SC-V9-01 → SC-V9-04 | One clear campaign job; no lost work; accessibility green |
| 2 · Paid value | SC-V9-05 → SC-V9-08 | Better output/continuity and coherent commercial story |
| 3 · Quality/scale | SC-V9-09, SC-V9-11 | Measured beta, costs, retention and rollback evidence |
| 4 · Release | SC-V9-12 | Frozen RC; full automated + authorized live evidence; signed verdict |

## Model assignment
- **Fable 5**: SC-V9-01 (hardest — Campaigns.jsx monolith → `/app/campaigns/:campaignId/:section?` workspace refactor with deep-link preservation and all v8 behavior green). Runner-up if capacity allows: SC-V9-12 (cross-cutting RC gate).
- **Opus**: SC-V9-00, 02–11 (and 12 if Fable unavailable).

## Status
- [x] SC-V9-00 Baseline freeze, route audit, guardrails (commit e109af1)
- [x] SC-V9-01 Campaign cockpit IA + route refactor ← **Fable/Opus** (commit 788cb43)
- [ ] SC-V9-02 Deterministic next-best-action + readiness
- [ ] SC-V9-03 Campaign creation / brief editing / approval UX
- [ ] SC-V9-04 Unified review workbench + evidence workflow
- [ ] SC-V9-05 Asset studios output quality + editing
- [ ] SC-V9-06 Campaign-scoped library + version comparison
- [ ] SC-V9-07 Professional handoff packet + export
- [ ] SC-V9-08 ICP positioning, onboarding, pricing, lifecycle
- [ ] SC-V9-09 Design system, accessibility, responsive polish
- [ ] SC-V9-10 Legal, billing, support, paid-production hardening
- [ ] SC-V9-11 Value analytics, beta learning, pruning
- [ ] SC-V9-12 Integrated RC + final product-quality gate
