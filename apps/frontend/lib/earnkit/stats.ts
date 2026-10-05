import { sql } from './db';
import { FEE_SPLIT_BPS } from './policy';

/**
 * Public stats (v2.5 §4) for jenil.ai: /api/stats, cached 10 min. Database aggregates only: no
 * wallet, repo, installation or entry is ever named.
 */
export const STATS_KEYS = [
  'open_money_usd',
  'programs_open',
  'coins_launched',
  'fees_to_safe_eth',
  'bonus_paid_eth',
  'installs',
] as const;

export type PublicStats = Record<(typeof STATS_KEYS)[number], number>;

/** Wei to ETH as a number, 6 decimals, rounded down. Pure. */
export const weiToEth = (wei: bigint) => Number(wei / 10n ** 12n) / 1e6;

type Row = {
  open_money_usd: string | null;
  programs_open: number;
  coins_launched: number;
  bonus_deposits_wei: string | null;
  bonus_to_safe_wei: string | null;
  bonus_paid_wei: string | null;
  installs: number;
};

/**
 * The public shape from the aggregate row. `fees_to_safe_eth` is the Safe's fees from coins with
 * the v2.5 split only (coins launched before it have no builder bonus slot and count 0), accrued
 * rather than claimed (unclaimed FeeLocker balances included), from the start of the bonus
 * ledger's index: every real FeeLocker deposit for the bonus wallet (its 20% slot) comes with the
 * Safe's own 30% slot from the same fees, so that part is 1.5x the indexed bonus deposits; plus
 * the builder bonus money routed to the Safe (after a program ends, programs without public
 * submissions, empty rounds, a paid round's unclaimed places). It is not all-time Safe revenue.
 * Pure.
 */
export function statsFrom(r: Row): PublicStats {
  const big = (v: string | null) => BigInt(v ?? '0');
  const safeWei = (big(r.bonus_deposits_wei) * BigInt(FEE_SPLIT_BPS.earnkit)) / BigInt(FEE_SPLIT_BPS.bonus) + big(r.bonus_to_safe_wei);
  return {
    open_money_usd: Math.round(Number(r.open_money_usd ?? 0)),
    programs_open: Number(r.programs_open),
    coins_launched: Number(r.coins_launched),
    fees_to_safe_eth: weiToEth(safeWei),
    bonus_paid_eth: weiToEth(big(r.bonus_paid_wei)),
    installs: Number(r.installs),
  };
}

/**
 * One read of every aggregate. Open money: the per-winner prize (`max_award_usd`) of each open
 * program, never whole pools, the same $X rule as list_programs. Open: active, started, not ended.
 * Coins: launches tokens.fun confirmed. Bonus paid: mined builder bonus payouts.
 */
export async function readStats(now = new Date()): Promise<PublicStats> {
  const [r] = await sql()<Row[]>`
    WITH open AS (
      SELECT max_award_usd FROM programs
      WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= ${now}) AND (ends_at IS NULL OR ${now} < ends_at)
    )
    SELECT
      (SELECT sum(max_award_usd) FROM open)::text AS open_money_usd,
      (SELECT count(*) FROM open)::int AS programs_open,
      (SELECT count(*) FROM projects WHERE token_status = 'launched')::int AS coins_launched,
      -- Real FeeLocker deposits only (an onchain tx hash): never a synthetic row such as a paid
      -- round's 'round-rest:<round>' remainder, which is already inside the round's deposits.
      (SELECT sum(amount_wei) FROM bonus_ledger WHERE tx_hash ~ '^0x[0-9a-f]{64}$')::text AS bonus_deposits_wei,
      (SELECT sum(amount_wei) FROM bonus_ledger WHERE destination = 'safe')::text AS bonus_to_safe_wei,
      (SELECT sum(amount_wei) FROM bonus_payouts WHERE status = 'paid')::text AS bonus_paid_wei,
      (SELECT count(*) FROM installations)::int AS installs`;
  return statsFrom(r);
}
