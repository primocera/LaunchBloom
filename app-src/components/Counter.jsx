import { useEffect, useRef, useState } from 'react';

/**
 * Counts from 0 up to `to` the first time it scrolls into view, the way
 * ReelPanda's "0+" stats do. Runs once; respects reduced-motion by jumping
 * straight to the final value.
 */
export default function Counter({ to, suffix = '', duration = 1400 }) {
  const [value, setValue] = useState(0);
  const ref = useRef(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setValue(to);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || done.current) return;
        done.current = true;

        const start = performance.now();
        const tick = (now) => {
          const t = Math.min(1, (now - start) / duration);
          // Ease-out cubic: fast off the mark, settles onto the number.
          const eased = 1 - Math.pow(1 - t, 3);
          setValue(Math.round(eased * to));
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [to, duration]);

  return (
    <span ref={ref} className="counter">
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}
