// ---------------------------------------------------------------------------
// v11 SC-00 — the canonical launch state.
//
// One machine-checkable record of what is true about a release candidate, so
// two documents can never disagree about it again. Pure functions over a plain
// object: no I/O, no git, no database — the CLI (backend/scripts/launch-state.js)
// supplies observed reality and this module decides what it means.
//
// Two distinct questions, deliberately kept apart:
//
//   integrity — is the manifest itself trustworthy? (vocabulary, evidence
//               pinned to the candidate, declared verdict matches computed)
//   verdict   — given a trustworthy manifest, may we ship?
//
// CI runs the first (deterministic, secret-free, must stay green). The release
// gate runs both. A verdict is never "pass by default": every status outside
// the explicit passing set — including `unknown` — blocks.
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 'launch-state-1';

// The full evidence vocabulary. These are NOT interchangeable: `configured`
// means an env var is present, `live_rehearsed` means a human performed the
// action against production, `observed` means it held over time. Collapsing
// them is how a release reads as verified on evidence nobody collected.
const STATUSES = Object.freeze([
  'not_run',
  'skipped',
  'failed',
  'passed_locally',
  'passed_ci',
  'configured',
  'live_rehearsed',
  'observed',
  'unknown',
]);

// A required automated check may only count as satisfied by an actual run.
const CHECK_PASSING = Object.freeze(['passed_ci', 'passed_locally']);
// Owner evidence describes the live system; local runs cannot satisfy it.
const EVIDENCE_PASSING = Object.freeze(['live_rehearsed', 'observed']);

const SEVERITIES = Object.freeze(['P0', 'P1', 'P2']);
const VERDICT_TRACKS = Object.freeze(['capped_beta', 'public_paid']);

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

// --- integrity ------------------------------------------------------------

// Structural problems that make the manifest untrustworthy as a source of
// truth. Returns [] when the document can be believed — which says nothing
// about whether the release may ship.
function integrityProblems(state) {
  const problems = [];
  const bad = (msg) => problems.push(msg);

  if (!isPlainObject(state)) return ['launch state is not an object'];
  if (state.schema_version !== SCHEMA_VERSION) {
    bad(`schema_version must be "${SCHEMA_VERSION}" (found ${JSON.stringify(state.schema_version)})`);
  }

  const candidate = isPlainObject(state.candidate) ? state.candidate : null;
  if (!candidate) bad('candidate block missing');
  const sha = candidate && typeof candidate.sha === 'string' ? candidate.sha : null;

  // Every claim must be expressible in the shared vocabulary, or the
  // distinctions the vocabulary exists to preserve are gone.
  const checkIds = new Set();
  for (const c of list(state.checks)) {
    const id = c && c.id;
    if (!id) { bad('a check has no id'); continue; }
    if (checkIds.has(id)) bad(`duplicate check id: ${id}`);
    checkIds.add(id);
    if (!STATUSES.includes(c.status)) bad(`check ${id}: unknown status ${JSON.stringify(c.status)}`);
    if (typeof c.required !== 'boolean') bad(`check ${id}: required must be a boolean`);
    for (const track of list(c.required_for)) {
      if (!VERDICT_TRACKS.includes(track)) bad(`check ${id}: unknown verdict track ${track}`);
    }
    // Scoping a check to fewer tracks is a risk decision, so it must be argued
    // in writing next to the check itself.
    if (list(c.required_for).length && list(c.required_for).length < VERDICT_TRACKS.length && !c.scope_rationale) {
      bad(`check ${id}: required_for narrows the tracks but gives no scope_rationale`);
    }

    if (CHECK_PASSING.includes(c.status)) {
      // A pass with nothing behind it is a headline, not evidence.
      if (!c.evidence) bad(`check ${id}: claims ${c.status} but carries no evidence reference`);
      if (!c.observed_at_sha) bad(`check ${id}: claims ${c.status} but is not pinned to a SHA`);
      else if (sha && c.observed_at_sha !== sha) {
        bad(`check ${id}: evidence is from ${c.observed_at_sha}, candidate is ${sha}`);
      }
    }
  }

  const evidenceIds = new Set();
  for (const e of list(state.owner_evidence)) {
    const id = e && e.id;
    if (!id) { bad('an owner evidence item has no id'); continue; }
    if (evidenceIds.has(id)) bad(`duplicate owner evidence id: ${id}`);
    evidenceIds.add(id);
    if (!STATUSES.includes(e.status)) bad(`evidence ${id}: unknown status ${JSON.stringify(e.status)}`);
    if (EVIDENCE_PASSING.includes(e.status) && !e.evidence_ref) {
      bad(`evidence ${id}: claims ${e.status} but carries no evidence reference`);
    }
    for (const track of list(e.required_for)) {
      if (!VERDICT_TRACKS.includes(track)) bad(`evidence ${id}: unknown verdict track ${track}`);
    }
  }

  for (const b of list(state.blockers)) {
    if (!b || !b.id) { bad('a blocker has no id'); continue; }
    if (!SEVERITIES.includes(b.severity)) bad(`blocker ${b.id}: unknown severity ${JSON.stringify(b.severity)}`);
    if (!['open', 'closed'].includes(b.status)) bad(`blocker ${b.id}: status must be open or closed`);
  }

  const mig = isPlainObject(state.migrations) ? state.migrations : null;
  if (!mig) bad('migrations block missing');
  else {
    const av = isPlainObject(mig.applied_verification) ? mig.applied_verification : null;
    if (!av) bad('migrations.applied_verification missing');
    else {
      if (!STATUSES.includes(av.status)) bad(`migrations.applied_verification: unknown status ${JSON.stringify(av.status)}`);
      // Applied-ness is a property of a database, so it may only be claimed
      // from a run against one — never inferred from files in the repository.
      if (EVIDENCE_PASSING.includes(av.status)) {
        if (!av.source) bad('migrations.applied_verification: claims verification with no source');
        if (!av.last_run_utc) bad('migrations.applied_verification: claims verification with no run timestamp');
      }
    }
  }

  // The declared verdict is recomputed from the same data; a mismatch means
  // someone edited the conclusion without editing the facts.
  const computed = computeVerdicts(state);
  for (const track of VERDICT_TRACKS) {
    const declared = isPlainObject(state.verdicts) ? state.verdicts[track] : null;
    if (!isPlainObject(declared)) { bad(`verdicts.${track} missing`); continue; }
    if (declared.verdict !== computed[track].verdict) {
      bad(`verdicts.${track}: declared ${declared.verdict}, computed ${computed[track].verdict}`);
    }
  }

  return problems;
}

// --- verdict --------------------------------------------------------------

// Deterministic GO/NO-GO per track, with the exact reasons. Capped beta and an
// unrestricted public paid launch are different risk decisions, so they are
// computed separately and never share a conclusion.
function computeVerdicts(state, observed = {}) {
  const candidate = isPlainObject(state && state.candidate) ? state.candidate : {};
  const checks = list(state && state.checks);
  const evidence = list(state && state.owner_evidence);
  const blockers = list(state && state.blockers);
  const mig = isPlainObject(state && state.migrations) ? state.migrations : {};
  const applied = isPlainObject(mig.applied_verification) ? mig.applied_verification : {};

  const shared = [];

  if (!candidate.sha) {
    shared.push('no release candidate is pinned (candidate.sha is null)');
  } else if (observed.head_sha && observed.head_sha !== candidate.sha) {
    // A later commit invalidates every piece of evidence collected before it.
    shared.push(`candidate ${candidate.sha} is stale: HEAD is ${observed.head_sha}`);
  }

  if (!EVIDENCE_PASSING.includes(applied.status)) {
    shared.push(`migrations applied-state is ${applied.status || 'unknown'} (must be verified against the database)`);
  }

  for (const b of blockers) {
    if (b.status === 'open' && (b.severity === 'P0' || b.severity === 'P1')) {
      shared.push(`open ${b.severity}: ${b.id}`);
    }
  }

  const out = {};
  for (const track of VERDICT_TRACKS) {
    const reasons = shared.filter((r) => {
      // P1s block the public paid launch but not a capped, supported beta.
      if (track === 'capped_beta' && r.startsWith('open P1:')) return false;
      return true;
    });
    // A required check may be required for both tracks (the default, and what
    // `required: true` alone means) or scoped with `required_for`. Some proof
    // is genuinely a public-launch condition rather than a beta one: a
    // supervised cohort of invited accounts with a named owner watching is a
    // different risk than strangers arriving unannounced. Scoping is a stated
    // decision recorded in the check's note — it is not a way to make a red
    // check disappear, and a check with no `required_for` still blocks both.
    for (const c of checks) {
      if (!c.required) continue;
      const scope = list(c.required_for);
      if (scope.length && !scope.includes(track)) continue;
      if (!CHECK_PASSING.includes(c.status)) {
        reasons.push(`required check ${c.id} is ${c.status}`);
      }
    }
    for (const e of evidence) {
      if (!list(e.required_for).includes(track)) continue;
      if (!EVIDENCE_PASSING.includes(e.status)) {
        reasons.push(`owner evidence ${e.id} is ${e.status}`);
      }
    }
    out[track] = { verdict: reasons.length ? 'NO-GO' : 'GO', reasons };
  }
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  STATUSES,
  CHECK_PASSING,
  EVIDENCE_PASSING,
  SEVERITIES,
  VERDICT_TRACKS,
  integrityProblems,
  computeVerdicts,
};
