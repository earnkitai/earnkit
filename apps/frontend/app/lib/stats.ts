import type { NetworkStats } from '../components/sections/Stats';

/**
 * ⚠️ EXAMPLE FIGURES from the copy brief, mounted so the layout can be
 * reviewed. They are NOT real product data. Before the site ships, either
 * replace them with values from the real product or set this to `undefined`
 * — Stats renders nothing when no data is passed.
 */
export const NETWORK_STATS: NetworkStats | undefined = {
  agents: 142,
  projects: 36,
  rewardsPaidUsd: 8400,
};
