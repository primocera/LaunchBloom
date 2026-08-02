// v13 SC-P1-10 — the typed error-to-copy contract. These lock the EXACT state
// and recovery action for each required failure/blank-slate, that every
// critical error answers "what happened / did I lose work or get charged / what
// now", that no false-downgrade or deceptive-readiness copy returns, and that
// instrumentation carries only category + recovery action (never content).

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const modUrl = pathToFileURL(path.join(__dirname, '..', '..', 'app-src', 'lib', 'error-states.js')).href;
const load = () => import(modUrl);

const FORBIDDEN = ['production-ready', 'send-ready', 'ready to paste'];

test('plan verification unavailable: preserves access, retry + support, never Free', async () => {
  const { errorStateFor } = await load();
  const st = errorStateFor({ code: 'PLAN_UNAVAILABLE', req_id: 'req_1' });
  assert.equal(st.category, 'plan_verification');
  assert.equal(st.role, 'alert');
  assert.equal(st.action.kind, 'retry');
  assert.equal(st.secondaryAction.kind, 'support');
  assert.match(st.message, /couldn’t verify your plan/i);
  assert.match(st.reassurance, /access hasn’t changed/i);
  assert.doesNotMatch(JSON.stringify(st), /free/i); // no false downgrade
});

test('checkout config unavailable: confirms no charge and unchanged currency', async () => {
  const { errorStateFor } = await load();
  for (const err of [{ code: 'CHECKOUT_UNAVAILABLE' }, { status: 503 }]) {
    const st = errorStateFor(err, { context: 'checkout' });
    assert.equal(st.category, 'checkout_config');
    assert.equal(st.action.kind, 'retry');
    assert.match(st.reassurance, /weren’t charged/i);
    assert.match(st.reassurance, /currency (are|is) unchanged/i);
  }
});

test('generation timeout/provider failure: brief saved, no charge, retry', async () => {
  const { errorStateFor } = await load();
  for (const err of [{ code: 'AI_TIMEOUT' }, { status: 408 }, { status: 500 }]) {
    const st = errorStateFor(err, { context: 'generation' });
    assert.equal(st.category, 'generation_failed');
    assert.equal(st.action.kind, 'retry');
    assert.match(st.reassurance, /No AI action was charged and your brief is saved/i);
  }
});

test('usage limit reached: facts + upgrade path, no pressure, work safe', async () => {
  const { errorStateFor } = await load();
  const st = errorStateFor({ code: 'UPGRADE', status: 402 });
  assert.equal(st.category, 'usage_limit');
  assert.equal(st.action.kind, 'upgrade');
  assert.match(st.message, /Editing and exporting/i);
  assert.match(st.reassurance, /Your work is saved/i);
});

test('generation paused maps to usage-limit with a retry-later action', async () => {
  const { errorStateFor } = await load();
  const st = errorStateFor({ code: 'GENERATION_PAUSED' });
  assert.equal(st.category, 'usage_limit');
  assert.equal(st.action.kind, 'retry');
  assert.match(st.action.label, /later/i);
});

test('export failure: reviewed assets preserved, retry + copy fallback', async () => {
  const { exportFailureState } = await load();
  const st = exportFailureState({});
  assert.equal(st.category, 'export_failed');
  assert.equal(st.action.kind, 'retry');
  assert.match(st.reassurance, /still saved — nothing was lost/i);
  assert.match(st.message, /copy assets individually/i);
});

test('empty workspace: ordered Brand → Brief → asset guidance, no AI cost', async () => {
  const { emptyWorkspaceState } = await load();
  const st = emptyWorkspaceState();
  assert.equal(st.category, 'empty_workspace');
  assert.equal(st.role, 'status'); // guidance, not an interrupting alert
  assert.deepEqual(st.steps.map((s) => s.key), ['brand', 'brief', 'asset']);
  assert.equal(st.steps[0].to, '/app/brand');
  assert.match(st.reassurance, /no AI action/i);
});

test('every critical state answers charged/lost-work and offers one action', async () => {
  const { planVerificationState, checkoutConfigState, generationFailedState, usageLimitState, exportFailureState } = await load();
  for (const st of [planVerificationState({}), checkoutConfigState({}), generationFailedState({}), usageLimitState({}), exportFailureState({})]) {
    assert.ok(st.reassurance, `${st.category} must state whether work/charge was affected`);
    assert.ok(st.action && st.action.label, `${st.category} must offer a recovery action`);
  }
});

test('no deceptive readiness/publishing claim in any state copy', async () => {
  const mod = await load();
  const states = [
    mod.planVerificationState({}), mod.checkoutConfigState({}), mod.generationFailedState({}),
    mod.usageLimitState({}), mod.usageLimitState({ code: 'GENERATION_PAUSED' }),
    mod.exportFailureState({}), mod.emptyWorkspaceState(),
  ];
  for (const st of states) {
    const blob = JSON.stringify(st).toLowerCase();
    for (const bad of FORBIDDEN) assert.ok(!blob.includes(bad), `${st.category} contains forbidden claim "${bad}"`);
  }
});

test('instrumentation sends only category + recovery action, never content', async () => {
  const { trackErrorState, generationFailedState } = await load();
  const calls = [];
  const track = (event, props) => calls.push({ event, props });
  trackErrorState(track, generationFailedState({ req_id: 'r1' }), { feature: 'email_assets' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].event, 'error_state');
  assert.deepEqual(Object.keys(calls[0].props).sort(), ['category', 'feature', 'recovery_action']);
  assert.equal(calls[0].props.category, 'generation_failed');
  assert.equal(calls[0].props.recovery_action, 'retry');
  // No brief/content/message/req_id leaks into analytics.
  const blob = JSON.stringify(calls[0].props);
  assert.doesNotMatch(blob, /brief|message|req_?id|r1/i);
});

test('trackErrorState is a no-op without a track fn or state', async () => {
  const { trackErrorState } = await load();
  assert.doesNotThrow(() => trackErrorState(undefined, null));
  assert.doesNotThrow(() => trackErrorState((() => {}), null));
});
