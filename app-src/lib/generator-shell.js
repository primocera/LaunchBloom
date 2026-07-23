// v5 Prompt 7: pure helpers for the shared generator shell. Kept free of React
// so they can be unit-tested (backend/tests/generator-shell.test.js) the same
// way next-actions.js is. No DOM, no fetch — inputs in, plain data out.

/** The record flagged primary, else the first, else null. */
export function primaryOf(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.find((r) => r && r.primary) || list[0];
}

function recordLabel(r) {
  if (!r) return null;
  return r.name || r.title || r.label || r.description || null;
}

/**
 * Context chips shown before generation. Smart defaults come from the Brand
 * Profile and campaign — never the silent "first product" (we surface the
 * primary one and mark it so the user can change it). Returns an ordered list
 * of { key, label, value, editable, missing }.
 */
export function deriveContext({ profile = {}, campaign = null, values = {} } = {}) {
  const product = recordLabel(primaryOf(profile.products_list)) || values.product || null;
  const audience = recordLabel(primaryOf(profile.audiences)) || values.audience || null;
  const language =
    (Array.isArray(profile.languages) && profile.languages[0]) || values.language || 'English';
  const chips = [
    { key: 'brand', label: 'Brand', value: profile.business_name || profile.brand_name || null },
    { key: 'product', label: 'Product', value: product },
    { key: 'audience', label: 'Audience', value: audience },
    { key: 'campaign', label: 'Campaign', value: campaign ? campaign.name : null },
    { key: 'language', label: 'Language', value: language },
    { key: 'goal', label: 'Goal', value: profile.main_goal || (campaign && campaign.objective) || null },
    { key: 'format', label: 'Format', value: values.format || values.page_type || values.flow_type || null },
  ];
  return chips.map((c) => ({ ...c, missing: !c.value, editable: c.key !== 'language' }));
}

/**
 * Per-field validation warnings. Reads optional field constraints from the
 * form spec: required, minLength, maxLength (used for meta-title/description
 * length checks). Returns { [fieldName]: message } — actionable, field-local.
 */
export function validateFields(fields = [], values = {}) {
  const out = {};
  for (const f of fields) {
    const v = values[f.name];
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
    if (f.required && empty) {
      out[f.name] = `${f.label} is required.`;
      continue;
    }
    if (empty) continue;
    const len = typeof v === 'string' ? v.length : null;
    if (len != null && f.maxLength && len > f.maxLength) {
      out[f.name] = `${f.label} is ${len} characters — keep it under ${f.maxLength}.`;
    } else if (len != null && f.minLength && len < f.minLength) {
      out[f.name] = `${f.label} is only ${len} characters — aim for at least ${f.minLength}.`;
    }
  }
  return out;
}

/** True when any required field is still empty (blocks Generate). */
export function hasBlockingErrors(fields = [], values = {}) {
  return fields.some((f) => {
    if (!f.required) return false;
    const v = values[f.name];
    return v == null || v === '' || (Array.isArray(v) && v.length === 0);
  });
}

/** Human output estimate + the fixed "one AI action" disclosure. */
export function outputEstimate({ resultKey = 'items', count } = {}) {
  const noun = String(resultKey).replace(/_/g, ' ');
  const n = Number.isFinite(count) && count > 0 ? count : null;
  const what = n ? `about ${n} ${noun}` : `a set of ${noun}`;
  return `Generates ${what}. This uses 1 AI action — editing, copying and exporting are free.`;
}

// v9 SC-05: the exact required labels still missing before Generate can run, so
// a disabled button explains WHY rather than greying out silently.
export function missingRequiredFields(fields = [], values = {}) {
  return fields
    .filter((f) => {
      if (!f.required) return false;
      const v = values[f.name];
      return v == null || v === '' || (Array.isArray(v) && v.length === 0);
    })
    .map((f) => f.label);
}

// v9 SC-05: the per-channel output contract shown BEFORE generation — what the
// studio actually produces (structure) and the boundary it never crosses. The
// wording is deliberately outcome-safe and matches the product contract: Social
// never posts/schedules, Creative is briefs not media, SEO invents no metrics.
export const OUTPUT_CONTRACT = {
  website_pages: {
    structure: ['Page goal', 'Headline and sections', 'SEO title and meta', 'FAQ', 'One primary CTA'],
    note: 'Structured page copy to review and adapt — not a published page.',
  },
  email_assets: {
    structure: ['Sequence purpose', 'Subject and preheader', 'Plain-text-safe body', 'One CTA per email'],
    note: 'Draft emails to review and adapt — Scalvya does not send them.',
  },
  social_assets: {
    structure: ['Platform and format', 'Hook', 'Caption and hashtags', 'Calendar planning only'],
    note: 'Planned captions to review — never posted or scheduled to any platform.',
  },
  creative_assets: {
    structure: ['Concept and format', 'Script or primary text', 'Claim with an evidence hook', 'Testing note'],
    note: 'Ad creative briefs to review — not rendered media or launched ads.',
  },
  seo_assets: {
    structure: ['Research question and intent', 'Outline (H-structure)', 'Title and meta', 'Verification checklist'],
    note: 'Research ideas to verify — no invented search volume, difficulty or rank.',
  },
};

export function outputContractFor(table) {
  return OUTPUT_CONTRACT[table] || null;
}

// v9 SC-05: structured fields a user can edit inline (free, versioned) to fix a
// deterministic consistency finding WITHOUT spending an AI action. The keys
// mirror the backend rewriteFields for each table (backend snapshots the prior
// version on every content edit), so editing here is non-destructive.
export const STRUCTURED_FIELDS = {
  website_pages: [['cta', 'Primary CTA (and link)']],
  email_assets: [['subject_line', 'Subject line'], ['cta', 'Primary CTA (and link)']],
  social_assets: [['cta', 'Primary CTA (and link)']],
  creative_assets: [['headline', 'Headline'], ['cta', 'Primary CTA (and link)']],
  seo_assets: [['seo_title', 'SEO title'], ['h1', 'H1']],
};

export function structuredFieldsFor(table) {
  return STRUCTURED_FIELDS[table] || [];
}

export const RESULT_TABS = ['Output', 'Quality', 'Versions', 'Brief'];
