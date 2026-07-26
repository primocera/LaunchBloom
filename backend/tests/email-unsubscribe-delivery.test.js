// ---------------------------------------------------------------------------
// Unsubscribe must be reachable the way people actually unsubscribe.
//
// SC-V10-06 built a working opt-out route and a footer link, and the consent
// tests cover the token and the suppression table. What none of that proved is
// that the opt-out is *reachable*:
//
//   • Gmail and Apple Mail only show their native "Unsubscribe" button when the
//     message carries List-Unsubscribe headers. Without them the sole exit is a
//     12px link at the bottom of the mail — which is why unsubscribing looked
//     broken to a recipient.
//   • That native button issues a POST (RFC 8058), with no user interaction. A
//     GET-only route answers it with 404 and the click silently fails.
//   • The outbox retry path rebuilt the message straight from the template,
//     skipping the consent footer entirely, so a retried marketing email went
//     out with no unsubscribe link at all.
//
// Each assertion below fails against the pre-fix code.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const lifecycle = readFileSync('backend/lib/lifecycle-email.js', 'utf8');
const route = readFileSync('backend/routes/email-preferences.js', 'utf8');

test('marketing mail carries RFC 8058 one-click headers', () => {
  assert.match(lifecycle, /List-Unsubscribe'\]?:/);
  assert.match(lifecycle, /'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'/);
});

test('headers are withheld from transactional mail', () => {
  // A receipt is not unsubscribable; offering the control would be a lie.
  assert.match(
    lifecycle,
    /function consentHeaders[\s\S]*?categoryOf\(type\) !== 'marketing'[\s\S]*?return undefined/
  );
});

test('both send paths attach the headers', () => {
  const sends = lifecycle.match(/resend\.emails\.send\(/g) || [];
  const withHeaders = lifecycle.match(/headers: consentHeaders\(/g) || [];
  assert.equal(
    sends.length,
    withHeaders.length,
    'every resend.emails.send call must pass consent headers'
  );
});

test('the outbox retry rebuilds the consent footer', () => {
  // Previously: make(row.payload) went straight to the provider.
  assert.match(
    lifecycle,
    /withConsentFooter\(\s*make\(row\.payload \|\| \{\}\), row\.email_type, row\.recipient\s*\)/
  );
});

test('the unsubscribe route answers a one-click POST', () => {
  assert.match(route, /router\.post\('\/api\/email\/unsubscribe'/);
});

test('one-click POST needs no login and returns JSON, not HTML', () => {
  // The handler body, taken as the lines from the route declaration to its
  // closing `});` at column 0.
  const from = route.indexOf("router.post('/api/email/unsubscribe'");
  const body = route.slice(from, route.indexOf('\n});', from) + 4);
  assert.match(body, /verifyUnsubscribeToken/);
  assert.match(body, /res\.status\(400\)\.json/);
  assert.match(body, /unsubscribed: true/);
  assert.doesNotMatch(body, /requireAuth|authenticate/);
});
