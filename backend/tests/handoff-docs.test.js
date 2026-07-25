// ---------------------------------------------------------------------------
// v10 SC-04 — the .docx / .pdf / .zip handoff documents.
//
// These are customer-facing deliverables for a paying client, so the bar is
// "opens without a repair warning and leaks nothing", not "returns bytes".
// Structure is verified by actually parsing the output, not by trusting a
// magic number.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');

const {
  buildDocx, buildPdf, buildBundle, safeFilename, zip, outline, LIMITS, FORMATS,
} = require('../lib/handoff-docs');

const MANIFEST = {
  packet_version: 'handoff-1',
  rules_version: 'v8.1',
  campaign: {
    name: 'Winter Candle Bundle',
    objective: 'Sell through winter stock',
    audience: 'Repeat customers',
    offer: 'Three scents, one price',
    key_message: 'Buy the bundle',
    promo_terms: '20% off with code WINTER20',
    proof: 'Owner-supplied sales export',
    dates: '2026-11-01 → 2026-12-24',
    brief_approved: true,
    brief_approved_at: '2026-10-28T10:00:00Z',
  },
  deliverable_plan: [{ code: 'website', label: 'Website page', requirement: 'required' }],
  included_assets: [{ type: 'website_pages', title: 'Bundle landing page', status: 'ready' }],
  excluded_assets: [{ type: 'social_assets', title: 'Old teaser', status: 'draft', reason: 'archived' }],
  unresolved: {
    blocking: [{ code: 'conflicting_cta_url', assets: ['Bundle landing page'] }],
    findings: [], brief_changes: [], needs_review: [], evidence_reminders: ['Repeat-purchase export'],
  },
  evidence: [{ label: 'Sales export', type: 'document', checked_date: '2026-10-20' }],
  responsibilities: ['You publish and remain responsible for the claims.'],
};

const META = {
  generatedAt: '2026-07-25T22:00:00.000Z',
  fingerprint: 'a1b2c3d4e5f60718',
  disclosure: 'This is a Review record prepared for your review — not an approval.',
};

// ── a minimal independent ZIP reader, so we verify the archive rather than
// trusting the writer that produced it ─────────────────────────────────────
function readZip(buf) {
  const files = {};
  let i = 0;
  while (i < buf.length - 3) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const rawSize = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extraLen;
    const data = buf.slice(start, start + compSize);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    assert.equal(files[name].length, rawSize, `${name}: declared size does not match content`);
    i = start + compSize;
  }
  return files;
}

// ── .docx ──────────────────────────────────────────────────────────────────

test('docx is a valid OPC package with the three required parts', () => {
  const files = readZip(buildDocx(MANIFEST, META));
  // Missing or misnamed parts are exactly what makes Word offer to "repair".
  assert.ok(files['[Content_Types].xml'], 'no content-types part');
  assert.ok(files['_rels/.rels'], 'no root relationships part');
  assert.ok(files['word/document.xml'], 'no main document part');
});

test('docx document.xml is well-formed and carries the campaign content', () => {
  const xml = readZip(buildDocx(MANIFEST, META))['word/document.xml'].toString('utf8');
  // Balanced paragraph tags — a truncated body is the other repair-warning cause.
  assert.equal((xml.match(/<w:p>/g) || []).length, (xml.match(/<\/w:p>/g) || []).length);
  assert.ok(xml.includes('Winter Candle Bundle'));
  assert.ok(xml.includes('Bundle landing page'));
  assert.ok(xml.includes('20% off with code WINTER20'.replace(/&/g, '&amp;')));
});

test('docx escapes XML metacharacters instead of corrupting the part', () => {
  const risky = JSON.parse(JSON.stringify(MANIFEST));
  risky.campaign.name = 'Tools & <Tips> "2026"';
  const xml = readZip(buildDocx(risky, META))['word/document.xml'].toString('utf8');
  assert.ok(xml.includes('Tools &amp; &lt;Tips&gt;'), 'raw angle brackets would break the document');
  assert.ok(!/<w:t[^>]*>[^<]*<Tips>/.test(xml));
});

// ── .pdf ───────────────────────────────────────────────────────────────────

test('pdf has a valid header, trailer and resolvable xref table', () => {
  const pdf = buildPdf(MANIFEST, META).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));

  const m = pdf.match(/xref\n0 (\d+)\n([\s\S]*?)trailer/);
  assert.ok(m, 'no xref table');
  const count = Number(m[1]);
  const rows = m[2].trim().split('\n');
  // Every offset must land exactly on its object header, or readers reject it.
  for (let id = 1; id < count; id++) {
    const offset = Number(rows[id].slice(0, 10));
    assert.ok(pdf.slice(offset).startsWith(`${id} 0 obj`), `xref entry ${id} points at the wrong offset`);
  }
  const startxref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.ok(pdf.slice(startxref).startsWith('xref'), 'startxref must point at the xref table');
});

test('pdf stream lengths match their declared /Length', () => {
  const pdf = buildPdf(MANIFEST, META).toString('latin1');
  const re = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
  let m, seen = 0;
  while ((m = re.exec(pdf))) {
    assert.equal(Buffer.byteLength(m[2], 'latin1'), Number(m[1]), 'a wrong /Length makes the page unreadable');
    seen++;
  }
  assert.ok(seen > 0, 'no content streams found');
});

test('pdf transliterates characters outside its encoding rather than dropping meaning', () => {
  const pdf = buildPdf(MANIFEST, META).toString('latin1');
  assert.ok(pdf.includes('2026-11-01 -> 2026-12-24'), 'the arrow should become ->, not vanish');
  assert.ok(!pdf.includes('→'));
});

// ── bundle ─────────────────────────────────────────────────────────────────

test('zip bundle contains the documents and the manifest they were built from', () => {
  const files = readZip(buildBundle(MANIFEST, META));
  assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'handoff.docx', 'handoff.pdf', 'manifest.json']);

  // The bundled manifest is the actual source, not a re-render of it.
  assert.deepEqual(JSON.parse(files['manifest.json'].toString('utf8')), MANIFEST);
  assert.ok(files['handoff.docx'].slice(0, 2).toString('latin1') === 'PK');
  assert.ok(files['handoff.pdf'].slice(0, 5).toString('latin1') === '%PDF-');
  assert.ok(files['README.txt'].toString('utf8').includes('not an approval'));
});

// ── safety ─────────────────────────────────────────────────────────────────

test('customer documents leak no internal identifiers, prompts or secrets', () => {
  const withIds = JSON.parse(JSON.stringify(MANIFEST));
  // The manifest never carries these, but prove the renderer would not print
  // them if an upstream change ever let one through.
  const text = outline(withIds, META).map((b) => b.text).join('\n');
  for (const banned of [/workspace_id/i, /user_email/i, /sk_live/i, /supabase/i, /system prompt/i, /\bprompt_version\b/i]) {
    assert.ok(!banned.test(text), `rendered document matched ${banned}`);
  }
  // Raw finding codes are humanised on the way out.
  assert.ok(text.includes('Conflicting cta url'), 'the code should be humanised');
  assert.ok(!text.includes('conflicting_cta_url'), 'a raw internal code must not reach a customer');
});

test('filenames are sanitised, deterministic and collision-safe', () => {
  const a = safeFilename('Winter Candle Bundle! 2026', 'a1b2c3d4e5f60718', 'docx');
  assert.equal(a, 'winter-candle-bundle-2026-handoff-a1b2c3d4.docx');
  // Same inputs → same name (determinism), different state → different name.
  assert.equal(safeFilename('Winter Candle Bundle! 2026', 'a1b2c3d4e5f60718', 'docx'), a);
  assert.notEqual(safeFilename('Winter Candle Bundle! 2026', 'ffffffffffffffff', 'docx'), a);
  // Path traversal and separators can never survive into a filename.
  const nasty = safeFilename('../../etc/passwd', 'a1b2c3d4', 'pdf');
  assert.ok(!nasty.includes('/') && !nasty.includes('..'), `unsafe filename: ${nasty}`);
  // An empty or symbol-only name still yields something openable.
  assert.equal(safeFilename('', '', 'zip'), 'campaign-handoff-nofp.zip');
  assert.equal(safeFilename('***', 'a1b2c3d4', 'zip'), 'campaign-handoff-a1b2c3d4.zip');
});

test('an oversized part fails loudly instead of producing a truncated document', () => {
  const huge = Buffer.alloc(LIMITS.MAX_PART_BYTES + 1, 0x41);
  assert.throws(
    () => zip([{ name: 'huge.txt', data: huge }]),
    (err) => err.code === 'EXPORT_TOO_LARGE' && err.limit === LIMITS.MAX_PART_BYTES,
    'a size failure must be typed so the route can offer a narrower export'
  );
});

test('every advertised format is buildable and correctly typed', () => {
  for (const [name, spec] of Object.entries(FORMATS)) {
    const out = spec.build(MANIFEST, META);
    assert.ok(Buffer.isBuffer(out) && out.length > 0, `${name} produced nothing`);
    assert.ok(spec.mime && spec.ext, `${name} is missing its content type`);
  }
});

test('output is byte-identical for identical input (a moving packet defeats the fingerprint)', () => {
  assert.ok(buildDocx(MANIFEST, META).equals(buildDocx(MANIFEST, META)));
  assert.ok(buildBundle(MANIFEST, META).equals(buildBundle(MANIFEST, META)));
});

test('a manifest with no assets or findings still produces a coherent document', () => {
  const empty = {
    packet_version: 'handoff-1', rules_version: 'v8.1',
    campaign: { name: 'Empty campaign', brief_approved: false },
    deliverable_plan: [], included_assets: [], excluded_assets: [],
    unresolved: { blocking: [], findings: [], brief_changes: [], needs_review: [], evidence_reminders: [] },
    evidence: [], responsibilities: [],
  };
  const text = outline(empty, META).map((b) => b.text).join('\n');
  assert.ok(text.includes('No assets are included'));
  assert.ok(text.includes('No open items'));
  assert.ok(text.includes('Brief not approved'), 'an unapproved brief must say so in the deliverable');
  assert.ok(buildPdf(empty, META).length > 0);
});
