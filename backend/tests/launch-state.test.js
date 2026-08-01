// v11 SC-00 — the launch control plane must be impossible to talk out of.
// These fixtures are the failure modes that made previous gates unreliable: a
// verdict pinned to a stale SHA, evidence borrowed from another commit, a
// skipped check reported as green, a migration claim two documents disagree
// about, and an `unknown` quietly rounded up to pass.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { integrityProblems, computeVerdicts, STATUSES, VERDICTS, CHECK_PASSING, EVIDENCE_PASSING } = require('../lib/launch-state');
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
  // rebuilt frontend ship under evidence gathered for a different one. Config,
  // workflow and lockfile changes are code too: they change what runs.
  for (const forbidden of [
    'app/', 'backend', 'app-src', 'e2e', 'api/', 'package.json', 'package-lock',
    '.github', 'config', 'playwright', 'eslint', 'vite', '.env',
  ]) {
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

test('a declared GO that should be CONDITIONAL GO is an integrity failure', () => {
  const state = clone(VALID);
  // A required check bypassed by a valid acceptance: the honest verdict is
  // CONDITIONAL GO, but the document still declares a full GO.
  state.checks[1].status = 'skipped';
  state.checks[1].observed_at_sha = null;
  state.checks[1].evidence = null;
  state.checks[1].accepted_risk = {
    accepted_by: 'owner', accepted_at_utc: '2026-07-28T00:00:00Z', tracks: ['public_paid'],
    rationale: 'a rationale long enough to be a real argument rather than a placeholder',
  };
  // capped_beta genuinely stays GO; only public_paid is misdeclared.
  assert.match(integrityProblems(state).join(' '), /declared GO, computed CONDITIONAL GO/);
});

test('a verdict string outside the closed vocabulary is rejected', () => {
  const state = clone(VALID);
  state.verdicts.public_paid.verdict = 'SHIP IT';
  assert.match(integrityProblems(state).join(' '), /unknown verdict "SHIP IT"/);
  assert.ok(!VERDICTS.includes('SHIP IT'));
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

test('public paid launch is CONDITIONAL GO on accepted risk, never a full GO', () => {
  const state = loadState();
  const v = computeVerdicts(state, { head_sha: state.candidate.sha, code_changes: [] });
  // The accepted risks make a full GO impossible; the honest verdict is conditional.
  assert.equal(v.public_paid.verdict, 'CONDITIONAL GO');
  assert.notEqual(v.public_paid.verdict, 'GO');

  // Freeze-stable: the accepted risks the verdict rests on must be exactly the
  // set of accepted items scoped to public_paid — derived from the manifest, not
  // hard-coded, so a future freeze that closes or accepts a risk needs no edit
  // here. As of the v12 candidate that is authenticated-e2e and live-money
  // (hero-contrast was fixed and is closed), but the assertion checks internal
  // consistency rather than pinning those names.
  const acceptedForPublic = new Set();
  for (const coll of [state.blockers, state.checks, state.owner_evidence]) {
    for (const item of coll || []) {
      const acc = item.accepted_risk;
      if (acc && (acc.tracks || []).includes('public_paid')) {
        acceptedForPublic.add(acc.risk_id || item.id);
      }
    }
  }
  const computedIds = new Set(v.public_paid.accepted_risks.map((r) => r.risk_id));
  assert.deepEqual([...computedIds].sort(), [...acceptedForPublic].sort(),
    'the computed accepted risks must match the accepted items scoped to public_paid');
  assert.ok(computedIds.size >= 1, 'a CONDITIONAL GO must rest on at least one accepted risk');

  // Each acceptance is a recorded decision with a named owner — if all are
  // removed, this verdict must fall back to NO-GO on its own.
  const accepted = state.blockers.filter((b) => b.status === 'accepted');
  assert.ok(accepted.length >= 1, 'the public launch verdict rests on accepted risks that must stay visible');

  const stripped = clone(state);
  for (const b of stripped.blockers) { if (b.status === 'accepted') { b.status = 'open'; delete b.accepted_risk; } }
  for (const c of stripped.checks) delete c.accepted_risk;
  for (const e of stripped.owner_evidence) delete e.accepted_risk;
  const without = computeVerdicts(stripped, { head_sha: state.candidate.sha, code_changes: [] });
  assert.equal(without.public_paid.verdict, 'NO-GO', 'withdrawing the acceptances must reverse the verdict');
  assert.match(without.public_paid.reasons.join(' '), /e2e_authenticated is skipped/);
  assert.match(without.public_paid.reasons.join(' '), /live_money_rehearsal is not_run/);
});


test('no required check claims to have passed in CI that CI does not run', () => {
  const state = loadState();
  // passed_ci is legitimate only when the exact command runs in a committed
  // workflow — the lean ci.yml OR the fail-closed release-candidate workflow.
  const workflowsDir = path.join(__dirname, '..', '..', '.github', 'workflows');
  const workflows = fs.readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => fs.readFileSync(path.join(workflowsDir, f), 'utf8'))
    .join('\n');
  for (const check of state.checks) {
    if (check.status !== 'passed_ci') continue;
    assert.ok(
      workflows.includes(check.command),
      `${check.id} claims passed_ci but "${check.command}" does not appear in any CI workflow`,
    );
  }
});

test('the release-candidate workflow runs the launch-critical set, fail-closed, with evidence', () => {
  const rc = fs.readFileSync(
    path.join(__dirname, '..', '..', '.github', 'workflows', 'release-candidate.yml'), 'utf8',
  );
  // Every launch-critical command the manifest can cite as passed_ci must run here.
  for (const cmd of [
    'npm run lint', 'npm run launch:verify', 'npm test', 'npm run build:app',
    'npm run check:app-fresh', 'npm run test:export', 'npm run test:e2e', 'npm run launch:drift',
  ]) {
    assert.ok(rc.includes(cmd), `release-candidate workflow must run ${cmd}`);
  }
  // Release-candidate mode (skips are hard failures) and refusal of the wrong target.
  assert.match(rc, /RC_GATE: '1'/, 'the workflow must run in release-candidate mode');
  assert.match(rc, /E2E_FORBIDDEN_SUPABASE_REFS/, 'the authenticated job must be able to refuse a forbidden target');
  // Evidence artifacts are named with the candidate SHA and the run id.
  assert.match(rc, /rc-evidence-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_id \}\}/);
  // Owner-only live checks are stated as NOT RUN, never passed.
  assert.match(rc, /Owner-only live checks: NOT RUN/);
  assert.match(rc, /Authenticated matrix NOT RUN/);
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

test('the rendered output lists accepted risks and never claims all conditions met for a CONDITIONAL GO', () => {
  const state = loadState();
  const doc = render(state, { head_sha: state.candidate.sha });
  const v = computeVerdicts(state, { head_sha: state.candidate.sha, code_changes: [] });
  assert.equal(v.public_paid.verdict, 'CONDITIONAL GO', 'this test assumes the manifest is conditional');

  // The conditional verdict must not read as a clean pass.
  const verdictSection = doc.slice(doc.indexOf('## Verdict'), doc.indexOf('## Release candidate'));
  assert.ok(verdictSection.includes('CONDITIONAL GO'));
  assert.ok(
    !/CONDITIONAL GO.*all conditions met/.test(verdictSection),
    'a CONDITIONAL GO must never be rendered as "all conditions met"',
  );

  // Every accepted risk the verdict rests on is named, with its real status.
  assert.match(doc, /Unresolved blockers and accepted risks/);
  for (const r of v.public_paid.accepted_risks) {
    assert.ok(doc.includes(r.risk_id), `rendered doc must name accepted risk ${r.risk_id}`);
  }
  // "Accepted" is shown as distinct from "closed".
  assert.match(doc, /ACCEPTED \(not closed\)/);
});

// --- accepted risk --------------------------------------------------------
// The one mechanism that can turn a red item green. It exists so a launch can
// proceed on a stated decision instead of a quietly edited fact — which means
// it has to cost something, and it must never rewrite the underlying status.

test('one correctly scoped accepted required risk returns CONDITIONAL GO for only that track', () => {
  const state = clone(VALID);
  state.checks[1].status = 'skipped';
  state.checks[1].observed_at_sha = null;
  state.checks[1].evidence = null;
  state.checks[1].accepted_risk = {
    accepted_by: 'owner', accepted_at_utc: '2026-07-28T00:00:00Z', tracks: ['public_paid'],
    rationale: 'a rationale long enough to be a real argument rather than a placeholder',
  };
  state.verdicts.public_paid.verdict = 'CONDITIONAL GO';
  state.verdicts.capped_beta.verdict = 'NO-GO';
  const v = computeVerdicts(state, { head_sha: SHA });
  // The named track proceeds, but on accepted risk — never a full GO.
  assert.equal(v.public_paid.verdict, 'CONDITIONAL GO', 'the named track proceeds on accepted risk');
  assert.equal(v.public_paid.accepted_risks.length, 1);
  assert.equal(v.public_paid.accepted_risks[0].status, 'skipped', 'the underlying status is untouched');
  // An unnamed track gets no benefit from the acceptance and stays NO-GO.
  assert.equal(v.capped_beta.verdict, 'NO-GO', 'an unnamed track is not unblocked');
});

test('removing the acceptance returns the track to NO-GO', () => {
  const accepted = clone(VALID);
  accepted.checks[1].status = 'skipped';
  accepted.checks[1].observed_at_sha = null;
  accepted.checks[1].evidence = null;
  accepted.checks[1].accepted_risk = {
    accepted_by: 'owner', accepted_at_utc: '2026-07-28T00:00:00Z', tracks: ['public_paid'],
    rationale: 'a rationale long enough to be a real argument rather than a placeholder',
  };
  assert.equal(computeVerdicts(accepted, { head_sha: SHA }).public_paid.verdict, 'CONDITIONAL GO');

  const withdrawn = clone(accepted);
  delete withdrawn.checks[1].accepted_risk;
  const v = computeVerdicts(withdrawn, { head_sha: SHA });
  assert.equal(v.public_paid.verdict, 'NO-GO', 'withdrawing the acceptance reverses the verdict');
  assert.match(v.public_paid.reasons.join(' '), /e2e_authenticated is skipped/);
});

test('a full GO is impossible while any required condition rides on accepted risk', () => {
  const state = clone(VALID);
  state.checks[1].status = 'skipped';
  state.checks[1].observed_at_sha = null;
  state.checks[1].evidence = null;
  state.checks[1].accepted_risk = {
    accepted_by: 'owner', accepted_at_utc: '2026-07-28T00:00:00Z', tracks: ['public_paid', 'capped_beta'],
    rationale: 'a rationale long enough to be a real argument rather than a placeholder',
  };
  const v = computeVerdicts(state, { head_sha: SHA });
  for (const track of ['public_paid', 'capped_beta']) {
    assert.equal(v[track].verdict, 'CONDITIONAL GO', `${track} may proceed but never as a full GO`);
    assert.notEqual(v[track].verdict, 'GO');
  }
});

test('an accepted risk never rewrites the underlying status', () => {
  const state = loadState();
  const check = state.checks.find((c) => c.id === 'e2e_authenticated');
  assert.equal(check.status, 'skipped', 'the matrix has still never run and must still say so');
  const money = state.owner_evidence.find((e) => e.id === 'live_money_rehearsal');
  assert.equal(money.status, 'not_run');
  for (const b of state.blockers.filter((x) => x.status === 'accepted')) {
    assert.ok(b.accepted_risk.rationale.length >= 40, `${b.id} needs a real rationale`);
    assert.ok(b.accepted_risk.accepted_by, `${b.id} must name who accepted it`);
  }
});

test('acceptance without a named person, date, tracks or a real rationale is rejected', () => {
  const base = {
    accepted_by: 'owner', accepted_at_utc: '2026-07-28T00:00:00Z', tracks: ['public_paid'],
    rationale: 'a rationale long enough to be a real argument rather than a placeholder',
  };
  for (const [field, expected] of [['accepted_by', /no accepted_by/], ['accepted_at_utc', /no accepted_at_utc/]]) {
    const state = clone(VALID);
    state.blockers.push({ id: 'B', severity: 'P1', status: 'accepted', title: 't', owner: 'o', closure: 'c', accepted_risk: { ...base, [field]: undefined } });
    assert.match(integrityProblems(state).join(' '), expected);
  }
  const thin = clone(VALID);
  thin.blockers.push({ id: 'B', severity: 'P1', status: 'accepted', title: 't', owner: 'o', closure: 'c', accepted_risk: { ...base, rationale: 'because' } });
  assert.match(integrityProblems(thin).join(' '), /needs a real rationale/);

  const untracked = clone(VALID);
  untracked.blockers.push({ id: 'B', severity: 'P1', status: 'accepted', title: 't', owner: 'o', closure: 'c', accepted_risk: { ...base, tracks: [] } });
  assert.match(integrityProblems(untracked).join(' '), /must name the tracks/);
});
