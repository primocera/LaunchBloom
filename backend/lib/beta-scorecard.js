// ---------------------------------------------------------------------------
// SC-P1-12 — Activation analytics and capped-beta value scorecard.
//
// This module is the operator-facing layer on top of the existing analytics
// ledger (lib/analytics.js). It adds three things the pack asks for that the
// ledger alone does not encode:
//
//   1. A documented VALUE-LOOP event model with an explicit schema/version,
//      environment, source, timestamp and a success/failure reason taxonomy,
//      plus a validator that rejects any envelope carrying content or PII.
//   2. An auditable staff/test/demo exclusion rule so beta KPIs measure real
//      ICP users, not the team. The rule is data (env + a pure predicate), so
//      it can be reviewed and reproduced — it never silently drops rows.
//   3. A weekly cohort scorecard whose funnel rates all share ONE denominator
//      (the activated cohort), that never inflates a milestone on a retried
//      event (distinct subjects), and whose gates are marked as HYPOTHESES.
//
// Everything here is pure and DB-free so the numbers are testable and
// reconcilable to the ledger by hand. Nothing computed here may be shown to a
// customer or used as public proof.
// ---------------------------------------------------------------------------

// Bump when the envelope shape below changes in a backwards-incompatible way.
const SCHEMA_VERSION = 'v13.1';

// Envelope fields every captured beta event must carry. Content and identity
// deliberately absent: analytics is pseudonymous (ids only), never text.
const REQUIRED_ENVELOPE_FIELDS = ['schema_version', 'event', 'ts', 'env', 'source'];

// Fields that must NEVER appear in an event envelope or its properties. This is
// a hard fail in validateEventEnvelope (not a silent redaction) so a fixture or
// a new call site that leaks content is caught in tests, not in production.
const FORBIDDEN_FIELD = /pass|token|secret|api[_-]?key|session|prompt|content|body|copy|caption|headline|subject_line|email|address|phone|full_?name|brand_voice|offer_text|brief_text|answer/i;

// The success/failure reason taxonomy for *_failed events. Anything outside the
// taxonomy is coerced to 'other' so free-text reasons can never leak.
const FAILURE_REASONS = new Set([
  'timeout',
  'model_error',
  'rate_limited',
  'invalid_output',
  'plan_limit',
  'spend_ceiling',
  'validation_failed',
  'cancelled',
  'other',
]);

// The recognised runtime environments and event sources. Anything else is
// invalid — an unknown env would silently pollute production KPIs.
const ENVIRONMENTS = new Set(['production', 'staging', 'development', 'test']);
const SOURCES = new Set(['web_app', 'backend', 'webhook', 'job']);

// ── The capped-beta VALUE LOOP, in order. `canonical` is the ledger event that
// confirms the milestone server-side; `null` means the milestone is not yet
// instrumented and the step reports `unavailable` rather than a misleading zero
// (same honesty rule as lib/cohort.js). `scope` decides what a "distinct
// subject" is, so a retried event can never inflate the count. ──
const VALUE_LOOP = [
  { step: 'brand_profile_completed', canonical: 'minimum_profile_reached', scope: 'workspace',
    question: 'Do they give us enough of a brand to work with?' },
  { step: 'campaign_brief_completed', canonical: 'brief_approved', scope: 'campaign',
    question: 'Do they commit to a campaign?' },
  { step: 'first_generation_completed', canonical: 'first_generation', scope: 'workspace',
    question: 'Do they successfully produce anything?' },
  { step: 'first_asset_reviewed', canonical: 'first_finding_resolved', scope: 'workspace',
    question: 'Do they engage with review, not just generation?' },
  { step: 'first_asset_ready_to_export', canonical: 'first_asset_ready', scope: 'workspace',
    question: 'Do they finish an asset to their own bar?' },
  { step: 'campaign_reached_ready', canonical: 'campaign_completed', scope: 'campaign',
    question: 'Do they complete a whole campaign? (the paid job)' },
  { step: 'first_export', canonical: 'first_asset_exported', scope: 'workspace',
    question: 'Do they take real value out of the tool? (the value moment)' },
  { step: 'second_campaign_created', canonical: 'campaign_created', scope: 'workspace', derive: 'repeat_campaign',
    question: 'Do they come back and do it again? (repeat value)' },
  { step: 'workspace_returned', canonical: 'day7_returned', scope: 'workspace',
    question: 'Do they return across days, not one sitting? (retention)' },
];

// ── Provisional expand/iterate/stop gates. These are HYPOTHESES chosen before
// collecting results, not benchmarks. `hypothesis: true` is load-bearing: it is
// asserted in tests and rendered in the scorecard so no gate is ever quoted as
// a market fact. ──
const PROVISIONAL_THRESHOLDS = [
  { key: 'reviewed_asset_rate', gate: '>= 60% of activated users reach a reviewed asset',
    rationale: 'If most activated users never review, the coordinated-campaign value is unproven.', hypothesis: true },
  { key: 'generation_failure_rate', gate: '<= 5% of generation attempts fail',
    rationale: 'Above this, users blame the product for technical failure, not fit.', hypothesis: true },
  { key: 'campaign_completion_rate', gate: '>= 40% of activated users reach campaign-ready',
    rationale: 'The paid job is a finished campaign, not a single asset.', hypothesis: true },
  { key: 'second_campaign_rate', gate: '>= 25% of activated users start a second campaign',
    rationale: 'Repeat use is the only durable signal of ongoing value.', hypothesis: true },
  { key: 'billing_incident', gate: 'zero billing-severity incidents in the window',
    rationale: 'A single mischarge or entitlement failure blocks expansion regardless of activation.', hypothesis: true },
  { key: 'qualitative_confirmation', gate: 'interviews confirm the coordinated campaign saves meaningful rework',
    rationale: 'Numbers can rise on novelty; only interviews confirm real saved work.', hypothesis: true },
];

// Below this many subjects in a denominator, rates are suppressed. A 10–20 user
// beta will trip this often — that is correct, most weeks are not conclusive.
const MIN_COHORT = 5;

/**
 * Auditable staff/test/demo exclusion. Pure and reproducible: the caller passes
 * the roster (from env), we return whether the subject is excluded AND why, so
 * an operator can audit exactly which accounts left the KPI base and on what
 * rule. Never throws; unknown input is simply "not excluded".
 *
 * roster: { emails:Set|Array, domains:Set|Array, workspaceIds:Set|Array, userIds:Set|Array }
 */
function classifyAccount({ email = null, userId = null, workspaceId = null } = {}, roster = {}) {
  const emails = new Set([...(roster.emails || [])].map((e) => String(e).toLowerCase()));
  const domains = new Set([...(roster.domains || [])].map((d) => String(d).toLowerCase().replace(/^@/, '')));
  const workspaceIds = new Set([...(roster.workspaceIds || [])].map(String));
  const userIds = new Set([...(roster.userIds || [])].map(String));

  const lowerEmail = email ? String(email).toLowerCase() : null;
  if (lowerEmail && emails.has(lowerEmail)) return { excluded: true, reason: 'staff_email' };
  if (lowerEmail && lowerEmail.includes('@')) {
    const domain = lowerEmail.split('@')[1];
    if (domains.has(domain)) return { excluded: true, reason: 'staff_domain' };
  }
  if (workspaceId != null && workspaceIds.has(String(workspaceId))) return { excluded: true, reason: 'staff_workspace' };
  if (userId != null && userIds.has(String(userId))) return { excluded: true, reason: 'staff_user' };
  return { excluded: false, reason: null };
}

/** Build the exclusion roster from env once, so the rule is configuration. */
function rosterFromEnv(env = process.env) {
  const split = (v) => String(v || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return {
    emails: split(env.STAFF_EMAILS || env.ADMIN_EMAILS),
    domains: split(env.STAFF_EMAIL_DOMAINS),
    workspaceIds: split(env.STAFF_WORKSPACE_IDS),
    userIds: split(env.STAFF_USER_IDS),
  };
}

/**
 * Validate a beta event envelope. Returns { ok, errors[] }. Rejects on:
 *   • any missing required envelope field;
 *   • an unknown env / source / (for *_failed) failure reason;
 *   • ANY forbidden (content/PII) key, at the top level or inside properties.
 * Never throws — a malformed input degrades to ok:false with reasons.
 */
function validateEventEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, errors: ['envelope must be an object'] };
  }
  for (const f of REQUIRED_ENVELOPE_FIELDS) {
    if (envelope[f] == null || envelope[f] === '') errors.push(`missing required field: ${f}`);
  }
  if (envelope.schema_version && envelope.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  }
  if (envelope.env && !ENVIRONMENTS.has(envelope.env)) errors.push(`unknown env: ${envelope.env}`);
  if (envelope.source && !SOURCES.has(envelope.source)) errors.push(`unknown source: ${envelope.source}`);
  if (typeof envelope.event === 'string' && /_failed$/.test(envelope.event)) {
    const reason = envelope.properties && envelope.properties.reason;
    if (reason != null && !FAILURE_REASONS.has(reason)) errors.push(`failure reason not in taxonomy: ${reason}`);
  }

  const scan = (obj, where) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (FORBIDDEN_FIELD.test(k)) errors.push(`forbidden field '${k}' in ${where}`);
      if (typeof v === 'string' && v.length > 200) errors.push(`value for '${k}' in ${where} is too long (likely content)`);
    }
  };
  // Envelope keys other than the known metadata are scanned as potential leaks.
  scan(
    Object.fromEntries(Object.entries(envelope).filter(([k]) => !REQUIRED_ENVELOPE_FIELDS.includes(k) && k !== 'properties' && k !== 'user_id' && k !== 'workspace_id')),
    'envelope',
  );
  scan(envelope.properties, 'properties');

  return { ok: errors.length === 0, errors };
}

/** Stamp a compliant envelope. Callers pass only categorical properties. */
function buildEnvelope(event, { source = 'backend', env, properties = {} } = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    event: String(event),
    ts: new Date().toISOString(),
    env: env || process.env.NODE_ENV || 'development',
    source,
    properties: properties && typeof properties === 'object' && !Array.isArray(properties) ? properties : {},
  };
}

/**
 * Distinct subjects that fired `canonical`, keyed by the milestone's scope so a
 * user firing the same event twice (retry, webhook redelivery, re-post) counts
 * once. Excluded (staff/test) subjects are removed first, using the same roster.
 */
function distinctSubjects(rows, canonical, scope, { roster = {}, excludedWorkspaces = new Set() } = {}) {
  const key = scope === 'campaign' ? 'campaign_id' : 'workspace_id';
  const set = new Set();
  for (const r of rows) {
    if (!r || r.event !== canonical) continue;
    if (r.workspace_id && excludedWorkspaces.has(String(r.workspace_id))) continue;
    if (classifyAccount({ userId: r.user_id, workspaceId: r.workspace_id }, roster).excluded) continue;
    const id = r[key] || r.workspace_id || r.user_id;
    if (id) set.add(String(id));
  }
  return set;
}

/**
 * SC-95-03: distinct workspaces that created at least `minCount` DISTINCT
 * campaigns. `campaign_created` is emitted once per real persisted campaign
 * (deduped per campaign id at write time), so counting distinct campaign ids
 * per workspace measures genuine repeat use — a retried create or a template
 * clone of the same campaign cannot inflate it. Staff/test subjects excluded
 * with the same auditable roster as every other milestone.
 */
function workspacesWithRepeatCampaigns(rows, minCount = 2, { roster = {}, excludedWorkspaces = new Set() } = {}) {
  const perWorkspace = new Map(); // workspace_id -> Set(distinct campaign id)
  for (const r of rows) {
    if (!r || r.event !== 'campaign_created') continue;
    const ws = r.workspace_id;
    if (!ws || excludedWorkspaces.has(String(ws))) continue;
    if (classifyAccount({ userId: r.user_id, workspaceId: ws }, roster).excluded) continue;
    // Prefer the explicit campaign id; fall back to the per-campaign dedupe key
    // (also unique per campaign) so a row without properties still counts once.
    const cid = (r.properties && r.properties.campaign_id) || r.campaign_id || r.dedupe_key;
    if (!cid) continue;
    if (!perWorkspace.has(String(ws))) perWorkspace.set(String(ws), new Set());
    perWorkspace.get(String(ws)).add(String(cid));
  }
  const set = new Set();
  for (const [ws, campaigns] of perWorkspace) if (campaigns.size >= minCount) set.add(ws);
  return set;
}

// SC-95-04: the handoff feedback categories (mirrors routes/feedback.js ALLOWED).
// CATEGORIES only — the free-text note is never read here, aggregated, or logged.
const FEEDBACK_CATEGORIES = Object.freeze({
  job_done: ['full_campaign', 'part_of_campaign', 'single_asset', 'nothing_usable'],
  manual_work: ['almost_none', 'light_editing', 'heavy_editing', 'rewrote_most'],
  price_view: ['worth_more', 'about_right', 'too_high', 'would_not_pay'],
});

/**
 * SC-95-04: safe aggregate of post-handoff feedback for the canonical scorecard.
 * Reads only `feedback_submitted` (moment=handoff) analytics events — categories
 * and ids, never the note. Denominators: respondents (distinct workspaces that
 * answered) over eligible (distinct workspaces that exported a handoff, i.e.
 * were asked). The reduced-rework claim is BLOCKED by default and only supported
 * once enough respondents report low manual work and zero nothing_usable — so
 * the product cannot claim "reduced rework" until the evidence supports it.
 */
function handoffFeedback(rows, { roster = {}, excludedWorkspaces = new Set(), minCohort = MIN_COHORT } = {}) {
  const eligible = distinctSubjects(rows, 'handoff_exported', 'workspace', { roster, excludedWorkspaces }).size;
  const counts = {};
  for (const cat of Object.keys(FEEDBACK_CATEGORIES)) {
    counts[cat] = {};
    for (const v of FEEDBACK_CATEGORIES[cat]) counts[cat][v] = 0;
  }
  const respWs = new Set();
  for (const r of rows) {
    if (!r || r.event !== 'feedback_submitted') continue;
    const p = r.properties || {};
    if (p.moment !== 'handoff') continue;
    const ws = r.workspace_id;
    if (!ws || excludedWorkspaces.has(String(ws))) continue;
    if (classifyAccount({ userId: r.user_id, workspaceId: ws }, roster).excluded) continue;
    if (respWs.has(String(ws))) continue; // dedupe per workspace (belt to the upsert brace)
    respWs.add(String(ws));
    for (const cat of Object.keys(FEEDBACK_CATEGORIES)) {
      const v = p[cat];
      if (v && FEEDBACK_CATEGORIES[cat].includes(v)) counts[cat][v] += 1;
    }
  }
  const respondents = respWs.size;
  const state = respondents === 0 ? 'no_data' : (respondents < minCohort ? 'insufficient_data' : 'reported');
  const response_rate = eligible > 0 ? +((respondents / eligible) * 100).toFixed(1) : null;

  const mw = counts.manual_work;
  const mwAnswered = mw.almost_none + mw.light_editing + mw.heavy_editing + mw.rewrote_most;
  const heavyOrRewrote = mw.heavy_editing + mw.rewrote_most;
  const heavy_or_rewrote_rate = mwAnswered > 0 ? +((heavyOrRewrote / mwAnswered) * 100).toFixed(1) : null;
  const nothing_usable_count = counts.job_done.nothing_usable;
  const reduced_rework_claim_supported = state === 'reported'
    && mwAnswered >= minCohort
    && heavy_or_rewrote_rate != null && heavy_or_rewrote_rate < 50
    && nothing_usable_count === 0;

  return {
    state,
    respondents,
    eligible,
    response_rate,
    counts,
    heavy_or_rewrote_rate,
    nothing_usable_count,
    reduced_rework_claim_supported,
    note: 'Categories only; free-text notes are never aggregated. The reduced-rework claim stays blocked until respondents, low manual work and interviews support it.',
  };
}

/**
 * The weekly operator scorecard for the capped beta.
 *
 * `rows` are ledger rows: { event, user_id, workspace_id, campaign_id,
 * created_at, properties } — ids/timestamps/categorical only, never content.
 *
 * Denominator rule (acceptance criterion): every funnel rate is measured
 * against ONE base — the activated cohort (distinct workspaces that completed a
 * brand profile). Mixing denominators is how funnels lie, so we don't.
 */
function computeScorecard(rows = [], { window = null, roster = {}, minCohort = MIN_COHORT, excludedWorkspaces = new Set(), dataAvailable = true } = {}) {
  // SC-95-03: an analytics READ FAILURE is UNAVAILABLE, never zero. The operator
  // must see "we could not measure this window" (which blocks expansion), not a
  // misleading empty cohort that looks like a real no-activity week.
  if (dataAvailable === false) {
    return {
      window,
      schema_version: SCHEMA_VERSION,
      data_available: false,
      cohort_size: null,
      min_cohort: minCohort,
      reportable: false,
      activation_denominator: 'distinct workspaces with a completed brand profile',
      steps: VALUE_LOOP.map((def) => ({
        step: def.step, question: def.question, canonical: def.canonical || null,
        numerator: null, denominator: null, value: null, state: 'unavailable',
      })),
      derived: {},
      handoff_feedback: { state: 'unavailable', respondents: null, eligible: null, response_rate: null, counts: {}, reduced_rework_claim_supported: false },
      thresholds: PROVISIONAL_THRESHOLDS,
      disclaimer:
        'Analytics read FAILED for this window — every metric is UNAVAILABLE, not zero. ' +
        'Do not expand or change the product on an unavailable read.',
    };
  }

  const safeRows = Array.isArray(rows) ? rows : [];
  const opts = { roster, excludedWorkspaces };

  // The activated cohort = distinct workspaces that completed a brand profile.
  // This is the single denominator for every activation-funnel rate below.
  const activated = distinctSubjects(safeRows, 'minimum_profile_reached', 'workspace', opts);
  const cohort = activated.size;
  const reportable = cohort >= minCohort;

  const rate = (reached) => {
    if (cohort === 0) return { numerator: reached, denominator: 0, value: null, state: 'no_data' };
    if (!reportable) return { numerator: reached, denominator: cohort, value: null, state: 'insufficient_data' };
    return { numerator: reached, denominator: cohort, value: +((reached / cohort) * 100).toFixed(1), state: 'reported' };
  };

  const steps = VALUE_LOOP.map((def) => {
    if (def.derive === 'repeat_campaign') {
      // SC-95-03: repeat value = distinct workspaces with ≥2 distinct campaigns,
      // measured against the SAME activated-cohort denominator as every other
      // rate. No longer 'unavailable'.
      const reached = workspacesWithRepeatCampaigns(safeRows, 2, opts).size;
      return {
        step: def.step, question: def.question, canonical: def.canonical, ...rate(reached),
        definition: 'distinct activated workspaces that created ≥2 distinct campaigns (server-confirmed campaign_created, deduped per campaign)',
      };
    }
    if (!def.canonical) {
      return {
        step: def.step, question: def.question, canonical: null,
        numerator: null, denominator: cohort, value: null, state: 'unavailable',
        note: 'Not instrumented yet — fires no server-confirmed event, so it cannot be measured.',
      };
    }
    const reached = distinctSubjects(safeRows, def.canonical, def.scope, opts).size;
    return { step: def.step, question: def.question, canonical: def.canonical, ...rate(reached) };
  });

  const stepValue = (stepKey) => (steps.find((s) => s.step === stepKey) || {}).value ?? null;

  // Generation failure rate (technical quality, kept separate from product fit).
  // Attempts = completed + failed events; categorical only.
  let genCompleted = 0;
  let genFailed = 0;
  const failureByStudio = {};
  for (const r of safeRows) {
    if (!r || typeof r !== 'object') continue;
    if (r.workspace_id && excludedWorkspaces.has(String(r.workspace_id))) continue;
    if (classifyAccount({ userId: r.user_id, workspaceId: r.workspace_id }, roster).excluded) continue;
    if (r.event === 'first_generation_completed' || r.event === 'first_generation') genCompleted++;
    if (r.event === 'first_generation_failed') {
      genFailed++;
      const studio = (r.properties && r.properties.studio) || 'unknown';
      failureByStudio[studio] = (failureByStudio[studio] || 0) + 1;
    }
  }
  const attempts = genCompleted + genFailed;

  return {
    window,
    schema_version: SCHEMA_VERSION,
    data_available: true,
    cohort_size: cohort,
    min_cohort: minCohort,
    reportable,
    activation_denominator: 'distinct workspaces with a completed brand profile',
    steps,
    derived: {
      // Every rate below shares the activated-cohort denominator (steps above),
      // so they are mutually comparable.
      reviewed_asset_rate: stepValue('first_asset_reviewed'),
      campaign_completion_rate: stepValue('campaign_reached_ready'),
      export_rate: stepValue('first_export'),
      second_campaign_rate: stepValue('second_campaign_created'),
      workspace_return_rate: stepValue('workspace_returned'),
      generation_failure_rate: attempts > 0 ? +((genFailed / attempts) * 100).toFixed(1) : null,
      generation_attempts: attempts,
      failure_by_studio: failureByStudio,
    },
    // SC-95-04: neutral evidence about manual rework and price value, so the
    // "coordinated handoff reduces rework" claim is tied to data, not asserted.
    handoff_feedback: handoffFeedback(safeRows, { roster, excludedWorkspaces, minCohort }),
    thresholds: PROVISIONAL_THRESHOLDS,
    disclaimer:
      'Internal decision aid for the capped beta. Thresholds are pre-registered HYPOTHESES, ' +
      'not benchmarks or market facts. Not statistically significant at beta scale; never shown to customers.',
  };
}

module.exports = {
  SCHEMA_VERSION,
  REQUIRED_ENVELOPE_FIELDS,
  FORBIDDEN_FIELD,
  FAILURE_REASONS,
  ENVIRONMENTS,
  SOURCES,
  VALUE_LOOP,
  PROVISIONAL_THRESHOLDS,
  MIN_COHORT,
  classifyAccount,
  rosterFromEnv,
  validateEventEnvelope,
  buildEnvelope,
  distinctSubjects,
  workspacesWithRepeatCampaigns,
  FEEDBACK_CATEGORIES,
  handoffFeedback,
  computeScorecard,
};
