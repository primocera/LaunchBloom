# ADR-001 — Professional handoff: export-only (P0), tokenized review links deferred (P1)

Date: 2026-07-20 · Status: accepted · Scope: v8 LB-S07

## Decision

LaunchBloom ships **export-only** handoff in v8: a downloadable campaign
review packet (Markdown + print-friendly self-contained HTML). Tokenized
read-only review links are **deferred** to P1.

## Context

The playbook allows a secure read-only review link only if ownership, expiry
and revocation can be implemented safely. The current repository:

- uses HttpOnly session cookies for the single owner identity — there is no
  existing share-token mechanism, no token-hash storage, no per-resource
  access scoping beyond `workspace_id + user`;
- has no rate-limit/noindex/cache story for unauthenticated content routes;
- has no test coverage for token expiry/revocation semantics.

Building that safely is a real project (hashed high-entropy tokens, one token
→ one campaign + explicit asset set, immediate revocation, closure on
archive/delete, access log without IP retention, noindex, rate limits, cache
controls) and the prompt's default when that bar is not provably met is
export-only. Fake sharing UX ("Share for review" without a real secure link)
is prohibited.

## Consequences

- Product copy says **"Export review packet"** — never "Share for review",
  never comments/assignments/presence/team seats.
- The packet is complete and honest: campaign summary, asset index with
  statuses and brief-snapshot timestamps, evidence references, unresolved
  items (disclosed, never erased) and a downstream-owner checklist.
- Formats: Markdown and print-friendly self-contained HTML (no external
  dependencies, user content escaped). No fake `.docx` labeling.
- If P1 revisits links, the security bar above is the acceptance checklist.
