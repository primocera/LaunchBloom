import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same layout as ConversionForge: the serverless API (api/index.js) lives at
// the repo root, and the app is built *into* /app (committed) rather than a
// dist/ that would become Vercel's output root.
export default defineConfig({
  root: 'app-src',
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: '../app',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
});
