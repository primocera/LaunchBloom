// ---------------------------------------------------------------------------
// Audit A4 / A5 (2026-11-15): one overall generation deadline shared across
// attempts, and truncated output (stop_reason max_tokens) detected instead of
// being retried blindly. Tokens of failed attempts are counted in the cost.
//
// The deadline values are shrunk through env so the test runs in well under a
// second; the production defaults are 240 s overall and 15 s minimum attempt.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_DEADLINE_MS = '800';
process.env.AI_MIN_ATTEMPT_MS = '150';
process.env.AI_TIMEOUT_MS = '300';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real';

const { stubModule } = require('./helpers');

// Spend ledger: record what is finalized / released.
const ledger = { finalized: [], released: 0 };
stubModule('lib/spend-guard.js', {
  reserveAiCall: async () => ({ day: '2026-11-17' }),
  finalizeAiCall: async (_day, info) => { ledger.finalized.push(info); },
  releaseAiCall: async () => { ledger.released++; },
});

// Scripted Anthropic client. Each entry of `script` answers one call.
class APIConnectionTimeoutError extends Error {}
let script = [];
const calls = [];
class FakeAnthropic {
  constructor() {
    this.messages = {
      create: (body, opts) => {
        calls.push({ max_tokens: body.max_tokens, timeout: opts.timeout, at: Date.now() });
        const step = script.shift() || 'hang';
        if (step === 'hang') {
          // Behaves like the SDK: gives up at the per-request timeout.
          return new Promise((_r, reject) => setTimeout(() => reject(new APIConnectionTimeoutError('timeout')), opts.timeout));
        }
        return Promise.resolve(step);
      },
    };
  }
}
require.cache[require.resolve('@anthropic-ai/sdk')] = {
  id: require.resolve('@anthropic-ai/sdk'),
  filename: require.resolve('@anthropic-ai/sdk'),
  loaded: true,
  exports: FakeAnthropic,
};

const { generateJson } = require('../lib/ai');

const schema = {
  type: 'object',
  required: ['title'],
  properties: { title: { type: 'string' } },
};
const ok = (inTok = 100, outTok = 50) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify({ title: 'Done' }) }],
  usage: { input_tokens: inTok, output_tokens: outTok },
});
const truncated = () => ({
  stop_reason: 'max_tokens',
  content: [{ type: 'text', text: '{"title": "cut of' }],
  usage: { input_tokens: 100, output_tokens: 999 },
});

function reset(steps) {
  script = steps;
  calls.length = 0;
  ledger.finalized = [];
  ledger.released = 0;
}

test('A4: total generation time never exceeds the deadline', async () => {
  reset(['hang', 'hang', 'hang']);
  const started = Date.now();
  await assert.rejects(generateJson({ system: 's', prompt: 'p', schema }), { code: 'AI_UNAVAILABLE' });
  const elapsed = Date.now() - started;
  // 3 x 300 ms timeouts plus backoff would be ~1.8 s; the 800 ms deadline cuts it short.
  assert.ok(elapsed < 800 + 150, `took ${elapsed} ms`);
  assert.ok(calls.length < 3, 'a retry that cannot finish in the time left is not started');
  for (const c of calls) assert.ok(c.timeout <= 300);
  assert.equal(ledger.released, 1);
});

test('A4: a later attempt only gets the time that is left', async () => {
  reset(['hang', ok()]);
  const out = await generateJson({ system: 's', prompt: 'p', schema });
  assert.equal(out.title, 'Done');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].timeout < 300, `second attempt timeout ${calls[1].timeout} ms`);
});

test('A5: truncated output fails as AI_TRUNCATED after one retry with a higher limit', async () => {
  reset([truncated(), truncated(), ok()]);
  await assert.rejects(generateJson({ system: 's', prompt: 'p', schema, maxTokens: 1000 }), { code: 'AI_TRUNCATED' });
  assert.equal(calls.length, 2, 'not three paid attempts at a limit that cannot fit');
  assert.ok(calls[1].max_tokens > calls[0].max_tokens, 'the retry gets more room');
});

test('A5: a retry after truncation that fits succeeds, and both attempts are costed', async () => {
  reset([truncated(), ok(100, 50)]);
  const out = await generateJson({ system: 's', prompt: 'p', schema, maxTokens: 1000 });
  assert.equal(out.title, 'Done');
  assert.equal(out.__meta.input_tokens, 200);
  assert.equal(out.__meta.output_tokens, 1049);
  assert.equal(ledger.finalized.length, 1);
  assert.equal(ledger.finalized[0].outputTokens, 1049);
});
