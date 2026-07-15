// Auth is cookie-based (audit Prompt 3): the backend sets HttpOnly session
// cookies, so there is no token in JS/localStorage. Every request must send
// cookies with `credentials: 'include'`.

const WORKSPACE_KEY = 'active_workspace_id';
export function getActiveWorkspace() {
  return localStorage.getItem(WORKSPACE_KEY);
}
export function setActiveWorkspace(id) {
  if (id) localStorage.setItem(WORKSPACE_KEY, id);
  else localStorage.removeItem(WORKSPACE_KEY);
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const ws = getActiveWorkspace();
  const res = await fetch(path, {
    method,
    signal,
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(ws ? { 'X-Workspace-Id': ws } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), {
      status: res.status,
      code: data.code,
    });
  }
  return data;
}

export const api = {
  // Auth
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  signup: (email, password, acceptTerms) =>
    request('/api/auth/signup', { method: 'POST', body: { email, password, acceptTerms } }),
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
    a.download = 'launchbloom-export.json';
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
  // Brand Profile (Prompt 9)
  brandProfile: () => request('/api/workspace/brand-profile'),
  saveBrandProfile: (profile) => request('/api/workspace/brand-profile', { method: 'PUT', body: { profile } }),
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

  // Marketing-asset studios (Upgrade prompts 7-11 / 16-18)
  generateWebsiteKit: (body) => request('/api/ai/generate-website-kit', { method: 'POST', body }),
  generateEmailFlow: (body) => request('/api/ai/generate-email-flow', { method: 'POST', body }),
  generateCampaignEmails: (body) => request('/api/ai/generate-campaign-emails', { method: 'POST', body }),
  generateSocialAssets: (body) => request('/api/ai/generate-social-assets', { method: 'POST', body }),
  generateCreativeAssets: (body) => request('/api/ai/generate-creative-assets', { method: 'POST', body }),
  // List saved assets for the whole workspace (no launch-kit filter).
  assets: (table) => request(`/api/workspace/items/${table}`),

  // Email is derived from the authenticated session server-side (Prompt 4).
  checkout: (plan, interval = 'monthly') =>
    request('/api/payments/create-checkout-session', { method: 'POST', body: { plan, interval } }),
};
