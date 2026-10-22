import Link from 'next/link';
import { SCORE_HOW, SCORE_HOW_HREF, SCORE_PENDING, SCORE_SOURCE, SCORE_TITLE, scoreNote } from '../../../lib/earnkit/site-copy';
import { INLINE_LINK } from '../../components/common/Button';
import { CARD_NAVY, phoneRadius } from '../../components/site/ui';
import ScoreRing from '../ScoreRing';

/** The inline link on navy: white, 44px to the touch without moving the line (Button.tsx INLINE_LINK). */
const HOW_LINK = INLINE_LINK.replace('text-ek-text', 'text-s-text');

/**
 * The navy Shipping score card (Profile board): the 132px ring, the title and what the number means, where it comes
 * from (GitHub commits, never self-reported) and a link to how it's scored (/docs#score); no score yet says when it shows.
 */
export default function ScoreCard({ score, first }: { score: number | null; first: string }) {
  return (
    <div data-ek-score="" className={`${phoneRadius(CARD_NAVY)} flex flex-auto items-center gap-[22px] p-7`}>
      <ScoreRing score={score} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[15px] font-semibold">{SCORE_TITLE}</span>
        <span className="text-[14px] leading-[1.5] text-s-on-navy">
          {score === null ? SCORE_PENDING : `${scoreNote(first)} ${SCORE_SOURCE}`}{' '}
          <Link href={SCORE_HOW_HREF} className={HOW_LINK}>
            {SCORE_HOW}
          </Link>
        </span>
      </div>
    </div>
  );
}
