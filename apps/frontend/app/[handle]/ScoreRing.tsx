import { useId } from 'react';
import { SCORE_COLORS, type Hue } from './score-colors';

const VIEW = 120;

/**
 * profile-whoop v2: a numeric ring. The arc (value / max of the circle, from 12 o'clock) is a smooth
 * gradient stroke in the score's hue family with a rounded cap over a thin dim track, and a very soft
 * glow in its own color. The number sits in the middle in tabular figures. The arc draws in once
 * (globals.css .ek-arc; none under prefers-reduced-motion). The whole ring is one image with a text
 * equivalent (`label`, default "Score 41 of 100"). `className` sets the size.
 */
export default function ScoreRing({
  score,
  max = 100,
  hue = SCORE_COLORS.total,
  label,
  stroke = 8,
  track = 3,
  glow = true,
  className = 'h-44 w-44',
  numberClassName = 'text-[3.25rem] md:text-[4rem]',
  caption = 'of 100',
}: {
  score: number;
  max?: number;
  hue?: Hue;
  label?: string;
  stroke?: number;
  /** The track's width (thinner than the arc). */
  track?: number;
  glow?: boolean;
  className?: string;
  numberClassName?: string;
  /** The small line under the number; null for none. */
  caption?: string | null;
}) {
  const id = `ek-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const top = Math.max(1, max);
  const shown = Math.max(0, Math.min(top, Math.round(score)));
  const share = (100 * shown) / top;
  const r = (VIEW - stroke) / 2 - 4;
  const c = VIEW / 2;
  return (
    <div
      role="img"
      aria-label={label ?? `Score ${shown} of ${top}`}
      className={`relative shrink-0 ${className}`}
    >
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        aria-hidden="true"
        focusable="false"
        className="h-full w-full -rotate-90 overflow-visible"
      >
        <defs>
          {/* In the rotated frame +x is up: `from` at 12 o'clock, `to` around the far side. */}
          <linearGradient
            id={id}
            x1={VIEW}
            y1="0"
            x2="0"
            y2={VIEW}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor={hue.from} />
            <stop offset="1" stopColor={hue.to} />
          </linearGradient>
        </defs>
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={SCORE_COLORS.track}
          strokeWidth={track}
        />
        {shown > 0 ? (
          <circle
            className="ek-arc"
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100 100"
            strokeDashoffset={100 - share}
            style={
              glow ? { filter: `drop-shadow(0 0 6px ${hue.to}40)` } : undefined
            }
          />
        ) : null}
      </svg>
      <div
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center"
      >
        <span
          className={`font-funnel-display font-medium leading-none tracking-[-0.03em] text-[#F5F6F8] tabular-nums ${numberClassName}`}
        >
          {shown}
        </span>
        {caption ? (
          <span className="mt-1.5 font-funnel-sans text-[10px] font-medium uppercase tracking-[0.18em] text-[#9BA1AC]">
            {caption}
          </span>
        ) : null}
      </div>
    </div>
  );
}
