// Playbook v6 Prompt 6 — the email outbox worker: atomic claiming, retry with
// backoff, dead-lettering, replay, and no double-send with concurrent workers.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
process.env.RESEND_API_KEY = 'test-key'; // worker path needs a provider client

const { stubModule } = require('./helpers');

// Stub the resend package before lifecycle-email loads it.
let sendImpl = async () => ({ data: { id: 'msg_1' }, error: null });
const sendCalls = [];
const resendResolved = require.resolve('resend');
require.cache[resendResolved] = {
  id: resendResolved,
  filename: resendResolved,
  loaded: true,
  exports: {
    Resend: class {
      constructor() {
        this.emails = { send: async (args) => { sendCalls.push(args); return sendImpl(args); } };
      }
    },
  },
};

// Fake email_events store with an atomic claim RPC (mirrors FOR UPDATE SKIP
// LOCKED semantics: a row can only be claimed once until its lease expires).
let nextId = 1;
const rows = new Map(); // id -> row

function due(row) {
  const now = Date.now();
  if (['pending', 'failed'].includes(row.status)) {
    return !row.next_attempt_at || new Date(row.next_attempt_at).getTime() <= now;
  }
  if (row.status === 'sending') return row.locked_until && new Date(row.locked_until).getTime() < now;
  return false;
}

function fakeSupabase() {
  return {
    rpc: async (name, args) => {
      if (name !== 'claim_email_outbox') return { data: null, error: { code: 'PGRST202', message: 'missing' } };
      const claimed = [];
      for (const row of rows.values()) {
        if (claimed.length >= args.p_limit) break;
        if (due(row)) {
          row.status = 'sending';
          row.locked_until = new Date(Date.now() + args.p_lease_seconds * 1000).toISOString();
          claimed.push({ ...row });
        }
      }
      return { data: claimed, error: null };
    },
    from: () => {
      let op = null, payload = null, id = null, dedupe = null, statusFilter = null;
      const b = {
        insert(p) { op = 'insert'; payload = p; return b; },
        update(p) { op = 'update'; payload = p; return b; },
        select() { return b; },
        in() { return b; },
        order() { return b; },
        limit() { return b; },
        eq(col, val) {
          if (col === 'id') id = val;
          if (col === 'dedupe_key') dedupe = val;
          if (col === 'status') statusFilter = val;
          return b;
        },
        then(onOk, onErr) {
          let result = { data: null, error: null };
          if (op === 'insert') {
            const row = { id: String(nextId++), attempts: 0, ...payload };
            rows.set(row.id, row);
          } else if (op === 'update') {
            for (const row of rows.values()) {
              if (id && row.id !== id) continue;
              if (dedupe && row.dedupe_key !== dedupe) continue;
              if (statusFilter && row.status !== statusFilter) continue;
              Object.assign(row, payload);
            }
          }
          return Promise.resolve(result).then(onOk, onErr);
        },
      };
      return b;
    },
  };
}

stubModule('lib/supabase.js', fakeSupabase());
const { processEmailOutbox, replayDeadLetter, MAX_ATTEMPTS } = require('../lib/lifecycle-email');

function seed(row) {
  const r = { id: String(nextId++), email_type: 'welcome', recipient: 'a@b.com', status: 'failed', attempts: 0, next_attempt_at: null, payload: {}, ...row };
  rows.set(r.id, r);
  return r;
}

test('a due failed row is retried and marked sent', async () => {
  rows.clear();
  const r = seed({});
  sendImpl = async () => ({ data: { id: 'msg_ok' }, error: null });
  const summary = await processEmailOutbox();
  assert.equal(summary.sent, 1);
  assert.equal(rows.get(r.id).status, 'sent');
  assert.equal(rows.get(r.id).provider_id, 'msg_ok');
});

test('a failing send backs off and eventually dead-letters', async () => {
  rows.clear();
  const r = seed({});
  sendImpl = async () => { throw new Error('provider down'); };

  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    const s = await processEmailOutbox();
    assert.equal(s.failed, 1, `attempt ${i} should stay retryable`);
    assert.equal(rows.get(r.id).status, 'failed');
    assert.ok(rows.get(r.id).next_attempt_at, 'backoff scheduled');
    rows.get(r.id).next_attempt_at = null; // make due again for the test
  }
  const last = await processEmailOutbox();
  assert.equal(last.dead_letter, 1);
  assert.equal(rows.get(r.id).status, 'dead_letter');
  assert.equal(rows.get(r.id).attempts, MAX_ATTEMPTS);
});

test('two concurrent workers cannot double-send the same row', async () => {
  rows.clear();
  seed({});
  sendCalls.length = 0;
  sendImpl = async () => ({ data: { id: 'msg_once' }, error: null });
  const [a, b] = await Promise.all([processEmailOutbox(), processEmailOutbox()]);
  assert.equal(a.sent + b.sent, 1, 'exactly one worker sends');
  assert.equal(sendCalls.length, 1, 'provider called once');
});

test('replayDeadLetter puts a dead row back in the queue and it sends', async () => {
  rows.clear();
  const r = seed({ status: 'dead_letter', attempts: MAX_ATTEMPTS });
  assert.equal(await replayDeadLetter(r.id), true);
  assert.equal(rows.get(r.id).status, 'failed');
  sendImpl = async () => ({ data: { id: 'msg_replay' }, error: null });
  const s = await processEmailOutbox();
  assert.equal(s.sent, 1);
  assert.equal(rows.get(r.id).status, 'sent');
});

test('unknown template type is skipped, not retried forever', async () => {
  rows.clear();
  const r = seed({ email_type: 'no_such_template' });
  const s = await processEmailOutbox();
  assert.equal(s.skipped, 1);
  assert.equal(rows.get(r.id).status, 'skipped');
});
