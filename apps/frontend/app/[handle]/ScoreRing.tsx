import { SCORE_COLORS } from './score-colors';

const VIEW = 120;

/**
 * profile-whoop: a calm numeric ring. One solid arc (value / max of the circle, from 12 o'clock)
 * over a quiet track, the number in the middle. No gradient, no glow. The arc draws in once
 * (globals.css .ek-arc; none under prefers-reduced-motion). The whole ring is one image with a
 * text equivalent (`label`, default "Score 41 of 100"). `className` sets the size.
 */
export default function ScoreRing({
  score,
  max = 100,
  color = SCORE_COLORS.total,
  label,
  stroke = 8,
  className = 'h-44 w-44',
  numberClassName = 'text-[3.25rem] md:text-[4rem]',
  caption = 'of 100',
}: {
  score: number;
  max?: number;
  color?: string;
  label?: string;
  stroke?: number;
  className?: string;
  numberClassName?: string;
  /** The small line under the number; null for none. */
  caption?: string | null;
}) {
  const top = Math.max(1, max);
  const shown = Math.max(0, Math.min(top, Math.round(score)));
  const share = (100 * shown) / top;
  const r = (VIEW - stroke) / 2 - 1;
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
        className="h-full w-full -rotate-90"
      >
        <circle
          cx={VIEW / 2}
          cy={VIEW / 2}
          r={r}
          fill="none"
          stroke={SCORE_COLORS.track}
          strokeWidth={stroke}
        />
        {shown > 0 ? (
          <circle
            className="ek-arc"
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="100 100"
            strokeDashoffset={100 - share}
          />
        ) : null}
      </svg>
      <div
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center"
      >
        <span
          className={`font-funnel-display font-medium leading-none tracking-tight text-ek-white tabular-nums ${numberClassName}`}
        >
          {shown}
        </span>
        {caption ? (
          <span className="mt-1.5 font-funnel-sans text-xs text-ek-blue-soft">
            {caption}
          </span>
        ) : null}
      </div>
    </div>
  );
}
