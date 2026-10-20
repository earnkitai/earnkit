import { decodeEventLog, toEventSelector, type Hex } from 'viem';
import { sql } from './db';
import { BASE_BONUS, CLAIM_TOKENS, CONFIRMATIONS, bonusDeposits, bonusRpc, scanForward, type RawLog, type TxLog } from './bonus-ledger';
import { CALLS_PER_COIN, INDEXER_MS, INDEX_CHUNK, launchBlock, lower, onlyCoins, topicAddress, type IndexOpts } from './backers';
import { cachedFeesUsd, cachedWethUsd, creatorWalletSql, wethToUsd } from './fees';

export { creatorWalletSql };

export { CLAIM_TOKENS };
/**
 * v3 Stage 2 (spec 5.2, 5.3 Route 2): Earned, the money that reached the builder through EarnKit: the creator fees of
 * the builder's EarnKit coins claimed to their wallet, plus announced program prizes (entry_outcomes, basis
 * 'announcement'). Fees still in the FeeLocker are "waiting" (fees.ts cachedFeesUsd, the availableFees read), never
 * summed into Earned. Earned shows with EARNKIT_RAISING off (prizes); it never touches Shipping or rank.
 *
 * The FeeLocker keeps one WETH balance per owner across every coin that pays it, and a ClaimTokens empties it, so a
 * claim may carry fees of coins EarnKit never launched. Per creator wallet (scanned once, however many coins it has),
 * the index books each WETH deposit (StoreTokens) to its coin through the same transaction's ClaimedRewards, exactly as
 * bonus-ledger.ts bonusDeposits does for the Safe, keeping only the wallet's own EarnKit coins (creator_deposits); a
 * claim is then credited only up to those coins' deposits not yet credited, oldest coin first, one creator_fees row per
 * coin credited. Only WETH counts (EarnKit's split pays the creator slot in WETH).
 */

const CLAIM_TOPIC = toEventSelector(CLAIM_TOKENS);
/** A creator wallet's fee cursor in bonus_cursor. */
export const feesCursor = (wallet: string) => `creator_fees:${lower(wallet)}`;

type Ev =
  | { kind: 'deposit'; tx: string; logIndex: number; block: bigint; coin: string; amount: bigint }
  | { kind: 'claim'; tx: string; logIndex: number; block: bigint; amount: bigint };

/**
 * Indexes the creator fees claimed for every creator wallet of a launched Base EarnKit coin: from the wallet's cursor
 * (start: the earliest launch block of its coins) up to CONFIRMATIONS behind the head, in the indexers' bounds
 * (deadline, CALLS_PER_COIN, INDEX_CHUNK), oldest cursor first; one wallet's failure never stops the rest. A range's
 * deposits, credits and cursor are written in one transaction, and a range read again replays its stored credits, so
 * a retry never credits twice. Needs the ClaimTokens, StoreTokens and ClaimedRewards readers (else skipped).
 */
export async function indexCreatorFees(now: Date, o: IndexOpts = {}) {
  const rpc = o.rpc ?? bonusRpc();
  const [readClaims, readStores, readRewards] = [rpc.claimTokenLogs, rpc.safeStoreLogs, rpc.claimLogs];
  if (!readClaims || !readStores || !readRewards) return { skipped: 'no reader' as const };
  const chain = o.chain ?? BASE_BONUS;
  const deadline = o.deadline ?? Date.now() + INDEXER_MS;
  const log = o.log ?? console.error;
  if (Date.now() >= deadline) return { wallets: 0, credited: 0, failed: 0, outOfTime: true as const };
  const db = sql();
  const rows = await db<{ coin: Hex; wallet: string | null; coin_tx: string | null; launched_at: Date | null }[]>`
    SELECT lower(p.coin_address) AS coin, ${creatorWalletSql(db)} AS wallet, p.coin_tx, p.coin_launched_at AS launched_at
    FROM projects p
    WHERE p.coin_address IS NOT NULL AND p.token_status = 'launched' AND COALESCE(p.coin_chain_id, 8453) = 8453
      AND (${onlyCoins(o.only)}::text[] IS NULL OR lower(p.coin_address) = ANY(${onlyCoins(o.only)}::text[]))
    ORDER BY p.coin_launched_at NULLS LAST, p.id`;
  type CoinRow = (typeof rows)[number];
  const byWallet = new Map<string, CoinRow[]>();
  for (const r of rows) if (r.wallet && /^0x[0-9a-f]{40}$/.test(r.wallet)) byWallet.set(r.wallet, [...(byWallet.get(r.wallet) ?? []), r]);
  if (byWallet.size === 0) return { wallets: 0, credited: 0, failed: 0 };
  const cursors = new Map(
    (await db<{ id: string; block: string | null; updated_at: Date }[]>`
      SELECT id, block::text AS block, updated_at FROM bonus_cursor WHERE id IN ${db([...byWallet.keys()].map(feesCursor))}`).map((c) => [c.id, c]),
  );
  // Oldest cursor first (none yet: first).
  const order = [...byWallet.keys()].sort((a, b) => (cursors.get(feesCursor(a))?.updated_at.getTime() ?? 0) - (cursors.get(feesCursor(b))?.updated_at.getTime() ?? 0));
  const head = (await rpc.blockNumber()) - CONFIRMATIONS;
  const times = new Map<bigint, Date>();
  const time = async (b: bigint) => {
    if (!times.has(b)) times.set(b, await rpc.blockTime(b));
    return times.get(b)!;
  };
  const [feeLocker, weth] = [lower(chain.feeLocker), lower(chain.weth)];
  let wallets = 0;
  let credited = 0;
  let failed = 0;
  for (const wallet of order) {
    if (Date.now() >= deadline) return { wallets, credited, failed, outOfTime: true as const };
    const coins = byWallet.get(wallet)!.map((r) => r.coin);
    const mine = new Set<string>(coins);
    try {
      const cur = cursors.get(feesCursor(wallet))?.block;
      let from = cur != null ? BigInt(cur) + 1n : head + 1n;
      if (cur == null) for (const r of byWallet.get(wallet)!) {
        const b = await launchBlock(r, head, rpc, now);
        if (b < from) from = b;
      }
      if (from > head) continue;
      // What each coin deposited before `from` and was not credited yet.
      const outstanding = new Map<string, bigint>(coins.map((c): [string, bigint] => [c, 0n]));
      for (const d of await sql()<{ coin: string; wei: string }[]>`
        SELECT coin, sum(amount_wei)::text AS wei FROM creator_deposits WHERE wallet = ${wallet} AND block_number < ${from.toString()} GROUP BY coin`)
        if (outstanding.has(d.coin)) outstanding.set(d.coin, BigInt(d.wei));
      for (const c of await sql()<{ coin: string; wei: string }[]>`
        SELECT coin, sum(amount_wei)::text AS wei FROM creator_fees WHERE wallet = ${wallet} AND block_number < ${from.toString()} GROUP BY coin`)
        if (outstanding.has(c.coin)) outstanding.set(c.coin, outstanding.get(c.coin)! - BigInt(c.wei));
      const scan = await scanForward({
        from,
        to: head,
        chunk: INDEX_CHUNK,
        maxCalls: CALLS_PER_COIN,
        deadline,
        sleep: o.sleep,
        onRange: async (lo, hi) => {
          const evs: Ev[] = [];
          // Deposits: the wallet's StoreTokens, attributed through the same transaction's ClaimedRewards (bonusDeposits).
          const stores = await readStores(lo, hi, wallet as Hex);
          if (stores.length > 0) {
            const byTx = new Map<string, { block: bigint; logs: RawLog[] }>();
            const add = (l: TxLog) => byTx.get(lower(l.txHash))?.logs.push({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex });
            for (const l of stores) if (!byTx.has(lower(l.txHash))) byTx.set(lower(l.txHash), { block: l.blockNumber, logs: [] });
            stores.forEach(add);
            const blocks = stores.map((l) => l.blockNumber);
            (await readRewards(blocks.reduce((a, b) => (b < a ? b : a)), blocks.reduce((a, b) => (b > a ? b : a)))).forEach(add);
            for (const [tx, t] of byTx)
              for (const d of bonusDeposits(t.logs, wallet, chain))
                if (d.coin && mine.has(d.coin)) evs.push({ kind: 'deposit', tx, logIndex: d.logIndex, block: t.block, coin: d.coin, amount: d.amount });
          }
          // Claims: the reader filters by owner and token; checked again, so no other owner's or token's claim counts.
          for (const l of await readClaims(wallet as Hex, lo, hi)) {
            if (lower(l.address) !== feeLocker || lower(l.topics[0] ?? '') !== CLAIM_TOPIC) continue;
            if (topicAddress(l.topics[1]) !== wallet || topicAddress(l.topics[2]) !== weth) continue;
            const { args } = decodeEventLog({ abi: [CLAIM_TOKENS], topics: l.topics as [Hex, ...Hex[]], data: l.data as Hex });
            evs.push({ kind: 'claim', tx: lower(l.txHash), logIndex: l.logIndex, block: l.blockNumber, amount: args.amountClaimed });
          }
          evs.sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
          // A copy: a failed range (read again smaller) never leaves its credits in the running balance.
          const out = new Map(outstanding);
          let inRange = 0;
          await sql().begin(async (tx) => {
            for (const e of evs) {
              if (e.kind === 'deposit') {
                await tx`
                  INSERT INTO creator_deposits (tx_hash, log_index, coin, wallet, amount_wei, block_number)
                  VALUES (${e.tx}, ${e.logIndex}, ${e.coin}, ${wallet}, ${e.amount.toString()}, ${e.block.toString()}) ON CONFLICT DO NOTHING`;
                out.set(e.coin, out.get(e.coin)! + e.amount);
                continue;
              }
              // A claim credited before (this range read again) replays its stored credits.
              const stored = await tx<{ coin: string; wei: string }[]>`
                SELECT coin, amount_wei::text AS wei FROM creator_fees WHERE tx_hash = ${e.tx} AND log_index = ${e.logIndex}`;
              if (stored.length > 0) {
                for (const s of stored) if (out.has(s.coin)) out.set(s.coin, out.get(s.coin)! - BigInt(s.wei));
                continue;
              }
              let rest = e.amount;
              for (const coin of coins) {
                const have = out.get(coin)!;
                if (rest === 0n || have <= 0n) continue;
                const take = have < rest ? have : rest;
                await tx`
                  INSERT INTO creator_fees (tx_hash, log_index, coin, wallet, amount_wei, block_number, block_time)
                  VALUES (${e.tx}, ${e.logIndex}, ${coin}, ${wallet}, ${take.toString()}, ${e.block.toString()}, ${await time(e.block)})`;
                out.set(coin, have - take);
                rest -= take;
                inRange++;
              }
            }
            await tx`
              INSERT INTO bonus_cursor (id, block) VALUES (${feesCursor(wallet)}, ${hi.toString()})
              ON CONFLICT (id) DO UPDATE SET block = EXCLUDED.block, updated_at = now()
              WHERE bonus_cursor.block IS NULL OR bonus_cursor.block < EXCLUDED.block`;
          });
          for (const [c, v] of out) outstanding.set(c, v);
          credited += inRange;
        },
      });
      wallets++;
      if (scan.outOfTime) return { wallets, credited, failed, outOfTime: true as const };
    } catch (err) {
      failed++;
      log(`[earned] ${wallet}: ${err instanceof Error ? `${err.name}: ${err.message.slice(0, 120)}` : 'error'}`);
    }
  }
  return { wallets, credited, failed };
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
