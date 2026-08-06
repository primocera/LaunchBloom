// SC-P1-12 — activation analytics + capped-beta value scorecard.
//
// These tests pin the four contracts the pack requires: (1) the envelope schema
// (required/forbidden fields), (2) retries do not inflate milestones, (3) no
// content/PII in captured payload fixtures, (4) funnel rates share one
// denominator — plus that the module never throws (analytics failure isolation).

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SCHEMA_VERSION,
  VALUE_LOOP,
  PROVISIONAL_THRESHOLDS,
  classifyAccount,
  validateEventEnvelope,
  buildEnvelope,
  computeScorecard,
} = require('../lib/beta-scorecard');

const roster = { emails: ['staff@scalvya.com'], domains: ['scalvya.com'], workspaceIds: ['ws-staff'], userIds: [] };

// A clean, PII-free fixture for an activated ICP cohort of 6 workspaces, all
// reaching a reviewed asset; ws1/ws2 retry milestones to prove dedup.
function fixture() {
  const t = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const ws = (n) => `ws${n}`;
  const rows = [];
  for (let i = 1; i <= 6; i++) {
    rows.push({ event: 'minimum_profile_reached', user_id: `u${i}`, workspace_id: ws(i), created_at: t(100) });
    rows.push({ event: 'first_finding_resolved', user_id: `u${i}`, workspace_id: ws(i), created_at: t(50) });
  }
  // Only 3 of 6 complete a campaign; only 2 export.
  for (const i of [1, 2, 3]) rows.push({ event: 'campaign_completed', user_id: `u${i}`, campaign_id: `c${i}`, workspace_id: ws(i), created_at: t(30) });
  for (const i of [1, 2]) rows.push({ event: 'first_asset_exported', user_id: `u${i}`, workspace_id: ws(i), created_at: t(20) });
  // Retries / redeliveries of already-counted milestones (must NOT inflate).
  rows.push({ event: 'minimum_profile_reached', user_id: 'u1', workspace_id: ws(1), created_at: t(99) });
  rows.push({ event: 'first_finding_resolved', user_id: 'u1', workspace_id: ws(1), created_at: t(49) });
  rows.push({ event: 'first_asset_exported', user_id: 'u2', workspace_id: ws(2), created_at: t(19) });
  // A staff account that must be excluded entirely from KPIs.
  rows.push({ event: 'minimum_profile_reached', user_id: 'u-staff', workspace_id: 'ws-staff', created_at: t(90) });
  rows.push({ event: 'first_finding_resolved', user_id: 'u-staff', workspace_id: 'ws-staff', created_at: t(40) });
  // Generation attempts: 18 completed, 2 failed across two studios.
  for (let i = 0; i < 18; i++) rows.push({ event: 'first_generation_completed', user_id: 'u1', workspace_id: ws(1), created_at: t(60) });
  rows.push({ event: 'first_generation_failed', user_id: 'u1', workspace_id: ws(1), created_at: t(60), properties: { studio: 'email', reason: 'timeout' } });
  rows.push({ event: 'first_generation_failed', user_id: 'u2', workspace_id: ws(2), created_at: t(60), properties: { studio: 'website', reason: 'model_error' } });
  return rows;
}

// ── (1) Schema: required + forbidden fields ─────────────────────────────────
test('envelope requires schema_version, event, ts, env, source', () => {
  const good = buildEnvelope('first_export', { source: 'backend', env: 'production', properties: { studio: 'email' } });
  assert.equal(good.schema_version, SCHEMA_VERSION);
  assert.deepEqual(validateEventEnvelope(good), { ok: true, errors: [] });

  const bad = validateEventEnvelope({ event: 'first_export' });
  assert.equal(bad.ok, false);
  for (const f of ['schema_version', 'ts', 'env', 'source']) {
    assert.ok(bad.errors.some((e) => e.includes(f)), `should flag missing ${f}`);
  }
});

test('envelope rejects unknown env, source and off-taxonomy failure reason', () => {
  assert.equal(validateEventEnvelope(buildEnvelope('x', { env: 'prod', source: 'backend' })).ok, false); // env must be "production"
  assert.equal(validateEventEnvelope(buildEnvelope('x', { env: 'production', source: 'browser' })).ok, false);
  const badReason = buildEnvelope('first_generation_failed', { env: 'production', source: 'backend', properties: { reason: 'because_it_broke' } });
  assert.equal(validateEventEnvelope(badReason).ok, false);
  const okReason = buildEnvelope('first_generation_failed', { env: 'production', source: 'backend', properties: { reason: 'timeout' } });
  assert.equal(validateEventEnvelope(okReason).ok, true);
});

// ── (3) No content / PII in captured payload fixtures ───────────────────────
test('any forbidden content/PII key fails validation, at top level or in properties', () => {
  const leaks = [
    { properties: { email: 'a@b.com' } },
    { properties: { headline: 'Buy now' } },
    { properties: { brief_text: 'our launch' } },
    { properties: { brand_voice: 'playful' } },
    { user_content: 'anything' },
  ];
  for (const extra of leaks) {
    const env = { ...buildEnvelope('first_export', { env: 'production', source: 'backend' }), ...extra };
    if (extra.properties) env.properties = extra.properties;
    assert.equal(validateEventEnvelope(env).ok, false, `should reject leak: ${JSON.stringify(extra)}`);
  }
});

test('the scorecard fixture itself carries no content or PII keys', () => {
  const FORBIDDEN = /pass|token|secret|prompt|content|body|copy|caption|headline|email|address|phone|brand_voice|brief_text|offer_text|answer/i;
  for (const r of fixture()) {
    for (const k of Object.keys(r.properties || {})) {
      assert.ok(!FORBIDDEN.test(k), `fixture property leaks: ${k}`);
      const v = r.properties[k];
      assert.ok(typeof v !== 'string' || v.length <= 40, `fixture value looks like content: ${k}`);
    }
  }
});

// ── (2) Duplicate / retry events do not inflate milestones ──────────────────
test('retried events count each subject once', () => {
  const sc = computeScorecard(fixture(), { roster });
  assert.equal(sc.cohort_size, 6, 'staff excluded, retries not double-counted');
  const profile = sc.steps.find((s) => s.step === 'brand_profile_completed');
  assert.equal(profile.numerator, 6);
  const reviewed = sc.steps.find((s) => s.step === 'first_asset_reviewed');
  assert.equal(reviewed.numerator, 6); // u1's duplicate review does not make 7
  const exported = sc.steps.find((s) => s.step === 'first_export');
  assert.equal(exported.numerator, 2); // u2's duplicate export does not make 3
});

test('staff/test accounts are excluded from KPIs by an auditable rule', () => {
  assert.deepEqual(classifyAccount({ email: 'staff@scalvya.com' }, roster), { excluded: true, reason: 'staff_email' });
  assert.deepEqual(classifyAccount({ email: 'x@scalvya.com' }, roster), { excluded: true, reason: 'staff_domain' });
  assert.deepEqual(classifyAccount({ workspaceId: 'ws-staff' }, roster), { excluded: true, reason: 'staff_workspace' });
  assert.deepEqual(classifyAccount({ email: 'real@gmail.com', workspaceId: 'ws1' }, roster), { excluded: false, reason: null });
});

// ── (4) Consistent funnel denominators ──────────────────────────────────────
test('every reported funnel rate uses the activated-cohort denominator', () => {
  const sc = computeScorecard(fixture(), { roster });
  const reported = sc.steps.filter((s) => s.state === 'reported');
  assert.ok(reported.length > 0);
  for (const s of reported) assert.equal(s.denominator, sc.cohort_size, `${s.step} must share the cohort denominator`);
  // 3/6 campaign-ready = 50%, 2/6 export = 33.3% — both on the same base of 6.
  assert.equal(sc.derived.campaign_completion_rate, 50);
  assert.equal(sc.derived.export_rate, 33.3);
  assert.equal(sc.derived.reviewed_asset_rate, 100);
});

test('generation failure rate is separate from product-fit funnel and counted by studio', () => {
  const sc = computeScorecard(fixture(), { roster });
  assert.equal(sc.derived.generation_attempts, 20); // 18 completed + 2 failed
  assert.equal(sc.derived.generation_failure_rate, 10); // 2/20
  assert.deepEqual(sc.derived.failure_by_studio, { email: 1, website: 1 });
});

test('small cohorts are suppressed, not reported as zero', () => {
  const rows = [
    { event: 'minimum_profile_reached', user_id: 'u1', workspace_id: 'w1', created_at: new Date().toISOString() },
    { event: 'minimum_profile_reached', user_id: 'u2', workspace_id: 'w2', created_at: new Date().toISOString() },
  ];
  const sc = computeScorecard(rows, { roster });
  assert.equal(sc.reportable, false);
  assert.equal(sc.steps.find((s) => s.step === 'brand_profile_completed').state, 'insufficient_data');
});

// ── Thresholds are hypotheses, and the module never throws ──────────────────
test('every provisional threshold is flagged as a hypothesis', () => {
  assert.ok(PROVISIONAL_THRESHOLDS.length >= 4);
  for (const t of PROVISIONAL_THRESHOLDS) assert.equal(t.hypothesis, true);
});

test('any genuinely-uninstrumented milestone reports unavailable, never a misleading zero', () => {
  // SC-95-03 instrumented second_campaign_created, so the uninstrumented set may
  // now be empty; the honesty MECHANISM must still hold for any step lacking a
  // canonical event, and second_campaign must NOT be in that set anymore.
  const uninstrumented = VALUE_LOOP.filter((s) => !s.canonical && !s.derive).map((s) => s.step);
  assert.ok(!uninstrumented.includes('second_campaign_created'), 'second_campaign is now instrumented');
  const sc = computeScorecard(fixture(), { roster });
  for (const step of uninstrumented) {
    assert.equal(sc.steps.find((s) => s.step === step).state, 'unavailable');
  }
});

test('computeScorecard never throws on malformed input (analytics failure isolation)', () => {
  for (const bad of [null, undefined, 42, 'x', [null, 1, {}], [{ event: null }]]) {
    assert.doesNotThrow(() => computeScorecard(bad, { roster }));
  }
  assert.equal(computeScorecard(null).cohort_size, 0);
});
