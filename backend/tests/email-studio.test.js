// v5 Prompt 9 — unified Email Studio: schema coverage (lifecycle + campaign
// types, subject options), brief-sourced promo windows with timezone, honest
// urgency, and Markdown / plain-text export.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const { emailFlowSchema, campaignEmailSchema } = require('../lib/schemas');
const { checkEmails } = require('../lib/quality-checks');

const previewUrl = pathToFileURL(path.join(__dirname, '..', '..', 'app-src', 'lib', 'email-preview.js')).href;

test('lifecycle schema knows back-in-stock and sunset flows', () => {
  const flows = emailFlowSchema.properties.items.items.properties.flow_type.enum;
  assert.ok(flows.includes('back_in_stock'));
  assert.ok(flows.includes('sunset'));
});

test('lifecycle emails require subject options and full body copy', () => {
  const req = emailFlowSchema.properties.items.items.required;
  assert.ok(req.includes('subject_options'));
  assert.ok(req.includes('body_copy'));
});

test('campaign schema exposes all nine campaign types', () => {
  const types = campaignEmailSchema.properties.campaign_type.enum;
  assert.deepEqual([...types].sort(), [
    'announcement', 'educational', 'flash_offer', 'last_chance', 'newsletter',
    'product_launch', 'promotion', 'restock', 'seasonal',
  ]);
});

test('campaign emails now carry objective, headline, secondary CTA, segment and exclusions', () => {
  const req = campaignEmailSchema.properties.items.items.required;
  for (const f of ['objective', 'headline', 'secondary_cta', 'segment', 'exclusions', 'subject_options', 'body_copy']) {
    assert.ok(req.includes(f), `campaign item missing required: ${f}`);
  }
});

test('promoWindow is empty without dates and never invents one', async () => {
  const { promoWindow } = await import(previewUrl);
  assert.equal(promoWindow({}), '');
  assert.equal(promoWindow({ timezone: 'UTC' }), '');
});

test('promoWindow reflects the brief dates and timezone', async () => {
  const { promoWindow } = await import(previewUrl);
  assert.equal(promoWindow({ start_date: '2026-08-01', end_date: '2026-08-07', timezone: 'America/New_York' }),
    '2026-08-01 → 2026-08-07 (America/New_York)');
  assert.equal(promoWindow({ end_date: '2026-08-07' }), 'Ends 2026-08-07');
});

test('quality flags fake urgency without a deadline, allows it with one', () => {
  const email = { subject_line: 'Last chance — ends tonight', preheader: 'Hurry', cta: 'Shop', body_copy: 'Act now, ends tonight.' };
  assert.ok(checkEmails([email], { hasDeadline: false }).some((m) => /urgency without a real deadline/.test(m)));
  assert.ok(!checkEmails([email], { hasDeadline: true }).some((m) => /urgency without a real deadline/.test(m)));
});

test('plain-text export includes compliance footer placeholders', async () => {
  const { emailPlainText } = await import(previewUrl);
  const txt = emailPlainText({ subject_line: 'Hi', preheader: 'p', body_copy: '**Bold** body', cta: 'Go' });
  assert.match(txt, /Subject: Hi/);
  assert.match(txt, /Bold body/); // markdown stripped
  assert.match(txt, /Unsubscribe/);
});

test('markdown export lists subject options and body', async () => {
  const { emailMarkdown } = await import(previewUrl);
  const md = emailMarkdown({ flow_type: 'welcome', objective: 'Say hi', subject_options: ['A', 'B'], preheader: 'p', body_copy: 'Hello there', cta: 'Go' });
  assert.match(md, /Subject options/);
  assert.match(md, /- A/);
  assert.match(md, /Hello there/);
});
