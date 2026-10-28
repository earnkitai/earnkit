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
import type { LocalAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { sql } from './db';
import { LOG_CHUNK, LOG_CHUNK_MIN, RATE_BACKOFF_MS, logError } from './escrow';
import {
  MANUAL_CHECK,
  NOT_MAINNET,
  NO_PAYOUT_KEY,
  TOP_UP,
  openStoredSends,
  payWinner,
  payoutAccount,
  payoutRpc,
  type PayoutRow,
  type PayoutRpc,
  type PayoutStore,
} from './payout';
import { GAS_WALLET_MIN_WEI_DEFAULT, MINI_FEE_RECIPIENT, isEarnkitSplit } from './policy-constants';
import { BASE_MAINNET } from './sanctions';
import { withScoringLock } from './scoring-lock';

/**
 * The fee ledger (v2.5 §3, Ruling 5; v2.14: no builder bonus). The payout wallet
 * (CAMPAIGN_PAYOUT_PRIVATE_KEY) is the old bonus wallet: a v2.5-split EarnKit coin's 2000 bps slot
 * pays it, in WETH, through Clanker's FeeLocker. tokens.fun's own cron already calls
 * `collectRewards(coin)` for every coin. Hourly:
 * 1. index: reads the FeeLocker's StoreTokens logs for (bonus wallet, WETH) from a stored block
 *    cursor, attributes each deposit to its coin (from the same transaction's receipt) and books it
 *    to the Safe;
 * 2. claim: `claim(bonus wallet, WETH)` and `claim(Safe, WETH)` when worth ≥ 10× their gas;
 * 3. sweep: sends the WETH booked to the Safe, not yet swept, from the bonus wallet to the Safe when
 *    worth ≥ 10× its gas (the v2.4 idempotent payout: signed and stored before it is broadcast).
 * 4. claim_others (v2.9 D16): after the sweep, in at most OTHERS_CLAIM_MS, `claim(owner, WETH)` for
 *    MINI and each EarnKit token's creator when worth ≥ 10× its gas; the FeeLocker always pays the owner.
 * 5. the Safe index (v2.13.2): the Safe's own deposits from EarnKit coins, for /api/stats.
 * v2.13: coins launched after tokens.fun's split change have no bonus slot (Safe 50, creator 40,
 * MINI 10), so their fees reach the Safe by its own claim.
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
/** v3 Stage 2 (earned.ts): the FeeLocker pays a claim to its owner (tokens.fun lib/fees/abi.ts, Clanker v4 on Base). */
export const CLAIM_TOKENS = parseAbiItem('event ClaimTokens(address indexed feeOwner, address indexed token, uint256 amountClaimed)');
/** v3 Stage 2 (backers.ts): the ERC-20 Transfer event. */
export const ERC20_TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
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
  /** v2.9 D16: the locker's `tokenRewards(coin)` split (recipients lowercase); empty when the locker doesn't know the coin. */
  rewardInfo: (locker: Hex, coin: Hex) => Promise<{ recipients: string[]; bps: number[] }>;
  /** v2.9 D17: the ETH balance of `address` (wei). */
  ethBalance: (address: Hex) => Promise<bigint>;
  /**
   * v2.13.2 (2): in `from..to`, the FeeLocker's StoreTokens logs with feeOwner = `owner` and token = WETH,
   * each with its transaction and block. Absent: indexSafeFees is skipped.
   */
  safeStoreLogs?: (from: bigint, to: bigint, owner: Hex) => Promise<TxLog[]>;
  /**
   * v2.13.2 review 1a: every locker's ClaimedRewards log in `from..to` (what attributes a deposit to its
   * coin, bonusDeposits; never filtered by coin, since attribution needs every claim in the tx). Read
   * only across the blocks of a range's Safe deposits.
   */
  claimLogs?: (from: bigint, to: bigint) => Promise<TxLog[]>;
  /** v3 Stage 2 (backers.ts): `token`'s ERC-20 Transfer logs in `from..to`. Absent: indexBackers is skipped. */
  transferLogs?: (token: Hex, from: bigint, to: bigint) => Promise<TxLog[]>;
  /** v3 Stage 2 (backers.ts): the hook of `coin`'s pool (its locker's tokenRewards poolKey), lowercase; null when no locker knows it. */
  poolHooks?: (coin: Hex) => Promise<string | null>;
  /** v3 Stage 2 (earned.ts): the FeeLocker's ClaimTokens logs with feeOwner = `owner` and token = WETH. Absent: indexCreatorFees is skipped. */
  claimTokenLogs?: (owner: Hex, from: bigint, to: bigint) => Promise<TxLog[]>;
};
/** v2.13.2: a raw log with its transaction and block. */
export type TxLog = RawLog & { txHash: Hex; blockNumber: bigint };

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

/** A viem log as a TxLog. */
const txLog = (l: { address: string; topics: readonly string[]; data: string; logIndex: number | null; transactionHash: Hex | null; blockNumber: bigint | null }): TxLog => ({
  address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex!, txHash: l.transactionHash!, blockNumber: l.blockNumber!,
});

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
    rewardInfo: async (locker, coin) => {
      const r = await c.readContract({ address: locker, abi: LOCKER_ABI, functionName: 'tokenRewards', args: [coin] });
      return { recipients: r.rewardRecipients.map(lower), bps: r.rewardBps.map(Number) };
    },
    ethBalance: (address) => c.getBalance({ address }),
    safeStoreLogs: async (fromBlock, toBlock, owner) =>
      (await c.getLogs({ address: chain.feeLocker, event: STORE_TOKENS, args: { feeOwner: owner, token: chain.weth }, fromBlock, toBlock })).map(txLog),
    claimLogs: async (fromBlock, toBlock) => (await c.getLogs({ address: chain.lockers, event: CLAIMED_REWARDS, fromBlock, toBlock })).map(txLog),
    transferLogs: async (token, fromBlock, toBlock) => (await c.getLogs({ address: token, event: ERC20_TRANSFER, fromBlock, toBlock })).map(txLog),
    poolHooks: async (coin) => {
      for (const locker of chain.lockers) {
        // A locker that doesn't know the coin returns an empty split or reverts; a transport error throws.
        const r = await c.readContract({ address: locker, abi: LOCKER_ABI, functionName: 'tokenRewards', args: [coin] }).catch((err: unknown) => {
          if (isRevert(err)) return null;
          throw err;
        });
        if (r && r.rewardRecipients.length > 0) return lower(r.poolKey.hooks);
      }
      return null;
    },
    claimTokenLogs: async (owner, fromBlock, toBlock) =>
      (await c.getLogs({ address: chain.feeLocker, event: CLAIM_TOKENS, args: { feeOwner: owner, token: chain.weth }, fromBlock, toBlock })).map(txLog),
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
  /** v2.9: the creator and MINI claim step's time slice, ms (default OTHERS_CLAIM_MS). */
  othersMs?: number;
  /** Receipt reads per run (default RECEIPTS_PER_RUN). */
  maxReceipts?: number;
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

const CURSOR = 'weth';
const toDeadline = (d: BonusDeps) => d.deadline ?? Infinity;

/** Where the index has read up to: the last block read and its time (null: never). For the round freeze. */
export async function indexedThrough(): Promise<{ block: bigint; time: Date | null } | null> {
  const [r] = await sql()<{ block: string | null; block_time: Date | null }[]>`SELECT block, block_time FROM bonus_cursor WHERE id = ${CURSOR}`;
  return r?.block != null ? { block: BigInt(r.block), time: r.block_time } : null;
}

/**
 * Books one deposit, idempotently on (tx_hash, log_index), to the Safe (v2.14: there is no builder
 * bonus, so every deposit is the Safe's), logged with why. A deposit already booked is never moved.
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
    let reason = 'no ClaimedRewards from its locker after it in the transaction';
    if (dep.coin) {
      const [p] = await tx<{ id: string }[]>`
        SELECT g.id FROM projects p JOIN programs g ON g.id = p.program_id WHERE p.coin_address = ${dep.coin}`;
      reason = p ? `${p.id}: builder bonus off` : `${dep.coin} is not an EarnKit token`;
    }
    const inserted = await tx`
      INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_number, block_time)
      VALUES (${lower(dep.txHash)}, ${dep.logIndex}, ${dep.coin}, NULL, 'safe', ${dep.amount.toString()},
        ${dep.blockNumber.toString()}, ${dep.blockTime})
      ON CONFLICT DO NOTHING RETURNING tx_hash`;
    if (inserted.length === 0) {
      // T5 fix round 1 (Minor 9): a concurrent run booked it first: answer the stored booking.
      const [stored] = await tx<{ round_key: string | null; destination: 'round' | 'safe' }[]>`
        SELECT round_key, destination FROM bonus_ledger WHERE tx_hash = ${lower(dep.txHash)} AND log_index = ${dep.logIndex}`;
      return { destination: stored.destination, roundKey: stored.round_key, inserted: false };
    }
    log(`[bonus] ${dep.txHash}:${dep.logIndex} (${dep.amount} wei) booked to the Safe: ${reason}`);
    return { destination: 'safe', roundKey: null, inserted: true };
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

/** v2.13.2 (2): the Safe index's own cursor in bonus_cursor (the bonus index's is CURSOR). */
const SAFE_CURSOR = 'safe';

/**
 * v2.13.2 (2): indexes the Safe's own WETH deposits from EarnKit coins (both splits: v2.5's 4-slot coins'
 * 30% and v2.13's 3-slot coins' 50%) into `safe_fees`, from its cursor up to CONFIRMATIONS behind the
 * head, so /api/stats counts the Safe's real share (stats.ts). A deposit is attributed to its coin as
 * the bonus index does (bonusDeposits, over the range's StoreTokens and ClaimedRewards logs: no receipt
 * reads); a deposit from a coin EarnKit didn't launch (any other tokens.fun coin) is never stored.
 * Booking is idempotent on (tx_hash, log_index); a range is booked completely before the cursor passes
 * it. With no cursor: `d.startBlock`, else SAFE_INDEX_START_BLOCK, else BONUS_INDEX_START_BLOCK, else
 * FIRST_LOOKBACK blocks back. Run by runBonusLedger, through safeIndexStep.
 */
export async function indexSafeFees(d: BonusDeps & { rpc: BonusRpc; chain: BonusChain }) {
  const readStores = d.rpc.safeStoreLogs;
  const readClaims = d.rpc.claimLogs;
  if (!readStores || !readClaims) return { skipped: 'no reader' as const };
  const head = (await d.rpc.blockNumber()) - CONFIRMATIONS;
  const [cur] = await sql()<{ block: string | null }[]>`SELECT block::text AS block FROM bonus_cursor WHERE id = ${SAFE_CURSOR}`;
  const env = [process.env.SAFE_INDEX_START_BLOCK, process.env.BONUS_INDEX_START_BLOCK].map((v) => v?.trim()).find((v) => v && /^\d+$/.test(v));
  const from = cur?.block != null
    ? BigInt(cur.block) + 1n
    : (d.startBlock ?? (env ? BigInt(env) : head > FIRST_LOOKBACK ? head - FIRST_LOOKBACK : 0n));
  let booked = 0;
  if (from > head) return { from, to: head, next: from, booked };
  const safe = lower(d.chain.safe) as Hex;
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
      // Review 1a: the Safe's deposits first; the claims only when there are some, only across their blocks.
      const stores = await readStores(lo, hi, safe);
      const byTx = new Map<string, { block: bigint; logs: RawLog[] }>();
      const add = (l: TxLog) => {
        const t = byTx.get(lower(l.txHash));
        if (t) t.logs.push({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex });
      };
      for (const l of stores) if (!byTx.has(lower(l.txHash))) byTx.set(lower(l.txHash), { block: l.blockNumber, logs: [] });
      stores.forEach(add);
      if (stores.length) {
        const blocks = stores.map((l) => l.blockNumber);
        const min = blocks.reduce((a, b) => (b < a ? b : a));
        const max = blocks.reduce((a, b) => (b > a ? b : a));
        (await readClaims(min, max)).forEach(add);
      }
      const found = [...byTx].flatMap(([hash, t]) => bonusDeposits(t.logs, safe, d.chain).map((x) => ({ hash, block: t.block, ...x })));
      const coins = [...new Set(found.map((x) => x.coin).filter((c): c is string => c !== null))];
      const ours = coins.length
        ? new Set((await sql()<{ coin: string }[]>`SELECT lower(coin_address) AS coin FROM projects WHERE lower(coin_address) IN ${sql()(coins)}`).map((r) => r.coin))
        : new Set<string>();
      for (const x of found) {
        if (!x.coin || !ours.has(x.coin)) continue;
        const at = await time(x.block);
        const ins = await sql()`
          INSERT INTO safe_fees (tx_hash, log_index, coin, amount_wei, block_number, block_time)
          VALUES (${x.hash}, ${x.logIndex}, ${x.coin}, ${x.amount.toString()}, ${x.block.toString()}, ${at})
          ON CONFLICT DO NOTHING RETURNING 1`;
        booked += ins.length;
      }
      await sql()`
        INSERT INTO bonus_cursor (id, block) VALUES (${SAFE_CURSOR}, ${hi.toString()})
        ON CONFLICT (id) DO UPDATE SET block = EXCLUDED.block, updated_at = now()
        WHERE bonus_cursor.block IS NULL OR bonus_cursor.block < EXCLUDED.block`;
    },
  });
  return { from, to: head, next: scan.next, booked, ...(scan.rateLimited && { rateLimited: true }), ...(scan.outOfTime && { outOfTime: true }) };
}

/** v2.13.2 review 1b: the Safe index's own time slice per run, ms (never the money steps' time). */
export const SAFE_INDEX_MS = 30_000;
/** v2.13.2 review 1b: the Safe index's ranges per run (each one or two getLogs). */
export const SAFE_INDEX_CALLS_PER_RUN = 10;

/**
 * v2.13.2 review 1b, M3: the ledger's last step (after claim_others): indexSafeFees within its own slice
 * (SAFE_INDEX_MS, `safeIndexMs`, never past the run's deadline) and SAFE_INDEX_CALLS_PER_RUN ranges;
 * failures in a row are counted on the 'safe' cursor row (`safe_index_failures`), and
 * INDEX_FAILED_RUNS of them make the cron wait on the owner (cron.ts bonusWaitsOnOwner), as the bonus index.
 */
export async function safeIndexStep(d: BonusDeps & { rpc: BonusRpc; chain: BonusChain; safeIndexMs?: number }) {
  let safe_index: unknown;
  let ok = true;
  try {
    safe_index = await indexSafeFees({ ...d, deadline: Math.min(toDeadline(d), Date.now() + (d.safeIndexMs ?? SAFE_INDEX_MS)), maxCalls: SAFE_INDEX_CALLS_PER_RUN });
  } catch (err) {
    console.error('[bonus] safe_index', err);
    safe_index = 'failed';
    ok = false;
  }
  // A DB hiccup counting the run never throws out of the ledger.
  const safe_index_failures = await countIndexRun(ok, SAFE_CURSOR).catch((err: unknown) => {
    console.error('[bonus] safe_index count', err instanceof Error ? err.name : 'error');
    return null;
  });
  return { safe_index, safe_index_failures };
}

/** A claim's or collect's result when the payout wallet can't pay its gas (the cron waits on the owner). */
export const NEEDS_GAS = 'the payout wallet needs ETH for gas';
/** v2.9 D17: the gas check's note when the payout wallet holds less than gasMinWei() ETH. */
export const GAS_LOW = (address: string) => `The payout wallet ${address} is low on ETH for gas. ${TOP_UP}`;

let gasMinWarned = false;
/** v2.9 D17: GAS_WALLET_MIN_WEI (wei), else 0.002 ETH. A malformed value is the default, logged once (never the value). */
export const gasMinWei = (env: Record<string, string | undefined> = process.env): bigint => {
  const v = env.GAS_WALLET_MIN_WEI?.trim();
  if (!v) return GAS_WALLET_MIN_WEI_DEFAULT;
  if (/^\d+$/.test(v)) return BigInt(v);
  if (!gasMinWarned) console.error('[bonus] GAS_WALLET_MIN_WEI is not a whole number of wei; using the default (0.002 ETH)');
  gasMinWarned = true;
  return GAS_WALLET_MIN_WEI_DEFAULT;
};

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

/** v2.9 D16: who a claim pays. */
export type ClaimRole = 'bonus' | 'safe' | 'creator' | 'mini';

/** v2.9 D16: every recipient EarnKit claims for, once each, in a fixed order (bonus wallet, Safe, creators, MINI). Pure. */
export function claimOwners(a: { bonus: Hex; safe: Hex; creators: (Hex | null)[]; mini: Hex | null }) {
  const out: { owner: Hex; role: ClaimRole }[] = [];
  const seen = new Set<string>();
  const add = (owner: Hex | null, role: ClaimRole) => {
    if (!owner || seen.has(owner.toLowerCase())) return;
    seen.add(owner.toLowerCase());
    out.push({ owner: owner.toLowerCase() as Hex, role });
  };
  add(a.bonus, 'bonus');
  add(a.safe, 'safe');
  for (const c of a.creators) add(c, 'creator');
  add(a.mini, 'mini');
  return out;
}

type FeeRecipients = { creator: Hex | null; mini: Hex | null };
/** Locker reads of uncached recipients per run; the rest wait for the next run. */
export const RECIPIENT_READS_PER_RUN = 20;

/**
 * v2.9 D16: a token's creator (slot 1) and MINI (slot 2) fee recipients, from the first locker that
 * knows it, cached on `projects.fee_recipients` only when its split is one of EarnKit's
 * (EARNKIT_SPLITS_BPS: Safe, creator, MINI, then v2.5's bonus wallet; v2.13 coins have no bonus slot,
 * their former share goes to the Safe). A failed read (an RPC error, or no locker knows
 * the coin): the creator unknown, MINI the policy.ts fallback (Ruling 17), nothing cached, so the
 * next run reads again; the coin is added to `d.unread` (claimFees logs them once per run).
 */
export async function feeRecipients(coin: Hex, d: { rpc: BonusRpc; chain: BonusChain; unread?: Hex[] }): Promise<FeeRecipients> {
  try {
    for (const locker of d.chain.lockers) {
      // A locker that doesn't know the coin returns an empty split (Base's lockers) or reverts; a
      // transport error throws, so the read fails and is retried next run.
      const { recipients, bps } = await d.rpc.rewardInfo(locker, coin).catch((err: unknown) => {
        if (isRevert(err)) return { recipients: [] as string[], bps: [] as number[] };
        throw err;
      });
      if (recipients.length === 0) continue;
      // Only EarnKit's splits (v2.5's 4 slots, v2.13's 3) say which slot is whose, read from the
      // coin's own split, never guessed from its launch date; any other split is unread (never cached).
      if (!isEarnkitSplit(bps)) {
        console.error('[bonus] fee recipients of', coin, 'not read: its split is', bps.join('/'), 'not EarnKit\'s');
        break;
      }
      // v4 tokens (Safe 60 / creator 40) have no MINI slot.
      const r: FeeRecipients = { creator: recipients[1] as Hex, mini: (recipients[2] as Hex | undefined) ?? null };
      // A failed cache write keeps the good read (it is read again next run).
      await sql()`UPDATE projects SET fee_recipients = ${sql().json(r)} WHERE coin_address = ${lower(coin)}`.catch((err: unknown) =>
        console.error('[bonus] fee recipients cache of', coin, err),
      );
      return r;
    }
  } catch (err) {
    console.error('[bonus] fee recipients of', coin, err);
  }
  d.unread?.push(coin);
  return { creator: null, mini: lower(MINI_FEE_RECIPIENT) as Hex };
}

/** v2.9 fix round 1: the creator and MINI claim step's share of a run (after the sweep), at most. */
export const OTHERS_CLAIM_MS = 20_000;

/**
 * One `claim(owner, WETH)` on the FeeLocker (anyone may call it; it always pays the owner) when its
 * available WETH is at least 10× the estimated gas cost, or `force()` says so (M10). D18: a claim
 * that mined successfully is logged in `fee_claims` (an ops log, never revenue); `gas_wei` is the
 * estimated gas times maxFeePerGas (the signed gas limit is 1.5× the estimate).
 */
async function claimOne(
  account: LocalAccount,
  d: BonusDeps & { rpc: BonusRpc; chain: BonusChain },
  owner: Hex,
  role: ClaimRole,
  deadline: number,
  force?: (gas: bigint, maxFeePerGas: bigint) => Promise<boolean>,
) {
  try {
    const available = await d.rpc.availableFees(owner, d.chain.weth);
    if (available === 0n) return { owner, role, result: 'nothing to claim' };
    const data = encodeFunctionData({ abi: FEE_LOCKER_ABI, functionName: 'claim', args: [owner, d.chain.weth] });
    const [gas, fees] = await Promise.all([d.rpc.estimateGas({ account: account.address, to: d.chain.feeLocker, data }), d.rpc.fees()]);
    if (!worthIt(available, gas, fees.maxFeePerGas) && !(force && (await force(gas, fees.maxFeePerGas))))
      return { owner, role, result: `${available} wei: under 10x gas` };
    const sent = await sendCall(account, d.rpc, d.chain.feeLocker, data, gas, deadline, d.nonces);
    // Only a mined success claimed the WETH; a failed log write never turns the claim into a failure.
    if (sent.status === 'success')
      await sql()`
        INSERT INTO fee_claims (tx_hash, owner, role, weth, gas_wei)
        VALUES (${sent.hash}, ${owner}, ${role}, ${available.toString()}, ${(gas * fees.maxFeePerGas).toString()})
        ON CONFLICT DO NOTHING`.catch((err: unknown) => console.error('[bonus] fee_claims insert', sent.hash, err));
    return { owner, role, result: `claim ${sent.status} ${sent.hash}` };
  } catch (err) {
    console.error('[bonus] claim', owner, err);
    return { owner, role, result: outOfGas(err) ? NEEDS_GAS : 'failed' };
  }
}

/**
 * Step 3: EarnKit's own claims, `claim(bonus wallet, WETH)` then `claim(Safe, WETH)`, each only when
 * its available WETH is at least 10× the estimated gas cost, or (the bonus wallet's, M10) when the
 * sweep to the Safe waits on it. No recipient read runs before them (v2.9 fix round 1): creators and
 * MINI are claimed by claimForOthers, after the sweep.
 */
export async function claimFees(account: LocalAccount, d: BonusDeps & { rpc: BonusRpc; chain: BonusChain }) {
  const out: { owner: string; role: ClaimRole; result: string }[] = [];
  const owners = claimOwners({ bonus: lower(account.address) as Hex, safe: d.chain.safe, creators: [], mini: null });
  for (const { owner, role } of owners) {
    if (Date.now() >= toDeadline(d)) break;
    // M10: the bonus wallet's claim is also worth it when it unblocks a sweep worth 10x gas
    // (the Safe's own deposits sit unclaimed behind a small balance).
    const force = role === 'bonus' ? (gas: bigint, fee: bigint) => sweepWaitsOnClaim(account, d, gas, fee) : undefined;
    out.push(await claimOne(account, d, owner, role, toDeadline(d), force));
  }
  return out;
}

/**
 * Step 5 (v2.9 D16, fix round 1): `claim(owner, WETH)` for MINI and each launched EarnKit token's
 * creator (test installations' too: their fees are real; v4: and each launched builder token's wallet), after the rounds and the sweep, within at
 * most OTHERS_CLAIM_MS (`othersMs`) of the run, so it never takes time from EarnKit's own payouts.
 * The FeeLocker always pays the owner, so EarnKit never holds the creator's or MINI's money; each
 * claim needs 10× its gas. Recipients: cached, else read (feeRecipients, at most
 * RECIPIENT_READS_PER_RUN), newest tokens first; MINI goes first, then the creators newest first.
 * What the slice doesn't reach is 'next run'. An owner that is also the bonus wallet or the Safe is
 * claimed by claimFees (claimOwners: the first role wins).
 */
export async function claimForOthers(account: LocalAccount, d: BonusDeps & { rpc: BonusRpc; chain: BonusChain }) {
  const deadline = Math.min(toDeadline(d), Date.now() + (d.othersMs ?? OTHERS_CLAIM_MS));
  const tokens = await sql()<{ coin: Hex; fee_recipients: FeeRecipients | null }[]>`
    SELECT coin_address AS coin, fee_recipients FROM projects
    WHERE coin_address IS NOT NULL AND token_status = 'launched' ORDER BY id DESC`;
  const known: FeeRecipients[] = [];
  const unread: Hex[] = [];
  let reads = 0;
  for (const t of tokens) {
    if (t.fee_recipients) known.push(t.fee_recipients);
    else if (reads < RECIPIENT_READS_PER_RUN && Date.now() < deadline) {
      reads++;
      known.push(await feeRecipients(t.coin, { ...d, unread }));
    }
  }
  // v4 fix round 1: each launched builder token's creator is its builder's proven wallet (the creatorWallet it was
  // launched with), so it is known without a locker read; newest first, after the project tokens' creators.
  const builders = await sql()<{ wallet: Hex }[]>`
    SELECT wallet FROM builder_tokens
    WHERE status = 'launched' AND coin_address IS NOT NULL AND wallet IS NOT NULL ORDER BY created_at DESC, builder_id DESC`;
  for (const b of builders) known.push({ creator: b.wallet, mini: null });
  if (unread.length > 0)
    (d.log ?? console.error)(`[bonus] fee recipients unread for ${unread.length} token(s) (${unread.join(', ')}); no creator claim for them, MINI falls back to policy.ts`);
  // v4 (2026-10-28): MINI's 10% ended; EarnKit no longer claims for MINI (the creators only).
  const all = claimOwners({ bonus: lower(account.address) as Hex, safe: d.chain.safe, creators: known.map((r) => r.creator), mini: null });
  const others = [...all.filter((o) => o.role === 'mini'), ...all.filter((o) => o.role === 'creator')];
  const out: { owner: string; role: ClaimRole; result: string }[] = [];
  for (const { owner, role } of others) {
    if (Date.now() >= deadline) out.push({ owner, role, result: 'next run' });
    else out.push(await claimOne(account, d, owner, role, deadline));
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
  return balance < amount;
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
    // v2.9 D17: TOP_UP makes it wait on the owner (needsOwner), as a payout short of gas does.
    return { result: `${NEEDS_GAS}. ${TOP_UP}` };
  }
}

/** Index steps failing in a row (reset by one that completes); stored on the cursor row. */
async function countIndexRun(ok: boolean, id: string = CURSOR) {
  const [r] = await sql()<{ index_failures: number }[]>`
    INSERT INTO bonus_cursor (id, block, index_failures) VALUES (${id}, NULL, ${ok ? 0 : 1})
    ON CONFLICT (id) DO UPDATE SET index_failures = ${ok ? 0 : sql()`bonus_cursor.index_failures + 1`}
    RETURNING index_failures`;
  return r.index_failures;
}

/**
 * The cron step: index, claim, sweep, the creator and MINI claims, the Safe index, then (v3 Stage 2) the backers and creator
 * fees indexes, under one lease (a concurrent run gets 'busy').
 * v2.9 D17: first the payout wallet's ETH balance (`gas`; under gasMinWei() it is `low`, which the cron escalates).
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
  // v2.9 D17: the payout wallet's gas, read before any step; a failed read never blocks the run.
  let gas: { balance_wei?: string; low: boolean; note?: string };
  try {
    const balance = await rpc.ethBalance(account.address);
    const low = balance < gasMinWei(deps.env);
    gas = { balance_wei: balance.toString(), low, ...(low && { note: GAS_LOW(account.address) }) };
  } catch (err) {
    console.error('[bonus] gas balance', err);
    gas = { low: false, note: 'unread' };
  }
  // The lease outlives the run's deadline (as the cron's campaign leases do), so calls never overlap.
  const leaseMs = Number.isFinite(toDeadline(d)) ? Math.max(60_000, toDeadline(d) - Date.now() + 60_000) : 10 * 60_000;
  const r = await withScoringLock('bonus-ledger', async () => {
    const out: Record<string, unknown> = { gas };
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
    if (await settleStoredSends(account, rpc)) await step('claim', () => claimFees(account, d));
    else out.claim = 'waiting on a stored send';
    const settled = out.claim !== 'waiting on a stored send';
    await step('sweep', () => sweepToSafe(account, d));
    // v2.9 D16 (fix round 1): creator and MINI claims last, in their own bounded slice, so they
    // never take time from the sweep; only when no stored send waits.
    if (settled) await step('claim_others', () => claimForOthers(account, d));
    else out.claim_others = 'waiting on a stored send';
    // v2.13.2 (2), review 1c: the Safe's own deposits from EarnKit coins (both splits), for /api/stats,
    // last, in its own slice, so the money steps always run first.
    Object.assign(out, await safeIndexStep(d));
    // v3 Stage 2: the backers and the creator fees claimed (backers.ts, earned.ts), each in its own slice
    // (INDEXER_MS, never past the run's deadline), after the money steps; each fails soft per coin.
    const { indexBackers, INDEXER_MS } = await import('./backers');
    const { indexCreatorFees } = await import('./earned');
    const slice = () => Math.min(toDeadline(d), Date.now() + INDEXER_MS);
    const now = d.now ?? new Date();
    await step('backers_index', () => indexBackers(now, { rpc, chain, deadline: slice(), sleep: d.sleep }));
    await step('creator_fees_index', () => indexCreatorFees(now, { rpc, chain, deadline: slice(), sleep: d.sleep }));
    return out;
  }, leaseMs);
  return r === 'busy' ? { skipped: 'busy' } : r;
}
