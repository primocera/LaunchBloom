// v5 Prompt 14 — lifecycle emails: idempotent, retry-safe, never throw.

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
delete process.env.RESEND_API_KEY; // no key → record 'skipped', send nothing

const { stubModule } = require('./helpers');

// Fake email_events table with a real unique constraint on dedupe_key.
const rows = new Map();
function fakeBuilder() {
  let op = null;
  let payload = null;
  let key = null;
  const b = {
    insert(p) { op = 'insert'; payload = p; return b; },
    update(p) { op = 'update'; payload = p; return b; },
    select() { return b; },
    eq(col, val) { if (col === 'dedupe_key') key = val; return b; },
    single() { return b.then((x) => x); },
    then(onOk, onErr) {
      let result;
      if (op === 'insert') {
        if (rows.has(payload.dedupe_key)) result = { data: null, error: { code: '23505', message: 'duplicate key' } };
        else { rows.set(payload.dedupe_key, { ...payload }); result = { data: payload, error: null }; }
      } else if (op === 'update') {
        if (key && rows.has(key)) Object.assign(rows.get(key), payload);
        result = { data: null, error: null };
      } else {
        result = { data: null, error: null };
      }
      return Promise.resolve(result).then(onOk, onErr);
    },
  };
  return b;
}
stubModule('lib/supabase.js', { from: () => fakeBuilder() });

const { sendLifecycleEmail, TEMPLATES } = require('../lib/lifecycle-email');

test('first send claims the dedupe key; without RESEND_API_KEY it is recorded as skipped', async () => {
  const r = await sendLifecycleEmail('trial_started', 'sub_1', 'a@b.com', { chargeAt: '2026-07-20T00:00:00Z' });
  assert.equal(r, 'skipped');
  assert.equal(rows.get('trial_started:sub_1').status, 'skipped');
});

test('a webhook redelivery never double-sends (duplicate dedupe key)', async () => {
  const r = await sendLifecycleEmail('trial_started', 'sub_1', 'a@b.com', { chargeAt: '2026-07-20T00:00:00Z' });
  assert.equal(r, 'duplicate');
});

test('unknown type or missing recipient is skipped without a row', async () => {
  assert.equal(await sendLifecycleEmail('nonsense', 'x', 'a@b.com'), 'skipped');
  assert.equal(await sendLifecycleEmail('welcome', 'x', ''), 'skipped');
  assert.ok(!rows.has('nonsense:x'));
});

test('every template produces subject, html and a plain-text alternative', () => {
  const params = { chargeAt: '2026-07-20T00:00:00Z', periodEnd: '2026-08-01T00:00:00Z', planLabel: 'Pro' };
  for (const [type, make] of Object.entries(TEMPLATES)) {
    const t = make(params);
    assert.ok(t.subject && t.html && t.text, `${type} must have subject/html/text`);
    assert.match(t.html, /<h1/);
  }
});

test('trial emails state the exact charge date', () => {
  const t = TEMPLATES.trial_ending({ chargeAt: '2026-07-20T12:00:00Z' });
  assert.match(t.html, /July 20, 2026/);
  const s = TEMPLATES.trial_started({ chargeAt: '2026-07-20T12:00:00Z' });
  assert.match(s.text, /July 20, 2026/);
});
