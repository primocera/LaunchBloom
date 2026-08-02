// v13 SC-P1-07 — stale-response guard.
//
// The studios and campaign panels all reload when an authoritative id changes
// (launch-kit id, campaign id, the AssetLibrary query string) *without*
// remounting. Two failure modes follow from that:
//
//   1. race — a slow response for campaign A resolves after the user already
//      switched to campaign B, overwriting B's data with A's;
//   2. post-unmount setState — the last in-flight response resolves after the
//      route unmounted.
//
// This module is the pure core so it can be tested without a DOM: a guard hands
// out an `isCurrent()` predicate per request, and only the newest request of a
// still-live guard is allowed to commit.

/**
 * Creates a request guard.
 * @returns {{ begin: () => (() => boolean), dispose: () => void, revive: () => void }}
 */
export function createRequestGuard() {
  let seq = 0;
  let alive = true;
  return {
    /** Starts a request; the returned predicate is true only while it is the newest one. */
    begin() {
      const token = ++seq;
      return () => alive && token === seq;
    },
    /** Marks the owner unmounted — every outstanding response becomes stale. */
    dispose() {
      alive = false;
    },
    /** React StrictMode / remount: the same guard object is used again. */
    revive() {
      alive = true;
    },
  };
}
