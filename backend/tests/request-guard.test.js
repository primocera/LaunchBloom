// v13 SC-P1-07 — the stale-response guard that backs every studio / campaign
// loader (app-src/lib/request.js, bound to React in lib/use-request-guard.js).
//
// There is no DOM renderer in this repo's test stack, so these tests drive the
// exact loader shape the components use (`const isCurrent = begin(); api(...)
// .then(d => { if (isCurrent()) setState(d) })`) against a deferred fake api,
// and switch the authoritative id WITHOUT re-creating the guard — which is
// precisely what "campaign changes without remounting" means for this code.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const modUrl = pathToFileURL(
  path.join(__dirname, '..', '..', 'app-src', 'lib', 'request.js'),
).href;

/** A fake api whose responses are resolved by the test, in any order. */
function deferredApi() {
  const pending = new Map();
  return {
    calls: [],
    fetch(id) {
      this.calls.push(id);
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    resolve(id, value) { pending.get(id).resolve(value); },
    reject(id, err) { pending.get(id).reject(err); },
  };
}

/** Mimics one mounted studio/campaign component. */
function mountLoader(createRequestGuard, api) {
  const guard = createRequestGuard();
  const state = { data: null, error: null, commits: 0 };
  return {
    guard,
    state,
    // The component's `load`, keyed on the authoritative id.
    load(id) {
      const isCurrent = guard.begin();
      state.data = null; // loading state
      state.error = null;
      return api.fetch(id)
        .then((d) => { if (isCurrent()) { state.data = d; state.commits++; } })
        .catch((e) => { if (isCurrent()) { state.error = e.message; state.commits++; } });
    },
    unmount() { guard.dispose(); },
  };
}

test('switching campaign ids without remount loads the new campaign', async () => {
  const { createRequestGuard } = await import(modUrl);
  const api = deferredApi();
  const c = mountLoader(createRequestGuard, api);

  const first = c.load('campaign-a');
  api.resolve('campaign-a', 'A data');
  await first;
  assert.equal(c.state.data, 'A data');

  // Same mounted component, new id — no remount, no new guard.
  const second = c.load('campaign-b');
  assert.equal(c.state.data, null, 'shows its loading state, not the previous campaign');
  api.resolve('campaign-b', 'B data');
  await second;

  assert.equal(c.state.data, 'B data');
  assert.deepEqual(api.calls, ['campaign-a', 'campaign-b'], 'exactly one request per id — no duplicates');
});

test('a slow old-campaign response cannot overwrite the new campaign', async () => {
  const { createRequestGuard } = await import(modUrl);
  const api = deferredApi();
  const c = mountLoader(createRequestGuard, api);

  const slowOld = c.load('campaign-a'); // still in flight
  const fastNew = c.load('campaign-b'); // user switched immediately

  api.resolve('campaign-b', 'B data');
  await fastNew;
  assert.equal(c.state.data, 'B data');

  // A resolves LAST — the classic race that used to win.
  api.resolve('campaign-a', 'A data');
  await slowOld;

  assert.equal(c.state.data, 'B data', 'stale campaign data must not be shown');
  assert.equal(c.state.commits, 1, 'the stale response commits nothing at all');
});

test('a slow old-campaign FAILURE cannot show an error on the new campaign', async () => {
  const { createRequestGuard } = await import(modUrl);
  const api = deferredApi();
  const c = mountLoader(createRequestGuard, api);

  const slowOld = c.load('query-page-1');
  const fastNew = c.load('query-page-2');

  api.resolve('query-page-2', 'page 2');
  await fastNew;
  api.reject('query-page-1', new Error('boom'));
  await slowOld;

  assert.equal(c.state.data, 'page 2');
  assert.equal(c.state.error, null, 'the stale request must not surface an error state');
});

test('responses arriving after unmount are dropped (no post-unmount setState)', async () => {
  const { createRequestGuard } = await import(modUrl);
  const api = deferredApi();
  const c = mountLoader(createRequestGuard, api);

  const p = c.load('campaign-a');
  c.unmount();
  api.resolve('campaign-a', 'A data');
  await p;

  assert.equal(c.state.data, null);
  assert.equal(c.state.commits, 0);
});

test('reload on the same id still commits (regenerate / refresh keeps working)', async () => {
  const { createRequestGuard } = await import(modUrl);
  const api = deferredApi();
  const c = mountLoader(createRequestGuard, api);

  const first = c.load('campaign-a');
  api.resolve('campaign-a', 'v1');
  await first;
  assert.equal(c.state.data, 'v1');

  // useRegenerate calls the same `reload` again with an unchanged id.
  const api2 = deferredApi();
  const c2 = { ...c };
  const isCurrent = c.guard.begin();
  const second = api2.fetch('campaign-a').then((d) => { if (isCurrent()) c.state.data = d; });
  api2.resolve('campaign-a', 'v2');
  await second;

  assert.equal(c2.state.data, 'v2', 'a same-id reload is not mistaken for a stale request');
  assert.equal(c.state.commits, 1);
});

test('revive() re-arms the guard after a StrictMode remount', async () => {
  const { createRequestGuard } = await import(modUrl);
  const guard = createRequestGuard();
  guard.dispose();
  guard.revive();
  const isCurrent = guard.begin();
  assert.equal(isCurrent(), true);
});
