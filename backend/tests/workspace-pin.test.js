// F4 + B4 (old-bug sweep 2026-11-07): the active workspace is pinned per
// browser tab, and a WRITE aimed at an archived/deleted workspace is refused
// instead of silently landing in the caller's first workspace.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const { stubModule } = require('./helpers');

const pinUrl = pathToFileURL(path.join(__dirname, '..', '..', 'app-src', 'lib', 'workspace-pin.js')).href;

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('F4: two tabs keep their own workspace after one switches', async () => {
  const { readActiveWorkspace, writeActiveWorkspace } = await import(pinUrl);
  const local = memStore();
  const tabA = memStore();
  const tabB = memStore();

  writeActiveWorkspace(local, tabA, 'ws-A');
  assert.equal(readActiveWorkspace(local, tabB), 'ws-A', 'a new tab inherits the last choice');
  writeActiveWorkspace(local, tabB, 'ws-B');

  assert.equal(readActiveWorkspace(local, tabA), 'ws-A', 'tab A must not follow tab B');
  assert.equal(readActiveWorkspace(local, tabB), 'ws-B');
  assert.equal(readActiveWorkspace(local, memStore()), 'ws-B', 'new tabs get the latest choice');
});

test('F4: blocked storage never throws', async () => {
  const { readActiveWorkspace, writeActiveWorkspace } = await import(pinUrl);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  assert.equal(readActiveWorkspace(broken, null), null);
  writeActiveWorkspace(broken, broken, 'ws-A');
});

test('B4: drop only clears stores that still hold the gone workspace', async () => {
  const { writeActiveWorkspace, dropActiveWorkspace, readActiveWorkspace } = await import(pinUrl);
  const local = memStore();
  const tabA = memStore();
  writeActiveWorkspace(local, tabA, 'ws-A');
  writeActiveWorkspace(local, memStore(), 'ws-B'); // another tab chose B
  dropActiveWorkspace(local, tabA, 'ws-A');
  assert.equal(tabA.getItem('active_workspace_id'), null);
  assert.equal(readActiveWorkspace(local, tabA), 'ws-B', 'the shared choice made elsewhere is kept');
});

// ── B4 server side ──────────────────────────────────────────────────────────
const WS = {
  'ws-1': { id: 'ws-1', user_id: 'u1', archived: false },
  'ws-arch': { id: 'ws-arch', user_id: 'u1', archived: true },
};
function fakeSupabase() {
  return {
    from: () => {
      const f = {};
      const b = {
        select() { return b; },
        eq(k, v) { f[k] = v; return b; },
        is(k, v) { f[k] = v; return b; },
        order() { return b; },
        limit() { return b; },
        single() {
          const row = WS[f.id];
          return Promise.resolve({ data: row && row.user_id === f.user_id ? row : null, error: null });
        },
        then(ok, err) {
          const rows = Object.values(WS).filter((w) => w.user_id === f.user_id && (f.archived === undefined || w.archived === f.archived));
          return Promise.resolve({ data: rows, error: null }).then(ok, err);
        },
      };
      return b;
    },
  };
}
stubModule('lib/supabase.js', fakeSupabase());
const { resolveWorkspace, isWorkspaceUnavailable } = require('../routes/workspaces');

function req(method, wsId) {
  return { method, userId: 'u1', userEmail: 'a@b.com', body: {}, query: {}, get: (h) => (h === 'x-workspace-id' ? wsId : undefined) };
}

test('B4: a write aimed at an archived workspace is refused, not redirected', async () => {
  await assert.rejects(resolveWorkspace(req('PUT', 'ws-arch')), (e) => isWorkspaceUnavailable(e) && e.status === 409);
  await assert.rejects(resolveWorkspace(req('POST', 'ws-deleted')), (e) => isWorkspaceUnavailable(e));
});

test('B4: reads keep the existing fallback; valid writes are unchanged', async () => {
  assert.equal((await resolveWorkspace(req('GET', 'ws-arch'))).id, 'ws-1');
  assert.equal((await resolveWorkspace(req('PUT', 'ws-1'))).id, 'ws-1');
  assert.equal((await resolveWorkspace(req('POST', undefined))).id, 'ws-1');
});
