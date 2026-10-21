import { dollars } from '../../../lib/earnkit/bench-data';
import { BACKERS, backLabel, backOn, feesBy, keepsLine } from '../../../lib/earnkit/site-copy';
import type { TokenCard as Token } from '../../../lib/earnkit/site-data';
import { CARD_NAVY, phoneRadius } from '../../components/site/ui';

const TILE = 'flex min-w-0 flex-col gap-1 rounded-[20px] bg-s-navy-inner p-4';

/**
 * The navy Token card (BackedBuilder board), only from profileSite's token (EARNKIT_RAISING on, backing open, never
 * EarnKit's own repo): the coin and $SYMBOL, backers and fees earned, new backers per week over 12 weeks (the last
 * bar lit), the white "Back <first>" pill to the coin's page and what the builder keeps.
 */
export default function TokenCard({ token, first }: { token: Token; first: string }) {
  const max = Math.max(1, ...token.weeks);
  return (
    <div data-ek-token="" className={`${phoneRadius(CARD_NAVY)} flex flex-col gap-[18px] p-7`}>
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="ek-serif flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full text-[26px] leading-none text-s-text shadow-[inset_0_0_0_3px_var(--ek-s-coin-ring)]"
          style={{ background: token.color }}
        >
          {token.letter}
        </span>
        <div className="flex min-w-0 flex-grow flex-col gap-0.5">
          <span className="ek-serif break-words text-[32px] leading-none">{`$${token.symbol}`}</span>
          <span className="text-[13px] text-s-on-navy">{backOn(first)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className={TILE}>
          <span className="ek-serif text-[32px] leading-none tabular-nums">{token.backers.toLocaleString('en-US')}</span>
          <span className="text-[13px] text-s-on-navy">{BACKERS}</span>
        </div>
        <div className={TILE}>
          <span className="ek-serif text-[32px] leading-none tabular-nums">{dollars(token.fees_usd)}</span>
          <span className="text-[13px] text-s-on-navy">{feesBy(first)}</span>
        </div>
      </div>
      <div role="img" aria-label="New backers each week, last 12 weeks" className="flex h-10 items-end gap-1">
        {token.weeks.map((n, i) => (
          <span
            key={i}
            className={`block flex-1 rounded-[4px] ${i === token.weeks.length - 1 ? 'bg-s-bar-on' : 'bg-s-bar-off'}`}
            style={{ height: `${Math.max(8, Math.round((n / max) * 100))}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={token.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-full bg-s-light px-[22px] text-[14px] font-bold text-s-ink hover:bg-s-light-hover motion-safe:transition-colors motion-safe:duration-200"
        >
          {backLabel(first)}
        </a>
        <span className="text-[13px] text-s-on-navy">{keepsLine(first)}</span>
      </div>
    </div>
  );
}
