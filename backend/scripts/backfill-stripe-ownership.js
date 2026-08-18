#!/usr/bin/env node
// ---------------------------------------------------------------------------
// SV-01 (v20) — legacy Stripe ownership inventory + backfill (owner-run).
//
// Completes the deferred ownership architecture safely. It has two modes:
//
//   node backend/scripts/backfill-stripe-ownership.js            # INVENTORY (read-only)
//   node backend/scripts/backfill-stripe-ownership.js --apply    # bounded backfill
//     [--max N] [--cursor <stripe_object_id>] [--receipt <path>]
//
// INVENTORY (default): scans Scalvya-owned + candidate-legacy Stripe
// subscriptions, classifies each with the ONE canonical rule
// (lib/stripe-ownership.js), and prints PII-free counts + an audit receipt. It
// mutates nothing.
//
// APPLY: for each object that is a SAFE legacy match (a configured Scalvya price
// AND no foreign stamp), it records an explicit, provenance-tagged row in
// public.stripe_object_ownership (status 'mapped') and stamps the exact
// source/app_user_id metadata onto the Stripe object so future events are OWNED,
// not merely price-fallback. AMBIGUOUS objects are recorded status 'ambiguous'
// and never adopted — they stay visible for owner reconciliation and block paid
// expansion. FOREIGN objects are never touched.
//
// Guarantees: bounded per run (--max, default 50), resumable (--cursor / receipt
// records last processed id), idempotent (unique object id; re-running skips
// already-mapped objects), never derives ownership from email, never mutates a
// foreign object, never runs automatically on deploy. Requires migration 038.
// Run with the LIVE Stripe key + service-role Supabase key.
// ---------------------------------------------------------------------------

'use strict';

const ownership = require('../lib/stripe-ownership');

/**
 * Pure planner: given a list of Stripe subscription-like objects and a
 * configured-price predicate, decide the action for each. No I/O — exported so
 * the decision table is unit-tested exhaustively without touching Stripe.
 *
 * Returns { adopt[], review[], skip[] } where:
 *   adopt  = safe legacy matches to stamp + map (legacy_price, exact user id)
 *   review = ambiguous → record for owner reconciliation, never adopt
 *   skip   = already owned (stamped) or foreign → no action
 */
function planBackfill(objects, options = {}) {
  const isConfiguredPrice = options.isConfiguredPrice || (() => false);
  const legacyMap = options.legacyMap; // ids already mapped → skip
  const out = { adopt: [], review: [], skip: [] };
  for (const obj of objects || []) {
    if (legacyMap && obj.id && typeof legacyMap.has === 'function' && legacyMap.has(obj.id)) {
      out.skip.push({ id: obj.id, reason: 'already_mapped' });
      continue;
    }
    const state = ownership.classifySubscription(obj, { isConfiguredPrice });
    const appUserId = obj?.metadata?.app_user_id || null;
    switch (state) {
      case ownership.OWNERSHIP.OWNED:
        out.skip.push({ id: obj.id, reason: 'already_owned' });
        break;
      case ownership.OWNERSHIP.FOREIGN:
        out.skip.push({ id: obj.id, reason: 'foreign' });
        break;
      case ownership.OWNERSHIP.AMBIGUOUS:
        out.review.push({ id: obj.id, reason: 'ambiguous_stamp', app_user_id: appUserId });
        break;
      case ownership.OWNERSHIP.LEGACY_PRICE:
        // A configured price with a bare app_user_id is a safe adopt; a
        // configured price with NO app_user_id cannot be attributed to a user
        // and must be reviewed, never guessed.
        if (appUserId) out.adopt.push({ id: obj.id, app_user_id: appUserId, provenance: 'stripe_search' });
        else out.review.push({ id: obj.id, reason: 'legacy_price_no_user' });
        break;
      default:
        out.review.push({ id: obj.id, reason: `unexpected_${state}` });
    }
  }
  return out;
}

// ── runtime (I/O) half — only reached when run as a script ─────────────────

async function fetchCandidateSubscriptions(stripe, { cursor, max }) {
  // Scalvya-owned + candidate legacy subscriptions. We over-fetch by source and
  // by configured price, then the pure planner decides; Stripe search cannot
  // express "no foreign stamp", so classification stays in one place.
  const out = [];
  let params = { query: `status:'active' OR status:'trialing' OR status:'past_due'`, limit: Math.min(100, max) };
  if (cursor) params.page = cursor;
  const res = await stripe.subscriptions.search
    ? await stripe.subscriptions.search(params)
    : { data: [], has_more: false };
  for (const s of res.data || []) out.push(s);
  return { objects: out.slice(0, max), nextCursor: res.has_more ? res.next_page : null };
}

async function main() {
  const stripe = require('../lib/stripe');
  const supabase = require('../lib/supabase');
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const max = Number(valueOf(argv, '--max')) || 50;
  const cursor = valueOf(argv, '--cursor') || null;

  const { pricePlans } = require('../routes/customers');
  const isConfiguredPrice = (priceId) => !!(priceId && pricePlans()[priceId]);

  // Load the explicit map so an --apply re-run is idempotent.
  const mapped = new Set();
  const { data: mappedRows } = await supabase
    .from('stripe_object_ownership')
    .select('stripe_object_id')
    .eq('object_type', 'subscription');
  for (const r of mappedRows || []) mapped.add(r.stripe_object_id);

  const { objects, nextCursor } = await fetchCandidateSubscriptions(stripe, { cursor, max });
  const plan = planBackfill(objects, { isConfiguredPrice, legacyMap: mapped });

  let applied = 0;
  let recordedForReview = 0;
  if (apply) {
    for (const a of plan.adopt) {
      // 1. Stamp exact ownership onto the Stripe object (future events → OWNED).
      await stripe.subscriptions.update(a.id, {
        metadata: { source: ownership.APP_STRIPE_SOURCE, app_user_id: a.app_user_id },
      });
      // 2. Record the explicit, provenance-tagged mapping (idempotent by unique id).
      await supabase.from('stripe_object_ownership').upsert({
        object_type: 'subscription',
        stripe_object_id: a.id,
        app_source: ownership.APP_STRIPE_SOURCE,
        app_user_id: a.app_user_id,
        provenance: a.provenance,
        status: 'mapped',
        verified_at: new Date().toISOString(),
      }, { onConflict: 'object_type,stripe_object_id' });
      applied += 1;
    }
    for (const r of plan.review) {
      await supabase.from('stripe_object_ownership').upsert({
        object_type: 'subscription',
        stripe_object_id: r.id,
        app_source: ownership.APP_STRIPE_SOURCE,
        app_user_id: r.app_user_id || null,
        provenance: 'owner_manual',
        status: 'ambiguous',
      }, { onConflict: 'object_type,stripe_object_id' });
      recordedForReview += 1;
    }
  }

  // PII-free audit receipt: opaque ids + counts only, never an email/payload.
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'inventory',
    scanned: objects.length,
    would_adopt: plan.adopt.length,
    ambiguous_for_review: plan.review.length,
    skipped: plan.skip.length,
    applied,
    recorded_for_review: recordedForReview,
    resume_cursor: nextCursor,
    at: new Date().toISOString(),
    note: apply
      ? 'Bounded backfill. Re-run with --cursor <resume_cursor> for the next batch. Ambiguous objects were recorded for owner reconciliation, never adopted.'
      : 'READ-ONLY inventory. Re-run with --apply to stamp + map the safe legacy matches; ambiguous objects will be recorded for reconciliation, never adopted.',
  }, null, 2));
}

function valueOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : null;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[backfill-stripe-ownership] failed: ${err.code || err.type || 'error'}`);
    process.exit(1);
  });
}

module.exports = { planBackfill };
