// ---------------------------------------------------------------------------
// Shared channel-icon set, drawn to match the approved brand board (CONNECTED
// / REFINED): 24x24 grid, 2px stroke, round caps/joins, no fill - the same
// outline language as the rest of the icon set (Lucide/Feather-like).
//
// Every icon here is purely decorative - the visible label next to it already
// carries the meaning - so each one ships aria-hidden by default and never
// needs its own accessible name.
// ---------------------------------------------------------------------------

const base = {
  viewBox: '0 0 24 24',
  width: 20,
  height: 20,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function WebsiteIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <circle cx="6" cy="6.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="6.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function EmailIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </svg>
  );
}

export function SocialIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.7l7.6-4.4M8.2 13.3l7.6 4.4" />
    </svg>
  );
}

export function AdsIcon(props) {
  return (
    <svg {...base} {...props}>
      {/* Megaphone (body, flared mouth, handle) - not a speaker/volume glyph.
          Shape after Lucide's "megaphone" (ISC licence). */}
      <path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" />
      <path d="M8 6v8" />
    </svg>
  );
}

export function SeoIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.8-4.8" />
    </svg>
  );
}

// Keys cover every label actually used across the app/landing for these five
// channels, so a caller can pass whatever label it already renders.
export const CHANNEL_ICONS = {
  Website: WebsiteIcon,
  'Website copy': WebsiteIcon,
  'Website pages': WebsiteIcon,
  website_pages: WebsiteIcon,
  Email: EmailIcon,
  'Email flow': EmailIcon,
  Emails: EmailIcon,
  email_assets: EmailIcon,
  Social: SocialIcon,
  'Social posts': SocialIcon,
  social_assets: SocialIcon,
  Ad: AdsIcon,
  Ads: AdsIcon,
  Advertising: AdsIcon,
  'Ads & Creative': AdsIcon,
  'Ad creatives': AdsIcon,
  creative_assets: AdsIcon,
  SEO: SeoIcon,
  'SEO Ideas': SeoIcon,
  'SEO assets': SeoIcon,
  seo_assets: SeoIcon,
};

/** Resolves a channel label/table name to its icon, or null if unmapped. */
export function ChannelIcon({ channel, className, ...rest }) {
  const Icon = CHANNEL_ICONS[channel];
  if (!Icon) return null;
  return <Icon className={className} {...rest} />;
}

/**
 * The board's tile treatment: a clean outline icon, cobalt, centred on a very
 * light icy-blue rounded tile. `--icon-fg` / `--icon-tile-bg` fall back to the
 * signed-in app's cobalt and a new icy tint; the landing page (.lp scope) and
 * the signed-in dark theme each override those two tokens to match their own
 * palette (see styles.css / landing.css / flow.css).
 */
export function IconTile({ channel, icon, size = 22, className = '' }) {
  const Icon = icon || CHANNEL_ICONS[channel];
  if (!Icon) return null;
  return (
    <span className={`icon-tile ${className}`.trim()}>
      <Icon width={size} height={size} />
    </span>
  );
}
