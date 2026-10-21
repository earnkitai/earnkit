import { useId } from 'react';
import { scoreBand } from '../../lib/earnkit/site-copy';
import { SITE } from '../../lib/earnkit/site-theme';

/** A number not there yet (no score, confirming, no project). */
export const DASH = '–';

/** One hue per band, light to deep (the design doc's ring gradients; never multi-hue). */
const BAND = {
  good: [SITE.goodLight, SITE.goodDeep],
  mid: [SITE.midLight, SITE.midDeep],
  low: [SITE.lowLight, SITE.lowDeep],
} as const;
const VIEW = 148;
const R = 62;
const STROKE = 12;

/**
 * v3.1 (Profile board): the Shipping score ring, 132px. A 12px track on navy and, over it from 12 o'clock, the score's
 * arc in one hue (its band, light to deep) with round caps; the number in Kaftan Serif in the middle. The arc draws in
 * once (globals.css .ek-arc; none under reduced motion). No score: the track alone and a dash. One image with a text
 * equivalent.
 */
export default function ScoreRing({ score }: { score: number | null }) {
  const id = `ek-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const shown = score === null ? null : Math.max(0, Math.min(100, Math.round(score)));
  const [light, deep] = BAND[scoreBand(shown ?? 0)];
  const c = VIEW / 2;
  return (
    <div className="relative h-[132px] w-[132px] shrink-0">
      <svg
        width="132"
        height="132"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="img"
        aria-label={shown === null ? 'Shipping score not shown yet' : `Shipping score ${shown} out of 100`}
        className="block"
      >
        {shown ? (
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={light} />
              <stop offset="1" stopColor={deep} />
            </linearGradient>
          </defs>
        ) : null}
        <circle cx={c} cy={c} r={R} fill="none" stroke="var(--ek-s-navy-track)" strokeWidth={STROKE} />
        {shown ? (
          <circle
            className="ek-arc"
            cx={c}
            cy={c}
            r={R}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={STROKE}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100 100"
            strokeDashoffset={100 - shown}
            transform={`rotate(-90 ${c} ${c})`}
          />
        ) : null}
      </svg>
      <span aria-hidden="true" className={`ek-serif absolute inset-0 flex items-center justify-center text-[56px] leading-none tabular-nums ${shown === null ? 'text-s-on-navy' : 'text-s-text'}`}>
        {shown === null ? DASH : shown}
      </span>
    </div>
  );
}
