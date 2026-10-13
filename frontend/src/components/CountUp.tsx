import { useEffect, useRef, useState } from 'react';

const DURATION = 1800;

/** Shows a stat value, counting up from 0 the first time it scrolls into view. Non-numeric values ("—") render as is. */
export default function CountUp({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const match = /^(-?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(value);
  const target = match ? parseFloat(match[1].replace(/,/g, '')) : NaN;
  const decimals = match?.[1].split('.')[1]?.length ?? 0;
  const suffix = match?.[2] ?? '';
  const [shown, setShown] = useState<number | null>(null);   // null = not started: show the final value
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || Number.isNaN(target) || done.current) return;
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || done.current) return;
      done.current = true;
      observer.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - start) / DURATION, 1);
        setShown(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
        else setShown(null);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.1 });
    observer.observe(el);
    return () => { observer.disconnect(); cancelAnimationFrame(raf); };
  }, [target]);

  if (Number.isNaN(target)) return <>{value}</>;
  const text = shown === null ? value : `${shown.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
  return <span ref={ref}>{text}</span>;
}
