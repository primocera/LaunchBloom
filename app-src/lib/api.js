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
  login: (email) => request('/api/auth/login', { method: 'POST', body: { email } }),
  me: () => request('/api/auth/me'),

  workspace: () => request('/api/workspace'),
  saveOnboarding: (answers) => request('/api/workspace/onboarding', { method: 'POST', body: answers }),
  offers: () => request('/api/workspace/offers'),
  launchKits: () => request('/api/workspace/launch-kits'),
  launchKit: (id) => request(`/api/workspace/launch-kits/${id}`),

  generatePositioning: () => request('/api/ai/generate-positioning', { method: 'POST', body: {} }),
  generateOffers: () => request('/api/ai/generate-offers', { method: 'POST', body: {} }),
  generateLaunchKit: (offerId) =>
    request('/api/ai/generate-launch-kit', { method: 'POST', body: { offer_id: offerId } }),
  regenerateSection: (launchKitId, section, feedback) =>
    request('/api/ai/regenerate-section', {
      method: 'POST',
      body: { launch_kit_id: launchKitId, section, feedback },
    }),

  checkout: (plan, email) =>
    request('/api/payments/create-checkout-session', { method: 'POST', body: { plan, email } }),
};
