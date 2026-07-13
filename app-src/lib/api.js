const TOKEN_KEY = 'of_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const token = getToken();
  const res = await fetch(path, {
    method,
    signal,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  signup: (email, password) => request('/api/auth/signup', { method: 'POST', body: { email, password } }),
  me: () => request('/api/auth/me'),

  workspace: () => request('/api/workspace'),
  dashboard: () => request('/api/workspace/dashboard'),
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

  checkout: (plan, email, interval = 'monthly') =>
    request('/api/payments/create-checkout-session', { method: 'POST', body: { plan, email, interval } }),
};
