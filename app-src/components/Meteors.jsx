import { useEffect, useState } from 'react';

/**
 * The light streaks that sweep across the blue hero. Copied from ReelPanda's
 * `rp-meteor`: seven 1px lines, each with its own position, length, duration
 * and delay, so they never cross the sky in step.
 */
const METEORS = [
  { left: '8%', top: '18%', width: 110, duration: 8, delay: 1.5 },
  { left: '16%', top: '32%', width: 100, duration: 5.6, delay: 0.2 },
  { left: '28%', top: '24%', width: 120, duration: 7, delay: 0.6 },
  { left: '40%', top: '14%', width: 120, duration: 5.9, delay: 0.2 },
  { left: '55%', top: '30%', width: 120, duration: 6, delay: 2 },
  { left: '72%', top: '20%', width: 100, duration: 6, delay: 2.4 },
  { left: '86%', top: '36%', width: 100, duration: 7.4, delay: 3.2 },
];

/**
 * v10 SC-05 (LCP): purely decorative, so it must not compete with the hero for
 * the first paint. Mounting is deferred until the browser is idle, and skipped
 * entirely under prefers-reduced-motion — seven infinite animations are exactly
 * what that setting exists to prevent.
 */
export default function Meteors() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(() => setShow(true), { timeout: 1500 })
      : window.setTimeout(() => setShow(true), 300);
    return () => {
      if (window.cancelIdleCallback && window.requestIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="lp-meteors" aria-hidden="true">
      {METEORS.map((m, i) => (
        <span
          key={i}
          className="lp-meteor"
          style={{
            left: m.left,
            top: m.top,
            width: `${m.width}px`,
            animationDuration: `${m.duration}s`,
            animationDelay: `${m.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
