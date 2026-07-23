// v9 SC-06 — pure field-level version comparison for the Library asset drawer.
// Classifies each editable field as Added / Removed / Changed / Unchanged so a
// restore is only ever confirmed against a real, visible difference.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const modUrl = pathToFileURL(path.join(__dirname, '..', '..', 'app-src', 'lib', 'version-diff.js')).href;
const FIELDS = [['subject_line', 'Subject line'], ['cta', 'Primary CTA'], ['preheader', 'Preheader']];

test('diffFields classifies changed, added, removed and unchanged', async () => {
  const { diffFields } = await import(modUrl);
  const before = { subject_line: '20% off', cta: 'Shop now', preheader: 'Ends soon' };
  const after = { subject_line: '30% off', cta: 'Shop now', preheader: '' };
  const byField = Object.fromEntries(diffFields(before, after, FIELDS).map((d) => [d.field, d]));
  assert.equal(byField.subject_line.status, 'changed');
  assert.equal(byField.subject_line.before, '20% off');
  assert.equal(byField.subject_line.after, '30% off');
  assert.equal(byField.cta.status, 'unchanged');
  assert.equal(byField.preheader.status, 'removed');
});

test('an empty-to-value field is Added', async () => {
  const { diffFields } = await import(modUrl);
  const d = diffFields({ cta: '' }, { cta: 'Buy the bundle' }, [['cta', 'CTA']]);
  assert.equal(d[0].status, 'added');
});

test('array fields are normalised before comparison', async () => {
  const { diffFields } = await import(modUrl);
  const same = diffFields({ tags: ['a', 'b'] }, { tags: ['a', 'b'] }, [['tags', 'Tags']]);
  assert.equal(same[0].status, 'unchanged');
  const changed = diffFields({ tags: ['a'] }, { tags: ['a', 'b'] }, [['tags', 'Tags']]);
  assert.equal(changed[0].status, 'changed');
});

test('changedFields drops unchanged rows; diffSummary counts by kind', async () => {
  const { changedFields, diffSummary } = await import(modUrl);
  const before = { subject_line: 'A', cta: 'Shop', preheader: 'x' };
  const after = { subject_line: 'B', cta: 'Shop', preheader: '' };
  assert.equal(changedFields(before, after, FIELDS).length, 2);
  assert.equal(diffSummary(before, after, FIELDS), '1 changed, 1 removed');
  assert.equal(diffSummary(before, before, FIELDS), '');
});

test('missing/null values are treated as empty, never as a false change', async () => {
  const { diffFields } = await import(modUrl);
  const d = diffFields({}, { cta: null }, [['cta', 'CTA']]);
  assert.equal(d[0].status, 'unchanged');
});
