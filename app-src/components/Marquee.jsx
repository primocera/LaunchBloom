/**
 * Infinite left-to-right logo strip. The list is rendered twice so the second
 * copy slides in exactly as the first slides out; the CSS translates by -50%,
 * which is one full copy.
 */
export default function Marquee({ items }) {
  return (
    <div className="marquee" aria-label={items.join(', ')}>
      <div className="marquee-track">
        {[0, 1].map((copy) => (
          <div className="marquee-group" key={copy} aria-hidden={copy === 1}>
            {items.map((item) => (
              <span className="marquee-item" key={item}>
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
