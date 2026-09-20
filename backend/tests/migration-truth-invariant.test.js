// v23 SV-23-03 — the Stripe-ownership migration-truth cross-field invariant.
//
// The launch state must never simultaneously claim enforcement is active /
// paid-ready AND leave migrations 038-040 unproven. An earlier manifest carried
// exactly that contradiction (prose said enforcement_active while the structured
// migration range said 001-037 / "NOT YET APPLIED"). integrityProblems now makes
// that self-contradiction a hard `launch:verify` failure.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { integrityProblems } = require('../lib/launch-state');

const ROOT = path.resolve(__dirname, '..', '..');
const STATE_PATH = path.join(ROOT, 'docs', 'launch', 'launch-state.json');

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const CONTRADICTION = /claims enforcement_active\/paid_ready but migrations 038-040 are not applied_verified/;

test('the real manifest carries a structured ownership_enforcement block (cannot dodge by omission)', () => {
  const oe = loadState().migrations.ownership_enforcement;
  assert.ok(oe, 'migrations.ownership_enforcement must exist');
  assert.ok(['pending', 'unverified', 'applied_verified'].includes(oe.migrations_038_040));
  assert.equal(typeof oe.claimed_enforcement_active, 'boolean');
  assert.equal(typeof oe.claimed_paid_ready, 'boolean');
});

test('the real (honest) manifest does NOT trip the ownership contradiction', () => {
  const problems = integrityProblems(loadState());
  assert.ok(!problems.some((p) => CONTRADICTION.test(p)),
    `honest manifest should not trip the invariant; got: ${problems.filter((p) => CONTRADICTION.test(p)).join('; ')}`);
});

test('claiming enforcement_active while 038-040 are pending FAILS verify', () => {
  const state = clone(loadState());
  state.migrations.ownership_enforcement.claimed_enforcement_active = true; // but 038-040 still pending
  const problems = integrityProblems(state);
  assert.ok(problems.some((p) => CONTRADICTION.test(p)), problems.join('; '));
});

test('claiming paid_ready while 038-040 are pending FAILS verify', () => {
  const state = clone(loadState());
  state.migrations.ownership_enforcement.claimed_paid_ready = true;
  const problems = integrityProblems(state);
  assert.ok(problems.some((p) => CONTRADICTION.test(p)));
});

test('enforcement_active without a recorded true uniqueness probe FAILS verify', () => {
  const state = clone(loadState());
  const oe = state.migrations.ownership_enforcement;
  oe.migrations_038_040 = 'applied_verified';
  oe.owner_probe_ref = 'docs/evidence/probe.json';
  oe.claimed_enforcement_active = true;
  oe.uniqueness_probe = 'not_run'; // arbiter not proven
  const problems = integrityProblems(state);
  assert.ok(problems.some((p) => /stripe_ownership_uniqueness_ready\(\) is not recorded true/.test(p)));
});

test('applied_verified without an owner_probe_ref FAILS verify', () => {
  const state = clone(loadState());
  const oe = state.migrations.ownership_enforcement;
  oe.migrations_038_040 = 'applied_verified';
  oe.uniqueness_probe = 'true';
  oe.owner_probe_ref = null; // no machine-readable proof cited
  const problems = integrityProblems(state);
  assert.ok(problems.some((p) => /cites no owner_probe_ref/.test(p)));
});

test('a fully-proven enforcement block (with probe + owner ref) is accepted by the invariant', () => {
  const state = clone(loadState());
  const oe = state.migrations.ownership_enforcement;
  oe.migrations_038_040 = 'applied_verified';
  oe.uniqueness_probe = 'true';
  oe.owner_probe_ref = 'docs/evidence/2026-09-21-migration-038-040-probe.json';
  oe.claimed_enforcement_active = true;
  oe.claimed_paid_ready = true;
  const problems = integrityProblems(state).filter((p) => /ownership_enforcement/.test(p) || CONTRADICTION.test(p));
  assert.deepEqual(problems, [], problems.join('; '));
});
