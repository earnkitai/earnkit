import { useId } from 'react';

/** The ring's two accents on the page's navy panel (orange to purple, v2.12 plan R17). */
export const SCORE_COLORS = { from: '#FF7A1A', to: '#9B6BFF', panel: '#0F1839' } as const;

const VIEW = 200;
const STROKE = 14;
const R = (VIEW - STROKE) / 2 - 6;
const C = 2 * Math.PI * R;

/**
 * v2.12 spec 7: the score ring. One dominant number in the middle; the arc (score / 100 of the
 * circle, from 12 o'clock) is stroked with the orange to purple gradient of the two score tokens
 * over an ek-navy track. The whole ring is one image with a text equivalent ("Shipping 41 of 100").
 * Scales with its box: `className` sets the size (the viewBox does the rest).
 */
export default function ScoreRing({
  score,
  className = 'h-44 w-44',
  numberClassName = 'text-[3.25rem] md:text-[4rem]',
}: {
  score: number;
  className?: string;
  /** v2.12.1 T11: the number's size, for a smaller ring beside the rank line. */
  numberClassName?: string;
}) {
  const id = `ek-score-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const shown = Math.max(0, Math.min(100, Math.round(score)));
  const arc = (C * shown) / 100;
  return (
    <div role="img" aria-label={`Shipping ${shown} of 100`} className={`relative shrink-0 ${className}`}>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} aria-hidden="true" focusable="false" className="h-full w-full -rotate-90 overflow-visible">
        <defs>
          {/* In the rotated frame +x is up: orange at 12 o'clock, purple at 6. */}
          <linearGradient id={id} x1={VIEW} y1={VIEW / 2} x2="0" y2={VIEW / 2} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={SCORE_COLORS.from} />
            <stop offset="1" stopColor={SCORE_COLORS.to} />
          </linearGradient>
        </defs>
        <circle cx={VIEW / 2} cy={VIEW / 2} r={R} fill="none" stroke="#112969" strokeWidth={STROKE} />
        {shown > 0 ? (
          <circle
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={R}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${C}`}
            style={{ filter: 'drop-shadow(0 0 10px rgba(255, 122, 26, 0.35))' }}
          />
        ) : null}
      </svg>
      <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-funnel-display font-semibold leading-none tracking-tight text-ek-white tabular-nums ${numberClassName}`}>
          {shown}
        </span>
        <span className="mt-1 font-funnel-sans text-xs font-medium text-ek-blue-soft">of 100</span>
      </div>
    </div>
  );
}
