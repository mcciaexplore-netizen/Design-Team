import { useEffect, useRef } from 'react';

const CELL = 45;
const SPEED = 0.4;     // px per frame, diagonal
const TRAIL = 6;       // cells the hover highlight leaves behind

/** A drifting square grid that fills its (positioned) parent; the cell under the pointer lights up and fades out. */
export default function GridBackground({ stroke = 'rgba(11,31,58,0.04)', fill = 'rgba(11,31,58,0.06)' }: { stroke?: string; fill?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !parent || !ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let w = 0, h = 0, offset = 0, raf = 0;
    let trail: { cx: number; cy: number }[] = [];

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = parent.clientWidth; h = parent.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      trail.forEach((c, i) => {                       // oldest first, so it fades toward the tail
        ctx.globalAlpha = (i + 1) / (TRAIL + 1);
        ctx.fillStyle = fill;
        ctx.fillRect(c.cx * CELL + offset - CELL, c.cy * CELL + offset - CELL, CELL, CELL);
      });
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = (offset % CELL) - CELL; x < w; x += CELL) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = (offset % CELL) - CELL; y < h; y += CELL) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    };
    const loop = () => {
      offset = (offset + SPEED) % CELL;
      draw();
      raf = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => {
      const r = parent.getBoundingClientRect();
      const cx = Math.floor((e.clientX - r.left - offset + CELL) / CELL);
      const cy = Math.floor((e.clientY - r.top - offset + CELL) / CELL);
      const last = trail[trail.length - 1];
      if (last && last.cx === cx && last.cy === cy) return;
      trail = [...trail.filter(c => c.cx !== cx || c.cy !== cy), { cx, cy }].slice(-TRAIL);
    };
    const onLeave = () => { trail = []; };

    resize();
    const ro = new ResizeObserver(() => { resize(); if (reduced) draw(); });
    ro.observe(parent);
    if (reduced) draw();
    else {
      raf = requestAnimationFrame(loop);
      parent.addEventListener('pointermove', onMove);
      parent.addEventListener('pointerleave', onLeave);
    }
    return () => { cancelAnimationFrame(raf); ro.disconnect(); parent.removeEventListener('pointermove', onMove); parent.removeEventListener('pointerleave', onLeave); };
  }, [stroke, fill]);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />;
}
