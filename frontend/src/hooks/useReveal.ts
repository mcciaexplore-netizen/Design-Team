import { useEffect, useRef } from 'react';

/**
 * Fades the direct children of the returned ref's element up as they scroll into view, ~80ms apart.
 * Pass something that changes when the children change (e.g. the list length) so new ones are picked up.
 */
export function useReveal<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const kids = Array.from(root.children).filter((el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains('reveal-in'));
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let batch = 0;
    const observer = new IntersectionObserver(entries => {
      batch = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.style.transitionDelay = `${Math.min(batch++, 8) * 80}ms`;
        el.classList.add('reveal-in');
        const done = (ev: TransitionEvent) => {
          if (ev.target !== el || ev.propertyName !== 'transform') return;
          el.removeEventListener('transitionend', done);
          el.classList.remove('reveal', 'reveal-in');
          el.style.transitionDelay = '';
        };
        el.addEventListener('transitionend', done);
        observer.unobserve(el);
      }
    }, { threshold: 0.1 });
    kids.forEach(el => { el.classList.add('reveal'); observer.observe(el); });
    return () => observer.disconnect();
  }, [dep]);
  return ref;
}
