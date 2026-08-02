const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// v8 LB-S08: pricing/value-communication contract. These tests FAIL on
// price/limit/disclosure drift and on banned commercial copy.

const { PRICES, publicCatalog, INCLUDED_FREE } = require('../lib/plan-catalog');
const { PLAN_LIMITS } = require('../lib/plan-limits');

test('canonical prices are unchanged in both currencies (owner approval required to move them)', () => {
  assert.deepEqual(PRICES, {
    starter: { usd: { monthly: 12.99, yearly: 99 }, eur: { monthly: 11.31, yearly: 86 } },
    pro: { usd: { monthly: 24.99, yearly: 199 }, eur: { monthly: 21.76, yearly: 173 } },
    studio: { usd: { monthly: 59, yearly: 499 }, eur: { monthly: 51.37, yearly: 434 } },
  });
});

test('EUR catalog quotes euros and USD catalog quotes dollars — displayed = charged', () => {
  const usd = publicCatalog('usd');
  const eur = publicCatalog('eur');
  assert.equal(usd.currency, 'usd');
  assert.equal(eur.currency, 'eur');
  for (const p of usd.plans) {
    assert.ok(p.price.display.monthly.startsWith('$'), `${p.plan} USD display not $`);
    assert.equal(p.price.currency, 'usd');
  }
  for (const p of eur.plans) {
    assert.ok(p.price.display.monthly.startsWith('€'), `${p.plan} EUR display not €`);
    assert.equal(p.price.currency, 'eur');
    assert.equal(p.price.monthly, PRICES[p.plan].eur.monthly);
  }
  // An unknown currency falls back to USD, never throws.
  assert.equal(publicCatalog('gbp').currency, 'usd');
});

test('catalog limits come live from PLAN_LIMITS — no second source of truth', () => {
  const cat = publicCatalog();
  for (const p of cat.plans) {
    assert.equal(p.ai_actions, PLAN_LIMITS[p.plan].ai_actions);
    assert.equal(p.workspaces, PLAN_LIMITS[p.plan].workspaces);
    assert.equal(p.launch_kits, PLAN_LIMITS[p.plan].launch_kits);
  }
  assert.equal(cat.trial.days, 3);
  assert.equal(cat.trial.ai_actions_total, PLAN_LIMITS.trial.ai_actions);
});

test('no banned commercial copy: unlimited, fake badges, urgency, ROI', () => {
  const cat = publicCatalog();
  const text = JSON.stringify(cat).toLowerCase();
  for (const banned of ['unlimited', 'roi', 'guarantee', 'customers love', 'limited time', 'only today', 'x saved']) {
    assert.ok(!text.includes(banned), `catalog contains banned copy: ${banned}`);
  }
  // A popularity/badge claim needs real usage data behind it; none exists yet.
  for (const p of cat.plans) assert.equal(p.badge, null, `${p.plan} carries an unbacked badge`);
});

test('review/checks/export are declared free on every plan and the trial', () => {
  const cat = publicCatalog();
  assert.equal(cat.included_free, INCLUDED_FREE);
  assert.match(cat.included_free, /never use AI actions/);
  for (const feature of ['consistency checks', 'brief-change review', 'review queue', 'exports']) {
    assert.ok(cat.included_free.toLowerCase().includes(feature), `included_free missing: ${feature}`);
  }
});

test('plan notes describe jobs/fit, and every plan has a jobs line', () => {
  for (const p of publicCatalog().plans) {
    assert.ok(p.note && p.jobs, `${p.plan} missing note/jobs`);
    assert.ok(p.jobs.length > 30, `${p.plan} jobs line too thin to be meaningful`);
  }
});

test('frontend source contains no hard-coded plan prices (catalog is the only source)', () => {
  const root = path.join(__dirname, '..', '..', 'app-src');
  const offending = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jsx?|mjs)$/.test(entry.name)) {
        const src = fs.readFileSync(full, 'utf8');
        if (/12\.99|24\.99|\$59\b|\$99\b|\$199\b|\$499\b/.test(src)) offending.push(full);
      }
    }
  })(root);
  assert.deepEqual(offending, [], `hard-coded prices found in: ${offending.join(', ')}`);
});

test('trial disclosure stays honest: payment method + cancel-before-charge', () => {
  const { trial } = publicCatalog();
  assert.match(trial.disclosure, /Payment method required/);
  assert.match(trial.disclosure, /Cancel before/);
});
