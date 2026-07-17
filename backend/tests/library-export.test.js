// v5 Prompt 13 — library export helpers: placeholder detection, plain-text /
// CSV export fidelity, and Word-doc wrapping.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const modUrl = pathToFileURL(path.join(__dirname, '..', '..', 'app-src', 'lib', 'export.js')).href;

test('findPlaceholders reports unresolved [PLACEHOLDER] tokens, ignoring md links', async () => {
  const { findPlaceholders } = await import(modUrl);
  assert.deepEqual(findPlaceholders('Add your [Company Address] and [Phone] here'), ['[Company Address]', '[Phone]']);
  assert.deepEqual(findPlaceholders('See [our guide](https://x.com) for more'), []);
  assert.deepEqual(findPlaceholders({ body: 'All good, no tokens' }), []);
});

test('assetPlainText includes the current content and skips internal ids', async () => {
  const { assetPlainText } = await import(modUrl);
  const txt = assetPlainText({ id: 'x', workspace_id: 'w', title: 'Hi', body_copy: 'Full body', tags: ['a', 'b'] });
  assert.match(txt, /title: Hi/);
  assert.match(txt, /body copy: Full body/);
  assert.match(txt, /tags: a; b/);
  assert.ok(!/workspace_id/.test(txt));
});

test('assetsCsv emits a header and one row per item', async () => {
  const { assetsCsv } = await import(modUrl);
  const csv = assetsCsv([{ type_label: 'Email', title: 'A "quoted" one', status: 'ready' }]);
  const lines = csv.split('\n');
  assert.match(lines[0], /type_label,title,status/);
  assert.match(lines[1], /"A ""quoted"" one"/); // CSV-escaped
});

test('toWordDoc wraps text in a Word-openable HTML document', async () => {
  const { toWordDoc } = await import(modUrl);
  const doc = toWordDoc('My asset', 'line one\nline two');
  assert.match(doc, /schemas-microsoft-com:office:word/);
  assert.match(doc, /<p>line one<\/p>/);
});
