import { shownRankLine, type Standing } from './rank';

/**
 * The Bench's shared reply text (v2.14: what stayed of v2.12.1's where-you-stand.ts once the flag-off reply
 * went): the news line, its opener and the agent's notes. Plain words. Pure.
 */

/**
 * spec 4: "EarnKit messages only when something real happens": a move up the rank, in the rank line's
 * own words ("You moved up to #2 of 40 builders."). Scoring and clarity: people aren't
 * scored, so new people are no longer news. `ask`: the reply has no other question, so the card is
 * offered (spec 5's moments). Null when nothing happened. Pure.
 */
export function standingNews(
  prev: { rank?: number; at?: string },
  now: { standing: Standing },
  _at: Date,
  ask: boolean,
): { line: string; card: 'rank' | null } | null {
  // v3.1 F3: no news line while the pool is under RANK_MIN_POOL.
  const words = shownRankLine(now.standing);
  if (!words || prev.rank === undefined || !(prev.rank > 0) || now.standing.rank >= prev.rank) return null;
  const line = `You moved up to ${words}.`;
  return { line: ask ? `${line} Want a card to share it?` : line, card: ask ? 'rank' : null };
}

/**
 * The news opener: "Since you last checked: " with the alert items (fragments, joined as v2.11 does)
 * and then the news sentences. Never a period after a link (a sentence ending in one is left as is).
 * Null with nothing to say. Pure.
 */
export function newsOpener(alerts: string[], news: string[]): string | null {
  const parts = [...(alerts.length ? [`${alerts.join('; ')}.`] : []), ...news];
  return parts.length ? `Since you last checked: ${parts.join(' ')}` : null;
}

/**
 * v3.1 cold read (owner-approved, structural): the builder's own question is answered first. If the builder asked
 * something ("What is EarnKit?", "How much can I get?", "How did last week go?"), the agent answers it in one short line
 * from show_to_builder and the reply's facts (reply-facts.ts) only, then shows show_to_builder exactly as written.
 */
export const ANSWER_FIRST_NOTE =
  "If the builder asked a question (their page, wallet, token, backers, what they shipped, what they earned, " +
  "their applications, what EarnKit is or gets paid, privacy, what the token earns or its chain, a Builder Code), first answer it in one short line from show_to_builder and facts only; " +
  "if that answer needs a link, use the one in facts. A fact that isn't there is unknown: say so, never invent amounts, dates or program facts. " +
  "Where they stand is answered from standing and show_to_builder, never points; never say there is no rank or that EarnKit doesn't give one; mention a rank only if rank_lines or facts.rank has one. " +
  "A question about points is answered exactly: EarnKit doesn't use points. It tracks the weeks you ship. " +
  "Then show show_to_builder to the builder exactly as written.";
export const EARN_NOTE = 'If the builder picks a program, prepare it with lead.program_id (call prepare). Programs are named, not asked: the reply has one question, its next step.';
/** The plain answer when a yes or no changes nothing (v2.12.1 make-countable.ts COUNT_LINES.noted). */
export const NOTED_LINE = 'Okay.';
