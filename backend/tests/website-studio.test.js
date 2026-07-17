// v5 Prompt 8 — Website Studio: schema accepts every page type (with hero
// directions + secondary CTA), quality checks flag meta/title length and a
// missing conversion goal, and the Markdown export keeps its structure.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const { websiteKitSchema } = require('../lib/schemas');
const { checkWebsitePages } = require('../lib/quality-checks');

// ── compact JSON-schema validator (object/array/string/enum/required/addl) ──
function validate(schema, value, p = '$') {
  const errs = [];
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${p}: expected object`];
    for (const req of schema.required || []) {
      if (!(req in value)) errs.push(`${p}.${req}: required`);
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!schema.properties || !(k in schema.properties)) errs.push(`${p}.${k}: not allowed`);
      }
    }
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in value) errs.push(...validate(sub, value[k], `${p}.${k}`));
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${p}: expected array`];
    if (schema.minItems != null && value.length < schema.minItems) errs.push(`${p}: < minItems`);
    if (schema.maxItems != null && value.length > schema.maxItems) errs.push(`${p}: > maxItems`);
    value.forEach((v, i) => errs.push(...validate(schema.items, v, `${p}[${i}]`)));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') errs.push(`${p}: expected string`);
    if (schema.enum && !schema.enum.includes(value)) errs.push(`${p}: not in enum`);
  }
  return errs;
}

const PAGE_TYPES = ['home', 'product', 'collection', 'cart', 'about', 'faq', 'thank_you', 'contact', 'landing'];

function samplePage(pageType) {
  return {
    page_type: pageType,
    page_goal: 'Convert visitors into buyers',
    seo_title: 'A solid SEO title here',
    meta_description: 'A meta description that sits comfortably within the recommended length window for search.',
    h1: 'The headline',
    hero_headline: 'Hero headline',
    hero_subheadline: 'Hero subheadline',
    hero_directions: [
      { approach: 'direct_response', headline: 'Buy now', subheadline: 'Save time' },
      { approach: 'brand_led', headline: 'Our story', subheadline: 'Made with care' },
      { approach: 'problem_aware', headline: 'Struggling?', subheadline: 'We fix it' },
    ],
    primary_cta: 'Shop now',
    secondary_cta: '',
    sections: [
      { section_name: 'Benefits', headline: 'Why', body: 'Because.', bullets: ['a', 'b', 'c'], cta: 'Go' },
      { section_name: 'Proof', headline: 'Trust', body: 'Yes.', bullets: ['x'], cta: 'Go' },
    ],
    trust_elements: ['Secure checkout'],
    faq: [{ question: 'Q?', answer: 'A.' }],
    design_notes: 'Clean layout.',
  };
}

test('schema enum covers all nine page types', () => {
  const enumVals = websiteKitSchema.properties.pages.items.properties.page_type.enum;
  assert.deepEqual([...enumVals].sort(), [...PAGE_TYPES].sort());
});

test('a well-formed page validates for every page type', () => {
  for (const pt of PAGE_TYPES) {
    const errs = validate(websiteKitSchema.properties.pages.items, samplePage(pt));
    assert.deepEqual(errs, [], `${pt}: ${errs.join('; ')}`);
  }
});

test('hero_directions and secondary_cta are required by the schema', () => {
  const req = websiteKitSchema.properties.pages.items.required;
  assert.ok(req.includes('hero_directions'));
  assert.ok(req.includes('secondary_cta'));
});

test('missing hero_directions fails validation', () => {
  const bad = samplePage('home');
  delete bad.hero_directions;
  assert.ok(validate(websiteKitSchema.properties.pages.items, bad).length > 0);
});

test('quality checks flag long meta, long SEO title and missing goal', () => {
  const w = checkWebsitePages([
    {
      page_type: 'home',
      page_goal: '',
      h1: 'H',
      primary_cta: 'Go',
      seo_title: 'x'.repeat(70),
      meta_description: 'y'.repeat(200),
      sections: [{ bullets: ['a', 'b', 'c'] }],
    },
  ]);
  assert.ok(w.some((m) => /conversion goal/.test(m)));
  assert.ok(w.some((m) => /SEO title is over 60/.test(m)));
  assert.ok(w.some((m) => /meta description is over 160/.test(m)));
});

test('quality checks pass a clean page', () => {
  const w = checkWebsitePages([samplePage('home')]);
  assert.deepEqual(w, []);
});

test('markdown export keeps page structure', async () => {
  const modUrl = pathToFileURL(path.join(__dirname, '..', '..', 'app-src', 'lib', 'export.js')).href;
  const { websitePageMarkdown } = await import(modUrl);
  const md = websitePageMarkdown({ seo_title: 'T', meta_description: 'M', sections: samplePage('product') });
  assert.match(md, /# PRODUCT/);
  assert.match(md, /Hero directions/);
  assert.match(md, /direct response/);
  assert.match(md, /### Benefits/);
  assert.match(md, /### FAQ/);
});
