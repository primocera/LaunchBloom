// Atomic AI spend ledger (playbook v6, Prompt 5): reserve/finalize/release
// semantics, cap enforcement, pause switch, concurrency safety of the RPC
// contract and the legacy Storage fallback.
const test = require('node:test');
const assert = require('node:assert/strict');

const { stubModule } = require('./helpers');

function freshGuard(fake) {
  stubModule('lib/supabase.js', fake);
  delete require.cache[require.resolve('../lib/spend-guard.js')];
  return require('../lib/spend-guard.js');
}

// A stateful fake ledger that mimics the SQL function's atomicity: increments
// are applied synchronously per call, so N concurrent calls get N distinct
// counts and the cap is never exceeded.
function makeLedgerFake(cap) {
  const state = { reserved: 0, released: 0, used: 0, inTok: 0, outTok: 0, cost: 0 };
  const fake = {
    state,
    rpc: async (name, args) => {
      if (name === 'reserve_ai_spend') {
        // Enforce the fake's own cap (not args.p_cap) so tests control it.
        if (state.reserved - state.released >= cap) return { data: [], error: null };
        state.reserved += 1;
        return { data: [{ reserved_count: state.reserved }], error: null };
      }
      if (name === 'finalize_ai_spend') {
        state.used += 1;
        state.inTok += args.p_input_tokens;
        state.outTok += args.p_output_tokens;
        state.cost += args.p_cost;
        return { data: null, error: null };
      }
      if (name === 'release_ai_spend') {
        state.released += 1;
        return { data: null, error: null };
      }
      return { data: null, error: { code: 'PGRST202', message: 'missing' } };
    },
    storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
  };
  return fake;
}

test('reserve increments atomically and enforces the cap under concurrency', async () => {
  const fake = makeLedgerFake(5);
  const guard = freshGuard(fake);
  // Cap comes from env at module load; use the fake's own cap via 100 parallel calls.
  const results = await Promise.allSettled(
    Array.from({ length: 100 }, () => guard.reserveAiCall())
  );
  const ok = results.filter((r) => r.status === 'fulfilled');
  const capped = results.filter((r) => r.status === 'rejected');
  // Fake cap is 5 regardless of MAX_AI_CALLS_PER_DAY: p_cap is passed through,
  // but the fake enforces 5 — so exactly 5 succeed only if p_cap >= 5.
  assert.equal(fake.state.reserved, ok.length);
  assert.equal(ok.length, 5);
  for (const r of capped) assert.equal(r.reason.code, 'DAILY_CAP');
});

test('release gives budget back so a new reservation succeeds', async () => {
  const fake = makeLedgerFake(1);
  const guard = freshGuard(fake);
  const first = await guard.reserveAiCall();
  await assert.rejects(guard.reserveAiCall(), (e) => e.code === 'DAILY_CAP');
  await guard.releaseAiCall(first.day);
  const second = await guard.reserveAiCall();
  assert.ok(second.used > first.used);
  assert.equal(fake.state.released, 1);
});

test('finalize records tokens and cost', async () => {
  const fake = makeLedgerFake(10);
  const guard = freshGuard(fake);
  const r = await guard.reserveAiCall();
  await guard.finalizeAiCall(r.day, { inputTokens: 1200, outputTokens: 800, estimatedCost: 0.0052 });
  assert.equal(fake.state.used, 1);
  assert.equal(fake.state.inTok, 1200);
  assert.equal(fake.state.outTok, 800);
  assert.ok(Math.abs(fake.state.cost - 0.0052) < 1e-9);
});

test('AI_GENERATION_PAUSED blocks reservation with GENERATION_PAUSED', async () => {
  const guard = freshGuard(makeLedgerFake(10));
  process.env.AI_GENERATION_PAUSED = '1';
  try {
    await assert.rejects(guard.reserveAiCall(), (e) => e.code === 'GENERATION_PAUSED' && e.status === 503);
  } finally {
    delete process.env.AI_GENERATION_PAUSED;
  }
});

test('missing RPC falls back to legacy Storage counter', async () => {
  let stored = {};
  const fake = {
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
    storage: {
      from: () => ({
        download: async () => ({ data: { arrayBuffer: async () => Buffer.from(JSON.stringify(stored)) } }),
        upload: async (key, buf) => { stored = JSON.parse(buf.toString('utf8')); return { error: null }; },
      }),
    },
  };
  const guard = freshGuard(fake);
  const r = await guard.reserveAiCall();
  assert.equal(r.ledger, false);
  assert.equal(r.used, 1);
  const r2 = await guard.reserveAiCall();
  assert.equal(r2.used, 2);
});

test('unknown DB error fails closed (no unmetered spend)', async () => {
  const fake = {
    rpc: async () => ({ data: null, error: { code: 'XX000', message: 'boom' } }),
    storage: { from: () => ({ download: async () => null, upload: async () => ({ error: null }) }) },
  };
  const guard = freshGuard(fake);
  await assert.rejects(guard.reserveAiCall(), (e) => e.code === 'SPEND_GUARD_UNAVAILABLE' && e.status === 503);
});
