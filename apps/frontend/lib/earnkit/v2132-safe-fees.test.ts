import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from 'viem';
import { BASE_BONUS, CLAIMED_REWARDS, CONFIRMATIONS, STORE_TOKENS, indexSafeFees, type BonusRpc, type RawLog } from './bonus-ledger';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';
import { readStats, statsFrom } from './stats';

/**
 * v2.13.2 (2): `fees_to_safe_eth` counts the Safe's actual share of both splits under the Bench: the
 * old 4-slot coins (Safe 30 / creator 40 / MINI 10 / bonus 20) and the new 3-slot ones (Safe 50 /
 * creator 40 / MINI 10). The ledger indexes the Safe's own FeeLocker deposits from EarnKit coins
 * (`safe_fees`); a 4-slot deposit whose Safe deposit isn't indexed keeps the 1.5x estimate, never both.
 * Flag off: the v2.5 formula, unchanged.
 */

holdBonusDbLock();

const E18 = 10n ** 18n;
const C = BASE_BONUS;
const LOCKER = C.lockers[0];
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const stamp = (process.pid.toString(16) + Date.now().toString(16)).slice(-12);
const coin = (c: string) => `0x${c.repeat(28)}${stamp}`.slice(0, 42).toLowerCase();

const emptyRow = {
  open_rows: null, pool_rows: null, programs_open: 0, bonus_programs_open: 0, coins_launched: 0,
  bonus_deposits_wei: null, bonus_to_safe_wei: null, bonus_paid_wei: null, bonus_pools_wei: null, installs: 0,
  labelled_entries: 0, entries_won: 0, builders_won_usd: null,
};
async function withBench<T>(on: boolean, fn: () => Promise<T> | T): Promise<T> {
  const prev = [process.env.EARNKIT_BUILDER_SCORE, process.env.EARNKIT_BENCH];
  if (on) process.env.EARNKIT_BUILDER_SCORE = process.env.EARNKIT_BENCH = 'on';
  else delete process.env.EARNKIT_BENCH;
  try {
    return await fn();
  } finally {
    if (prev[0] === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = prev[0];
    if (prev[1] === undefined) delete process.env.EARNKIT_BENCH;
    else process.env.EARNKIT_BENCH = prev[1];
  }
}

// ---- statsFrom (pure)

test('v2.13.2 2: a 4-slot coin: the Safe got 1.5x its bonus deposits (estimate) or its indexed deposit, never both', () =>
  withBench(true, () => {
    // 2 ETH of bonus deposits with no indexed Safe deposit: 3 ETH.
    assert.equal(statsFrom({ ...emptyRow, bonus_deposits_wei: (2n * E18).toString(), bonus_unmatched_wei: (2n * E18).toString() }).fees_to_safe_eth, 3);
    // The same deposits with the Safe's own deposits indexed (3 ETH): counted once, as indexed.
    assert.equal(statsFrom({ ...emptyRow, bonus_deposits_wei: (2n * E18).toString(), bonus_unmatched_wei: '0', safe_fees_wei: (3n * E18).toString() }).fees_to_safe_eth, 3);
  }));

test('v2.13.2 2: a 3-slot coin: the Safe\'s indexed 50% share counts (it has no bonus slot)', () =>
  withBench(true, () => {
    assert.equal(statsFrom({ ...emptyRow, safe_fees_wei: (5n * E18).toString() }).fees_to_safe_eth, 5);
  }));

test('v2.13.2 2: both: the 4-slot estimate, the indexed Safe deposits and the bonus money booked to the Safe add up', () =>
  withBench(true, () => {
    const row = {
      ...emptyRow,
      bonus_deposits_wei: (3n * E18).toString(), // 2 matched + 1 unmatched
      bonus_unmatched_wei: E18.toString(),
      safe_fees_wei: (8n * E18).toString(), // 3 from the 4-slot coin, 5 from the 3-slot coin
      bonus_to_safe_wei: (E18 / 2n).toString(),
    };
    assert.equal(statsFrom(row).fees_to_safe_eth, 1.5 + 8 + 0.5);
  }));

test('v2.13.2 2: flag off: the v2.5 formula, unchanged (1.5x every bonus deposit, the Safe index unread)', () =>
  withBench(false, () => {
    const row = { ...emptyRow, bonus_deposits_wei: (2n * E18).toString(), bonus_unmatched_wei: '0', safe_fees_wei: (9n * E18).toString(), bonus_to_safe_wei: (E18 / 2n).toString() };
    assert.equal(statsFrom(row).fees_to_safe_eth, 3.5);
  }));

// ---- readStats (DB)

test('v2.13.2 2: readStats: a 4-slot coin (matched and not), a 3-slot coin, never another coin or a test installation\'s', db, async () => {
  const tag = `v2132-safe-${stamp}`;
  const c4 = coin('4');
  const c3 = coin('3');
  const cTest = coin('7');
  const h = (n: number) => `0x${tag.replace(/[^0-9a-f]/g, '').padStart(60, '0')}${n.toString(16).padStart(4, '0')}`;
  const Rollback = new Error('rollback');
  const prevEnv = process.env.EARNKIT_TEST_INSTALLATIONS;
  try {
    await sql().begin('isolation level repeatable read', async (tx) => {
      await tx`
        INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
        VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown')`;
      const [testInst] = await tx<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${tag}) RETURNING id`;
      process.env.EARNKIT_TEST_INSTALLATIONS = String(testInst.id);
      await tx`
        INSERT INTO projects (program_id, name, token_status, token_url, coin_address, installation_id) VALUES
          (${tag}, 'four', 'launched', 'https://tokens.fun/a', ${c4}, NULL),
          (${tag}, 'three', 'launched', 'https://tokens.fun/b', ${c3}, NULL),
          (${tag}, 'test', 'launched', 'https://tokens.fun/c', ${cTest}, ${testInst.id})`;
      const read = async () => ({ on: await withBench(true, () => readStats(new Date(), tx)), off: await withBench(false, () => readStats(new Date(), tx)) });
      const before = await read();
      // 4-slot coin: two bonus deposits booked to the Safe (Bench: no rounds); the first one's Safe deposit is indexed.
      await tx`
        INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_time) VALUES
          (${h(1)}, 1, ${c4}, NULL, 'safe', ${(2n * E18).toString()}, now()),
          (${h(2)}, 1, ${c4}, NULL, 'safe', ${E18.toString()}, now())`;
      await tx`
        INSERT INTO safe_fees (tx_hash, log_index, coin, amount_wei, block_time) VALUES
          (${h(1)}, 0, ${c4}, ${(3n * E18).toString()}, now()),
          (${h(3)}, 0, ${c3}, ${(5n * E18).toString()}, now()),
          (${h(4)}, 0, ${cTest}, ${(7n * E18).toString()}, now()),
          (${h(5)}, 0, '0x00000000000000000000000000000000000000ff', ${(11n * E18).toString()}, now())`;
      const after = await read();
      const d = (k: 'on' | 'off') => Math.round((after[k].fees_to_safe_eth - before[k].fees_to_safe_eth) * 1e6) / 1e6;
      // On: indexed 3 (4-slot, matched: not 3 + 3) + 1.5 (the unmatched 1 ETH) + 5 (3-slot) + 3 booked to the Safe.
      assert.equal(d('on'), 3 + 1.5 + 5 + 3);
      // Off: the v2.5 formula: 1.5 x 3 + 3.
      assert.equal(d('off'), 4.5 + 3);
      throw Rollback;
    });
  } catch (err) {
    if (err !== Rollback) throw err;
  } finally {
    if (prevEnv === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = prevEnv;
  }
});

// ---- indexSafeFees (DB, a fake chain)

const bookedOf = (r: Awaited<ReturnType<typeof indexSafeFees>>) => ('booked' in r ? r.booked : -1);
const store = (logIndex: number, owner: string, amount: bigint): RawLog => ({
  address: C.feeLocker,
  topics: encodeEventTopics({ abi: [STORE_TOKENS], eventName: 'StoreTokens', args: { sender: LOCKER, feeOwner: owner as Hex, token: C.weth } }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [123n, amount]),
  logIndex,
});
const claimed = (logIndex: number, c: string): RawLog => ({
  address: LOCKER,
  topics: encodeEventTopics({ abi: [CLAIMED_REWARDS], eventName: 'ClaimedRewards', args: { token: c as Hex } }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256[]' }, { type: 'uint256[]' }], [0n, 0n, [], []]),
  logIndex,
});

test('v2.13.2 2: indexSafeFees books the Safe\'s own deposits from EarnKit coins (both splits), idempotent, from its cursor', db, async () => {
  const tag = `v2132-idx-${stamp}`;
  const c4 = coin('a');
  const c3 = coin('b');
  const other = coin('c');
  const BONUS = '0x4444444444444444444444444444444444444444';
  const txs: { hash: Hex; block: bigint; logs: RawLog[] }[] = [];
  const add = (block: bigint, logs: RawLog[]) => {
    const hash = keccak256(`0x${stamp}${(txs.length + 1).toString(16).padStart(4, '0')}` as Hex);
    txs.push({ hash, block, logs });
    return hash.toLowerCase();
  };
  // 4-slot: the Safe 30, the bonus wallet 20 (and creator, MINI); 3-slot: the Safe 50; another coin: the Safe too.
  const t4 = add(100n, [store(1, C.safe, 30n), store(2, '0x1111111111111111111111111111111111111111', 40n), store(3, BONUS, 20n), claimed(4, c4)]);
  const t3 = add(150n, [store(1, C.safe, 50n), store(2, '0x1111111111111111111111111111111111111111', 40n), claimed(3, c3)]);
  add(160n, [store(1, C.safe, 99n), claimed(2, other)]);
  const head = 200n + CONFIRMATIONS;
  const calls: [bigint, bigint][] = [];
  const rpc = {
    blockNumber: async () => head,
    blockTime: async (b: bigint) => new Date(Date.UTC(2026, 9, 1) + Number(b) * 60_000),
    ownerLogs: async (lo: bigint, hi: bigint, owner: Hex) => {
      calls.push([lo, hi]);
      assert.equal(owner, C.safe);
      return txs
        .filter((t) => t.block >= lo && t.block <= hi)
        .flatMap((t) => t.logs.filter((l) => l.address !== C.feeLocker || l.topics[2]?.endsWith(C.safe.slice(2))).map((l) => ({ ...l, txHash: t.hash, blockNumber: t.block })));
    },
  } as unknown as BonusRpc;
  const clean = async () => {
    await sql()`DELETE FROM safe_fees WHERE coin IN (${c4}, ${c3}, ${other})`;
    await sql()`DELETE FROM bonus_cursor WHERE id = 'safe'`;
    await sql()`DELETE FROM projects WHERE program_id = ${tag}`;
    await sql()`DELETE FROM programs WHERE id = ${tag}`;
  };
  try {
    await clean();
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
      VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown')`;
    await sql()`
      INSERT INTO projects (program_id, name, token_status, token_url, coin_address) VALUES
        (${tag}, 'four', 'launched', 'https://tokens.fun/a', ${c4}), (${tag}, 'three', 'launched', 'https://tokens.fun/b', ${c3})`;
    const r1 = await indexSafeFees({ rpc, chain: C, startBlock: 50n, log: () => {} });
    assert.equal(bookedOf(r1), 2);
    const rows = await sql()<{ tx_hash: string; log_index: number; coin: string; amount_wei: string }[]>`
      SELECT tx_hash, log_index, coin, amount_wei::text FROM safe_fees WHERE coin IN (${c4}, ${c3}, ${other}) ORDER BY block_number`;
    assert.deepEqual(rows.map((r) => ({ ...r })), [
      { tx_hash: t4, log_index: 1, coin: c4, amount_wei: '30' },
      { tx_hash: t3, log_index: 1, coin: c3, amount_wei: '50' },
    ]);
    const [cur] = await sql()<{ block: string }[]>`SELECT block::text FROM bonus_cursor WHERE id = 'safe'`;
    assert.equal(cur.block, String(head - CONFIRMATIONS));
    // From the cursor: nothing to read, nothing booked twice.
    const n = calls.length;
    const r2 = await indexSafeFees({ rpc, chain: C, startBlock: 50n, log: () => {} });
    assert.equal(bookedOf(r2), 0);
    assert.equal(calls.length, n);
    // The same range read again (a lost cursor): idempotent.
    await sql()`DELETE FROM bonus_cursor WHERE id = 'safe'`;
    const r3 = await indexSafeFees({ rpc, chain: C, startBlock: 50n, log: () => {} });
    assert.equal(bookedOf(r3), 0);
    // No reader for it: skipped, nothing read.
    const { ownerLogs: _, ...bare } = rpc as unknown as Record<string, unknown>;
    assert.deepEqual(await indexSafeFees({ rpc: bare as unknown as BonusRpc, chain: C, log: () => {} }), { skipped: 'no reader' });
  } finally {
    await clean();
  }
});
