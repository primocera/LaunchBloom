// Builds the Scalvya brand assets (favicon, app icons, link-preview image)
// into app-src/public/. Vite copies that folder into the committed app/ bundle
// on `npm run build:app`, so the files are served at https://scalvya.com/app/<file>.
//
// Usage:   node scripts/build-brand-assets.mjs
//
// Outputs (all in app-src/public/):
//   favicon.svg           the app icon (scripts/brand/app-icon.svg)
//   favicon-32.png        32x32 PNG of the same tile, transparent corners
//   apple-touch-icon.png  180x180 full-bleed square (no rounded corners; iOS rounds it)
//   icon-512.png          512x512 rounded tile, transparent corners
//   og-image.png          1200x630 link-preview image (mark, wordmark, headline)
//
// The app icon is scripts/brand/app-icon.svg, fitted to the brand board's
// "01 / CONNECTED" app icon (gradient tile, white/ice mark). The share image
// reads the mark paths from app-src/components/ScalvyaMark.jsx (MARK_PATHS), so
// it can never drift from the in-app logo. PNGs are rendered with
// Playwright's Chromium (`@playwright/test` dev dependency; run
// `npx playwright install chromium` once if the browser is missing). The
// wordmark uses Inter from @fontsource/inter, embedded as a data URI.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'app-src', 'public');
mkdirSync(OUT, { recursive: true });

// ── Mark geometry (single source of truth: ScalvyaMark.jsx) ─────────────────
const markSrc = readFileSync(path.join(ROOT, 'app-src', 'components', 'ScalvyaMark.jsx'), 'utf8');
const block = markSrc.match(/MARK_PATHS\s*=\s*\[([\s\S]*?)\]/);
if (!block) throw new Error('MARK_PATHS not found in ScalvyaMark.jsx');
const PATHS = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
if (PATHS.length !== 3) throw new Error(`expected 3 mark paths, found ${PATHS.length}`);

const COLOR_FILLS = [['#99D4FE', 1], ['#2260F7', 1], ['#0F1E51', 1]];
const NAVY = '#0F1E51';
const COBALT = '#2260F7';

const paths = (fills) =>
  PATHS.map((d, i) => `<path d="${d}" fill="${fills[i][0]}" fill-opacity="${fills[i][1]}"/>`).join('');

// The app icon at a given pixel size. square = true gives the full-bleed iOS tile.
const ICON = readFileSync(path.join(ROOT, 'scripts', 'brand', 'app-icon.svg'), 'utf8');
function tileSvg({ size = 64, square = false } = {}) {
  let svg = ICON.replace('<svg ', `<svg width="${size}" height="${size}" `);
  if (square) svg = svg.replace(/(<rect width="64" height="64") rx="[\d.]+"/, '$1 rx="0"');
  return svg;
}

// ── Inter (embedded so the page needs no network or file:// access) ─────────
const fontDir = path.join(ROOT, 'node_modules', '@fontsource', 'inter', 'files');
const font = (w) => {
  try {
    const b64 = readFileSync(path.join(fontDir, `inter-latin-${w}-normal.woff2`)).toString('base64');
    return `@font-face{font-family:Inter;font-weight:${w};src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  } catch {
    return ''; // falls back to the system sans-serif below
  }
};
const FONT_CSS = font(600) + font(800);

// ── Link-preview image ───────────────────────────────────────────────────────
const streaks = [
  // [top, left, width, opacity]
  [96, 560, 420, 0.55],
  [168, 760, 300, 0.35],
  [430, 640, 380, 0.4],
  [588, 110, 240, 0.25],
  [560, 880, 340, 0.3],
]
  .map(([t, l, w, o]) => `<i class="wind" style="top:${t}px;left:${l}px;width:${w}px;opacity:${o}"></i>`)
  .join('');

const OG_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
${FONT_CSS}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden}
body{position:relative;background:radial-gradient(70% 90% at 85% 60%,#e3edff 0%,#f5f8ff 45%,#ffffff 80%);
  font-family:Inter,'Segoe UI',Arial,sans-serif;color:${NAVY};-webkit-font-smoothing:antialiased}
.big{position:absolute;right:-170px;top:56%;transform:translateY(-50%);width:640px;height:640px}
.wind{position:absolute;height:2px;border-radius:2px;transform:rotate(-12deg);transform-origin:left center;
  background:linear-gradient(90deg,rgba(34,96,247,0),${COBALT} 50%,rgba(34,96,247,0))}
.copy{position:absolute;left:96px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:22px;margin-bottom:52px}
.brand svg{width:104px;height:104px}
.word{font-size:92px;font-weight:800;letter-spacing:-0.035em;line-height:1}
h1{font-size:58px;font-weight:800;letter-spacing:-0.03em;line-height:1.1;max-width:600px}
</style></head><body>
<svg class="big" viewBox="-0.5 -1.5 66 66">${paths(COLOR_FILLS)}</svg>
${streaks.replace(/opacity:([\d.]+)/g, (_, o) => `opacity:${(o * 0.6).toFixed(2)}`)}
<div class="copy">
  <div class="brand"><svg viewBox="-0.5 -1.5 66 66">${paths(COLOR_FILLS)}</svg><span class="word">Scalvya</span></div>
  <h1>Turn one offer into a launch-ready campaign.</h1>
</div>
</body></html>`;

// ── Render ──────────────────────────────────────────────────────────────────
const iconPage = (svg, size) =>
  `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`;

const jobs = [
  { file: 'favicon-32.png', w: 32, h: 32, transparent: true, html: iconPage(tileSvg({ size: 32 }), 32) },
  { file: 'apple-touch-icon.png', w: 180, h: 180, transparent: false, html: iconPage(tileSvg({ size: 180, square: true }), 180) },
  { file: 'icon-512.png', w: 512, h: 512, transparent: true, html: iconPage(tileSvg({ size: 512 }), 512) },
  { file: 'og-image.png', w: 1200, h: 630, transparent: false, html: OG_HTML },
];

writeFileSync(path.join(OUT, 'favicon.svg'), ICON.trim() + '\n');
console.log('wrote app-src/public/favicon.svg');

const browser = await chromium.launch();
try {
  for (const job of jobs) {
    const page = await browser.newPage({ viewport: { width: job.w, height: job.h }, deviceScaleFactor: 1 });
    await page.setContent(job.html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, job.file), omitBackground: job.transparent });
    await page.close();
    console.log(`wrote app-src/public/${job.file} (${job.w}x${job.h})`);
  }
} finally {
  await browser.close();
}
