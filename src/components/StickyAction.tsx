import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  /** Primary action(s) to mirror when the inline original scrolls offscreen. */
  children: ReactNode;
  /** Optional caption shown above the floating mirror to remind users which action this is. */
  caption?: string;
  /** Disable the floating mirror without removing the inline children. */
  enabled?: boolean;
}

/**
 * Renders `children` inline. While the inline copy is scrolled out of view, also
 * renders a glass-blurred floating dock at the bottom of the viewport with a
 * mirror of the same children, so the primary action is always reachable.
 *
 * Implementation note: the mirror is a *clone* of the same JSX. Click handlers
 * fire on the cloned button — React deduplicates because both are real DOM
 * nodes, but they share the same prop closure. No extra wiring needed.
 */
export function StickyAction({ children, caption, enabled = true }: Props): JSX.Element {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [offscreen, setOffscreen] = useState(false);

  useEffect(() => {
    if (!enabled) { setOffscreen(false); return; }
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setOffscreen(!entry.isIntersecting),
      { threshold: 0, rootMargin: '-8px 0px 0px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);

  return (
    <>
      <div ref={sentinelRef}>{children}</div>
      {enabled && offscreen && (
        <div className="sticky-action-dock" role="region" aria-label={caption ?? 'Primary action'}>
          {caption && <span className="sticky-action-caption">{caption}</span>}
          <div className="sticky-action-children">{children}</div>
        </div>
      )}
    </>
  );
}
