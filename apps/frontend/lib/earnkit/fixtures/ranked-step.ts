import { SHIP_ASK } from '../bench-reply';

/** 2026-10-22: with no fit and Base Builder Grants open, the ranked step is its steps question (bench-reply.ts qualifyAsk). */
export const QUALIFY_ASK = /^Want the (?:\d+ steps to qualify for|\d+ steps toward|next step toward) Base's \$5,000 grant\?$/;

/** The reply ends on the ranked step's question: the ship step, or Base's grant steps with no fit (v4.2: no points line). */
export const endsOnRankedStep = (s: string): boolean => {
  const last = s.trimEnd().split('\n').at(-1) ?? '';
  return last === SHIP_ASK || QUALIFY_ASK.test(last);
};
