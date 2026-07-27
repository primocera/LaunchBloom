// v11 SC-06 — a daily AI spend ceiling is a release gate, not a suggestion.
//
// The readiness endpoint has reported `ai_spend_ceiling_usd: not set` since
// v10 without anything blocking on it, so a paid launch could have happened
// with no cap on what a runaway loop or an abusive account could spend.
//
// Presence alone is not the bar: an unparseable, zero, negative or absurd
// value disables the cap exactly as completely as an absent one, and each of
// those is a plausible typo. All of them must fail closed.

const test = require('node:test');
const assert = require('node:assert/strict');

const { spendCeiling, MAX_SENSIBLE_CEILING_USD, collect } = require('../scripts/release-check');

function withCeiling(value, fn) {
  const saved = process.env.AI_SPEND_DAILY_CEILING_USD;
  if (value === undefined) delete process.env.AI_SPEND_DAILY_CEILING_USD;
  else process.env.AI_SPEND_DAILY_CEILING_USD = value;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.AI_SPEND_DAILY_CEILING_USD;
    else process.env.AI_SPEND_DAILY_CEILING_USD = saved;
  }
}

test('an absent ceiling is rejected', () => {
  withCeiling(undefined, () => {
    const r = spendCeiling();
    assert.equal(r.ok, false);
    assert.match(r.detail, /not set/);
  });
  withCeiling('   ', () => assert.equal(spendCeiling().ok, false));
});

test('a non-numeric ceiling is rejected rather than coerced', () => {
  for (const bad of ['fifty', '25 USD', '$25', 'NaN', '1,50']) {
    withCeiling(bad, () => {
      assert.equal(spendCeiling().ok, false, `"${bad}" was accepted as a ceiling`);
    });
  }
});

test('zero and negative ceilings are rejected — they are not "unlimited", they are broken', () => {
  for (const bad of ['0', '-1', '-0.5']) {
    withCeiling(bad, () => assert.equal(spendCeiling().ok, false, `"${bad}" was accepted`));
  }
});

test('an absurdly large ceiling is rejected as a typo, not honoured as a policy', () => {
  withCeiling(String(MAX_SENSIBLE_CEILING_USD + 1), () => {
    const r = spendCeiling();
    assert.equal(r.ok, false);
    assert.match(r.detail, /caps nothing/);
  });
  withCeiling('1e9', () => assert.equal(spendCeiling().ok, false));
});

test('a sensible ceiling passes and reports the value it read', () => {
  for (const good of ['25', '25.50', ' 100 ', '0.5']) {
    withCeiling(good, () => {
      const r = spendCeiling();
      assert.equal(r.ok, true, `"${good}" was rejected`);
      assert.match(r.detail, /daily ceiling set to \$/);
    });
  }
});

test('the ceiling check is a production blocker and appears in the release check', () => {
  const { checks } = collect();
  const check = checks.find((c) => c.name === 'ai:spend_ceiling');
  assert.ok(check, 'ai:spend_ceiling is missing from the release check');

  // Outside production it is an owner/external action; in production it blocks.
  const savedNode = process.env.NODE_ENV;
  const savedStripe = process.env.STRIPE_SECRET_KEY;
  try {
    process.env.NODE_ENV = 'production';
    process.env.STRIPE_SECRET_KEY = 'sk_live_release_gate_test';
    withCeiling(undefined, () => {
      const production = collect().checks.find((c) => c.name === 'ai:spend_ceiling');
      assert.equal(production.ok, false);
      assert.equal(production.level, 'blocker', 'a missing spend ceiling must block a production release');
    });
  } finally {
    if (savedNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNode;
    if (savedStripe === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedStripe;
  }
});

test('the gate never prints a secret alongside the ceiling', () => {
  withCeiling('25', () => {
    const detail = spendCeiling().detail;
    for (const secret of ['sk_', 'eyJ', 'supabase', 'resend', 're_']) {
      assert.ok(!detail.toLowerCase().includes(secret), `the detail string leaked "${secret}"`);
    }
  });
});
