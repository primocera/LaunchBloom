# Runbook — Incidents & Monitoring (owner-operated)

Lightweight incident response for a paid service. Monitoring detects failures
**without accessing customer content**: no emails, campaign/asset text, evidence
URLs or payment details appear in any alert, log category or readiness report.

## Signals (secret-safe)

| Signal | Source | Healthy | Alert when |
|--------|--------|---------|------------|
| Core service up | `GET /health` | `status: ok` | non-200 / timeout |
| Config presence + migrations | `GET /api/admin/readiness` → `checks` | `ready: true` | any `blocker` not ok |
| Email outbox backlog | readiness → `live.outbox_backlog` | ~0 | backlog grows unbounded |
| Webhook failures (24h) | readiness → `live.webhook_failures_24h` | 0 | > 0 |
| AI spend vs ceiling | readiness → `live.spend_over_ceiling` | `false` | `true` |
| Bundle freshness | `npm run check:app-fresh` | fresh | stale bundle on `main` |

## Alert content policy

- Structured category + count + request ID only. **Never** raw provider error
  bodies, customer identifiers or content.
- User-facing errors show a request ID and a recovery action, not the underlying
  provider message.

## Response

1. Acknowledge; capture the request ID and the failing signal.
2. Triage category: billing / email / spend / core service / data-rights.
3. Contain (e.g. pause spend, hold sends) — owner-authorized only.
4. Recover using the matching journey in
   [RUNBOOK_TRANSACTION_REHEARSAL.md](./RUNBOOK_TRANSACTION_REHEARSAL.md).
5. Record: incident owner, timeline, root cause, rollback taken, follow-up.

## External processors

Adopt an external log/alert processor **only after** its subprocessor and
privacy disclosures are updated. Until then, keep signals in-app and secret-safe.

## Support expectations

Honest support only — no SLA is published unless it is operationally staffed.
Billing/legal/support copy distinguishes automatic system state from
owner/manual evidence.
