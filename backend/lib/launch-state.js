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
const BLOCKER_STATUSES = Object.freeze(['open', 'closed', 'accepted']);

// The closed vocabulary of verdicts. Anything outside this set is not a verdict
// this system knows how to defend, so the manifest may not declare it.
//
//   GO              every required condition for the track is actually met.
//   CONDITIONAL GO  no unaccepted blocker remains, but the launch proceeds over
//                   one or more required conditions that are only bypassed by a
//                   valid accepted_risk — never because they were satisfied.
//   NO-GO           at least one required condition is unmet without a valid
//                   scoped acceptance.
const VERDICTS = Object.freeze(['GO', 'CONDITIONAL GO', 'NO-GO']);

// A risk the owner has decided to ship with. This is NOT a way to make a red
// item green: the item keeps its real status everywhere it is displayed, and
// `accepted` is visibly different from `closed`. What it does is let a launch
// proceed on a stated, attributed decision instead of on a quietly edited fact.
//
// It costs something on purpose — a named person, a date and a rationale that
// survives in the record — because a risk nobody is willing to sign is one
// nobody has actually weighed.
const ACCEPTANCE_FIELDS = Object.freeze(['accepted_by', 'accepted_at_utc', 'rationale']);

function acceptanceProblems(kind, id, acc) {
  if (!isPlainObject(acc)) return [`${kind} ${id}: accepted_risk must be an object`];
  const missing = ACCEPTANCE_FIELDS.filter((f) => !acc[f]);
  const out = missing.map((f) => `${kind} ${id}: accepted risk has no ${f}`);
  if (acc.rationale && String(acc.rationale).trim().length < 40) {
    out.push(`${kind} ${id}: accepted risk needs a real rationale, not a placeholder`);
  }
  for (const track of list(acc.tracks)) {
    if (!VERDICT_TRACKS.includes(track)) out.push(`${kind} ${id}: accepted risk names unknown track ${track}`);
  }
  if (!list(acc.tracks).length) out.push(`${kind} ${id}: accepted risk must name the tracks it applies to`);
  return out;
}

/** True when this item's risk has been accepted for `track`. */
function acceptedFor(item, track) {
  const acc = item && item.accepted_risk;
  return isPlainObject(acc) && list(acc.tracks).includes(track);
}
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
    if (c.accepted_risk) for (const p of acceptanceProblems('check', id, c.accepted_risk)) bad(p);
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
    if (e.accepted_risk) for (const p of acceptanceProblems('evidence', id, e.accepted_risk)) bad(p);
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
    if (!BLOCKER_STATUSES.includes(b.status)) bad(`blocker ${b.id}: status must be one of ${BLOCKER_STATUSES.join(', ')}`);
    if (b.status === 'accepted') for (const p of acceptanceProblems('blocker', b.id, b.accepted_risk)) bad(p);
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
    if (!VERDICTS.includes(declared.verdict)) {
      bad(`verdicts.${track}: unknown verdict ${JSON.stringify(declared.verdict)} (must be one of ${VERDICTS.join(', ')})`);
    } else if (declared.verdict !== computed[track].verdict) {
      bad(`verdicts.${track}: declared ${declared.verdict}, computed ${computed[track].verdict}`);
    }
  }

  return problems;
}

// --- verdict --------------------------------------------------------------

// One accepted-risk entry as it will be reported back to the caller. The item
// keeps its real status — a check that is `skipped` still reads `skipped` here.
// `risk_id` is what makes two records the same logical risk: the P0 blocker and
// the check that measures it are one risk seen from two places, and must be
// counted once.
function acceptedEntry(kind, item) {
  const acc = (item && item.accepted_risk) || {};
  return {
    risk_id: acc.risk_id || `${kind}:${item.id}`,
    kind,
    id: item.id,
    status: item.status,
    severity: item.severity || null,
    title: item.title || item.name || null,
    owner: item.owner || null,
    closure: item.closure || null,
    accepted_by: acc.accepted_by || null,
  };
}

// Fold entries that describe the same logical risk into one. A blocker is the
// canonical face of a risk (it carries the owner and the closure requirement),
// so it wins as the representative; the check and evidence that measure the same
// risk are recorded as additional sources rather than as separate risks.
const RISK_KIND_RANK = Object.freeze({ blocker: 0, check: 1, evidence: 2 });
function dedupeRisks(entries) {
  const byId = new Map();
  for (const e of entries) {
    const ref = `${e.kind}:${e.id}`;
    const cur = byId.get(e.risk_id);
    if (!cur) { byId.set(e.risk_id, { ...e, sources: [ref] }); continue; }
    const sources = cur.sources.includes(ref) ? cur.sources : [...cur.sources, ref];
    if (RISK_KIND_RANK[e.kind] < RISK_KIND_RANK[cur.kind]) {
      byId.set(e.risk_id, { ...e, sources });
    } else {
      cur.sources = sources;
    }
  }
  return [...byId.values()];
}

// Deterministic GO / CONDITIONAL GO / NO-GO per track, with the exact reasons
// and the accepted risks the verdict rests on. Capped beta and an unrestricted
// public paid launch are different risk decisions, so they are computed
// separately and never share a conclusion.
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
    // A later commit invalidates evidence — but only if it could change what
    // the evidence describes. Recording the evidence is itself a commit, so
    // treating every commit as invalidating made a fully-evidenced release
    // unreachable: the act of writing down a GO produced a NO-GO.
    //
    // `code_changes` is supplied by the CLI (git). `undefined` means nobody
    // looked, and `null` means git could not answer — both fall back to the
    // strict rule, because unknown never means safe.
    const codeChanges = observed.code_changes;
    if (Array.isArray(codeChanges) && codeChanges.length === 0) {
      // Documentation-only drift. Evidence still describes the shipped code.
    } else if (Array.isArray(codeChanges)) {
      shared.push(
        `candidate ${candidate.sha} is stale: ${codeChanges.length} code file(s) changed since it was pinned `
        + `(${codeChanges.slice(0, 3).join(', ')}${codeChanges.length > 3 ? ', …' : ''})`,
      );
    } else {
      shared.push(`candidate ${candidate.sha} is stale: HEAD is ${observed.head_sha}`);
    }
  }

  if (!EVIDENCE_PASSING.includes(applied.status)) {
    shared.push(`migrations applied-state is ${applied.status || 'unknown'} (must be verified against the database)`);
  }

  const blocking = blockers.filter((b) => b.severity === 'P0' || b.severity === 'P1');

  const out = {};
  for (const track of VERDICT_TRACKS) {
    const reasons = [...shared];
    // Accepted required conditions bypassed for this track. These never satisfy
    // a condition — they record that the launch proceeds *over* an unmet one.
    // A non-empty list is exactly what separates CONDITIONAL GO from GO.
    const acceptedRaw = [];
    // A required check may be required for both tracks (the default, and what
    // `required: true` alone means) or scoped with `required_for`. Some proof
    // is genuinely a public-launch condition rather than a beta one: a
    // supervised cohort of invited accounts with a named owner watching is a
    // different risk than strangers arriving unannounced. Scoping is a stated
    // decision recorded in the check's note — it is not a way to make a red
    // check disappear, and a check with no `required_for` still blocks both.
    for (const b of blocking) {
      // A P1 is not a capped-beta condition; it only bears on the public launch.
      if (track === 'capped_beta' && b.severity === 'P1') continue;
      if (b.status === 'closed') continue;
      if (b.status === 'accepted') {
        if (acceptedFor(b, track)) acceptedRaw.push(acceptedEntry('blocker', b));
        continue;
      }
      // status === 'open'
      if (acceptedFor(b, track)) { acceptedRaw.push(acceptedEntry('blocker', b)); continue; }
      reasons.push(`open ${b.severity}: ${b.id}`);
    }
    for (const c of checks) {
      if (!c.required) continue;
      const scope = list(c.required_for);
      if (scope.length && !scope.includes(track)) continue;
      if (CHECK_PASSING.includes(c.status)) continue;
      if (acceptedFor(c, track)) { acceptedRaw.push(acceptedEntry('check', c)); continue; }
      reasons.push(`required check ${c.id} is ${c.status}`);
    }
    for (const e of evidence) {
      if (!list(e.required_for).includes(track)) continue;
      if (EVIDENCE_PASSING.includes(e.status)) continue;
      if (acceptedFor(e, track)) { acceptedRaw.push(acceptedEntry('evidence', e)); continue; }
      reasons.push(`owner evidence ${e.id} is ${e.status}`);
    }

    const accepted_risks = dedupeRisks(acceptedRaw);
    let verdict;
    if (reasons.length) verdict = 'NO-GO';
    else if (accepted_risks.length) verdict = 'CONDITIONAL GO';
    else verdict = 'GO';
    out[track] = { verdict, reasons, accepted_risks };
  }
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  BLOCKER_STATUSES,
  acceptedFor,
  STATUSES,
  CHECK_PASSING,
  EVIDENCE_PASSING,
  SEVERITIES,
  VERDICTS,
  VERDICT_TRACKS,
  integrityProblems,
  computeVerdicts,
};
