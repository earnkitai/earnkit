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
 * EarnKit coins' reward splits, bps, as read from a coin's locker; slot order Safe, creator, MINI
 * (then the v2.5 bonus wallet). v2.5 to v2.12: 30/40/10/20. v2.13 (tokens.fun's split change, T14):
 * 50/40/10, the former bonus share to the Safe. A coin's split is fixed at its launch, so both exist
 * and recipients are read by slot from a coin with either one (bonus-ledger.ts feeRecipients); the
 * creator (slot 1) and MINI (slot 2) are the same slots in both. The same numbers as policy.ts
 * FEE_SPLIT_BPS and FEE_SPLIT_BPS_V213 (tests keep them equal).
 */
export const EARNKIT_SPLITS_BPS = [[3000, 4000, 1000, 2000], [5000, 4000, 1000]] as const;
/** v2.9 D16: v2.5's split, kept for the tests and the docs that name it. */
export const EARNKIT_SPLIT_BPS = EARNKIT_SPLITS_BPS[0];

/** Whether `bps` (a coin's split as its locker reads it) is one of EarnKit's splits. Pure. */
export const isEarnkitSplit = (bps: readonly number[]) =>
  EARNKIT_SPLITS_BPS.some((s) => s.length === bps.length && s.every((b, i) => b === bps[i]));

/**
 * v2.12.1 T10 (spec 3b, plan S7): the internal program a coin-only entry belongs to (db/schema.sql
 * seeds it closed). Its entries never show as program entries; coin-moments.ts re-exports it.
 */
export const COIN_PROGRAM = 'earnkit-coin';
