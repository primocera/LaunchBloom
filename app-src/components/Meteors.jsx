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

export default function Meteors() {
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
