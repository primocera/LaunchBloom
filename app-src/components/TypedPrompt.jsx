import { useEffect, useState } from 'react';

const TYPE_MS = 45;
const ERASE_MS = 22;
const HOLD_MS = 1600;

/**
 * Types a prompt out, holds it, erases it, moves to the next - with a blinking
 * cursor, the way ReelPanda's hero prompt box does.
 */
export default function TypedPrompt({ prompts }) {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setText(prompts[0]);
      return undefined;
    }

    const full = prompts[index];

    // Finished typing: pause on the complete prompt before erasing it.
    if (!erasing && text === full) {
      const id = setTimeout(() => setErasing(true), HOLD_MS);
      return () => clearTimeout(id);
    }

    // Finished erasing: advance to the next prompt.
    if (erasing && text === '') {
      setErasing(false);
      setIndex((i) => (i + 1) % prompts.length);
      return undefined;
    }

    const id = setTimeout(
      () => setText((t) => (erasing ? full.slice(0, t.length - 1) : full.slice(0, t.length + 1))),
      erasing ? ERASE_MS : TYPE_MS
    );
    return () => clearTimeout(id);
  }, [text, erasing, index, prompts]);

  return (
    <span className="typed">
      {text}
      <span className="type-cursor" aria-hidden="true">
        |
      </span>
    </span>
  );
}
