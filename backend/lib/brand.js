// ---------------------------------------------------------------------------
// Central brand configuration (audit Prompt 2).
//
// Single source of truth for the product's customer-facing identity so the
// name, sender address, URLs and legal entity are never hardcoded across the
// codebase. All values are env-overridable for deploy-specific domains; the
// defaults use the LaunchBloom brand with clearly-marked placeholder legal
// values for counsel review.
//
// Do NOT hardcode a domain anywhere else — read it from here.
// ---------------------------------------------------------------------------

const BRAND = {
  // Product / display name
  name: process.env.BRAND_NAME || 'LaunchBloom',
  tagline: process.env.BRAND_TAGLINE || 'From Idea to Offer to Launch',

  // URLs
  siteUrl: process.env.BRAND_URL || 'https://launchbloom.app',

  // Support + transactional email identity
  supportEmail: process.env.BRAND_SUPPORT_EMAIL || 'support@launchbloom.app',
  senderName: process.env.BRAND_SENDER_NAME || 'LaunchBloom',
  senderEmail: process.env.BRAND_SENDER_EMAIL || 'hello@launchbloom.app',

  // Legal configuration (v5 Prompt 15) — env-backed; defaults are explicit
  // placeholders that BLOCK paid checkout in production until real values are
  // supplied (see legalPlaceholders()).
  legalName: process.env.BRAND_LEGAL_NAME || 'LaunchBloom (legal entity TBD)',
  legalAddress: process.env.BRAND_LEGAL_ADDRESS || '', // e.g. "123 Main St, Austin, TX 78701, USA"
  privacyEmail: process.env.BRAND_PRIVACY_EMAIL || process.env.BRAND_SUPPORT_EMAIL || 'support@launchbloom.app',
  governingLaw: process.env.BRAND_GOVERNING_LAW || '', // e.g. "the State of Delaware, USA"
};

/**
 * Legal values still missing or placeholder — production must not sell until
 * this is empty (v5 Prompt 15).
 */
function legalPlaceholders() {
  const missing = [];
  if (!BRAND.legalName || /TBD|placeholder/i.test(BRAND.legalName)) missing.push('BRAND_LEGAL_NAME');
  if (!BRAND.legalAddress) missing.push('BRAND_LEGAL_ADDRESS');
  if (!BRAND.governingLaw) missing.push('BRAND_GOVERNING_LAW');
  return missing;
}

// Bump when Terms/Privacy change materially; signup records the accepted
// version so consent is auditable (Prompt 14).
const LEGAL_VERSION = process.env.LEGAL_VERSION || '2026-07-15';

/** "LaunchBloom <hello@launchbloom.app>" for email `from` headers. */
function emailFrom() {
  return `${BRAND.senderName} <${BRAND.senderEmail}>`;
}

module.exports = { BRAND, emailFrom, LEGAL_VERSION, legalPlaceholders };
