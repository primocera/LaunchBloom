// v5 Prompt 7 — pure generator-shell helpers: context defaults, per-field
// validation, blocking-error detection and the one-action disclosure.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const modUrl = pathToFileURL(path.join(__dirname, '..', '..', 'app-src', 'lib', 'generator-shell.js')).href;

test('deriveContext uses the primary product/audience, never a silent first', async () => {
  const { deriveContext } = await import(modUrl);
  const profile = {
    business_name: 'Lumen',
    products_list: [{ name: 'Basic' }, { name: 'Signature', primary: true }],
    audiences: [{ name: 'Bargain hunters' }, { name: 'Gift buyers', primary: true }],
    languages: ['English'],
    main_goal: 'First 100 sales',
  };
  const chips = deriveContext({ profile, campaign: { name: 'Summer', objective: 'x' } });
  const by = Object.fromEntries(chips.map((c) => [c.key, c.value]));
  assert.equal(by.brand, 'Lumen');
  assert.equal(by.product, 'Signature');
  assert.equal(by.audience, 'Gift buyers');
  assert.equal(by.campaign, 'Summer');
  assert.equal(by.language, 'English');
  assert.equal(by.goal, 'First 100 sales');
});

test('deriveContext flags missing brand context as editable', async () => {
  const { deriveContext } = await import(modUrl);
  const chips = deriveContext({ profile: {}, campaign: null, values: {} });
  const product = chips.find((c) => c.key === 'product');
  assert.equal(product.missing, true);
  assert.equal(product.editable, true);
  // language always defaults, never missing
  assert.equal(chips.find((c) => c.key === 'language').value, 'English');
});

test('validateFields reports required and length problems per field', async () => {
  const { validateFields } = await import(modUrl);
  const fields = [
    { name: 'topic', label: 'Topic', required: true },
    { name: 'meta', label: 'Meta description', maxLength: 20 },
    { name: 'h1', label: 'H1', minLength: 5 },
  ];
  const w = validateFields(fields, { topic: '', meta: 'x'.repeat(30), h1: 'Hi' });
  assert.match(w.topic, /required/);
  assert.match(w.meta, /under 20/);
  assert.match(w.h1, /at least 5/);
});

test('validateFields is silent when all constraints pass', async () => {
  const { validateFields } = await import(modUrl);
  const fields = [{ name: 'topic', label: 'Topic', required: true, maxLength: 50 }];
  assert.deepEqual(validateFields(fields, { topic: 'A good topic' }), {});
});

test('hasBlockingErrors only blocks on empty required fields', async () => {
  const { hasBlockingErrors } = await import(modUrl);
  const fields = [{ name: 'a', label: 'A', required: true }, { name: 'b', label: 'B' }];
  assert.equal(hasBlockingErrors(fields, { a: '', b: '' }), true);
  assert.equal(hasBlockingErrors(fields, { a: 'ok', b: '' }), false);
});

test('outputEstimate always discloses the one-action cost', async () => {
  const { outputEstimate } = await import(modUrl);
  assert.match(outputEstimate({ resultKey: 'emails', count: 3 }), /about 3 emails/);
  assert.match(outputEstimate({ resultKey: 'pages' }), /1 AI action/);
});

// ── v9 SC-05: explicit missing-decision reasons ─────────────────────────────

test('missingRequiredFields lists exactly the empty required labels', async () => {
  const { missingRequiredFields } = await import(modUrl);
  const fields = [
    { name: 'a', label: 'Audience', required: true },
    { name: 'b', label: 'Offer', required: true },
    { name: 'c', label: 'Tone' },
  ];
  assert.deepEqual(missingRequiredFields(fields, { a: 'parents', b: '', c: '' }), ['Offer']);
  assert.deepEqual(missingRequiredFields(fields, { a: 'p', b: 'o' }), []);
  assert.deepEqual(missingRequiredFields([{ name: 'x', label: 'Channels', required: true }], { x: [] }), ['Channels']);
});

// ── v9 SC-05: per-channel output contract (outcome-safe, no banned claims) ───

test('every canonical studio has an output contract with a safe boundary note', async () => {
  const { OUTPUT_CONTRACT, outputContractFor } = await import(modUrl);
  const tables = ['website_pages', 'email_assets', 'social_assets', 'creative_assets', 'seo_assets'];
  for (const t of tables) {
    const c = outputContractFor(t);
    assert.ok(c && Array.isArray(c.structure) && c.structure.length, `${t} needs structure`);
    assert.ok(typeof c.note === 'string' && c.note.length, `${t} needs a boundary note`);
  }
  // Channel boundaries must match the product contract.
  assert.match(OUTPUT_CONTRACT.social_assets.note, /never posted or scheduled/i);
  assert.match(OUTPUT_CONTRACT.creative_assets.note, /not rendered media or launched ads/i);
  assert.match(OUTPUT_CONTRACT.email_assets.note, /does not send/i);
  assert.match(OUTPUT_CONTRACT.seo_assets.note, /no invented search volume, difficulty or rank/i);
  // No banned "production/send/ready-to-paste/will rank" vocabulary leaks in.
  const all = tables.map((t) => OUTPUT_CONTRACT[t].note + ' ' + OUTPUT_CONTRACT[t].structure.join(' ')).join(' ');
  assert.ok(!/production[- ]ready|send[- ]ready|ready to paste|will rank|guaranteed/i.test(all));
  assert.equal(outputContractFor('unknown_table'), null);
});

// ── v9 SC-05: inline structured fields mirror the backend rewriteFields ──────

test('structuredFieldsFor exposes CTA-bearing fields per table, none for unknowns', async () => {
  const { structuredFieldsFor } = await import(modUrl);
  // Every editable field must be a real rewriteField for its table (backend
  // snapshots on content edits) — keep this list in sync with library.js.
  const REWRITE = {
    website_pages: ['title', 'seo_title', 'meta_description', 'cta'],
    email_assets: ['subject_line', 'preheader', 'headline', 'body_copy', 'cta'],
    social_assets: ['hook', 'caption', 'cta'],
    creative_assets: ['hook', 'headline', 'primary_text', 'cta'],
    seo_assets: ['seo_title', 'meta_description', 'h1'],
  };
  for (const [table, rewrite] of Object.entries(REWRITE)) {
    const specs = structuredFieldsFor(table);
    assert.ok(specs.length, `${table} needs at least one structured field`);
    for (const [field] of specs) {
      assert.ok(rewrite.includes(field), `${table}.${field} must be a backend rewriteField`);
    }
  }
  assert.deepEqual(structuredFieldsFor('nope'), []);
});
