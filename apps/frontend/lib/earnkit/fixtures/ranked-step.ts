import { SHIP_ASK } from '../bench-reply';

/**
 * Launch ready L5, Task 16: the ranked ship step's points line, its lead the weekly target (weekly-target.ts
 * weeklyTarget) when it says to ship, else "Ship code this week".
 */
export const RANKED_STEP = /^Ship code this week( to (hold|pass|move toward) #[\d,]+)?: up to \+100 points$/;

/** The reply ends on the ship step's question and its points line. */
export const endsOnRankedStep = (s: string): boolean => {
  const lines = s.trimEnd().split('\n');
  return lines.at(-2) === SHIP_ASK && RANKED_STEP.test(lines.at(-1) ?? '');
};
