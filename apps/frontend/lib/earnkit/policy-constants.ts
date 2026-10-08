/** Policy facts that bonus-ledger.ts reads; re-exported by policy.ts. No imports (a leaf: no import cycle). */

/**
 * v2.9 D16, Ruling 17: the MINI buyback recipient (slot 2 of every EarnKit token's split; tokens.fun's
 * buyback wallet). Used only when a token's locker read fails. Confirmed read-only on 2026-10-09:
 * `tokenRewards(0xdf63F96b7705c3F42cd5FCa41739DBCDf20162a3)` on Base locker
 * 0xffa37784d619f228d8b379d287a4d7282e500762 (bps [3000, 4000, 1000, 2000], slot 0 the Safe) has this
 * address at slot 2.
 */
export const MINI_FEE_RECIPIENT = '0x6DCeEAFA8b06977e5bD2F2D9B0cF949f640f47D1';

/** v2.9 D17: the payout wallet is low on gas below this ETH balance (wei; 0.002 ETH). GAS_WALLET_MIN_WEI overrides it. */
export const GAS_WALLET_MIN_WEI_DEFAULT = 2_000_000_000_000_000n;

/**
 * v2.9 D16: an EarnKit token's split by slot, bps (Safe, creator, MINI, bonus wallet), as read from
 * its locker. Recipients are read by slot only from a token with this split. The same numbers as
 * policy.ts FEE_SPLIT_BPS (a test keeps them equal).
 */
export const EARNKIT_SPLIT_BPS = [3000, 4000, 1000, 2000] as const;
