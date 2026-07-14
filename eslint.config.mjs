import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// Lightweight lint: catch real errors (undefined vars, unreachable code)
// without fighting the existing plain-JS style.
export default [
  { ignores: ['app/**', 'node_modules/**', 'backend/node_modules/**'] },
  {
    files: ['backend/**/*.js', 'api/**/*.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs', 'vite.config.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
  {
    files: ['app-src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Only the two classic hook rules, as warnings — enough to resolve the
      // inline disable directives in the studios without blocking CI on the
      // stricter checks the v6 plugin adds.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];
