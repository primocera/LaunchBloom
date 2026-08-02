// Region -> billing currency (Option 2 multi-currency pricing).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EUR_COUNTRIES,
  SUPPORTED,
  currencyForCountry,
  countryOf,
  currencyForRequest,
} = require('../lib/currency');

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

test('supported currencies are exactly usd and eur, USD listed first (fallback)', () => {
  assert.deepEqual(SUPPORTED, ['usd', 'eur']);
  assert.ok(EUR_COUNTRIES.has('DE') && !EUR_COUNTRIES.has('US'));
});
