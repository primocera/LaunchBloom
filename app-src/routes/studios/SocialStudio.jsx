import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { groupByPlannedDate, itemLabel } from '../../lib/social-calendar';
import GeneratorStudio, { AssetField } from './generator';
import '../../flow.css';

// ---------------------------------------------------------------------------
// Social Studio (v5 Prompt 10): channel-aware content. Carousels output
// slide-by-slide copy; reels/short video output a full script (hook, spoken
// script, on-screen text, shot list, b-roll, CTA). A calendar view lets you
// plan items on dates without exporting first.
// ---------------------------------------------------------------------------

const FIELDS = [
  {
    name: 'platforms', label: 'Platforms', type: 'checkboxes', required: true,
    options: [
      { value: 'instagram', label: 'Instagram' },
      { value: 'tiktok', label: 'TikTok' },
      { value: 'linkedin', label: 'LinkedIn' },
      { value: 'pinterest', label: 'Pinterest' },
      { value: 'facebook', label: 'Facebook' },
    ],
  },
  {
    name: 'formats', label: 'Formats', type: 'checkboxes',
    options: [
      { value: 'caption', label: 'Caption / post' },
      { value: 'carousel', label: 'Carousel' },
      { value: 'reel', label: 'Reel / short video' },
      { value: 'story', label: 'Story' },
      { value: 'pin', label: 'Pin' },
    ],
  },
  {
    name: 'content_goal', label: 'Content goal', type: 'select', required: true,
    options: ['awareness', 'trust', 'leads', 'sales', 'launch', 'engagement'],
  },
  { name: 'content_pillars', label: 'Content pillars', type: 'text', placeholder: 'e.g. education, proof, behind-the-scenes' },
  {
    name: 'awareness_stage', label: 'Audience awareness stage', type: 'select',
    options: ['unaware', 'problem-aware', 'solution-aware', 'product-aware', 'most-aware'],
  },
  {
    name: 'creator_available', label: 'Creator on camera?', type: 'select',
    options: ['yes', 'no', 'voice only'],
  },
  {
    name: 'product_available', label: 'Product to show?', type: 'select',
    options: ['yes', 'no', 'screens only'],
  },
  { name: 'filming_location', label: 'Filming location', type: 'text', placeholder: 'e.g. home studio, outdoors' },
  {
    name: 'production_level', label: 'Production level', type: 'select',
    options: ['phone only', 'simple', 'polished'],
  },
  { name: 'content_style', label: 'Content style', type: 'select', options: ['educational', 'personal', 'premium', 'soft selling', 'bold', 'storytelling'] },
  { name: 'number_of_items', label: 'Number of items', type: 'number', placeholder: '12' },
  { name: 'target_language', label: 'Target language', type: 'text', placeholder: 'English' },
  { name: 'extra_context', label: 'Extra context', type: 'textarea' },
];

function VideoScript({ vs }) {
  if (!vs) return null;
  return (
    <div className="gen-subsection">
      <AssetField label="Video hook" value={vs.hook} copy />
      <AssetField label="Spoken script" value={vs.spoken_script} copy />
      <AssetField label="On-screen text" value={vs.on_screen_text} copy />
      <AssetField label="Shot list" value={vs.shot_list} copy />
      <AssetField label="B-roll" value={vs.b_roll} copy />
      <AssetField label="CTA" value={vs.cta} copy />
    </div>
  );
}

function renderItem(item) {
  const slides = Array.isArray(item.slides) ? item.slides : [];
  return (
    <>
      <div className="gen-card-title">{item.platform} · {item.content_type}{item.pillar ? ` · ${item.pillar}` : ''}</div>
      <AssetField label="Hook" value={item.hook} copy />
      {slides.length > 0 ? (
        <div className="gen-subsection">
          <span className="gen-field-label">Carousel slides</span>
          {slides.map((s, i) => (
            <div className="gen-subsection" key={i}>
              <AssetField label={`Slide ${s.slide_number || i + 1}: ${s.heading || ''}`} value={s.body} copy />
              {s.visual && <AssetField label="Visual" value={s.visual} />}
            </div>
          ))}
        </div>
      ) : (
        <AssetField label="Caption" value={item.caption} copy />
      )}
      {item.video_script && item.video_script.spoken_script ? <VideoScript vs={item.video_script} /> : null}
      <AssetField label="CTA" value={item.cta} copy />
      <AssetField label="Visual direction" value={item.visual_direction} copy />
      <AssetField label="Hashtags (optional — not a growth guarantee)" value={item.hashtags} copy />
    </>
  );
}

const fullCopy = (i) => {
  const slides = Array.isArray(i.slides) && i.slides.length
    ? i.slides.map((s) => `Slide ${s.slide_number}: ${s.heading}\n${s.body}`).join('\n\n') : '';
  const vs = i.video_script && i.video_script.spoken_script
    ? `Hook: ${i.video_script.hook}\nScript: ${i.video_script.spoken_script}\nOn-screen: ${(i.video_script.on_screen_text || []).join(' | ')}\nShots: ${(i.video_script.shot_list || []).join(' | ')}` : '';
  return [`${i.platform} · ${i.content_type}`, `Hook: ${i.hook}`, slides || i.caption, vs, `CTA: ${i.cta}`, `Visual: ${i.visual_direction}`, (i.hashtags || []).join(' ')]
    .filter(Boolean).join('\n');
};

// ── Calendar view ───────────────────────────────────────────────────────────
function Calendar() {
  const [items, setItems] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    api.assets('social_assets').then((r) => setItems(r.items || [])).catch(() => setItems([]));
  }, []);

  async function plan(item, date) {
    setBusyId(item.id);
    try {
      const r = await api.updateAsset('social_assets', item.id, { planned_date: date || null });
      setItems((xs) => xs.map((x) => (x.id === item.id ? (r.asset || { ...x, planned_date: date }) : x)));
    } catch { /* non-blocking */ } finally { setBusyId(null); }
  }

  if (items === null) return <p className="flow-muted">Loading…</p>;
  const { unscheduled, days } = groupByPlannedDate(items);

  return (
    <div>
      <p className="flow-muted">Plan posts on dates without exporting. Set a date to schedule; clear it to move back to unscheduled.</p>

      {days.map(({ date, items: dayItems }) => (
        <div className="account-section" key={date}>
          <h3>{date}</h3>
          {dayItems.length > 2 && (
            <p className="flow-muted" role="note">{dayItems.length} posts planned on one day — an unrealistic density for most solo teams. Consider spreading them out.</p>
          )}
          {dayItems.map((it) => (
            <div className="calendar-row" key={it.id}>
              <span>{itemLabel(it)} — {it.hook}</span>
              <input type="date" value={it.planned_date || ''} disabled={busyId === it.id} onChange={(e) => plan(it, e.target.value)} />
              <button className="account-link" disabled={busyId === it.id} onClick={() => plan(it, null)}>Unschedule</button>
            </div>
          ))}
        </div>
      ))}

      <div className="account-section">
        <h3>Unscheduled ({unscheduled.length})</h3>
        {unscheduled.length === 0 && <p className="flow-muted">Everything is planned.</p>}
        {unscheduled.map((it) => (
          <div className="calendar-row" key={it.id}>
            <span>{itemLabel(it)} — {it.hook}</span>
            <input type="date" disabled={busyId === it.id} onChange={(e) => plan(it, e.target.value)} />
          </div>
        ))}
      </div>
    </div>
  );
}

const TABS = ['Create', 'Calendar'];

export default function SocialStudio() {
  const [tab, setTab] = useState(0);
  return (
    <div className="flow">
      <section className="flow-main is-wide" style={{ paddingBottom: 0 }}>
        <div className="gen-tabs" role="tablist">
          {TABS.map((t, i) => (
            <button key={t} role="tab" aria-selected={tab === i} className={tab === i ? 'gen-tab is-on' : 'gen-tab'} onClick={() => setTab(i)}>{t}</button>
          ))}
        </div>
      </section>
      {tab === 0 ? (
        <GeneratorStudio
          title="Social"
          blurb="Create channel-aware posts and scripts, then assign dates without implying direct publishing — carousels slide-by-slide, reels with full scripts, captions and pins."
          fields={FIELDS}
          initial={{ target_language: 'English', number_of_items: 12, platforms: ['instagram'], formats: ['caption', 'carousel', 'reel'] }}
          generate={(v, opts) => api.generateSocialAssets(v, opts)}
          resultKey="items"
          table="social_assets"
          renderItem={renderItem}
          fullCopy={fullCopy}
        />
      ) : (
        <div className="flow"><section className="flow-main is-wide"><Calendar /></section></div>
      )}
    </div>
  );
}
