import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CallExecutionError, ExecutionRevertedError, HttpRequestError, decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, keccak256, parseTransaction, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  BASE_BONUS,
  CLAIMED_REWARDS,
  CONFIRMATIONS,
  FEE_LOCKER_ABI,
  STORE_TOKENS,
  bonusDeposits,
  bookDeposit,
  GAS_LOW,
  OTHERS_CLAIM_MS,
  claimFees,
  claimForOthers,
  claimOwners,
  feeRecipients,
  gasMinWei,
  indexDeposits,
  indexedThrough,
  isRevert,
  runBonusLedger,
  scanForward,
  sweepToSafe,
  worthIt,
  type BonusDeps,
  type BonusRpc,
  type RawLog,
} from './bonus-ledger';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';
import { deployToken } from './tokens';
import { BONUS_WALLET_UNSET, cronPost, runCron } from './cron';
import { TOP_UP, needsOwner } from './payout';
import { FEE_SPLIT_BPS, FEE_SPLIT_BPS_V213, GAS_WALLET_MIN_WEI_DEFAULT, MINI_FEE_RECIPIENT } from './policy';
import { EARNKIT_SPLITS_BPS, EARNKIT_SPLIT_BPS } from './policy-constants';

const C = BASE_BONUS;
const [NEW_LOCKER, OLD_LOCKER] = C.lockers;
const ACCOUNT = privateKeyToAccount(`0x${'4'.repeat(64)}`);
const BONUS = ACCOUNT.address.toLowerCase() as Hex;
const CREATOR = '0x1111111111111111111111111111111111111111';
const MINI = '0x2222222222222222222222222222222222222222';
const OTHER_TOKEN = '0x3333333333333333333333333333333333333333';
const COIN_A = '0xaaaa00000000000000000000000000000000000a';
const COIN_B = '0xbbbb00000000000000000000000000000000000b';

const store = (logIndex: number, owner: string, amount: bigint, o: { sender?: string; token?: string; address?: string } = {}): RawLog => ({
  address: o.address ?? C.feeLocker,
  topics: encodeEventTopics({
    abi: [STORE_TOKENS],
    eventName: 'StoreTokens',
    args: { sender: (o.sender ?? NEW_LOCKER) as Hex, feeOwner: owner as Hex, token: (o.token ?? C.weth) as Hex },
  }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [123456789n, amount]),
  logIndex,
});
const claimed = (logIndex: number, coin: string, locker: string = NEW_LOCKER): RawLog => ({
  address: locker,
  topics: encodeEventTopics({ abi: [CLAIMED_REWARDS], eventName: 'ClaimedRewards', args: { token: coin as Hex } }) as Hex[],
  data: encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256[]' }, { type: 'uint256[]' }],
    [0n, 0n, [], []],
  ),
  logIndex,
});

// ---- pure ----

test('bonusDeposits: only the bonus wallet WETH deposits from the FeeLocker, with the amount (not the balance)', () => {
  const logs = [
    store(1, C.safe, 3000n),
    store(2, CREATOR, 4000n),
    store(3, MINI, 1000n),
    store(4, BONUS, 2000n),
    store(5, BONUS, 77n, { token: OTHER_TOKEN }), // a non-WETH bucket
    store(6, BONUS, 999n, { address: '0x9999999999999999999999999999999999999999' }), // same topic, not the FeeLocker
    claimed(7, COIN_A),
  ];
  assert.deepEqual(bonusDeposits(logs, ACCOUNT.address), [{ logIndex: 4, amount: 2000n, locker: NEW_LOCKER, coin: COIN_A }]);
});

test('bonusDeposits on a real Base receipt (tokens.fun fixture): topic order, amounts, and the coin from the NEXT ClaimedRewards', () => {
  const fx = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'clanker-base-launch.json'), 'utf8')) as { logs: RawLog[] };
  // Slot 1 of this coin (a pre-v2.5 3-slot coin) stands in for the bonus wallet.
  const deps = bonusDeposits(fx.logs, '0x799a390464fa551a1d6e9f9e9fa94fd9737462f9');
  assert.deepEqual(deps.map((x) => x.logIndex), [141, 154]);
  assert.equal(deps[0].amount + deps[1].amount, 6080318486494776n, "tokens.fun's verified slot-1 sum");
  for (const x of deps) {
    assert.equal(x.coin, '0xb1eb360e83e46f2768c58a508d972ed55d7132be');
    assert.equal(x.locker, OLD_LOCKER);
  }
  // Every deposit precedes its ClaimedRewards (log 158): a "preceding ClaimedRewards" rule finds none.
  assert.ok(deps.every((x) => x.logIndex < 158));
  assert.equal(bonusDeposits(fx.logs, C.safe).length, 2);
});

test('bonusDeposits: two coins collected in one transaction are each attributed to their own ClaimedRewards', () => {
  const logs = [
    store(10, C.safe, 30n),
    store(11, BONUS, 20n),
    claimed(12, COIN_A),
    store(13, C.safe, 300n),
    store(14, BONUS, 200n),
    claimed(15, COIN_B),
  ];
  assert.deepEqual(
    bonusDeposits(logs, BONUS).map((x) => [x.logIndex, x.coin]),
    [[11, COIN_A], [14, COIN_B]],
  );
  // Two lockers interleaved: a deposit belongs to its own locker's next ClaimedRewards.
  const mixed = [store(1, BONUS, 5n, { sender: OLD_LOCKER }), store(2, BONUS, 6n), claimed(3, COIN_B), claimed(4, COIN_A, OLD_LOCKER)];
  assert.deepEqual(bonusDeposits(mixed, BONUS).map((x) => [x.logIndex, x.coin]), [[1, COIN_A], [2, COIN_B]]);
  // Unsorted input is sorted by log index first.
  assert.deepEqual(bonusDeposits([...logs].reverse(), BONUS).map((x) => x.coin), [COIN_A, COIN_B]);
});

test('bonusDeposits: no later ClaimedRewards from its locker, or an unknown sender, gives no coin', () => {
  assert.deepEqual(bonusDeposits([claimed(1, COIN_A), store(2, BONUS, 9n)], BONUS), [
    { logIndex: 2, amount: 9n, locker: NEW_LOCKER, coin: null },
  ]);
  assert.equal(bonusDeposits([store(1, BONUS, 9n, { sender: CREATOR }), claimed(2, COIN_A)], BONUS)[0].coin, null);
  assert.equal(bonusDeposits([store(1, BONUS, 9n, { sender: OLD_LOCKER }), claimed(2, COIN_A)], BONUS)[0].coin, null, 'other locker');
});

test('worthIt: at least 10x the gas cost', () => {
  assert.equal(worthIt(10n * 50_000n * 7n, 50_000n, 7n), true);
  assert.equal(worthIt(10n * 50_000n * 7n - 1n, 50_000n, 7n), false);
});

test('scanForward: oldest first in 2,000-block ranges; shrinks on a range error; backs off on a rate limit; stops at maxCalls', async () => {
  const ranges: [bigint, bigint][] = [];
  let refused = false;
  let limited = 0;
  const r = await scanForward({
    from: 100n,
    to: 4_099n,
    sleep: async () => {},
    onRange: async (lo, hi) => {
      if (!refused && hi - lo + 1n > 1_000n) {
        refused = true;
        throw new Error('eth_getLogs is limited to a 1,000 range');
      }
      if (lo === 1_100n && limited++ < 1) throw Object.assign(new Error('Too many requests'), { status: 429 });
      ranges.push([lo, hi]);
    },
  });
  assert.equal(r.next, 4_100n);
  assert.deepEqual(ranges, [[100n, 1_099n], [1_100n, 2_099n], [2_100n, 3_099n], [3_100n, 4_099n]]);
  const capped = await scanForward({ from: 0n, to: 10_000n, maxCalls: 2, onRange: async () => {} });
  assert.equal(capped.next, 4_000n);
  await assert.rejects(scanForward({ from: 0n, to: 10n, onRange: async () => { throw new Error('boom'); } }), /boom/);
});

// ---- DB-gated, against a fake chain ----

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
holdBonusDbLock();

type Tx = { hash: Hex; block: bigint; logs: RawLog[] };
/** An in-memory chain: receipts by block, StoreTokens filtered like getLogs' indexed topics, and sends. */
function fakeChain(o: { head?: bigint; available?: Record<string, bigint>; balance?: bigint; gas?: bigint; maxFee?: bigint } = {}) {
  const txs: Tx[] = [];
  const state = {
    head: o.head ?? 10_000n,
    available: { ...(o.available ?? {}) } as Record<string, bigint>,
    balance: o.balance ?? 0n,
    sent: [] as Hex[],
    mined: new Map<Hex, 'success' | 'reverted'>(),
    getLogsCalls: [] as [bigint, bigint][],
    receiptReads: 0,
    broadcastFails: 0,
    autoMine: true,
    recipients: [BONUS] as string[],
    collectable: new Set<string>([`${NEW_LOCKER}:${COIN_A}`]),
    // v2.9 D16: tokenRewards by `${locker}:${coin}` (a locker that doesn't know the coin: empty, as on Base).
    rewards: Object.fromEntries(
      [COIN_A, COIN_B].map((coin) => [`${NEW_LOCKER}:${coin}`, { recipients: [C.safe, CREATOR, MINI, BONUS], bps: [3000, 4000, 1000, 2000] }]),
    ) as Record<string, { recipients: string[]; bps: number[] }>,
    rewardReads: 0,
    /** The coins whose recipients were read (other test files' launched rows may be read too). */
    rewardReadCoins: [] as string[],
    rewardFails: false,
    /** v2.9 fix round 1: availableFees takes this long for an owner (a slow RPC). */
    slowMs: {} as Record<string, number>,
    eth: 10n ** 18n,
    ethFails: false,
  };
  const gas = o.gas ?? 50_000n;
  const maxFee = o.maxFee ?? 1_000_000n; // 0.001 gwei: Base-like
  const rpc: BonusRpc = {
    getChainId: async () => 8453,
    nonce: async () => state.sent.length,
    finalizedNonce: async () => state.sent.length,
    fees: async () => ({ maxFeePerGas: maxFee, maxPriorityFeePerGas: 1n }),
    estimateGas: async () => gas,
    receipt: async (h) => (state.mined.has(h) ? { status: state.mined.get(h)! } : null),
    transaction: async (h) => state.sent.some((r) => keccak256(r) === h),
    finalReceipt: async () => true,
    broadcast: async (raw) => {
      if (state.broadcastFails > 0) {
        state.broadcastFails--;
        throw new Error('connection reset');
      }
      if (state.sent.includes(raw)) return 'known';
      state.sent.push(raw);
      if (state.autoMine) state.mined.set(keccak256(raw), 'success');
      return 'sent';
    },
    waitFor: async (h) => (state.mined.has(h) ? { status: state.mined.get(h)! } : null),
    balanceOf: async () => state.balance,
    blockNumber: async () => state.head,
    storeLogs: async (lo, hi, owner) => {
      state.getLogsCalls.push([lo, hi]);
      return txs
        .filter((t) => t.block >= lo && t.block <= hi)
        .flatMap((t) =>
          bonusDeposits(t.logs, owner).map((x) => ({ txHash: t.hash, logIndex: x.logIndex, blockNumber: t.block })),
        );
    },
    receiptLogs: async (h) => {
      state.receiptReads++;
      const t = txs.find((x) => x.hash === h)!;
      return { blockNumber: t.block, logs: t.logs };
    },
    blockTime: async (b) => new Date(Date.UTC(2026, 9, 1) + Number(b) * 60_000), // one block a minute from Oct 1
    availableFees: async (owner) => {
      const ms = state.slowMs[owner.toLowerCase()];
      if (ms) await new Promise((r) => setTimeout(r, ms));
      return state.available[owner.toLowerCase()] ?? 0n;
    },
    canCollect: async (locker, coin) => state.collectable.has(`${locker.toLowerCase()}:${coin.toLowerCase()}`),
    rewardRecipients: async () => state.recipients,
    rewardInfo: async (locker, coin) => {
      state.rewardReads++;
      state.rewardReadCoins.push(coin.toLowerCase());
      if (state.rewardFails) throw new Error('rpc down');
      return state.rewards[`${locker.toLowerCase()}:${coin.toLowerCase()}`] ?? { recipients: [], bps: [] };
    },
    ethBalance: async () => {
      if (state.ethFails) throw new Error('rpc down');
      return state.eth;
    },
  };
  let n = 0;
  const add = (block: bigint, logs: RawLog[]) => {
    const hash = keccak256(`0x${(++n).toString(16).padStart(4, '0')}${block.toString(16).padStart(8, '0')}` as Hex);
    txs.push({ hash, block, logs });
    return hash;
  };
  return { rpc, state, add, timeOf: (b: bigint) => new Date(Date.UTC(2026, 9, 1) + Number(b) * 60_000) };
}

const PROG = 't4-ledger-prog';
/** The program's round (Ruling 21): keyed by its window's UTC start day. */
const ROUND = `${PROG}:2026-10-01`;
const PROG_NOPROOF = 't4-ledger-noproof';
async function setup(ends = new Date('2026-10-08T00:00:00Z')) {
  await cleanup();
  // v2.6 Ruling 7: every program has the bonus by default; PROG_NOPROOF opts out (builder_bonus
  // = false), standing in for the old "no submission_proof" case so its coin still books to the Safe.
  for (const [id, builderBonus] of [[PROG, true], [PROG_NOPROOF, false]] as const)
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
        status, existing_work, starts_at, ends_at, builder_bonus)
      VALUES (${id}, 'X', ${id}, 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed',
        '2026-10-01T00:00:00Z', ${ends}, ${builderBonus})`;
  await sql()`
    INSERT INTO projects (program_id, name, token_status, coin_address)
    VALUES (${PROG}, 't4 a', 'launched', ${COIN_A}), (${PROG_NOPROOF}, 't4 b', 'launched', ${COIN_B})`;
}
async function cleanup() {
  // Also any row another bonus test file left holding these coins (coin_address is unique).
  await sql()`DELETE FROM bonus_ledger WHERE coin IN (${COIN_A}, ${COIN_B})`;
  await sql()`UPDATE projects SET coin_address = NULL WHERE coin_address IN (${COIN_A}, ${COIN_B})`;
  await sql()`DELETE FROM bonus_ledger WHERE round_key LIKE 't4-ledger%' OR coin IN (${COIN_A}, ${COIN_B}) OR coin IS NULL OR coin LIKE '0xdead%'`;
  await sql()`DELETE FROM bonus_rounds WHERE program_id LIKE 't4-ledger%'`;
  await sql()`DELETE FROM bonus_sweeps`;
  await sql()`DELETE FROM bonus_cursor`;
  await sql()`DELETE FROM projects WHERE program_id LIKE 't4-ledger%'`;
  await sql()`DELETE FROM programs WHERE id LIKE 't4-ledger%'`;
  await sql()`DELETE FROM scoring_leases WHERE program_id = 'bonus-ledger'`;
}
const rows = () =>
  sql()<{ tx_hash: string; log_index: number; coin: string | null; round_key: string | null; destination: string; amount_wei: string; swept_tx: string | null }[]>`
    SELECT tx_hash, log_index, coin, round_key, destination, amount_wei, swept_tx FROM bonus_ledger ORDER BY block_number, log_index`;
const quiet = () => {};

test('index: books every deposit to the Safe (v2.14: no builder bonus); idempotent; resumes from the cursor', db, async () => {
  try {
    await setup();
    const f = fakeChain({ head: 9_000n + CONFIRMATIONS });
    // Block 1000 = Oct 1 16:40 (inside the round); block 12000 would be after it.
    const t1 = f.add(1_000n, [store(1, C.safe, 30n), store(2, BONUS, 20n), claimed(3, COIN_A), store(4, BONUS, 200n), claimed(5, COIN_B)]);
    const t2 = f.add(2_500n, [store(7, BONUS, 5n), claimed(8, '0xdead00000000000000000000000000000000dead')]); // not EarnKit's
    const t3 = f.add(4_200n, [claimed(1, COIN_A), store(2, BONUS, 6n)]); // no later ClaimedRewards
    const t4 = f.add(8_000n, [store(1, BONUS, 40n), claimed(2, COIN_A)]);

    // First run: 2 getLogs calls, so it stops after block 4,099.
    const lines: string[] = [];
    const r1 = await indexDeposits(ACCOUNT.address, { rpc: f.rpc, chain: C, startBlock: 100n, maxCalls: 2, log: (l) => lines.push(l) });
    assert.equal(r1.next, 4_100n);
    assert.deepEqual(await indexedThrough(), { block: 4_099n, time: f.timeOf(4_099n) });
    assert.deepEqual(f.state.getLogsCalls, [[100n, 2_099n], [2_100n, 4_099n]]);
    // Resume: the cursor, not startBlock, decides where it goes on; only up to head - CONFIRMATIONS.
    const r2 = await indexDeposits(ACCOUNT.address, { rpc: f.rpc, chain: C, startBlock: 0n, log: (l) => lines.push(l) });
    assert.equal(r2.from, 4_100n);
    assert.equal(r2.next, 9_001n);
    assert.deepEqual(f.state.getLogsCalls.slice(2), [[4_100n, 6_099n], [6_100n, 8_099n], [8_100n, 9_000n]]);

    const got = (await rows()).map((r) => [r.tx_hash, r.log_index, r.coin, r.round_key, r.destination, r.amount_wei]);
    assert.deepEqual(got, [
      [t1, 2, COIN_A, null, 'safe', '20'],
      [t1, 4, COIN_B, null, 'safe', '200'],
      [t2, 7, '0xdead00000000000000000000000000000000dead', null, 'safe', '5'],
      [t3, 2, null, null, 'safe', '6'],
      [t4, 1, COIN_A, null, 'safe', '40'],
    ]);
    assert.equal(lines.length, 5, 'every Safe booking is logged');
    assert.match(lines.join('\n'), /not an EarnKit coin/);
    assert.match(lines.join('\n'), /no ClaimedRewards/);
    assert.match(lines.join('\n'), /builder bonus off/);
    assert.equal((await sql()`SELECT 1 FROM bonus_rounds WHERE round_key = ${ROUND}`).length, 0, 'no round is made');

    // A rerun from the start books nothing twice and reads no receipt again.
    await sql()`DELETE FROM bonus_cursor`;
    const reads = f.state.receiptReads;
    await indexDeposits(ACCOUNT.address, { rpc: f.rpc, chain: C, startBlock: 0n, log: quiet });
    assert.equal((await rows()).length, 5);
    assert.equal(f.state.receiptReads, reads);
    // Nothing new: no getLogs call.
    const calls = f.state.getLogsCalls.length;
    await indexDeposits(ACCOUNT.address, { rpc: f.rpc, chain: C, log: quiet });
    assert.equal(f.state.getLogsCalls.length, calls);
  } finally {
    await cleanup();
  }
});

test('booking: a deposit goes to the Safe; the same (tx, logIndex) twice is one row', db, async () => {
  try {
    await setup();
    const dep = { txHash: '0xt4booking', logIndex: 3, amount: 10n, coin: COIN_A, blockNumber: 1n };
    assert.deepEqual(await bookDeposit({ ...dep, blockTime: new Date('2026-10-08T00:00:00Z') }, quiet), {
      destination: 'safe',
      roundKey: null,
      inserted: true,
    });
    const again = await bookDeposit({ ...dep, blockTime: new Date('2026-10-02T00:00:00Z') }, quiet);
    assert.equal(again.inserted, false);
    const mine = (await rows()).filter((r) => r.tx_hash === '0xt4booking');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].destination, 'safe', 'the first booking stands');
    // Inside the program's window too (v2.14: no builder bonus round to book to).
    assert.equal((await bookDeposit({ ...dep, logIndex: 4, blockTime: new Date('2026-10-02T00:00:00Z') }, quiet)).destination, 'safe');
  } finally {
    await cleanup();
  }
});

test('claims: nothing below 10x gas; above it, claim(owner, WETH) for the bonus wallet then the Safe', db, async () => {
  try {
    await cleanup();
    const cost = 50_000n * 1_000_000n;
    const f = fakeChain({ available: { [BONUS]: 10n * cost - 1n, [C.safe]: 0n } });
    const below = await claimFees(ACCOUNT, { rpc: f.rpc, chain: C, log: quiet });
    assert.equal(f.state.sent.length, 0, 'no transaction');
    assert.match(below[0].result, /under 10x gas/);
    assert.equal(below[1].result, 'nothing to claim');

    f.state.available[BONUS] = 10n * cost;
    f.state.available[C.safe] = 10n ** 18n;
    const out = await claimFees(ACCOUNT, { rpc: f.rpc, chain: C, log: quiet });
    assert.equal(f.state.sent.length, 2);
    const calls = f.state.sent.map((raw) => {
      const tx = parseTransaction(raw);
      assert.equal(tx.to?.toLowerCase(), C.feeLocker);
      return decodeFunctionData({ abi: FEE_LOCKER_ABI, data: tx.data! }).args!.map((a) => String(a).toLowerCase());
    });
    assert.deepEqual(calls, [[BONUS, C.weth], [C.safe, C.weth]]);
    assert.ok(out.filter((o) => o.owner === BONUS || o.owner === C.safe).every((o) => o.result.startsWith('claim success')));
  } finally {
    await cleanup();
  }
});

test('sweep: only the Safe bookings, once, at >= 10x gas; stored before broadcast; a lost broadcast resends the same bytes', db, async () => {
  try {
    await setup();
    const cost = 50_000n * 1_000_000n;
    const book = (i: number, amount: bigint, coin: string | null, at: string) =>
      bookDeposit({ txHash: `0xt4sweep${i}`, logIndex: 0, amount, coin, blockNumber: BigInt(i), blockTime: new Date(at) }, quiet);
    await book(1, 3n * cost, null, '2026-10-02T00:00:00Z'); // Safe
    await book(2, 2n * cost, COIN_A, '2026-10-02T00:00:00Z'); // v2.14: an EarnKit coin's deposit is the Safe's too
    const f = fakeChain({ balance: 10n ** 18n });

    assert.match((await sweepToSafe(ACCOUNT, { rpc: f.rpc, chain: C })).result, /under 10x gas/);
    assert.equal(f.state.sent.length, 0);
    await book(3, 5n * cost, COIN_A, '2026-10-09T00:00:00Z'); // total now 10x

    // The wallet doesn't hold it yet (unclaimed): wait.
    f.state.balance = 10n * cost - 1n;
    assert.match((await sweepToSafe(ACCOUNT, { rpc: f.rpc, chain: C })).result, /waiting for a claim/);
    f.state.balance = 10n ** 18n;

    // The first broadcast is lost after the transfer was stored: the next run sends the same bytes.
    f.state.broadcastFails = 1;
    await assert.rejects(sweepToSafe(ACCOUNT, { rpc: f.rpc, chain: C }), /connection reset/);
    const [stored] = await sql()<{ status: string; tx_hash: string; raw_tx: string; amount_wei: string }[]>`SELECT * FROM bonus_sweeps`;
    assert.equal(stored.status, 'sending');
    assert.equal(stored.amount_wei, (10n * cost).toString());
    const r = await sweepToSafe(ACCOUNT, { rpc: f.rpc, chain: C });
    assert.equal(r.status, 'paid');
    assert.deepEqual(f.state.sent, [stored.raw_tx], 'one transfer: the stored bytes');
    const tx = parseTransaction(f.state.sent[0] as Hex);
    assert.equal(tx.to?.toLowerCase(), C.weth);
    assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: tx.data! }).args, ['0xc8A889577446153e28D42254B75238Ae31EC7D57', 10n * cost]);

    const swept = (await rows()).filter((x) => x.tx_hash.startsWith('0xt4sweep'));
    assert.deepEqual(swept.map((x) => [x.tx_hash, x.swept_tx]), [
      ['0xt4sweep1', stored.tx_hash],
      ['0xt4sweep2', stored.tx_hash],
      ['0xt4sweep3', stored.tx_hash],
    ]);
    // Idempotent: nothing left, nothing sent.
    assert.equal((await sweepToSafe(ACCOUNT, { rpc: f.rpc, chain: C })).result, 'nothing to sweep');
    assert.equal(f.state.sent.length, 1);
  } finally {
    await cleanup();
  }
});

test('runBonusLedger: skipped without the payout key or off Base mainnet; runs every step under one lease', db, async () => {
  try {
    await setup();
    const f = fakeChain({ head: 1_100n + CONFIRMATIONS });
    f.add(1_050n, [store(1, BONUS, 5n), claimed(2, COIN_A)]);
    assert.deepEqual(await runBonusLedger({ account: null }), { skipped: "The payout wallet isn't set up yet (CAMPAIGN_PAYOUT_PRIVATE_KEY); nothing was sent." });
    const off = { ...f.rpc, getChainId: async () => 84532 };
    assert.match(String((await runBonusLedger({ account: ACCOUNT, rpc: off })).skipped), /not Base mainnet/);
    const r = (await runBonusLedger({ account: ACCOUNT, rpc: f.rpc, startBlock: 1_000n, now: new Date('2026-10-02T00:00:00Z'), log: quiet })) as Record<string, unknown>;
    assert.deepEqual(r.index && { round: (r.index as { round: number }).round, safe: (r.index as { safe: number }).safe }, { round: 0, safe: 1 });
    assert.ok(Array.isArray(r.claim));
    assert.equal(r.collect, undefined, 'v2.14: no collect step (no builder bonus round to fill)');
    // v2.14: the coin's 5 wei is the Safe's, waiting for the claim to reach the wallet.
    assert.match((r.sweep as { result: string }).result, /^5 wei to sweep/);
    // A run already holding the lease: a second call is 'busy' and touches nothing.
    await sql()`INSERT INTO scoring_leases (program_id, until) VALUES ('bonus-ledger', now() + interval '5 minutes')`;
    assert.deepEqual(await runBonusLedger({ account: ACCOUNT, rpc: f.rpc, log: quiet }), { skipped: 'busy' });
    await sql()`DELETE FROM scoring_leases WHERE program_id = 'bonus-ledger'`;
    // A failing step doesn't stop the next one.
    const broken = { ...f.rpc, blockNumber: async () => { throw new Error('rpc down'); } };
    const err = console.error;
    console.error = () => {};
    try {
      const r2 = (await runBonusLedger({ account: ACCOUNT, rpc: broken, now: new Date('2026-10-02T00:00:00Z'), log: quiet })) as Record<string, unknown>;
      assert.equal(r2.index, 'failed');
      assert.match((r2.sweep as { result: string }).result, /^5 wei to sweep/);
    } finally {
      console.error = err;
    }
  } finally {
    await cleanup();
  }
});

test('a confirmed launch stores the coin address (lowercase), which the ledger attributes deposits by', db, async () => {
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  try {
    await setup();
    const [inst] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES ('t4-launch') RETURNING id`;
    const [p] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id, repo_url) VALUES (${PROG}, 't4 launch', ${inst.id}, 'https://github.com/x/t4launch')
      RETURNING id`;
    const coin = '0xAbCdEf0000000000000000000000000000000001';
    const out = await deployToken(
      { projectId: p.id, installationId: inst.id, name: 'T4', symbol: 'TFOUR', creatorWallet: CREATOR, image: null, repoUrl: 'https://github.com/x/t4launch', liveUrl: null },
      { fetch: (async () => Response.json({ success: true, tokenAddress: coin, txHash: '0x1' })) as typeof fetch },
    );
    assert.equal(out.status, 'launched');
    const [row] = await sql()<{ coin_address: string }[]>`SELECT coin_address FROM projects WHERE id = ${p.id}`;
    assert.equal(row.coin_address, coin.toLowerCase());
  } finally {
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
    await cleanup();
    await sql()`DELETE FROM installations WHERE token_hash = 't4-launch'`;
  }
});

test('runCron runs the bonus ledger step (with its deps under `only`) and reports it', db, async () => {
  try {
    await setup();
    const f = fakeChain({ head: 1_100n + CONFIRMATIONS });
    f.add(1_050n, [store(1, BONUS, 5n), claimed(2, COIN_A)]);
    const out = await runCron({
      now: new Date('2026-10-02T00:00:00Z'),
      only: ['t4-ledger-none'],
      deps: { refreshFees: async () => 0, bonus: { account: ACCOUNT, rpc: f.rpc, chain: C, startBlock: 1_000n, log: quiet } },
    });
    assert.equal((out.bonus as { index: { safe: number } }).index.safe, 1);
    assert.deepEqual(out.needs_owner, []);
    const without = await runCron({ now: new Date('2026-10-02T00:00:00Z'), only: ['t4-ledger-none'], deps: { refreshFees: async () => 0 } });
    assert.equal(without.bonus, undefined, 'tests without bonus deps never reach a chain');
  } finally {
    await cleanup();
  }
});

test('I2: a sweep whose broadcast failed in run k keeps its nonce; run k+1 resends it first and signs after it', db, async () => {
  try {
    await setup();
    const cost = 50_000n * 1_000_000n;
    await bookDeposit({ txHash: '0xt4nonce', logIndex: 0, amount: 10n * cost, coin: null, blockNumber: 1n, blockTime: new Date('2026-10-02T00:00:00Z') }, quiet);
    const f = fakeChain({ balance: 10n ** 18n, head: 100n });
    const now = new Date('2026-10-02T00:00:00Z');
    const err = console.error;
    console.error = () => {};
    try {
      // Run k: the sweep is signed and stored, its broadcast fails.
      f.state.broadcastFails = 1;
      const k = (await runBonusLedger({ account: ACCOUNT, rpc: f.rpc, chain: C, startBlock: 0n, now, log: quiet })) as Record<string, unknown>;
      assert.equal(k.sweep, 'failed');
      const [stored] = await sql()<{ raw_tx: Hex }[]>`SELECT raw_tx FROM bonus_sweeps WHERE status = 'sending'`;
      const sweepNonce = parseTransaction(stored.raw_tx).nonce!;

      // Run k+1, the RPC failing again for the rebroadcast: no claim is signed. (The sweep's own
      // follower may resend its stored bytes; nothing new.)
      f.state.available[BONUS] = 10n ** 17n;
      f.state.broadcastFails = 1;
      f.state.autoMine = false; // the sweep stays unmined across runs
      const k1 = (await runBonusLedger({ account: ACCOUNT, rpc: f.rpc, chain: C, now, log: quiet })) as Record<string, unknown>;
      assert.equal(k1.claim, 'waiting on a stored send');
      assert.ok(f.state.sent.every((r) => r === stored.raw_tx), 'only the stored bytes went out');

      // Run k+2, the sweep still unmined and a node whose pending nonce lags: the claim signs after it.
      const lagging = { ...f.rpc, nonce: async () => 0 };
      await runBonusLedger({ account: ACCOUNT, rpc: lagging, chain: C, now, log: quiet });
      const fresh = f.state.sent.filter((r) => r !== stored.raw_tx);
      assert.equal(fresh.length, 1, "one claim: the bonus wallet's (the Safe has none)");
      const nonces = fresh.map((r) => parseTransaction(r).nonce!);
      assert.ok(nonces.every((n) => n > sweepNonce), 'never at or below the stored sweep nonce');
      assert.ok(fresh.every((r) => parseTransaction(r).to?.toLowerCase() === C.feeLocker));

      // Mined later: the sweep settles as paid.
      f.state.mined.set(keccak256(stored.raw_tx), 'success');
      f.state.autoMine = true;
      f.state.available[BONUS] = 0n;
      f.state.available[C.safe] = 0n;
      const k3 = (await runBonusLedger({ account: ACCOUNT, rpc: f.rpc, chain: C, now, log: quiet })) as Record<string, unknown>;
      assert.equal((k3.sweep as { status: string }).status, 'paid');
    } finally {
      console.error = err;
    }
  } finally {
    await cleanup();
  }
});

test('(b) receipt reads are capped per run; the cursor stops where it got to and the next run goes on', db, async () => {
  try {
    await setup();
    const f = fakeChain({ head: 1_000n + CONFIRMATIONS });
    f.add(500n, [store(1, BONUS, 1n), claimed(2, COIN_A)]);
    f.add(600n, [store(1, BONUS, 2n), claimed(2, COIN_A)]);
    const r1 = await indexDeposits(ACCOUNT.address, { rpc: f.rpc, chain: C, startBlock: 0n, maxReceipts: 1, log: quiet });
    assert.equal(r1.safe, 1);
    assert.equal((r1 as { outOfTime?: boolean }).outOfTime, true);
    assert.equal(await indexedThrough(), null, 'the cursor did not pass the unbooked deposit');
    const r2 = await indexDeposits(ACCOUNT.address, { rpc: f.rpc, chain: C, startBlock: 0n, maxReceipts: 1, log: quiet });
    assert.equal(r2.safe, 1);
    assert.equal((await indexedThrough())?.block, 1_000n);
    assert.equal(f.state.receiptReads, 2, 'the booked transaction is not read again');
  } finally {
    await cleanup();
  }
});

test('(d) an index step failing 6 runs in a row makes the cron wait on the owner; one success resets it', db, async () => {
  try {
    await setup();
    const f = fakeChain({ head: 100n });
    const broken = { ...f.rpc, blockNumber: async () => { throw new Error('rpc down'); } };
    const err = console.error;
    console.error = () => {};
    try {
      const deps = { account: ACCOUNT, rpc: broken, chain: C, log: quiet };
      for (let i = 1; i <= 5; i++) {
        const r = (await runBonusLedger(deps)) as Record<string, unknown>;
        assert.equal(r.index_failures, i);
      }
      const out = await runCron({ now: new Date('2026-10-02T00:00:00Z'), only: ['t4-ledger-none'], deps: { refreshFees: async () => 0, bonus: deps } });
      assert.equal((out.bonus as { index_failures: number }).index_failures, 6);
      assert.deepEqual(out.needs_owner, ['bonus-ledger']);
      const ok = (await runBonusLedger({ ...deps, rpc: f.rpc, startBlock: 0n })) as Record<string, unknown>;
      assert.equal(ok.index_failures, 0);
    } finally {
      console.error = err;
    }
  } finally {
    await cleanup();
  }
});

test('(e) a duplicate coin address is logged and never stops the launch being recorded', db, async () => {
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  const err = console.error;
  const logged: string[] = [];
  console.error = (m: unknown) => logged.push(String(m));
  try {
    await setup();
    const [inst] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES ('t4-dup') RETURNING id`;
    const [p] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id, repo_url) VALUES (${PROG}, 't4 dup', ${inst.id}, 'https://github.com/x/t4dup')
      RETURNING id`;
    const out = await deployToken(
      { projectId: p.id, installationId: inst.id, name: 'T4', symbol: 'TDUP', creatorWallet: CREATOR, image: null, repoUrl: 'https://github.com/x/t4dup', liveUrl: null },
      { fetch: (async () => Response.json({ success: true, tokenAddress: COIN_A, txHash: '0x1' })) as typeof fetch },
    );
    assert.equal(out.status, 'launched');
    const [row] = await sql()<{ token_status: string; token_url: string; coin_address: string | null }[]>`
      SELECT token_status, token_url, coin_address FROM projects WHERE id = ${p.id}`;
    assert.equal(row.token_status, 'launched');
    assert.match(row.token_url, /tokens\.fun\/coin/);
    assert.equal(row.coin_address, null);
    assert.match(logged.join('\n'), /not recorded for the builder bonus/);
  } finally {
    console.error = err;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
    await cleanup();
    await sql()`DELETE FROM installations WHERE token_hash = 't4-dup'`;
  }
});

// ---- Final fix wave ---------------------------------------------------------------------------

test('Ruling 19: a malformed payout key is a skip like a missing one (never a step error); no DB read', async () => {
  const err = console.error;
  const logged: string[] = [];
  console.error = (...a: unknown[]) => logged.push(a.map(String).join(' '));
  try {
    const r = await runBonusLedger({ env: { CAMPAIGN_PAYOUT_PRIVATE_KEY: '0x1234' } });
    assert.deepEqual(r, { skipped: "The payout wallet isn't set up yet (CAMPAIGN_PAYOUT_PRIVATE_KEY); nothing was sent.", problem: 'malformed' });
    assert.ok(!logged.join('\n').includes('0x1234'), 'the key is never logged');
  } finally {
    console.error = err;
  }
  // Ruling 7: 64 hex characters without 0x are a usable key (the owner's format).
  const key = '4'.repeat(64);
  const off = { getChainId: async () => 84532 } as unknown as BonusRpc;
  assert.match(String((await runBonusLedger({ env: { CAMPAIGN_PAYOUT_PRIVATE_KEY: key }, rpc: off })).skipped), /not Base mainnet/);
});

test('Rulings 19, 20: a missing or malformed payout key waits on the owner (503) once the bonus can earn, with no round yet', db, async () => {
  try {
    await setup();
    await sql()`DELETE FROM bonus_rounds WHERE program_id LIKE 't4-ledger%'`;
    const run = (bonus: BonusDeps) =>
      cronPost(new Request('http://x/api/cron', { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } }), {
        limit: async () => {},
        run: () => runCron({ now: new Date('2026-10-02T00:00:00Z'), only: ['t4-ledger-none'], deps: { refreshFees: async () => 0, bonus } }),
      });
    const SECRET = 'fix-wave-cron-secret-0123456789abcdef0123';
    const secret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
    const err = console.error;
    console.error = () => {};
    try {
      // An EarnKit coin exists (v2.14: bonusLive reads coins only; programs and rounds no longer count).
      const missing = await run({ account: null });
      assert.equal(missing.status, 503);
      const body = (await missing.json()) as { needs_owner: string[]; bonus: { note?: string } };
      assert.ok(body.needs_owner.includes(BONUS_WALLET_UNSET));
      const malformed = await run({ env: { CAMPAIGN_PAYOUT_PRIVATE_KEY: 'not-a-key' } });
      assert.equal(malformed.status, 503);
      assert.equal(((await malformed.json()) as { bonus: { problem?: string } }).bonus.problem, 'malformed');
    } finally {
      console.error = err;
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
    }
  } finally {
    await cleanup();
  }
});

test('I5: a pending claim, then the sweep in the same run, signs the next nonce even when the RPC still says the old one', db, async () => {
  try {
    await setup();
    const cost = 50_000n * 1_000_000n;
    await bookDeposit({ txHash: '0xt4nonce', logIndex: 0, amount: 20n * cost, coin: null, blockNumber: 1n, blockTime: new Date('2026-10-02T00:00:00Z') }, quiet);
    const f = fakeChain({ balance: 20n * cost, available: { [BONUS]: 10n * cost } });
    f.state.autoMine = false; // the claim stays pending
    const rpc = { ...f.rpc, nonce: async () => 0 }; // a lagging node: pending count never moves
    const nonces = { next: 0 };
    const claims = await claimFees(ACCOUNT, { rpc, chain: C, nonces, deadline: Date.now() + 10_000, log: quiet });
    assert.match(claims[0].result, /^claim pending/);
    const sweep = await sweepToSafe(ACCOUNT, { rpc, chain: C, nonces, deadline: Date.now() + 10_000 });
    assert.equal(sweep.status, 'pending');
    assert.deepEqual(f.state.sent.map((raw) => parseTransaction(raw).nonce), [0, 1], 'the sweep never reuses the claim nonce');
    assert.equal(nonces.next, 2);
  } finally {
    await cleanup();
  }
});

test('M10: a claim under 10x gas is still sent when the sweep to the Safe waits on it; otherwise not', db, async () => {
  try {
    await setup();
    const cost = 50_000n * 1_000_000n;
    const f = fakeChain({ balance: 0n, available: { [BONUS]: cost } }); // dust: 1x gas
    // No Safe booking to sweep: the dust waits.
    assert.match((await claimFees(ACCOUNT, { rpc: f.rpc, chain: C, log: quiet }))[0].result, /under 10x gas/);
    assert.equal(f.state.sent.length, 0);
    // A Safe booking worth 10x gas sits behind it (not yet in the wallet): the claim goes.
    await bookDeposit({ txHash: '0xt4dust', logIndex: 0, amount: 20n * cost, coin: null, blockNumber: 1n, blockTime: new Date('2026-10-02T00:00:00Z') }, quiet);
    assert.match((await claimFees(ACCOUNT, { rpc: f.rpc, chain: C, log: quiet }))[0].result, /^claim success/);
    assert.equal(f.state.sent.length, 1);
    // Already in the wallet (nothing blocks the sweep): no claim for the dust.
    f.state.balance = 20n * cost;
    assert.match((await claimFees(ACCOUNT, { rpc: f.rpc, chain: C, log: quiet }))[0].result, /under 10x gas/);
    assert.equal(f.state.sent.length, 1);
  } finally {
    await cleanup();
  }
});

test('task-10-review M7: only a revert means "this locker does not hold the coin"; an RPC failure is retried, never stamped', async () => {
  const revert = new CallExecutionError(new ExecutionRevertedError({ message: 'execution reverted: TokenNotFound()' }), { account: undefined } as never);
  const down = new CallExecutionError(new HttpRequestError({ url: 'https://mainnet.base.org', status: 429 }), { account: undefined } as never);
  assert.equal(isRevert(revert), true);
  assert.equal(isRevert(down), false);
  assert.equal(isRevert(new Error('execution reverted')), true);
  assert.equal(isRevert(new Error('fetch failed')), false);
});

// ---- v2.9 Task 9 (D16 to D18): claims for creators and MINI, the gas-out alert, the claims log ----

const CREATOR_2 = '0x4444444444444444444444444444444444444444';
const SAFE = C.safe;
/** An EarnKit token's split on the current locker: Safe, creator, MINI, bonus wallet (bps as on Base). */
const split = (creator: string, mini = MINI) => ({ recipients: [SAFE, creator, mini, BONUS], bps: [3000, 4000, 1000, 2000] });

test('9.1 claimOwners: unique by address, first role wins, order bonus, Safe, creators, MINI', () => {
  const B = BONUS;
  // A test token whose creator is the bonus wallet: listed once, as the bonus wallet.
  assert.deepEqual(claimOwners({ bonus: B, safe: SAFE, creators: [B.toUpperCase().replace('0X', '0x') as Hex], mini: MINI }), [
    { owner: B, role: 'bonus' },
    { owner: SAFE, role: 'safe' },
    { owner: MINI, role: 'mini' },
  ]);
  // Two tokens sharing a creator: that creator once. A token with no known creator: none.
  assert.deepEqual(claimOwners({ bonus: B, safe: SAFE, creators: [CREATOR, null, CREATOR, CREATOR_2], mini: null }), [
    { owner: B, role: 'bonus' },
    { owner: SAFE, role: 'safe' },
    { owner: CREATOR, role: 'creator' },
    { owner: CREATOR_2, role: 'creator' },
  ]);
});

/** A launched EarnKit token row (the claim loop's creators); `recipients` pre-caches projects.fee_recipients. */
async function launched(coin: string, recipients?: { creator: string | null; mini: string | null }) {
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${PROG}, 'X', ${PROG}, 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed')
    ON CONFLICT (id) DO NOTHING`;
  await sql()`
    INSERT INTO projects (program_id, name, token_status, coin_address, fee_recipients)
    VALUES (${PROG}, ${`t9 ${coin}`}, 'launched', ${coin}, ${recipients ? sql().json(recipients) : null})`;
}
const feeClaims = () =>
  sql()<{ tx_hash: string; owner: string; role: string; weth: string; gas_wei: string }[]>`
    SELECT tx_hash, owner, role, weth::text, gas_wei::text FROM fee_claims WHERE owner IN (${BONUS}, ${SAFE}, ${CREATOR}, ${CREATOR_2}, ${MINI}, ${MINI_FEE_RECIPIENT.toLowerCase()})`;
async function t9cleanup() {
  await sql()`DELETE FROM fee_claims WHERE owner IN (${BONUS}, ${SAFE}, ${CREATOR}, ${CREATOR_2}, ${MINI}, ${MINI_FEE_RECIPIENT.toLowerCase()})`;
  await cleanup();
}

test('9.2 / 9.6 claimForOthers: creators claimed only at 10x gas, each paying its owner (never MINI, v4); every sent claim is logged in fee_claims', db, async () => {
  try {
    await t9cleanup();
    await launched(COIN_A, { creator: CREATOR, mini: MINI });
    await launched(COIN_B, { creator: CREATOR_2, mini: MINI });
    const cost = 50_000n * 1_000_000n;
    const f = fakeChain({ available: { [CREATOR]: 9n * cost, [CREATOR_2]: 10n * cost, [MINI]: 10n * cost } });
    const out = await claimForOthers(ACCOUNT, { rpc: f.rpc, chain: C, log: quiet });
    const by = Object.fromEntries(out.map((o) => [o.owner, o]));
    assert.match(by[CREATOR].result, /under 10x gas/, 'the creator at 9x gas is skipped');
    assert.match(by[CREATOR_2].result, /^claim success/);
    assert.equal(by[MINI], undefined, 'v4: MINI is never claimed');
    // claim(owner, WETH): the FeeLocker pays the owner, never the payout wallet.
    const owners = f.state.sent.map((raw) => {
      const tx = parseTransaction(raw);
      assert.equal(tx.to?.toLowerCase(), C.feeLocker);
      const d = decodeFunctionData({ abi: FEE_LOCKER_ABI, data: tx.data! });
      assert.equal(d.functionName, 'claim');
      assert.equal(String(d.args![1]).toLowerCase(), C.weth);
      return String(d.args![0]).toLowerCase();
    });
    assert.deepEqual(owners, [CREATOR_2], 'the creators, newest first');
    // D18: one fee_claims row per successful claim, with its role; gas_wei = estimate x maxFeePerGas.
    const logged = (await feeClaims()).sort((a, b) => a.role.localeCompare(b.role));
    assert.deepEqual(
      logged.map((r) => [r.owner, r.role, r.weth, r.gas_wei]),
      [[CREATOR_2, 'creator', String(10n * cost), String(cost)]],
    );
    assert.deepEqual(new Set(logged.map((r) => r.tx_hash)), new Set(f.state.sent.map((r) => keccak256(r))));
    assert.ok(!f.state.rewardReadCoins.some((c) => c === COIN_A || c === COIN_B), 'cached recipients: no locker read');
  } finally {
    await t9cleanup();
  }
});

test('9.3 feeRecipients: read once per token and cached; a failed read falls back to MINI_FEE_RECIPIENT and claims no creator', db, async () => {
  try {
    await t9cleanup();
    await launched(COIN_A);
    const f = fakeChain({ available: { [CREATOR]: 10n ** 18n, [MINI]: 10n ** 18n } });
    // The old locker doesn't know the coin (an empty struct, as on Base); the current one does.
    f.state.rewards[`${NEW_LOCKER}:${COIN_A}`] = split(CREATOR);
    assert.deepEqual(await feeRecipients(COIN_A as Hex, { rpc: f.rpc, chain: { ...C, lockers: [OLD_LOCKER, NEW_LOCKER] } }), { creator: CREATOR, mini: MINI });
    // A locker that reverts for an unknown coin (the anvil mocks) is passed over the same way.
    const reverting = { ...f.rpc, rewardInfo: async (locker: Hex, coin: Hex) => {
      if (locker.toLowerCase() === OLD_LOCKER) throw new CallExecutionError(new ExecutionRevertedError({ message: 'execution reverted: TokenNotFound()' }), { account: undefined } as never);
      return f.rpc.rewardInfo(locker, coin);
    } };
    assert.deepEqual(await feeRecipients(COIN_A as Hex, { rpc: reverting, chain: { ...C, lockers: [OLD_LOCKER, NEW_LOCKER] } }), { creator: CREATOR, mini: MINI });
    const [row] = await sql()<{ fee_recipients: unknown }[]>`SELECT fee_recipients FROM projects WHERE coin_address = ${COIN_A}`;
    assert.deepEqual(row.fee_recipients, { creator: CREATOR, mini: MINI });
    // The claim run reads the cache: no locker read, and both are claimed.
    f.state.rewardReadCoins = [];
    const out = await claimForOthers(ACCOUNT, { rpc: f.rpc, chain: C, log: quiet });
    assert.ok(!f.state.rewardReadCoins.includes(COIN_A));
    assert.deepEqual(out.filter((o) => o.role === 'creator' || o.role === 'mini').map((o) => o.owner), [CREATOR], 'v4: never MINI');

    // A token whose read fails: MINI falls back to the constant, no creator, nothing cached.
    await sql()`UPDATE projects SET fee_recipients = NULL WHERE coin_address = ${COIN_A}`;
    f.state.rewardFails = true;
    const err = console.error;
    console.error = () => {};
    try {
      assert.deepEqual(await feeRecipients(COIN_A as Hex, { rpc: f.rpc, chain: C }), { creator: null, mini: MINI_FEE_RECIPIENT.toLowerCase() });
      const sentBefore = f.state.sent.length;
      const lines: string[] = [];
      const failed = await claimForOthers(ACCOUNT, { rpc: f.rpc, chain: C, log: (l) => void lines.push(l) });
      assert.equal(lines.length, 1, 'one line per run');
      assert.ok(lines[0].includes(COIN_A));
      assert.ok(!failed.some((o) => o.role === 'creator'), 'no creator claim');
      assert.deepEqual(failed.filter((o) => o.role === 'mini'), [], 'v4: never MINI');
      assert.equal(f.state.sent.length, sentBefore, 'nothing available for the fallback here, so nothing sent');
    } finally {
      console.error = err;
    }
    const [after] = await sql()<{ fee_recipients: unknown }[]>`SELECT fee_recipients FROM projects WHERE coin_address = ${COIN_A}`;
    assert.equal(after.fee_recipients, null, 'a failed read is never cached');
    // One token's read fails while another's recipients are cached: still no MINI claim (v4).
    await launched(COIN_B, { creator: CREATOR, mini: MINI });
    console.error = () => {};
    try {
      const mixed = await claimForOthers(ACCOUNT, { rpc: f.rpc, chain: C, log: quiet });
      assert.deepEqual(mixed.filter((o) => o.role === 'mini'), [], 'v4: never MINI');
    } finally {
      console.error = err;
    }
  } finally {
    await t9cleanup();
  }
});

test('9.4 a payout wallet under gasMinWei is low on gas: GAS_LOW with TOP_UP, bonus-ledger in needs_owner, cron 503', db, async () => {
  const secret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 't9-cron-secret-0123456789abcdef0123456789';
  try {
    await t9cleanup();
    const f = fakeChain({ head: 1_100n + CONFIRMATIONS });
    f.state.eth = GAS_WALLET_MIN_WEI_DEFAULT - 1n;
    const r = (await runBonusLedger({ account: ACCOUNT, rpc: f.rpc, chain: C, startBlock: 1_000n, log: quiet })) as { gas: { balance_wei: string; low: boolean; note?: string } };
    assert.deepEqual(r.gas, { balance_wei: String(GAS_WALLET_MIN_WEI_DEFAULT - 1n), low: true, note: GAS_LOW(ACCOUNT.address) });
    assert.ok(r.gas.note!.includes(TOP_UP) && r.gas.note!.includes(ACCOUNT.address));
    const run = () =>
      runCron({ now: new Date('2026-10-02T00:00:00Z'), only: ['t4-ledger-none'], deps: { refreshFees: async () => 0, bonus: { account: ACCOUNT, rpc: f.rpc, chain: C, startBlock: 1_000n, log: quiet } } });
    assert.deepEqual((await run()).needs_owner, ['bonus-ledger']);
    const res = await cronPost(new Request('http://x/api/cron', { method: 'POST', headers: { authorization: 'Bearer t9-cron-secret-0123456789abcdef0123456789' } }), {
      limit: async () => {},
      run,
    });
    assert.equal(res.status, 503);
    // At the floor: not low. An unread balance never blocks the run.
    f.state.eth = GAS_WALLET_MIN_WEI_DEFAULT;
    assert.deepEqual(((await runBonusLedger({ account: ACCOUNT, rpc: f.rpc, chain: C, log: quiet })) as { gas: unknown }).gas, {
      balance_wei: String(GAS_WALLET_MIN_WEI_DEFAULT),
      low: false,
    });
    f.state.ethFails = true;
    const err = console.error;
    console.error = () => {};
    try {
      const unread = (await runBonusLedger({ account: ACCOUNT, rpc: f.rpc, chain: C, log: quiet })) as { gas: unknown; sweep: unknown };
      assert.deepEqual(unread.gas, { low: false, note: 'unread' });
      assert.deepEqual(unread.sweep, { result: 'nothing to sweep' }, 'the run goes on');
    } finally {
      console.error = err;
    }
  } finally {
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
    await t9cleanup();
  }
});

test('9.5 a claim the wallet cannot pay gas for waits on the owner; the sweep out of gas says TOP_UP', db, async () => {
  try {
    await t9cleanup();
    const f = fakeChain({ head: 1_100n + CONFIRMATIONS, available: { [BONUS]: 10n ** 18n } });
    f.rpc.broadcast = async () => {
      throw new Error('insufficient funds for gas * price + value');
    };
    const err = console.error;
    console.error = () => {};
    try {
      const out = await runCron({
        now: new Date('2026-10-02T00:00:00Z'),
        only: ['t4-ledger-none'],
        deps: { refreshFees: async () => 0, bonus: { account: ACCOUNT, rpc: f.rpc, chain: C, startBlock: 1_000n, log: quiet } },
      });
      const claim = (out.bonus as { claim: { owner: string; result: string }[] }).claim;
      assert.equal(claim.find((c) => c.owner === BONUS)?.result, 'the payout wallet needs ETH for gas');
      assert.deepEqual(out.needs_owner, ['bonus-ledger']);
    } finally {
      console.error = err;
    }
    // The sweep's gas-out result carries TOP_UP, so needsOwner reads it.
    await setup();
    await sql()`INSERT INTO bonus_ledger (tx_hash, log_index, block_number, block_time, coin, destination, amount_wei)
      VALUES (${`0x${'9'.repeat(64)}`}, 1, 1, now(), ${COIN_B}, 'safe', ${String(10n ** 18n)})`;
    f.state.balance = 10n ** 18n;
    console.error = () => {};
    try {
      const sweep = await sweepToSafe(ACCOUNT, { rpc: f.rpc, chain: C });
      assert.equal(sweep.result, `the payout wallet needs ETH for gas. ${TOP_UP}`);
      assert.ok(needsOwner(sweep.result));
    } finally {
      console.error = err;
    }
  } finally {
    await t9cleanup();
  }
});

test('9.7 gasMinWei: GAS_WALLET_MIN_WEI, else 0.002 ETH; a malformed value is the default, logged once without the value', () => {
  assert.equal(gasMinWei({}), 2_000_000_000_000_000n);
  assert.equal(gasMinWei({ GAS_WALLET_MIN_WEI: '5000' }), 5000n);
  const lines: string[] = [];
  const err = console.error;
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  try {
    assert.equal(gasMinWei({ GAS_WALLET_MIN_WEI: 'abc' }), GAS_WALLET_MIN_WEI_DEFAULT);
    assert.equal(gasMinWei({ GAS_WALLET_MIN_WEI: 'abc' }), GAS_WALLET_MIN_WEI_DEFAULT);
  } finally {
    console.error = err;
  }
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('abc'));
});

test('9.8 (fix round 1) the creator and MINI step runs after the sweep, in its own slice: a slow one never starves them', db, async () => {
  try {
    await t9cleanup();
    await setup();
    // Many creators, each with a slow availableFees read (a rate-limited RPC).
    const creators = Array.from({ length: 30 }, (_, i) => `0x5${String(i).padStart(39, '0')}`);
    for (const [i, c] of creators.entries()) await launched(`0xc0${String(i).padStart(38, '0')}`, { creator: c, mini: MINI });
    const f = fakeChain({ head: 1_100n + CONFIRMATIONS, available: { [BONUS]: 10n ** 18n, [C.safe]: 10n ** 18n } });
    for (const c of [...creators, MINI]) f.state.slowMs[c] = 40;
    const order: string[] = [];
    const avail = f.rpc.availableFees;
    f.rpc.availableFees = async (owner, token) => {
      order.push(owner.toLowerCase() === BONUS ? 'bonus' : owner.toLowerCase() === C.safe ? 'safe' : 'other');
      return avail(owner, token);
    };
    const rewardInfo = f.rpc.rewardInfo;
    f.rpc.rewardInfo = async (l, c) => {
      order.push('read');
      return rewardInfo(l, c);
    };
    const started = Date.now();
    const r = (await runBonusLedger({
      account: ACCOUNT,
      rpc: f.rpc,
      chain: C,
      startBlock: 1_000n,
      log: quiet,
      othersMs: 300,
      deadline: Date.now() + 60_000,
    })) as { claim: { role: string; result: string }[]; sweep: { result: string }; claim_others: { owner: string; role: string; result: string }[] };
    // EarnKit's own claims came first, before any recipient read or third-party claim; then the sweep.
    assert.deepEqual(order.slice(0, 2), ['bonus', 'safe']);
    assert.deepEqual(r.claim.map((c) => c.role), ['bonus', 'safe']);
    assert.ok(r.claim.every((c) => c.result.startsWith('claim success')));
    assert.deepEqual(r.sweep, { result: 'nothing to sweep' });
    // The slow step stopped at its slice (creators only, v4), the rest carried over to the next run.
    assert.equal(r.claim_others[0].role, 'creator');
    const next = r.claim_others.filter((c) => c.result === 'next run');
    assert.ok(next.length > 0 && next.length < creators.length, `${next.length} carried over`);
    assert.ok(Date.now() - started < 5_000, 'bounded');
    assert.equal(OTHERS_CLAIM_MS, 20_000, 'production slice: at most 20 s a run');
  } finally {
    await sql()`DELETE FROM projects WHERE program_id = ${PROG}`;
    await t9cleanup();
  }
});

test('9.9 (fix round 1) a split that is not EarnKit\'s is never read by slot: unread, not cached, no creator claim', db, async () => {
  assert.deepEqual([...EARNKIT_SPLIT_BPS], [FEE_SPLIT_BPS.earnkit, FEE_SPLIT_BPS.project, FEE_SPLIT_BPS.buyback, FEE_SPLIT_BPS.bonus]);
  try {
    await t9cleanup();
    await launched(COIN_A);
    const f = fakeChain();
    f.state.rewards[`${NEW_LOCKER}:${COIN_A}`] = { recipients: [SAFE, CREATOR, MINI, BONUS], bps: [2000, 6000, 1000, 1000] };
    const err = console.error;
    console.error = () => {};
    try {
      const unread: Hex[] = [];
      assert.deepEqual(await feeRecipients(COIN_A as Hex, { rpc: f.rpc, chain: C, unread }), { creator: null, mini: MINI_FEE_RECIPIENT.toLowerCase() });
      assert.deepEqual(unread, [COIN_A]);
    } finally {
      console.error = err;
    }
    const [row] = await sql()<{ fee_recipients: unknown }[]>`SELECT fee_recipients FROM projects WHERE coin_address = ${COIN_A}`;
    assert.equal(row.fee_recipients, null);
  } finally {
    await t9cleanup();
  }
});

test('13.6 fee recipients are read from both EarnKit splits: v2.5 (4 slots) and v2.13 (3 slots: Safe 50, creator 40, MINI 10)', async () => {
  const coin = `0x${'7'.repeat(40)}` as Hex;
  const creator = `0x${'8'.repeat(40)}`;
  const mini = `0x${'9'.repeat(40)}`;
  const chain = { lockers: [`0x${'1'.repeat(40)}`] } as never;
  const rpc = (bps: number[]) => ({ rewardInfo: async () => ({ recipients: [`0x${'5'.repeat(40)}`, creator, mini, ...(bps.length === 4 ? [`0x${'6'.repeat(40)}`] : [])], bps }) }) as never;
  // The new split is the terms' v2.13 table: the former bonus share to the Safe, creator and MINI unchanged.
  assert.deepEqual([...EARNKIT_SPLITS_BPS[1]], [FEE_SPLIT_BPS_V213.earnkit, FEE_SPLIT_BPS_V213.project, FEE_SPLIT_BPS_V213.buyback]);
  assert.equal(FEE_SPLIT_BPS_V213.earnkit, FEE_SPLIT_BPS.earnkit + FEE_SPLIT_BPS.bonus);
  assert.deepEqual([FEE_SPLIT_BPS_V213.project, FEE_SPLIT_BPS_V213.buyback], [FEE_SPLIT_BPS.project, FEE_SPLIT_BPS.buyback]);
  // The cache write (no project holds this coin) is a no-op; without a database it fails soft.
  const err = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await feeRecipients(coin, { rpc: rpc([5000, 4000, 1000]), chain }), { creator, mini });
    assert.deepEqual(await feeRecipients(coin, { rpc: rpc([3000, 4000, 1000, 2000]), chain }), { creator, mini });
    const unread: Hex[] = [];
    assert.equal((await feeRecipients(coin, { rpc: rpc([5000, 3000, 2000]), chain, unread })).creator, null, 'any other split is unread');
    assert.deepEqual(unread, [coin]);
    // A 3-slot split in another order, or the old split's first three slots, is not EarnKit's either.
    const more: Hex[] = [];
    await feeRecipients(coin, { rpc: rpc([4000, 5000, 1000]), chain, unread: more });
    await feeRecipients(coin, { rpc: rpc([3000, 4000, 1000]), chain, unread: more });
    assert.deepEqual(more, [coin, coin]);
  } finally {
    console.error = err;
  }
});

test('13.6b a v2.13 coin (3 slots) and a v4 coin (2 slots) are cached and their creators claimed; MINI never is (v4)', db, async () => {
  try {
    await t9cleanup();
    await launched(COIN_A);
    await launched(COIN_B);
    const f = fakeChain({ available: { [CREATOR]: 10n ** 18n, [CREATOR_2]: 10n ** 18n, [MINI]: 10n ** 18n } });
    f.state.rewards[`${NEW_LOCKER}:${COIN_A}`] = split(CREATOR);
    f.state.rewards[`${NEW_LOCKER}:${COIN_B}`] = { recipients: [SAFE, CREATOR_2], bps: [6000, 4000] };
    const out = await claimForOthers(ACCOUNT, { rpc: f.rpc, chain: C, log: quiet });
    assert.deepEqual(
      out.filter((o) => o.role === 'creator' || o.role === 'mini').map((o) => o.owner).sort(),
      [CREATOR, CREATOR_2].sort(),
    );
    const cached = await sql()<{ coin_address: string; fee_recipients: unknown }[]>`
      SELECT coin_address, fee_recipients FROM projects WHERE coin_address IN (${COIN_A}, ${COIN_B}) ORDER BY coin_address`;
    assert.deepEqual(cached.map((r) => r.fee_recipients), [{ creator: CREATOR, mini: MINI }, { creator: CREATOR_2, mini: null }]);
  } finally {
    await sql()`DELETE FROM projects WHERE program_id = ${PROG}`;
    await t9cleanup();
  }
});

test('v4 claimForOthers: a launched builder token\'s creator (its wallet) is claimed at 10x gas, no locker read; a declined or unknown one never', db, async () => {
  const BT = '0x5555555555555555555555555555555555555555';
  const BT_2 = '0x6666666666666666666666666666666666666666';
  const BT_UNKNOWN = '0x7777777777777777777777777777777777777777';
  const BT_COIN = '0xb700000000000000000000000000000000000001';
  const BT_COIN_2 = '0xb700000000000000000000000000000000000002';
  const ids: number[] = [];
  const row = async (status: string, wallet: string | null, coin: string | null) => {
    const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v4-bt-claim-${randomUUID()}`}) RETURNING id`;
    ids.push(id);
    await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status, wallet, coin_address)
      VALUES (${id}, ${`x-claim-${randomUUID()}`}, ${status}, ${wallet}, ${coin})`;
  };
  const owners = [BT, BT_2, BT_UNKNOWN];
  try {
    await t9cleanup();
    await sql()`DELETE FROM builder_tokens WHERE coin_address IN (${BT_COIN}, ${BT_COIN_2}) OR wallet IN ${sql()(owners)}`;
    await row('launched', BT, BT_COIN);
    await row('launched', BT_2, BT_COIN_2);
    await row('unknown', BT_UNKNOWN, null);
    await row('declined', null, null);
    const cost = 50_000n * 1_000_000n;
    const f = fakeChain({ available: { [BT]: 10n * cost, [BT_2]: 9n * cost, [BT_UNKNOWN]: 10n ** 18n } });
    const out = await claimForOthers(ACCOUNT, { rpc: f.rpc, chain: C, log: quiet });
    const by = Object.fromEntries(out.map((o) => [o.owner, o]));
    assert.equal(by[BT]?.role, 'creator');
    assert.match(by[BT].result, /^claim success/);
    assert.match(by[BT_2]?.result ?? '', /under 10x gas/, 'the builder at 9x gas is skipped');
    assert.equal(by[BT_UNKNOWN], undefined, 'an unknown launch is never claimed');
    const sentTo = f.state.sent.map((raw) => String(decodeFunctionData({ abi: FEE_LOCKER_ABI, data: parseTransaction(raw).data! }).args![0]).toLowerCase());
    assert.deepEqual(sentTo, [BT], 'claim(builder wallet, WETH): the FeeLocker pays the builder');
    assert.ok(!f.state.rewardReadCoins.some((c) => c === BT_COIN || c === BT_COIN_2), 'the recipient is known: no locker read');
  } finally {
    await sql()`DELETE FROM fee_claims WHERE owner IN ${sql()(owners)}`;
    if (ids.length > 0) await sql()`DELETE FROM builder_tokens WHERE builder_id IN ${sql()(ids)}`;
    await t9cleanup();
  }
});
