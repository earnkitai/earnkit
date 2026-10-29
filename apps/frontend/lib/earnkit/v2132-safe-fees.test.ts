import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from 'viem';
import { BASE_BONUS, CLAIMED_REWARDS, CONFIRMATIONS, INDEX_FAILED_RUNS, SAFE_INDEX_CALLS_PER_RUN, SAFE_INDEX_MS, STORE_TOKENS, indexSafeFees, safeIndexStep, type BonusRpc, type RawLog } from './bonus-ledger';
import { bonusWaitsOnOwner } from './cron';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';
import { STATS_LABELS, readStats, statsFrom } from './stats';

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
  open_rows: null, pool_rows: null, programs_open: 0, bonus_programs_open: 0, coins_launched: 0, tokens_declined: 0,
  bonus_deposits_wei: null, bonus_to_safe_wei: null, bonus_paid_wei: null, bonus_pools_wei: null, installs: 0,
  labelled_entries: 0, entries_won: 0, builders_won_usd: null,
};

// ---- statsFrom (pure)

test('v2.13.2 2: a 4-slot coin: the Safe got 1.5x its bonus deposits (estimate) or its indexed deposit, never both', () => {
  // 2 ETH of bonus deposits with no indexed Safe deposit: 3 ETH.
  assert.equal(statsFrom({ ...emptyRow, bonus_deposits_wei: (2n * E18).toString(), bonus_unmatched_wei: (2n * E18).toString() }).fees_to_safe_eth, 3);
  // The same deposits with the Safe's own deposits indexed (3 ETH): counted once, as indexed.
  assert.equal(statsFrom({ ...emptyRow, bonus_deposits_wei: (2n * E18).toString(), bonus_unmatched_wei: '0', safe_fees_wei: (3n * E18).toString() }).fees_to_safe_eth, 3);
});

test('v2.13.2 2: a 3-slot coin: the Safe\'s indexed 50% share counts (it has no bonus slot)', () => {
  assert.equal(statsFrom({ ...emptyRow, safe_fees_wei: (5n * E18).toString() }).fees_to_safe_eth, 5);
});

test('v2.13.2 2: both: the 4-slot estimate, the indexed Safe deposits and the bonus money booked to the Safe add up', () => {
  const row = {
    ...emptyRow,
    bonus_deposits_wei: (3n * E18).toString(), // 2 matched + 1 unmatched
    bonus_unmatched_wei: E18.toString(),
    safe_fees_wei: (8n * E18).toString(), // 3 from the 4-slot coin, 5 from the 3-slot coin
    bonus_to_safe_wei: (E18 / 2n).toString(),
  };
  assert.equal(statsFrom(row).fees_to_safe_eth, 1.5 + 8 + 0.5);
});

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
      const read = () => readStats(new Date(), tx);
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
      const d = Math.round((after.fees_to_safe_eth - before.fees_to_safe_eth) * 1e6) / 1e6;
      // Indexed 3 (4-slot, matched: not 3 + 3) + 1.5 (the unmatched 1 ETH) + 5 (3-slot) + 3 booked to the Safe.
      assert.equal(d, 3 + 1.5 + 5 + 3);
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

type Tx = { hash: Hex; block: bigint; logs: RawLog[] };
/**
 * A fake chain for the Safe index: the Safe's WETH StoreTokens reads and the lockers' ClaimedRewards
 * reads, as two calls (the real order: every store log, then every claim log), counted. `delayMs`: each read's latency.
 */
function safeChain(txs: Tx[], head: bigint, o: { delayMs?: number } = {}) {
  const calls = { stores: [] as [bigint, bigint][], claims: [] as [bigint, bigint][] };
  const wait = () => (o.delayMs ? new Promise((r) => setTimeout(r, o.delayMs)) : Promise.resolve());
  const flat = (lo: bigint, hi: bigint, keep: (l: RawLog) => boolean) =>
    txs.filter((t) => t.block >= lo && t.block <= hi).flatMap((t) => t.logs.filter(keep).map((l) => ({ ...l, txHash: t.hash, blockNumber: t.block })));
  const rpc = {
    blockNumber: async () => head,
    blockTime: async (b: bigint) => new Date(Date.UTC(2026, 9, 1) + Number(b) * 60_000),
    safeStoreLogs: async (lo: bigint, hi: bigint, owner: Hex) => {
      calls.stores.push([lo, hi]);
      assert.equal(owner, C.safe);
      await wait();
      return flat(lo, hi, (l) => l.address === C.feeLocker && Boolean(l.topics[2]?.endsWith(C.safe.slice(2))));
    },
    claimLogs: async (lo: bigint, hi: bigint) => {
      calls.claims.push([lo, hi]);
      await wait();
      return flat(lo, hi, (l) => l.address === LOCKER);
    },
  } as unknown as BonusRpc;
  return { rpc, calls };
}
let txSeq = 0;
const tx = (block: bigint, logs: RawLog[]): Tx => ({ hash: keccak256(`0x${stamp}${(++txSeq).toString(16).padStart(4, '0')}` as Hex), block, logs });
const BONUS = '0x4444444444444444444444444444444444444444';
const CREATOR = '0x1111111111111111111111111111111111111111';

async function withCoins<T>(tag: string, coins: string[], fn: () => Promise<T>): Promise<T> {
  const clean = async () => {
    await sql()`DELETE FROM safe_fees WHERE coin IN ${sql()(coins)}`;
    await sql()`DELETE FROM bonus_cursor WHERE id = 'safe'`;
    await sql()`DELETE FROM projects WHERE program_id = ${tag}`;
    await sql()`DELETE FROM programs WHERE id = ${tag}`;
  };
  await clean();
  try {
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
      VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown')`;
    for (const [i, c] of coins.entries())
      await sql()`INSERT INTO projects (program_id, name, token_status, token_url, coin_address) VALUES (${tag}, ${`c${i}`}, 'launched', 'https://tokens.fun/x', ${c})`;
    return await fn();
  } finally {
    await clean();
  }
}
const safeRows = (coins: string[]) => sql()<{ tx_hash: string; log_index: number; coin: string; amount_wei: string }[]>`
  SELECT tx_hash, log_index, coin, amount_wei::text FROM safe_fees WHERE coin IN ${sql()(coins)} ORDER BY block_number, log_index`;

test('v2.13.2 2: indexSafeFees books the Safe\'s own deposits from EarnKit coins (both splits), idempotent, from its cursor', db, async () => {
  const c4 = coin('a');
  const c3 = coin('b');
  const other = coin('c');
  // 4-slot: the Safe 30, the bonus wallet 20 (and creator, MINI); 3-slot: the Safe 50; another coin: the Safe too.
  const t4 = tx(100n, [store(1, C.safe, 30n), store(2, CREATOR, 40n), store(3, BONUS, 20n), claimed(4, c4)]);
  const t3 = tx(150n, [store(1, C.safe, 50n), store(2, CREATOR, 40n), claimed(3, c3)]);
  const head = 200n + CONFIRMATIONS;
  const f = safeChain([t4, t3, tx(160n, [store(1, C.safe, 99n), claimed(2, other)])], head);
  await withCoins(`v2132-idx-${stamp}`, [c4, c3], async () => {
    const r1 = await indexSafeFees({ rpc: f.rpc, chain: C, startBlock: 50n, log: () => {} });
    assert.equal(bookedOf(r1), 2);
    assert.deepEqual((await safeRows([c4, c3, other])).map((r) => ({ ...r })), [
      { tx_hash: t4.hash.toLowerCase(), log_index: 1, coin: c4, amount_wei: '30' },
      { tx_hash: t3.hash.toLowerCase(), log_index: 1, coin: c3, amount_wei: '50' },
    ]);
    // Claims are read only across the deposits' blocks.
    assert.deepEqual(f.calls.claims, [[100n, 160n]]);
    const [cur] = await sql()<{ block: string }[]>`SELECT block::text FROM bonus_cursor WHERE id = 'safe'`;
    assert.equal(cur.block, String(head - CONFIRMATIONS));
    // From the cursor: nothing to read, nothing booked twice.
    const n = f.calls.stores.length;
    assert.equal(bookedOf(await indexSafeFees({ rpc: f.rpc, chain: C, startBlock: 50n, log: () => {} })), 0);
    assert.equal(f.calls.stores.length, n);
    // The same range read again (a lost cursor): idempotent.
    await sql()`DELETE FROM bonus_cursor WHERE id = 'safe'`;
    assert.equal(bookedOf(await indexSafeFees({ rpc: f.rpc, chain: C, startBlock: 50n, log: () => {} })), 0);
    // No reader for it: skipped, nothing read.
    const { safeStoreLogs: _, ...bare } = f.rpc as unknown as Record<string, unknown>;
    assert.deepEqual(await indexSafeFees({ rpc: bare as unknown as BonusRpc, chain: C, log: () => {} }), { skipped: 'no reader' });
  });
});

test('v2.13.2 review 1a: a range with no Safe deposits makes one read (no claims read)', db, async () => {
  const c4 = coin('d');
  // Only other owners' deposits and claims: the Safe got nothing in the range.
  const f = safeChain([tx(100n, [store(1, CREATOR, 40n), claimed(2, c4)])], 200n + CONFIRMATIONS);
  await withCoins(`v2132-one-${stamp}`, [c4], async () => {
    const r = await indexSafeFees({ rpc: f.rpc, chain: C, startBlock: 50n, log: () => {} });
    assert.equal(bookedOf(r), 0);
    assert.equal(f.calls.stores.length, 1);
    assert.equal(f.calls.claims.length, 0);
  });
});

test('v2.13.2 review 4 (M5): store logs first, then claim logs (the real order), several txs interleaved: attribution holds', db, async () => {
  const a = coin('e');
  const b = coin('f');
  // Two txs in one block and one later; each tx's Safe deposit belongs to the next claim of its locker in that tx.
  const t1 = tx(120n, [store(5, C.safe, 7n), claimed(6, a), store(7, C.safe, 9n), claimed(8, b)]);
  const t2 = tx(120n, [store(1, C.safe, 11n), claimed(2, b)]);
  const t3 = tx(130n, [store(3, C.safe, 13n), claimed(4, a)]);
  const f = safeChain([t1, t2, t3], 200n + CONFIRMATIONS);
  await withCoins(`v2132-ord-${stamp}`, [a, b], async () => {
    assert.equal(bookedOf(await indexSafeFees({ rpc: f.rpc, chain: C, startBlock: 50n, log: () => {} })), 4);
    const got = (await safeRows([a, b])).map((r) => `${r.tx_hash === t1.hash.toLowerCase() ? 't1' : r.tx_hash === t2.hash.toLowerCase() ? 't2' : 't3'}:${r.log_index}:${r.coin === a ? 'a' : 'b'}:${r.amount_wei}`).sort();
    assert.deepEqual(got, ['t1:5:a:7', 't1:7:b:9', 't2:1:b:11', 't3:3:a:13']);
  });
});

test('v2.13.2 review 1b: the step has its own slice and call cap; it stops at its slice', db, async () => {
  const c4 = coin('9');
  // 40 ranges of chain to read, each read 30 ms: a 100 ms slice stops long before the head.
  const head = BigInt(2_000 * 40) + CONFIRMATIONS;
  const f = safeChain([], head, { delayMs: 30 });
  await withCoins(`v2132-slice-${stamp}`, [c4], async () => {
    const r = await safeIndexStep({ rpc: f.rpc, chain: C, startBlock: 0n, safeIndexMs: 100, log: () => {} });
    const res = r.safe_index as { outOfTime?: boolean; next: bigint };
    assert.equal(res.outOfTime, true);
    assert.ok(f.calls.stores.length >= 1 && f.calls.stores.length <= 5, `${f.calls.stores.length} reads`);
    assert.equal(r.safe_index_failures, 0);
    // The per-run call cap: with no time limit, at most SAFE_INDEX_CALLS_PER_RUN ranges.
    await sql()`DELETE FROM bonus_cursor WHERE id = 'safe'`;
    const g = safeChain([], head);
    await safeIndexStep({ rpc: g.rpc, chain: C, startBlock: 0n, log: () => {} });
    assert.equal(g.calls.stores.length, SAFE_INDEX_CALLS_PER_RUN);
    assert.ok(SAFE_INDEX_MS <= 30_000);
  });
});

test('v2.13.2 review 3 (M3): safe_index failing INDEX_FAILED_RUNS runs in a row waits on the owner; one success resets it', db, async () => {
  const c4 = coin('8');
  const broken = { blockNumber: async () => { throw new Error('rpc down'); }, safeStoreLogs: async () => [], claimLogs: async () => [] } as unknown as BonusRpc;
  const err = console.error;
  console.error = () => {};
  try {
    await withCoins(`v2132-fail-${stamp}`, [c4], async () => {
      let last: Record<string, unknown> = {};
      for (let i = 1; i <= INDEX_FAILED_RUNS; i++) {
        last = await safeIndexStep({ rpc: broken, chain: C, log: () => {} });
        assert.equal(last.safe_index, 'failed');
        assert.equal(last.safe_index_failures, i);
      }
      assert.equal(bonusWaitsOnOwner({ index_failures: 0, ...last }), true);
      assert.equal(bonusWaitsOnOwner({ index_failures: 0, safe_index_failures: INDEX_FAILED_RUNS - 1 }), false);
      const ok = await safeIndexStep({ rpc: safeChain([], 100n).rpc, chain: C, startBlock: 0n, log: () => {} });
      assert.equal(ok.safe_index_failures, 0);
    });
  } finally {
    console.error = err;
  }
});

test('v2.13.2 fix 1 (concern 5): the fees_to_safe_eth label names both splits', () => {
  assert.equal(STATS_LABELS.fees_to_safe_eth, 'fees to the EarnKit Safe (ETH)');
});

// ---- v4.0 final review 3: the Safe's 60% of a builder token's fees is EarnKit revenue too.

test('v4.0 final review 3: indexSafeFees books the Safe\'s deposit from a launched builder token; never one still unknown', db, async () => {
  const bt = coin('d');
  const btUnknown = coin('e');
  const t1 = tx(100n, [store(1, C.safe, 60n), store(2, CREATOR, 40n), claimed(3, bt)]);
  const t2 = tx(120n, [store(1, C.safe, 61n), claimed(2, btUnknown)]);
  const f = safeChain([t1, t2], 200n + CONFIRMATIONS);
  const ids: number[] = [];
  try {
    for (const [status, c] of [['launched', bt], ['unknown', btUnknown]] as const) {
      const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v40-safe-${stamp}-${c}`}) RETURNING id`;
      ids.push(id);
      await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status, coin_address) VALUES (${id}, ${`x-safe-${id}`}, ${status}, ${status === 'launched' ? c : null})`;
    }
    await withCoins(`v40-idx-${stamp}`, [], async () => {
      assert.equal(bookedOf(await indexSafeFees({ rpc: f.rpc, chain: C, startBlock: 50n, log: () => {} })), 1);
      assert.deepEqual((await safeRows([bt, btUnknown])).map((r) => ({ ...r })), [{ tx_hash: t1.hash.toLowerCase(), log_index: 1, coin: bt, amount_wei: '60' }]);
    });
  } finally {
    await sql()`DELETE FROM safe_fees WHERE coin IN (${bt}, ${btUnknown})`;
    if (ids.length > 0) await sql()`DELETE FROM builder_tokens WHERE builder_id IN ${sql()(ids)}`;
  }
});

test('v4.0 final review 3: readStats counts the Safe\'s builder token fees, never a test installation\'s', db, async () => {
  const bt = coin('8');
  const btTest = coin('9');
  const h = (n: number) => `0x${stamp.padStart(60, '0')}${(0xb0 + n).toString(16).padStart(4, '0')}`;
  const Rollback = new Error('rollback');
  const prevEnv = process.env.EARNKIT_TEST_INSTALLATIONS;
  try {
    await sql().begin('isolation level repeatable read', async (tx) => {
      const [real] = await tx<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v40-st-${stamp}-r`}) RETURNING id`;
      const [testInst] = await tx<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v40-st-${stamp}-t`}) RETURNING id`;
      process.env.EARNKIT_TEST_INSTALLATIONS = String(testInst.id);
      await tx`INSERT INTO builder_tokens (builder_id, x_user_id, status, coin_address) VALUES
        (${real.id}, ${`x-st-${real.id}`}, 'launched', ${bt}), (${testInst.id}, ${`x-st-${testInst.id}`}, 'launched', ${btTest})`;
      const before = await readStats(new Date(), tx);
      await tx`INSERT INTO safe_fees (tx_hash, log_index, coin, amount_wei, block_time) VALUES
        (${h(1)}, 0, ${bt}, ${(6n * E18).toString()}, now()), (${h(2)}, 0, ${btTest}, ${(7n * E18).toString()}, now())`;
      const after = await readStats(new Date(), tx);
      assert.equal(Math.round((after.fees_to_safe_eth - before.fees_to_safe_eth) * 1e6) / 1e6, 6);
      throw Rollback;
    });
  } catch (err) {
    if (err !== Rollback) throw err;
  } finally {
    if (prevEnv === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = prevEnv;
  }
});
