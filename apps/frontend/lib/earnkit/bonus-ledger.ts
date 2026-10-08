import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  HttpRequestError,
  RawContractError,
  TimeoutError,
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  toEventSelector,
  type Hex,
} from 'viem';
import type postgres from 'postgres';
import type { LocalAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { bookingFor, rollsOver, rolloverPrograms, rolloverRounds, type Round } from './bonus-rounds';
import { blockscout } from './campaigns';
import { sql } from './db';
import { LOG_CHUNK, LOG_CHUNK_MIN, RATE_BACKOFF_MS, logError } from './escrow';
import {
  MANUAL_CHECK,
  NOT_MAINNET,
  NO_PAYOUT_KEY,
  openStoredSends,
  payWinner,
  payoutAccount,
  payoutRpc,
  type PayoutRow,
  type PayoutRpc,
  type PayoutStore,
} from './payout';
import { BASE_MAINNET } from './sanctions';
import { withScoringLock } from './sponsor';

/**
 * The builder bonus ledger (v2.5 §3, Ruling 5). The payout wallet (CAMPAIGN_PAYOUT_PRIVATE_KEY) is
 * also the builder bonus wallet: every EarnKit coin's 2000 bps slot pays it, in WETH, through
 * Clanker's FeeLocker. tokens.fun's own cron already calls `collectRewards(coin)` for every coin,
 * so EarnKit doesn't routinely collect. Instead, hourly:
 * 1. index: reads the FeeLocker's StoreTokens logs for (bonus wallet, WETH) from a stored block
 *    cursor, attributes each deposit to its coin (from the same transaction's receipt) and books it
 *    to that coin's program's open round at the block's time, or to the Safe;
 * 2. collect: sends `collectRewards(coin)` itself only for an EarnKit coin in its round's last 24 h
 *    with no deposit seen from it in 12 h (so its pending fees count before the round freezes);
 * 3. claim: `claim(bonus wallet, WETH)` and `claim(Safe, WETH)` when worth ≥ 10× their gas;
 * 4. sweep: sends the WETH booked to the Safe, not yet swept, from the bonus wallet to the Safe when
 *    worth ≥ 10× its gas (the v2.4 idempotent payout: signed and stored before it is broadcast).
 */

/** The contracts the ledger reads (lowercase). Injectable for the anvil test. */
export type BonusChain = {
  feeLocker: Hex;
  /** Clanker LP lockers, current first (tokens.fun `lockerCandidates(8453)`). */
  lockers: Hex[];
  weth: Hex;
  safe: Hex;
};
export const BASE_BONUS: BonusChain = {
  feeLocker: '0xf3622742b1e446d92e45e22923ef11c2fcd55d68',
  lockers: ['0xffa37784d619f228d8b379d287a4d7282e500762', '0x63d2dfea64b3433f4071a98665bcd7ca14d93496'],
  weth: '0x4200000000000000000000000000000000000006',
  safe: '0xc8a889577446153e28d42254b75238ae31ec7d57',
};

// Verified against tokens.fun origin/main lib/fees/abi.ts (Clanker v4 sources on Base, 2026-09-30).
export const STORE_TOKENS = parseAbiItem(
  'event StoreTokens(address indexed sender, address indexed feeOwner, address indexed token, uint256 balance, uint256 amount)',
);
export const CLAIMED_REWARDS = parseAbiItem(
  'event ClaimedRewards(address indexed token, uint256 amount0, uint256 amount1, uint256[] rewards0, uint256[] rewards1)',
);
const STORE_TOPIC = toEventSelector(STORE_TOKENS);
const CLAIMED_TOPIC = toEventSelector(CLAIMED_REWARDS);
export const FEE_LOCKER_ABI = parseAbi([
  'function availableFees(address feeOwner, address token) view returns (uint256)',
  'function claim(address feeOwner, address token)',
]);
export const LOCKER_ABI = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct TokenRewardInfo { address token; PoolKey poolKey; uint256 positionId; uint256 numPositions; uint16[] rewardBps; address[] rewardAdmins; address[] rewardRecipients; }',
  'function tokenRewards(address token) view returns (TokenRewardInfo)',
  'function collectRewards(address token)',
]);

export type RawLog = { address: string; topics: readonly string[]; data: string; logIndex: number };
export type BonusDeposit = { logIndex: number; amount: bigint; locker: string; coin: string | null };

const lower = (s: string) => s.toLowerCase();
const topicAddress = (t: string | undefined) => (t ? `0x${t.slice(-40)}`.toLowerCase() : '');

/**
 * The WETH deposits the FeeLocker stored for `bonusWallet` in one transaction receipt (its
 * StoreTokens logs: sender, feeOwner and token indexed; data = balance, amount), each with its
 * coin. Pure.
 *
 * Attribution (tokens.fun lib/fees/attribution.ts, verified onchain on 403/403 Base receipts): a
 * Clanker locker emits StoreTokens for each non-zero slot of a coin, then FeesSwapped when it
 * swapped, and then ClaimedRewards(token) for that coin. So a deposit belongs to the NEXT
 * ClaimedRewards from the locker that sent it (StoreTokens.sender). A deposit whose sender isn't
 * a known locker, or with no later ClaimedRewards from it, has `coin: null` (booked to the Safe).
 */
export function bonusDeposits(logs: RawLog[], bonusWallet: string, chain: BonusChain = BASE_BONUS): BonusDeposit[] {
  const wallet = lower(bonusWallet);
  const lockers = new Set(chain.lockers.map(lower));
  const sorted = [...logs].sort((a, b) => a.logIndex - b.logIndex);
  const out: BonusDeposit[] = [];
  for (const [i, l] of sorted.entries()) {
    if (lower(l.address) !== lower(chain.feeLocker) || lower(l.topics[0] ?? '') !== STORE_TOPIC) continue;
    if (topicAddress(l.topics[2]) !== wallet || topicAddress(l.topics[3]) !== lower(chain.weth)) continue;
    const { args } = decodeEventLog({ abi: [STORE_TOKENS], topics: l.topics as [Hex, ...Hex[]], data: l.data as Hex });
    const locker = lower(args.sender);
    const claim = lockers.has(locker)
      ? sorted.slice(i + 1).find((c) => lower(c.address) === locker && lower(c.topics[0] ?? '') === CLAIMED_TOPIC)
      : undefined;
    out.push({ logIndex: l.logIndex, amount: args.amount, locker, coin: claim ? topicAddress(claim.topics[1]) : null });
  }
  return out;
}

/** A transfer or claim is worth sending when the amount is at least 10× its gas cost (wei; WETH = ETH). Pure. */
export const worthIt = (amountWei: bigint, gas: bigint, maxFeePerGas: bigint) => amountWei >= 10n * gas * maxFeePerGas;

/** The chain reads and writes the ledger needs: v2.4's payout RPC plus these. Replaced in tests. */
export type BonusRpc = PayoutRpc & {
  blockNumber: () => Promise<bigint>;
  /** FeeLocker StoreTokens logs with feeOwner = `owner` and token = WETH, by indexed topics. */
  storeLogs: (from: bigint, to: bigint, owner: Hex) => Promise<{ txHash: Hex; logIndex: number; blockNumber: bigint }[]>;
  receiptLogs: (hash: Hex) => Promise<{ blockNumber: bigint; logs: RawLog[] }>;
  blockTime: (block: bigint) => Promise<Date>;
  availableFees: (owner: Hex, token: Hex) => Promise<bigint>;
  /** Whether `collectRewards(coin)` on `locker` simulates cleanly from `from`. */
  canCollect: (locker: Hex, coin: Hex, from: Hex) => Promise<boolean>;
  rewardRecipients: (locker: Hex, coin: Hex) => Promise<string[]>;
};

/**
 * Whether a failed eth_call is the contract reverting (viem's revert errors anywhere in the cause
 * chain, or a node message saying so), as opposed to the RPC failing to answer. Pure.
 */
export function isRevert(err: unknown): boolean {
  if (err instanceof BaseError) {
    const hit = err.walk((e) => e instanceof ExecutionRevertedError || e instanceof ContractFunctionRevertedError || e instanceof RawContractError);
    if (hit) return true;
    if (err.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError)) return false;
  }
  return /execution reverted|\brevert(ed)?\b/i.test(err instanceof Error ? err.message : String(err));
}

/** Base over BASE_RPC_URL (the public RPC by default). */
export function bonusRpc(url = process.env.BASE_RPC_URL, chain: BonusChain = BASE_BONUS): BonusRpc {
  const c = createPublicClient({ chain: base, transport: http(url) });
  return {
    ...payoutRpc(url),
    // Never viem's cached head (it caches for its polling interval): always the live block.
    blockNumber: () => c.getBlockNumber({ cacheTime: 0 }),
    storeLogs: async (fromBlock, toBlock, owner) =>
      (
        await c.getLogs({
          address: chain.feeLocker,
          event: STORE_TOKENS,
          args: { feeOwner: owner, token: chain.weth },
          fromBlock,
          toBlock,
        })
      ).map((l) => ({ txHash: l.transactionHash!, logIndex: l.logIndex!, blockNumber: l.blockNumber! })),
    receiptLogs: async (hash) => {
      const r = await c.getTransactionReceipt({ hash });
      return { blockNumber: r.blockNumber, logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex })) };
    },
    blockTime: async (blockNumber) => new Date(Number((await c.getBlock({ blockNumber })).timestamp) * 1000),
    availableFees: (owner, token) =>
      c.readContract({ address: chain.feeLocker, abi: FEE_LOCKER_ABI, functionName: 'availableFees', args: [owner, token] }),
    // False only when the call reverts (this locker doesn't hold the coin); a transport error (rate
    // limit, timeout) throws, so the coin is retried next run (task-10-review M7).
    canCollect: (locker, coin, from) =>
      c
        .call({ account: from, to: locker, data: encodeFunctionData({ abi: LOCKER_ABI, functionName: 'collectRewards', args: [coin] }) })
        .then(
          () => true,
          (err: unknown) => {
            if (isRevert(err)) return false;
            throw err;
          },
        ),
    rewardRecipients: async (locker, coin) =>
      (await c.readContract({ address: locker, abi: LOCKER_ABI, functionName: 'tokenRewards', args: [coin] })).rewardRecipients.map(lower),
  };
}

export type BonusDeps = {
  /** The payout (= bonus) wallet; default from CAMPAIGN_PAYOUT_PRIVATE_KEY. Null: the ledger is skipped. */
  account?: LocalAccount | null;
  /** Where the default account's key is read from (default process.env); for tests. */
  env?: Record<string, string | undefined>;
  /**
   * I5: the run's nonce floor, shared by every send of one ledger run (claims, collects, round
   * payouts, the sweep): each signature accepted by the node raises it past its nonce, so the next
   * one never relies on the RPC's pending count. runBonusLedger seeds it from openStoredSends.
   */
  nonces?: { next: number };
  rpc?: BonusRpc;
  chain?: BonusChain;
  now?: Date;
  /** Epoch ms: no new read or send starts after it. */
  deadline?: number;
  /** getLogs calls per run (refused and rate-limited ones included). */
  maxCalls?: number;
  /** The first block to index when there is no cursor yet (default: BONUS_INDEX_START_BLOCK, else 2 days back). */
  startBlock?: bigint;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Receipt reads per run (default RECEIPTS_PER_RUN). */
  maxReceipts?: number;
  /** Whether the coin had token transfers since `since` (default: Base Blockscout). */
  active?: (coin: Hex, since: Date) => Promise<boolean>;
  /**
   * The builder bonus rounds step (Task 7: freeze, review, pay), run under the ledger's lease after
   * the claims and before the sweep. The cron passes bonus-payout.ts advanceRounds; none: skipped.
   */
  rounds?: (account: LocalAccount, d: BonusDeps & { rpc: BonusRpc; chain: BonusChain; followOnly: boolean }) => Promise<unknown>;
};

/** Blocks behind the head the index stays (no reorg reaches them): tokens.fun's Base setting. */
export const CONFIRMATIONS = 30n;
/** Without a cursor or BONUS_INDEX_START_BLOCK, the first run starts 2 days back (Base: 2 s blocks). */
export const FIRST_LOOKBACK = 86_400n;
/** getLogs calls per run: about 2.3 days of blocks at 2,000 each. The hourly run needs 1. */
export const LOG_CALLS_PER_RUN = 50;
/** Receipt reads per run; past it the run stops where it got to (booked txs are skipped next run). */
export const RECEIPTS_PER_RUN = 200;
/** Index steps failing in a row after which the cron answers 503 (as PAY_FAILED_RUNS). */
export const INDEX_FAILED_RUNS = 6;
/** EarnKit collects a coin itself only this close to its round's end... */
export const COLLECT_WINDOW_MS = 24 * 3_600_000;
/** ...and only when no deposit from it was seen (and EarnKit didn't collect it) this recently. */
export const COLLECT_QUIET_MS = 12 * 3_600_000;

const CURSOR = 'weth';
const toDeadline = (d: BonusDeps) => d.deadline ?? Infinity;

/** Where the index has read up to: the last block read and its time (null: never). For the round freeze. */
export async function indexedThrough(): Promise<{ block: bigint; time: Date | null } | null> {
  const [r] = await sql()<{ block: string | null; block_time: Date | null }[]>`SELECT block, block_time FROM bonus_cursor WHERE id = ${CURSOR}`;
  return r?.block != null ? { block: BigInt(r.block), time: r.block_time } : null;
}

type BonusProgram = { id: string; starts_at: Date | null; ends_at: Date | null; status: string; builder_bonus: boolean | null; campaign: unknown };

/**
 * Takes `round` of `programId` for a booking: creates its row 'open' on its first deposit, moves
 * an open row's window to the program file's (Ruling 21: an extended end keeps the round; a
 * frozen one never changes), and locks it (a freeze never races a deposit). Its state.
 */
async function lockRound(tx: postgres.TransactionSql, programId: string, round: Round) {
  await tx`
    INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at)
    VALUES (${round.key}, ${programId}, ${round.starts}, ${round.ends})
    ON CONFLICT (round_key) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at
    WHERE bonus_rounds.state = 'open'
      AND (bonus_rounds.starts_at, bonus_rounds.ends_at) IS DISTINCT FROM (EXCLUDED.starts_at, EXCLUDED.ends_at)`;
  const [r] = await tx<{ state: string }[]>`SELECT state FROM bonus_rounds WHERE round_key = ${round.key} FOR UPDATE`;
  return r.state;
}

/**
 * v2.8.1 §D (option B): the round a deposit at `at` rolls over to once its coin's program round is
 * over: the earliest still-open round (rolloverRounds) of another program in which the same repo
 * (the coin's `token_repo_key`) has a submitted, complete entry (rolloverPrograms). A round
 * already frozen or paid is passed over, never touched. Null: the Safe, as before.
 */
export async function rolloverRound(
  tx: postgres.TransactionSql,
  coin: { project: number; program: string; repoKey: string | null },
  at: Date,
): Promise<string | null> {
  const programs = await rolloverPrograms(tx, coin, at);
  for (const c of rolloverRounds(programs, at)) if ((await lockRound(tx, c.programId, c.round)) === 'open') return c.round.key;
  return null;
}

/**
 * Books one deposit, idempotently on (tx_hash, log_index): to the open round of the program its coin
 * was entered in, at the block's time; once that round is over (v2.8.1 §D: the window ended, the
 * program closed, or the round froze), to the repo's next open entry (rolloverRound); else to the
 * Safe (no coin, not an EarnKit coin, no open round, the program opted out or is a campaign),
 * logged. The round row is created 'open' on its first deposit and locked while booking, so a
 * freeze never races a deposit. A deposit already booked is never moved.
 */
export async function bookDeposit(
  dep: { txHash: string; logIndex: number; amount: bigint; coin: string | null; blockNumber: bigint; blockTime: Date },
  log: (line: string) => void = console.log,
): Promise<{ destination: 'round' | 'safe'; roundKey: string | null; inserted: boolean }> {
  return sql().begin(async (tx) => {
    // A deposit already booked is never moved (and never re-read for a rollover).
    const [booked] = await tx<{ round_key: string | null; destination: 'round' | 'safe' }[]>`
      SELECT round_key, destination FROM bonus_ledger WHERE tx_hash = ${lower(dep.txHash)} AND log_index = ${dep.logIndex}`;
    if (booked) return { destination: booked.destination, roundKey: booked.round_key, inserted: false };
    let roundKey: string | null = null;
    let reason = 'no ClaimedRewards from its locker after it in the transaction';
    if (dep.coin) {
      const [p] = await tx<(BonusProgram & { project: number; repo_key: string | null })[]>`
        SELECT g.id, g.starts_at, g.ends_at, g.status, g.builder_bonus, g.campaign, p.id AS project, p.token_repo_key AS repo_key
        FROM projects p JOIN programs g ON g.id = p.program_id
        WHERE p.coin_address = ${dep.coin}`;
      if (!p) reason = `${dep.coin} is not an EarnKit coin`;
      else {
        const b = bookingFor(p, dep.blockTime);
        let over = rollsOver(p, dep.blockTime);
        if (b.destination === 'safe') reason = `${p.id}: ${b.reason}`;
        else {
          const state = await lockRound(tx, p.id, b.round);
          if (state === 'open') roundKey = b.round.key;
          else {
            reason = `round ${b.round.key} is ${state}`;
            over = true;
          }
        }
        if (!roundKey && over) {
          roundKey = await rolloverRound(tx, { project: p.project, program: p.id, repoKey: p.repo_key }, dep.blockTime);
          if (!roundKey) reason += '; no open entry of its repo to roll over to';
        }
      }
    }
    const destination = roundKey ? 'round' : 'safe';
    const inserted = await tx`
      INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_number, block_time)
      VALUES (${lower(dep.txHash)}, ${dep.logIndex}, ${dep.coin}, ${roundKey}, ${destination}, ${dep.amount.toString()},
        ${dep.blockNumber.toString()}, ${dep.blockTime})
      ON CONFLICT DO NOTHING RETURNING tx_hash`;
    if (inserted.length > 0 && destination === 'safe')
      log(`[bonus] ${dep.txHash}:${dep.logIndex} (${dep.amount} wei) booked to the Safe: ${reason}`);
    return { destination, roundKey, inserted: inserted.length > 0 };
  });
}

class OutOfTime extends Error {}

/**
 * Reads `from..to` oldest first in ranges of at most `chunk` blocks (2,000 to start), calling
 * `onRange(lo, hi)`, which reads and books the range completely, then moves the cursor past it.
 * The v2.2 adaptive getLogs rules (escrow.ts): a range the RPC refuses as too large is retried
 * smaller (the size it names, or half; never below LOG_CHUNK_MIN); a rate limit is retried after
 * 250 ms, 1 s and 3 s, then the run stops (`rateLimited`); other errors are thrown. At most
 * `maxCalls` calls; stops at the deadline. Returns the next block to read.
 */
export async function scanForward(a: {
  from: bigint;
  to: bigint;
  chunk?: bigint;
  maxCalls?: number;
  deadline?: number;
  onRange: (lo: bigint, hi: bigint) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ next: bigint; rateLimited?: true; outOfTime?: true }> {
  const sleep = a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let chunk = a.chunk ?? LOG_CHUNK;
  let backoffs = 0;
  let lo = a.from;
  for (let calls = 0; lo <= a.to && calls < (a.maxCalls ?? LOG_CALLS_PER_RUN); calls++) {
    if (Date.now() >= (a.deadline ?? Infinity)) return { next: lo, outOfTime: true };
    const hi = lo + chunk - 1n < a.to ? lo + chunk - 1n : a.to;
    try {
      await a.onRange(lo, hi);
    } catch (err) {
      if (err instanceof OutOfTime) return { next: lo, outOfTime: true };
      const kind = logError(err);
      if (kind?.kind === 'rate') {
        if (backoffs === RATE_BACKOFF_MS.length) return { next: lo, rateLimited: true };
        await sleep(RATE_BACKOFF_MS[backoffs++]);
        continue;
      }
      const size = hi - lo + 1n;
      if (kind?.kind !== 'range' || size <= LOG_CHUNK_MIN) throw err;
      const smaller = kind.limit !== null && kind.limit < size ? kind.limit : size / 2n;
      chunk = smaller > LOG_CHUNK_MIN ? smaller : LOG_CHUNK_MIN;
      continue;
    }
    lo = hi + 1n;
  }
  return { next: lo };
}

/**
 * Step 1: indexes the bonus wallet's WETH deposits from the cursor up to CONFIRMATIONS behind the
 * head and books each (`bookDeposit`). A range is read and booked completely before the cursor
 * moves past it, so a crash or the deadline only repeats work (booking is idempotent). A
 * transaction whose deposits are all booked already isn't read again.
 */
export async function indexDeposits(wallet: Hex, d: BonusDeps & { rpc: BonusRpc; chain: BonusChain }) {
  const log = d.log ?? console.log;
  const head = (await d.rpc.blockNumber()) - CONFIRMATIONS;
  const cursor = await indexedThrough();
  const envStart = process.env.BONUS_INDEX_START_BLOCK?.trim();
  // task-10-review M8: read only while there is no cursor; digits only, else 2 days back (said once).
  if (!cursor && !d.startBlock && envStart && !/^\d+$/.test(envStart))
    log(`[bonus] BONUS_INDEX_START_BLOCK isn't a block number (digits only); indexing from ${FIRST_LOOKBACK} blocks back`);
  const from = cursor
    ? cursor.block + 1n
    : (d.startBlock ?? (envStart && /^\d+$/.test(envStart) ? BigInt(envStart) : head > FIRST_LOOKBACK ? head - FIRST_LOOKBACK : 0n));
  const counts = { round: 0, safe: 0 };
  let receipts = 0;
  if (from > head) return { from, to: head, next: from, ...counts };
  const times = new Map<bigint, Date>();
  const time = async (b: bigint) => {
    if (!times.has(b)) times.set(b, await d.rpc.blockTime(b));
    return times.get(b)!;
  };
  const scan = await scanForward({
    from,
    to: head,
    maxCalls: d.maxCalls,
    deadline: toDeadline(d),
    sleep: d.sleep,
    onRange: async (lo, hi) => {
      const found = await d.rpc.storeLogs(lo, hi, wallet);
      const byTx = new Map<string, number[]>();
      for (const l of found) byTx.set(lower(l.txHash), [...(byTx.get(lower(l.txHash)) ?? []), l.logIndex]);
      const booked = byTx.size
        ? await sql()<{ tx_hash: string; log_index: number }[]>`
            SELECT tx_hash, log_index FROM bonus_ledger WHERE tx_hash IN ${sql()([...byTx.keys()])}`
        : [];
      const done = new Set(booked.map((b) => `${b.tx_hash}:${b.log_index}`));
      for (const [hash, indexes] of byTx) {
        if (indexes.every((i) => done.has(`${hash}:${i}`))) continue;
        if (Date.now() >= toDeadline(d) || receipts >= (d.maxReceipts ?? RECEIPTS_PER_RUN)) throw new OutOfTime();
        receipts++;
        const receipt = await d.rpc.receiptLogs(hash as Hex);
        const deposits = bonusDeposits(receipt.logs, wallet, d.chain);
        // Every deposit getLogs found must be in its receipt, or the cursor would pass unbooked money.
        const seen = new Set(deposits.map((x) => x.logIndex));
        if (!indexes.every((i) => seen.has(i))) throw new Error(`StoreTokens logs of ${hash} are missing from its receipt`);
        const at = await time(receipt.blockNumber);
        for (const dep of deposits) {
          const r = await bookDeposit({ txHash: hash, ...dep, blockNumber: receipt.blockNumber, blockTime: at }, log);
          if (r.inserted) counts[r.destination]++;
        }
      }
      const hiTime = await time(hi).catch(() => null);
      await sql()`
        INSERT INTO bonus_cursor (id, block, block_time) VALUES (${CURSOR}, ${hi.toString()}, ${hiTime})
        ON CONFLICT (id) DO UPDATE SET block = EXCLUDED.block, block_time = EXCLUDED.block_time, updated_at = now()
        WHERE bonus_cursor.block IS NULL OR bonus_cursor.block < EXCLUDED.block`;
    },
  });
  return { from, to: head, next: scan.next, ...counts, receipts, ...(scan.rateLimited && { rateLimited: true }), ...(scan.outOfTime && { outOfTime: true }) };
}

/** The payout wallet can't pay gas (as payout.ts judges it). Pure. */
const outOfGas = (err: unknown) =>
  /insufficient funds|exceeds the balance of the account/i.test(err instanceof Error ? `${err.name} ${err.message}` : String(err));

export { openStoredSends };

/**
 * Before the ledger signs anything new: every open stored send is broadcast again (the same
 * bytes; 'known' and 'stale' are fine, its own follower settles it). False when one can't be sent
 * (the RPC failed): then nothing new is signed this run, so no new call can take its nonce.
 */
export async function settleStoredSends(account: LocalAccount, rpc: BonusRpc) {
  for (const o of await openStoredSends(account)) {
    try {
      await rpc.broadcast(o.raw);
    } catch (err) {
      console.error('[bonus] rebroadcast of a stored send failed', err);
      return false;
    }
  }
  return true;
}

/**
 * Signs and sends one contract call from the payout wallet and waits for it (until the deadline,
 * 5 to 60 s). Used for claims and collects: anyone may call them, they pay a fixed recipient, and a
 * duplicate only costs gas (the ledger's lease keeps runs from overlapping). `floor` (I5): the
 * run's nonce floor; never signed below it, raised past this nonce once the node accepts it.
 */
export async function sendCall(
  account: LocalAccount,
  rpc: BonusRpc,
  to: Hex,
  data: Hex,
  gas: bigint,
  deadline: number,
  floor: { next: number } = { next: 0 },
) {
  const [chainId, pending, fees, open] = await Promise.all([
    rpc.getChainId(),
    rpc.nonce(account.address),
    rpc.fees(),
    openStoredSends(account),
  ]);
  // Never at or below the nonce of a stored transfer that isn't mined yet (fix round 1, I2), nor
  // below one this run already sent (I5: the RPC's pending count may not have seen it yet).
  const nonce = Math.max(pending, floor.next, ...open.map((o) => o.nonce + 1));
  const raw = await account.signTransaction({
    chainId,
    type: 'eip1559',
    to,
    data,
    nonce,
    gas: (gas * 15n) / 10n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  const hash = keccak256(raw);
  if ((await rpc.broadcast(raw)) === 'stale') throw new Error('nonce too low');
  floor.next = Math.max(floor.next, nonce + 1);
  const r = await rpc.waitFor(hash, Math.max(5_000, Math.min(60_000, deadline - Date.now())));
  return { hash, status: r?.status ?? ('pending' as const) };
}

/**
 * Whether Base Blockscout lists a transfer of `coin` at or after `since` (its newest first). An
 * explorer failure counts as active: collecting costs a little gas; skipping could leave a round's
 * fees out of its pool.
 */
async function tradedSince(coin: Hex, since: Date, deadline: number) {
  try {
    const page = await blockscout<{ items?: { timestamp?: string }[] }>(`/api/v2/tokens/${coin}/transfers`, deadline);
    const newest = page.items?.[0]?.timestamp;
    return Boolean(newest && new Date(newest) >= since);
  } catch (err) {
    console.error('[bonus] transfers of', coin, err);
    return true;
  }
}

/**
 * Step 2 (Ruling 5): EarnKit sends `collectRewards(coin)` itself only for an EarnKit coin whose
 * program's round ends within COLLECT_WINDOW_MS, and only when no deposit from it was booked, and
 * EarnKit didn't collect it, in the last COLLECT_QUIET_MS. The locker is the first that simulates
 * cleanly (tokens.fun `pickLocker`); a coin whose split doesn't pay the bonus wallet (launched
 * before the v2.5 split) is skipped. Its deposits are booked by the next index run. One coin's
 * failure never stops the others.
 */
export async function collectNearEnd(account: LocalAccount, d: BonusDeps & { rpc: BonusRpc; chain: BonusChain }) {
  const now = d.now ?? new Date();
  const quiet = new Date(now.getTime() - COLLECT_QUIET_MS);
  const coins = await sql()<
    { project: number; coin: Hex; id: string; starts_at: Date | null; ends_at: Date | null; status: string; builder_bonus: boolean | null; campaign: unknown }[]
  >`
    SELECT p.id AS project, p.coin_address AS coin, g.id, g.starts_at, g.ends_at, g.status, g.builder_bonus, g.campaign
    FROM projects p JOIN programs g ON g.id = p.program_id
    WHERE p.coin_address IS NOT NULL AND p.token_status = 'launched'
      AND (p.coin_collected_at IS NULL OR p.coin_collected_at < ${quiet})
      AND NOT EXISTS (SELECT 1 FROM bonus_ledger l WHERE l.coin = p.coin_address AND l.block_time >= ${quiet})
    ORDER BY p.id`;
  const out: { coin: string; result: string }[] = [];
  const active = d.active ?? ((coin: Hex, since: Date) => tradedSince(coin, since, toDeadline(d)));
  for (const c of coins) {
    const b = bookingFor(c, now);
    if (b.destination !== 'round' || b.round.ends.getTime() - now.getTime() > COLLECT_WINDOW_MS) continue;
    if (Date.now() >= toDeadline(d)) break;
    try {
      // Only a coin that traded in the last 24 h has new fees worth the gas (fix round 1, a).
      if (!(await active(c.coin, new Date(now.getTime() - COLLECT_WINDOW_MS)))) {
        out.push({ coin: c.coin, result: 'no transfers in 24 h' });
        continue;
      }
      let locker: Hex | null = null;
      // A transport error throws here (before the coin is stamped): 'failed', retried next run.
      for (const l of d.chain.lockers) if (await d.rpc.canCollect(l, c.coin, account.address)) { locker = l; break; }
      // Recorded before sending: a crash or a revert waits COLLECT_QUIET_MS instead of resending hourly.
      await sql()`UPDATE projects SET coin_collected_at = ${now} WHERE id = ${c.project}`;
      if (!locker) {
        out.push({ coin: c.coin, result: 'no locker accepts it' });
        continue;
      }
      if (!(await d.rpc.rewardRecipients(locker, c.coin)).includes(lower(account.address))) {
        out.push({ coin: c.coin, result: 'its fees do not pay the bonus wallet' });
        continue;
      }
      const data = encodeFunctionData({ abi: LOCKER_ABI, functionName: 'collectRewards', args: [c.coin] });
      const gas = await d.rpc.estimateGas({ account: account.address, to: locker, data });
      const sent = await sendCall(account, d.rpc, locker, data, gas, toDeadline(d), d.nonces);
      out.push({ coin: c.coin, result: `collect ${sent.status} ${sent.hash}` });
    } catch (err) {
      console.error('[bonus] collect', c.coin, err);
      out.push({ coin: c.coin, result: outOfGas(err) ? 'the payout wallet needs ETH for gas' : 'failed' });
    }
  }
  return out;
}

/**
 * Step 3: `claim(bonus wallet, WETH)`, then `claim(Safe, WETH)` on the FeeLocker (anyone may call
 * it; it always pays the fee owner), each only when its available WETH is at least 10× the
 * estimated gas cost, or (the bonus wallet's, M10) when the sweep to the Safe waits on it.
 */
export async function claimFees(account: LocalAccount, d: BonusDeps & { rpc: BonusRpc; chain: BonusChain }) {
  const out: { owner: string; result: string }[] = [];
  for (const owner of [lower(account.address) as Hex, d.chain.safe]) {
    if (Date.now() >= toDeadline(d)) break;
    try {
      const available = await d.rpc.availableFees(owner, d.chain.weth);
      if (available === 0n) {
        out.push({ owner, result: 'nothing to claim' });
        continue;
      }
      const data = encodeFunctionData({ abi: FEE_LOCKER_ABI, functionName: 'claim', args: [owner, d.chain.weth] });
      const [gas, fees] = await Promise.all([d.rpc.estimateGas({ account: account.address, to: d.chain.feeLocker, data }), d.rpc.fees()]);
      // M10: the bonus wallet's claim is also worth it when it unblocks a sweep worth 10x gas
      // (the Safe's own deposits sit unclaimed behind a small balance).
      const unblocks = () => owner !== d.chain.safe && sweepWaitsOnClaim(account, d, gas, fees.maxFeePerGas);
      if (!worthIt(available, gas, fees.maxFeePerGas) && !(await unblocks())) {
        out.push({ owner, result: `${available} wei: under 10x gas` });
        continue;
      }
      const sent = await sendCall(account, d.rpc, d.chain.feeLocker, data, gas, toDeadline(d), d.nonces);
      out.push({ owner, result: `claim ${sent.status} ${sent.hash}` });
    } catch (err) {
      console.error('[bonus] claim', owner, err);
      out.push({ owner, result: outOfGas(err) ? 'the payout wallet needs ETH for gas' : 'failed' });
    }
  }
  return out;
}

/**
 * Whether the sweep waits on the bonus wallet's claim (M10): the WETH booked to the Safe and not
 * swept is worth 10x `gas` at `maxFeePerGas`, and the wallet holds too little to send it without
 * leaving a round short (roundsCovered).
 */
async function sweepWaitsOnClaim(account: LocalAccount, d: BonusDeps & { rpc: BonusRpc; chain: BonusChain }, gas: bigint, maxFeePerGas: bigint) {
  const [{ wei }] = await sql()<{ wei: string | null }[]>`
    SELECT sum(amount_wei)::text AS wei FROM bonus_ledger WHERE destination = 'safe' AND swept_tx IS NULL`;
  const amount = BigInt(wei ?? '0');
  if (!worthIt(amount, gas, maxFeePerGas)) return false;
  const balance = await d.rpc.balanceOf(d.chain.weth, account.address);
  return balance < amount || !(await roundsCovered(account, d, amount, balance));
}

type SweepRow = {
  id: number;
  amount_wei: string;
  to_wallet: string;
  status: 'sending' | 'paid' | null;
  tx_hash: string | null;
  raw_tx: string | null;
  stale_at: Date | null;
  reverts: number;
};

/**
 * The v2.4 PayoutStore over bonus_sweeps, so a sweep is paid by `payWinner`: the transfer is signed
 * and stored ('sending') before it is broadcast, a crash rebroadcasts the same bytes, a revert
 * clears it for a new signature of the same reserved amount, and 'paid' marks every reserved
 * ledger row swept with the transfer's hash.
 */
export const sweepStore: PayoutStore = {
  sending: async (id, hash, raw) =>
    (
      await sql()`
        UPDATE bonus_sweeps SET status = 'sending', tx_hash = ${hash}, raw_tx = ${raw}, stale_at = NULL
        WHERE id = ${id} AND tx_hash IS NULL RETURNING id`
    ).length > 0,
  paid: async (id) => {
    await sql().begin(async (tx) => {
      const [s] = await tx<{ tx_hash: string }[]>`
        UPDATE bonus_sweeps SET status = 'paid', paid_at = now(), stale_at = NULL WHERE id = ${id} RETURNING tx_hash`;
      await tx`UPDATE bonus_ledger SET swept_tx = ${s.tx_hash} WHERE sweep_id = ${id}`;
    });
  },
  failed: async (id, reverted) => {
    const [r] = await sql()<{ reverts: number }[]>`
      UPDATE bonus_sweeps SET status = NULL, tx_hash = NULL, raw_tx = NULL, stale_at = NULL,
        reverts = reverts + ${reverted ? 1 : 0}
      WHERE id = ${id} AND status = 'sending' RETURNING reverts`;
    return r?.reverts ?? 0;
  },
  refused: async () => {},
  stale: async (id, at) => {
    await sql()`
      UPDATE bonus_sweeps SET stale_at = ${at === null ? null : sql()`COALESCE(stale_at, ${at})`}
      WHERE id = ${id} AND status = 'sending'`;
  },
};

/**
 * Step 4: sends the WETH booked to the Safe and not yet swept from the bonus wallet to the Safe.
 * An unfinished sweep is followed first (to paid, or re-signed after a revert). Otherwise, when
 * the unswept total is at least 10× the transfer's gas and the wallet holds it, the rows are
 * reserved for a new sweep (one transaction), which `payWinner` then signs, stores and sends.
 */
/**
 * Whether sending `amount` from the wallet leaves every unpaid round covered (fix round 1, I1):
 * wallet − amount ≥ Σ(unpaid round money) − (what the FeeLocker still holds for the wallet that
 * can be round money). Of `availableFees(bonus wallet)`, up to the unswept Safe bookings may be the
 * Safe's own unclaimed deposits, so only the rest counts toward the rounds. Unpaid round money
 * (Task 7): the bookings of every round not yet 'paid' or 'empty' (an empty round's bookings are
 * the Safe's), less what those rounds' winners were already paid.
 */
export async function roundsCovered(account: LocalAccount, d: { rpc: BonusRpc; chain: BonusChain }, amount: bigint, balance: bigint) {
  const [{ rounds, paid, safe }] = await sql()<{ rounds: string | null; paid: string | null; safe: string | null }[]>`
    SELECT
      (SELECT sum(l.amount_wei) FROM bonus_ledger l JOIN bonus_rounds r ON r.round_key = l.round_key
        WHERE l.destination = 'round' AND r.state NOT IN ('paid', 'empty'))::text AS rounds,
      (SELECT sum(p.amount_wei) FROM bonus_payouts p JOIN bonus_rounds r ON r.round_key = p.round_key
        WHERE p.status = 'paid' AND r.state NOT IN ('paid', 'empty'))::text AS paid,
      (SELECT sum(amount_wei) FROM bonus_ledger WHERE destination = 'safe' AND swept_tx IS NULL)::text AS safe`;
  const available = await d.rpc.availableFees(account.address, d.chain.weth);
  const forRounds = available > BigInt(safe ?? '0') ? available - BigInt(safe ?? '0') : 0n;
  return balance - amount >= BigInt(rounds ?? '0') - BigInt(paid ?? '0') - forRounds;
}
const SHORT = 'would leave a round short (its WETH is not all claimed yet)';

export async function sweepToSafe(account: LocalAccount, d: BonusDeps & { rpc: BonusRpc; chain: BonusChain }) {
  let [open] = await sql()<SweepRow[]>`SELECT * FROM bonus_sweeps WHERE status IS DISTINCT FROM 'paid' ORDER BY id LIMIT 1`;
  if (!open) {
    const [{ wei }] = await sql()<{ wei: string | null }[]>`
      SELECT sum(amount_wei)::text AS wei FROM bonus_ledger WHERE destination = 'safe' AND sweep_id IS NULL`;
    const amount = BigInt(wei ?? '0');
    if (amount === 0n) return { result: 'nothing to sweep' };
    // Balance first: estimating a transfer of more than the wallet holds reverts.
    const balance = await d.rpc.balanceOf(d.chain.weth, account.address);
    if (balance < amount) return { result: `${amount} wei to sweep; the wallet holds ${balance} (waiting for a claim)` };
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [d.chain.safe, amount] });
    const [gas, fees] = await Promise.all([d.rpc.estimateGas({ account: account.address, to: d.chain.weth, data }), d.rpc.fees()]);
    if (!worthIt(amount, gas, fees.maxFeePerGas)) return { result: `${amount} wei: under 10x gas` };
    if (!(await roundsCovered(account, d, amount, balance))) return { result: `${amount} wei to sweep ${SHORT}` };
    if (Date.now() >= toDeadline(d)) return { result: 'out of time; next run' };
    open = await sql().begin(async (tx) => {
      const [s] = await tx<{ id: number }[]>`
        INSERT INTO bonus_sweeps (amount_wei, to_wallet) VALUES (${amount.toString()}, ${d.chain.safe}) RETURNING id`;
      const rows = await tx<{ amount_wei: string }[]>`
        UPDATE bonus_ledger SET sweep_id = ${s.id}
        WHERE destination = 'safe' AND sweep_id IS NULL RETURNING amount_wei`;
      const reserved = rows.reduce((t, r) => t + BigInt(r.amount_wei), 0n);
      const [row] = await tx<SweepRow[]>`UPDATE bonus_sweeps SET amount_wei = ${reserved.toString()} WHERE id = ${s.id} RETURNING *`;
      return row;
    });
  }
  // A reserved sweep with no signed transfer yet (new, or cleared after a revert) is signed only
  // while the wallet holds its amount.
  if (!open.tx_hash) {
    const balance = await d.rpc.balanceOf(d.chain.weth, account.address);
    if (balance < BigInt(open.amount_wei))
      return { result: `sweep ${open.id} of ${open.amount_wei} wei waits; the wallet holds ${balance}`, sweep: open.id };
    if (!(await roundsCovered(account, d, BigInt(open.amount_wei), balance)))
      return { result: `sweep ${open.id} of ${open.amount_wei} wei ${SHORT}`, sweep: open.id };
  }
  const row: PayoutRow = {
    id: open.id,
    payout_wallet: open.to_wallet,
    payout_status: open.status,
    prize_tx: open.tx_hash,
    prize_raw_tx: open.raw_tx,
    payout_reverts: open.reverts,
    payout_stale_at: open.stale_at,
  };
  const otherPaid = (
    await sql()<{ raw_tx: string }[]>`SELECT raw_tx FROM bonus_sweeps WHERE status = 'paid' AND raw_tx IS NOT NULL AND id <> ${open.id}`
  ).map((r) => r.raw_tx);
  // A new signature never takes the nonce of another stored, unmined send (fix round 1, I2), nor
  // one this run already sent (I5: the run's shared floor).
  const others = (await openStoredSends(account)).filter((o) => o.raw !== open.raw_tx);
  const nonces = d.nonces ?? { next: 0 };
  nonces.next = Math.max(nonces.next, ...others.map((o) => o.nonce + 1));
  try {
    const r = await payWinner(row, {
      nonces,
      token: d.chain.weth,
      amount: BigInt(open.amount_wei),
      amountText: open.amount_wei,
      account,
      rpc: d.rpc,
      store: sweepStore,
      deadline: d.deadline,
      now: d.now,
      otherPaid,
    });
    return { result: r === 'manual' ? MANUAL_CHECK : `sweep ${open.id} ${r}`, sweep: open.id, status: r };
  } catch (err) {
    if (!outOfGas(err)) throw err;
    return { result: 'the payout wallet needs ETH for gas' };
  }
}

/** Index steps failing in a row (reset by one that completes); stored on the cursor row. */
async function countIndexRun(ok: boolean) {
  const [r] = await sql()<{ index_failures: number }[]>`
    INSERT INTO bonus_cursor (id, block, index_failures) VALUES (${CURSOR}, NULL, ${ok ? 0 : 1})
    ON CONFLICT (id) DO UPDATE SET index_failures = ${ok ? 0 : sql()`bonus_cursor.index_failures + 1`}
    RETURNING index_failures`;
  return r.index_failures;
}

/**
 * The cron step: index, collect, claim, the rounds (`deps.rounds`), sweep, under one lease (a concurrent run gets 'busy').
 * Skipped without a usable CAMPAIGN_PAYOUT_PRIVATE_KEY (missing, or malformed: `problem`) or off
 * Base mainnet; the cron escalates a skip once the bonus can earn (Ruling 20). One step's failure
 * never stops the next; its cause stays in the server log.
 */
export async function runBonusLedger(deps: BonusDeps = {}) {
  let account: LocalAccount | null;
  try {
    account = deps.account === undefined ? payoutAccount(deps.env) : deps.account;
  } catch (err) {
    // Ruling 19: a malformed key is reported like a missing one (the cron escalates it), never a
    // silent step error. The key itself is never logged.
    console.error('[bonus] CAMPAIGN_PAYOUT_PRIVATE_KEY is malformed:', err instanceof Error ? err.message : 'unreadable');
    return { skipped: NO_PAYOUT_KEY, problem: 'malformed' as const };
  }
  if (!account) return { skipped: NO_PAYOUT_KEY };
  const rpc = deps.rpc ?? bonusRpc();
  const chain = deps.chain ?? BASE_BONUS;
  if ((await rpc.getChainId()) !== BASE_MAINNET) return { skipped: NOT_MAINNET };
  const d = { ...deps, rpc, chain, nonces: deps.nonces ?? { next: 0 } };
  // The lease outlives the run's deadline (as the cron's campaign leases do), so calls never overlap.
  const leaseMs = Number.isFinite(toDeadline(d)) ? Math.max(60_000, toDeadline(d) - Date.now() + 60_000) : 10 * 60_000;
  const r = await withScoringLock('bonus-ledger', async () => {
    const out: Record<string, unknown> = {};
    const step = async (name: string, fn: () => Promise<unknown>) => {
      try {
        out[name] = await fn();
      } catch (err) {
        console.error('[bonus]', name, err);
        out[name] = 'failed';
      }
    };
    await step('index', () => indexDeposits(account.address, d));
    out.index_failures = await countIndexRun(out.index !== 'failed');
    // I5: one nonce floor for the run, seeded once from the stored, unmined sends.
    d.nonces.next = Math.max(d.nonces.next, ...(await openStoredSends(account)).map((o) => o.nonce + 1));
    // Stored sends first, so a new claim or collect never takes their nonce (fix round 1, I2).
    if (await settleStoredSends(account, rpc)) {
      await step('collect', () => collectNearEnd(account, d));
      await step('claim', () => claimFees(account, d));
    } else out.claim = out.collect = 'waiting on a stored send';
    // Task 7: rounds freeze, review and pay after the claims (claimed round WETH is there to pay)
    // and before the sweep (which never takes unpaid round money: roundsCovered).
    // Fix round 1 (a): with a stored send not rebroadcast, the rounds only follow transfers in flight.
    const settled = out.claim !== 'waiting on a stored send';
    if (deps.rounds) await step('rounds', () => deps.rounds!(account, { ...d, followOnly: !settled }));
    await step('sweep', () => sweepToSafe(account, d));
    return out;
  }, leaseMs);
  return r === 'busy' ? { skipped: 'busy' } : r;
}
