import { decodeEventLog, toEventSelector, type Hex } from 'viem';
import { sql } from './db';
import { BASE_BONUS, CLAIM_TOKENS, CONFIRMATIONS, bonusRpc, scanForward } from './bonus-ledger';
import { CALLS_PER_COIN, INDEXER_MS, INDEX_CHUNK, launchBlock, lower, onlyCoins, topicAddress, type IndexOpts } from './backers';
import { cachedFeesUsd, cachedWethUsd, creatorWalletSql, wethToUsd } from './fees';

export { creatorWalletSql };

export { CLAIM_TOKENS };

/**
 * v3 Stage 2 (spec 5.2, 5.3 Route 2): Earned, the money that reached the builder through EarnKit: the coin's creator
 * fees claimed to the builder's wallet (the FeeLocker's ClaimTokens logs, indexed per coin like the Safe's deposits)
 * plus announced program prizes (entry_outcomes, basis 'announcement'). Fees still in the FeeLocker are "waiting"
 * (fees.ts cachedFeesUsd, the availableFees read), never summed into Earned. Earned shows with EARNKIT_RAISING off
 * (prizes); it never touches Shipping or rank.
 *
 * The FeeLocker keeps one WETH balance per owner across all of the owner's coins, so a claim is not per coin: it is
 * stored once (tx_hash, log_index) under the first of the owner's coins whose index reads it, from that coin's launch
 * block. Only WETH claims count (the creator's fee slot is paid in WETH by EarnKit's split).
 */

const CLAIM_TOPIC = toEventSelector(CLAIM_TOKENS);
/** A coin's creator-fee cursor in bonus_cursor. */
export const feesCursor = (coin: string) => `creator_fees:${lower(coin)}`;

/**
 * Indexes the creator fees claimed for every launched Base coin: from its cursor (start: the launch block) up to
 * CONFIRMATIONS behind the head, the FeeLocker's ClaimTokens logs with feeOwner = the coin's creator wallet and token
 * WETH become creator_fees rows (idempotent). Bounded as indexBackers (deadline, CALLS_PER_COIN, INDEX_CHUNK); one
 * coin's failure never stops the rest. Without a ClaimTokens reader: skipped.
 */
export async function indexCreatorFees(now: Date, o: IndexOpts = {}) {
  const rpc = o.rpc ?? bonusRpc();
  const read = rpc.claimTokenLogs;
  if (!read) return { skipped: 'no reader' as const };
  const chain = o.chain ?? BASE_BONUS;
  const deadline = o.deadline ?? Date.now() + INDEXER_MS;
  const log = o.log ?? console.error;
  if (Date.now() >= deadline) return { coins: 0, added: 0, failed: 0, outOfTime: true as const };
  const db = sql();
  const rows = await db<{ coin: Hex; wallet: string | null; coin_tx: string | null; launched_at: Date | null; block: string | null }[]>`
    SELECT lower(p.coin_address) AS coin, ${creatorWalletSql(db)} AS wallet, p.coin_tx, p.coin_launched_at AS launched_at, c.block::text AS block
    FROM projects p LEFT JOIN bonus_cursor c ON c.id = 'creator_fees:' || lower(p.coin_address)
    WHERE p.coin_address IS NOT NULL AND p.token_status = 'launched' AND COALESCE(p.coin_chain_id, 8453) = 8453
      AND (${onlyCoins(o.only)}::text[] IS NULL OR lower(p.coin_address) = ANY(${onlyCoins(o.only)}::text[]))
    ORDER BY c.updated_at ASC NULLS FIRST, p.id`;
  const todo = rows.filter((r) => r.wallet && /^0x[0-9a-f]{40}$/.test(r.wallet));
  if (todo.length === 0) return { coins: 0, added: 0, failed: 0 };
  const head = (await rpc.blockNumber()) - CONFIRMATIONS;
  const times = new Map<bigint, Date>();
  const time = async (b: bigint) => {
    if (!times.has(b)) times.set(b, await rpc.blockTime(b));
    return times.get(b)!;
  };
  const [feeLocker, weth] = [lower(chain.feeLocker), lower(chain.weth)];
  let coins = 0;
  let added = 0;
  let failed = 0;
  for (const r of todo) {
    if (Date.now() >= deadline) return { coins, added, failed, outOfTime: true as const };
    const wallet = r.wallet! as Hex;
    try {
      const from = r.block != null ? BigInt(r.block) + 1n : await launchBlock(r, head, rpc, now);
      if (from > head) continue;
      const scan = await scanForward({
        from,
        to: head,
        chunk: INDEX_CHUNK,
        maxCalls: CALLS_PER_COIN,
        deadline,
        sleep: o.sleep,
        onRange: async (lo, hi) => {
          for (const l of await read(wallet, lo, hi)) {
            // The reader filters by owner and token; checked again, so no other owner's or token's claim is ever stored.
            if (lower(l.address) !== feeLocker || lower(l.topics[0] ?? '') !== CLAIM_TOPIC) continue;
            if (topicAddress(l.topics[1]) !== wallet || topicAddress(l.topics[2]) !== weth) continue;
            const { args } = decodeEventLog({ abi: [CLAIM_TOKENS], topics: l.topics as [Hex, ...Hex[]], data: l.data as Hex });
            const at = await time(l.blockNumber);
            added += (await sql()`
              INSERT INTO creator_fees (tx_hash, log_index, coin, wallet, amount_wei, block_number, block_time)
              VALUES (${lower(l.txHash)}, ${l.logIndex}, ${r.coin}, ${wallet}, ${args.amountClaimed.toString()}, ${l.blockNumber.toString()}, ${at})
              ON CONFLICT DO NOTHING RETURNING 1`).length;
          }
          await sql()`
            INSERT INTO bonus_cursor (id, block) VALUES (${feesCursor(r.coin)}, ${hi.toString()})
            ON CONFLICT (id) DO UPDATE SET block = EXCLUDED.block, updated_at = now()
            WHERE bonus_cursor.block IS NULL OR bonus_cursor.block < EXCLUDED.block`;
        },
      });
      coins++;
      if (scan.outOfTime) return { coins, added, failed, outOfTime: true as const };
    } catch (err) {
      failed++;
      log(`[earned] ${r.coin}: ${err instanceof Error ? `${err.name}: ${err.message.slice(0, 120)}` : 'error'}`);
    }
  }
  return { coins, added, failed };
}

/** Earned: `paid_usd` (fees claimed plus announced prizes), `waiting_usd` (fees still in the FeeLocker), `fees_usd` (the claimed fees alone). */
export type Earned = { paid_usd: number; waiting_usd: number; fees_usd: number };
export const NO_EARNED: Earned = { paid_usd: 0, waiting_usd: 0, fees_usd: 0 };
/** To the cent. Pure. */
const cents = (usd: number) => Math.round(usd * 100) / 100;

/**
 * The builder's Earned (a builder: the installation group, COALESCE(builder_id, id)): the WETH claimed to the creator
 * wallet of each of their launched coins (creator_fees), at the WETH price (fees.ts cachedWethUsd), plus the prizes of
 * their entries' announced won or placed outcomes (stats.ts wonUsdSql's rule); waiting, the FeeLocker's cached read
 * for those wallets (fees.ts cachedFeesUsd: never waits on a chain read; refreshed in the background).
 */
export async function earnedUsd(builderId: number, now: Date = new Date()): Promise<Earned> {
  const db = sql();
  const [r] = await db<{ wei: string | null; prizes: string | null; wallets: string[] | null }[]>`
    SELECT
      (SELECT sum(f.amount_wei) FROM creator_fees f JOIN projects p ON lower(p.coin_address) = f.coin JOIN installations i ON i.id = p.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND f.wallet = ${creatorWalletSql(db)})::text AS wei,
      (SELECT sum(eo.prize_usd) FROM entry_outcomes eo JOIN projects p ON p.id = eo.project_id JOIN installations i ON i.id = p.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND eo.basis = 'announcement' AND eo.result IN ('won', 'placed') AND eo.prize_usd > 0)::text AS prizes,
      (SELECT array_agg(DISTINCT ${creatorWalletSql(db)}) FROM projects p JOIN installations i ON i.id = p.installation_id
        WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND p.coin_address IS NOT NULL AND p.token_status = 'launched'
          AND COALESCE(p.fee_recipients->>'creator', p.creator_wallet, p.payout_wallet) IS NOT NULL) AS wallets`;
  const wei = BigInt(r?.wei ?? '0');
  const price = wei > 0n ? await cachedWethUsd(now.getTime()) : null;
  if (wei > 0n && price === null) console.error('[earned] no WETH price; claimed fees left out this time');
  const fees = price === null ? 0 : wethToUsd(wei, price);
  const wallets = (r?.wallets ?? []).filter((w) => /^0x[0-9a-f]{40}$/.test(w));
  const waiting = wallets.length ? ((await cachedFeesUsd(wallets, now.getTime())) ?? 0) : 0;
  return { paid_usd: cents(fees + Number(r?.prizes ?? 0)), waiting_usd: cents(waiting), fees_usd: cents(fees) };
}
