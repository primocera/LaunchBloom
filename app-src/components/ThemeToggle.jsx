import { useState } from 'react';
import { savedTheme, saveTheme } from '../lib/theme';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(savedTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="account-link theme-toggle"
      aria-pressed={theme === 'dark'}
      onClick={() => { saveTheme(next); setTheme(next); }}
    >
      {theme === 'dark' ? '☀ Light mode' : '☾ Dark mode'}
    </button>
  );
}
