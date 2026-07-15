import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

// Prompt 9: guided Brand Profile with autosave. Every AI studio reads this, so
// the more that's filled in, the more on-brand (and less placeholder-heavy) the
// generated output is.
const FIELDS = [
  ['brand_name', 'Brand name', 'input', 'e.g. Bloom & Co'],
  ['business_type', 'Business type', 'input', 'e.g. Handmade candles, ecommerce'],
  ['website', 'Website', 'input', 'https://…'],
  ['markets', 'Target markets', 'input', 'e.g. US, UK, Germany'],
  ['languages', 'Languages', 'input', 'e.g. English, German'],
  ['products', 'Products / services', 'textarea', 'What you sell, with the key facts (materials, sizes, price ranges)…'],
  ['audience_segments', 'Audience segments', 'textarea', 'Who you sell to — segments, their situation and main pain…'],
  ['positioning', 'Positioning', 'textarea', 'One or two sentences on how you want to be seen…'],
  ['differentiators', 'Differentiators', 'textarea', 'What makes you different from competitors…'],
  ['proof_points', 'Proof points', 'textarea', 'Real numbers, results, credentials you can back up…'],
  ['tone', 'Tone of voice', 'input', 'e.g. warm, direct, a little playful'],
  ['example_copy', 'Example copy', 'textarea', 'Paste a paragraph that sounds like your brand…'],
  ['words_to_use', 'Words to use', 'input', 'comma-separated'],
  ['words_to_avoid', 'Words to avoid', 'input', 'comma-separated'],
  ['cta_style', 'CTA style', 'input', 'e.g. "Shop the collection", not "Buy now"'],
  ['competitors', 'Competitors', 'input', 'comma-separated'],
  ['compliance_notes', 'Compliance / claim restrictions', 'textarea', 'Claims you must avoid, legal/industry rules…'],
  ['default_channels', 'Default channels', 'input', 'e.g. Instagram, email, Meta ads'],
];

const COMMA_FIELDS = new Set(['markets', 'languages', 'words_to_use', 'words_to_avoid', 'competitors', 'default_channels']);

export default function BrandProfile() {
  const [profile, setProfile] = useState(null);
  const [status, setStatus] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    api.brandProfile().then(({ profile: p }) => setProfile(p || {})).catch(() => setProfile({}));
  }, []);

  function toValue(key, p) {
    const v = p[key];
    if (Array.isArray(v)) return v.join(', ');
    return v || '';
  }

  function update(key, raw) {
    const next = { ...profile, [key]: COMMA_FIELDS.has(key) ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw };
    setProfile(next);
    setStatus('Saving…');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await api.saveBrandProfile(next);
        setStatus('Saved');
      } catch {
        setStatus('Could not save');
      }
    }, 700);
  }

  if (!profile) return <div className="brand-page"><p className="muted">Loading…</p></div>;

  const filled = FIELDS.filter(([k]) => {
    const v = profile[k];
    return Array.isArray(v) ? v.length : v;
  }).length;

  return (
    <div className="brand-page">
      <div className="brand-head">
        <h1>Brand profile</h1>
        <span className="brand-status">{status}</span>
      </div>
      <p className="muted">
        Used by every studio to keep output on-brand. {filled}/{FIELDS.length} filled — anything you leave
        blank becomes a bracketed placeholder in generated copy instead of an invented fact.
      </p>

      {FIELDS.map(([key, label, kind, placeholder]) => (
        <div className="brand-field" key={key}>
          <label htmlFor={`bp-${key}`}>{label}</label>
          {kind === 'textarea' ? (
            <textarea
              id={`bp-${key}`}
              rows={3}
              value={toValue(key, profile)}
              placeholder={placeholder}
              onChange={(e) => update(key, e.target.value)}
            />
          ) : (
            <input
              id={`bp-${key}`}
              type="text"
              value={toValue(key, profile)}
              placeholder={placeholder}
              onChange={(e) => update(key, e.target.value)}
            />
          )}
        </div>
      ))}

      <p className="muted">Changes save automatically.</p>
    </div>
  );
}
