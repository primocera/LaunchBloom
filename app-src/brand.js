// Central brand identity for the frontend (audit Prompt 2). Mirror of
// backend/lib/brand.js — single source of truth so the product name, tagline
// and URLs are never hardcoded across components.
export const BRAND = {
  name: 'Scalvya',
  tagline: 'From Idea to Offer to Launch',
  siteUrl: 'https://scalvya.com',
  supportEmail: 'support@scalvya.com',
  // v9 SC-00: no hardcoded legal entity. The operating entity comes only from
  // GET /api/legal (env-backed). If it isn't configured the legal pages fail
  // closed — they never fabricate an entity name in the bundle.
};

// Keep in sync with backend/lib/brand.js LEGAL_VERSION.
export const LEGAL_VERSION = '2026-07-15';
