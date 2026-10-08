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
