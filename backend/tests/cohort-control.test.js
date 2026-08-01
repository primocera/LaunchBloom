// v12 SC-V12-07 — signup cohort control must fail closed.

const test = require('node:test');
const assert = require('node:assert/strict');

const { signupDecision, capIsActive, capIsMisconfigured } = require('../lib/cohort-control');

test('uncapped operation allows signups (unset or 0)', () => {
  assert.equal(signupDecision({}, null).allow, true);
  assert.equal(signupDecision({ BETA_INVITE_CAP: '' }, null).allow, true);
  assert.equal(signupDecision({ BETA_INVITE_CAP: '0' }, null).allow, true);
  assert.equal(capIsActive({ BETA_INVITE_CAP: '0' }), false);
});

test('the emergency stop refuses every signup, capped or not', () => {
  const d = signupDecision({ SIGNUP_PAUSED: '1' }, 0);
  assert.equal(d.allow, false);
  assert.equal(d.code, 'SIGNUP_PAUSED');
  // Even with an otherwise-fine cap and room to spare.
  assert.equal(signupDecision({ SIGNUP_PAUSED: '1', BETA_INVITE_CAP: '20' }, 1).allow, false);
});

test('a MISCONFIGURED cap fails closed instead of opening the doors', () => {
  for (const bad of ['abc', '-5', '3.5', 'twenty']) {
    assert.equal(capIsMisconfigured({ BETA_INVITE_CAP: bad }), true, `${bad} must be misconfigured`);
    const d = signupDecision({ BETA_INVITE_CAP: bad }, 0);
    assert.equal(d.allow, false, `${bad} must refuse signups`);
    assert.equal(d.code, 'COHORT_MISCONFIGURED');
  }
});

test('a valid cap with an UNVERIFIABLE count fails closed', () => {
  const d = signupDecision({ BETA_INVITE_CAP: '20' }, null);
  assert.equal(d.allow, false);
  assert.equal(d.code, 'COHORT_COUNT_UNAVAILABLE');
});

test('a valid cap admits under the limit and refuses at or over it', () => {
  assert.equal(signupDecision({ BETA_INVITE_CAP: '20' }, 19).allow, true);
  const full = signupDecision({ BETA_INVITE_CAP: '20' }, 20);
  assert.equal(full.allow, false);
  assert.equal(full.code, 'BETA_FULL');
  assert.equal(signupDecision({ BETA_INVITE_CAP: '20' }, 25).code, 'BETA_FULL');
});

test('capIsActive only asks for a count when a positive integer cap is set', () => {
  assert.equal(capIsActive({ BETA_INVITE_CAP: '20' }), true);
  assert.equal(capIsActive({ BETA_INVITE_CAP: 'abc' }), false); // misconfig, not "active"
  assert.equal(capIsActive({}), false);
});
