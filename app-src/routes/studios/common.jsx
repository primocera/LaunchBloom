import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useRequestGuard } from '../../lib/use-request-guard';
import '../../flow.css';

// ---------------------------------------------------------------------------
// Shared scaffolding for the studios (Prompts 18-23): page frame (navigation
// and account live in the app sidebar), the campaign-package selector ("User
// can select a package if multiple exist"), and copy buttons with a success
// state (Prompt 29).
// ---------------------------------------------------------------------------

export function StudioShell({ title, blurb, kits, kitId, onSelectKit, children }) {
  return (
    <div className="flow">
      <section className="flow-main is-wide">
        <div className="studio-head">
          <div>
            <h2>{title}</h2>
            {blurb && <p className="flow-muted">{blurb}</p>}
          </div>
          {kits && kits.length > 1 && (
            <select className="studio-select" value={kitId || ''} onChange={(e) => onSelectKit(e.target.value)}>
              {kits.map((k) => (
                <option key={k.id} value={k.id}>{k.title || 'Campaign package'}</option>
              ))}
            </select>
          )}
        </div>
        {children}
      </section>
    </div>
  );
}

/** Loads the caller's kits and keeps a selected one (latest by default). */
export function useKits() {
  const [kits, setKits] = useState(null);
  const [kitId, setKitId] = useState(null);
  const [error, setError] = useState(null);
  const begin = useRequestGuard();

  useEffect(() => {
    const isCurrent = begin();
    api.launchKits()
      .then((r) => {
        if (!isCurrent()) return;
        setKits(r.launch_kits);
        if (r.launch_kits[0]) setKitId(r.launch_kits[0].id);
      })
      .catch((e) => { if (isCurrent()) setError(e.message); });
  }, [begin]);

  return { kits, kitId, setKitId, error, setError };
}

/**
 * v13 SC-P1-07 — the one loader every legacy studio shares.
 *
 * The four studios previously ran `useEffect(() => { setItems(null); load(); },
 * [kitId])` with `load` suppressed out of the dependency list. Switching kits
 * (the StudioShell select changes `kitId` without remounting the route) could
 * therefore show the previous kit's items if the older request resolved last,
 * and a response arriving after navigation set state on an unmounted route.
 *
 * `reload` is a stable useCallback keyed on (table, kitId), so the effect below
 * has a complete dependency list and still fires exactly once per kit change.
 */
export function useStudioItems(table, kitId) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const begin = useRequestGuard();

  const reload = useCallback(() => {
    const isCurrent = begin();
    setItems(null);
    setError(null);
    if (!kitId) return;
    api.items(table, kitId)
      .then((r) => { if (isCurrent()) setItems(r.items); })
      .catch((e) => { if (isCurrent()) setError(e.message); });
  }, [begin, table, kitId]);

  useEffect(() => { reload(); }, [reload]);

  return { items, setItems, error, setError, reload };
}

export function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="kit-copy"
      onClick={() => {
        navigator.clipboard?.writeText(typeof text === 'function' ? text() : text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? 'Copied ✓' : label}
    </button>
  );
}

/** "No campaign package yet" empty state shared by every legacy studio. */
export function NoKit() {
  return (
    <div className="flow-card">
      <h3>No campaign package yet</h3>
      <p className="flow-muted">Run the Full launch campaign and this page fills up automatically.</p>
      <Link className="flow-btn" to="/app/campaigns">Go to Campaigns</Link>
    </div>
  );
}

/** Confirm + regenerate a section, returns busy flag. */
export function useRegenerate(kitId, section, onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function regenerate() {
    if (!window.confirm('Replace the current version? The existing content will be lost.')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.regenerateSection(kitId, section);
      onDone(r.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return { regenerate, busy, error };
}
