// Playbook v6 Prompt 29 — transactional email content contract. Subjects match
// the durable account/subscription state, prices/intervals/dates appear where
// relevant, plain-text parts are complete, and no kit vocabulary remains.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

const { stubModule, makeFakeSupabase } = require('./helpers');
stubModule('lib/supabase.js', makeFakeSupabase({}));

const { TEMPLATES } = require('../lib/lifecycle-email');

const chargeAt = '2026-08-01T09:00:00.000Z';

test('trial_started states the first charge date, price and campaign allowance', () => {
  const m = TEMPLATES.trial_started({ chargeAt, planLabel: 'Pro', price: '$24.99', interval: 'month' });
  assert.match(m.subject, /Your trial started — first charge on/);
  assert.match(m.html, /\$24\.99\/month/);
  assert.match(m.html, /1 full launch campaign/);
  assert.match(m.text, /First charge on/);
  assert.ok(!/full launch kit/i.test(m.html + m.text), 'must not use kit vocabulary');
});

test('trial_ending shows the exact timestamp with timezone', () => {
  const m = TEMPLATES.trial_ending({ chargeAt, planLabel: 'Starter', price: '$12.99', interval: 'month' });
  assert.match(m.subject, /trial ends tomorrow/);
  assert.match(m.html, /UTC/); // timezone label present
  assert.match(m.html, /\$12\.99\/month/);
});

test('payment_succeeded names the plan and amount and mentions usage reset', () => {
  const m = TEMPLATES.payment_succeeded({ periodEnd: chargeAt, planLabel: 'Pro', amount: '$24.99' });
  assert.match(m.subject, /Payment received — Pro is active/);
  assert.match(m.html, /\$24\.99/);
  assert.match(m.html, /reset/i);
});

test('payment_failed avoids vague fear language and points to the portal', () => {
  const m = TEMPLATES.payment_failed();
  assert.match(m.subject, /update your payment method/);
  assert.match(m.html, /retry automatically/);
  assert.ok(!/urgent|immediately|suspended/i.test(m.html), 'no vague fear language');
});

test('cancellation_scheduled states the end date and retention behavior', () => {
  const m = TEMPLATES.cancellation_scheduled({ periodEnd: chargeAt });
  assert.match(m.subject, /Your plan ends on/);
  assert.match(m.html, /retention policy/);
});

test('deletion_completed lists retained legal records and a support path', () => {
  const ok = TEMPLATES.deletion_completed({ completed: true, failedSteps: [] });
  assert.match(ok.subject, /account deletion record/);
  assert.match(ok.html, /retained/i);
  const bad = TEMPLATES.deletion_completed({ completed: false, failedSteps: ['stripe_cancellation'] });
  assert.match(bad.html, /stripe_cancellation/);
  assert.match(bad.text, /Contact support/);
});
