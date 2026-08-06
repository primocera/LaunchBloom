// ---------------------------------------------------------------------------
// SC-95-02 — AI-agent entry documents cannot drift from code/launch truth.
//
// README.md, CLAUDE.md and the prompt-pack scope note are the docs a coding
// agent reads as current truth. agentDocumentProblems() (wired into
// launch:verify via backend/scripts/launch-state.js) fails release verification
// when one of them teaches the retired auth model, claims public paid is open
// while the verdict is not a full GO, states a stale live-money transition
// count, or repeats a resolved blocker's subject. This suite proves both
// directions: the REAL docs are clean, and each drift class is caught.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { agentDocumentProblems } = require('../lib/launch-state');

const ROOT = path.join(__dirname, '..', '..');
const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/launch/launch-state.json'), 'utf8'));

function realDoc(rel) {
  return { path: rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') };
}

test('the manifest actually lists the agent documents', () => {
  assert.ok(Array.isArray(state.agent_documents) && state.agent_documents.length >= 2);
  assert.ok(state.agent_documents.includes('README.md'));
  assert.ok(state.agent_documents.includes('CLAUDE.md'));
});

test('the real README, CLAUDE.md and scope note are clean', () => {
  const docs = state.agent_documents.map(realDoc);
  const problems = agentDocumentProblems(state, docs);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('the canonical transition count is 8 (A–H)', () => {
  assert.equal(state.live_money_rehearsal.transition_count, 8);
});

// --- negative fixtures: each drift class must produce a problem -------------

test('retired auth model → flagged', () => {
  const bad = { path: 'CLAUDE.md', text: 'Identity model (no Supabase Auth): stateless HMAC session tokens (email|exp). The session email is the identity.' };
  const p = agentDocumentProblems(state, [bad]);
  assert.ok(p.some((m) => /retired auth model/i.test(m)), p.join('\n'));
});

test('public paid claimed open while verdict is not a full GO → flagged', () => {
  // Only meaningful because the manifest's public_paid verdict is below GO.
  const { computeVerdicts } = require('../lib/launch-state');
  const v = computeVerdicts(state);
  if (v.public_paid.verdict === 'GO') return; // not applicable if the owner ever ships full GO
  const bad = { path: 'README.md', text: 'Live. Public paid signup is open as of today.' };
  const p = agentDocumentProblems(state, [bad]);
  assert.ok(p.some((m) => /public paid is open\/live/i.test(m)), p.join('\n'));
});

test('stale transition count → flagged', () => {
  const bad = { path: 'README.md', text: 'there is no nine-transition live billing rehearsal yet.' };
  const p = agentDocumentProblems(state, [bad]);
  assert.ok(p.some((m) => /nine-transition/i.test(m) && /canonical/i.test(m)), p.join('\n'));
});

test('the canonical count itself is NOT flagged', () => {
  const good = { path: 'README.md', text: 'the eight-transition A–H live billing rehearsal remains owner-run.' };
  assert.deepEqual(agentDocumentProblems(state, [good]), []);
});

test('a resolved blocker subject repeated as an open risk → flagged', () => {
  // Requires the closed blocker to carry resolved_subject_markers.
  const hasMarkers = (state.blockers || []).some(
    (b) => b.status === 'closed' && Array.isArray(b.resolved_subject_markers) && b.resolved_subject_markers.length,
  );
  assert.ok(hasMarkers, 'at least one closed blocker must declare resolved_subject_markers');
  const bad = { path: 'README.md', text: 'Accepted rather than proven: hero text below WCAG AA.' };
  const p = agentDocumentProblems(state, [bad]);
  assert.ok(p.some((m) => /outstanding risk/i.test(m) && /closed/i.test(m)), p.join('\n'));
});
