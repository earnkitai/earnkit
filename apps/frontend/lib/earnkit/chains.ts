/**
 * The chains EarnKit matches and their display names (match.ts re-exports them). Import-free, so
 * pure modules (placeholder.ts) can name a chain without loading match.ts's imports.
 */
export const CHAINS = ['base', 'arc', 'tempo', 'monad', 'robinhood', 'avalanche'] as const;
export type Chain = (typeof CHAINS)[number];

export const CHAIN_NAMES: Record<Chain, string> = {
  base: 'Base',
  arc: 'Arc',
  tempo: 'Tempo',
  monad: 'Monad',
  robinhood: 'Robinhood Chain',
  avalanche: 'Avalanche',
};

/**
 * v3.1 cold read: a chain named and explained once in a reply ("Arc, Circle's chain"); a chain everyone knows by its
 * own name is just named. Only well-known facts (who runs each chain).
 */
export const CHAIN_EXPLAINED: Record<Chain, string> = {
  base: "Base, Coinbase's chain",
  arc: "Arc, Circle's chain",
  tempo: "Tempo, Stripe's chain",
  monad: 'Monad',
  robinhood: 'Robinhood Chain',
  avalanche: 'Avalanche',
};
