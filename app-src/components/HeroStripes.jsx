import { MARK_PATHS } from './ScalvyaMark';

// The hero artwork, as on the brand board's "01 / CONNECTED" landing: the whole
// mark drawn huge on the right - icy band, cobalt band ending in the arrow at
// the top-right, navy band running off the bottom - with soft gradients.
// Purely decorative; it lives directly in .lp-sky so it can reach the edges.
export default function HeroStripes() {
  return (
    <div className="lp-hero-art" aria-hidden="true">
      <svg viewBox="-0.5 -1.5 66 66" fill="none" preserveAspectRatio="none">
        <defs>
          <linearGradient id="heroArtIce" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#7cc0fb" />
            <stop offset="100%" stopColor="#d9ecff" />
          </linearGradient>
          <linearGradient id="heroArtCobalt" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#7aa2ff" stopOpacity="0.55" />
            <stop offset="35%" stopColor="#2f68e8" />
            <stop offset="100%" stopColor="#1f5cf2" />
          </linearGradient>
          <linearGradient id="heroArtNavy" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#2a4cc4" />
            <stop offset="60%" stopColor="#13287a" />
            <stop offset="100%" stopColor="#101c45" />
          </linearGradient>
        </defs>
        <path d={MARK_PATHS[0]} fill="url(#heroArtIce)" />
        <path d={MARK_PATHS[2]} fill="url(#heroArtNavy)" />
        <path d={MARK_PATHS[1]} fill="url(#heroArtCobalt)" />
      </svg>
    </div>
  );
}
