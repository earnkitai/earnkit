import { scoreBand } from '../../../lib/earnkit/site-copy';
import Serif from './Serif';

/** S13: one text colour per band everywhere a score is a number. */
const BAND_TEXT = { good: 'text-s-good-text', mid: 'text-s-mid-text', low: 'text-s-low-text' } as const;

/** A Shipping score in Kaftan Serif, coloured by its band. */
export default function ScoreText({ score, size, className = '' }: { score: number; size: number; className?: string }) {
  return (
    <Serif size={size} className={`tabular-nums ${BAND_TEXT[scoreBand(score)]} ${className}`.trim()}>
      {score}
    </Serif>
  );
}
