// v5 Prompt 11 — Ads & Creative Studio: format-specific schema, search-ad
// character limits, claim-safety / compliance gating, and concept distinctness.

const test = require('node:test');
const assert = require('node:assert/strict');

const { creativeIdeasSchema } = require('../lib/schemas');
const {
  searchAdCharWarnings,
  creativeComplianceFlags,
  creativeReadyGate,
  conceptsDistinct,
  checkCreative,
} = require('../lib/quality-checks');

const props = creativeIdeasSchema.properties.items.items.properties;

test('schema carries angle, video_timeline, slides, search_ad, test and compliance_flags', () => {
  for (const f of ['angle', 'video_timeline', 'slides', 'search_ad', 'test', 'compliance_flags']) {
    assert.ok(props[f], `missing ${f}`);
  }
});

test('video_timeline is timed and scene-by-scene', () => {
  const vt = props.video_timeline;
  for (const f of ['first_frame_hook', 'duration_seconds', 'scenes', 'b_roll', 'product_moments', 'audio_direction', 'cta_end_card']) {
    assert.ok(vt.required.includes(f), `video_timeline missing ${f}`);
  }
  const scene = vt.properties.scenes.items;
  for (const f of ['timecode', 'visual', 'spoken_script', 'on_screen_text']) {
    assert.ok(scene.required.includes(f), `scene missing ${f}`);
  }
});

test('test matrix requires variable, hypothesis, control and success metric', () => {
  for (const f of ['variable', 'hypothesis', 'control', 'success_metric']) {
    assert.ok(props.test.required.includes(f), `test missing ${f}`);
  }
});

test('search-ad character limits are enforced (headline ≤30, description ≤90)', () => {
  const w = searchAdCharWarnings({
    search_ad: {
      headlines: ['ok', 'x'.repeat(35)],
      descriptions: ['ok', 'y'.repeat(120)],
    },
  }, 'search ad 1');
  assert.ok(w.some((m) => /headline 2 is 35/.test(m)));
  assert.ok(w.some((m) => /description 2 is 120/.test(m)));
  assert.deepEqual(searchAdCharWarnings({ search_ad: { headlines: ['fine'], descriptions: ['fine'] } }), []);
});

test('claim safety surfaces guarantees and fake scarcity as compliance flags', () => {
  const flags = creativeComplianceFlags({ primary_text: 'Money-back guarantee, only 3 left, act now' });
  assert.ok(flags.some((f) => /guarantee/i.test(f)));
  assert.ok(flags.some((f) => /urgency|scarcity/i.test(f)));
});

test('ready gate blocks unacknowledged high-risk claims, allows after ack', () => {
  const risky = { primary_text: '100% guaranteed results overnight' };
  assert.equal(creativeReadyGate(risky).ok, false);
  assert.equal(creativeReadyGate({ ...risky, compliance_ack: { acknowledged: true } }).ok, true);
  assert.equal(creativeReadyGate({ primary_text: 'A calm honest benefit line' }).ok, true);
});

test('distinctness heuristic flags repeated angles', () => {
  assert.equal(conceptsDistinct([{ angle: 'before/after' }, { angle: 'before/after' }]), false);
  assert.equal(conceptsDistinct([{ angle: 'before/after' }, { angle: 'founder story' }]), true);
});

test('checkCreative warns on undated video and duplicate angles', () => {
  const w = checkCreative([
    { creative_type: 'video', hook: 'A strong hook', visual_direction: 'clean shot', cta: 'Shop', angle: 'x', video_timeline: { scenes: [] } },
    { creative_type: 'static', hook: 'Another hook', visual_direction: 'clean shot', cta: 'Shop', angle: 'x' },
  ]);
  assert.ok(w.some((m) => /no scene-by-scene timeline/.test(m)));
  assert.ok(w.some((m) => /same angle/.test(m)));
});
