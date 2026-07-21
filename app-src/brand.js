// Central brand identity for the frontend (audit Prompt 2). Mirror of
// backend/lib/brand.js — single source of truth so the product name, tagline
// and URLs are never hardcoded across components.
export const BRAND = {
  name: 'Scalvya',
  tagline: 'From Idea to Offer to Launch',
  siteUrl: 'https://scalvya.com',
  supportEmail: 'support@scalvya.com',
  legalName: 'Scalvya (legal entity TBD)',
};

// Keep in sync with backend/lib/brand.js LEGAL_VERSION.
export const LEGAL_VERSION = '2026-07-15';
