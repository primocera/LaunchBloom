// ---------------------------------------------------------------------------
// Brand Profile loading + prompt context (audit Prompt 9).
//
// Turns a workspace's saved brand profile into a ground-truth context block
// that every AI generation prepends, plus a short "context used" summary the
// UI can show. Missing facts must become bracketed placeholders — never
// invented — so the rules are stated in the block itself.
// ---------------------------------------------------------------------------

const supabase = require('./supabase');

// Human labels for the profile fields we inject, in display order.
const FIELDS = [
  ['brand_name', 'Brand name'],
  ['business_type', 'Business type'],
  ['website', 'Website'],
  ['markets', 'Target markets'],
  ['languages', 'Languages'],
  ['products', 'Products / services'],
  ['audience_segments', 'Audience segments'],
  ['positioning', 'Positioning'],
  ['differentiators', 'Differentiators'],
  ['proof_points', 'Proof points'],
  ['tone', 'Tone of voice'],
  ['example_copy', 'Example copy'],
  ['words_to_use', 'Words to use'],
  ['words_to_avoid', 'Words to avoid'],
  ['cta_style', 'CTA style'],
  ['competitors', 'Competitors'],
  ['compliance_notes', 'Compliance / claim restrictions'],
  ['default_channels', 'Default channels'],
];

function valToText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  if (typeof v === 'object') {
    return Object.entries(v).filter(([, x]) => x !== '' && x != null).map(([k, x]) => `${k}: ${x}`).join('; ');
  }
  return String(v).trim();
}

/** Load the raw brand profile object for a workspace, or null. */
async function getBrandProfile(workspaceId) {
  try {
    const { data } = await supabase
      .from('brand_profiles')
      .select('data')
      .eq('workspace_id', workspaceId)
      .single();
    return (data && data.data) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Build the prompt context for a workspace. Returns:
 *   { text, summary, hasProfile }
 * `text` is prepended to generation prompts; `summary` lists which fields were
 * provided (for a "Context used" chip).
 */
function formatBrandContext(profile) {
  if (!profile) return { text: '', summary: [], hasProfile: false };

  const lines = [];
  const summary = [];
  for (const [key, label] of FIELDS) {
    const text = valToText(profile[key]);
    if (text) {
      lines.push(`${label}: ${text}`);
      summary.push(label);
    }
  }

  // v5 Prompt 5: structured Products/Audience records (guided Brand setup).
  const products = Array.isArray(profile.products_list) ? profile.products_list.filter((p) => p && p.name) : [];
  if (products.length) {
    lines.push('Products (structured):');
    for (const p of products) {
      const parts = ['name', 'category', 'description', 'price', 'differentiators', 'proof', 'url', 'claim_restrictions']
        .filter((k) => p[k]).map((k) => `${k}: ${p[k]}`);
      lines.push(`  - ${parts.join('; ')}${p.primary ? ' (PRIMARY)' : ''}`);
    }
    summary.push('Products (structured)');
  }
  const audiences = Array.isArray(profile.audiences) ? profile.audiences.filter((a) => a && (a.name || a.description)) : [];
  if (audiences.length) {
    lines.push('Audience segments (structured):');
    for (const a of audiences) {
      lines.push(`  - ${[a.name, a.description].filter(Boolean).join(': ')}${a.primary ? ' (PRIMARY)' : ''}`);
    }
    summary.push('Audiences (structured)');
  }
  if (profile.main_goal) {
    lines.push(`Main goal: ${valToText(profile.main_goal)}`);
    summary.push('Main goal');
  }
  if (lines.length === 0) return { text: '', summary: [], hasProfile: false };

  const text =
    'BRAND PROFILE — treat as ground truth and stay consistent with it:\n' +
    lines.join('\n') +
    '\n\nGROUNDING RULES: Use only facts stated in this brand profile and the user data below. ' +
    'For any missing specific (price, statistic, testimonial, credential, date, guarantee), insert a clearly ' +
    'bracketed placeholder such as [ADD PRICE] or [ADD TESTIMONIAL] — never invent it. Respect the words-to-avoid ' +
    'and compliance restrictions.\n';

  return { text, summary, hasProfile: true };
}

/** Convenience: load + format in one call. */
async function brandContextFor(workspaceId) {
  return formatBrandContext(await getBrandProfile(workspaceId));
}

module.exports = { getBrandProfile, formatBrandContext, brandContextFor };
