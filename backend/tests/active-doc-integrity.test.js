// ---------------------------------------------------------------------------
// v15 SC-01 — the active documents must tell one current truth.
//
// launch:verify used to validate only the manifest's own prose. A hand-authored
// owner handoff could still say the manifest was "pinned to v13 5523187", call
// public paid "NO-GO", and describe the router advisory as "not accepted" while
// the machine-readable state computed the opposite — and the gate stayed green.
// activeDocumentProblems scans the allowlisted active documents against the
// computed truth. These tests prove it passes on the reconciled repository and
// fails the moment any of those contradictions is reintroduced.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  activeDocumentProblems,
  canonicalTransitionCount,
} = require('../lib/launch-state');
const { loadState } = require('../scripts/launch-state');

const ROOT = path.join(__dirname, '..', '..');
const STATE = loadState();

function realActiveDocs() {
  return (STATE.active_documents || []).map((rel) => ({
    path: rel,
    text: fs.readFileSync(path.join(ROOT, rel), 'utf8'),
  }));
}

// The reconciled repository is the baseline: no active document may contradict
// the manifest. If this fails, the docs and the machine state have diverged.
test('the real active documents agree with the computed launch truth', () => {
  const problems = activeDocumentProblems(STATE, realActiveDocs());
  assert.deepEqual(problems, [], `active documents contradict the manifest:\n${problems.join('\n')}`);
});

test('the manifest names the active-document allowlist and a canonical transition count', () => {
  assert.ok(Array.isArray(STATE.active_documents) && STATE.active_documents.length >= 1);
  for (const rel of STATE.active_documents) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `active document missing on disk: ${rel}`);
  }
  assert.equal(canonicalTransitionCount(STATE), 8, 'the canonical live-money rehearsal is eight transitions (steps A–H)');
});

// --- the exact stale-handoff contradiction SC-01 removed ------------------

test('reintroducing the stale "pinned to v13 5523187" claim fails the scan', () => {
  const docs = [{ path: 'docs/OWNER_HANDOFF_V14.md', text: 'The manifest is still pinned to the v13 candidate 5523187.' }];
  const problems = activeDocumentProblems(STATE, docs);
  assert.ok(problems.some((p) => /candidate 5523187/.test(p) && /pinned candidate is/.test(p)), problems.join('\n'));
});

test('a public-paid verdict that disagrees with the computed one fails the scan', () => {
  // v19: public_paid computes to NO-GO (e2e_authenticated not_run at the candidate).
  // A doc that instead claims CONDITIONAL GO contradicts the computed truth and
  // must be flagged — the scan catches drift in either direction.
  const docs = [{ path: 'h.md', text: '- **Public paid:** **CONDITIONAL GO.** No blocker stands.' }];
  const problems = activeDocumentProblems(STATE, docs);
  assert.ok(problems.some((p) => /public_paid/.test(p) && /NO-GO/.test(p) && /CONDITIONAL GO/.test(p)), problems.join('\n'));
});

test('reintroducing "router not accepted" while it is accepted fails the scan', () => {
  const docs = [{ path: 'h.md', text: 'The advisory P1-router-rsc-csrf-advisory is not reachable but neither accepted nor closed.' }];
  const problems = activeDocumentProblems(STATE, docs);
  assert.ok(problems.some((p) => /P1-router-rsc-csrf-advisory/.test(p) && /accepted/.test(p)), problems.join('\n'));
});

// --- the five failure conditions in the SC-01 spec ------------------------

test('a bundle hash that is not the candidate bundle fails the scan', () => {
  const docs = [{ path: 'h.md', text: 'The served frontend bundle is index-DEADBEEF.js.' }];
  assert.ok(activeDocumentProblems(STATE, docs).some((p) => /stale bundle hash/.test(p)));
});

test('an inconsistent transition count fails the scan', () => {
  for (const bad of ['nine-transition', 'seven-transition', '13-transition']) {
    const docs = [{ path: 'h.md', text: `Run the ${bad} live-money rehearsal.` }];
    assert.ok(
      activeDocumentProblems(STATE, docs).some((p) => /transition/.test(p) && /canonical/.test(p)),
      `did not catch ${bad}`,
    );
  }
});

test('a capped-beta verdict that disagrees with the computed GO fails the scan', () => {
  const docs = [{ path: 'h.md', text: '**Capped beta:** **NO-GO** for now.' }];
  assert.ok(activeDocumentProblems(STATE, docs).some((p) => /capped_beta/.test(p)));
});

// --- no false positives on legitimate wording ----------------------------

test('a document may call an accepted risk "accepted, not closed" without tripping', () => {
  const docs = [{
    path: 'h.md',
    text: 'P1-router-rsc-csrf-advisory keeps its real status: the advisory is NOT closed, it is accepted for public_paid.',
  }];
  assert.deepEqual(activeDocumentProblems(STATE, docs), []);
});

test('a document may name a prior/historical candidate SHA as history', () => {
  const docs = [{ path: 'h.md', text: 'Built directly on the prior candidate 5523187 (v13).' }];
  assert.deepEqual(activeDocumentProblems(STATE, docs), []);
});

test('the correct verdicts and canonical count do not trip the scan', () => {
  const docs = [{
    path: 'h.md',
    text: '**Capped beta:** **GO**. **Public paid:** **NO-GO**. The eight-transition rehearsal (steps A–H) remains not_run.',
  }];
  assert.deepEqual(activeDocumentProblems(STATE, docs), []);
});
