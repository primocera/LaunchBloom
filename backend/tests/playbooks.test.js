const test = require('node:test');
const assert = require('node:assert/strict');

const { PLAYBOOKS, playbookById, sanitizeTemplateData, TEMPLATE_BRIEF_FIELDS } = require('../lib/playbooks');
const { DELIVERABLE_CODES, REQUIREMENT_STATES } = require('../lib/deliverables');

test('playbooks are versioned, have stable IDs and only valid deliverable states', () => {
  assert.ok(PLAYBOOKS.length >= 3 && PLAYBOOKS.length <= 5);
  for (const p of PLAYBOOKS) {
    assert.ok(p.id && p.version >= 1 && p.label && p.description);
    for (const [code, state] of Object.entries(p.deliverables)) {
      assert.ok(DELIVERABLE_CODES.includes(code), `unknown code ${code}`);
      assert.ok(REQUIREMENT_STATES.includes(state), `unknown state ${state}`);
    }
    assert.ok(Array.isArray(p.brief_questions) && p.brief_questions.length > 0);
  }
  assert.equal(playbookById('product_launch').id, 'product_launch');
  assert.equal(playbookById('nope'), null);
});

test('playbooks contain no fabricated benchmarks, urgency, or outcome promises', () => {
  const text = JSON.stringify(PLAYBOOKS).toLowerCase();
  for (const banned of ['conversion rate', 'guarantee', '% lift', 'best practice shows', 'countdown', 'x% more', 'proven to increase']) {
    assert.ok(!text.includes(banned), `playbook text contains banned phrase: ${banned}`);
  }
});

test('sanitizeTemplateData keeps only chosen allowed brief fields', () => {
  const campaign = {
    objective: 'Launch', audience: 'runners', offer_summary: 'Bundle',
    promo_terms: '20% off', proof: '4.8 stars', channels: ['email'],
    brief_approved: true, status: 'active', strategy: { core_message: 'secret' },
    start_date: '2026-07-01', name: 'Q3',
  };
  const data = sanitizeTemplateData(campaign, ['objective', 'audience', 'channels', 'strategy', 'brief_approved', 'start_date'], [
    { deliverable_code: 'email_flow', requirement_state: 'required' },
  ]);
  assert.deepEqual(Object.keys(data.brief).sort(), ['audience', 'channels', 'objective']);
  // approval, strategy, statuses and dates never transfer even if requested
  assert.ok(!('brief_approved' in data.brief));
  assert.ok(!('strategy' in data.brief));
  assert.ok(!('start_date' in data.brief));
  assert.deepEqual(data.deliverables, [{ deliverable_code: 'email_flow', requirement_state: 'required' }]);
});

test('the allowed template field list never includes approval/status/dates', () => {
  for (const banned of ['brief_approved', 'status', 'strategy', 'start_date', 'end_date', 'deadline', 'archived']) {
    assert.ok(!TEMPLATE_BRIEF_FIELDS.includes(banned));
  }
});
