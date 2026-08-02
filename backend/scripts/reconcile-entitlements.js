#!/usr/bin/env node
// ---------------------------------------------------------------------------
// v13 SC-P0-02 — entitlement overlap reconciliation. READ-ONLY BY DEFAULT.
//
// Lists every account whose mirrored `subscriptions` rows are in an impossible
// or ambiguous state, and shows what the canonical policy
// (docs/decisions/2026-08-02-canonical-entitlement.md) currently grants them:
//
//   overlapping_subscriptions  more than one entitling row maps to a plan
//   unmapped_price             an entitling row on a retired/foreign price
//
// Guarantees:
//   * no writes, ever, in the default mode — it only SELECTs
//   * no Stripe API calls at all
//   * idempotent: running it twice produces the same report
//   * no raw email in the output; addresses are masked for correlation
//   * missing Supabase env exits 2 (BLOCKED) — never a green "0 anomalies"
//
// Destructive cleanup is deliberately NOT implemented. `--apply` refuses unless
// RECONCILE_OWNER_MODE=1 is set, and even then it only prints the plan it would
// execute, so an operator performs the cancellation in Stripe by hand.
//
// Usage:
//   node backend/scripts/reconcile-entitlements.js            # dry-run report
//   node backend/scripts/reconcile-entitlements.js --json     # machine output
//   node backend/scripts/reconcile-entitlements.js --apply    # refuses (see above)
//
// Exit codes: 0 = no anomalies, 1 = anomalies found, 2 = BLOCKED (config).
// ---------------------------------------------------------------------------

require('dotenv').config();

const { resolveCanonicalEntitlement, ENTITLING_STATUSES } = require('../lib/subscription-state');
const { pricePlans } = require('../routes/customers');

function maskEmail(email) {
  const [user = '', domain = ''] = String(email || '').split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

async function collectAnomalies(supabase, plans) {
  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('customer_id, status, stripe_price_id, stripe_subscription_id, stripe_event_at')
    .in('status', ENTITLING_STATUSES);
  if (error) throw new Error(`subscriptions read failed: ${error.message}`);

  const byCustomer = new Map();
  for (const row of subs || []) {
    if (!byCustomer.has(row.customer_id)) byCustomer.set(row.customer_id, []);
    byCustomer.get(row.customer_id).push(row);
  }

  const findings = [];
  for (const [customerId, rows] of byCustomer) {
    const result = resolveCanonicalEntitlement(rows, plans);
    if (!result.anomalies.length) continue;
    const { data: customer } = await supabase
      .from('customers')
      .select('email')
      .eq('id', customerId)
      .single();
    findings.push({
      customer_id: customerId,
      email: maskEmail(customer && customer.email),
      granted_plan: result.plan,
      anomalies: result.anomalies,
    });
  }
  // Stable output: the report must not depend on row order.
  findings.sort((a, b) => (a.customer_id < b.customer_id ? -1 : 1));
  return findings;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const apply = args.includes('--apply');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('BLOCKED: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. No check was performed.');
    process.exit(2);
  }
  if (apply && process.env.RECONCILE_OWNER_MODE !== '1') {
    console.error('REFUSED: --apply requires RECONCILE_OWNER_MODE=1. Nothing was changed.');
    process.exit(2);
  }

  const plans = pricePlans();
  if (!Object.keys(plans).length) {
    console.error('BLOCKED: no STRIPE_PRICE_* env vars are set — every price would look unmapped.');
    process.exit(2);
  }

  const supabase = require('../lib/supabase');
  const findings = await collectAnomalies(supabase, plans);

  if (asJson) {
    console.log(JSON.stringify({ mode: 'dry-run', count: findings.length, findings }, null, 2));
  } else {
    console.log(`entitlement reconciliation — DRY RUN (read-only, no writes, no Stripe calls)`);
    console.log(`accounts with anomalies: ${findings.length}`);
    for (const f of findings) {
      console.log(`\n- ${f.email} (customer ${f.customer_id}) → granted: ${f.granted_plan || 'none'}`);
      for (const a of f.anomalies) {
        console.log(`    ${a.code}: ${JSON.stringify({ ...a, code: undefined })}`);
      }
    }
    if (apply) {
      console.log('\nowner mode: no automated cleanup is implemented. Cancel the duplicate');
      console.log('subscription in the Stripe dashboard; the webhook mirrors the change.');
    }
  }

  process.exit(findings.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('BLOCKED:', (err && err.message) || err);
    process.exit(2);
  });
}

module.exports = { collectAnomalies, maskEmail };
