/**
 * The words of a placement: `reviewerLine` (one line with the tier and the rows that decided it, for a
 * program's reviewer) and `builderLine` (how the project reads and the one thing that moves it up, for
 * the builder). Pure.
 */
import type { Evidence } from './evidence';
import type { Placement, Tier } from './tiers';

/** #15 (v6.1.15): a rule's words; `unfunded` is the id rows stored before v6.1.15 carry. Any other id reads with `_` as a space. */
export const RULE_WORDS: Record<string, string> = { self_funded_users: 'self-funded users', unfunded: 'self-funded users' };
const ruleWords = (rule: string) => RULE_WORDS[rule] ?? rule.replace(/_/g, ' ');
const rules = (p: Placement) => [...new Set(p.flags.map((f) => ruleWords(f.rule)))].join(', ');

/** "used: 1,240 senders the deployer did not fund on Base mainnet, 3 contributors, no flags." Pure. */
export function reviewerLine(p: Placement, e: Evidence | null): string {
  if (!p.tier) return e ? 'no tier: the read failed, worth a retry.' : 'no tier: not read yet.';
  const head = p.tier === 'flagged' ? `flagged (${rules(p)})` : p.tier;
  return p.because.length ? `${head}: ${p.because.join(', ')}.` : `${head}.`;
}

const READS: Record<Tier, (p: Placement) => string> = {
  used: () => 'Your project is in use: wallets the deployer did not fund use it on mainnet.',
  live: (p) => (p.gap === 'funded_senders' ? 'Your project is live, with no verified usage yet.' : 'Your project is live.'),
  // L15-7 (v6.1.14): building on verified onchain users alone (no recent push, or no repo).
  building: (p) => (p.on_users ? 'Your project has onchain users, with no recent code.' : 'Your project has code, with nothing live yet.'),
  unverified: () => 'Your project is unverified, with nothing recent EarnKit could check.',
  flagged: (p) => `Your project is flagged on the ${rules(p)} rule${new Set(p.flags.map((f) => ruleWords(f.rule))).size > 1 ? 's' : ''}.`,
};

/**
 * "Your project is live, with no verified usage yet. Next: about 25 outside users in 90 days; I count 4." Reads the
 * builder's form of the next step (`builder_next`, #6 v6.1.15), falling back to `next` for a placement stored before. Pure.
 */
export function builderLine(p: Placement): string {
  if (!p.tier) return 'Your project is not read yet.';
  const head = READS[p.tier](p);
  const next = p.builder_next ?? p.next;
  return next ? `${head} Next: ${next[0].toLowerCase()}${next.slice(1)}` : head;
}
