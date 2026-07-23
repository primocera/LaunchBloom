import { useEffect, useState } from 'react';
import { api, getActiveWorkspace, setActiveWorkspace } from '../lib/api';

// Prompt 7: brand/client workspace switcher. Switching sets the active id and
// reloads so every view refetches under the new workspace.
export default function WorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState(null);
  const [active, setActive] = useState(getActiveWorkspace());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(null); // string while naming, null when closed

  async function load() {
    try {
      const { workspaces: list } = await api.workspaces();
      const activeList = list.filter((w) => !w.archived);
      setWorkspaces(activeList);
      // Default the active workspace to the first one if none is stored/valid.
      if (!activeList.find((w) => w.id === getActiveWorkspace()) && activeList[0]) {
        setActiveWorkspace(activeList[0].id);
        setActive(activeList[0].id);
      }
    } catch {
      /* leave empty */
    }
  }

  useEffect(() => { load(); }, []);

  function switchTo(id) {
    if (!id || id === getActiveWorkspace()) return;
    setActiveWorkspace(id);
    window.location.assign('/app');
  }

  // v9 SC-09: inline create (no window.prompt) — accessible, keyboard-friendly.
  async function createWorkspace(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api.createWorkspace((creating || '').trim() || 'New workspace');
      setActiveWorkspace(workspace.id);
      window.location.assign('/app');
    } catch (err) {
      setError(err.code === 'UPGRADE' ? err.message : 'Could not create workspace.');
      setBusy(false);
    }
  }

  if (!workspaces) return null;

  return (
    <div className="ws-switcher">
      <label className="ws-label" htmlFor="ws-select">Workspace</label>
      <select
        id="ws-select"
        className="ws-select"
        value={active || ''}
        onChange={(e) => switchTo(e.target.value)}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>{w.name}</option>
        ))}
      </select>
      {creating === null ? (
        <button className="ws-new" onClick={() => setCreating('')} disabled={busy} title="New workspace">+ New</button>
      ) : (
        <form className="ws-create" onSubmit={createWorkspace}>
          <input aria-label="New workspace name (brand or client)" autoFocus placeholder="Brand or client name"
            value={creating} onChange={(e) => setCreating(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setCreating(null)} />
          <button className="ws-new" type="submit" disabled={busy}>Create</button>
          <button className="account-link" type="button" onClick={() => setCreating(null)}>Cancel</button>
        </form>
      )}
      {error && <div className="ws-error">{error}</div>}
    </div>
  );
}
