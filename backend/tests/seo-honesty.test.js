// v5 Prompt 12 — SEO honesty: no fabricated metrics, ranking promises rejected,
// keyword cannibalization flagged, and the provider adapter stays "not researched".

const test = require('node:test');
const assert = require('node:assert/strict');

const { seoKitSchema } = require('../lib/schemas');
const {
  getSeoProvider,
  notResearchedProvider,
  researchChecklist,
  rejectFabricatedMetrics,
  findKeywordCannibalization,
} = require('../lib/seo-provider');

test('default provider is not-researched and never returns metrics', async () => {
  const p = getSeoProvider();
  assert.equal(p, notResearchedProvider);
  assert.equal(p.researched, false);
  const out = await p.lookup(['candles', 'gifts']);
  assert.equal(out.length, 2);
  for (const r of out) {
    assert.equal(r.metrics, null);
    assert.equal(r.source, null);
    assert.equal(r.retrieved_at, null);
  }
});

test('research checklist is offered when no provider exists', () => {
  const list = researchChecklist();
  assert.ok(Array.isArray(list) && list.length >= 3);
});

test('schema carries honest structure and no metric fields', () => {
  const props = seoKitSchema.properties.items.items.properties;
  for (const f of ['topic_cluster', 'search_intent', 'secondary_keywords']) {
    assert.ok(props[f], `missing ${f}`);
  }
  for (const banned of ['search_volume', 'keyword_difficulty', 'cpc', 'msv']) {
    assert.ok(!(banned in props), `schema must not expose ${banned}`);
  }
});

test('fabricated metrics are rejected', () => {
  const bad = rejectFabricatedMetrics([
    { keyword: 'soy candles', content_angle: 'search volume 12000, KD 34' },
  ]);
  assert.ok(bad.some((m) => /metric without a source/.test(m)));
});

test('ranking promises are rejected', () => {
  const bad = rejectFabricatedMetrics([
    { keyword: 'soy candles', title: 'Keywords you can actually rank with' },
  ]);
  assert.ok(bad.some((m) => /promises rankings/.test(m)));
});

test('a metric with a real source and date is allowed', () => {
  const ok = rejectFabricatedMetrics([
    { keyword: 'soy candles', content_angle: 'search volume 1200', metrics: { source: 'GSC', retrieved_at: '2026-07-17' } },
  ]);
  assert.deepEqual(ok, []);
});

test('honest ideas without metrics pass cleanly', () => {
  assert.deepEqual(rejectFabricatedMetrics([
    { keyword: 'how to choose a soy candle', content_angle: 'buyer education', title: 'Choosing a soy candle' },
  ]), []);
});

test('keyword cannibalization is flagged', () => {
  const collisions = findKeywordCannibalization([
    { keyword: 'Soy Candles', page_type: 'blog' },
    { keyword: 'soy candles', page_type: 'product' },
    { keyword: 'gift sets', page_type: 'collection' },
  ]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].keyword, 'soy candles');
  assert.equal(collisions[0].count, 2);
});
