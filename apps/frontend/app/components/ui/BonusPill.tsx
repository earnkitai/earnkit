import { useId } from 'react';

/** v2.8 Ruling 19 (plan): the pill's words. */
export const BONUS_PILL_TEXT = 'Builder bonus';

/**
 * The pill's colors: the navy fill (ek-navy-deep) and the orange gradient's stops (ek-orange to
 * ek-amber). Each stop is above 4.5:1 against the fill (public-pages.test.ts checks it).
 */
export const BONUS_PILL_COLORS = { fill: '#0F1839', from: '#FE6C11', to: '#FC9E19' } as const;

/** The amount to show, or null: never empty and never a zero ("0 ETH", "0.00 ETH"). */
const shownAmount = (amount?: string | null) => {
  const a = amount?.trim();
  if (!a || /^0+(\.0+)?(\s|$)/.test(a)) return null;
  return a;
};

/** "Builder bonus", or "Builder bonus · 0.42 ETH" once that pool is above 0. Pure. */
export const bonusPillLabel = (amount?: string | null) => {
  const a = shownAmount(amount);
  return a ? `${BONUS_PILL_TEXT} · ${a}` : BONUS_PILL_TEXT;
};

const SIZES = {
  sm: { box: 'h-7 px-3 text-xs', mark: 'h-3 w-3' },
  md: { box: 'h-9 px-4 text-sm', mark: 'h-3.5 w-3.5' },
  lg: { box: 'h-11 px-5 text-base', mark: 'h-4 w-4' },
} as const;

const { fill, from, to } = BONUS_PILL_COLORS;

/**
 * v2.8 Ruling 19 (plan): the builder bonus brand pill, one component for the hero, the cards, the
 * guide page, the install modal and /policy. A navy fill inside a 1px orange gradient border (two
 * backgrounds: the fill clipped to the padding box over the gradient on the border box), a small
 * four-point spark and orange gradient text. With `href` it is a link, otherwise a span.
 */
export default function BonusPill({
  size = 'md',
  amount = null,
  href,
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg';
  amount?: string | null;
  href?: string;
  className?: string;
}) {
  const gradientId = `ek-bonus-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const shown = shownAmount(amount);
  const s = SIZES[size];
  const classes = [
    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent font-funnel-sans font-semibold leading-none',
    'shadow-[inset_0_1px_0_rgba(252,158,25,0.16),0_0_20px_-6px_rgba(254,108,17,0.45)]',
    s.box,
    href ? 'transition-shadow duration-200 hover:shadow-[inset_0_1px_0_rgba(252,158,25,0.24),0_0_28px_-4px_rgba(254,108,17,0.6)]' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const style = {
    background: `linear-gradient(${fill}, ${fill}) padding-box, linear-gradient(90deg, ${from}, ${to}) border-box`,
  };
  const body = (
    <>
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={`${s.mark} shrink-0`}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <path
          fill={`url(#${gradientId})`}
          d="M8 .5c.55 4.05 3.45 6.95 7.5 7.5-4.05.55-6.95 3.45-7.5 7.5C7.45 11.45 4.55 8.55.5 8 4.55 7.45 7.45 4.55 8 .5Z"
        />
      </svg>
      <span className="bg-gradient-to-r from-ek-orange to-ek-amber bg-clip-text text-transparent">
        {BONUS_PILL_TEXT}
        {shown && (
          <>
            {' · '}
            <span className="tabular-nums">{shown}</span>
          </>
        )}
      </span>
    </>
  );
  return href ? (
    <a href={href} className={classes} style={style}>
      {body}
    </a>
  ) : (
    <span className={classes} style={style}>
      {body}
    </span>
  );
}
