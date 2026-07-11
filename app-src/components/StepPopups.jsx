import { useEffect, useState } from 'react';

// The real pipeline a launch kit goes through — each one is a step the
// backend actually runs, not invented social proof.
const STEPS = [
  { icon: '✎', title: 'Learning about you', body: 'Your skills, audience and available time.' },
  { icon: '◎', title: 'Finding your position', body: 'A niche and promise that fit you.' },
  { icon: '⛁', title: 'Designing 3 offers', body: 'Different price points, you pick one.' },
  { icon: '⚑', title: 'Building the launch kit', body: 'Landing, content, emails, ads, SEO, plan.' },
];

const INTERVAL_MS = 2600;

export default function StepPopups() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    // Fade the card out, swap the content while it is invisible, fade back in.
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % STEPS.length);
        setVisible(true);
      }, 320);
    }, INTERVAL_MS);

    return () => clearInterval(id);
  }, []);

  const step = STEPS[index];

  return (
    <div className={visible ? 'popup is-visible' : 'popup'} aria-live="polite">
      <div className="popup-icon">{step.icon}</div>
      <div>
        <div className="popup-title">{step.title}</div>
        <div className="popup-body">{step.body}</div>
      </div>
      <div className="popup-dots">
        {STEPS.map((s, i) => (
          <span key={s.title} className={i === index ? 'is-on' : ''} />
        ))}
      </div>
    </div>
  );
}
