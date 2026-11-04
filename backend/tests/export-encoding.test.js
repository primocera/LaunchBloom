// Export encoding (2026-11 review):
//   - PDF text kept EU letters only as plain ASCII, so "Café Čokolada" came out
//     as "Caf okolada"; it now keeps WinAnsi letters and drops only the accent
//     of letters outside it;
//   - XML-invalid control characters made Word refuse a .docx;
//   - CSV cells starting with = + - @ ran as formulas in Excel / Sheets.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

process.env.SESSION_SECRET = 'test-secret-for-unit-tests';
const { pdfText, xmlEscape } = require('../lib/handoff-docs');

test('PDF text keeps EU letters instead of dropping them', () => {
  assert.equal(pdfText('Café Čokolada'), 'Café Cokolada');
  assert.equal(pdfText('Müller Straße'), 'Müller Straße');
  // š / ž live in WinAnsi's 0x80-0x9F block: written as their WinAnsi byte.
  assert.equal(pdfText('šž'), String.fromCharCode(0x9a, 0x9e));
  // ó is Latin-1 (kept); ź has no WinAnsi byte (accent dropped); Đ/Ł have no decomposition.
  assert.equal(pdfText('Đurđa Łódź'), 'Durda Lódz');
  assert.equal(pdfText('price €12'), `price ${String.fromCharCode(0x80)}12`);
});

test('PDF text still escapes string delimiters and drops what it cannot encode', () => {
  assert.equal(pdfText('a (b) \\ c'), 'a \\(b\\) \\\\ c');
  assert.equal(pdfText('ok ✓'), 'ok ');
  assert.equal(pdfText('“quoted” – dash'), '"quoted" - dash');
});

test('DOCX text strips XML-invalid control characters but keeps tabs and newlines', () => {
  assert.equal(xmlEscape('a\u000bb\u0000c'), 'abc');
  assert.equal(xmlEscape('tab\tnew\nline'), 'tab\tnew\nline');
  assert.equal(xmlEscape('<x & "y">'), '&lt;x &amp; &quot;y&quot;&gt;');
});

test('CSV exports neutralise formula-leading cells', async () => {
  const { assetsCsv, contentPlanCsv } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'app-src', 'lib', 'export.js')).href
  );
  const csv = assetsCsv([{ title: '=HYPERLINK("http://x","click")', status: '@me', platform: '+1', language: '-2' }]);
  const row = csv.split('\n')[1];
  assert.match(row, /"'=HYPERLINK\(""http:\/\/x"",""click""\)"/);
  assert.match(row, /"'@me"/);
  assert.match(row, /"'\+1"/);
  assert.match(row, /"'-2"/);
  const plan = contentPlanCsv([{ day_number: 1, hook: 'Plain hook', cta: '=1+1' }]);
  assert.match(plan, /"Plain hook"/);
  assert.match(plan, /"'=1\+1"/);
});
