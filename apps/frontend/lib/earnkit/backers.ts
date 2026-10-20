import { toEventSelector, type Hex } from 'viem';
import { sql } from './db';
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
import { raisingCoin } from './raising';

/**
 * v3 Stage 2 (spec 5.3 Route 2): backers, the distinct wallets that received a project's coin (unique buyer wallets),
 * indexed from Base the way bonus-ledger.ts indexes the Safe: per coin, from a stored block cursor (start: the launch
 * block, from the `coin_tx` receipt), in ranges of at most INDEX_CHUNK blocks, within INDEXER_MS a run, oldest cursor
 * first; one coin's failure never stops the rest. Pool, router, locker, FeeLocker, Safe, factory and zero are never
 * backers. Backers never touch Shipping or rank; they show only while EARNKIT_RAISING is on (bench-data, stats).
 */

/** Each indexer's time slice per run (the cron's runBonusLedger), ms. */
export const INDEXER_MS = 25_000;
/** Blocks per getLogs call, at most (escrow.ts LOG_CHUNK; scanForward shrinks it when the RPC refuses). */
export const INDEX_CHUNK = 2_000n;
/** getLogs calls per coin per run, so one coin far behind never takes the whole slice. */
export const CALLS_PER_COIN = 50;
/** Base: one block every 2 s. Without a launch receipt, the start is estimated from coin_launched_at, this many blocks early (an hour). */
const START_MARGIN = 1_800n;

/**
 * Never a backer (lowercase). Verified Clanker v4 and Uniswap v4 Base addresses (tokens.fun lib/launch/clankerFees.ts
 * CLANKER_BASE, lib/chains/registry.ts 8453). The LP lockers, the FeeLocker and the Safe come from BonusChain; the
 * coin's own pool hook is read per coin (BonusRpc.poolHooks).
 */
export const BACKER_EXCLUDED = {
  zero: '0x0000000000000000000000000000000000000000',
  poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
  universalRouter: '0x6ff5693b99212da76ad316178a184ab56d299b43',
  factory: '0xe85a59c628f7d27878aceb4bf3b35733630083a9',
  vault: '0x8e845ead15737bf71904a30bddd3aee76d6adf6c',
  dynamicHook: '0xd60d6b218116cfd801e28f78d011a203d2b068cc',
} as const;

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
  const rows = await sql()<{ coin: Hex; coin_tx: string | null; launched_at: Date | null; block: string | null }[]>`
    SELECT lower(p.coin_address) AS coin, p.coin_tx, p.coin_launched_at AS launched_at, c.block::text AS block
    FROM projects p LEFT JOIN coin_backer_cursor c ON c.coin = lower(p.coin_address)
    WHERE p.coin_address IS NOT NULL AND p.token_status = 'launched' AND COALESCE(p.coin_chain_id, 8453) = 8453
      AND (${onlyCoins(o.only)}::text[] IS NULL OR lower(p.coin_address) = ANY(${onlyCoins(o.only)}::text[]))
    ORDER BY c.updated_at ASC NULLS FIRST, p.id`;
  if (rows.length === 0) return { coins: 0, added: 0, failed: 0 };
  const head = (await rpc.blockNumber()) - CONFIRMATIONS;
  const fixed = [...Object.values(BACKER_EXCLUDED), chain.feeLocker, chain.safe, ...chain.lockers].map(lower);
  let coins = 0;
  let added = 0;
  let failed = 0;
  for (const r of rows) {
    if (Date.now() >= deadline) return { coins, added, failed, outOfTime: true as const };
    try {
      const from = r.block != null ? BigInt(r.block) + 1n : await launchBlock(r, head, rpc, now);
      if (from > head) continue;
      const hook = rpc.poolHooks ? await rpc.poolHooks(r.coin) : null;
      const skip = new Set([...fixed, r.coin, ...(hook ? [lower(hook)] : [])]);
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
            const to = topicAddress(l.topics[2]);
            if (!/^0x[0-9a-f]{40}$/.test(to) || skip.has(to)) continue;
            const seen = first.get(to);
            if (seen === undefined || l.blockNumber < seen) first.set(to, l.blockNumber);
          }
          if (first.size > 0) {
            const values = [...first].map(([wallet, block]) => ({ coin: r.coin, wallet, first_block: block.toString() }));
            added += (await sql()`INSERT INTO coin_backers ${sql()(values)} ON CONFLICT DO NOTHING RETURNING 1`).length;
          }
          await sql()`
            INSERT INTO coin_backer_cursor (coin, block) VALUES (${r.coin}, ${hi.toString()})
            ON CONFLICT (coin) DO UPDATE SET block = EXCLUDED.block, updated_at = now() WHERE coin_backer_cursor.block < EXCLUDED.block`;
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

/** The backers of the builder's one project's coin (raising.ts raisingCoin); 0 without a launched Base coin. */
export async function backersOfBuilder(builderId: number): Promise<number> {
  const c = await raisingCoin(builderId);
  if (!c) return 0;
  const [p] = await sql()<{ coin: string | null }[]>`SELECT lower(coin_address) AS coin FROM projects WHERE id = ${c.project_id}`;
  return p?.coin ? ((await backersOf([p.coin])).get(p.coin) ?? 0) : 0;
}
