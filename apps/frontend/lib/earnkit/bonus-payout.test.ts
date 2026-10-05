import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFunctionData, erc20Abi, keccak256, parseTransaction, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { paidBonusWins } from './alerts';
import { BASE_BONUS, FEE_LOCKER_ABI, bookDeposit, roundsCovered, runBonusLedger, type BonusRpc } from './bonus-ledger';
import {
  BONUS_SPLIT_BPS,
  CLAIM_PENDING,
  STORED_SEND_WAIT,
  advanceRounds,
  placesFor,
  splitPool,
  type BonusPayoutRow,
} from './bonus-payout';
import { runCron } from './cron';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';
import { NO_FINAL_READ_FLAG, scoreOpenRounds } from './traction';
import { BONUS_WALLET_UNSET } from './cron';
import { TOP_UP, payCampaign, payRanked, type PayoutRpc, type PayoutStore } from './payout';
import { VetoError, bonusReviewLink, vetoBonusEntry, vetoKey, vetoPost } from './veto';

const E18 = 10n ** 18n;
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

// ---- splitPool (the brief's arithmetic) ----

test('splitPool: sums exactly to the pool for 1, 3 and 10 places; [] for none; at most 10 places', () => {
  const pool = 1_234_567_890_123_456_789n;
  for (const n of [1, 3, 10]) {
    const out = splitPool(pool, n);
    assert.equal(out.length, n);
    assert.equal(sum(out), pool, `n = ${n}`);
    for (let i = 1; i < n; i++) assert.ok(out[i - 1] >= out[i], 'best place first');
  }
  assert.deepEqual(splitPool(pool, 1), [pool]);
  assert.deepEqual(splitPool(pool, 0), []);
  assert.deepEqual(splitPool(0n, 3), []);
  assert.equal(splitPool(pool, 25).length, 10);
  assert.equal(sum(splitPool(pool, 25)), pool);
  // Renormalized over 3: 2500 : 1800 : 1400 of the whole pool, rounding dust to first place.
  const three = splitPool(10_000n * 5_700n, 3);
  assert.deepEqual(three, [2500n * 10_000n, 1800n * 10_000n, 1400n * 10_000n]);
  assert.deepEqual(splitPool(10n, 3), [5n, 3n, 2n].map((x, i) => (i === 0 ? 10n - 3n - 2n : x)));
  assert.equal(BONUS_SPLIT_BPS.reduce((a, b) => a + b, 0), 10_000);
});

// ---- placesFor: who takes which frozen place (the review page and the payout agree) ----

const prow = (id: number, extra: Partial<BonusPayoutRow> = {}): BonusPayoutRow => ({
  id,
  project_id: id,
  rank: id,
  score: 100 - id,
  wallet: `0x${String(id).padStart(40, '0')}`,
  installation_id: id,
  flags: [],
  slot: null,
  amount_wei: null,
  status: null,
  tx_hash: null,
  raw_tx: null,
  stale_at: null,
  reverts: 0,
  paid_at: null,
  vetoed: false,
  veto_reason: null,
  ...extra,
});

test('placesFor: a veto moves the next entry up into the same frozen amounts (no re-split); one per wallet and installation', () => {
  const amounts = [50n, 30n, 20n];
  const rows = [prow(1), prow(2), prow(3), prow(4), prow(5)];
  assert.deepEqual(
    placesFor(rows, amounts).map((p) => [p.id, p.slot, p.amount]),
    [[1, 0, 50n], [2, 1, 30n], [3, 2, 20n]],
  );
  rows[1].vetoed = true;
  assert.deepEqual(
    placesFor(rows, amounts).map((p) => [p.id, p.slot, p.amount]),
    [[1, 0, 50n], [3, 1, 30n], [4, 2, 20n]],
    'the amounts stay the ones frozen at review open',
  );
  // Same wallet as #1 (another installation) or same installation as #1: skipped.
  const dup = [prow(1), prow(2, { wallet: prow(1).wallet }), prow(3, { installation_id: 1 }), prow(4)];
  assert.deepEqual(placesFor(dup, amounts).map((p) => p.id), [1, 4]);
  // No wallet, refused: never a place. A paid row keeps its stored place.
  const mixed = [prow(1, { wallet: null }), prow(2, { status: 'refused' }), prow(3, { slot: 0, tx_hash: '0xa', status: 'paid' }), prow(4)];
  assert.deepEqual(placesFor(mixed, amounts).map((p) => [p.id, p.slot]), [[3, 0], [4, 1]]);
});

// ---- payRanked: per-place amounts, any ERC-20, every v2.4 rule ----

const account = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'); // anvil #3
const TOKEN = '0x4200000000000000000000000000000000000006' as Hex;

function fakeRpc(o: { balance?: () => bigint; nonce?: number } = {}) {
  const sent: Hex[] = [];
  const receipts = new Map<Hex, { status: 'success' | 'reverted' }>();
  const rpc: PayoutRpc = {
    getChainId: async () => 8453,
    nonce: async () => o.nonce ?? 7,
    finalizedNonce: async () => 0,
    transaction: async (h) => receipts.has(h),
    finalReceipt: async () => true,
    fees: async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    estimateGas: async () => 50_000n,
    receipt: async (h) => receipts.get(h) ?? null,
    broadcast: async (raw) => {
      sent.push(raw);
      receipts.set(keccak256(raw), { status: 'success' });
      return 'sent';
    },
    waitFor: async (h) => receipts.get(h) ?? null,
    balanceOf: async () => (o.balance ? o.balance() : 10n ** 30n),
  };
  return { rpc, sent };
}
const memStore = () => {
  const calls: unknown[][] = [];
  const store: PayoutStore = {
    sending: async (id, hash, _raw, place) => { calls.push(['sending', id, place]); return true; },
    paid: async (id, amount) => { calls.push(['paid', id, amount]); },
    failed: async () => 0,
    refused: async (id) => { calls.push(['refused', id]); },
    stale: async () => {},
  };
  return { store, calls };
};
const transferOf = (raw: Hex) => {
  const tx = parseTransaction(raw);
  const { args } = decodeFunctionData({ abi: erc20Abi, data: tx.data! });
  return { to: tx.to, recipient: (args[0] as string).toLowerCase(), amount: args[1] as bigint, nonce: tx.nonce };
};
const rrow = (id: number, wallet = `0x${String(id).padStart(40, '0')}`, installation_id: number | null = id) => ({
  id, payout_wallet: wallet, installation_id, payout_status: null as string | null, prize_tx: null as string | null,
  prize_raw_tx: null as string | null, payout_stale_at: null as Date | null, slot: null as number | null,
});

test('payRanked: each place pays its own amount of any ERC-20; a listed wallet is refused and the next entry moves up', async () => {
  const f = fakeRpc();
  const s = memStore();
  const a = rrow(1);
  const b = rrow(2, a.payout_wallet, 9); // same wallet as a: never a second payout
  const c = rrow(3);
  const d = rrow(4);
  const r = await payRanked(
    { token: TOKEN, symbol: 'WETH', decimals: 18, amounts: [5n, 3n, 2n], perPlace: true },
    [a, b, c, d],
    (pool) => pool[0],
    { account, rpc: f.rpc, store: s.store, listed: async (w) => w === c.payout_wallet },
  );
  assert.deepEqual(r, { done: true, note: null });
  assert.deepEqual(f.sent.map(transferOf).map((t) => [t.to?.toLowerCase(), t.recipient, t.amount]), [
    [TOKEN.toLowerCase(), a.payout_wallet, 5n],
    [TOKEN.toLowerCase(), d.payout_wallet, 3n],
  ]);
  assert.deepEqual(s.calls, [
    ['sending', 1, { slot: 0, amount: '5' }],
    ['paid', 1, '5'],
    ['refused', 3],
    ['sending', 4, { slot: 1, amount: '3' }],
    ['paid', 4, '3'],
  ]);
});

test('payRanked: a transfer in flight is followed at its stored place amount; the wallet short of the next place stops with TOP_UP', async () => {
  const f = fakeRpc({ balance: () => 4n });
  const s = memStore();
  // A transfer for place 1 (3 wei) was stored by an earlier run: it is rebroadcast and recorded at 3.
  const signed = await account.signTransaction({
    chainId: 8453, type: 'eip1559', to: TOKEN, nonce: 7, gas: 60_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n,
    data: '0xa9059cbb' as Hex,
  });
  const inflight = { ...rrow(2), payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed, slot: 1 };
  const r = await payRanked(
    { token: TOKEN, symbol: 'WETH', decimals: 18, amounts: [5n, 3n], perPlace: true },
    [rrow(1), inflight],
    (pool) => pool[0],
    { account, rpc: f.rpc, store: s.store, listed: async () => false },
  );
  assert.deepEqual(s.calls[0], ['paid', 2, '3']);
  assert.equal(r.done, false);
  assert.ok(r.note?.includes('less than the next prize (0.000000000000000005)') && r.note.endsWith(TOP_UP), r.note ?? '');
});

test('payCampaign (v2.4) and payRanked never sign at or below another stored, unmined send (openSends nonce floor)', async () => {
  const f = fakeRpc({ nonce: 7 });
  const s = memStore();
  const campaign = {
    prize: { token: TOKEN, symbol: 'MINI', decimals: 18 },
    amount_each: '2',
    winners: 1,
    min_score: 1,
  };
  const entry = { ...rrow(1), score: 5, submitted_at: new Date(), vetoed_at: null };
  const r = await payCampaign(campaign, [entry], {
    account, rpc: f.rpc, store: s.store, listed: async () => false,
    openSends: async () => [{ raw: '0x01' as Hex, nonce: 20 }],
  });
  assert.equal(r.done, true);
  assert.equal(transferOf(f.sent[0]).nonce, 21);
  assert.equal(transferOf(f.sent[0]).amount, 2n * E18, 'amount_each, unchanged');
});

// ---- DB-gated: freeze, review, veto, pay ----

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
holdBonusDbLock();
const PID = 't7-bonus';
const PID_EMPTY = 't7-bonus-empty';
const ENDS = new Date('2026-11-01T00:00:00Z');
const STARTS = new Date('2026-10-01T00:00:00Z');
const at = (h: number) => new Date(ENDS.getTime() + h * 3_600_000);
const ACCOUNT = privateKeyToAccount(`0x${'5'.repeat(64)}`);
const BONUS = ACCOUNT.address.toLowerCase() as Hex;
const C = BASE_BONUS;
const quiet = () => {};

/** A chain for the pay step: WETH transfers move a balance; claim(bonus wallet) moves availableFees in. */
function chain(o: { balance?: bigint; available?: bigint; listed?: string[] } = {}) {
  const state = {
    balance: o.balance ?? 10n ** 24n,
    available: o.available ?? 0n,
    sent: [] as Hex[],
    mined: new Map<Hex, 'success' | 'reverted'>(),
    paidTo: new Map<string, bigint>(),
  };
  const rpc = {
    getChainId: async () => 8453,
    nonce: async () => state.sent.length,
    finalizedNonce: async () => state.sent.length,
    fees: async () => ({ maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1n }),
    estimateGas: async () => 50_000n,
    receipt: async (h: Hex) => (state.mined.has(h) ? { status: state.mined.get(h)! } : null),
    transaction: async (h: Hex) => state.sent.some((r) => keccak256(r) === h),
    finalReceipt: async () => true,
    broadcast: async (raw: Hex) => {
      if (state.sent.includes(raw)) return 'known' as const;
      state.sent.push(raw);
      const tx = parseTransaction(raw);
      if (tx.to?.toLowerCase() === C.feeLocker) {
        state.balance += state.available;
        state.available = 0n;
      } else {
        const { args } = decodeFunctionData({ abi: erc20Abi, data: tx.data! });
        const [to, amount] = args as [string, bigint];
        state.balance -= amount;
        state.paidTo.set(to.toLowerCase(), (state.paidTo.get(to.toLowerCase()) ?? 0n) + amount);
      }
      state.mined.set(keccak256(raw), 'success');
      return 'sent' as const;
    },
    waitFor: async (h: Hex) => (state.mined.has(h) ? { status: state.mined.get(h)! } : null),
    balanceOf: async () => state.balance,
    availableFees: async () => state.available,
  } as unknown as BonusRpc;
  const listed = async (w: string) => (o.listed ?? []).includes(w.toLowerCase());
  return { rpc, state, deps: (now: Date) => ({ rpc, chain: C, now, log: quiet, listed, only: [PID, PID_EMPTY] }) };
}

const W = (n: number) => `0x${'a'.repeat(38)}${String(n).padStart(2, '0')}`;

async function cleanup() {
  for (const id of [PID, PID_EMPTY]) {
    await sql()`DELETE FROM bonus_payouts WHERE round_key = ${id}`;
    await sql()`DELETE FROM bonus_vetoes WHERE round_key = ${id}`;
    await sql()`DELETE FROM bonus_scores WHERE round_key = ${id}`;
    await sql()`DELETE FROM bonus_ledger WHERE round_key = ${id}`;
    await sql()`DELETE FROM bonus_rounds WHERE round_key = ${id}`;
    await sql()`DELETE FROM projects WHERE program_id = ${id}`;
    await sql()`DELETE FROM programs WHERE id = ${id}`;
  }
  await sql()`DELETE FROM bonus_ledger WHERE tx_hash LIKE '0xt7%'`;
  await sql()`DELETE FROM bonus_sweeps`;
  await sql()`DELETE FROM bonus_cursor`;
  await sql()`DELETE FROM installations WHERE token_hash LIKE 't7-%'`;
  await sql()`DELETE FROM scoring_leases WHERE program_id IN ('bonus-ledger', 'bonus-scoring')`;
}

/**
 * A round with `n` eligible entries ranked by users (entry i has 100 − i users), each with a final
 * read, `pool` booked in two deposits, and the deposit index past the end when `indexed`.
 */
async function setup(o: { n: number; pool: bigint; indexed?: boolean; id?: string; flagged?: number[]; sameWallet?: [number, number] }) {
  const id = o.id ?? PID;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
      status, existing_work, starts_at, ends_at, submission_proof)
    VALUES (${id}, 'X', ${'Round ' + id}, 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed',
      ${STARTS}, ${ENDS}, ${sql().json({ host: 'x.example' })})`;
  await sql()`INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at) VALUES (${id}, ${id}, ${STARTS}, ${ENDS})`;
  const half = o.pool / 2n;
  for (const [i, amount] of [half, o.pool - half].entries())
    if (amount > 0n)
      await sql()`
        INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_number, block_time)
        VALUES (${`0xt7${id}${i}`}, 0, NULL, ${id}, 'round', ${amount.toString()}, ${i}, ${new Date('2026-10-10T00:00:00Z')})`;
  const ids: number[] = [];
  const [inst] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t7-${id}`}) RETURNING id`;
  for (let i = 1; i <= o.n; i++) {
    const wallet = o.sameWallet && i === o.sameWallet[1] ? W(o.sameWallet[0]) : W(i);
    const [p] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, coin_address, coin_launched_at, creator_wallet,
        submission_proof_ok_at, submitted_at, bonus_repo_key, installation_id)
      VALUES (${id}, ${'entry ' + i}, ${`https://github.com/t7/${id}-${i}`}, ${`0x${'c'.repeat(36)}${String(i).padStart(2, '0')}${id === PID ? '01' : '02'}`},
        ${new Date('2026-10-05T00:00:00Z')}, ${wallet}, ${new Date('2026-10-06T00:00:00Z')}, ${new Date(Date.UTC(2026, 9, 2, i))},
        ${`github.com/t7/${id}-${i}`}, ${i === 1 ? inst.id : null})
      RETURNING id`;
    ids.push(p.id);
    const signals = { users: 100 - i, liveRatio: 0, commitDays: 0, contributors: 0, interest: 0, holders: 0, marketCapUsd: 0 };
    const failed = o.flagged?.includes(i) ? ['github'] : [];
    const flags = i === 2 ? ['single_commit_streak'] : [];
    await sql()`
      INSERT INTO bonus_scores (round_key, project_id, day, signals, failed, through, review_flags)
      VALUES (${id}, ${p.id}, '2026-10-31', ${sql().json(signals)}, ${failed}, ${ENDS}, ${flags})`;
  }
  if (o.indexed !== false)
    await sql()`
      INSERT INTO bonus_cursor (id, block, block_time) VALUES ('weth', 100, ${at(1)})
      ON CONFLICT (id) DO UPDATE SET block = 100, block_time = EXCLUDED.block_time`;
  return { ids, installation: inst.id };
}
const round = async (id = PID) =>
  (await sql()<{ state: string; terms: { amounts: string[]; pool_wei: string; flagged: number[] } | null; review_until: Date | null; note: string | null }[]>`
    SELECT state, terms, review_until, note FROM bonus_rounds WHERE round_key = ${id}`)[0];
const payouts = (id = PID) =>
  sql()<{ project_id: number; rank: number; slot: number | null; amount_wei: string | null; status: string | null; wallet: string | null; flags: string[] }[]>`
    SELECT project_id, rank, slot, amount_wei::text AS amount_wei, status, wallet, flags FROM bonus_payouts WHERE round_key = ${id} ORDER BY rank`;
type Out = { rounds: { round: string; step: string; [k: string]: unknown }[]; needs_owner: string[] };

test('lifecycle: freeze once indexed past the end, 48 h review with frozen amounts, veto moves the next up, WETH paid per place, rest to the Safe', db, async () => {
  await cleanup();
  try {
    const pool = 10n * E18;
    const { ids, installation } = await setup({ n: 5, pool, indexed: false });
    const f = chain();
    // Ended, but the deposit index hasn't read past the end: the round stays open.
    let out = (await advanceRounds(ACCOUNT, f.deps(at(2)))) as Out;
    assert.equal(out.rounds[0].step, 'freeze-wait');
    assert.equal((await round()).state, 'open');
    await sql()`INSERT INTO bonus_cursor (id, block, block_time) VALUES ('weth', 100, ${at(1)})`;

    out = (await advanceRounds(ACCOUNT, f.deps(at(2)))) as Out;
    assert.equal(out.rounds[0].step, 'review');
    const r1 = await round();
    assert.equal(r1.state, 'review');
    assert.equal(r1.review_until?.getTime(), at(50).getTime());
    assert.deepEqual(r1.terms!.amounts, splitPool(pool, 5).map(String), 'renormalized over the 5 eligible');
    assert.equal(r1.terms!.pool_wei, pool.toString());
    const frozen = await payouts();
    assert.deepEqual(frozen.map((p) => p.project_id), ids, 'ranked by the final scores');
    assert.deepEqual(frozen[1].flags, ['single_commit_streak']);
    assert.equal(frozen[0].wallet, W(1));

    // A deposit after the end goes to the Safe; the frozen amounts never change.
    const late = await bookDeposit({ txHash: '0xt7late', logIndex: 0, amount: 5n * E18, coin: null, blockNumber: 101n, blockTime: at(3) }, quiet);
    assert.equal(late.destination, 'safe');
    await sql()`
      INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_time)
      VALUES ('0xt7late2', 0, NULL, NULL, 'safe', 1, ${at(3)})`;
    // During the review: wait. The owner removes #2 (public reason).
    out = (await advanceRounds(ACCOUNT, f.deps(at(10)))) as Out;
    assert.equal(out.rounds[0].step, 'wait');
    await sql()`UPDATE bonus_rounds SET review_until = now() + interval '1 hour' WHERE round_key = ${PID}`;
    await vetoBonusEntry(PID, ids[1], 'copied repo');
    await assert.rejects(vetoBonusEntry(PID, ids[1], 'again'), VetoError);
    await assert.rejects(vetoBonusEntry(PID, 999_999, 'not in it'), VetoError);
    await sql()`UPDATE bonus_rounds SET review_until = now() - interval '1 minute' WHERE round_key = ${PID}`;
    await assert.rejects(vetoBonusEntry(PID, ids[2], 'too late'), VetoError, 'closed review');
    await sql()`UPDATE bonus_rounds SET review_until = ${at(50)} WHERE round_key = ${PID}`;

    // After the review: paid in rank order, each place its frozen amount; #2 removed so #3..#5
    // move up; 5 places but 4 entries left: the last place's amount goes to the Safe.
    out = (await advanceRounds(ACCOUNT, f.deps(at(51)))) as Out;
    assert.equal(out.rounds[0].step, 'pay');
    assert.equal(out.rounds[0].done, true, JSON.stringify(out));
    const amounts = splitPool(pool, 5);
    assert.deepEqual(
      [W(1), W(3), W(4), W(5)].map((w) => f.state.paidTo.get(w)),
      [amounts[0], amounts[1], amounts[2], amounts[3]],
    );
    assert.equal(f.state.paidTo.get(W(2)), undefined);
    const paid = await payouts();
    assert.deepEqual(paid.filter((p) => p.status === 'paid').map((p) => [p.project_id, p.slot]), [[ids[0], 0], [ids[2], 1], [ids[3], 2], [ids[4], 3]]);
    assert.equal((await round()).state, 'paid');
    const [rest] = await sql()<{ amount_wei: string; destination: string }[]>`
      SELECT amount_wei::text, destination FROM bonus_ledger WHERE tx_hash = ${`round-rest:${PID}`}`;
    assert.deepEqual(rest, { amount_wei: amounts[4].toString(), destination: 'safe' });

    // Task 8's seam: the win alert reads these rows (installation of entry 1).
    const wins = await paidBonusWins(installation);
    assert.deepEqual(wins.map((w) => [w.project_id, w.amount_wei]), [[ids[0], amounts[0]]]);

    // Idempotent: a later run sends nothing; the paid round no longer counts as unpaid.
    const before = f.state.sent.length;
    out = (await advanceRounds(ACCOUNT, f.deps(at(52)))) as Out;
    assert.deepEqual(out.rounds, []);
    assert.equal(f.state.sent.length, before);
    assert.ok(await roundsCovered(ACCOUNT, { rpc: f.rpc, chain: C }, 0n, 0n), 'nothing of a paid round is owed');
  } finally {
    await cleanup();
  }
});

test('one payout per wallet and per installation per round; a sanctioned wallet is refused and the next moves up', db, async () => {
  await cleanup();
  try {
    const pool = 6n * E18;
    const { ids } = await setup({ n: 4, pool, sameWallet: [1, 2] });
    const f = chain({ listed: [W(3)] });
    let out = (await advanceRounds(ACCOUNT, f.deps(at(2)))) as Out;
    // 3 distinct wallets: 3 places.
    assert.deepEqual((await round()).terms!.amounts, splitPool(pool, 3).map(String));
    await sql()`UPDATE bonus_rounds SET review_until = ${at(3)} WHERE round_key = ${PID}`;
    out = (await advanceRounds(ACCOUNT, f.deps(at(4)))) as Out;
    assert.equal(out.rounds[0].done, true, JSON.stringify(out));
    const amounts = splitPool(pool, 3);
    assert.equal(f.state.paidTo.get(W(1)), amounts[0], 'entry 2 shares entry 1 wallet: skipped');
    assert.equal(f.state.paidTo.get(W(3)), undefined, 'sanctioned');
    assert.equal(f.state.paidTo.get(W(4)), amounts[1]);
    const rows = await payouts();
    assert.equal(rows.find((r) => r.project_id === ids[2])?.status, 'refused');
    const [rest] = await sql()<{ amount_wei: string }[]>`SELECT amount_wei::text FROM bonus_ledger WHERE tx_hash = ${`round-rest:${PID}`}`;
    assert.equal(rest.amount_wei, amounts[2].toString());
  } finally {
    await cleanup();
  }
});

test('an empty round (no eligible entry) books its pool to the Safe and is terminal; the sweep may take it', db, async () => {
  await cleanup();
  try {
    await setup({ n: 0, pool: 3n * E18, id: PID_EMPTY });
    const f = chain({ balance: 3n * E18 });
    const out = (await advanceRounds(ACCOUNT, f.deps(at(2)))) as Out;
    assert.equal(out.rounds[0].step, 'empty');
    assert.equal((await round(PID_EMPTY)).state, 'empty');
    const rows = await sql()<{ destination: string; round_key: string }[]>`SELECT destination, round_key FROM bonus_ledger WHERE round_key = ${PID_EMPTY}`;
    assert.ok(rows.length === 2 && rows.every((r) => r.destination === 'safe' && r.round_key === PID_EMPTY));
    assert.ok(await roundsCovered(ACCOUNT, { rpc: f.rpc, chain: C }, 3n * E18, 3n * E18), 'not counted as unpaid round money');
    assert.deepEqual((await advanceRounds(ACCOUNT, f.deps(at(3))) as Out).rounds, [], 'terminal');
  } finally {
    await cleanup();
  }
});

test('claim before paying: the wallet claims its FeeLocker WETH first; still short, the round waits on the owner (503)', db, async () => {
  await cleanup();
  try {
    const pool = 2n * E18;
    await setup({ n: 2, pool });
    const f = chain({ balance: 0n, available: E18 });
    await advanceRounds(ACCOUNT, f.deps(at(2)));
    await sql()`UPDATE bonus_rounds SET review_until = ${at(3)} WHERE round_key = ${PID}`;
    // 1 WETH claimable, 2 owed: the claim is sent, the wallet is still short: nothing is paid.
    let out = (await advanceRounds(ACCOUNT, f.deps(at(4)))) as Out;
    assert.equal(f.state.sent.length, 1);
    const claim = parseTransaction(f.state.sent[0]);
    assert.equal(claim.to?.toLowerCase(), C.feeLocker);
    assert.deepEqual(decodeFunctionData({ abi: FEE_LOCKER_ABI, data: claim.data! }).args.map((a) => String(a).toLowerCase()), [BONUS, C.weth]);
    assert.equal(out.rounds[0].done, false);
    assert.ok(String(out.rounds[0].note).endsWith(TOP_UP), String(out.rounds[0].note));
    assert.deepEqual(out.needs_owner, [PID]);
    assert.equal((await round()).state, 'paying');
    // The rest lands in the FeeLocker: the next run claims it and pays both places.
    f.state.available = E18;
    out = (await advanceRounds(ACCOUNT, f.deps(at(5)))) as Out;
    assert.equal(out.rounds[0].done, true, JSON.stringify(out));
    assert.deepEqual(out.needs_owner, []);
    assert.equal(f.state.paidTo.get(W(1)), splitPool(pool, 2)[0]);
    assert.equal(f.state.paidTo.get(W(2)), splitPool(pool, 2)[1]);
    assert.equal((await round()).note, null);
  } finally {
    await cleanup();
  }
});

test('Ruling 18: flagged entries (failed sources after the 24 h escape) put the round in needs_owner once', db, async () => {
  await cleanup();
  try {
    const { ids } = await setup({ n: 2, pool: E18, flagged: [2] });
    const f = chain();
    // Within 24 h of the end a failed final read still holds the freeze.
    let out = (await advanceRounds(ACCOUNT, f.deps(at(2)))) as Out;
    assert.equal(out.rounds[0].step, 'freeze-wait');
    out = (await advanceRounds(ACCOUNT, f.deps(at(25)))) as Out;
    assert.equal(out.rounds[0].step, 'review');
    assert.deepEqual(out.needs_owner, [PID]);
    assert.deepEqual((await round()).terms!.flagged, [ids[1]]);
    assert.deepEqual((await payouts())[1].flags, ['single_commit_streak', 'failed:github']);
    out = (await advanceRounds(ACCOUNT, f.deps(at(30)))) as Out;
    assert.equal(out.rounds[0].step, 'wait');
    assert.deepEqual(out.needs_owner, [], 'the next review run is not in needs_owner');
    assert.deepEqual(out.rounds[0].flagged, [ids[1]], 'still shown');
    const [{ flagged_notified_at }] = await sql()<{ flagged_notified_at: Date | null }[]>`
      SELECT flagged_notified_at FROM bonus_rounds WHERE round_key = ${PID}`;
    assert.equal(flagged_notified_at?.getTime(), at(25).getTime());
  } finally {
    await cleanup();
  }
});

test('the cron scores open rounds each run and runs the rounds step inside the bonus ledger; needs_owner is reported', db, async () => {
  await cleanup();
  try {
    await setup({ n: 1, pool: E18, flagged: [1] });
    const f = chain();
    const calls: string[] = [];
    const rpc = {
      ...f.rpc,
      blockNumber: async () => 0n,
      storeLogs: async () => [],
      receiptLogs: async () => ({ blockNumber: 0n, logs: [] }),
      blockTime: async () => at(1),
    } as BonusRpc;
    const out = await runCron({
      now: at(26),
      only: ['t7-none'],
      deps: {
        bonus: { account: ACCOUNT, rpc, chain: C, log: quiet, active: async () => false },
        rounds: { only: [PID] },
        traction: { only: ['t7-none'], users: async () => { calls.push('users'); return { score: 0, timedOut: false }; } },
      },
    });
    assert.ok(Array.isArray(out.bonus_scoring), 'scored');
    const rounds = (out.bonus as { rounds: Out }).rounds;
    assert.equal(rounds.rounds[0].step, 'review');
    assert.deepEqual(out.needs_owner, [`bonus:${PID}`]);
  } finally {
    await cleanup();
  }
});

test('bonus veto POST: per-round key (never a campaign key), the round review page; GET never removes', db, async () => {
  const secret = process.env.ADMIN_VETO_SECRET;
  process.env.ADMIN_VETO_SECRET = 'x'.repeat(40);
  try {
    const key = vetoKey(`bonus:${PID}`)!;
    assert.notEqual(key, vetoKey(PID));
    assert.equal(bonusReviewLink('https://earnkit.com/', PID), `https://earnkit.com/admin/bonus/${PID}?key=${key}`);
    const post = (form: Record<string, string>) =>
      vetoPost(new Request('https://earnkit.com/api/admin/veto', { method: 'POST', body: new URLSearchParams(form) }), {
        limit: async () => {},
        vetoBonus: async (r, id) => { seen.push([r, id]); },
      });
    const seen: [string, number][] = [];
    assert.equal((await post({ round: PID, key: vetoKey(PID)!, entry: '3' })).status, 404, 'a campaign key never vetoes a round');
    const ok = await post({ round: PID, key, entry: '3', reason: 'x' });
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), `/admin/bonus/${PID}?key=${encodeURIComponent(key)}&removed=3`);
    assert.deepEqual(seen, [[PID, 3]]);
  } finally {
    if (secret === undefined) delete process.env.ADMIN_VETO_SECRET;
    else process.env.ADMIN_VETO_SECRET = secret;
  }
  const page = readFileSync(join(import.meta.dirname, '../../app/admin/bonus/[round]/page.tsx'), 'utf8');
  assert.match(page, /method="post"/);
  assert.match(page, /enforce\('veto', /);
  assert.doesNotMatch(page, /vetoBonusEntry/);
  assert.match(page, /isn(?:'|&apos;)t affiliated with or endorsed by the organizer/);
  assert.match(page, /single-commit streak/);
  assert.match(page, /failed source/);
});

test('POST /api/cron answers with the ledger bigints as strings (Response.json alone throws on them), 503 for a waiting round', async () => {
  const { cronPost } = await import('./cron');
  const secret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 's'.repeat(40);
  try {
    const res = await cronPost(
      new Request('https://earnkit.com/api/cron', { method: 'POST', headers: { authorization: `Bearer ${'s'.repeat(40)}` } }),
      { limit: async () => {}, run: async () => ({ bonus: { index: { from: 5n, to: 9n } }, needs_owner: ['bonus:r'] }) },
    );
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { bonus: { index: { from: '5', to: '9' } }, needs_owner: ['bonus:r'] });
  } finally {
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
  }
});

// ---- fix round 1 ----

test('(a) a stored send not rebroadcast this run: the rounds step only follows (no claim, nothing new signed)', db, async () => {
  await cleanup();
  try {
    await setup({ n: 1, pool: E18 });
    const f = chain({ balance: 0n, available: E18 });
    await advanceRounds(ACCOUNT, f.deps(at(2)));
    await sql()`UPDATE bonus_rounds SET review_until = ${at(3)} WHERE round_key = ${PID}`;
    // Direct: followOnly signs nothing, claims nothing.
    const out = (await advanceRounds(ACCOUNT, { ...f.deps(at(4)), followOnly: true })) as Out;
    assert.equal(f.state.sent.length, 0);
    assert.equal(out.rounds[0].note, STORED_SEND_WAIT);
    assert.deepEqual(out.needs_owner, []);
    // Through the ledger: a stored sweep whose rebroadcast fails makes the hook follow only.
    const raw = await ACCOUNT.signTransaction({
      chainId: 8453, type: 'eip1559', to: C.weth, nonce: 0, gas: 60_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, data: '0x',
    });
    await sql()`INSERT INTO bonus_sweeps (amount_wei, to_wallet, status, tx_hash, raw_tx) VALUES (1, ${C.safe}, 'sending', ${keccak256(raw)}, ${raw})`;
    const seen: boolean[] = [];
    const rpc = {
      ...f.rpc,
      blockNumber: async () => 0n,
      storeLogs: async () => [],
      broadcast: async () => { throw new Error('rpc down'); },
    } as BonusRpc;
    const err = console.error;
    console.error = () => {};
    try {
      await runBonusLedger({ account: ACCOUNT, rpc, chain: C, now: at(4), log: quiet, rounds: async (_a, d) => { seen.push(d.followOnly); } });
    } finally {
      console.error = err;
    }
    assert.deepEqual(seen, [true]);
  } finally {
    await cleanup();
  }
});

test('(b) the pay-time claim is skipped when it can neither cover what is owed nor is worth 10x gas', db, async () => {
  await cleanup();
  try {
    await setup({ n: 1, pool: E18 });
    const f = chain({ balance: 0n, available: 1n });
    await advanceRounds(ACCOUNT, f.deps(at(2)));
    await sql()`UPDATE bonus_rounds SET review_until = ${at(3)} WHERE round_key = ${PID}`;
    const out = (await advanceRounds(ACCOUNT, f.deps(at(4)))) as Out;
    assert.equal(f.state.sent.length, 0, 'no claim of 1 wei');
    assert.ok(String(out.rounds[0].note).endsWith(TOP_UP));
    // Enough in the FeeLocker to cover it: claimed, then paid.
    f.state.available = E18;
    const out2 = (await advanceRounds(ACCOUNT, f.deps(at(5)))) as Out;
    assert.equal(out2.rounds[0].done, true, JSON.stringify(out2.rounds));
  } finally {
    await cleanup();
  }
});

test('(c) freeze-side failures are counted; 6 in a row wait on the owner; a completed check resets them', db, async () => {
  await cleanup();
  try {
    await setup({ n: 1, pool: E18 });
    const f = chain();
    const broken = async () => { throw new Error('db hiccup'); };
    const err = console.error;
    console.error = () => {};
    let out: Out | undefined;
    try {
      for (let i = 1; i <= 6; i++) {
        out = (await advanceRounds(ACCOUNT, { ...f.deps(at(2)), ready: broken })) as Out;
        assert.equal(out.rounds[0].freeze_failures, i);
        assert.deepEqual(out.needs_owner, i < 6 ? [] : [PID]);
      }
    } finally {
      console.error = err;
    }
    out = (await advanceRounds(ACCOUNT, f.deps(at(2)))) as Out;
    assert.equal(out.rounds[0].step, 'review');
    const [{ freeze_failures }] = await sql()<{ freeze_failures: number }[]>`SELECT freeze_failures FROM bonus_rounds WHERE round_key = ${PID}`;
    assert.equal(freeze_failures, 0);
  } finally {
    await cleanup();
  }
});

test('(d) an ended round while the ledger is skipped (no payout key) waits on the owner: payout wallet not configured', db, async () => {
  await cleanup();
  try {
    await setup({ n: 1, pool: E18 });
    const out = await runCron({ now: at(2), only: ['t7-none'], deps: { bonus: { account: null } } });
    assert.ok(out.needs_owner.includes(BONUS_WALLET_UNSET), JSON.stringify(out.needs_owner));
    assert.equal(BONUS_WALLET_UNSET.includes('payout wallet not configured'), true);
    // Ruling 20: before any round ends, the skip waits on the owner too: EarnKit coins exist and
    // the program has a builder bonus, so fees would go unbooked.
    const before = await runCron({ now: new Date('2026-10-15T00:00:00Z'), only: ['t7-none'], deps: { bonus: { account: null } } });
    assert.ok(before.needs_owner.includes(BONUS_WALLET_UNSET), JSON.stringify(before.needs_owner));
  } finally {
    await cleanup();
  }
});

test('(f) a round veto racing the switch to paying waits for it and is then refused (never paid-and-vetoed)', db, async () => {
  await cleanup();
  try {
    const { ids } = await setup({ n: 2, pool: E18 });
    await advanceRounds(ACCOUNT, chain().deps(at(2)));
    await sql()`UPDATE bonus_rounds SET review_until = now() + interval '1 hour' WHERE round_key = ${PID}`;
    let veto: Promise<unknown> | undefined;
    await sql().begin(async (tx) => {
      // The cron's switch to paying, not yet committed.
      await tx`UPDATE bonus_rounds SET state = 'paying' WHERE round_key = ${PID}`;
      veto = vetoBonusEntry(PID, ids[0], 'late').then(() => 'removed', (e) => e);
      await new Promise((r) => setTimeout(r, 200));
    });
    assert.ok((await veto) instanceof VetoError);
    const rows = await sql()`SELECT 1 FROM bonus_vetoes WHERE round_key = ${PID}`;
    assert.equal(rows.length, 0);
  } finally {
    await cleanup();
  }
});

test('(2, e) the round review page links stored URLs only through shownUrl, and a bad round escape is a 404 after the rate limit', () => {
  const page = readFileSync(join(import.meta.dirname, '../../app/admin/bonus/[round]/page.tsx'), 'utf8');
  assert.match(page, /shownUrl\(f\?\.live_url\)/);
  assert.match(page, /shownUrl\(f\?\.repo_url\)/);
  assert.doesNotMatch(page, /href=\{f\?\./);
  assert.match(page, /try \{\s*round = decodeURIComponent\(raw\);\s*\} catch \{\s*notFound\(\);/);
  assert.ok(page.indexOf("enforce('veto'") < page.indexOf('decodeURIComponent'));
});

// ---- Final fix wave ---------------------------------------------------------------------------

test('M14: a follow-only pass that follows the last transfer to paid reports the payout done in the same run', async () => {
  const f = fakeRpc();
  const s = memStore();
  const signed = await account.signTransaction({
    chainId: 8453, type: 'eip1559', to: TOKEN, nonce: 7, gas: 60_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n,
    data: '0xa9059cbb' as Hex,
  });
  const paid = { ...rrow(1), payout_status: 'paid', prize_tx: '0xaa', prize_raw_tx: null, slot: 0 };
  const inflight = { ...rrow(2), payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed, slot: 1 };
  const r = await payRanked(
    { token: TOKEN, symbol: 'WETH', decimals: 18, amounts: [5n, 3n], perPlace: true },
    [paid, inflight, rrow(3)],
    (pool) => pool[0],
    { account, rpc: f.rpc, store: s.store, listed: async () => false, followOnly: true },
  );
  assert.deepEqual(r, { done: true, note: null });
  assert.deepEqual(s.calls, [['paid', 2, '3']], 'followed; nothing new signed');
  // With a free place left, a follow-only pass still signs nothing and is not done.
  const s2 = memStore();
  const r2 = await payRanked(
    { token: TOKEN, symbol: 'WETH', decimals: 18, amounts: [5n, 3n], perPlace: true },
    [paid, rrow(3)],
    (pool) => pool[0],
    { account, rpc: f.rpc, store: s2.store, listed: async () => false, followOnly: true },
  );
  assert.deepEqual(r2, { done: false, note: null });
  assert.deepEqual(s2.calls, []);
});

test('M3: a pay-step claim not mined yet waits a run; it is never a top-up (no 503)', db, async () => {
  await cleanup();
  try {
    await setup({ n: 2, pool: 2n * E18 });
    const f = chain({ balance: 0n, available: 2n * E18 });
    await advanceRounds(ACCOUNT, f.deps(at(2)));
    await sql()`UPDATE bonus_rounds SET review_until = ${at(3)} WHERE round_key = ${PID}`;
    // The claim is accepted but not mined within the wait: the wallet still reads 0.
    const pending = { ...f.rpc, broadcast: async (raw: Hex) => { f.state.sent.push(raw); return 'sent' as const; }, waitFor: async () => null };
    const out = (await advanceRounds(ACCOUNT, { ...f.deps(at(4)), rpc: pending as BonusRpc })) as Out;
    assert.equal(f.state.sent.length, 1, 'the claim only');
    assert.equal(out.rounds[0].done, false);
    assert.ok(String(out.rounds[0].note).includes(CLAIM_PENDING), String(out.rounds[0].note));
    assert.ok(!String(out.rounds[0].note).includes(TOP_UP));
    assert.deepEqual(out.needs_owner, []);
  } finally {
    await cleanup();
  }
});

test('Ruling 23: an eligible entry with no final read, 25 h after the end, is ranked last with score 0 and waits on the owner once', db, async () => {
  await cleanup();
  try {
    const { ids } = await setup({ n: 3, pool: E18 });
    // Entry 1 (the best on users) was never read at all.
    await sql()`DELETE FROM bonus_scores WHERE round_key = ${PID} AND project_id = ${ids[0]}`;
    const f = chain();
    let out = (await advanceRounds(ACCOUNT, f.deps(at(2)))) as Out;
    assert.equal(out.rounds[0].step, 'freeze-wait');
    assert.deepEqual(out.rounds[0].pending, [ids[0]]);
    out = (await advanceRounds(ACCOUNT, f.deps(at(25)))) as Out;
    assert.equal(out.rounds[0].step, 'review', 'never waits forever');
    assert.deepEqual(out.needs_owner, [PID]);
    const rows = await payouts();
    assert.deepEqual(rows.map((r) => r.project_id), [ids[1], ids[2], ids[0]], 'ranked last');
    assert.deepEqual(rows[2].flags, [NO_FINAL_READ_FLAG]);
    assert.deepEqual((await round()).terms!.flagged, [ids[0]]);
    out = (await advanceRounds(ACCOUNT, f.deps(at(26)))) as Out;
    assert.deepEqual(out.needs_owner, [], 'once per round');
  } finally {
    await cleanup();
  }
});

test('Ruling 23: an ended round whose final scoring throws waits on the owner once per round', db, async () => {
  await cleanup();
  try {
    await setup({ n: 1, pool: E18 });
    const err = console.error;
    console.error = () => {};
    try {
      const failing = async () => {
        throw new Error('bonus_scores insert failed');
      };
      const before: string[] = [];
      await scoreOpenRounds({ now: new Date('2026-10-20T00:00:00Z'), only: [PID], score: failing, needsOwner: before });
      assert.deepEqual(before, [], 'before the end: retried quietly');
      const first: string[] = [];
      const out = await scoreOpenRounds({ now: at(2), only: [PID], score: failing, needsOwner: first });
      assert.deepEqual(out, [{ round: PID, error: 'scoring failed; retried next run' }]);
      assert.deepEqual(first, [PID]);
      const second: string[] = [];
      await scoreOpenRounds({ now: at(3), only: [PID], score: failing, needsOwner: second });
      assert.deepEqual(second, []);
      // Through the cron: the round shows in needs_owner (503) on that first failing run.
      await sql()`UPDATE bonus_rounds SET score_error_notified_at = NULL WHERE round_key = ${PID}`;
      const cron = await runCron({ now: at(4), only: ['t7-none'], deps: { traction: { only: [PID], score: failing } } });
      assert.ok(cron.needs_owner.includes(`bonus:${PID}`), JSON.stringify(cron.needs_owner));
    } finally {
      console.error = err;
    }
  } finally {
    await cleanup();
  }
});
