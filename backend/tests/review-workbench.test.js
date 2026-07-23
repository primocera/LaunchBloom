// v9 SC-04 — the unified Review workbench. Source-level contract checks (pure
// fs, no network/build) that lock the customer-facing guarantees the prompt
// requires and guard the analytics privacy boundary and the ack audit trail.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'app-src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const workbench = read(APP, 'routes', 'campaign', 'ReviewWorkbench.jsx');
const campaignsRoute = read(__dirname, '..', 'routes', 'campaigns.js');

test('workbench offers exactly the five review filters', () => {
  for (const label of ['Blocking', 'Needs decision', 'Evidence/research', 'Resolved', 'All']) {
    assert.ok(workbench.includes(`'${label}'`), `missing filter ${label}`);
  }
});

test('workbench empty state discloses detection limits and never says approved', () => {
  assert.match(workbench, /No open items in this view/);
  assert.match(workbench, /do not verify facts/i, 'must state what the checks do not cover');
  assert.ok(!/Campaign approved|\bapproved\b(?!\s+by you)/i.test(workbench.replace(/Acknowledged by you/g, '')),
    'the workbench must never claim the campaign is approved');
});

test('workbench uses honest, non-alarmist labels', () => {
  for (const label of ['Conflict detected', 'Brief changed', 'Evidence needed', 'Acknowledged by you', 'Hard blocker']) {
    assert.ok(workbench.includes(label), `missing label ${label}`);
  }
});

test('workbench has no global resolve-all or bulk acknowledgment affordance', () => {
  // Ignore comments — the guarantee is about UI affordances, not prose.
  const code = workbench.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/resolve all|acknowledge all|approve all/i.test(code), 'no Resolve/Acknowledge/Approve all');
  assert.ok(!/\.map\([^)]*=>[^)]*ack(nowledge|Consistency)/i.test(code), 'no bulk acknowledgment loop');
});

test('review discloses that unresolved items are never hidden from the handoff', () => {
  assert.match(workbench, /always disclosed in the handoff|nothing is hidden/i);
});

test('review analytics carry only coarse fields — never content, URLs or names', () => {
  // Isolate each trackEvent(...) call and forbid content-bearing keys.
  const calls = [...workbench.matchAll(/trackEvent\('(review_item_[a-z]+)'\s*,\s*\{([\s\S]*?)\}\)/g)];
  assert.ok(calls.length >= 2, 'both review_item_opened and review_item_resolved must be tracked');
  const forbidden = /\b(title|label|source_url|url|name|observed|expected|claim|body|caption)\b/;
  for (const [, event, payload] of calls) {
    assert.ok(!forbidden.test(payload), `${event} leaks a content field: ${payload.trim()}`);
  }
});

test('acknowledgment records an audit trail (who + when) additively', () => {
  // The ack route must persist acknowledged_by/at, and the review payload must
  // surface them so the workbench can show "Acknowledged by you".
  assert.match(campaignsRoute, /acknowledged_by:\s*req\.userEmail/);
  assert.match(campaignsRoute, /acknowledged_at:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(campaignsRoute, /select\('fingerprint, status, note_category, acknowledged_by, acknowledged_at'\)/);
});

test('a matching additive migration adds the audit columns without rewriting data', () => {
  const mig = read(__dirname, '..', 'migrations', '034_finding_audit.sql');
  assert.match(mig, /add column if not exists acknowledged_by/i);
  assert.match(mig, /add column if not exists acknowledged_at/i);
  assert.ok(!/drop |update .*set |delete from/i.test(mig), 'migration must be additive only');
});
