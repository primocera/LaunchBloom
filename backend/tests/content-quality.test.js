// v6 Prompts 21-23: deterministic content-quality upgrades — per-claim
// provenance, unresolved-fact placeholders, email timezone completeness and
// social distinctness/density. Pure-function tests, no network.

const test = require('node:test');
const assert = require('node:assert');

const {
  checkWebsitePages,
  claimProvenanceWarnings,
  unresolvedPlaceholderCount,
  checkEmails,
  checkSocial,
  repeatedHookWarnings,
} = require('../lib/quality-checks');

// ── Prompt 21: website claim provenance + placeholders ──────────────────────

test('risky claims outside the supplied proof are flagged per claim', () => {
  const pages = [{
    page_type: 'home',
    h1: 'Handmade candles',
    sections: [{ bullets: ['Loved by 2,000 customers', '98% would buy again', 'Slow-burning soy wax'] }],
  }];
  const w = claimProvenanceWarnings(pages, 'We have 2,000 customers on record.');
  // "2,000 customers" is in the proof; "98%" is not.
  assert.ok(w.some((m) => m.includes('98%')));
  assert.ok(!w.some((m) => m.includes('2,000 customers')));
  assert.ok(w.every((m) => /verify the source or remove/.test(m)));
});

test('no proof supplied means every risky claim is flagged; clean copy passes', () => {
  const risky = [{ page_type: 'landing', h1: 'Rated #1 by 500 reviews' }];
  assert.ok(claimProvenanceWarnings(risky, '').length >= 1);
  const clean = [{ page_type: 'about', h1: 'A small family studio making soap by hand' }];
  assert.deepEqual(claimProvenanceWarnings(clean, ''), []);
});

test('unresolved bracket placeholders are counted and surfaced', () => {
  const page = {
    page_type: 'product',
    h1: 'The Everyday Tote',
    meta_description: 'A durable tote made from [Add material here] for daily use around town.',
    seo_title: 'Everyday Tote',
    page_goal: 'sell the tote',
    primary_cta: 'Add to cart',
    sections: [{ bullets: ['Fits a laptop', 'Machine washable', '[Add warranty details]'] }],
  };
  assert.equal(unresolvedPlaceholderCount(page), 2);
  const w = checkWebsitePages([page]);
  assert.ok(w.some((m) => /2 unresolved fact placeholder/.test(m)));
});

// ── Prompt 22: deadline needs a timezone ────────────────────────────────────

test('a campaign end date without a timezone is warned; with timezone it is not', () => {
  const email = [{ subject_line: 'Sale ends Friday', preheader: 'Details inside', cta: 'Shop the sale', body_copy: 'Full body copy here.' }];
  const without = checkEmails(email, { hasDeadline: true });
  assert.ok(without.some((m) => /timezone/.test(m)));
  const withTz = checkEmails(email, { hasDeadline: true, timezone: 'America/New_York' });
  assert.ok(!withTz.some((m) => /timezone/.test(m)));
});

// ── Prompt 23: distinct angles + realistic density ──────────────────────────

test('near-duplicate hooks across items are detected', () => {
  const dupes = [
    { hook: 'Three mistakes killing your listing photos today' },
    { hook: 'The three mistakes killing your listing photos' },
  ];
  assert.ok(repeatedHookWarnings(dupes).length >= 1);
  const distinct = [
    { hook: 'Three mistakes killing your listing photos today' },
    { hook: 'What buyers notice in the first five seconds' },
  ];
  assert.deepEqual(repeatedHookWarnings(distinct), []);
});

test('a single-pillar set and an unrealistic item count are warned', () => {
  const base = { hook: '', cta: 'Save this', caption: 'A specific useful caption about pricing your service.', visual_direction: 'talking head at desk' };
  const onePillar = Array.from({ length: 6 }, (_, i) => ({ ...base, hook: `Unique angle number ${i} about topic ${i}`, pillar: 'sales' }));
  const w1 = checkSocial(onePillar);
  assert.ok(w1.some((m) => /pillar/.test(m)));

  const tooMany = Array.from({ length: 25 }, (_, i) => ({ ...base, hook: `Distinct hook ${i} about subject ${i} thing${i}`, pillar: i % 2 ? 'proof' : 'education' }));
  const w2 = checkSocial(tooMany);
  assert.ok(w2.some((m) => /publishing density|one post per day/.test(m)));
});
