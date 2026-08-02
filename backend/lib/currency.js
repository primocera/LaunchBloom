// ---------------------------------------------------------------------------
// Region -> billing currency for explicit multi-currency pricing (Option 2).
//
// EU/EEA visitors are quoted AND charged in EUR; everyone else in USD. Both are
// real, locked prices carried on the same Stripe Price via currency_options —
// there is no live FX conversion at checkout, so a EUR customer is never handed
// a USD 3DS charge their bank declines (see verify-stripe-prices.js for why that
// specific failure looks like a card problem and is not one).
//
// Detection uses Vercel's edge geo header (x-vercel-ip-country, ISO-3166
// alpha-2), with Cloudflare's header as a fallback. Unknown or missing location
// FAILS TO USD — the base currency every price always carries, so a request we
// cannot geolocate still checks out.
// ---------------------------------------------------------------------------

'use strict';

// EU-27 + EEA (Iceland, Liechtenstein, Norway). Per the owner's rule "EU/EEA
// sees EUR" — this charges EUR to all of these even where the local currency is
// not the euro (e.g. PL/SE/DK), which is the intended, simplest behaviour.
const EUR_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'IS', 'LI', 'NO',
]);

// The currencies the catalog and checkout support. USD is the base/fallback.
const SUPPORTED = ['usd', 'eur'];

/** ISO country code -> 'eur' | 'usd'. Unknown/empty -> 'usd'. */
function currencyForCountry(country) {
  const cc = String(country || '').trim().toUpperCase();
  return EUR_COUNTRIES.has(cc) ? 'eur' : 'usd';
}

/** The buyer's country from edge geo headers, or '' when undeterminable. */
function countryOf(req) {
  const h = (req && req.headers) || {};
  return h['x-vercel-ip-country'] || h['cf-ipcountry'] || h['x-country'] || '';
}

/**
 * Master switch for EUR pricing. OFF by default so this code can ship before the
 * Stripe prices carry their EUR currency_options — with the flag unset every
 * request is USD (today's behaviour), so an EU checkout can never request a
 * currency Stripe hasn't been configured for. Set EUR_PRICING_ENABLED=1 only
 * AFTER `npm run verify-prices` confirms EUR is live on all six prices. Unsetting
 * it is an instant rollback to USD-only.
 */
function eurEnabled() {
  return process.env.EUR_PRICING_ENABLED === '1';
}

/** Billing currency for the request: USD unless EUR is enabled AND the buyer is EU/EEA. */
function currencyForRequest(req) {
  if (!eurEnabled()) return 'usd';
  return currencyForCountry(countryOf(req));
}

module.exports = {
  EUR_COUNTRIES, SUPPORTED, currencyForCountry, countryOf, currencyForRequest, eurEnabled,
};
