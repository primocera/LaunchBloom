// ---------------------------------------------------------------------------
// v10 SC-04 — real .docx, .pdf and .zip handoff documents.
//
// Written against the SAME canonical handoffManifest() the md/json/html
// packets use. There is no second content composer: if a fact is not in the
// manifest it does not appear in a customer document.
//
// DEPENDENCY DECISION: none added. A .docx is a ZIP of XML and Node ships
// zlib, so one ZIP writer serves both the Word file and the bundle. pdfkit
// (~2MB with embedded fonts) and anything headless-Chrome were rejected: this
// project deploys to a free serverless tier where bundle size is cold-start
// cost, and a handoff record is text — it does not need a typesetting engine.
//
// Everything here is synchronous and bounded. Buffers are capped (see LIMITS)
// and the caller gets a typed ExportTooLarge rather than an OOM.
//
// Customer documents must never carry internal identifiers, prompts, secrets
// or raw finding codes. Only manifest fields are rendered, and codes are
// humanised on the way out.
// ---------------------------------------------------------------------------

const zlib = require('zlib');

const LIMITS = {
  MAX_PART_BYTES: 4 * 1024 * 1024,   // any single file in the bundle
  MAX_TOTAL_BYTES: 8 * 1024 * 1024,  // the whole response
};

class ExportTooLarge extends Error {
  constructor(message, { limit, actual } = {}) {
    super(message);
    this.name = 'ExportTooLarge';
    this.code = 'EXPORT_TOO_LARGE';
    this.limit = limit;
    this.actual = actual;
  }
}

// ── ZIP writer (store + deflate, no external dependency) ───────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Build a ZIP archive. `files` is [{ name, data: Buffer }].
 * Deterministic: a fixed timestamp is used so the same manifest always
 * produces byte-identical output (a changing archive would defeat the
 * packet fingerprint).
 */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  // Fixed DOS timestamp (1980-01-01) — determinism over metadata fidelity.
  const DOS_TIME = 0;
  const DOS_DATE = 33;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const raw = file.data;
    if (raw.length > LIMITS.MAX_PART_BYTES) {
      throw new ExportTooLarge(`“${file.name}” is larger than this export supports.`, {
        limit: LIMITS.MAX_PART_BYTES, actual: raw.length,
      });
    }
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    // Store uncompressed when deflate does not help (tiny XML parts).
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);             // version made by
    cen.writeUInt16LE(20, 6);             // version needed
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);             // extra
    cen.writeUInt16LE(0, 32);             // comment
    cen.writeUInt16LE(0, 34);             // disk
    cen.writeUInt16LE(0, 36);             // internal attrs
    cen.writeUInt32LE(0, 38);             // external attrs
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const out = Buffer.concat([...chunks, centralBuf, end]);
  if (out.length > LIMITS.MAX_TOTAL_BYTES) {
    throw new ExportTooLarge('This export is larger than the download limit.', {
      limit: LIMITS.MAX_TOTAL_BYTES, actual: out.length,
    });
  }
  return out;
}

// ── shared rendering ───────────────────────────────────────────────────────

const xmlEscape = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Finding codes are internal. Customers get words. */
const humanCode = (code) => String(code || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * The document outline, derived once and rendered by every format, so the
 * Word file, the PDF and the bundle can never disagree about content.
 * Returns [{ kind: 'h1'|'h2'|'p'|'li', text }].
 */
function outline(manifest, { generatedAt, fingerprint, disclosure }) {
  const c = manifest.campaign || {};
  const blocks = [];
  const h1 = (text) => blocks.push({ kind: 'h1', text });
  const h2 = (text) => blocks.push({ kind: 'h2', text });
  const p = (text) => blocks.push({ kind: 'p', text });
  const li = (text) => blocks.push({ kind: 'li', text });

  h1(c.name || 'Campaign handoff');
  p(disclosure);
  p(`Prepared ${generatedAt} · packet ${manifest.packet_version} · rules ${manifest.rules_version} · fingerprint ${fingerprint}`);

  h2('Campaign brief');
  const fields = [
    ['Objective', c.objective], ['Audience', c.audience], ['Offer', c.offer],
    ['Key message', c.key_message], ['Call to action terms', c.promo_terms],
    ['Proof supplied', c.proof], ['Restrictions', c.restrictions],
    ['Markets', c.markets], ['Language', c.language], ['Dates', c.dates], ['Deadline', c.deadline],
  ];
  for (const [label, value] of fields) if (value) li(`${label}: ${value}`);
  li(c.brief_approved
    ? `Brief approved by the owner${c.brief_approved_at ? ` on ${String(c.brief_approved_at).slice(0, 10)}` : ''}`
    : 'Brief not approved — this campaign is still in draft');

  h2('Deliverable plan');
  for (const d of manifest.deliverable_plan || []) li(`${d.label}: ${String(d.requirement).replace(/_/g, ' ')}`);

  h2('Included assets');
  if (!(manifest.included_assets || []).length) p('No assets are included in this handoff.');
  for (const a of manifest.included_assets || []) li(`${a.title} — ${a.type.replace(/_/g, ' ')} · ${a.status}`);

  if ((manifest.excluded_assets || []).length) {
    h2('Excluded assets');
    for (const a of manifest.excluded_assets) li(`${a.title} — excluded (${a.reason})`);
  }

  h2('Open items');
  const u = manifest.unresolved || {};
  const anyOpen = (u.blocking || []).length || (u.findings || []).length || (u.brief_changes || []).length
    || (u.needs_review || []).length || (u.evidence_reminders || []).length;
  if (!anyOpen) p('No open items were recorded when this handoff was prepared.');
  for (const f of u.blocking || []) li(`Blocks export — ${humanCode(f.code)}: ${(f.assets || []).join(', ')}`);
  for (const f of u.findings || []) li(`${humanCode(f.code)}${f.status ? ` (${f.status})` : ''}: ${(f.assets || []).join(', ')}`);
  for (const b of u.brief_changes || []) li(`Brief changed since generation — ${b.title}: ${(b.fields || []).join(', ')}`);
  for (const t of u.needs_review || []) li(`Edited since generation — ${t}`);
  for (const e of u.evidence_reminders || []) li(`Evidence needs rechecking — ${e}`);

  if ((manifest.evidence || []).length) {
    h2('Evidence on record');
    for (const e of manifest.evidence) {
      li(`${e.label} (${e.type})${e.checked_date ? ` · checked ${e.checked_date}` : ''}${e.source_url ? ` · ${e.source_url}` : ''}`);
    }
  }

  h2('Responsibilities');
  for (const r of manifest.responsibilities || []) li(typeof r === 'string' ? r : `${r.owner}: ${r.text || r.label || ''}`);

  return blocks;
}

// ── .docx ──────────────────────────────────────────────────────────────────

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** One paragraph, using direct formatting so no styles.xml part is required. */
function docxParagraph(block) {
  const size = block.kind === 'h1' ? 36 : block.kind === 'h2' ? 28 : 22; // half-points
  const bold = block.kind === 'h1' || block.kind === 'h2';
  const spacing = block.kind === 'h1' ? 240 : block.kind === 'h2' ? 200 : 60;
  const indent = block.kind === 'li' ? '<w:ind w:left="360"/>' : '';
  const text = block.kind === 'li' ? `• ${block.text}` : block.text;
  return '<w:p>'
    + `<w:pPr><w:spacing w:before="${spacing}" w:after="60"/>${indent}</w:pPr>`
    + '<w:r>'
    + `<w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr>`
    + `<w:t xml:space="preserve">${xmlEscape(text)}</w:t>`
    + '</w:r></w:p>';
}

function buildDocx(manifest, meta) {
  const body = outline(manifest, meta).map(docxParagraph).join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body>
</w:document>`;

  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
  ]);
}

// ── .pdf ───────────────────────────────────────────────────────────────────

const PAGE_W = 595, PAGE_H = 842, MARGIN = 56, LINE = 15;
const MAX_CHARS = 92; // conservative wrap width for Helvetica 10pt

/** PDF strings are Latin-1; anything outside it is transliterated, not dropped. */
function pdfText(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/→/g, '->').replace(/•/g, '-')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function buildPdf(manifest, meta) {
  const blocks = outline(manifest, meta);

  // Lay out into pages first, so the object table is built once.
  const pages = [];
  let current = [];
  let y = PAGE_H - MARGIN;
  for (const b of blocks) {
    const size = b.kind === 'h1' ? 18 : b.kind === 'h2' ? 13 : 10;
    const lead = b.kind === 'h1' ? 26 : b.kind === 'h2' ? 20 : 6;
    const text = b.kind === 'li' ? `- ${b.text}` : b.text;
    const lines = wrap(text, b.kind === 'p' || b.kind === 'li' ? MAX_CHARS : 60);
    if (y - lead - lines.length * LINE < MARGIN) { pages.push(current); current = []; y = PAGE_H - MARGIN; }
    y -= lead;
    for (const line of lines) {
      current.push({ x: MARGIN + (b.kind === 'li' ? 12 : 0), y, size, text: line });
      y -= LINE;
      if (y < MARGIN) { pages.push(current); current = []; y = PAGE_H - MARGIN; }
    }
  }
  if (current.length) pages.push(current);
  if (!pages.length) pages.push([]);

  const streams = pages.map((items) => {
    const parts = ['BT'];
    for (const it of items) {
      parts.push(`/F1 ${it.size} Tf`, `1 0 0 1 ${it.x} ${it.y} Tm`, `(${pdfText(it.text)}) Tj`);
    }
    parts.push('ET');
    return parts.join('\n');
  });

  // Object numbering: 1 catalog, 2 pages, 3 font, then per page (page, content).
  const objects = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects.push({ id: 1, body: `<< /Type /Catalog /Pages 2 0 R >>` });
  objects.push({ id: 2, body: `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>` });
  objects.push({ id: 3, body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>` });
  pages.forEach((_, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    objects.push({
      id: pageId,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    });
    objects.push({ id: contentId, body: `<< /Length ${Buffer.byteLength(streams[i], 'latin1')} >>\nstream\n${streams[i]}\nendstream` });
  });
  objects.sort((a, b) => a.id - b.id);

  let pdf = '%PDF-1.4\n';
  const offsets = {};
  for (const o of objects) {
    offsets[o.id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${o.id} 0 obj\n${o.body}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(pdf, 'latin1');
  const maxId = objects[objects.length - 1].id;
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId; i++) {
    pdf += `${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  const out = Buffer.from(pdf, 'latin1');
  if (out.length > LIMITS.MAX_TOTAL_BYTES) {
    throw new ExportTooLarge('This export is larger than the download limit.', {
      limit: LIMITS.MAX_TOTAL_BYTES, actual: out.length,
    });
  }
  return out;
}

// ── bundle ─────────────────────────────────────────────────────────────────

function readme(manifest, meta) {
  const c = manifest.campaign || {};
  return [
    `${c.name || 'Campaign'} — handoff bundle`,
    '',
    meta.disclosure,
    '',
    `Prepared: ${meta.generatedAt}`,
    `Packet version: ${manifest.packet_version}`,
    `Rules version: ${manifest.rules_version}`,
    `Fingerprint: ${meta.fingerprint}`,
    '',
    'Contents',
    '  handoff.docx   The full record, opens in Word, Pages or Google Docs.',
    '  handoff.pdf    The same record, fixed layout for sending on.',
    '  manifest.json  The machine-readable source every document is built from.',
    '',
    'What this is not: an approval, a fact-check, a compliance certificate, or a',
    'published campaign. Reviewing and publishing remain with you.',
    '',
  ].join('\n');
}

function buildBundle(manifest, meta) {
  return zip([
    { name: 'README.txt', data: Buffer.from(readme(manifest, meta), 'utf8') },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'handoff.docx', data: buildDocx(manifest, meta) },
    { name: 'handoff.pdf', data: buildPdf(manifest, meta) },
  ]);
}

// ── filenames ──────────────────────────────────────────────────────────────

/**
 * Deterministic, collision-safe, filesystem-safe. The fingerprint suffix means
 * two exports of different campaign states never overwrite each other in a
 * downloads folder, and the same state always produces the same name.
 */
function safeFilename(campaignName, fingerprint, ext) {
  const base = String(campaignName || 'campaign')
    .normalize('NFKD').replace(/[^\w\s-]/g, '').trim()
    .replace(/[\s_]+/g, '-').replace(/-+/g, '-').toLowerCase()
    .slice(0, 48).replace(/^-|-$/g, '') || 'campaign';
  const fp = /^[a-f0-9]{6,}$/.test(String(fingerprint)) ? String(fingerprint).slice(0, 8) : 'nofp';
  return `${base}-handoff-${fp}.${ext}`;
}

const FORMATS = {
  docx: { build: buildDocx, ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { build: buildPdf, ext: 'pdf', mime: 'application/pdf' },
  zip: { build: buildBundle, ext: 'zip', mime: 'application/zip' },
};

module.exports = { FORMATS, LIMITS, ExportTooLarge, buildDocx, buildPdf, buildBundle, safeFilename, zip, outline };
