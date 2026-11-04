// Monthly AI-action allowance on yearly plans.
//
// Plan limits are per month on both billing intervals ("120 AI actions /
// month"), but a yearly subscription's Stripe period spans the whole year.
// Metering from the period start gave a yearly buyer one month's allowance
// for twelve months; the window is now the current monthly cycle.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
const { stubModule, makeFakeSupabase } = require('./helpers');
stubModule('lib/supabase.js', makeFakeSupabase({}));

const { monthlyWindowStart, windowResetsAt } = require('../lib/usage');

const at = (s) => new Date(s);

test('a monthly subscription meters from its own period start', () => {
  const start = '2026-10-20T09:00:00.000Z';
  assert.equal(monthlyWindowStart(start, at('2026-11-03T12:00:00Z')), start);
});

test('a yearly subscription meters from the latest monthly anniversary', () => {
  const start = '2026-01-15T09:00:00.000Z';
  assert.equal(monthlyWindowStart(start, at('2026-01-20T00:00:00Z')), start);
  assert.equal(monthlyWindowStart(start, at('2026-02-15T09:00:00Z')), '2026-02-15T09:00:00.000Z');
  assert.equal(monthlyWindowStart(start, at('2026-07-01T00:00:00Z')), '2026-06-15T09:00:00.000Z');
  assert.equal(monthlyWindowStart(start, at('2026-12-31T23:59:59Z')), '2026-12-15T09:00:00.000Z');
});

test('month-end anniversaries clamp like Stripe billing (Jan 31 -> Feb 28)', () => {
  const start = '2026-01-31T00:00:00.000Z';
  assert.equal(monthlyWindowStart(start, at('2026-03-01T00:00:00Z')), '2026-02-28T00:00:00.000Z');
  assert.equal(monthlyWindowStart(start, at('2026-04-05T00:00:00Z')), '2026-03-31T00:00:00.000Z');
});

test('a bad or future start is returned unchanged', () => {
  assert.equal(monthlyWindowStart('not-a-date'), 'not-a-date');
  const future = '2099-01-01T00:00:00.000Z';
  assert.equal(monthlyWindowStart(future, at('2026-11-03T00:00:00Z')), future);
});

test('the window resets one month after it began; lifetime windows never reset', () => {
  assert.equal(windowResetsAt('2026-06-15T09:00:00.000Z'), '2026-07-15T09:00:00.000Z');
  assert.equal(windowResetsAt('2026-01-31T00:00:00.000Z'), '2026-02-28T00:00:00.000Z');
  assert.equal(windowResetsAt(null), null);
});
