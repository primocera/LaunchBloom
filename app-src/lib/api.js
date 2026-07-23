// Auth is cookie-based (audit Prompt 3): the backend sets HttpOnly session
// cookies, so there is no token in JS/localStorage. Every request must send
// cookies with `credentials: 'include'`.

import { messageForError } from './microcopy';

const WORKSPACE_KEY = 'active_workspace_id';
export function getActiveWorkspace() {
  return localStorage.getItem(WORKSPACE_KEY);
}
export function setActiveWorkspace(id) {
  if (id) localStorage.setItem(WORKSPACE_KEY, id);
  else localStorage.removeItem(WORKSPACE_KEY);
}

async function request(path, { method = 'GET', body, signal, idempotencyKey } = {}) {
  const ws = getActiveWorkspace();
  const res = await fetch(path, {
    method,
    signal,
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(ws ? { 'X-Workspace-Id': ws } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Prompt 28: attach req_id / retry_after and a resolved user-facing message
    // so no raw backend error text ever reaches the UI. Callers may show
    // err.userMessage; err.message is kept for logs/back-compat.
    const req_id = data.req_id || data.request_id || res.headers.get('X-Request-Id') || undefined;
    const retry_after = data.retry_after != null ? data.retry_after : (res.headers.get('Retry-After') || undefined);
    const err = Object.assign(new Error(data.error || `Request failed (${res.status})`), {
      status: res.status,
      code: data.code,
      plan: data.plan,
      feature: data.feature,
      req_id,
      retry_after,
    });
    err.userMessage = messageForError(err);
    throw err;
  }
  return data;
}

export const api = {
  // Analytics (Prompt 15) — best-effort, never throws into the caller.
  trackEvent: (event, properties) =>
    request('/api/events', { method: 'POST', body: { event, properties } }).catch(() => {}),

  // Auth
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  signup: (email, password, acceptTerms, marketingOptIn = false) =>
    request('/api/auth/signup', { method: 'POST', body: { email, password, acceptTerms, marketingOptIn } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  forgotPassword: (email) => request('/api/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (password) => request('/api/auth/reset-password', { method: 'POST', body: { password } }),
  resendVerification: (email) => request('/api/auth/resend-verification', { method: 'POST', body: { email } }),

  // Account & billing (Prompts 8 + 14)
  billing: () => request('/api/account/billing'),
  billingPortal: () => request('/api/account/billing-portal', { method: 'POST' }),
  deleteAccount: () => request('/api/account/delete', { method: 'POST' }),
  exportData: async () => {
    const res = await fetch('/api/account/export', { credentials: 'include' });
    if (!res.ok) throw new Error('Could not export your data. Please try again.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scalvya-export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  workspace: () => request('/api/workspace'),
  // Multi-workspace CRUD (Prompt 7)
  workspaces: () => request('/api/workspaces'),
  createWorkspace: (name) => request('/api/workspaces', { method: 'POST', body: { name } }),
  renameWorkspace: (id, name) => request(`/api/workspaces/${id}`, { method: 'PATCH', body: { name } }),
  archiveWorkspace: (id, archived) => request(`/api/workspaces/${id}`, { method: 'PATCH', body: { archived } }),
  deleteWorkspace: (id) => request(`/api/workspaces/${id}`, { method: 'DELETE' }),
  dashboard: () => request('/api/workspace/dashboard'),
  // Admin support view (Prompt 10 + 16) — 403 for non-allowlisted accounts.
  scorecard: () => request('/api/admin/scorecard'),
  // Brand Profile (Prompt 9)
  brandProfile: () => request('/api/workspace/brand-profile'),
  saveBrandProfile: (profile) => request('/api/workspace/brand-profile', { method: 'PUT', body: { profile } }),
  // Campaigns (Prompt 12)
  campaigns: () => request('/api/campaigns'),
  createCampaign: (brief) => request('/api/campaigns', { method: 'POST', body: brief }),
  campaign: (id) => request(`/api/campaigns/${id}`),
  updateCampaign: (id, patch) => request(`/api/campaigns/${id}`, { method: 'PATCH', body: patch }),
  deleteCampaign: (id, confirm = false) =>
    request(`/api/campaigns/${id}${confirm ? '?confirm=1' : ''}`, { method: 'DELETE' }),
  duplicateCampaign: (id) => request(`/api/campaigns/${id}/duplicate`, { method: 'POST' }),
  generateCampaignStrategy: (id) => request(`/api/campaigns/${id}/strategy`, { method: 'POST', body: {} }),
  // v8 LB-S01: deliverable plan + gap map (deterministic, free)
  campaignDeliverables: (id) => request(`/api/campaigns/${id}/deliverables`),
  saveCampaignDeliverables: (id, deliverables) =>
    request(`/api/campaigns/${id}/deliverables`, { method: 'PUT', body: { deliverables } }),
  // v8 LB-S02: consistency check (deterministic, free)
  campaignConsistency: (id) => request(`/api/campaigns/${id}/consistency`),
  ackConsistencyFinding: (id, fingerprint, note_category) =>
    request(`/api/campaigns/${id}/consistency/ack`, { method: 'POST', body: { fingerprint, note_category } }),
  // v8 LB-S03: brief-change impact (deterministic, free)
  campaignBriefImpact: (id) => request(`/api/campaigns/${id}/brief-impact`),
  keepAssetSnapshot: (id, asset_table, asset_id) =>
    request(`/api/campaigns/${id}/brief-impact/keep`, { method: 'POST', body: { asset_table, asset_id } }),
  // v8 LB-S06: playbooks + workspace templates
  playbooks: () => request('/api/playbooks'),
  applyPlaybook: (playbook_id, name) =>
    request('/api/campaigns/apply-playbook', { method: 'POST', body: { playbook_id, name } }),
  templates: () => request('/api/templates'),
  saveTemplate: (campaignId, name, include) =>
    request(`/api/campaigns/${campaignId}/save-template`, { method: 'POST', body: { name, include } }),
  applyTemplate: (id, name) => request(`/api/templates/${id}/apply`, { method: 'POST', body: { name } }),
  deleteTemplate: (id) => request(`/api/templates/${id}`, { method: 'DELETE' }),
  // v8 LB-S05: activation checklist + deterministic package preview
  activation: () => request('/api/workspace/activation'),
  campaignPackagePreview: (id) => request(`/api/campaigns/${id}/package-preview`),
  // v8 LB-S04: review queue + evidence locker + export manifest
  campaignReview: (id) => request(`/api/campaigns/${id}/review`),
  campaignReviewManifest: (id) => request(`/api/campaigns/${id}/review-manifest`),
  // v8 LB-S07: full review packet (export-only handoff per ADR-001)
  campaignReviewPacket: (id) => request(`/api/campaigns/${id}/review-packet`),
  evidence: () => request('/api/evidence'),
  addEvidence: (record) => request('/api/evidence', { method: 'POST', body: record }),
  updateEvidence: (id, patch) => request(`/api/evidence/${id}`, { method: 'PATCH', body: patch }),
  linkEvidence: (id, asset_table, asset_id) =>
    request(`/api/evidence/${id}/link`, { method: 'POST', body: { asset_table, asset_id } }),
  unlinkEvidence: (id, asset_table, asset_id) =>
    request(`/api/evidence/${id}/link`, { method: 'DELETE', body: { asset_table, asset_id } }),
  // Asset Library (Prompt 13)
  library: (params) => request(`/api/assets/library?${new URLSearchParams(params || {})}`),
  assetDetail: (table, id) => request(`/api/assets/library/${table}/${id}`),
  updateAsset: (table, id, patch) => request(`/api/assets/library/${table}/${id}`, { method: 'PATCH', body: patch }),
  duplicateAsset: (table, id) => request(`/api/assets/library/${table}/${id}/duplicate`, { method: 'POST' }),
  deleteAsset: (table, id) => request(`/api/assets/library/${table}/${id}`, { method: 'DELETE' }),
  bulkAssets: (action, items, extra = {}) => request('/api/assets/library/bulk', { method: 'POST', body: { action, items, ...extra } }),
  assetVersions: (table, id) => request(`/api/assets/library/${table}/${id}/versions`),
  restoreAsset: (table, id, versionId) =>
    request(`/api/assets/library/${table}/${id}/restore`, { method: 'POST', body: { version_id: versionId } }),
  rewriteAsset: (table, id, mode, instruction) =>
    request(`/api/ai/asset/${table}/${id}/rewrite`, { method: 'POST', body: { mode, instruction } }),
  saveOnboarding: (answers) => request('/api/workspace/onboarding', { method: 'POST', body: answers }),
  offers: () => request('/api/workspace/offers'),
  launchKits: () => request('/api/workspace/launch-kits'),
  launchKit: (id) => request(`/api/workspace/launch-kits/${id}`),
  kitQuality: (id) => request(`/api/workspace/launch-kits/${id}/quality`),

  items: (table, launchKitId) =>
    request(`/api/workspace/items/${table}?launch_kit_id=${encodeURIComponent(launchKitId)}`),
  updateItem: (table, id, patch) =>
    request(`/api/workspace/items/${table}/${id}`, { method: 'PATCH', body: patch }),
  addWeeklyTask: (task) =>
    request('/api/workspace/items/weekly_tasks', { method: 'POST', body: task }),
  saveSection: (launchKitId, section, data) =>
    request(`/api/workspace/launch-kits/${launchKitId}/section`, { method: 'PATCH', body: { section, data } }),

  generatePositioning: () => request('/api/ai/generate-positioning', { method: 'POST', body: {} }),
  generateOffers: () => request('/api/ai/generate-offers', { method: 'POST', body: {} }),
  generateLaunchKit: (offerId) =>
    request('/api/ai/generate-launch-kit', { method: 'POST', body: { offer_id: offerId } }),
  regenerateSection: (launchKitId, section, feedback) =>
    request('/api/ai/regenerate-section', {
      method: 'POST',
      body: { launch_kit_id: launchKitId, section, feedback },
    }),

  // Marketing-asset studios (Upgrade prompts 7-11 / 16-18). Each call carries
  // an Idempotency-Key (v6 Prompt 11): pass opts.idempotencyKey — a UUID per
  // generation intent, reused on retry — so double clicks and timeouts can't
  // duplicate assets or charges.
  generateWebsiteKit: (body, opts) => request('/api/ai/generate-website-kit', { method: 'POST', body, ...opts }),
  generateEmailFlow: (body, opts) => request('/api/ai/generate-email-flow', { method: 'POST', body, ...opts }),
  generateCampaignEmails: (body, opts) => request('/api/ai/generate-campaign-emails', { method: 'POST', body, ...opts }),
  generateSocialAssets: (body, opts) => request('/api/ai/generate-social-assets', { method: 'POST', body, ...opts }),
  generateCreativeAssets: (body, opts) => request('/api/ai/generate-creative-assets', { method: 'POST', body, ...opts }),
  generateSeoIdeas: (body, opts) => request('/api/ai/generate-seo-ideas', { method: 'POST', body, ...opts }),
  // List saved assets for the whole workspace (no launch-kit filter).
  assets: (table) => request(`/api/workspace/items/${table}`),

  // Email is derived from the authenticated session server-side (Prompt 4).
  checkout: (plan, interval = 'monthly') =>
    request('/api/payments/create-checkout-session', { method: 'POST', body: { plan, interval } }),
};
