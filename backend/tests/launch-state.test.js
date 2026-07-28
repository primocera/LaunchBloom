// v11 SC-00 — the launch control plane must be impossible to talk out of.
// These fixtures are the failure modes that made previous gates unreliable: a
// verdict pinned to a stale SHA, evidence borrowed from another commit, a
// skipped check reported as green, a migration claim two documents disagree
// about, and an `unknown` quietly rounded up to pass.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { integrityProblems, computeVerdicts, STATUSES, CHECK_PASSING, EVIDENCE_PASSING } = require('../lib/launch-state');
const { loadState, documentProblems, render } = require('../scripts/launch-state');

const SHA = 'a'.repeat(40);
const clone = (o) => JSON.parse(JSON.stringify(o));

// A fully-evidenced candidate: the only shape that may produce GO.
const VALID = Object.freeze({
  schema_version: 'launch-state-1',
  product: 'Scalvya',
  repository: 'primocera/LaunchBloom',
  generated_at_utc: '2026-07-27T00:00:00Z',
  candidate: { branch: 'v11', sha: SHA, state: 'frozen', environment_class: 'production', bundle: { files: [] } },
  migrations: {
    range: '001-036',
    on_disk_count: 36,
    applied_verification: {
      status: 'observed',
      source: 'backend/migrations/CHECK_APPLIED.sql',
      last_run_utc: '2026-07-27T00:00:00Z',
    },
  },
  checks: [
    { id: 'unit', name: 'Unit', command: 'npm test', required: true, status: 'passed_ci', observed_at_sha: SHA, evidence: 'ci-run-1' },
    { id: 'e2e_authenticated', name: 'Auth E2E', command: 'npx playwright test', required: true, status: 'passed_ci', observed_at_sha: SHA, evidence: 'ci-run-2' },
  ],
  owner_evidence: [
    { id: 'live_money_rehearsal', title: 'Live money', status: 'live_rehearsed', required_for: ['public_paid'], runbook: 'docs/RUNBOOK_TRANSACTION_REHEARSAL.md', evidence_ref: 'evidence/2026-07-27-money.md' },
  ],
  blockers: [],
  verdicts: {
    capped_beta: { verdict: 'GO' },
    public_paid: { verdict: 'GO' },
  },
  rollback: {},
  superseded_documents: [],
});

test('a fully evidenced candidate at HEAD passes integrity and reaches GO', () => {
  assert.deepEqual(integrityProblems(VALID), []);
  const v = computeVerdicts(VALID, { head_sha: SHA });
  assert.equal(v.capped_beta.verdict, 'GO');
  assert.equal(v.public_paid.verdict, 'GO');
});

test('a stale SHA is a deterministic NO-GO — later commits invalidate evidence', () => {
  const v = computeVerdicts(VALID, { head_sha: 'b'.repeat(40) });
  assert.equal(v.public_paid.verdict, 'NO-GO');
  assert.equal(v.capped_beta.verdict, 'NO-GO');
  assert.match(v.public_paid.reasons.join(' '), /stale/);
});

// Recording evidence about a candidate necessarily writes files, and those
// writes were themselves marking the candidate stale — so a fully-evidenced
// release could never reach GO. These fix the narrow exemption that resolves
// it, and its limits.
test('documentation-only drift does not invalidate a candidate', () => {
  const v = computeVerdicts(VALID, { head_sha: 'b'.repeat(40), code_changes: [] });
  assert.equal(v.capped_beta.verdict, 'GO');
  assert.equal(v.public_paid.verdict, 'GO');
});

test('any code change does invalidate it, and names what moved', () => {
  const v = computeVerdicts(VALID, {
    head_sha: 'b'.repeat(40),
    code_changes: ['backend/lib/ai.js', 'app-src/routes/Landing.jsx'],
  });
  assert.equal(v.capped_beta.verdict, 'NO-GO');
  assert.match(v.capped_beta.reasons.join(' '), /2 code file\(s\) changed/);
  assert.match(v.capped_beta.reasons.join(' '), /backend\/lib\/ai\.js/);
});

test('when git cannot answer, drift is treated as invalidating', () => {
  for (const code_changes of [undefined, null]) {
    const v = computeVerdicts(VALID, { head_sha: 'b'.repeat(40), code_changes });
    assert.equal(v.capped_beta.verdict, 'NO-GO', 'unknown drift must never be read as safe');
    assert.match(v.capped_beta.reasons.join(' '), /stale/);
  }
});

test('the exemption covers docs only — never code, config or the bundle', () => {
  const { codeChangesSince } = require('../scripts/launch-state');
  assert.equal(typeof codeChangesSince, 'function');
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'launch-state.js'), 'utf8');
  const list = source.match(/const NON_CODE = \[([^\]]*)\]/);
  assert.ok(list, 'the exempt-path list must stay explicit and greppable');
  // app/ is the committed bundle users are served — exempting it would let a
  // rebuilt frontend ship under evidence gathered for a different one.
  for (const forbidden of ['app/', 'backend', 'app-src', 'e2e', 'api/', 'package.json']) {
    assert.ok(!list[1].includes(forbidden), `${forbidden} must never be exempt from invalidating a candidate`);
  }
});

test('an unpinned candidate cannot reach GO', () => {
  const state = clone(VALID);
  state.candidate.sha = null;
  const v = computeVerdicts(state, { head_sha: SHA });
  assert.equal(v.capped_beta.verdict, 'NO-GO');
  assert.match(v.capped_beta.reasons.join(' '), /no release candidate is pinned/);
});

test('a skipped required check blocks and is never read as green', () => {
  const state = clone(VALID);
  state.checks[1].status = 'skipped';
  state.checks[1].observed_at_sha = null;
  state.checks[1].evidence = null;
  const v = computeVerdicts(state, { head_sha: SHA });
  assert.equal(v.capped_beta.verdict, 'NO-GO');
  assert.match(v.capped_beta.reasons.join(' '), /e2e_authenticated is skipped/);
});

test('unknown is never coerced to pass', () => {
  for (const status of ['not_run', 'skipped', 'failed', 'unknown', 'configured']) {
    const state = clone(VALID);
    state.checks[0].status = status;
    state.checks[0].observed_at_sha = null;
    state.checks[0].evidence = null;
    const v = computeVerdicts(state, { head_sha: SHA });
    assert.equal(v.public_paid.verdict, 'NO-GO', `${status} must not satisfy a required check`);
  }
});

test('configured is not live evidence — owner items need a live run', () => {
  const state = clone(VALID);
  state.owner_evidence[0].status = 'configured';
  const v = computeVerdicts(state, { head_sha: SHA });
  assert.equal(v.public_paid.verdict, 'NO-GO');
  // A capped beta does not depend on this particular item.
  assert.equal(v.capped_beta.verdict, 'GO');
});

test('missing owner evidence blocks only the tracks that require it', () => {
  const state = clone(VALID);
  state.owner_evidence.push({
    id: 'ai_spend_ceiling', title: 'Spend ceiling', status: 'not_run',
    required_for: ['capped_beta', 'public_paid'], runbook: 'docs/CONFIGURED_STATE.md', evidence_ref: null,
  });
  const v = computeVerdicts(state, { head_sha: SHA });
  assert.equal(v.capped_beta.verdict, 'NO-GO');
  assert.equal(v.public_paid.verdict, 'NO-GO');
});

test('a migration claim that is not verified against the database blocks', () => {
  const state = clone(VALID);
  state.migrations.applied_verification = {
    status: 'unknown',
    source: 'backend/migrations/CHECK_APPLIED.sql',
    contradiction: 'two documents disagree',
    last_run_utc: null,
  };
  assert.deepEqual(integrityProblems({ ...state, verdicts: { capped_beta: { verdict: 'NO-GO' }, public_paid: { verdict: 'NO-GO' } } }), []);
  const v = computeVerdicts(state, { head_sha: SHA });
  assert.equal(v.capped_beta.verdict, 'NO-GO');
  assert.match(v.capped_beta.reasons.join(' '), /migrations applied-state is unknown/);
});

test('verified migrations must name a source and a run timestamp', () => {
  const state = clone(VALID);
  state.migrations.applied_verification = { status: 'observed' };
  const problems = integrityProblems(state);
  assert.match(problems.join(' '), /no source/);
  assert.match(problems.join(' '), /no run timestamp/);
});

test('an open P0 blocks both tracks; an open P1 blocks only the public paid launch', () => {
  const withP1 = clone(VALID);
  withP1.blockers.push({ id: 'P1-x', severity: 'P1', status: 'open', title: 'x', owner: 'owner', closure: 'y' });
  withP1.verdicts.public_paid.verdict = 'NO-GO';
  assert.deepEqual(integrityProblems(withP1), []);
  let v = computeVerdicts(withP1, { head_sha: SHA });
  assert.equal(v.capped_beta.verdict, 'GO');
  assert.equal(v.public_paid.verdict, 'NO-GO');

  const withP0 = clone(VALID);
  withP0.blockers.push({ id: 'P0-x', severity: 'P0', status: 'open', title: 'x', owner: 'owner', closure: 'y' });
  v = computeVerdicts(withP0, { head_sha: SHA });
  assert.equal(v.capped_beta.verdict, 'NO-GO');
  assert.equal(v.public_paid.verdict, 'NO-GO');
});

// Scoping a required check to fewer tracks is the one mechanism here that could
// be used to make a red check vanish. These fix what it may and may not do.
test('a required check scoped to one track still blocks that track', () => {
  const state = clone(VALID);
  state.checks[1].required_for = ['public_paid'];
  state.checks[1].scope_rationale = 'a stated reason';
  state.checks[1].status = 'skipped';
  state.checks[1].observed_at_sha = null;
  state.checks[1].evidence = null;
  state.verdicts.public_paid.verdict = 'NO-GO';

  const v = computeVerdicts(state, { head_sha: SHA });
  assert.equal(v.capped_beta.verdict, 'GO', 'the track it was scoped away from is unaffected');
  assert.equal(v.public_paid.verdict, 'NO-GO');
  assert.match(v.public_paid.reasons.join(' '), /e2e_authenticated is skipped/);
});

test('narrowing a check to fewer tracks requires a written rationale', () => {
  const state = clone(VALID);
  state.checks[1].required_for = ['public_paid'];
  assert.match(integrityProblems(state).join(' '), /no scope_rationale/);
});

test('a check with no required_for still blocks every track', () => {
  const state = clone(VALID);
  delete state.checks[1].required_for;
  state.checks[1].status = 'failed';
  state.checks[1].observed_at_sha = null;
  state.checks[1].evidence = null;
  const v = computeVerdicts(state, { head_sha: SHA });
  assert.equal(v.capped_beta.verdict, 'NO-GO');
  assert.equal(v.public_paid.verdict, 'NO-GO');
});

test('evidence borrowed from another commit is an integrity failure', () => {
  const state = clone(VALID);
  state.checks[0].observed_at_sha = 'c'.repeat(40);
  assert.match(integrityProblems(state).join(' '), /evidence is from/);
});

test('a pass with no evidence reference is an integrity failure', () => {
  const state = clone(VALID);
  state.checks[0].evidence = null;
  assert.match(integrityProblems(state).join(' '), /carries no evidence reference/);
});

test('a declared verdict that disagrees with the computed one is an integrity failure', () => {
  const state = clone(VALID);
  state.checks[0].status = 'failed';
  state.checks[0].observed_at_sha = null;
  state.checks[0].evidence = null;
  // The facts now say NO-GO while the document still declares GO.
  assert.match(integrityProblems(state).join(' '), /declared GO, computed NO-GO/);
});

test('statuses outside the vocabulary are rejected', () => {
  const state = clone(VALID);
  state.checks[0].status = 'green';
  assert.match(integrityProblems(state).join(' '), /unknown status/);
  assert.ok(!STATUSES.includes('green'));
});

// --- the real manifest ----------------------------------------------------

test('the committed launch state is internally consistent', () => {
  const state = loadState();
  assert.deepEqual(integrityProblems(state), []);
  assert.deepEqual(documentProblems(state), []);
});

// 2026-07-28: capped_beta reached GO. Every reason it used to carry went away
// because the underlying fact changed and was written down with an evidence
// reference — migrations verified against the production database, production
// configuration answered by /api/admin/readiness in production mode, the spend
// ceiling confirmed live. That is the only route to GO this system allows.
test('capped beta is GO on evidence, and every passing check is pinned to the candidate', () => {
  const state = loadState();
  const v = computeVerdicts(state, { head_sha: state.candidate.sha, code_changes: [] });
  assert.equal(v.capped_beta.verdict, 'GO', `still blocked by: ${v.capped_beta.reasons.join('; ')}`);

  // A GO is only as good as its pinning: no check may claim a pass on evidence
  // gathered at some other commit, and none may pass with nothing behind it.
  for (const check of state.checks) {
    if (!CHECK_PASSING.includes(check.status)) continue;
    assert.equal(check.observed_at_sha, state.candidate.sha, `${check.id} is pinned to the wrong commit`);
    assert.ok(check.evidence, `${check.id} claims a pass with no evidence`);
  }
  // Live-system claims must name a document a human can go and read.
  for (const e of state.owner_evidence) {
    if (!EVIDENCE_PASSING.includes(e.status)) continue;
    assert.ok(e.evidence_ref, `${e.id} claims ${e.status} with no evidence_ref`);
    assert.ok(
      fs.existsSync(path.join(__dirname, '..', '..', e.evidence_ref)),
      `${e.id} points at ${e.evidence_ref}, which does not exist`,
    );
  }
});

test('public paid launch stays NO-GO, and says why', () => {
  const state = loadState();
  const v = computeVerdicts(state, { head_sha: state.candidate.sha, code_changes: [] });
  assert.equal(v.public_paid.verdict, 'NO-GO');
  const why = v.public_paid.reasons.join(' ');
  // The authenticated matrix was scoped to public launch (see the check's
  // scope_rationale). It must still block that track, or scoping would have
  // been a way to delete a red check rather than to place it.
  assert.match(why, /e2e_authenticated is skipped/);
  assert.match(why, /live_money_rehearsal is not_run/);
  assert.match(why, /resend_suppression is not_run/);
});

test('no required check claims to have passed in CI that CI does not run', () => {
  const state = loadState();
  const ciJob = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  for (const check of state.checks) {
    if (check.status !== 'passed_ci') continue;
    assert.ok(
      ciJob.includes(check.command),
      `${check.id} claims passed_ci but "${check.command}" does not appear in the CI workflow`,
    );
  }
});

test('every superseded release document carries a banner pointing at the canonical state', () => {
  const state = loadState();
  assert.ok(state.superseded_documents.length >= 4);
  for (const doc of state.superseded_documents) {
    const body = fs.readFileSync(path.join(__dirname, '..', '..', doc.path), 'utf8');
    assert.match(body, /SUPERSEDED/, `${doc.path} must say so in the file itself`);
    assert.match(body, /LAUNCH_STATE\.md/, `${doc.path} must point at the canonical record`);
  }
});

test('the rendered launch status stays in sync with the canonical data', () => {
  const state = loadState();
  // Rendered as if HEAD were the candidate, so the committed document is
  // deterministic. Live drift is reported by `npm run launch:gate`, which
  // reads the real HEAD.
  const expected = render(state, { head_sha: state.candidate.sha || state.candidate.head_at_generation });
  const onDisk = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'LAUNCH_STATE.md'), 'utf8');
  assert.equal(onDisk, expected, 'docs/LAUNCH_STATE.md is stale — run `npm run launch:render`');
});
