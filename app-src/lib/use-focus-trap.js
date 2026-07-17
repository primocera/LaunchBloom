import { useEffect, useRef } from 'react';

// v5 Prompt 19: focus trap + return for dialogs, drawers and paywalls.
// While `active`, Tab/Shift+Tab cycle within the container, Escape calls
// onEscape, and focus returns to whatever was focused before opening.
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active, onEscape) {
  const ref = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    const container = ref.current;
    const previouslyFocused = document.activeElement;

    // Move focus into the container (first focusable, else the container).
    const focusables = () => Array.from(container?.querySelectorAll(FOCUSABLE) || []).filter((el) => el.offsetParent !== null);
    const first = focusables()[0];
    (first || container)?.focus();

    function onKey(e) {
      if (e.key === 'Escape') { onEscape?.(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Return focus to the trigger when the trap closes.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, [active, onEscape]);

  return ref;
}
