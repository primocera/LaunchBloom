const test = require('node:test');
const assert = require('node:assert/strict');

const { FLOW_BLUEPRINTS, FLOW_TYPES, buildSequence } = require('../lib/email-blueprints');

test('flow types map to the audit\'s exact email counts', () => {
  assert.equal(buildSequence(['abandon_cart']).total, 3);
  assert.equal(buildSequence(['post_purchase']).total, 4);
  assert.equal(buildSequence(['review_request']).total, 2);
  assert.equal(buildSequence(['winback']).total, 3);
  assert.equal(buildSequence(['browse_abandon']).total, 3);
  assert.equal(buildSequence(['back_in_stock']).total, 2);
  assert.equal(buildSequence(['sunset']).total, 2);
  const welcome = buildSequence(['welcome']).total;
  assert.ok(welcome >= 4 && welcome <= 6, `welcome should be 4-6, got ${welcome}`);
});

test('multiple flows concatenate and each restarts email_order at 1', () => {
  const seq = buildSequence(['abandon_cart', 'winback']);
  assert.equal(seq.total, 6);
  const cart = seq.emails.filter((e) => e.flow_type === 'abandon_cart');
  assert.deepEqual(cart.map((e) => e.email_order), [1, 2, 3]);
});

test('every email carries an objective, timing and segment', () => {
  for (const flow of FLOW_TYPES) {
    for (const e of buildSequence([flow]).emails) {
      assert.ok(e.objective && e.send_timing && e.segment, `${flow} email ${e.email_order} missing fields`);
    }
  }
});

test('campaign is configurable and clamped to 2-8', () => {
  assert.equal(buildSequence(['campaign'], { campaignCount: 5 }).total, 5);
  assert.equal(buildSequence(['campaign'], { campaignCount: 99 }).total, 8);
  assert.equal(buildSequence(['campaign'], { campaignCount: 1 }).total, 2);
});

test('unknown flow types are ignored (total 0)', () => {
  assert.equal(buildSequence(['nonsense']).total, 0);
  assert.equal(buildSequence([]).total, 0);
});

test('structureText lists the emails for the prompt', () => {
  const { structureText } = buildSequence(['abandon_cart']);
  assert.match(structureText, /Abandoned cart flow \(3 emails\)/);
  assert.match(structureText, /send:/);
});

test('blueprints cover the required flow types', () => {
  for (const f of ['welcome', 'abandon_cart', 'browse_abandon', 'post_purchase', 'review_request', 'winback', 'back_in_stock', 'sunset']) {
    assert.ok(FLOW_BLUEPRINTS[f], `missing blueprint: ${f}`);
  }
});
