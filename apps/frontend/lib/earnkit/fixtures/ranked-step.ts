import { SHIP_ASK } from '../bench-reply';

/** The ranked ship step's plain line (v4.2: no points), its lead the weekly target when it says to ship, else "Ship code this week". */
export const RANKED_STEP = /^Ship code this week( to (hold|pass|move toward) #[\d,]+)?\.$/;

/** 2026-10-22: with no fit and Base Builder Grants open, the ranked step is its steps question (bench-reply.ts qualifyAsk). */
export const QUALIFY_ASK = /^Want the (?:\d+ steps to qualify for|\d+ steps toward|next step toward) Base's \$5,000 grant\?$/;

/** GTM W2: the ship question is asked at most once in 7 days; between, the quiet ranked reply ends on the plain line with no question. */
export const endsOnQuietStep = (s: string): boolean => {
  const lines = s.trimEnd().split('\n');
  return !s.includes('?') && RANKED_STEP.test(lines.at(-1) ?? '');
};
/** v4.2 Task 10: the reply ends on the ranked step: its plain line, then its question last (the ship step, or Base's grant steps with no fit). */
export const endsOnRankedStep = (s: string): boolean => {
  const lines = s.trimEnd().split('\n');
  return (lines.at(-1) === SHIP_ASK || QUALIFY_ASK.test(lines.at(-1) ?? '')) && RANKED_STEP.test(lines.at(-2) ?? '');
};
