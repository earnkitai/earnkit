/**
 * Launch ready L5: the ranked reply's one next step is the weekly target (weekly-target.ts weeklyTarget), or
 * "Ship this week to climb." while no Shipping row exists. A statement, never a question.
 */
export const RANKED_STEP =
  /^(Ship this week to climb\.|Ship code this week(: \+\d+ points( to hold #\d+|, enough to pass #\d+|, \d+ behind #\d+)?)?\.|Ship code this week to hold #\d+\.|Done this week(: \+\d+ points)?\.( Next week adds up to \d+ more\.)?)$/;

/** The reply ends on "How to move up" and the ranked step. */
export const endsOnRankedStep = (s: string): boolean => {
  const lines = s.trimEnd().split('\n');
  return lines.at(-2) === 'How to move up' && RANKED_STEP.test(lines.at(-1) ?? '');
};
