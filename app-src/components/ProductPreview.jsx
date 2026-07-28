import { statusLabelFor } from '../lib/status-labels';

// ---------------------------------------------------------------------------
// v11 SC-04 — real-product proof on the landing page.
//
// A code-native snapshot, not a screenshot: it renders the same canonical
// status vocabulary the signed-in product renders (lib/status-labels.js), so
// it cannot drift into showing a state the product does not have, and it can
// never go stale against a rebuild the way a maintained PNG does.
//
// The data below is SYNTHETIC and is the same fixture the authenticated E2E
// matrix seeds (Northwind Studio / Autumn cohort launch), so what a visitor
// sees here is what that fixture actually produces. It is labelled as a
// product view, never as a customer result: no metrics, no outcomes, no logos.
// ---------------------------------------------------------------------------

const BRIEF = {
  campaign: 'Autumn cohort launch',
  objective: 'Fill the October cohort',
  audience: 'Independent consultants with a repeatable offer',
  message: 'One repeatable offer beats five scattered ones.',
  restrictions: 'No income claims. No guarantees of results.',
};

// One asset per canonical creation path, each in a different canonical status,
// so the sequence shows the real state machine rather than an all-green mock.
const ASSETS = [
  { channel: 'Website', title: 'Cohort landing page', status: 'ready' },
  { channel: 'Email', title: 'Four-email launch sequence', status: 'edited' },
  { channel: 'Social', title: '3-week calendar, 12 posts', status: 'draft' },
  { channel: 'Ads & Creative', title: 'Two angles, one test matrix', status: 'draft' },
  { channel: 'SEO Ideas', title: 'Six topics to research', status: 'draft' },
];

const FINDINGS = [
  { severity: 'high', text: 'The landing page promises a start date the brief does not contain.' },
  { severity: 'low', text: '“Twelve cohorts delivered” has no evidence record attached yet.' },
];

export default function ProductPreview() {
  return (
    <div className="lp-preview" aria-labelledby="lp-preview-title">
      <p className="lp-preview-caption" id="lp-preview-title">
        A product view, rendered from example data — not a customer result.
      </p>

      <ol className="lp-preview-flow">
        <li className="lp-preview-step">
          <h3>1 · The approved brief</h3>
          <dl className="lp-preview-brief">
            <div><dt>Campaign</dt><dd>{BRIEF.campaign}</dd></div>
            <div><dt>Objective</dt><dd>{BRIEF.objective}</dd></div>
            <div><dt>Audience</dt><dd>{BRIEF.audience}</dd></div>
            <div><dt>Key message</dt><dd>{BRIEF.message}</dd></div>
            <div><dt>Restrictions</dt><dd>{BRIEF.restrictions}</dd></div>
          </dl>
        </li>

        <li className="lp-preview-step">
          <h3>2 · Connected assets, each with a status</h3>
          <ul className="lp-preview-assets">
            {ASSETS.map((a) => (
              <li key={a.channel}>
                <span className="lp-preview-channel">{a.channel}</span>
                <span className="lp-preview-title">{a.title}</span>
                <span className={`lp-preview-status is-${a.status}`}>{statusLabelFor(a.status)}</span>
              </li>
            ))}
          </ul>
        </li>

        <li className="lp-preview-step">
          <h3>3 · Review findings, then handoff</h3>
          <ul className="lp-preview-findings">
            {FINDINGS.map((f) => (
              <li key={f.text}>
                <span className={`lp-preview-severity is-${f.severity}`}>
                  {f.severity === 'high' ? 'Blocks export' : 'Needs a decision'}
                </span>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
          <p className="lp-preview-handoff">
            Handoff packages what you approve as Word, PDF or a bundle. “Ready to export” means
            structured and ready for your review — never approved, compliant or published.
          </p>
        </li>
      </ol>
    </div>
  );
}
