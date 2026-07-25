import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import '../flow.css';

// ---------------------------------------------------------------------------
// v10 SC-01: the guided "full launch campaign" flow is folded into the single
// campaign-creation contract — a campaign is created in Campaigns and its work
// happens in the campaign workspace. There is no second creation path.
//
// This route is deliberately NOT a bare redirect. It is the only index of
// earlier launch-kit work (/app/kits/:id is linked from nowhere else), so
// redirecting it would leave that data unreachable in practice. It is now a
// read-only archive: everything generated earlier stays readable, nothing new
// is generated here, and the one way forward is stated once.
// ---------------------------------------------------------------------------

export default function Flow() {
  const [state, setState] = useState(null); // { workspace, onboarding, positioning }
  const [offers, setOffers] = useState([]);
  const [kits, setKits] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.workspace(), api.offers(), api.launchKits()])
      .then(([ws, of, lk]) => {
        if (cancelled) return;
        setState(ws);
        setOffers(of.offers || []);
        setKits(lk.launch_kits || []);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  const positioning = state?.positioning;
  const hasEarlierWork = Boolean(positioning || offers.length || kits.length);

  return (
    <div className="flow">
      <section className="flow-main">
        <div className="studio-head">
          <div>
            <h2>Earlier launch work</h2>
            <p className="flow-muted">
              Full launch campaigns now start in Campaigns, so one brief drives every asset.
              This page keeps what you made here readable — nothing was deleted.
            </p>
          </div>
        </div>

        <div className="flow-card">
          <h3>Start a campaign</h3>
          <p className="flow-muted">
            Create the campaign, approve its brief, then create website, email, social,
            ads and SEO assets against that one brief.
          </p>
          <Link className="flow-btn" to="/app/campaigns" style={{ display: 'inline-block', textDecoration: 'none' }}>
            Go to Campaigns
          </Link>
        </div>

        {error && (
          <div className="flow-card" role="alert">
            <p className="flow-err" style={{ marginTop: 0 }}>{error}</p>
            <p className="flow-muted" style={{ marginBottom: 0 }}>
              Your earlier work is saved — this page could not load it just now.{' '}
              <button className="account-link" onClick={() => window.location.reload()}>Try again</button>
            </p>
          </div>
        )}

        {!state && !error && <p className="flow-muted">Loading…</p>}

        {state && !hasEarlierWork && (
          <div className="flow-card">
            <p className="flow-muted" style={{ margin: 0 }}>
              There is no earlier launch work in this workspace.
            </p>
          </div>
        )}

        {kits.length > 0 && (
          <>
            <h3 className="flow-h2">Campaign packages</h3>
            {kits.map((k) => (
              <Link className="flow-card kit-link" to={`/app/kits/${k.id}`} key={k.id}>
                <div>
                  <div className="kit-item-title">{k.title || 'Campaign package'}</div>
                  <div className="flow-muted">{k.summary}</div>
                </div>
                <span className="kit-open">Open →</span>
              </Link>
            ))}
          </>
        )}

        {positioning && (
          <div className="flow-card">
            <div className="flow-eyebrow">Your positioning</div>
            <h3>{positioning.recommended_niche?.niche}</h3>
            <p>{positioning.positioning_statement}</p>
            <div className="flow-kv">
              <div>
                <div className="flow-k">Ideal customer</div>
                <p>{positioning.ideal_customer?.description}</p>
              </div>
              <div>
                <div className="flow-k">Their main pain</div>
                <p>{positioning.ideal_customer?.main_pain}</p>
              </div>
              <div>
                <div className="flow-k">The transformation</div>
                <p>{positioning.desired_transformation}</p>
              </div>
              <div>
                <div className="flow-k">Elevator pitch</div>
                <p>{positioning.elevator_pitch}</p>
              </div>
            </div>
          </div>
        )}

        {offers.length > 0 && (
          <>
            <h3 className="flow-h2">Offers</h3>
            <div className="offer-grid">
              {offers.slice(0, 3).map((o) => (
                <div className="offer-card" key={o.id}>
                  <div className="offer-type">{o.offer_type}</div>
                  <h3>{o.offer_name}</h3>
                  <p className="offer-promise">{o.promise}</p>
                  <div className="offer-price">{o.price_suggestion}</div>
                  <ul>
                    {(o.what_is_included || []).slice(0, 5).map((x) => <li key={x}>{x}</li>)}
                  </ul>
                  <p className="flow-muted">{o.why_it_fits}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
