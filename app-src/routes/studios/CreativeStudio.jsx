import { useState } from 'react';
import { api } from '../../lib/api';
import GeneratorStudio, { AssetField } from './generator';

// ---------------------------------------------------------------------------
// Ads & Creative Studio (v5 Prompt 11): review-ready static, carousel,
// video/UGC and search-ad briefs with funnel/awareness intake, a per-concept
// test matrix and compliance acknowledgement for high-risk claims.
// ---------------------------------------------------------------------------

const FIELDS = [
  {
    name: 'platforms', label: 'Platforms', type: 'checkboxes', required: true,
    options: [
      { value: 'meta', label: 'Meta' },
      { value: 'tiktok', label: 'TikTok' },
      { value: 'google', label: 'Google' },
      { value: 'pinterest', label: 'Pinterest' },
    ],
  },
  {
    name: 'formats', label: 'Formats', type: 'checkboxes',
    options: [
      { value: 'static', label: 'Static', title: 'Single-image concept: hook, headline, primary text, visual direction' },
      { value: 'video', label: 'Video', title: 'Timed script with scenes, on-screen text, b-roll and end card' },
      { value: 'ugc', label: 'UGC', title: 'Creator-style script — you must have real creator consent and usage rights' },
      { value: 'carousel', label: 'Carousel', title: 'Card-by-card structure with roles per slide' },
      { value: 'search_ad', label: 'Search ad', title: 'Concise headlines (≤30 chars) and descriptions (≤90) with keyword intents' },
    ],
  },
  { name: 'objective', label: 'Objective', type: 'text', placeholder: 'e.g. drive first purchases' },
  {
    name: 'funnel_stage', label: 'Funnel stage', type: 'select', required: true,
    options: ['awareness', 'consideration', 'conversion', 'retargeting'],
  },
  {
    name: 'audience_temperature', label: 'Audience temperature', type: 'select',
    options: ['cold', 'warm', 'hot'],
  },
  { name: 'placement', label: 'Placement', type: 'text', placeholder: 'e.g. Reels, Feed, Search' },
  { name: 'offer', label: 'Offer', type: 'text', placeholder: 'What the ad promotes' },
  { name: 'proof', label: 'Proof available', type: 'textarea', placeholder: 'Only real reviews / numbers / results — never invented' },
  { name: 'mandatory_elements', label: 'Mandatory elements', type: 'text', placeholder: 'Logo, disclaimer, brand colours…' },
  { name: 'prohibited_claims', label: 'Prohibited claims', type: 'text', placeholder: 'Claims you must not make' },
  { name: 'production_constraints', label: 'Production constraints', type: 'text', placeholder: 'e.g. phone-only, no actors, one location' },
  { name: 'budget_level', label: 'Budget level', type: 'select', options: ['low', 'medium', 'high'] },
  { name: 'target_language', label: 'Target language', type: 'text', placeholder: 'English' },
  { name: 'extra_context', label: 'Extra context', type: 'textarea' },
];

function VideoTimeline({ tl }) {
  const scenes = Array.isArray(tl.scenes) ? tl.scenes : [];
  return (
    <div className="gen-subsection">
      <AssetField label="First-frame hook" value={tl.first_frame_hook} copy />
      <AssetField label="Duration (s)" value={tl.duration_seconds ? String(tl.duration_seconds) : ''} />
      {scenes.map((s, i) => (
        <div className="gen-subsection" key={i}>
          <AssetField label={`Scene ${i + 1} · ${s.timecode || ''}`} value={s.visual} copy />
          <AssetField label="Script" value={s.spoken_script} copy />
          <AssetField label="On-screen" value={s.on_screen_text} copy />
        </div>
      ))}
      <AssetField label="B-roll" value={tl.b_roll} copy />
      <AssetField label="Product moments" value={tl.product_moments} copy />
      <AssetField label="Audio direction" value={tl.audio_direction} copy />
      <AssetField label="CTA end card" value={tl.cta_end_card} copy />
    </div>
  );
}

function SearchAd({ sa }) {
  return (
    <div className="gen-subsection">
      <AssetField label="Headlines (≤30 chars)" value={sa.headlines} copy />
      <AssetField label="Descriptions (≤90 chars)" value={sa.descriptions} copy />
      {(sa.keyword_groups || []).map((g, i) => (
        <AssetField key={i} label={`Keywords · ${g.intent || 'intent'}`} value={g.keywords} copy />
      ))}
    </div>
  );
}

function ComplianceBlock({ item, onChange }) {
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState('');
  const flags = Array.isArray(item.compliance_flags) ? item.compliance_flags : [];
  const ack = item.compliance_ack || {};
  const recorded = ack.acknowledged && ack.proof_source;
  if (flags.length === 0) return null;
  async function acknowledge() {
    setBusy(true);
    try {
      const r = await api.updateItem('creative_assets', item.id, { compliance_ack: true, compliance_proof: proof });
      onChange(r.item);
    } catch { /* non-blocking */ } finally { setBusy(false); }
  }
  return (
    <div className="gen-warnings" role="alert">
      <strong>Compliance ({flags.length})</strong>
      <ul>{flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
      {recorded ? (
        <p className="flow-muted">Proof recorded: {ack.proof_source} — you can mark this ready.</p>
      ) : (
        <>
          <p className="flow-muted">Where does the proof for these claims live? A link or description is required — acknowledging alone can’t approve a claim.</p>
          <input
            className="flow-input"
            placeholder="e.g. link to the review page, case-study doc, sales report"
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            aria-label="Proof source"
          />
          <button className="btn-secondary" disabled={busy || proof.trim().length < 5} onClick={acknowledge}>
            Record proof source
          </button>
        </>
      )}
    </div>
  );
}

function renderItem(item, { onChange }) {
  const isVideo = item.creative_type === 'video' || item.creative_type === 'ugc';
  const slides = Array.isArray(item.slides) ? item.slides : [];
  const test = item.test_matrix || {};
  return (
    <>
      <div className="gen-card-title">{item.platform} · {item.creative_type}{item.angle ? ` · ${item.angle}` : ''}</div>
      <AssetField label="Angle" value={item.angle} copy />
      <AssetField label="Hook" value={item.hook} copy />
      <AssetField label="Headline" value={item.headline} copy />
      <AssetField label="Primary text" value={item.primary_text} copy />
      <AssetField label="Visual direction" value={item.visual_direction} copy />
      <AssetField label="Designer notes" value={item.designer_notes} />

      {isVideo && item.video_timeline && <VideoTimeline tl={item.video_timeline} />}
      {slides.length > 0 && (
        <div className="gen-subsection">
          <span className="gen-field-label">Carousel</span>
          {slides.map((s, i) => (
            <AssetField key={i} label={`${s.role || 'slide'} ${s.slide_number || i + 1}: ${s.heading || ''}`} value={s.body} copy />
          ))}
        </div>
      )}
      {item.search_ad && <SearchAd sa={item.search_ad} />}

      <AssetField label="Text overlays" value={item.text_overlays} copy />
      <AssetField label="CTA" value={item.cta} copy />

      {(test.variable || test.hypothesis) && (
        <div className="gen-subsection">
          <span className="gen-field-label">Test matrix</span>
          <AssetField label="Variable" value={test.variable} />
          <AssetField label="Hypothesis" value={test.hypothesis} />
          <AssetField label="Control" value={test.control} />
          <AssetField label="Success metric" value={test.success_metric} />
        </div>
      )}

      <ComplianceBlock item={item} onChange={onChange} />
    </>
  );
}

const fullCopy = (i) =>
  [`${i.platform} · ${i.creative_type}`, `Angle: ${i.angle || ''}`, `Hook: ${i.hook}`, `Headline: ${i.headline}`,
    i.primary_text, `Visual: ${i.visual_direction}`, i.designer_notes, `CTA: ${i.cta}`, `Testing: ${i.testing_angle}`]
    .filter(Boolean).join('\n');

export default function CreativeStudio() {
  return (
    <GeneratorStudio
      title="Ads & Creative"
      blurb="Generate creative briefs a human design or media team can produce from — distinct concepts, scripts and testing hypotheses. These are drafts, not rendered media, approved ads or launched campaigns. High-risk claims stay blocked until real proof is recorded."
      fields={FIELDS}
      initial={{ target_language: 'English', platforms: ['meta'], formats: ['static', 'video'] }}
      generate={(v, opts) => api.generateCreativeAssets(v, opts)}
      resultKey="items"
      table="creative_assets"
      renderItem={renderItem}
      fullCopy={fullCopy}
    />
  );
}
