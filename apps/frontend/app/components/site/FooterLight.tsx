'use client';

import { useEffect, useRef } from 'react';
import { useMediaQuery, useReducedMotion } from './useReducedMotion';

/** No light under reduced motion or on a touch screen (no pointer to follow). */
export function lightOn({ reduced, touch }: { reduced: boolean; touch: boolean }): boolean {
  return !reduced && !touch;
}

/** The light at a point inside the footer (Foot board: a 260px warm radial, screened over the painting). */
function lightAt(x: number, y: number): string {
  return `radial-gradient(260px circle at ${x}px ${y}px, var(--ek-s-foot-glow) 0%, var(--ek-s-foot-glow-mid) 45%, transparent 75%)`;
}

/**
 * The full footer's pointer light: a warm glow that follows the pointer over the painting and fades out
 * (700ms) when it leaves. It listens on its parent (the footer) and writes the layer's style directly, so a
 * pointer move never re-renders React. Nothing renders, and no listener is attached, under reduced motion
 * or on a touch screen.
 */
export default function FooterLight() {
  const reduced = useReducedMotion();
  const touch = useMediaQuery('(hover: none)', true);
  const on = lightOn({ reduced, touch });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!on) return;
    const layer = ref.current;
    const host = layer?.parentElement;
    if (!layer || !host) return;
    const move = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      layer.style.background = lightAt(Math.round(e.clientX - r.left), Math.round(e.clientY - r.top));
      layer.style.opacity = '1';
    };
    const leave = () => {
      layer.style.opacity = '0';
    };
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    return () => {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
    };
  }, [on]);

  if (!on) return null;
  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[-3] opacity-0 mix-blend-screen transition-opacity duration-700 ease-out"
    />
  );
}
