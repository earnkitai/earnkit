/**
 * The words of a placement: `reviewerLine` (one line with the tier and the rows that decided it, for a
 * program's reviewer) and `builderLine` (how the project reads and the one thing that moves it up, for
 * the builder). Pure.
 */
import type { Evidence } from './evidence';
import type { Placement, Tier } from './tiers';

/** #15 (v6.1.15): a rule's words; `unfunded` is the id rows stored before v6.1.15 carry. Any other id reads with `_` as a space. */
export const RULE_WORDS: Record<string, string> = { self_funded_users: 'self-funded users', unfunded: 'self-funded users' };
export const ruleWords = (rule: string) => RULE_WORDS[rule] ?? rule.replace(/_/g, ' ');
/** The distinct words of a placement's flag rules, in order. */
const ruleList = (p: Placement) => [...new Set(p.flags.map((f) => ruleWords(f.rule)))];

/** "used: 1,240 senders the deployer did not fund on Base mainnet, 3 contributors, no flags." Pure. */
export function reviewerLine(p: Placement, e: Evidence | null): string {
  if (!p.tier) return e ? 'no tier: the read failed, worth a retry.' : 'no tier: not read yet.';
  const head = p.tier === 'flagged' ? `flagged (${ruleList(p).join(', ')})` : p.tier;
  return p.because.length ? `${head}: ${p.because.join(', ')}.` : `${head}.`;
}

const READS: Record<Tier, (p: Placement) => string> = {
  // M3 (v6.1.15 fix round 1): no deployer or mainnet in builder words.
  used: () => 'People outside the team use it live.',
  live: (p) => (p.gap === 'funded_senders' ? 'Your project is live, with no verified usage yet.' : 'Your project is live.'),
  // L15-7 (v6.1.14): building on verified onchain users alone (no recent push, or no repo).
  building: (p) => (p.on_users ? 'Your project has people using it live, with no recent code.' : 'Your project has code, with nothing live yet.'),
  unverified: () => 'Your project is unverified, with nothing recent EarnKit could check.',
  flagged: (p) => {
    const words = ruleList(p);
    return `Your project is flagged on the ${words.join(', ')} rule${words.length > 1 ? 's' : ''}.`;
  },
};

/**
 * "Your project is live, with no verified usage yet. Next: about 25 outside users in 90 days; I count 4." Reads the
 * builder's form of the next step (`builder_next`, #6 v6.1.15; placements are never stored, only their lines). Pure.
 */
export function builderLine(p: Placement): string {
  if (!p.tier) return 'Your project is not read yet.';
  const head = READS[p.tier](p);
  const next = p.builder_next;
  return next ? `${head} Next: ${next[0].toLowerCase()}${next.slice(1)}` : head;
}

/**
 * I1/M2 (v6.1.15 fix round 1): the builder lines stored before v6.1.15 (a project's `last_tier.line`), each old wording
 * with today's. A stored line stands up to 24 hours, and with no limit while re-reads fail, so it is reworded on read.
 */
const LEGACY_BUILDER: [RegExp, string][] = [
  [/^Your project is in use: wallets the deployer did not fund use it on mainnet\./, 'People outside the team use it live.'],
  [/^Your project has onchain users, with no recent code\./, 'Your project has people using it live, with no recent code.'],
  [/ Next: ([\d,]+) senders the deployer did not fund, on mainnet in 90 days; you have ([\d,]+)\./, ' Next: about $1 outside users in 90 days; I count $2.'],
  [/ Next: a live product: a site that loads or a mainnet contract in use\./, ' Next: a live product: a site that loads or a contract in use.'],
  [/ Next: at least ([\d.]+%) of sampled wallets not funded by the deployer; ([\d,]+) of ([\d,]+) are\./, ' Next: at least $1 of sampled users from outside the team; I count $2 of $3.'],
  [/^(Your project is flagged on the [^.]*?)\bunfunded\b/, '$1self-funded users'],
];
/** A stored builder line in today's words (unchanged when it is already). Pure. */
export function currentBuilderLine(line: string): string {
  return LEGACY_BUILDER.reduce((l, [from, to]) => l.replace(from, to), line);
}
/** A stored reviewer line in today's words: the old flag rule `unfunded` in its head reads `self-funded users`. Pure. */
export function currentReviewerLine(line: string): string {
  return line.replace(/^flagged \(([^)]*)\)/, (_, list: string) => `flagged (${[...new Set(list.split(', ').map((w) => (w === 'unfunded' ? RULE_WORDS.unfunded : w)))].join(', ')})`);
}
