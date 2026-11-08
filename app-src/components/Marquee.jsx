/**
 * Infinite left-to-right logo strip. The list is rendered twice so the second
 * copy slides in exactly as the first slides out; the CSS translates by -50%,
 * which is one full copy.
 *
 * `iconFor(item)` is optional - when it returns a component, a brand-board
 * icon renders before that item's text (decorative only; the text itself
 * never changes).
 */
export default function Marquee({ items, iconFor }) {
  return (
    <div className="marquee" aria-label={items.join(', ')}>
      <div className="marquee-track">
        {[0, 1].map((copy) => (
          <div className="marquee-group" key={copy} aria-hidden={copy === 1}>
            {items.map((item) => {
              const Icon = iconFor ? iconFor(item) : null;
              return (
                <span className="marquee-item" key={item}>
                  {Icon && <Icon className="marquee-item-icon" />}
                  {item}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
