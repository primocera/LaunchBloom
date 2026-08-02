// v13 SC-P0-02 — the reconciliation tool is read-only and idempotent.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { collectAnomalies, maskEmail } = require('../scripts/reconcile-entitlements');

const PLANS = { price_starter_m: 'starter', price_studio_m: 'studio' };

const SUBS = [
  { customer_id: 'c1', status: 'active', stripe_price_id: 'price_starter_m', stripe_subscription_id: 'sub_1', stripe_event_at: '2026-01-01T00:00:00Z' },
  { customer_id: 'c2', status: 'active', stripe_price_id: 'price_starter_m', stripe_subscription_id: 'sub_2', stripe_event_at: '2026-08-02T00:00:00Z' },
  { customer_id: 'c2', status: 'active', stripe_price_id: 'price_studio_m', stripe_subscription_id: 'sub_3', stripe_event_at: '2026-01-01T00:00:00Z' },
  { customer_id: 'c3', status: 'active', stripe_price_id: 'price_retired', stripe_subscription_id: 'sub_4', stripe_event_at: '2026-01-01T00:00:00Z' },
];

// Minimal supabase double that records every call, so "read-only" is asserted
// rather than assumed.
function fakeSupabase(calls) {
  return {
    from(table) {
      const b = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
        b[m] = () => { calls.push(`${table}.${m}`); return b; };
      }
      for (const m of ['insert', 'update', 'upsert', 'delete']) {
        b[m] = () => { throw new Error(`WRITE ATTEMPTED: ${table}.${m}`); };
      }
      b.single = () => Promise.resolve({ data: { email: 'someone@example.com' }, error: null });
      b.then = (ok, err) => Promise.resolve(
        table === 'subscriptions' ? { data: SUBS, error: null } : { data: null, error: null }
      ).then(ok, err);
      return b;
    },
  };
}

test('reconciliation reports only the anomalous accounts', async () => {
  const calls = [];
  const findings = await collectAnomalies(fakeSupabase(calls), PLANS);
  assert.deepEqual(findings.map((f) => f.customer_id), ['c2', 'c3']);
  assert.equal(findings[0].granted_plan, 'studio'); // highest valid entitlement
  assert.deepEqual(findings[0].anomalies.map((a) => a.code), ['overlapping_subscriptions']);
  assert.deepEqual(findings[1].anomalies.map((a) => a.code), ['unmapped_price']);
  assert.equal(findings[1].granted_plan, null);
});

test('reconciliation performs no writes', async () => {
  const calls = [];
  await collectAnomalies(fakeSupabase(calls), PLANS);
  assert.ok(calls.length > 0);
  assert.ok(!calls.some((c) => /\.(insert|update|upsert|delete)$/.test(c)), calls.join(','));
});

test('reconciliation is idempotent — two runs give the same report', async () => {
  const a = await collectAnomalies(fakeSupabase([]), PLANS);
  const b = await collectAnomalies(fakeSupabase([]), PLANS);
  assert.deepEqual(a, b);
});

test('the report masks emails', async () => {
  const findings = await collectAnomalies(fakeSupabase([]), PLANS);
  for (const f of findings) assert.ok(!/someone@/.test(f.email), f.email);
  assert.equal(maskEmail('primoz@example.com'), 'pr***@example.com');
});
