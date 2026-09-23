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
  computeVerdicts,
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
  // Pinned or pending, a stale "candidate <sha>" is a claim of a current
  // candidate that does not exist.
  assert.ok(problems.some((p) => /candidate 5523187/.test(p) && /(pinned candidate is|no candidate is frozen)/.test(p)), problems.join('\n'));
});

test('a doc that states the wrong public_paid verdict contradicts the computed truth and fails the scan', () => {
  // Verdict-agnostic: derive the computed verdict from the live manifest and
  // feed a DIFFERENT one, so this holds at any candidate (NO-GO, CONDITIONAL GO
  // or a future full GO) rather than pinning a moment-in-time verdict.
  const want = computeVerdicts(STATE).public_paid.verdict;
  const wrong = want === 'GO' ? 'CONDITIONAL GO' : 'GO';
  const docs = [{ path: 'h.md', text: `- **Public paid:** **${wrong}.** overstated.` }];
  const problems = activeDocumentProblems(STATE, docs);
  assert.ok(
    problems.some((p) => /public_paid/.test(p) && p.includes(`"${wrong}"`) && p.includes(`"${want}"`)),
    `expected a public_paid ${wrong}-vs-${want} contradiction:\n${problems.join('\n')}`,
  );
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

test('a capped-beta verdict that disagrees with the computed verdict fails the scan', () => {
  const want = computeVerdicts(STATE).capped_beta.verdict;
  const wrong = want === 'GO' ? 'NO-GO' : 'GO';
  const docs = [{ path: 'h.md', text: `**Capped beta:** **${wrong}** for now.` }];
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
  // Build the doc from the actually-computed verdicts, so the "correct" fixture
  // tracks the manifest instead of hard-coding a verdict that later drifts.
  const v = computeVerdicts(STATE);
  const docs = [{
    path: 'h.md',
    text: `**Capped beta:** **${v.capped_beta.verdict}**. **Public paid:** **${v.public_paid.verdict}**. The eight-transition rehearsal (steps A–H) remains not_run.`,
  }];
  assert.deepEqual(activeDocumentProblems(STATE, docs), []);
});

// --- v24 SV-24-01: the certificate and owner checklist are active documents --

const { execSync } = require('node:child_process');
const { documentProblems } = require('../scripts/launch-state');

const doc = (text) => [{ path: 'd.md', text }];
const problemsOf = (text, state = STATE) => activeDocumentProblems(state, doc(text));
const clone = (o) => JSON.parse(JSON.stringify(o));

test('active_documents covers the rendered state, the v23 certificate and the v23 owner checklist', () => {
  for (const rel of ['docs/LAUNCH_STATE.md', 'docs/evidence/CERTIFICATION_v23.md', 'docs/evidence/OWNER_CHECKLIST_v23.md']) {
    assert.ok(STATE.active_documents.includes(rel), `${rel} must be an active document`);
  }
});

function atCommit(rel, sha) {
  try { return execSync(`git show ${sha}:${rel}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}

test('the pre-v24 certificate (old candidate + CONDITIONAL GO) now fails the scan', (t) => {
  const old = atCommit('docs/evidence/CERTIFICATION_v23.md', '502ec4e4e8521fe642b60aa57aab897c4061dab9');
  if (old == null) { t.skip('git history unavailable'); return; }
  const problems = activeDocumentProblems(STATE, [{ path: 'docs/evidence/CERTIFICATION_v23.md', text: old }]);
  assert.ok(problems.some((p) => /a5df7af/.test(p)), `old candidate not caught:\n${problems.join('\n')}`);
  assert.ok(problems.some((p) => /public_paid = "CONDITIONAL GO"/.test(p)), `old verdict not caught:\n${problems.join('\n')}`);
});

test('the pre-v24 owner checklist (NOT RUN headings under a DONE roll-up) now fails the scan', (t) => {
  const old = atCommit('docs/evidence/OWNER_CHECKLIST_v23.md', '502ec4e4e8521fe642b60aa57aab897c4061dab9');
  if (old == null) { t.skip('git history unavailable'); return; }
  const problems = activeDocumentProblems(STATE, [{ path: 'docs/evidence/OWNER_CHECKLIST_v23.md', text: old }]);
  for (const n of ['1', '2', '4', '7']) {
    assert.ok(problems.some((p) => new RegExp(`step ${n} is DONE .*NOT RUN`).test(p)), `step ${n} DONE-vs-NOT RUN not caught:\n${problems.join('\n')}`);
  }
});

test('a labelled wrong candidate SHA fails the scan', () => {
  const problems = problemsOf('**Candidate to freeze (code):** `a5df7af301d299234adda12ce2bb2bc02b1d6b68`');
  assert.ok(problems.some((p) => /candidate a5df7af/.test(p)), problems.join('\n'));
});

test('a --candidate CLI flag inside a documented command is not a candidate claim', () => {
  assert.deepEqual(problemsOf('`npm run readiness:validate -- r.json --candidate 5523187abc`'), []);
});

test('a wrong verdict stated in a table row fails the scan', () => {
  const want = computeVerdicts(STATE).public_paid.verdict;
  const wrong = want === 'CONDITIONAL GO' ? 'GO' : 'CONDITIONAL GO';
  const problems = problemsOf(`| Track | Verdict |\n|---|---|\n| **public_paid** | **${wrong}** |`);
  assert.ok(problems.some((p) => /public_paid/.test(p) && p.includes(`"${wrong}"`)), problems.join('\n'));
});

test('a step that is DONE in one place and NOT RUN in another fails the scan', () => {
  const heading = '## 2. Probe  — status: NOT RUN\nbody\n\n| Step | Status |\n|---|---|\n| 2 Probe | **DONE** — docs/evidence/x.json |\n';
  assert.ok(problemsOf(heading).some((p) => /step 2 is DONE in its roll-up but "NOT RUN" in its heading/.test(p)));

  const body = '## 3. Readiness  — status: NOT RUN\n- **DONE 2026-09-21:** saw ready=true in docs/evidence/r.json\n';
  assert.ok(problemsOf(body).some((p) => /step 3 is DONE in its body/.test(p)));

  const table = [
    '| application | action id + short desc | result (passed/failed/blocked) | redacted evidence ref |',
    '|---|---|---|---|',
    '| Scalvya | 5 cancel | passed | owner attestation |',
    '',
    '| Step | Status |',
    '|---|---|',
    '| 5 Cancel | NOT RUN |',
  ].join('\n');
  assert.ok(problemsOf(table).some((p) => /step 5 is DONE in its evidence table but "NOT RUN" in its roll-up/.test(p)));
});

test('a DONE step with no redacted evidence reference fails; one with a reference passes', () => {
  const bare = '## 4. Refund  — status: DONE 2026-09-05\nIt went fine.\n';
  assert.ok(problemsOf(bare).some((p) => /step 4 is DONE but cites no redacted evidence reference/.test(p)));
  const cited = '## 4. Refund  — status: DONE 2026-09-05\nRow H in docs/evidence/2026-09-05-rehearsal-record.json.\n';
  assert.deepEqual(problemsOf(cited), []);
  const notRun = '## 4. Refund  — status: NOT RUN\nNothing yet.\n';
  assert.deepEqual(problemsOf(notRun), []);
});

test('a wrong A–H range or step count in a rehearsal context fails the scan', () => {
  for (const bad of ['the ordered A–G rehearsal sequence', 'live-money steps A to F', 'all seven steps of the live-money rehearsal']) {
    assert.ok(problemsOf(bad).some((p) => /canonical/.test(p)), `did not catch "${bad}"`);
  }
  assert.deepEqual(problemsOf('The ordered eight-transition A–H live-money rehearsal (8 steps) is complete.'), []);
  assert.deepEqual(problemsOf('Plan A-B pricing copy.'), [], 'a range outside a rehearsal context is ignored');
});

test('a closed blocker described as open fails the scan', () => {
  const problems = problemsOf('Blocker P1-live-money-unrehearsed is still open.');
  assert.ok(problems.some((p) => /P1-live-money-unrehearsed as open, but the manifest records it as closed/.test(p)), problems.join('\n'));
});

test('an open blocker described as closed fails the scan', () => {
  const state = clone(STATE);
  state.blockers.push({ id: 'P1-example-open', severity: 'P1', status: 'open', title: 't', owner: 'o', closure: 'c' });
  const problems = problemsOf('P1-example-open closed yesterday.', state);
  assert.ok(problems.some((p) => /P1-example-open as closed, but the manifest records it as open/.test(p)), problems.join('\n'));
});

test('two active documents that disagree on a blocker fail the scan', () => {
  const state = clone(STATE);
  state.blockers.push({ id: 'P1-example-open', severity: 'P1', status: 'open', title: 't', owner: 'o', closure: 'c' });
  const problems = activeDocumentProblems(state, [
    { path: 'a.md', text: 'P1-example-open is open.' },
    { path: 'b.md', text: 'P1-example-open closed.' },
  ]);
  assert.ok(problems.some((p) => /active docs disagree on blocker P1-example-open: open in a\.md but closed in b\.md/.test(p)), problems.join('\n'));
});

test('a clearly labelled Historical section is history, not current truth', () => {
  const stale = '**Candidate to freeze (code):** `a5df7af301d299234adda12ce2bb2bc02b1d6b68`\n\n| **public_paid** | **CONDITIONAL GO** |\n';
  assert.ok(problemsOf(stale).length > 0, 'the stale claims must fail outside a historical section');
  const historical = `# Record\n\nCurrent text.\n\n## Historical record (superseded)\n\n${stale}\n### Phase 1\n\nStill history.\n`;
  assert.deepEqual(problemsOf(historical), []);
  // History ends at the next heading of the same level: claims after it are current again.
  const after = `${historical}\n## Current\n\n${stale}`;
  assert.ok(problemsOf(after).length > 0, 'a claim after the historical section must be read as current');
  // Only a heading that STARTS with Historical/Superseded is history.
  assert.ok(problemsOf(`## Pricing and historical context\n\n${stale}`).length > 0, 'a current heading that merely mentions "historical" stays current');
});

test('an active document citing a missing docs/evidence file fails launch verification', () => {
  const rel = STATE.active_documents[1];
  const problems = documentProblems(STATE, ROOT, { [rel]: 'See docs/evidence/2099-01-01-does-not-exist.json.' });
  assert.ok(problems.some((p) => /cites evidence docs\/evidence\/2099-01-01-does-not-exist\.json, which does not exist/.test(p)), problems.join('\n'));
});
