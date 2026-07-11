const Stripe = require('stripe');

// Lazy init: constructing the client throws when STRIPE_SECRET_KEY is missing.
// Doing that at require-time would crash EVERY route (login, AI, workspace)
// on a serverless cold start, not just the payment ones. Instead we build the
// client on first use, so a missing Stripe key only breaks Stripe calls.
let client = null;

function get() {
  if (client) return client;
  if (!process.env.STRIPE_SECRET_KEY) {
    throw Object.assign(new Error('Payments are not configured (STRIPE_SECRET_KEY missing).'), {
      status: 503,
    });
  }
  client = Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
    appInfo: { name: 'OfferFlowAI', version: '1.0.0' },
  });
  return client;
}

// Proxy so existing `stripe.customers.create(...)` call sites keep working
// unchanged while the real client is created on first property access.
module.exports = new Proxy(
  {},
  {
    get(_t, prop) {
      const value = get()[prop];
      return typeof value === 'function' ? value.bind(get()) : value;
    },
  }
);
