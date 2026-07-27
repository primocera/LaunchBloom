// ---------------------------------------------------------------------------
// v11 SC-05 — handoff exports are valid, readable and bounded.
//
// The v10 suite proved the documents parse. That is not the same as proving a
// client can open them: it says nothing about what happens to a maximum-size
// campaign, an emoji in a campaign name, a 400-character URL, or whether the
// ZIP's own CRCs actually match its contents. It also says nothing about the
// runtime headroom this has on a serverless tier.
//
// Every fixture here is synthetic. Nothing calls a network or a database.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');

const {
  buildDocx, buildPdf, buildBundle, safeFilename, outline, LIMITS, FORMATS,
} = require('../lib/handoff-docs');

const META = {
  generatedAt: '2026-07-27T00:00:00.000Z',
  fingerprint: 'a1b2c3d4e5f60718',
  disclosure: 'This is a handoff record. It is not an approval.',
};

// ── fixtures: minimal, normal, maximum, hostile ───────────────────────────

// The shape below is the canonical handoffManifest() contract (see
// handoffManifest in backend/routes/campaigns.js). Getting it wrong is easy
// and silent: a manifest with the wrong keys renders an EMPTY document that
// still passes every structural check, which is why the size assertions in
// this file compare fixtures against each other rather than to a constant.
const ASSET_TYPES = ['website_pages', 'email_assets', 'social_assets', 'creative_assets', 'seo_assets'];

function manifest({ assets = 4, findings = 2, name = 'Autumn cohort launch', over = {} } = {}) {
  return {
    packet_version: 'handoff-1',
    rules_version: 'v8.1',
    campaign: {
      name,
      objective: 'Fill the October cohort',
      audience: 'Independent consultants',
      offer: 'Four-week group programme',
      key_message: 'One repeatable offer beats five scattered ones.',
      promo_terms: 'Early-bird closes 24 September',
      proof: 'Twelve cohorts delivered since 2023',
      dates: '2026-10-01 → 2026-10-31',
      brief_approved: true,
      ...over,
    },
    deliverable_plan: ASSET_TYPES.map((t) => ({ code: t, label: t.replace(/_/g, ' '), requirement: 'required' })),
    included_assets: Array.from({ length: assets }, (_, i) => ({
      type: ASSET_TYPES[i % 5],
      title: `Asset ${i} — cohort launch`,
      status: ['draft', 'edited', 'ready'][i % 3],
    })),
    excluded_assets: Array.from({ length: Math.floor(assets / 8) }, (_, i) => ({
      type: ASSET_TYPES[i % 5], title: `Archived asset ${i}`, status: 'draft', reason: 'archived',
    })),
    unresolved: {
      blocking: Array.from({ length: Math.ceil(findings / 2) }, (_, i) => ({
        code: 'unsupported_claim', assets: [`Asset ${i} — cohort launch`],
      })),
      findings: Array.from({ length: Math.floor(findings / 2) }, (_, i) => ({
        code: 'conflicting_cta_url', status: 'open', assets: [`Asset ${i} — cohort launch`],
      })),
      brief_changes: [], needs_review: [], evidence_reminders: [],
    },
    evidence: [],
    responsibilities: ['Review every asset before publishing.'],
  };
}

const FIXTURES = {
  minimal: manifest({ assets: 0, findings: 0 }),
  normal: manifest(),
  // "Maximum supported" for this product: five channels' worth of assets on a
  // large campaign. Well under the byte limits, which is the point — the
  // limits must not be reachable by an ordinary customer.
  maximum: manifest({ assets: 120, findings: 40 }),
  unicode: manifest({
    name: 'Кампания 🌤️ — Zürich «Herbst» 秋のキャンペーン',
    over: { key_message: 'Ünïcødé ✅ emoji 🎉 and a “curly” quote — plus an en–dash.' },
  }),
  longStrings: manifest({
    name: 'A'.repeat(300),
    over: {
      proof: `https://example.invalid/${'segment/'.repeat(50)}?q=${'x'.repeat(200)}`,
      promo_terms: 'word '.repeat(400),
    },
  }),
};

// ── ZIP reader: verifies the archive against its own recorded CRCs ────────

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

/** Read every entry from the central directory, verifying each CRC. */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'no end-of-central-directory record: this is not a readable ZIP');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const entries = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, `central directory entry ${i} has a bad signature`);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    // Follow the local header to the bytes themselves.
    assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, `${name} has a bad local header`);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const stored = buf.slice(start, start + compSize);
    const data = method === 8 ? zlib.inflateRawSync(stored) : stored;

    assert.equal(data.length, rawSize, `${name}: uncompressed size does not match the directory`);
    assert.equal(crc32(data), crc, `${name}: CRC mismatch — the archive is corrupt`);

    entries.push({ name, data, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ── DOCX / PDF ────────────────────────────────────────────────────────────

test('a bigger campaign really does produce a bigger document', () => {
  // Written after a fixture with the wrong manifest keys rendered an EMPTY
  // document that still satisfied every structural assertion — including a
  // "maximum" campaign whose DOCX was byte-identical to the minimal one.
  // Any limits or performance claim measured on such a fixture is worthless.
  // Compressed DOCX bytes are a poor measure — repetitive asset rows deflate
  // away — so content is measured where it is not compressed: the outline
  // itself, the uncompressed document.xml, and the PDF.
  const content = (m) => ({
    blocks: outline(m, META).length,
    xml: readZip(buildDocx(m, META)).find((e) => e.name === 'word/document.xml').data.length,
    pdf: buildPdf(m, META).length,
  });
  const min = content(FIXTURES.minimal);
  const normal = content(FIXTURES.normal);
  const max = content(FIXTURES.maximum);

  assert.ok(normal.blocks > min.blocks, 'a campaign with assets must render more blocks than one without');
  assert.ok(max.blocks > normal.blocks * 4, `a 120-asset campaign rendered only ${max.blocks} blocks against ${normal.blocks}`);
  assert.ok(max.xml > normal.xml * 3, 'the Word document must actually contain the extra assets');
  assert.ok(max.pdf > normal.pdf * 3, 'the PDF must grow with the campaign too');
});

test('every fixture produces a DOCX whose CRCs and parts verify', () => {
  for (const [label, m] of Object.entries(FIXTURES)) {
    const entries = readZip(buildDocx(m, META));
    const names = entries.map((e) => e.name);
    for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
      assert.ok(names.includes(required), `${label}: DOCX is missing ${required}`);
    }
    const xml = entries.find((e) => e.name === 'word/document.xml').data.toString('utf8');
    assert.match(xml, /^<\?xml/, `${label}: document.xml has no XML declaration`);
    // Balanced paragraph tags — Word repairs (and warns about) unbalanced XML.
    assert.equal(
      (xml.match(/<w:p>/g) || []).length,
      (xml.match(/<\/w:p>/g) || []).length,
      `${label}: unbalanced <w:p> — Word would report a repair`,
    );
    assert.ok(!/<w:p>\s*<\/w:p>/.test(xml), `${label}: an empty paragraph would render as a blank line run`);
  }
});

test('a DOCX carries every outline block, so nothing is silently dropped', () => {
  for (const [label, m] of Object.entries(FIXTURES)) {
    const blocks = outline(m, META);
    const xml = readZip(buildDocx(m, META)).find((e) => e.name === 'word/document.xml').data.toString('utf8');
    assert.equal(
      (xml.match(/<w:p>/g) || []).length,
      blocks.length,
      `${label}: the Word file has a different number of paragraphs than the outline`,
    );
  }
});

test('a PDF declares as many page objects as it puts in its page tree', () => {
  for (const [label, m] of Object.entries(FIXTURES)) {
    const pdf = buildPdf(m, META).toString('latin1');
    const pageObjects = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const declared = Number((pdf.match(/\/Count\s+(\d+)/) || [])[1]);
    assert.ok(pageObjects > 0, `${label}: the PDF has no pages`);
    assert.equal(declared, pageObjects, `${label}: /Count says ${declared} but ${pageObjects} pages exist`);
  }
});

test('a PDF has no blank page and no line that runs off the page', () => {
  for (const [label, m] of Object.entries(FIXTURES)) {
    const pdf = buildPdf(m, META).toString('latin1');
    // Each content stream must actually draw text. Matched on the whole
    // `<< /Length n >> stream ... endstream` shape — splitting on "stream\n"
    // also matches inside "endstream\n" and invents a page that is not there.
    const streams = [...pdf.matchAll(/\/Length\s+\d+\s*>>\s*stream\n([\s\S]*?)\nendstream/g)].map((m2) => m2[1]);
    assert.ok(streams.length > 0, `${label}: no content streams found`);
    for (const [i, stream] of streams.entries()) {
      assert.match(stream, /\(/, `${label}: page ${i + 1} draws nothing — a blank page in a client document`);
    }
    // The wrap width is enforced, so no drawn string exceeds it.
    for (const m2 of pdf.matchAll(/\((?:\\.|[^()\\])*\)\s*Tj/g)) {
      const text = m2[0].replace(/\)\s*Tj$/, '').slice(1);
      assert.ok(text.length <= 120, `${label}: a ${text.length}-character line would run past the margin`);
    }
  }
});

test('a 300-character campaign name is wrapped, never clipped', () => {
  const pdf = buildPdf(FIXTURES.longStrings, META).toString('latin1');
  // The name must appear in full across the drawn lines.
  const drawn = [...pdf.matchAll(/\((?:\\.|[^()\\])*\)\s*Tj/g)].map((m) => m[0]).join('');
  assert.ok(drawn.includes('A'.repeat(60)), 'the long name was truncated instead of wrapped');
});

test('the bundle, the Word file and the PDF describe the same manifest', () => {
  const entries = readZip(buildBundle(FIXTURES.normal, META));
  const names = entries.map((e) => e.name);
  for (const required of ['README.txt', 'manifest.json', 'handoff.docx', 'handoff.pdf']) {
    assert.ok(names.includes(required), `bundle is missing ${required}`);
  }
  const bundled = JSON.parse(entries.find((e) => e.name === 'manifest.json').data.toString('utf8'));
  // Preview and every format read the same record: there is no second
  // content-selection rule per format.
  assert.equal(bundled.included_assets.length, FIXTURES.normal.included_assets.length);
  assert.equal(bundled.excluded_assets.length, FIXTURES.normal.excluded_assets.length);
  assert.equal(bundled.campaign.name, FIXTURES.normal.campaign.name);

  // The embedded documents are byte-identical to the standalone ones.
  assert.deepEqual(entries.find((e) => e.name === 'handoff.docx').data, buildDocx(FIXTURES.normal, META));
  assert.deepEqual(entries.find((e) => e.name === 'handoff.pdf').data, buildPdf(FIXTURES.normal, META));
});

test('the fingerprint appears in every format, so a client can match them', () => {
  const docx = readZip(buildDocx(FIXTURES.normal, META))
    .find((e) => e.name === 'word/document.xml').data.toString('utf8');
  const pdf = buildPdf(FIXTURES.normal, META).toString('latin1');
  const readme = readZip(buildBundle(FIXTURES.normal, META))
    .find((e) => e.name === 'README.txt').data.toString('utf8');
  for (const [label, body] of [['docx', docx], ['pdf', pdf], ['README', readme]]) {
    assert.ok(body.includes(META.fingerprint), `${label} does not carry the fingerprint`);
  }
});

// ── archive safety ────────────────────────────────────────────────────────

test('no archive entry can escape the directory it is extracted into', () => {
  for (const build of [buildDocx, buildBundle]) {
    for (const entry of readZip(build(FIXTURES.longStrings, META))) {
      assert.ok(!entry.name.includes('..'), `path traversal in ${entry.name}`);
      assert.ok(!entry.name.startsWith('/'), `absolute path in ${entry.name}`);
      assert.ok(!/^[a-zA-Z]:/.test(entry.name), `drive-qualified path in ${entry.name}`);
      assert.ok(!entry.name.includes('\\'), `backslash path separator in ${entry.name}`);
      assert.ok(!/\0/.test(entry.name), `null byte in ${entry.name}`);
    }
  }
});

test('archive entry names come from a fixed set, never from campaign data', () => {
  // A customer-controlled filename inside an archive is how a hostile name
  // becomes a hostile path. The campaign name only reaches the DOWNLOAD
  // filename, which is separately sanitised.
  const hostile = manifest({ name: '../../etc/passwd .txt' });
  for (const entry of readZip(buildBundle(hostile, META))) {
    assert.match(entry.name, /^(README\.txt|manifest\.json|handoff\.(docx|pdf))$/);
  }
});

test('download filenames are sanitised even for hostile campaign names', () => {
  for (const name of ['../../etc/passwd', 'a\\b/c', 'con', '  ..  ', '🎉'.repeat(50), '']) {
    const file = safeFilename(name, META.fingerprint, 'zip');
    assert.ok(!file.includes('..'), `traversal survives in ${file}`);
    assert.ok(!file.includes('/') && !file.includes('\\'), `separator survives in ${file}`);
    assert.match(file, /\.zip$/);
    assert.ok(file.length > 4 && file.length <= 120, `implausible filename length: ${file}`);
  }
});

test('there is no tabular export, so formula injection has no surface here', () => {
  // If a CSV/TSV format is ever added, values starting with = + - @ must be
  // prefixed. Asserting the absence keeps that decision deliberate.
  assert.deepEqual(Object.keys(FORMATS).sort(), ['docx', 'pdf', 'zip']);
  for (const entry of readZip(buildBundle(FIXTURES.normal, META))) {
    assert.ok(!/\.(csv|tsv|xls|xlsx)$/i.test(entry.name), `unexpected tabular file ${entry.name}`);
  }
});

// ── bounds ────────────────────────────────────────────────────────────────

test('an ordinary maximum campaign stays far inside the download limit', () => {
  const bundle = buildBundle(FIXTURES.maximum, META);
  assert.ok(
    bundle.length < LIMITS.MAX_TOTAL_BYTES / 2,
    `a 120-asset campaign produced ${bundle.length} bytes; the limit must not be reachable by ordinary use`,
  );
});

test('exceeding a limit fails closed instead of delivering a truncated file', () => {
  const huge = manifest({ assets: 0, findings: 0 });
  huge.responsibilities = ['x'.repeat(LIMITS.MAX_PART_BYTES + 1)];
  assert.throws(
    () => buildBundle(huge, META),
    (err) => {
      assert.equal(err.code, 'EXPORT_TOO_LARGE');
      assert.ok(err.limit > 0 && err.actual > err.limit, 'the error must state the limit and the actual size');
      return true;
    },
    'an oversized export must throw, never return a partial document',
  );
});

test('export cost stays inside the documented serverless headroom', () => {
  // Measured here rather than asserted from memory, so a change in the
  // generator that makes exports expensive fails the build.
  const before = process.memoryUsage().heapUsed;
  const started = process.hrtime.bigint();
  const bundle = buildBundle(FIXTURES.maximum, META);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const heapMb = (process.memoryUsage().heapUsed - before) / (1024 * 1024);

  // Documented in docs/EXPORT_LIMITS_V11.md with the numbers actually
  // observed; these thresholds are the headroom, not the measurement.
  assert.ok(ms < 3000, `the maximum bundle took ${ms.toFixed(0)}ms — well past the documented headroom`);
  assert.ok(heapMb < 128, `the maximum bundle allocated ${heapMb.toFixed(1)}MB of heap`);
  assert.ok(bundle.length > 0);
});
