import { useCallback, useEffect, useRef } from 'react';
import { createRequestGuard } from './request';

// v13 SC-P1-07 — React binding for createRequestGuard.
//
// Usage:
//   const begin = useRequestGuard();
//   const load = useCallback(() => {
//     const isCurrent = begin();
//     api.x(id).then((d) => { if (isCurrent()) setData(d); });
//   }, [begin, id]);
//   useEffect(() => { load(); }, [load]);
//
// `begin` is referentially stable, so it never re-triggers a load effect; the
// only thing that does is the authoritative id in the loader's dep list.

/** @returns {() => (() => boolean)} start a request, get an "is still current" predicate. */
export function useRequestGuard() {
  const ref = useRef(null);
  if (ref.current === null) ref.current = createRequestGuard();

  useEffect(() => {
    const guard = ref.current;
    guard.revive();
    return () => guard.dispose();
  }, []);

  return useCallback(() => ref.current.begin(), []);
}
