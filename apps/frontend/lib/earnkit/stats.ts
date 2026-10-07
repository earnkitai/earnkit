import { sql, type Db } from './db';
import { testInstallationIds } from './installations';
import { FEE_SPLIT_BPS } from './policy';
import { poolTotal, statedPool } from './pool';

/**
 * Public stats (v2.5 §4) for jenil.ai: /api/stats, cached 10 min. Database aggregates only: no
 * wallet, repo, installation or entry is ever named. v2.6 Ruling 6/16 (plan): owner test
 * installations (EARNKIT_TEST_INSTALLATIONS) are excluded from `installs`, `coins_launched` and
 * the bonus deposits behind `fees_to_safe_eth`.
 */
export const STATS_KEYS = [
  'open_money_usd',
  'open_pools_usd',
  'open_pools_plus',
  'programs_open',
  'bonus_programs_open',
  'coins_launched',
  'fees_to_safe_eth',
  'bonus_paid_eth',
  'bonus_pools_eth',
  'installs',
  'labelled_entries',
  'entries_won',
] as const;

/**
 * v2.8 Part G, Ruling 30 (plan): the public win-rate claim ("X% of EarnKit entries win") is withheld
 * until at least this many entries have a published result, and a baseline exists. Documentation
 * only: no code path makes the claim. `labelled_entries` and `entries_won` are the raw counts.
 */
export const WIN_RATE_MIN_LABELLED = 30;

/** Every stat but `open_pools_plus` is a number. */
export type StatsNumberKey = Exclude<(typeof STATS_KEYS)[number], 'open_pools_plus'>;
/**
 * v2.7.1: `open_pools_usd` is the pool total behind the landing page's "$1.3M+ open right now"
 * (the open curated programs' source-stated pools, pool.ts poolTotal) and `open_pools_plus` its "+"
 * (some open program has no pool, or its source says "+"). `open_money_usd` is unchanged (the
 * per-winner sum jenil.ai reads).
 */
export type PublicStats = Record<StatsNumberKey, number> & { open_pools_plus: boolean };

/**
 * How jenil.ai should label each stat (T9 note): `fees_to_safe_eth` counts only coins launched
 * with the v2.5 split, from the start of the bonus index, so it is never "all Safe revenue".
 */
export const STATS_LABELS: Record<(typeof STATS_KEYS)[number], string> = {
  open_money_usd: 'open money matched (USD)',
  open_pools_usd: 'open prize pools (USD)',
  open_pools_plus: 'some open programs publish no pool',
  programs_open: 'programs open',
  bonus_programs_open: 'programs with a builder bonus',
  coins_launched: 'tokens launched',
  fees_to_safe_eth: 'fees to the Safe (v2.5 tokens)',
  bonus_paid_eth: 'builder bonus paid (ETH)',
  bonus_pools_eth: 'builder bonus pools open (ETH)',
  installs: 'installs',
  labelled_entries: 'entries with a published result',
  entries_won: 'entries that won',
};

/** Wei to ETH as a number, 6 decimals, rounded down. Pure. */
export const weiToEth = (wei: bigint) => Number(wei / 10n ** 12n) / 1e6;

type Row = {
  open_money_usd: string | null;
  /** v2.7.1: each open curated program's pool_usd and reward (json, so pool_usd is a number). */
  pool_rows: { pool_usd: string | number | null; reward: string }[] | null;
  programs_open: number;
  bonus_programs_open: number;
  coins_launched: number;
  bonus_deposits_wei: string | null;
  bonus_to_safe_wei: string | null;
  bonus_paid_wei: string | null;
  bonus_pools_wei: string | null;
  installs: number;
  labelled_entries: number;
  entries_won: number;
};

/**
 * The public shape from the aggregate row. `fees_to_safe_eth` is the Safe's fees from coins with
 * the v2.5 split only (coins launched before it have no builder bonus slot and count 0), accrued
 * rather than claimed (unclaimed FeeLocker balances included), from the start of the bonus
 * ledger's index: every real FeeLocker deposit for the bonus wallet (its 20% slot) comes with the
 * Safe's own 30% slot from the same fees, so that part is 1.5x the indexed bonus deposits of
 * EarnKit coins (M5: never a deposit from a coin EarnKit didn't launch); plus
 * the builder bonus money routed to the Safe (after a program ends, programs without public
 * submissions, empty rounds, a paid round's unclaimed places). It is not all-time Safe revenue.
 * Pure.
 */
export function statsFrom(r: Row): PublicStats {
  const big = (v: string | null) => BigInt(v ?? '0');
  const safeWei = (big(r.bonus_deposits_wei) * BigInt(FEE_SPLIT_BPS.earnkit)) / BigInt(FEE_SPLIT_BPS.bonus) + big(r.bonus_to_safe_wei);
  const pools = poolTotal((r.pool_rows ?? []).map((p) => statedPool(p.pool_usd, p.reward)));
  return {
    open_money_usd: Math.round(Number(r.open_money_usd ?? 0)),
    open_pools_usd: Math.round(pools.usd),
    open_pools_plus: pools.plus,
    programs_open: Number(r.programs_open),
    bonus_programs_open: Number(r.bonus_programs_open),
    coins_launched: Number(r.coins_launched),
    fees_to_safe_eth: weiToEth(safeWei),
    bonus_paid_eth: weiToEth(big(r.bonus_paid_wei)),
    bonus_pools_eth: weiToEth(big(r.bonus_pools_wei)),
    installs: Number(r.installs),
    labelled_entries: Number(r.labelled_entries),
    entries_won: Number(r.entries_won),
  };
}

/**
 * One read of every aggregate. Open money: the per-winner prize (`max_award_usd`) of each open
 * program, never whole pools, the same $X rule as list_programs. Open: active, started, not ended.
 * `bonus_programs_open` (Ruling 16 (plan)): of those, the ones with the builder bonus on
 * (bonusOn's SQL twin: `builder_bonus AND campaign IS NULL`, status already 'active' here).
 * Coins: launches tokens.fun confirmed. Bonus paid: mined builder bonus payouts. Bonus pools (v2.7
 * Ruling 20 (plan)): every open round's bookings (`destination = 'round'`); a frozen round's don't count. v2.6 Ruling 6/16
 * (plan): an owner test installation (EARNKIT_TEST_INSTALLATIONS) counts in none of `installs`,
 * `coins_launched`, `bonus_pools_eth` (final review M7), the bonus deposits behind `fees_to_safe_eth`,
 * `labelled_entries` or `entries_won` (v2.8 Ruling 30 (plan)): its coin and fees are real,
 * but it never shows in public stats. `db` defaults to the pool; a test that needs two reads to
 * agree despite other test files writing in parallel passes one transaction (fix round 1,
 * finding 2), the way `alertFacts` takes one.
 */
export async function readStats(now = new Date(), db: Db = sql()): Promise<PublicStats> {
  const ids = testInstallationIds();
  const [r] = await db<Row[]>`
    WITH open AS (
      SELECT max_award_usd, builder_bonus, campaign FROM programs
      WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= ${now}) AND (ends_at IS NULL OR ${now} < ends_at)
    )
    SELECT
      (SELECT sum(max_award_usd) FROM open)::text AS open_money_usd,
      -- v2.7.1: the landing page's programs (listPrograms' open rule, curated only: no campaign).
      (SELECT json_agg(json_build_object('pool_usd', pool_usd, 'reward', reward)) FROM programs
        WHERE status = 'active' AND campaign IS NULL AND (ends_at IS NULL OR ${now} < ends_at)) AS pool_rows,
      (SELECT count(*) FROM open)::int AS programs_open,
      (SELECT count(*) FROM open WHERE builder_bonus AND campaign IS NULL)::int AS bonus_programs_open,
      (SELECT count(*) FROM projects
        WHERE token_status = 'launched' AND NOT COALESCE(installation_id = ANY(${ids}::int[]), false))::int AS coins_launched,
      -- Real FeeLocker deposits only (an onchain tx hash): never a synthetic row such as a paid
      -- round's 'round-rest:<round>' remainder, which is already inside the round's deposits.
      -- M5: and only from EarnKit coins (launched with the v2.5 split, so their Safe slot is 1.5x
      -- the bonus slot); a deposit from another or unknown coin has no known Safe share.
      (SELECT sum(amount_wei) FROM bonus_ledger
        WHERE tx_hash ~ '^0x[0-9a-f]{64}$'
          AND coin IN (SELECT coin_address FROM projects
            WHERE coin_address IS NOT NULL AND NOT COALESCE(installation_id = ANY(${ids}::int[]), false)))::text AS bonus_deposits_wei,
      -- Final review M2: never a test installation's coin (synthetic round-rest rows have no coin).
      (SELECT sum(amount_wei) FROM bonus_ledger WHERE destination = 'safe'
        AND NOT (coin IS NOT NULL AND coin IN (SELECT coin_address FROM projects
          WHERE coin_address IS NOT NULL AND installation_id = ANY(${ids}::int[]))))::text AS bonus_to_safe_wei,
      (SELECT sum(amount_wei) FROM bonus_payouts WHERE status = 'paid')::text AS bonus_paid_wei,
      -- Final review M7: never a test installation's coin, as bonus_to_safe_wei.
      (SELECT sum(l.amount_wei) FROM bonus_ledger l
        WHERE l.destination = 'round'
          AND l.round_key IN (SELECT round_key FROM bonus_rounds WHERE state = 'open')
          AND NOT (l.coin IS NOT NULL AND l.coin IN (SELECT coin_address FROM projects
            WHERE coin_address IS NOT NULL AND installation_id = ANY(${ids}::int[]))))::text AS bonus_pools_wei,
      (SELECT count(*) FROM installations WHERE NOT (id = ANY(${ids}::int[])))::int AS installs,
      -- v2.8 Part G, Ruling 30 (plan): announcement-sourced outcomes only (a self-report never
      -- counts), never a test installation's entry. Labelled: distinct entries with an announced
      -- result. Won: distinct entries announced as won or placed.
      (SELECT count(DISTINCT eo.project_id) FROM entry_outcomes eo JOIN projects p ON p.id = eo.project_id
        WHERE eo.basis = 'announcement'
          AND NOT COALESCE(p.installation_id = ANY(${ids}::int[]), false))::int AS labelled_entries,
      (SELECT count(DISTINCT eo.project_id) FROM entry_outcomes eo JOIN projects p ON p.id = eo.project_id
        WHERE eo.basis = 'announcement' AND eo.result IN ('won', 'placed')
          AND NOT COALESCE(p.installation_id = ANY(${ids}::int[]), false))::int AS entries_won`;
  return statsFrom(r);
}
