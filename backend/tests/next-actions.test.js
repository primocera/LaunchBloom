// v5 Prompt 4 — deterministic Home recommendation tests: empty, trial,
// active-campaign and limit-reached states.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const modUrl = pathToFileURL(path.join(__dirname, '..', '..', 'app-src', 'lib', 'next-actions.js')).href;

const fullProfile = { brand_name: 'X', business_type: 'ecommerce', products: 'candles', audience_segments: 'gift buyers', tone: 'warm' };
const acct = (used, limit) => ({ usage: { ai_actions: used }, limits: { ai_actions: limit } });

test('empty new user (free) → primary is Brand Profile setup, ≤3 actions', async () => {
  const { homePlan } = await import(modUrl);
  const r = homePlan({ profile: {}, campaigns: [], assets: [], kit: null, account: acct(0, 0), plan: 'free' });
  assert.equal(r.primary.to, '/app/brand');
  assert.ok(r.actions.length <= 3);
  assert.equal(r.usageLevel, 'ok');
});

test('trial user with profile but no campaigns → primary is first campaign', async () => {
  const { homePlan } = await import(modUrl);
  const r = homePlan({ profile: fullProfile, campaigns: [], assets: [], kit: null, account: acct(2, 20), plan: 'trial' });
  assert.equal(r.primary.to, '/app/campaigns');
  assert.ok(!r.actions.some((a) => a.to === r.primary.to && a.label === r.primary.label));
});

test('active campaign without assets → primary creates assets for it', async () => {
  const { homePlan } = await import(modUrl);
  const r = homePlan({
    profile: fullProfile,
    campaigns: [{ id: 1, name: 'Summer Sale', status: 'active', asset_counts: {} }],
    assets: [{ id: 9, status: 'published', updated_at: '2026-07-01' }],
    kit: {}, account: acct(5, 30), plan: 'starter',
  });
  assert.match(r.primary.label, /Summer Sale/);
});

test('limit reached → primary routes to Account and usageLevel is over', async () => {
  const { homePlan } = await import(modUrl);
  const r = homePlan({ profile: fullProfile, campaigns: [], assets: [], kit: {}, account: acct(30, 30), plan: 'starter' });
  assert.equal(r.usageLevel, 'over');
  assert.equal(r.primary.to, '/app/account');
});

test('80% usage warns without hijacking the primary action', async () => {
  const { homePlan } = await import(modUrl);
  const r = homePlan({ profile: fullProfile, campaigns: [], assets: [], kit: {}, account: acct(24, 30), plan: 'starter' });
  assert.equal(r.usageLevel, 'warn');
  assert.notEqual(r.primary.to, '/app/account');
});

test('unfinished draft wins over new-campaign nudge for returning users', async () => {
  const { homePlan } = await import(modUrl);
  const r = homePlan({
    profile: fullProfile,
    campaigns: [{ id: 1, name: 'Evergreen', status: 'active', asset_counts: { email_assets: 2 } }],
    assets: [{ id: 3, title: 'Welcome email 1', status: 'draft', updated_at: '2026-07-16T10:00:00Z' }],
    kit: {}, account: acct(3, 30), plan: 'pro',
  });
  assert.match(r.primary.label, /Welcome email 1/);
});
