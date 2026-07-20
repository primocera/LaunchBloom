// ---------------------------------------------------------------------------
// v8 LB-S02: cross-channel consistency engine.
//
// Deterministic, explainable checks over STRUCTURED asset fields against the
// campaign brief — never an LLM, never an AI action, never a truth claim.
// Pure functions (no supabase); the campaigns route feeds it rows and persists
// finding lifecycles. Checks with limited detection say so explicitly, and a
// clean result means "no issues detected by these checks", not "approved".
// ---------------------------------------------------------------------------

const crypto = require('crypto');

// Bump when rule logic changes so persisted findings can be distinguished.
const RULES_VERSION = 'v8.1';

// Structured text fields we scan per table (jsonb blobs are stringified —
// detection there is "limited" and labeled as such).
const SCAN_FIELDS = {
  website_pages: ['title', 'seo_title', 'meta_description', 'cta'],
  email_assets: ['subject_line', 'preheader', 'headline', 'body_copy', 'cta'],
  social_assets: ['hook', 'caption', 'cta'],
  creative_assets: ['hook', 'headline', 'primary_text', 'cta'],
  seo_assets: ['seo_title', 'meta_description', 'h1'],
};
// Tables whose assets carry a primary CTA field.
const CTA_TABLES = ['website_pages', 'email_assets', 'social_assets', 'creative_assets'];

const FINDING_META = {
  missing_primary_cta: {
    severity: 'medium', ackable: false, detection: 'structured field',
    why: 'An asset without a primary CTA cannot drive the campaign action.',
    resolution: 'Add the campaign CTA to this asset in its studio.',
  },
  conflicting_cta_url: {
    severity: 'high', ackable: false, detection: 'URLs found in structured fields (limited detection)',
    why: 'Assets pointing at different destinations split the campaign and confuse the audience.',
    resolution: 'Pick one destination URL and update the assets that differ.',
  },
  promotion_term_mismatch: {
    severity: 'high', ackable: true, detection: 'discount percentages and promo codes in structured fields (limited detection)',
    why: 'Different discount terms across channels create promises you may not honor.',
    resolution: 'Align every asset with the promo terms in the Campaign Brief, or update the brief.',
  },
  date_or_timezone_mismatch: {
    severity: 'high', ackable: true, detection: 'ISO dates in structured fields (limited detection; timezones are not verified)',
    why: 'A date outside the campaign window can advertise an offer that is not running.',
    resolution: 'Correct the date in the asset or adjust the campaign dates.',
  },
  audience_mismatch: {
    severity: 'medium', ackable: true, detection: 'brief snapshot vs current brief audience field',
    why: 'This asset was generated for a different audience than the brief now targets.',
    resolution: 'Review the asset against the current audience, or keep it intentionally.',
  },
  unsupported_claim_reference: {
    severity: 'high', ackable: true, detection: 'proof-like placeholders in structured fields',
    why: 'The copy references proof the brief does not supply — publishing it would be an unsupported claim.',
    resolution: 'Add real proof to the Campaign Brief or remove the reference.',
  },
  unresolved_placeholder: {
    severity: 'medium', ackable: false, detection: 'bracketed placeholders in structured fields',
    why: 'Placeholder text would ship to customers as-is.',
    resolution: 'Replace the placeholder with the real value in the studio.',
  },
  brief_snapshot_mismatch: {
    severity: 'medium', ackable: true, detection: 'material brief fields vs asset generation-time snapshot',
    why: 'The brief changed after this asset was generated; the asset may be stale.',
    resolution: 'Review the asset against the current brief; keep the snapshot or regenerate.',
  },
};

// Brief fields considered material for snapshot comparison (LB-S02 scope;
// LB-S03 turns this into per-field review).
const MATERIAL_SNAPSHOT_FIELDS = ['offer_summary', 'promo_terms', 'key_message', 'audience', 'start_date', 'end_date', 'deadline'];

const norm = (v) => (v == null ? '' : String(v).trim());
const normLoose = (v) => norm(v).toLowerCase().replace(/\s+/g, ' ');

function fieldsText(table, asset) {
  return (SCAN_FIELDS[table] || [])
    .map((f) => norm(asset[f]))
    .filter(Boolean)
    .join('\n');
}

function assetRef(table, asset) {
  return { table, id: asset.id, title: norm(asset.title || asset.subject_line || asset.hook || asset.h1 || asset.page_type || asset.flow_type) || 'Untitled' };
}

function fingerprint(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function makeFinding(code, { assets = [], expected = null, observed = null, detail = null }) {
  const meta = FINDING_META[code];
  return {
    code,
    severity: meta.severity,
    ackable: meta.ackable,
    detection: meta.detection,
    why: meta.why,
    resolution: meta.resolution,
    assets,
    expected,
    observed,
    detail,
    rule_version: RULES_VERSION,
    fingerprint: fingerprint([
      RULES_VERSION, code,
      ...assets.map((a) => `${a.table}:${a.id}`),
      normLoose(expected), normLoose(observed), normLoose(detail),
    ]),
  };
}

const URL_RX = /https?:\/\/[^\s"'<>)\]]+/gi;
const PCT_RX = /(\d{1,2})\s?%/g;
const CODE_RX = /\bcode\s+([A-Z0-9]{4,15})\b/g;
const ISO_DATE_RX = /\b(20\d{2}-\d{2}-\d{2})\b/g;
const PLACEHOLDER_RX = /\[[^\]\n]{2,60}\]|\{\{[^}\n]{2,60}\}\}/g;
const PROOF_HINT_RX = /\[(?:[^\]]*\b(?:proof|testimonial|review|result|stat|number|customer)s?\b[^\]]*)\]/gi;

/**
 * Run all checks. campaign: current brief row. assetsByTable: full asset rows
 * (structured fields + brief_snapshot) scoped to this campaign.
 * Returns findings sorted high→medium. Deterministic and side-effect free.
 */
function runConsistencyChecks(campaign, assetsByTable) {
  const findings = [];
  const c = campaign || {};
  const all = [];
  for (const [table, rows] of Object.entries(assetsByTable || {})) {
    // Skip null/non-object rows: a malformed asset must never crash the engine
    // (failure-injection contract, LB-S10). Structured fields are read defensively.
    for (const asset of rows || []) if (asset && typeof asset === 'object') all.push({ table, asset });
  }

  // 1. missing_primary_cta — per asset in CTA-carrying tables.
  for (const { table, asset } of all) {
    if (CTA_TABLES.includes(table) && !norm(asset.cta)) {
      findings.push(makeFinding('missing_primary_cta', { assets: [assetRef(table, asset)] }));
    }
  }

  // 2. conflicting_cta_url — distinct URLs across assets' CTA/structured text.
  const urlOwners = new Map(); // normalized url -> [refs]
  for (const { table, asset } of all) {
    const urls = (fieldsText(table, asset).match(URL_RX) || []).map((u) => u.replace(/[.,]$/, '').toLowerCase());
    for (const u of new Set(urls)) {
      if (!urlOwners.has(u)) urlOwners.set(u, []);
      urlOwners.get(u).push(assetRef(table, asset));
    }
  }
  if (urlOwners.size > 1) {
    const urls = [...urlOwners.keys()].sort();
    findings.push(makeFinding('conflicting_cta_url', {
      assets: [...new Map([...urlOwners.values()].flat().map((r) => [`${r.table}:${r.id}`, r])).values()],
      observed: urls.join(' vs '),
      detail: `${urls.length} different destination URLs across this campaign`,
    }));
  }

  // 3. promotion_term_mismatch — percentages / promo codes vs brief promo_terms.
  const promo = norm(c.promo_terms);
  if (promo) {
    const briefPcts = new Set((promo.match(PCT_RX) || []).map((m) => m.replace(/\s/g, '')));
    const briefCodes = new Set([...promo.matchAll(CODE_RX)].map((m) => m[1]));
    // also accept bare ALLCAPS tokens in the brief as codes (e.g. "SUMMER20")
    for (const m of promo.match(/\b[A-Z0-9]{4,15}\b/g) || []) if (/\d/.test(m)) briefCodes.add(m);
    for (const { table, asset } of all) {
      const text = fieldsText(table, asset);
      const pcts = new Set((text.match(PCT_RX) || []).map((m) => m.replace(/\s/g, '')));
      const codes = new Set([...text.matchAll(CODE_RX)].map((m) => m[1]));
      const wrongPct = [...pcts].filter((p) => briefPcts.size && !briefPcts.has(p));
      const wrongCode = [...codes].filter((cd) => briefCodes.size && !briefCodes.has(cd));
      if (wrongPct.length || wrongCode.length) {
        findings.push(makeFinding('promotion_term_mismatch', {
          assets: [assetRef(table, asset)],
          expected: promo,
          observed: [...wrongPct, ...wrongCode].join(', '),
        }));
      }
    }
  }

  // 4. date_or_timezone_mismatch — ISO dates outside the campaign window.
  if (c.start_date || c.end_date) {
    const start = c.start_date || '0000-01-01';
    const end = c.end_date || c.deadline || '9999-12-31';
    for (const { table, asset } of all) {
      const dates = [...new Set(fieldsText(table, asset).match(ISO_DATE_RX) || [])];
      const outside = dates.filter((d) => d < start || d > end);
      if (outside.length) {
        findings.push(makeFinding('date_or_timezone_mismatch', {
          assets: [assetRef(table, asset)],
          expected: `${c.start_date || 'open'} → ${c.end_date || c.deadline || 'open'}`,
          observed: outside.join(', '),
        }));
      }
    }
  }

  // 5. audience_mismatch — snapshot audience differs from current brief.
  for (const { table, asset } of all) {
    const snap = asset.brief_snapshot || {};
    if (norm(snap.audience) && norm(c.audience) && normLoose(snap.audience) !== normLoose(c.audience)) {
      findings.push(makeFinding('audience_mismatch', {
        assets: [assetRef(table, asset)],
        expected: norm(c.audience),
        observed: norm(snap.audience),
      }));
    }
  }

  // 6. unsupported_claim_reference — proof-like placeholder with no brief proof.
  if (!norm(c.proof)) {
    for (const { table, asset } of all) {
      const hits = [...new Set(fieldsText(table, asset).match(PROOF_HINT_RX) || [])];
      if (hits.length) {
        findings.push(makeFinding('unsupported_claim_reference', {
          assets: [assetRef(table, asset)],
          observed: hits.slice(0, 3).join(' '),
          detail: 'The Campaign Brief has no proof to support these references.',
        }));
      }
    }
  }

  // 7. unresolved_placeholder — any bracketed placeholder left in copy.
  for (const { table, asset } of all) {
    const hits = [...new Set(fieldsText(table, asset).match(PLACEHOLDER_RX) || [])];
    // proof-hint placeholders already covered above when proof is missing
    const remaining = norm(c.proof) ? hits : hits.filter((h) => !PROOF_HINT_RX.test(h) || (PROOF_HINT_RX.lastIndex = 0, false));
    PROOF_HINT_RX.lastIndex = 0;
    if (remaining.length) {
      findings.push(makeFinding('unresolved_placeholder', {
        assets: [assetRef(table, asset)],
        observed: remaining.slice(0, 3).join(' '),
        detail: remaining.length > 3 ? `${remaining.length} placeholders total` : null,
      }));
    }
  }

  // 8. brief_snapshot_mismatch — material brief fields changed since generation.
  for (const { table, asset } of all) {
    const snap = asset.brief_snapshot;
    if (!snap) continue;
    const changed = MATERIAL_SNAPSHOT_FIELDS.filter(
      (f) => f !== 'audience' && normLoose(snap[f]) !== normLoose(c[f]) && (norm(snap[f]) || norm(c[f]))
    );
    if (changed.length) {
      findings.push(makeFinding('brief_snapshot_mismatch', {
        assets: [assetRef(table, asset)],
        observed: `Changed since generation: ${changed.join(', ')}`,
        detail: changed.join(','),
      }));
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code));
}

module.exports = {
  RULES_VERSION,
  FINDING_META,
  SCAN_FIELDS,
  runConsistencyChecks,
  fingerprint,
};
