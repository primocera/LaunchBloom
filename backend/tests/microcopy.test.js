// Playbook v6 Prompt 28 — the system microcopy map is a copy contract: exact
// strings, dynamic retry_after/req_id interpolation, and NO raw placeholder or
// backend text ever leaking to a user. These are hard assertions.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const modUrl = pathToFileURL(path.join(__dirname, '..', '..', 'app-src', 'lib', 'microcopy.js')).href;

test('microcopy resolves the exact playbook strings', async () => {
  const { microcopy } = await import(modUrl);
  assert.equal(microcopy('forbidden'), 'You don’t have access to this workspace.');
  assert.equal(microcopy('not_found_asset'), 'This asset no longer exists or belongs to another workspace.');
  assert.equal(microcopy('ai_timeout'), 'Generation timed out. No AI action was charged. Try again.');
  assert.equal(
    microcopy('daily_cap'),
    'Generation is temporarily paused while we protect service capacity. Editing and exporting still work.',
  );
  assert.equal(microcopy('billing_config'), 'Checkout is temporarily unavailable. Your workspace and drafts are unaffected.');
});

test('dynamic retry_after and req_id are interpolated', async () => {
  const { microcopy } = await import(modUrl);
  assert.equal(
    microcopy('rate_limited', { retry_after: '30 seconds' }),
    'Too many requests. Try again in 30 seconds. Your work is saved.',
  );
  assert.match(microcopy('webhook_delay', { req_id: 'req_abc' }), /request req_abc\./);
});

test('no unresolved {placeholder} ever leaks, even with no vars', async () => {
  const { SYSTEM_MICROCOPY, microcopy } = await import(modUrl);
  for (const key of Object.keys(SYSTEM_MICROCOPY)) {
    const out = microcopy(key, {});
    assert.ok(!/\{[a-z_]+\}/i.test(out), `${key} left an unresolved placeholder: ${out}`);
  }
});

test('messageForError maps status/code to the right microcopy', async () => {
  const { messageForError } = await import(modUrl);
  assert.equal(messageForError({ status: 403 }), 'You don’t have access to this workspace.');
  assert.equal(messageForError({ status: 404 }), 'This asset no longer exists or belongs to another workspace.');
  assert.match(messageForError({ status: 429, retry_after: 45 }), /Try again in 45 seconds/);
  assert.equal(
    messageForError({ code: 'GENERATION_PAUSED' }),
    'Generation is temporarily paused while we protect service capacity. Editing and exporting still work.',
  );
  // Unknown → generic recovery copy with a request-id hint, never raw text.
  assert.match(messageForError({ status: 500, message: 'ECONNRESET at pg' }), /Something went wrong/);
});

test('formatRetryAfter turns seconds into human text', async () => {
  const { formatRetryAfter } = await import(modUrl);
  assert.equal(formatRetryAfter(30), '30 seconds');
  assert.equal(formatRetryAfter(120), '2 minutes');
  assert.equal(formatRetryAfter(null), 'a moment');
});
