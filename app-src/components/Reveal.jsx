import { useEffect, useRef, useState } from 'react';

/**
 * Fades a section up as it scrolls into view, once. Starts visible if the
 * browser has no IntersectionObserver or the visitor asked for less motion,
 * so the page can never leave content stranded at opacity 0.
 */
export default function Reveal({ children, as: Tag = 'div', delay = 0, className = '', ...rest }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return undefined;
    }

    const node = ref.current;
    if (!node) return undefined;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        io.disconnect();
      },
      // Fire a little before the section reaches the fold.
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`${className} reveal${shown ? ' is-in' : ''}`.trim()}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
