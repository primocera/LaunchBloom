import { useEffect } from 'react';

// Light/dark theme for the signed-in app. The choice is a per-browser
// convenience (localStorage); light is the default. Only AppShell applies it,
// so the landing and auth pages always keep their own design.

const KEY = 'scalvya_theme';

export function savedTheme() {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

export function saveTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* private mode: still applies for this visit */ }
  applyTheme(theme);
}

/** Apply the saved theme while the app shell is mounted; back to light on leave. */
export function useAppTheme() {
  useEffect(() => {
    applyTheme(savedTheme());
    return () => applyTheme('light');
  }, []);
}
