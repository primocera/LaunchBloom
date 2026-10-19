import { useEffect, useState } from 'react';

// Busy state for AI buttons: a shimmering star glyph plus a rotating verb
// ("Creating…", "Imagining…"), so a 30-90s generation visibly keeps going.
// Screen readers hear one stable "Generating" instead of every word change.

const GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const WORDS = [
  'Creating', 'Imagining', 'Drafting', 'Brainstorming', 'Writing',
  'Shaping', 'Composing', 'Crafting', 'Polishing', 'Tidying up',
];

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function BusyLabel() {
  const [glyph, setGlyph] = useState(0);
  // Start on a random word so repeated runs don't always open the same way.
  const [word, setWord] = useState(() => Math.floor(Math.random() * WORDS.length));

  useEffect(() => {
    const still = reducedMotion();
    const g = still ? null : setInterval(() => setGlyph((i) => (i + 1) % GLYPHS.length), 120);
    const w = setInterval(() => setWord((i) => (i + 1) % WORDS.length), 2400);
    return () => { if (g) clearInterval(g); clearInterval(w); };
  }, []);

  return (
    <>
      <span className="busy-glyph" aria-hidden="true">{reducedMotion() ? '✻' : GLYPHS[glyph]}</span>
      <span aria-hidden="true">{WORDS[word]}…</span>
      <span className="sr-only">Generating</span>
    </>
  );
}
