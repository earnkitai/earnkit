'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../site/useReducedMotion';

/**
 * The three arch openings of Eckersberg's painting in its own 1600x1036 space (Landing board, `ekArches`,
 * verbatim). The painting files are 1600x1036 too, so `object-cover` and `xMidYMid slice` frame both alike.
 */
export const ARCH_PATH =
  'M62,745 L62,375 A161.5,190 0 0 1 385,375 L385,745 Z M612,745 L612,375 A186.5,192 0 0 1 985,375 L985,745 Z M1222,745 L1222,375 A159,200 0 0 1 1540,375 L1540,745 Z';

/** Both layers sit a hair larger than the hero so the drift never shows an edge. */
const LAYER = 'absolute inset-0 h-full w-full scale-[1.015]';

/**
 * The hero's painting and its light (Landing board): Eckersberg's arches (pre-sized JPEGs, no image optimizer),
 * a dusk tint inside the arches at rest, and on a mouse over the hero a warm sunset glow that follows the pointer
 * inside the arches only (700ms fade) while the painting drifts slightly the other way (1200ms ease). It listens
 * on its parent (the hero section) and writes styles directly, so a pointer move never re-renders React. Under
 * reduced motion no listener is attached: no drift, no glow; the tint stays.
 */
export default function HeroArt() {
  const reduced = useReducedMotion();
  const layer = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const glow = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (reduced) return;
    const drift = layer.current;
    const host = drift?.parentElement;
    const space = svg.current;
    const light = glow.current;
    if (!drift || !host || !space || !light) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = host.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      drift.style.transform = `translate(${(px * -8).toFixed(1)}px, ${(py * -6).toFixed(1)}px)`;
      // The pointer in the painting's own space, so the glow stays under it whatever the crop.
      const m = space.getScreenCTM();
      if (m) {
        const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
        light.setAttribute('cx', String(Math.round(at.x)));
        light.setAttribute('cy', String(Math.round(at.y)));
      }
      light.style.opacity = '1';
    };
    const leave = () => {
      drift.style.transform = '';
      light.style.opacity = '0';
    };
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    return () => {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
      leave();
    };
  }, [reduced]);

  return (
    <div ref={layer} data-hero-art="" aria-hidden="true" className="ek-drift absolute inset-0 -z-[2]">
      {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized variants, no image optimizer (plan cost rule) */}
      <img
        src="/art/hero-eckersberg-1600.jpg"
        srcSet="/art/hero-eckersberg-800.jpg 800w, /art/hero-eckersberg-1600.jpg 1600w, /art/hero-eckersberg-3200.jpg 3200w"
        // object-cover fills the hero by its height at every width (the hero is wider than 1600:1036 nowhere):
        // 776 * 1600/1036 = 1198px from md, 560 * 1600/1036 = 865px on a phone. Sizing by the column width
        // instead picked a file 1.6 to 2.2x too small on phones (blur).
        sizes="(min-width: 768px) 1198px, 865px"
        fetchPriority="high"
        decoding="async"
        alt=""
        className={`${LAYER} object-cover [filter:brightness(0.95)_saturate(1.04)_contrast(1.04)]`}
      />
      <svg ref={svg} viewBox="0 0 1600 1036" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className={LAYER}>
        <defs>
          <clipPath id="ek-arches">
            <path d={ARCH_PATH} />
          </clipPath>
          <radialGradient id="ek-sunset" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopOpacity="0.55" style={{ stopColor: 'var(--ek-s-sunset-core)' }} />
            <stop offset="0.5" stopOpacity="0.22" style={{ stopColor: 'var(--ek-s-sunset-mid)' }} />
            <stop offset="1" stopOpacity="0" style={{ stopColor: 'var(--ek-s-sunset-edge)' }} />
          </radialGradient>
          <linearGradient id="ek-dusk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopOpacity="0.35" style={{ stopColor: 'var(--ek-s-dusk-top)' }} />
            <stop offset="0.6" stopOpacity="0.18" style={{ stopColor: 'var(--ek-s-dusk-mid)' }} />
            <stop offset="1" stopOpacity="0.1" style={{ stopColor: 'var(--ek-s-dusk-bottom)' }} />
          </linearGradient>
        </defs>
        <g clipPath="url(#ek-arches)">
          <rect x="0" y="150" width="1600" height="620" fill="url(#ek-dusk)" className="mix-blend-soft-light" />
          <circle
            ref={glow}
            cx="800"
            cy="500"
            r="300"
            fill="url(#ek-sunset)"
            className="mix-blend-screen opacity-0 motion-safe:transition-opacity motion-safe:duration-700 motion-safe:ease-out"
          />
        </g>
      </svg>
    </div>
  );
}
