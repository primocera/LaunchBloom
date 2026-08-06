# v16 prompt pack — Beta + Paid Readiness → 9.5

Source: `Scalvya_95_Beta_Paid_Readiness_Claude_Code_Prompts_v16.docx` (repo root).
Audited HEAD `d114f0b`; product candidate `b234dad`.

This directory archives the **Scalvya-side** prompts executed on branch `v16`.
The Mellowa prompts (`MW-95-*`) run in the separate `primocera/Mellowa` repo and
are **not** executed here. `XAPP-95-*` prompts run per-repo; only the Scalvya
side is executed in this repo.

Execution order (each = one bounded commit):

| ID | Title | Status file |
|----|-------|-------------|
| SC-95-00 | Freeze real baseline, open only evidence-backed gaps | `../../V16_BASELINE.md` |
| SC-95-01 | Close every durable Stripe-customer ownership path | commit + handoff |
| SC-95-02 | Repair coding-agent architecture truth + release docs | commit + handoff |
| SC-95-03 | One executable value scorecard with repeat-campaign proof | commit + handoff |
| SC-95-04 | Make handoff prove reduced rework | commit + handoff |
| SC-95-05 | First-value and repeat-value beta decision loop | commit + handoff |
| XAPP-95-01 | Symmetric shared-Stripe isolation proof (Scalvya side) | commit + handoff |
| XAPP-95-02 | Evidence-based 9.5 re-score (Scalvya side) | commit + handoff |

Guardrails honoured throughout (from the pack + `PROMPT_PACK_SCOPE_NOTE.md`):
verify against HEAD and build only the verified gap; no re-scaffolding of the
authenticated-E2E / live-money / router owner-gated items; no pricing / limit /
trial / status-enum / verdict changes; no new generators, share links, client
accounts or publishing integrations; canonical GO/NO-GO stays in
`docs/launch/launch-state.json`.
