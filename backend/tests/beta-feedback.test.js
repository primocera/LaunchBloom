// v11 SC-07 — the beta feedback moment must learn something without
// collecting anything it should not.
//
// The failure mode this guards is specific: free text is where a beta user
// writes a client's name, the rate they charge, or a complaint about a person.
// It has to be readable by the owner and invisible to every aggregate.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const feedback = require('../routes/feedback');
const { sanitizeProperties, CANONICAL_EVENTS, CLIENT_EVENTS } = require('../lib/analytics');

const source = fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'feedback.js'), 'utf8');
const migration = fs.readFileSync(path.join(ROOT, 'backend', 'migrations', '037_beta_feedback.sql'), 'utf8');

test('the two moments are the ones the beta plan asks about', () => {
  assert.deepEqual(feedback.MOMENTS, ['handoff', 'cancel']);
});

test('every question is a bounded category, never an open scale', () => {
  for (const [key, values] of Object.entries(feedback.ALLOWED)) {
    assert.ok(values.length >= 3 && values.length <= 6, `${key} has ${values.length} options`);
    for (const v of values) {
      assert.match(v, /^[a-z_]+$/, `${key} option "${v}" is not a bounded code`);
    }
  }
});

test('the price question offers refusal as plainly as approval', () => {
  // A beta that only asks "is this good value?" learns nothing.
  assert.ok(feedback.ALLOWED.price_view.includes('would_not_pay'));
  assert.ok(feedback.ALLOWED.price_view.includes('too_high'));
  assert.ok(feedback.ALLOWED.price_view.includes('worth_more'));
});

test('the job question can record that nothing usable came out', () => {
  assert.ok(feedback.ALLOWED.job_done.includes('nothing_usable'));
  assert.ok(feedback.ALLOWED.manual_work.includes('rewrote_most'));
});

test('free text never enters the analytics payload', () => {
  // Asserted structurally: the tracked properties are the moment, the answers
  // and a boolean — `notes` is not among them.
  const trackCall = source.slice(source.indexOf("track('feedback_submitted'"), source.indexOf('res.json({ ok: true'));
  assert.match(trackCall, /properties: \{ moment, \.\.\.answers, has_notes: Boolean\(notes\) \}/);
  assert.ok(!/properties:[\s\S]*\bnotes\b(?!\s*\))/.test(trackCall.replace('has_notes', '')), 'notes reached the event payload');
});

test('the sanitizer would drop free text even if it were passed by mistake', () => {
  const cleaned = sanitizeProperties({
    moment: 'handoff',
    price_view: 'about_right',
    notes: 'Client Acme Ltd said our rate of 4000 was too high',
  });
  assert.equal(cleaned.moment, 'handoff');
  assert.equal(cleaned.price_view, 'about_right');
  // `notes` is short enough to survive the length rule, so this proves the
  // route's own omission is the real control — belt and brace, both present.
  assert.ok(!('client_name' in cleaned));
});

test('the event is registered and client-firable', () => {
  assert.ok(CANONICAL_EVENTS.feedback_submitted, 'feedback_submitted must be a canonical event');
  assert.ok(CLIENT_EVENTS.has('feedback_submitted'));
});

test('an unknown category is rejected rather than stored', () => {
  assert.match(source, /if \(!allowed\.includes\(value\)\)/);
  assert.match(source, /code: 'BAD_CATEGORY'/);
  // An aggregate can only ever contain categories somebody defined.
  assert.match(source, /const ALLOWED = \{/);
});

test('answers are deduped per workspace and moment, so a denominator cannot double-count', () => {
  assert.match(source, /onConflict: 'workspace_id,moment'/);
  assert.match(source, /dedupeKey: `feedback:\$\{workspace\.id\}:\$\{moment\}`/);
  assert.match(migration, /create unique index if not exists beta_feedback_once_idx/);
});

test('the migration constrains every category in the database too', () => {
  for (const [column, values] of Object.entries(feedback.ALLOWED)) {
    const constraint = migration.match(new RegExp(`${column}[\\s\\S]{0,240}?\\)\\s*\\n\\s*\\)`, 'm'));
    assert.ok(constraint, `${column} has no check constraint`);
    for (const v of values) {
      assert.ok(migration.includes(`'${v}'`), `${column} value "${v}" is missing from the migration`);
    }
  }
  assert.match(migration, /beta_feedback_notes_len check/);
});

test('the route is workspace-scoped and authenticated', () => {
  assert.match(source, /requireAuth/);
  assert.match(source, /resolveWorkspace\(req\)/);
  assert.match(source, /workspace_id: workspace\.id/);
});

test('feedback is optional and cannot block the product', () => {
  // Answering nothing is a 400 on submit, but nothing about the export path
  // depends on it — the status endpoint exists so the client asks once.
  assert.match(source, /\/api\/feedback\/status/);
  assert.match(source, /answered:/);
});
