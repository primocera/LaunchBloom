import { useEffect, useState } from 'react';

const TYPE_MS = 65;
const ERASE_MS = 30;
const HOLD_MS = 1900;

/**
 * Types the tail of the headline out character by character, holds it, erases
 * it, then moves to the next - ReelPanda cycles ["Doomscroller", "Creative
 * Strategist", ...] this way, with a blinking cursor, not a fade.
 */
export default function RotatingWord({ words }) {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setText(words[0]);
      return undefined;
    }

    const full = words[index];

    if (!erasing && text === full) {
      const id = setTimeout(() => setErasing(true), HOLD_MS);
      return () => clearTimeout(id);
    }

    if (erasing && text === '') {
      setErasing(false);
      setIndex((i) => (i + 1) % words.length);
      return undefined;
    }

    const id = setTimeout(
      () => setText((t) => (erasing ? full.slice(0, t.length - 1) : full.slice(0, t.length + 1))),
      erasing ? ERASE_MS : TYPE_MS
    );
    return () => clearTimeout(id);
  }, [text, erasing, index, words]);

  return (
    <span className="rotating-wrap">
      {/* The longest word reserves the width so the line never reflows. */}
      <span className="rotating-ghost" aria-hidden="true">
        {words.reduce((a, b) => (b.length > a.length ? b : a))}
      </span>
      <span className="rotating-word">
        {text}
        <span className="type-cursor" aria-hidden="true">
          |
        </span>
      </span>
    </span>
  );
}
