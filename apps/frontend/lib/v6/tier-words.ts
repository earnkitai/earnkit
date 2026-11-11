/**
 * The words of a placement: `reviewerLine` (one line with the tier and the rows that decided it, for a
 * program's reviewer) and `builderLine` (how the project reads and the one thing that moves it up, for
 * the builder). Pure.
 */
import type { Evidence } from './evidence';
import type { Placement, Tier } from './tiers';

const rules = (p: Placement) => [...new Set(p.flags.map((f) => f.rule.replace(/_/g, ' ')))].join(', ');

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
  building: (p) => (p.gap === 'push' || (p.gap === 'site' && p.because.some((b) => b.includes('the deployer did not fund'))) ? 'Your project has onchain users, with no recent code.' : 'Your project has code, with nothing live yet.'),
  unverified: () => 'Your project is unverified, with nothing recent EarnKit could check.',
  flagged: (p) => `Your project is flagged on the ${rules(p)} rule${new Set(p.flags.map((f) => f.rule)).size > 1 ? 's' : ''}.`,
};

/** "Your project is live, with no verified usage yet. Next: 25 funded wallets on mainnet in 90 days; you have 4." Pure. */
export function builderLine(p: Placement): string {
  if (!p.tier) return 'Your project is not read yet.';
  const head = READS[p.tier](p);
  return p.next ? `${head} Next: ${p.next[0].toLowerCase()}${p.next.slice(1)}` : head;
}
