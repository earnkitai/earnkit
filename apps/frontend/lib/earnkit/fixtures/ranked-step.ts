import { SHIP_ASK } from '../bench-reply';

/** The ranked ship step's plain line (v4.2: no points), its lead the weekly target when it says to ship, else "Ship code this week". */
export const RANKED_STEP = /^Ship code this week( to (hold|pass|move toward) #[\d,]+)?\.$/;

/**
 * 2026-10-22: with no fit and Base Builder Grants open, the ranked step is its question (bench-reply.ts qualifyAsk; v4.3:
 * by the first step left: Builder Codes, Base, else the next step toward the grant).
 */
export const QUALIFY_ASK = /^(?:Want me to add Builder Codes to .+|Want help putting .+ on Base|Want the (?:\d+ steps to qualify for|\d+ steps toward|next step toward) Base's \$5,000 grant)\?$/;
/** v4.3 (owner-approved): the qualify reply's head paragraph, the grant and its amount first. */
export const QUALIFY_HEAD = /^Base Builder Grants: \$5,000, rolling\. /;

/** GTM W2: the ship question is asked at most once in 7 days; between, the quiet ranked reply ends on the plain line with no question. */
export const endsOnQuietStep = (s: string): boolean => {
  const lines = s.trimEnd().split('\n');
  return !s.includes('?') && RANKED_STEP.test(lines.at(-1) ?? '');
};
/** v4.2 Task 10: the reply ends on the ranked step: the ship step's plain line then its question, or (v4.3) Base's grant reply with no fit. */
export const endsOnRankedStep = (s: string): boolean => {
  const lines = s.trimEnd().split('\n');
  // v4.3: the qualify reply carries no ship line: its question is its own paragraph, after the head (and Also open).
  if (QUALIFY_ASK.test(lines.at(-1) ?? '')) return lines.at(-2) === '' && lines.some((l) => QUALIFY_HEAD.test(l));
  return lines.at(-1) === SHIP_ASK && RANKED_STEP.test(lines.at(-2) ?? '');
};
