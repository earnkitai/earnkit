import { SCORE_PENDING, SCORE_TITLE, scoreNote } from '../../../lib/earnkit/site-copy';
import { CARD_NAVY, phoneRadius } from '../../components/site/ui';
import ScoreRing from '../ScoreRing';

/** The navy Shipping score card (Profile board): the 132px ring, the title and what the number means; no score yet says when it shows. */
export default function ScoreCard({ score, first }: { score: number | null; first: string }) {
  return (
    <div data-ek-score="" className={`${phoneRadius(CARD_NAVY)} flex flex-auto items-center gap-[22px] p-7`}>
      <ScoreRing score={score} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[15px] font-semibold">{SCORE_TITLE}</span>
        <span className="text-[14px] leading-[1.5] text-s-on-navy">{score === null ? SCORE_PENDING : scoreNote(first)}</span>
      </div>
    </div>
  );
}
