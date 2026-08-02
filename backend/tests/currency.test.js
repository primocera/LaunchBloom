// Region -> billing currency (Option 2 multi-currency pricing).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EUR_COUNTRIES,
  SUPPORTED,
  currencyForCountry,
  countryOf,
  currencyForRequest,
  eurCatalogReady,
} = require('../lib/currency');
const { selectCatalog, CATALOG_VERSION, publicCatalog } = require('../lib/plan-catalog');

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const DE = { headers: { 'x-vercel-ip-country': 'DE' } };
const US = { headers: { 'x-vercel-ip-country': 'US' } };

test('EU/EEA countries map to EUR, everything else to USD', () => {
  for (const cc of ['DE', 'FR', 'SI', 'IE', 'NL', 'NO', 'IS', 'LI', 'PL', 'SE']) {
    assert.equal(currencyForCountry(cc), 'eur', `${cc} should be EUR`);
  }
  for (const cc of ['US', 'GB', 'CA', 'AU', 'JP', 'CH', 'BR']) {
    assert.equal(currencyForCountry(cc), 'usd', `${cc} should be USD`);
  }
});

test('country matching is case-insensitive and whitespace-tolerant', () => {
  assert.equal(currencyForCountry('de'), 'eur');
  assert.equal(currencyForCountry('  FR '), 'eur');
});

test('unknown, empty or missing location fails closed to USD', () => {
  assert.equal(currencyForCountry(''), 'usd');
  assert.equal(currencyForCountry(null), 'usd');
  assert.equal(currencyForCountry(undefined), 'usd');
  assert.equal(currencyForCountry('ZZ'), 'usd');
});

test('currencyForRequest reads the Vercel geo header when EUR pricing is enabled', () => {
  const saved = process.env.EUR_PRICING_ENABLED;
  process.env.EUR_PRICING_ENABLED = '1';
  try {
    assert.equal(currencyForRequest({ headers: { 'x-vercel-ip-country': 'DE' } }), 'eur');
    assert.equal(currencyForRequest({ headers: { 'cf-ipcountry': 'FR' } }), 'eur');
    assert.equal(currencyForRequest({ headers: { 'x-vercel-ip-country': 'US' } }), 'usd');
    assert.equal(currencyForRequest({ headers: {} }), 'usd');
    assert.equal(currencyForRequest({}), 'usd');
  } finally {
    if (saved === undefined) delete process.env.EUR_PRICING_ENABLED;
    else process.env.EUR_PRICING_ENABLED = saved;
  }
});

test('EUR_PRICING_ENABLED off (default) forces USD even for an EU buyer — safe deploy', () => {
  const saved = process.env.EUR_PRICING_ENABLED;
  delete process.env.EUR_PRICING_ENABLED;
  try {
    assert.equal(currencyForRequest({ headers: { 'x-vercel-ip-country': 'DE' } }), 'usd');
  } finally {
    if (saved !== undefined) process.env.EUR_PRICING_ENABLED = saved;
  }
});

test('countryOf returns empty string when no geo header is present', () => {
  assert.equal(countryOf({ headers: {} }), '');
  assert.equal(countryOf({}), '');
});

// ── v13 SC-P0-03: authoritative server-side catalog selection ───────────────

test('EU/EEA buyer with EUR enabled and verified selects the EUR catalog', () => {
  withEnv({ EUR_PRICING_ENABLED: '1', NODE_ENV: 'production', EUR_PRICES_VERIFIED: '1',
    STRIPE_PRICE_STARTER_MONTHLY: 'p1', STRIPE_PRICE_STARTER_YEARLY: 'p2',
    STRIPE_PRICE_PRO_MONTHLY: 'p3', STRIPE_PRICE_PRO_YEARLY: 'p4',
    STRIPE_PRICE_STUDIO_MONTHLY: 'p5', STRIPE_PRICE_STUDIO_YEARLY: 'p6' }, () => {
    const sel = selectCatalog(DE, { plan: 'starter', interval: 'monthly' });
    assert.equal(sel.region, 'eu');
    assert.equal(sel.currency, 'eur');
    assert.equal(sel.fallback_reason, null);
    assert.equal(sel.price_key, 'STRIPE_PRICE_STARTER_MONTHLY');
    assert.equal(sel.price_id, 'p1');
    assert.equal(sel.available, true);
    assert.equal(sel.catalog_version, CATALOG_VERSION);
    // Display comes from the SAME currency the checkout would pin.
    assert.equal(publicCatalog(sel.currency).currency, 'eur');
  });
});

test('production EUR enablement with an unverified catalog falls back to USD BEFORE display', () => {
  withEnv({ EUR_PRICING_ENABLED: '1', NODE_ENV: 'production', EUR_PRICES_VERIFIED: undefined }, () => {
    assert.equal(eurCatalogReady(), false);
    const sel = selectCatalog(DE);
    assert.equal(sel.requested_currency, 'eur');
    assert.equal(sel.currency, 'usd', 'must never display EUR it cannot charge');
    assert.equal(sel.fallback_reason, 'eur_catalog_unverified');
    assert.equal(publicCatalog(sel.currency).currency, 'usd');
  });
});

test('EUR selection also falls back when the Stripe price env set is incomplete', () => {
  withEnv({ EUR_PRICING_ENABLED: '1', NODE_ENV: 'test',
    STRIPE_PRICE_STARTER_MONTHLY: undefined, STRIPE_PRICE_STARTER: undefined }, () => {
    const sel = selectCatalog(DE);
    assert.equal(sel.currency, 'usd');
    assert.equal(sel.fallback_reason, 'stripe_price_env_incomplete');
  });
});

test('non-EU region always uses the USD catalog', () => {
  withEnv({ EUR_PRICING_ENABLED: '1', NODE_ENV: 'test' }, () => {
    const sel = selectCatalog(US);
    assert.equal(sel.region, 'non_eu');
    assert.equal(sel.currency, 'usd');
    assert.equal(sel.requested_currency, 'usd');
  });
});

test('selection ignores unknown plans and never returns a client-supplied price id', () => {
  withEnv({ STRIPE_PRICE_STARTER_MONTHLY: 'p1' }, () => {
    const sel = selectCatalog(US, { plan: 'platinum', interval: 'monthly', priceId: 'price_ATTACKER' });
    assert.equal(sel.plan, null);
    assert.equal(sel.price_id, null);
    assert.equal(sel.available, false);
    assert.ok(!JSON.stringify(sel).includes('price_ATTACKER'));
  });
});

test('supported currencies are exactly usd and eur, USD listed first (fallback)', () => {
  assert.deepEqual(SUPPORTED, ['usd', 'eur']);
  assert.ok(EUR_COUNTRIES.has('DE') && !EUR_COUNTRIES.has('US'));
});
