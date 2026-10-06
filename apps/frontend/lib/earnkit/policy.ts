import { BONUS_SPLIT_BPS } from './bonus-payout';
import { WEIGHTS } from './traction';

/**
 * The facts the public policy page (/policy, v2.5 §4) states. The ranking weights and payout split
 * are imported from the code that applies them (traction.ts WEIGHTS, bonus-payout.ts
 * BONUS_SPLIT_BPS). The fee split is NOT: tokens.fun applies it (its EarnKit reward recipients,
 * branch earnkit-fee-split), so FEE_SPLIT_BPS here is a copy that must be changed with it.
 */

/** A coin's fee split after Clanker's 20%, bps. A copy of tokens.fun's EarnKit reward recipients. */
export const FEE_SPLIT_BPS = { project: 4000, buyback: 1000, bonus: 2000, earnkit: 3000 } as const;

/** Clanker's own cut of trading fees, before the split. */
export const CLANKER_CUT_PCT = 20;

/** EarnKit's Safe on Base: its fee share and every builder bonus fee after a round ends. */
export const SAFE_ADDRESS = '0xc8A889577446153e28D42254B75238Ae31EC7D57';

export const CONTACT_EMAIL = 'j@earnkit.com';

const pct = (bps: number) => `${bps / 100}%`;

export const FEE_ROWS: [string, string][] = [
  ['Your project', pct(FEE_SPLIT_BPS.project)],
  ['MINI buyback', pct(FEE_SPLIT_BPS.buyback)],
  ['Builder bonus', pct(FEE_SPLIT_BPS.bonus)],
  ['EarnKit', pct(FEE_SPLIT_BPS.earnkit)],
];

/** The traction signals and their weights (traction.ts WEIGHTS). Trading volume is never one. */
export const SIGNAL_ROWS: [string, number][] = [
  ['Real onchain users of your contracts', WEIGHTS.users],
  ['Live product that loads (daily checks)', WEIGHTS.live],
  ['Shipping: commit days and contributors', WEIGHTS.shipping],
  ['New repo interest: stars and forks from real accounts, capped', WEIGHTS.interest],
  ['Token holders, capped', WEIGHTS.holders],
];

/** The round pool's split by place (bonus-payout.ts BONUS_SPLIT_BPS). */
export const PLACE_ROWS: [string, string][] = BONUS_SPLIT_BPS.map((bps, i) => [
  `${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'}`,
  pct(bps),
]);
