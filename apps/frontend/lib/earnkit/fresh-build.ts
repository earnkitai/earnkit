import { CHAIN_NAMES } from './chains';
import { prizeOf } from './entry-text';
import { NEEDS_LIVE_PRODUCT } from './guide';
import { STARTER_TEST_MAX_AGE_DAYS } from './program-file';
import { moneyText, openCurated, openMoneyUsd } from './pool';
import { STARTERS, type Starter, type StarterChain } from './starters';
import type { Card } from './present';

/**
 * v2.11 spec 1: the no-repo lead. When nothing else leads the short first reply (no good-odds row,
 * no entry waiting on the builder's submission, no users question), it is one context line ("$1.1M+
 * in prizes is open right now across 7 programs.") and one small program to build from a tested
 * starter. Pure.
 *
 * Fail closed: no pick unless the program names a starter (owner-set `fresh_build`), the starter's
 * test has passed (`tested_at`), EarnKit can deploy to the starter's chain and hosting is on. Without
 * a pick the reply is the v2.10 line, byte for byte.
 */

export type FreshPick = { card: Card; starter: Starter };

export type FreshPickOpts = {
  /** Programs the builder is not interested in, or applied to outside EarnKit (v2.9 A3). */
  hidden: Set<string>;
  /** Programs the builder already has an entry in. */
  entered: Set<string>;
  /** EarnKit deploys to this chain right now (deploy.ts deployEnabled plus the chain's RPC). */
  deployOn: (c: StarterChain) => boolean;
  /** EarnKit hosting is on (r2.ts r2Enabled). Off means no pick until T9's GitHub Pages fallback. */
  hostOn: boolean;
  /** The starter registry; starters.ts STARTERS unless a test passes its own. */
  starters?: Record<string, Starter>;
};

/** The pick rules (spec 1): the largest prize per winner, and the close window. */
export const FRESH_MAX_USD = 5000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_LEFT_MS = 24 * HOUR_MS;
const MAX_LEFT_MS = 14 * DAY_MS;
const LEVELS = ['Easy', 'Medium'] as const;

/**
 * The card's registered starter whose test passed within the last 30 days, or undefined (never a
 * prototype key such as "toString"). Review M6: programs:check holds the same 30 days against
 * verified_at at sync time; this holds it against now, so a stale test stops the offer at once.
 */
function starterOf(c: Card, starters: Record<string, Starter>, now: Date): Starter | undefined {
  const id = c.fresh_build?.starter;
  if (!id || !Object.hasOwn(starters, id)) return undefined;
  const s = starters[id];
  if (!s.tested_at) return undefined;
  const days = Math.floor((now.getTime() - new Date(`${s.tested_at}T00:00:00Z`).getTime()) / DAY_MS);
  return days <= STARTER_TEST_MAX_AGE_DAYS ? s : undefined;
}

/**
 * v2.11 spec 1: the one program a builder with no fitting repo can build for now, with its starter,
 * or undefined. A program qualifies when it is open and curated (never sponsored, an EarnKit
 * campaign or an investment, never tagged "long shot" or "needs a live product", never hidden or
 * entered); it names a tested starter on one of its chains that EarnKit can deploy to, with hosting
 * on; it is Easy or Medium; its prize per winner is known and $5,000 or less; and it closes 24 hours
 * to 14 days from now. A rolling program qualifies only when no dated one does. Rank: Easy first,
 * more winners per round (unknown counts as 1), the sooner close, the higher prize. Pure.
 */
export function freshPick(cards: Card[], now: Date, opts: FreshPickOpts): FreshPick | undefined {
  if (!opts.hostOn) return undefined;
  const starters = opts.starters ?? STARTERS;
  const fits: (FreshPick & { dated: boolean })[] = [];
  for (const card of cards) {
    if (card.sponsored || card.earnkit_campaign || card.investment) continue;
    if (card.tag === 'long shot' || card.tag === NEEDS_LIVE_PRODUCT) continue;
    if (opts.hidden.has(card.id) || opts.entered.has(card.id)) continue;
    if (!openCurated(card, now)) continue;
    const level = card.difficulty?.level;
    if (!level || !(LEVELS as readonly string[]).includes(level)) continue;
    if (card.max_award_usd == null || card.max_award_usd > FRESH_MAX_USD) continue;
    const starter = starterOf(card, starters, now);
    if (!starter || !card.chains?.includes(starter.chain) || !opts.deployOn(starter.chain)) continue;
    if (card.ends_at) {
      const left = card.ends_at.getTime() - now.getTime();
      if (left < MIN_LEFT_MS || left > MAX_LEFT_MS) continue;
    }
    fits.push({ card, starter, dated: Boolean(card.ends_at) });
  }
  const dated = fits.filter((f) => f.dated);
  const pool = dated.length > 0 ? dated : fits;
  const winners = (c: Card) => c.winners_per_round ?? 1;
  const [best] = pool.sort(
    (a, b) =>
      Number(a.card.difficulty?.level !== 'Easy') - Number(b.card.difficulty?.level !== 'Easy') ||
      winners(b.card) - winners(a.card) ||
      (a.card.ends_at?.getTime() ?? 0) - (b.card.ends_at?.getTime() ?? 0) ||
      (b.card.max_award_usd ?? 0) - (a.card.max_award_usd ?? 0) ||
      a.card.id.localeCompare(b.card.id),
  );
  return best ? { card: best.card, starter: best.starter } : undefined;
}

/**
 * v2.11 spec 1, Ruling S1: "$1.1M+ in prizes is open right now across 7 programs.", the site's money
 * figure (moneyText(openMoneyUsd)) and the count of the programs it sums, singular at 1. Null when
 * nothing is open. Pure.
 */
export function contextLine(cards: Card[], now: Date): string | null {
  const fig = moneyText(openMoneyUsd(cards, now));
  const n = cards.filter((c) => openCurated(c, now)).length;
  if (!fig || n === 0) return null;
  return `${fig} in prizes is open right now across ${n} program${n === 1 ? '' : 's'}.`;
}

/**
 * v2.11 spec 1, Ruling S2: the lead, one question.
 * - Builds: "Arc Microgrants pays 500 USDC and closes in 4 days. A USDC tip page on Arc takes about
 *   an hour. Want me to build it?"
 * - Chat-only: "... A coding agent builds the USDC tip page in about an hour. Want
 *   the plan?" (the starter's "what" as "the ...", its "on <chain>" dropped: the program already
 *   says where).
 * The prize is prizeOf cut at " × "; "closes in N days" counts whole days to `ends_at`, N = 1 reads
 * "closes tomorrow"; a rolling program reads "with no deadline". Every starter's bar is an hour
 * (`minutes: 60`). The "what" is the starter's, never the program's. Pure.
 */
export function freshLeadLine(p: FreshPick, now: Date, canBuild: boolean): string {
  const prize = prizeOf(p.card).split(' × ')[0];
  const days = p.card.ends_at ? Math.floor((p.card.ends_at.getTime() - now.getTime()) / DAY_MS) : null;
  const when = days === null ? 'with no deadline' : days === 1 ? 'and closes tomorrow' : `and closes in ${days} days`;
  const what = p.starter.what;
  const build = canBuild
    ? `${what.charAt(0).toUpperCase()}${what.slice(1)} takes about an hour. Want me to build it?`
    : `A coding agent builds ${theWhat(p.starter)} in about an hour. Want the plan?`;
  return `${p.card.title} pays ${prize} ${when}. ${build}`;
}

/** "a USDC tip page on Arc" as "the USDC tip page". */
const theWhat = (s: Starter) =>
  s.what.replace(/^an? /, 'the ').replace(new RegExp(` on ${CHAIN_NAMES[s.chain]}$`), '');
