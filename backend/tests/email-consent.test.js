// ---------------------------------------------------------------------------
// v10 SC-06 — email categories, unsubscribe tokens and suppression.
//
// The two failures this guards against are opposite and both serious:
//   • gating TRANSACTIONAL mail on a marketing preference silently withholds
//     receipts and charge notices from a paying customer;
//   • failing to gate MARKETING mail ignores a withdrawal of consent.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.PUBLIC_URL = 'https://example.test';
delete process.env.RESEND_API_KEY;

const { stubModule } = require('./helpers');

// Stateful fake: a real suppression table and email_events ledger.
function makeSupabase() {
  const suppressions = new Map();
  const events = new Map();
  const flags = { failSuppressionLookup: false };

  function builder(table) {
    const st = { table, op: 'select', filters: {}, payload: null };
    const api = {
      select() { return api; },
      insert(p) { st.op = 'insert'; st.payload = p; return api; },
      update(p) { st.op = 'update'; st.payload = p; return api; },
      upsert(p) { st.op = 'upsert'; st.payload = p; return api; },
      delete() { st.op = 'delete'; return api; },
      eq(k, v) { st.filters[k] = v; return api; },
      single() { return Promise.resolve(resolve(st, true)); },
      then(res, rej) { return Promise.resolve(resolve(st, false)).then(res, rej); },
    };
    return api;
  }

  function resolve(st, single) {
    if (st.table === 'email_suppressions') {
      if (st.op === 'select') {
        if (flags.failSuppressionLookup) return { data: null, error: { code: 'XXNET', message: 'db down' } };
        const row = suppressions.get(st.filters.email);
        if (single) return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
        return { data: row ? [row] : [], error: null };
      }
      if (st.op === 'upsert') { suppressions.set(st.payload.email, st.payload); return { error: null }; }
      if (st.op === 'delete') { suppressions.delete(st.filters.email); return { error: null }; }
    }
    if (st.table === 'email_events') {
      if (st.op === 'insert') {
        if (events.has(st.payload.dedupe_key)) return { error: { code: '23505', message: 'duplicate' } };
        events.set(st.payload.dedupe_key, { ...st.payload });
        return { error: null };
      }
      if (st.op === 'update') {
        const row = events.get(st.filters.dedupe_key);
        if (row) Object.assign(row, st.payload);
        return { error: null };
      }
      if (st.op === 'select') {
        const row = events.get(st.filters.dedupe_key);
        if (single) return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
        return { data: row ? [row] : [], error: null };
      }
    }
    if (single) return { data: null, error: { code: 'PGRST116' } };
    return { data: null, error: null };
  }

  return { from: builder, _suppressions: suppressions, _events: events, _flags: flags };
}

const db = makeSupabase();
stubModule('lib/supabase.js', db);

const consent = require('../lib/email-consent');
const { sendLifecycleEmail, TEMPLATES } = require('../lib/lifecycle-email');

// ── categories ─────────────────────────────────────────────────────────────

test('every shipped template is explicitly classified', () => {
  for (const type of Object.keys(TEMPLATES)) {
    assert.ok(consent.CATEGORY[type], `template "${type}" has no category — it would default to marketing`);
    assert.ok(['transactional', 'marketing'].includes(consent.CATEGORY[type]), `${type} has an unknown category`);
  }
});

test('money and account records are transactional, nudges are not', () => {
  // Getting these backwards is the whole risk this slice addresses.
  for (const t of ['trial_started', 'trial_ending', 'payment_succeeded', 'payment_failed',
    'payment_recovered', 'cancellation_scheduled', 'cancellation_completed', 'plan_changed', 'deletion_completed']) {
    assert.equal(consent.categoryOf(t), 'transactional', `${t} must never be suppressible`);
  }
  for (const t of ['welcome', 'activation_nudge']) {
    assert.equal(consent.categoryOf(t), 'marketing', `${t} must be optional`);
  }
});

test('an unclassified template defaults to suppressible, not to sending', () => {
  assert.equal(consent.categoryOf('some_future_template'), 'marketing');
});

// ── tokens ─────────────────────────────────────────────────────────────────

test('an unsubscribe token round-trips and is case-normalised', () => {
  const token = consent.unsubscribeToken('Person@Example.com');
  assert.equal(consent.verifyUnsubscribeToken(token), 'person@example.com');
});

test('a tampered or forged token is rejected', () => {
  const token = consent.unsubscribeToken('victim@example.com');
  const [payload, sig] = token.split('.');
  // Right signature, different address — the signature covers the address.
  const swapped = `${Buffer.from('someone-else@example.com').toString('base64url')}.${sig}`;
  assert.equal(consent.verifyUnsubscribeToken(swapped), null, 'a token must not transfer to another address');
  // Right address, wrong signature.
  assert.equal(consent.verifyUnsubscribeToken(`${payload}.${'x'.repeat(sig.length)}`), null);
  for (const junk of ['', 'nonsense', 'a.b', null, undefined, 'x'.repeat(500)]) {
    assert.equal(consent.verifyUnsubscribeToken(junk), null, `junk token accepted: ${junk}`);
  }
});

test('the unsubscribe URL is absolute and carries the token', () => {
  const url = consent.unsubscribeUrl('person@example.com');
  assert.match(url, /^https:\/\/example\.test\/api\/email\/unsubscribe\?token=/);
  const token = decodeURIComponent(url.split('token=')[1]);
  assert.equal(consent.verifyUnsubscribeToken(token), 'person@example.com');
});

// ── suppression ────────────────────────────────────────────────────────────

test('suppression is idempotent and reversible', async () => {
  db._suppressions.clear();
  assert.equal(await consent.isSuppressed('a@b.com'), false);
  await consent.suppress('a@b.com');
  await consent.suppress('a@b.com'); // twice is not an error
  assert.equal(await consent.isSuppressed('a@b.com'), true);
  await consent.unsuppress('a@b.com');
  assert.equal(await consent.isSuppressed('a@b.com'), false);
});

test('a suppression lookup failure fails CLOSED for marketing', async () => {
  db._suppressions.clear();
  db._flags.failSuppressionLookup = true;
  // Sending to someone who unsubscribed is worse than a missed nudge.
  assert.equal(await consent.isSuppressed('a@b.com'), true);
  db._flags.failSuppressionLookup = false;
});

// ── the send path ──────────────────────────────────────────────────────────

test('marketing email to an unsubscribed address is suppressed, not sent', async () => {
  db._suppressions.clear(); db._events.clear();
  await consent.suppress('gone@example.com');

  const result = await sendLifecycleEmail('activation_nudge', 'ws-1', 'gone@example.com', { step: 'brand_profile' });

  assert.equal(result, 'suppressed');
  const row = db._events.get('activation_nudge:ws-1');
  assert.equal(row.status, 'suppressed', 'the ledger must distinguish suppressed from failed');
  assert.equal(row.category, 'marketing');
});

test('transactional email still reaches an unsubscribed address', async () => {
  db._suppressions.clear(); db._events.clear();
  await consent.suppress('gone@example.com');

  // No RESEND_API_KEY in tests, so a permitted send records 'skipped' — the
  // point is that it was NOT blocked by the suppression list.
  const result = await sendLifecycleEmail('payment_failed', 'in_1', 'gone@example.com', {});

  assert.notEqual(result, 'suppressed', 'a charge notice must never be withheld for a marketing opt-out');
  const row = db._events.get('payment_failed:in_1');
  assert.equal(row.category, 'transactional');
});

test('the ledger records the category so a withheld receipt would be provable', async () => {
  db._suppressions.clear(); db._events.clear();
  await sendLifecycleEmail('trial_started', 'sub_9', 'x@example.com', { chargeAt: '2026-08-01T00:00:00Z' });
  assert.equal(db._events.get('trial_started:sub_9').category, 'transactional');
});

// ── templates ──────────────────────────────────────────────────────────────

test('the activation nudge carries a step key only — never customer content', () => {
  const built = TEMPLATES.activation_nudge({ step: 'first_campaign' });
  assert.match(built.subject, /create your first campaign/i);
  assert.match(built.text, /free and uses no AI actions/);
  // An unknown step degrades to the first setup step rather than rendering
  // an empty or broken message.
  const fallback = TEMPLATES.activation_nudge({ step: 'nonsense' });
  assert.match(fallback.subject, /Brand Profile/i);
});

test('the recovery email states the problem is resolved and needs no action', () => {
  const built = TEMPLATES.payment_recovered({ amount: '$24.99', periodEnd: '2026-08-01T00:00:00Z' });
  assert.match(built.subject, /went through/i);
  assert.match(built.text, /Nothing further is needed/i);
  assert.match(built.text, /\$24\.99/);
});

test('no template promises an outcome or invents proof', () => {
  const BANNED = /guaranteed|risk[- ]free|best[- ]selling|thousands of|#1\b|proven to/i;
  for (const [type, make] of Object.entries(TEMPLATES)) {
    const built = make({ step: 'brand_profile', failedSteps: [], completed: true });
    assert.ok(!BANNED.test(`${built.subject} ${built.text}`), `${type} contains an unsupported claim`);
  }
});
