#!/usr/bin/env node
// ---------------------------------------------------------------------------
// v15 SC-02 — operator reconciliation helper (READ-ONLY, owner-run).
//
// Finds Scalvya-owned Stripe customers (metadata.source = launchbloom) that are
// NOT linked in the Supabase `customers` table — the orphans a failed link write
// can leave — and duplicate Scalvya customers that share one app_user_id (the
// reconciliation-required case checkout fails closed on).
//
//   node backend/scripts/find-orphan-customers.js            # summary
//   node backend/scripts/find-orphan-customers.js --user <id>  # one user
//
// It MUTATES NOTHING: no create, no delete, no link write. It prints opaque
// Stripe ids and counts only — never an email or any customer text. Run it with
// the LIVE Stripe key and the service-role Supabase key; deletion/merging of a
// real customer is a separate, deliberate owner action (a customer may already
// reference a subscription or session), never automated here.
// ---------------------------------------------------------------------------

'use strict';

const stripe = require('../lib/stripe');
const supabase = require('../lib/supabase');

const APP_STRIPE_SOURCE = 'launchbloom';

async function linkedCustomerIds() {
  const ids = new Set();
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .not('stripe_customer_id', 'is', null)
      .range(from, from + page - 1);
    if (error) throw error;
    for (const r of data || []) if (r.stripe_customer_id) ids.add(r.stripe_customer_id);
    if (!data || data.length < page) break;
    from += page;
  }
  return ids;
}

async function scalvyaCustomers(userId) {
  const query = userId
    ? `metadata['app_user_id']:'${userId}' AND metadata['source']:'${APP_STRIPE_SOURCE}'`
    : `metadata['source']:'${APP_STRIPE_SOURCE}'`;
  const out = [];
  let params = { query, limit: 100 };
  for (;;) {
    const res = await stripe.customers.search(params);
    for (const c of res.data || []) {
      if (c && !c.deleted && c.metadata && c.metadata.source === APP_STRIPE_SOURCE) {
        out.push({ id: c.id, app_user_id: c.metadata.app_user_id || null });
      }
    }
    if (!res.has_more) break;
    params = { query, limit: 100, page: res.next_page };
  }
  return out;
}

async function main() {
  const userArgIdx = process.argv.indexOf('--user');
  const userId = userArgIdx !== -1 ? process.argv[userArgIdx + 1] : null;

  const [linked, customers] = await Promise.all([linkedCustomerIds(), scalvyaCustomers(userId)]);

  const orphans = customers.filter((c) => !linked.has(c.id));
  const byUser = new Map();
  for (const c of customers) {
    if (!c.app_user_id) continue;
    byUser.set(c.app_user_id, (byUser.get(c.app_user_id) || []).concat(c.id));
  }
  const duplicates = [...byUser.entries()].filter(([, ids]) => ids.length > 1);

  console.log(JSON.stringify({
    scope: userId ? `user ${userId}` : 'all Scalvya customers',
    scalvya_customers: customers.length,
    linked_in_db: customers.length - orphans.length,
    orphans_not_linked: orphans.map((c) => c.id),
    duplicate_user_ids: duplicates.map(([uid, ids]) => ({ app_user_id: uid, customer_ids: ids })),
    note: 'READ-ONLY. Reconciling or deleting any customer is a deliberate owner action; a customer may reference a subscription or session.',
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    // Never print the raw provider payload; the code/type is enough to triage.
    console.error(`[find-orphan-customers] failed: ${err.code || err.type || 'error'}`);
    process.exit(1);
  });
}

module.exports = { linkedCustomerIds, scalvyaCustomers };
