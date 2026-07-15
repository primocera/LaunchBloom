import { useEffect, useState } from 'react';
import { api, getActiveWorkspace, setActiveWorkspace } from '../lib/api';

// Prompt 7: brand/client workspace switcher. Switching sets the active id and
// reloads so every view refetches under the new workspace.
export default function WorkspaceSwitcher() {
  const [workspaces, setWorkspaces] = useState(null);
  const [active, setActive] = useState(getActiveWorkspace());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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

  async function createWorkspace() {
    const name = window.prompt('Name your new workspace (brand or client):');
    if (name === null) return;
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api.createWorkspace(name.trim() || 'New workspace');
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
      <button className="ws-new" onClick={createWorkspace} disabled={busy} title="New workspace">+ New</button>
      {error && <div className="ws-error">{error}</div>}
    </div>
  );
}
