// Central brand identity for the frontend (audit Prompt 2). Mirror of
// backend/lib/brand.js — single source of truth so the product name, tagline
// and URLs are never hardcoded across components.
export const BRAND = {
  // Name/tagline stay LaunchBloom until the Scalvya copy rebrand (deferred).
  name: 'LaunchBloom',
  tagline: 'From Idea to Offer to Launch',
  // Domain-level identity now lives on scalvya.com.
  siteUrl: 'https://scalvya.com',
  supportEmail: 'support@scalvya.com',
  legalName: 'LaunchBloom (legal entity TBD)',
};

// Keep in sync with backend/lib/brand.js LEGAL_VERSION.
export const LEGAL_VERSION = '2026-07-15';
