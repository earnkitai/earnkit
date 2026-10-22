import { toEventSelector, type Hex } from 'viem';
import { sql } from './db';
import { creatorWalletSql } from './fees';
import {
  BASE_BONUS,
  CONFIRMATIONS,
  ERC20_TRANSFER,
  FIRST_LOOKBACK,
  bonusRpc,
  scanForward,
  type BonusChain,
  type BonusRpc,
} from './bonus-ledger';
import { pillCoin } from './raising';
import { SHARED_BASE_CONTRACTS, tradeVenue } from './shared-contracts';
import { CLANKER_ADDRESSES } from './traction';

/**
 * v3 Stage 2 (spec 5.3 Route 2): backers, the distinct wallets that received a project's coin (unique buyer wallets),
 * indexed from Base the way bonus-ledger.ts indexes the Safe: per coin, from a stored block cursor (start: the launch
 * block, from the `coin_tx` receipt), in ranges of at most INDEX_CHUNK blocks, within INDEXER_MS a run, oldest cursor
 * first; one coin's failure never stops the rest. A backer received the coin from the pool side (the Transfer's `from`
 * is a trade venue: the PoolManager, a router or aggregator, or the coin's hook) and is no contract in BACKER_EXCLUDED
 * and not the coin's creator wallet; a transfer between two wallets, an airdrop or a dev buy never adds one. Backers never touch Shipping or rank; they show only while EARNKIT_RAISING is on (bench-data, stats).
 */

/** Each indexer's time slice per run (the cron's runBonusLedger), ms. */
export const INDEXER_MS = 25_000;
/** Blocks per getLogs call, at most (escrow.ts LOG_CHUNK; scanForward shrinks it when the RPC refuses). */
export const INDEX_CHUNK = 2_000n;
/** getLogs calls per coin per run, so one coin far behind never takes the whole slice. */
export const CALLS_PER_COIN = 50;
/** Base: one block every 2 s. Without a launch receipt, the start is estimated from coin_launched_at, this many blocks early (an hour). */
const START_MARGIN = 1_800n;
/** Distinct recipients one range may add; past it the range is read again smaller. */
export const RECIPIENTS_PER_RANGE = 5_000;
/** Rows per coin_backers insert statement. */
export const INSERT_BATCH = 1_000;

/**
 * Never a backer (lowercase): every shared Base contract (shared-contracts.ts SHARED_BASE_CONTRACTS: Uniswap pools,
 * routers and Permit2, aggregators, WETH and USDC) and every Clanker v4 contract (traction.ts CLANKER_ADDRESSES: the
 * factory, lockers, vault, airdrop, dev buy, MEV modules, hooks, presales, the FeeLocker), plus the zero address and,
 * per coin, the Safe, the LP lockers, the FeeLocker, the coin itself, its pool hook and its creator wallet.
 */
export const BACKER_EXCLUDED: ReadonlySet<string> = new Set([
  '0x0000000000000000000000000000000000000000',
  ...SHARED_BASE_CONTRACTS,
  ...CLANKER_ADDRESSES,
].map((a) => a.toLowerCase()));
/** The PoolManager (a buy's coin leaves the pool through it). */
export const POOL_MANAGER = '0x498581ff718922c3f8e6a244956af099b2652b2b';

export type IndexOpts = {
  /** Epoch ms: no new read starts after it (default: INDEXER_MS from now). */
  deadline?: number;
  rpc?: BonusRpc;
  chain?: BonusChain;
  /** Only these coins (lowercase addresses); tests. */
  only?: string[];
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

const TRANSFER_TOPIC = toEventSelector(ERC20_TRANSFER);
export const lower = (s: string) => s.toLowerCase();
export const topicAddress = (t: string | undefined) => (t ? `0x${t.slice(-40)}`.toLowerCase() : '');
const errName = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message.slice(0, 120)}` : 'error');
/** The `only` filter as a SQL array (null: every coin). */
export const onlyCoins = (only?: string[]) => (only ? only.map(lower) : null);

/**
 * The first block to read for a coin with no cursor: its launch transaction's block (the `coin_tx` receipt), else
 * (no or unreadable tx) estimated from `coin_launched_at` at 2 s a block, START_MARGIN early, else FIRST_LOOKBACK back.
 */
export async function launchBlock(row: { coin_tx: string | null; launched_at: Date | null }, head: bigint, rpc: BonusRpc, now: Date): Promise<bigint> {
  if (row.coin_tx && /^0x[0-9a-fA-F]{64}$/.test(row.coin_tx)) {
    const at = await rpc.receiptLogs(row.coin_tx as Hex).then((r) => r.blockNumber, () => null);
    if (at !== null) return at;
  }
  const back = row.launched_at ? BigInt(Math.max(0, Math.ceil((now.getTime() - row.launched_at.getTime()) / 2000))) + START_MARGIN : FIRST_LOOKBACK;
  return head > back ? head - back : 0n;
}

/**
 * Indexes every launched Base coin's backers (projects.coin_address, token_status 'launched') from its cursor in
 * coin_backer_cursor up to CONFIRMATIONS behind the head: each Transfer's `to`, unless excluded, is a backer (first
 * block kept). A range is stored completely before the cursor passes it; inserts are idempotent. Bounded by
 * `deadline`, CALLS_PER_COIN and INDEX_CHUNK; coins whose cursor moved longest ago go first. Without a Transfer
 * reader: skipped.
 */
export async function indexBackers(now: Date, o: IndexOpts = {}) {
  const rpc = o.rpc ?? bonusRpc();
  const read = rpc.transferLogs;
  if (!read) return { skipped: 'no reader' as const };
  const chain = o.chain ?? BASE_BONUS;
  const deadline = o.deadline ?? Date.now() + INDEXER_MS;
  const log = o.log ?? console.error;
  if (Date.now() >= deadline) return { coins: 0, added: 0, failed: 0, outOfTime: true as const };
  const db = sql();
  const rows = await db<{ coin: Hex; coin_tx: string | null; launched_at: Date | null; block: string | null; creator: string | null }[]>`
    SELECT lower(p.coin_address) AS coin, p.coin_tx, p.coin_launched_at AS launched_at, c.block::text AS block, ${creatorWalletSql(db)} AS creator
    FROM projects p LEFT JOIN coin_backer_cursor c ON c.coin = lower(p.coin_address)
    WHERE p.coin_address IS NOT NULL AND p.token_status = 'launched' AND COALESCE(p.coin_chain_id, 8453) = 8453
      AND (${onlyCoins(o.only)}::text[] IS NULL OR lower(p.coin_address) = ANY(${onlyCoins(o.only)}::text[]))
    ORDER BY c.updated_at ASC NULLS FIRST, p.id`;
  if (rows.length === 0) return { coins: 0, added: 0, failed: 0 };
  const head = (await rpc.blockNumber()) - CONFIRMATIONS;
  const fixed = [...BACKER_EXCLUDED, chain.feeLocker, chain.safe, ...chain.lockers].map(lower);
  let coins = 0;
  let added = 0;
  let failed = 0;
  for (const r of rows) {
    if (Date.now() >= deadline) return { coins, added, failed, outOfTime: true as const };
    try {
      const from = r.block != null ? BigInt(r.block) + 1n : await launchBlock(r, head, rpc, now);
      if (from > head) continue;
      const hook = rpc.poolHooks ? await rpc.poolHooks(r.coin) : null;
      const skip = new Set([...fixed, r.coin, ...(hook ? [lower(hook)] : []), ...(r.creator ? [r.creator] : [])]);
      // The pool side: a buy's coin comes out of the PoolManager, a router or aggregator, or the coin's own hook.
      const venue = (a: string) => tradeVenue(a) || a === POOL_MANAGER || (hook !== null && a === lower(hook));
      const scan = await scanForward({
        from,
        to: head,
        chunk: INDEX_CHUNK,
        maxCalls: CALLS_PER_COIN,
        deadline,
        sleep: o.sleep,
        onRange: async (lo, hi) => {
          const first = new Map<string, bigint>();
          for (const l of await read(r.coin, lo, hi)) {
            if (lower(l.address) !== r.coin || lower(l.topics[0] ?? '') !== TRANSFER_TOPIC) continue;
            if (!venue(topicAddress(l.topics[1]))) continue;
            const to = topicAddress(l.topics[2]);
            if (!/^0x[0-9a-f]{40}$/.test(to) || skip.has(to)) continue;
            const seen = first.get(to);
            if (seen === undefined || l.blockNumber < seen) first.set(to, l.blockNumber);
            // Too many for one range: read it again smaller (scanForward halves a range on this wording).
            if (first.size > RECIPIENTS_PER_RANGE) throw new Error(`too many results in this range: over ${RECIPIENTS_PER_RANGE} recipients`);
          }
          const values = [...first].map(([wallet, block]) => ({ coin: r.coin, wallet, first_block: block.toString(), first_seen_at: now }));
          try {
            let inRange = 0;
            await sql().begin(async (tx) => {
              for (let i = 0; i < values.length; i += INSERT_BATCH)
                inRange += (await tx`INSERT INTO coin_backers ${tx(values.slice(i, i + INSERT_BATCH))} ON CONFLICT DO NOTHING RETURNING 1`).length;
              await tx`
                INSERT INTO coin_backer_cursor (coin, block) VALUES (${r.coin}, ${hi.toString()})
                ON CONFLICT (coin) DO UPDATE SET block = EXCLUDED.block, updated_at = now() WHERE coin_backer_cursor.block < EXCLUDED.block`;
            });
            added += inRange;
          } catch (err) {
            // A failed write is retried as a smaller range (never past the cursor).
            throw new Error(`too many results in this range: the write failed (${err instanceof Error ? err.name : 'error'})`, { cause: err });
          }
        },
      });
      coins++;
      if (scan.outOfTime) return { coins, added, failed, outOfTime: true as const };
    } catch (err) {
      failed++;
      log(`[backers] ${r.coin}: ${errName(err)}`);
    }
  }
  return { coins, added, failed };
}

/** Each coin's backers so far (lowercase keys; a coin with none is absent). */
export async function backersOf(coins: string[]): Promise<Map<string, number>> {
  const list = [...new Set(coins.map(lower))];
  if (list.length === 0) return new Map();
  const rows = await sql()<{ coin: string; n: number }[]>`
    SELECT coin, count(*)::int AS n FROM coin_backers WHERE coin IN ${sql()(list)} GROUP BY coin`;
  return new Map(rows.map((r) => [r.coin, r.n]));
}

/** The backers of one coin (lowercase address; 0 for null or none), e.g. raising.ts pillCoin's `coin`. */
export async function backersOfCoin(coin: string | null): Promise<number> {
  return coin ? ((await backersOf([coin])).get(lower(coin)) ?? 0) : 0;
}

/**
 * v3.1 (spec 3.3): the backers EarnKit first saw after `since` (coin_backers.first_seen_at; a row from before v3.1 is
 * 'epoch', never new) on the builder's coin whose backing is open (raising.ts pillCoin: EARNKIT_RAISING on, launched,
 * opened, the one project confirmed). 0 with the flag off, no such coin, or on a read error. Never throws.
 */
export async function newBackers(builderId: number, since: Date): Promise<number> {
  try {
    const c = await pillCoin(builderId);
    if (!c?.coin) return 0;
    const [r] = await sql()<{ n: number }[]>`
      SELECT count(DISTINCT wallet)::int AS n FROM coin_backers WHERE coin = ${lower(c.coin)} AND first_seen_at > ${since}`;
    return r?.n ?? 0;
  } catch (err) {
    console.error('[backers] new', err instanceof Error ? err.name : 'error');
    return 0;
  }
}
