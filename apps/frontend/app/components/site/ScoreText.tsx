import { SCORE_UNIT, scoreBand } from '../../../lib/earnkit/site-copy';
import Serif from './Serif';

/** S13: one text colour per band everywhere a score is a number. */
const BAND_TEXT = { good: 'text-s-good-text', mid: 'text-s-mid-text', low: 'text-s-low-text' } as const;

/**
 * A Shipping score in Kaftan Serif, coloured by its band. With `unit` (the text class of a quiet caption for the
 * surface it sits on), the number gets a small "Shipping" under it, so a bare number never stands alone.
 */
export default function ScoreText({ score, size, className = '', unit }: { score: number; size: number; className?: string; unit?: string }) {
  const number = (
    <Serif size={size} className={`tabular-nums ${BAND_TEXT[scoreBand(score)]} ${unit ? '' : className}`.trim().replace(/\s+/g, ' ')}>
      {score}
    </Serif>
  );
  if (!unit) return number;
  return (
    <span data-ek-score-unit="" className={`inline-flex flex-col items-end gap-1 ${className}`.trim()}>
      {number}
      <span className={`text-[12px] leading-none ${unit}`}>{SCORE_UNIT}</span>
    </span>
  );
}
