#!/usr/bin/env node
// ---------------------------------------------------------------------------
// v11 SC-00 — the launch control plane CLI.
//
//   node backend/scripts/launch-state.js verify   document integrity (CI-safe)
//   node backend/scripts/launch-state.js gate     integrity + GO/NO-GO verdict
//   node backend/scripts/launch-state.js render   regenerate docs/LAUNCH_STATE.md
//
// `verify` answers "can this document be believed?" and must stay green on
// every push. `gate` answers "may we ship?" and stays red until the evidence
// exists — that is the point of it, not a fault.
//
// Read-only apart from `render`. Touches no external system, runs no migration
// and prints no secret.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const {
  integrityProblems,
  activeDocumentProblems,
  reviewProblems,
  computeVerdicts,
  CHECK_PASSING,
  EVIDENCE_PASSING,
} = require('../lib/launch-state');
const { rscIndicators } = require('../lib/router-reachability');

const ROOT = path.join(__dirname, '..', '..');
const STATE_PATH = path.join(ROOT, 'docs', 'launch', 'launch-state.json');
const RENDER_PATH = path.join(ROOT, 'docs', 'LAUNCH_STATE.md');

// The banner every superseded document must carry, so a reader who opens the
// old file directly cannot mistake it for current truth.
const SUPERSEDED_MARKER = '> **SUPERSEDED';

function loadState(file = STATE_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function headSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: ROOT }).trim(); }
  catch { return null; }
}

// Paths that cannot change what the product does. Recording evidence about a
// candidate necessarily writes files, and those writes were themselves marking
// the candidate stale — so a fully-evidenced release could never reach GO, and
// the gate's most important state was the one it could not express.
//
// What actually invalidates evidence is a change to the thing the evidence
// describes. Deliberately narrow: `docs/` and the two prompt packs only. A
// change under backend/, app-src/, app/, e2e/, api/ or any config file is code
// and still invalidates everything.
const NON_CODE = [/^docs\//, /\.docx$/];

/**
 * Files changed between the candidate and HEAD that could alter behaviour.
 * Returns [] when the tree only moved in documentation, and null when git
 * cannot answer — in which case the caller must assume the worst.
 */
function codeChangesSince(sha) {
  if (!sha) return null;
  try {
    const out = execSync(`git diff --name-only ${sha}..HEAD`, { encoding: 'utf8', cwd: ROOT });
    return out.split('\n').map((l) => l.trim()).filter(Boolean)
      .filter((f) => !NON_CODE.some((re) => re.test(f)));
  } catch {
    return null; // unknown never means safe
  }
}

// v15 SC-05: the frontend source + build config, for the RSC reachability scan.
// Reuses the standalone scanner's collector so both agree on what is scanned.
function collectSourceForRsc() {
  try { return require('./check-router-reachability').collect(); }
  catch { return []; }
}

// Integrity checks that need the filesystem, kept out of the pure module:
// the manifest's claims about other documents must actually hold on disk.
function documentProblems(state, root = ROOT, overrides = {}) {
  const problems = [];
  for (const doc of state.superseded_documents || []) {
    const p = path.join(root, doc.path);
    if (!fs.existsSync(p)) { problems.push(`superseded document missing: ${doc.path}`); continue; }
    const body = fs.readFileSync(p, 'utf8');
    if (!body.includes(SUPERSEDED_MARKER)) {
      problems.push(`${doc.path} is listed as superseded but carries no SUPERSEDED banner — two active documents can disagree`);
    }
  }

  // v15 SC-01: the allowlisted ACTIVE documents (a hand-authored owner handoff
  // and the rendered view) must not contradict the manifest on candidate,
  // verdict, blocker status, bundle or the live-money transition count. Reading
  // these files is why this scan lives in the CLI and not the pure module.
  const activeDocs = [];
  for (const rel of state.active_documents || []) {
    // `render` passes the freshly-generated text for the file it is about to
    // write, so a stale on-disk rendered view can never block its own
    // regeneration (the generator's output cannot contradict the manifest).
    if (Object.prototype.hasOwnProperty.call(overrides, rel)) {
      activeDocs.push({ path: rel, text: overrides[rel] });
      continue;
    }
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) { problems.push(`active document missing: ${rel}`); continue; }
    activeDocs.push({ path: rel, text: fs.readFileSync(p, 'utf8') });
  }
  for (const p of activeDocumentProblems(state, activeDocs)) problems.push(p);

  // Migration count is a fact about the repository, so it is verified against
  // the repository rather than trusted.
  const migDir = path.join(root, 'backend', 'migrations');
  if (fs.existsSync(migDir)) {
    const onDisk = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).length;
    const claimed = state.migrations && state.migrations.on_disk_count;
    if (claimed != null && claimed !== onDisk) {
      problems.push(`migrations.on_disk_count says ${claimed}, backend/migrations holds ${onDisk}`);
    }
  }
  return problems;
}

// --- render ---------------------------------------------------------------

const STATUS_LABEL = {
  not_run: 'not run',
  skipped: 'SKIPPED',
  failed: 'FAILED',
  passed_locally: 'passed locally',
  passed_ci: 'passed in CI',
  observed_production: 'observed in production',
  configured: 'configured',
  live_rehearsed: 'live rehearsed',
  observed: 'observed',
  unknown: 'UNKNOWN',
};
const label = (s) => STATUS_LABEL[s] || s;
const mark = (ok) => (ok ? 'yes' : 'no');

function render(state, observed) {
  const v = computeVerdicts(state, observed);
  const c = state.candidate || {};
  const out = [];
  const p = (s = '') => out.push(s);

  p('# Scalvya — launch state');
  p();
  p('> Generated from `docs/launch/launch-state.json` by `npm run launch:render`.');
  p('> Do not edit this file by hand; edit the JSON and regenerate. Any other');
  p('> release document that disagrees with this one is superseded, not a');
  p('> second opinion.');
  p('>');
  p('> **Before proposing a new prompt pack, read `docs/PROMPT_PACK_SCOPE_NOTE.md`.**');
  p('> The authenticated E2E matrix, the live-money rehearsal and the router');
  p('> advisory are owner-gated and cannot be closed by a pack — do not write one');
  p('> around them.');
  p();
  p(`Repository \`${state.repository}\` · branch \`${c.branch}\` · generated ${state.generated_at_utc}`);
  p();

  p('## Verdict');
  p();
  p('| Track | Verdict | Why |');
  p('|---|---|---|');
  for (const track of ['capped_beta', 'public_paid']) {
    const t = v[track];
    let why;
    if (t.verdict === 'NO-GO') {
      why = t.reasons.join('; ');
    } else if (t.verdict === 'CONDITIONAL GO') {
      // Never "all conditions met": a conditional launch proceeds over unmet
      // conditions that are only bypassed by an accepted risk.
      why = `no unaccepted blocker remains, but proceeds on accepted risk: ${t.accepted_risks.map((r) => r.risk_id).join(', ')}`;
    } else {
      why = 'all conditions met';
    }
    p(`| ${track === 'capped_beta' ? 'Capped beta' : 'Public paid launch'} | **${t.verdict}** | ${why} |`);
  }
  p();
  p('A capped, supported beta and an unrestricted public paid launch are');
  p('different risk decisions and are decided separately. **GO** means every');
  p('required condition is met; **CONDITIONAL GO** means no unaccepted blocker');
  p('remains but the launch proceeds over one or more required conditions that');
  p('are only bypassed by a recorded accepted risk — not satisfied; **NO-GO**');
  p('means at least one required condition is unmet without a valid acceptance.');
  p();

  p('## Release candidate');
  p();
  if (!c.sha) {
    p(`**No candidate is pinned.** ${c.explanation || ''}`);
    p();
    p(`- Reviewed baseline: \`${c.baseline_sha}\``);
    p(`- HEAD when this record was written: \`${c.head_at_generation}\``);
  } else {
    p(`- Candidate SHA: \`${c.sha}\` (${c.state})`);
    p(`- HEAD now: \`${observed.head_sha || 'unknown'}\`${observed.head_sha && observed.head_sha !== c.sha ? ' — **drifted, candidate is stale**' : ''}`);
    p(`- Bundle: ${(c.bundle && c.bundle.files || []).join(', ') || 'not built'}`);
  }
  p(`- Environment class: ${c.environment_class}`);
  p();
  if ((state.drift_from_baseline || []).length) {
    p('### Drift from the reviewed baseline');
    p();
    p('| Commit | Subject | Already closes |');
    p('|---|---|---|');
    for (const d of state.drift_from_baseline) p(`| \`${d.sha}\` | ${d.subject} | ${d.closes_requirement} |`);
    p();
  }

  p('## Migrations');
  p();
  const av = (state.migrations && state.migrations.applied_verification) || {};
  p(`- On disk: ${state.migrations.on_disk_count} files, range ${state.migrations.range}. ${state.migrations.on_disk_note || ''}`);
  p(`- **Applied to the database: ${label(av.status)}** — source \`${av.source}\`, last run ${av.last_run_utc || 'never recorded'}.`);
  if (av.contradiction) { p(); p(`  ${av.contradiction}`); }
  if (av.owner_action) { p(); p(`  *Owner action:* ${av.owner_action}`); }
  p();
  p('Presence in `backend/migrations` is not applied-ness. `release-check`');
  p('reads the filesystem and never connects to a database, so it can never');
  p('settle this question.');
  p();

  p('## Required checks');
  p();
  p('| Check | Command | Status | At SHA | Counts as passed |');
  p('|---|---|---|---|---|');
  for (const ch of state.checks || []) {
    p(`| ${ch.name}${ch.required ? '' : ' *(optional)*'} | \`${ch.command}\` | ${label(ch.status)} | ${ch.observed_at_sha ? `\`${ch.observed_at_sha.slice(0, 7)}\`` : '—'} | ${mark(CHECK_PASSING.includes(ch.status))} |`);
  }
  p();

  p('## Owner evidence');
  p();
  p('Claude Code cannot produce any of these: they require live Stripe, Resend,');
  p('Supabase or production configuration access.');
  p();
  p('| Evidence | Status | Required for | Runbook |');
  p('|---|---|---|---|');
  for (const e of state.owner_evidence || []) {
    p(`| ${e.title} | ${label(e.status)}${EVIDENCE_PASSING.includes(e.status) ? '' : ' — **outstanding**'} | ${(e.required_for || []).join(', ')} | \`${e.runbook}\` |`);
  }
  p();

  p('## Unresolved blockers and accepted risks');
  p();
  p('Accepted is neither closed nor passed. Every item below keeps its real');
  p('status; an acceptance only records that a launch was allowed to proceed');
  p('over it, and never that it was resolved.');
  p();
  const unresolved = (state.blockers || []).filter((b) => b.status === 'open' || b.status === 'accepted');
  if (!unresolved.length) p('None.');
  else {
    p('| Severity | Item | Status | Owner | Closure requirement |');
    p('|---|---|---|---|---|');
    for (const b of unresolved) {
      const status = b.status === 'accepted' ? 'ACCEPTED (not closed)' : 'OPEN';
      p(`| ${b.severity} | ${b.title} | ${status} | ${b.owner} | ${b.closure} |`);
    }
  }
  p();
  // The accepted risks each verdict actually rests on, computed rather than
  // narrated, so a CONDITIONAL GO can never be read as a clean GO.
  for (const track of ['capped_beta', 'public_paid']) {
    const risks = v[track].accepted_risks;
    if (!risks.length) continue;
    const heading = track === 'capped_beta' ? 'Capped beta' : 'Public paid launch';
    p(`**${heading} (${v[track].verdict}) rests on these accepted risks:**`);
    p();
    for (const r of risks) {
      p(`- \`${r.risk_id}\` — ${r.title || r.id} — underlying status **${r.status}**`
        + `${r.severity ? ` (${r.severity})` : ''}, accepted by ${r.accepted_by || 'unknown'}`
        + ` (sources: ${r.sources.join(', ')})`);
    }
    p();
  }

  p('## Rollback');
  p();
  for (const [k, val] of Object.entries(state.rollback || {})) p(`- **${k}:** ${val}`);
  p();

  p('## Superseded documents');
  p();
  p('These remain in the repository as history. None of them is current truth.');
  p();
  for (const d of state.superseded_documents || []) p(`- \`${d.path}\` — ${d.reason}`);
  p();

  p('## Creating a new candidate');
  p();
  for (const step of state.how_to_create_a_new_candidate || []) p(`${step.startsWith('Any commit') ? '\n' : ''}${step}`);
  p();

  return out.join('\n');
}

// --- CLI ------------------------------------------------------------------

function main() {
  const mode = process.argv[2] || 'verify';
  const state = loadState();
  const observed = {
    head_sha: headSha(),
    code_changes: codeChangesSince(state.candidate && state.candidate.sha),
  };

  // Rendered against the pinned candidate, not the live HEAD, so the committed
  // document is deterministic — otherwise every commit after the freeze
  // rewrites it and the sync test fails for a reason unrelated to launch truth.
  const pinned = { head_sha: state.candidate.sha || state.candidate.head_at_generation || observed.head_sha };
  const renderedContent = render(state, pinned);
  // In render mode the active-doc scan checks the ABOUT-TO-BE-WRITTEN rendered
  // view, so a stale on-disk copy cannot block its own regeneration.
  const overrides = mode === 'render'
    ? { [path.relative(ROOT, RENDER_PATH).replace(/\\/g, '/')]: renderedContent }
    : {};
  // v15 SC-05: release verification also fails if an accepted risk is past its
  // review date, or if the app stopped being a pure client SPA (which would make
  // the accepted react-router RSC advisory reachable again).
  const reachability = rscIndicators(collectSourceForRsc()).map(
    (f) => `router reachability: ${f.path} ${f.why} [${f.id}] — the accepted no-RSC risk no longer holds`,
  );
  const problems = [
    ...integrityProblems(state),
    ...documentProblems(state, ROOT, overrides),
    ...reviewProblems(state, Date.now()),
    ...reachability,
  ];

  if (mode === 'render') {
    if (problems.length) {
      console.error('Refusing to render an untrustworthy launch state:');
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    fs.writeFileSync(RENDER_PATH, renderedContent, 'utf8');
    console.log(`Wrote ${path.relative(ROOT, RENDER_PATH)}`);
    process.exit(0);
  }

  if (mode === 'verify') {
    if (problems.length) {
      console.error('\nLaunch-state integrity: FAILED\n');
      for (const p of problems) console.error(`  - ${p}`);
      console.error('');
      process.exit(1);
    }
    console.log('\nLaunch-state integrity: OK — one active launch truth, evidence pinned, verdict recomputed.\n');
    process.exit(0);
  }

  if (mode === 'gate') {
    const v = computeVerdicts(state, observed);
    console.log('\nLaunch gate\n');
    if (problems.length) {
      console.log('  Integrity: FAILED');
      for (const p of problems) console.log(`    - ${p}`);
    } else {
      console.log('  Integrity: OK');
    }
    for (const track of ['capped_beta', 'public_paid']) {
      console.log(`\n  ${track}: ${v[track].verdict}`);
      for (const r of v[track].reasons) console.log(`    - ${r}`);
    }
    console.log('');
    const go = !problems.length && v.capped_beta.verdict === 'GO' && v.public_paid.verdict === 'GO';
    process.exit(go ? 0 : 1);
  }

  // v12 SC-V12-05: fail-closed code-drift detection for the release-candidate
  // workflow. Evidence is pinned to candidate.sha; if any PRODUCT file changed
  // between that commit and HEAD, the evidence no longer describes the shipped
  // code and this exits non-zero. Documentation-only drift (the NON_CODE
  // allowlist) is exempt — and that allowlist can never include product code,
  // which backend/tests/launch-state.test.js enforces.
  if (mode === 'drift') {
    const sha = state.candidate && state.candidate.sha;
    if (!sha) {
      console.log('\nCode drift: no candidate pinned — nothing to compare.\n');
      process.exit(0);
    }
    const changes = observed.code_changes;
    if (changes === null) {
      console.error('\nCode drift: UNKNOWN — git could not diff the candidate against HEAD. Treating as drift.\n');
      process.exit(1);
    }
    if (changes.length === 0) {
      console.log(`\nCode drift: none — HEAD matches candidate ${sha} except for documentation.\n`);
      process.exit(0);
    }
    console.error(`\nCode drift: ${changes.length} product file(s) changed since candidate ${sha} was pinned:`);
    for (const f of changes) console.error(`  - ${f}`);
    console.error('\nEvidence pinned to the old candidate is stale. Cut a new candidate (SC-V12-08).\n');
    process.exit(1);
  }

  console.error(`Unknown mode: ${mode}. Use verify | gate | render | drift.`);
  process.exit(2);
}

if (require.main === module) main();

module.exports = { loadState, documentProblems, render, headSha, codeChangesSince, SUPERSEDED_MARKER };
