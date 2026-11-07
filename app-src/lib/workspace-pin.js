// ---------------------------------------------------------------------------
// The active workspace, pinned per browser tab.
//
// localStorage is shared by every tab, so an agency with client A open in one
// tab and client B in another used to send B's id from A's tab after the switch
// (A's next Brand Profile autosave landed in B's workspace). Each tab now keeps
// its own copy in sessionStorage; localStorage only seeds a NEW tab with the
// last workspace chosen anywhere, as before.
// ---------------------------------------------------------------------------

export const WORKSPACE_KEY = 'active_workspace_id';

function safeGet(store, key) {
  try { return store ? store.getItem(key) : null; } catch { return null; }
}
function safeSet(store, key, id) {
  try {
    if (!store) return;
    if (id) store.setItem(key, id);
    else store.removeItem(key);
  } catch { /* private mode / blocked storage */ }
}

/** This tab's workspace; a tab that never chose one adopts (and pins) the shared last choice. */
export function readActiveWorkspace(local, session) {
  const pinned = safeGet(session, WORKSPACE_KEY);
  if (pinned) return pinned;
  const shared = safeGet(local, WORKSPACE_KEY);
  if (shared) safeSet(session, WORKSPACE_KEY, shared);
  return shared;
}

/** Forget `id` wherever it is still stored (it was archived or deleted). */
export function dropActiveWorkspace(local, session, id) {
  if (!id) return;
  if (safeGet(session, WORKSPACE_KEY) === id) safeSet(session, WORKSPACE_KEY, null);
  if (safeGet(local, WORKSPACE_KEY) === id) safeSet(local, WORKSPACE_KEY, null);
}

/** Choose a workspace in this tab; it also becomes the default for new tabs. */
export function writeActiveWorkspace(local, session, id) {
  safeSet(session, WORKSPACE_KEY, id);
  safeSet(local, WORKSPACE_KEY, id);
}
