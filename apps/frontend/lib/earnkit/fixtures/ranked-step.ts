import { SHIP_ASK } from '../bench-reply';

/**
 * Launch ready L5, Task 16: the ranked ship step's points line, its lead the weekly target (weekly-target.ts
 * weeklyTarget) when it says to ship, else "Ship code this week".
 */
export const RANKED_STEP = /^Ship code this week( to (hold|pass|move toward) #[\d,]+)?: up to \+100 points$/;

/** 2026-10-22: with no fit and Base Builder Grants open, the ranked step is its steps question (bench-reply.ts qualifyAsk). */
export const QUALIFY_ASK = /^Want the (?:\d+ steps to qualify for|\d+ steps toward|next step toward) Base's \$5,000 grant\?$/;

/** The reply ends on the ranked step's question (the ship step, or Base's grant steps with no fit) and its points line. */
export const endsOnRankedStep = (s: string): boolean => {
  const lines = s.trimEnd().split('\n');
  return (lines.at(-2) === SHIP_ASK || QUALIFY_ASK.test(lines.at(-2) ?? '')) && RANKED_STEP.test(lines.at(-1) ?? '');
};
