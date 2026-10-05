import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, erc20Abi, http, toHex, type Abi, type Hex } from 'viem';
import { mnemonicToAccount, type LocalAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { CONFIRMATIONS, bonusRpc, runBonusLedger, type BonusChain } from './bonus-ledger';
import { windowKey } from './bonus-rounds';
import { advanceRounds, splitPool } from './bonus-payout';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';

/**
 * The builder bonus round lifecycle against a real chain on anvil (v2.5 §7 local e2e, payout part):
 * mock WETH, FeeLocker and an LP locker (contracts/test/mocks/BonusMocks.sol); fees collected and
 * booked to the round, a deposit after the end booked to the Safe and swept, the freeze, the 48 h
 * review, then real WETH transfers from the bonus wallet to each winner's creator wallet at the
 * frozen amounts, once. Runs only with BONUS_ANVIL_URL (anvil --chain-id 8453) and a local
 * DATABASE_URL, as bonus-ledger.anvil.test.ts.
 */
const URL = process.env.BONUS_ANVIL_URL;
const gate = {
  skip:
    (!URL && 'no BONUS_ANVIL_URL') ||
    (!process.env.DATABASE_URL && 'no DATABASE_URL') ||
    (URL && !/^http:\/\/127\.0\.0\.1:\d+$/.test(URL) && 'BONUS_ANVIL_URL must be a local anvil'),
};
holdBonusDbLock();

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const MNEMONIC = 'test test test test test test test test test test test junk';
const DEPLOYER = mnemonicToAccount(MNEMONIC, { addressIndex: 0 });
const PAYOUT = mnemonicToAccount(MNEMONIC, { addressIndex: 1 }); // = the bonus wallet
const SAFE = '0xc8a889577446153e28d42254b75238ae31ec7d57';
const CREATOR = '0x1111111111111111111111111111111111111111';
const MINI = '0x2222222222222222222222222222222222222222';
const WIN_A = '0x5555555555555555555555555555555555555501';
const WIN_B = '0x5555555555555555555555555555555555555502';
const COIN_A = '0xaaaa00000000000000000000000000000000007a';
const COIN_B = '0xbbbb00000000000000000000000000000000007b';
const PROG = 't7-anvil';
const E18 = 10n ** 18n;

async function cleanup() {
  await sql()`DELETE FROM bonus_payouts WHERE round_key IN (SELECT round_key FROM bonus_rounds WHERE program_id = ${PROG})`;
  await sql()`DELETE FROM bonus_vetoes WHERE round_key IN (SELECT round_key FROM bonus_rounds WHERE program_id = ${PROG})`;
  await sql()`DELETE FROM bonus_scores WHERE round_key IN (SELECT round_key FROM bonus_rounds WHERE program_id = ${PROG})`;
  await sql()`DELETE FROM bonus_ledger`;
  await sql()`DELETE FROM bonus_sweeps`;
  await sql()`DELETE FROM bonus_cursor`;
  await sql()`DELETE FROM bonus_rounds WHERE program_id = ${PROG}`;
  await sql()`DELETE FROM projects WHERE program_id = ${PROG}`;
  await sql()`DELETE FROM programs WHERE id = ${PROG}`;
  await sql()`DELETE FROM scoring_leases WHERE program_id = 'bonus-ledger'`;
}

test('anvil: fees booked to a round, freeze, review, WETH paid per place to creator wallets once; a late deposit swept to the Safe', gate, async () => {
  const pc = createPublicClient({ chain: base, transport: http(URL) });
  const rpc = (method: string, params: unknown[] = []) => pc.request({ method: method as never, params: params as never });
  assert.equal(await pc.getChainId(), 8453, 'start anvil with --chain-id 8453');
  await rpc('anvil_reset');
  await rpc('anvil_setBalance', [PAYOUT.address, toHex(E18)]);
  await cleanup();
  try {
    await scenario();
  } finally {
    await cleanup();
  }
});

async function scenario() {
  const pc = createPublicClient({ chain: base, transport: http(URL) });
  const rpc = (method: string, params: unknown[] = []) => pc.request({ method: method as never, params: params as never });
  execFileSync('forge', ['build', '--root', join(ROOT, 'contracts')], { stdio: 'ignore' });
  const art = (name: string) =>
    JSON.parse(readFileSync(join(ROOT, 'contracts', 'out', 'BonusMocks.sol', `${name}.json`), 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  const wc = createWalletClient({ account: DEPLOYER, chain: base, transport: http(URL) });
  const deploy = async (name: string, args: unknown[] = []) => {
    const a = art(name);
    const hash = await wc.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
    return (await pc.waitForTransactionReceipt({ hash })).contractAddress!.toLowerCase() as Hex;
  };
  const call = async (address: Hex, name: string, functionName: string, args: unknown[]) => {
    const hash = await wc.writeContract({ address, abi: art(name).abi, functionName, args });
    assert.equal((await pc.waitForTransactionReceipt({ hash })).status, 'success', functionName);
  };
  const weth = await deploy('MockWETH');
  const feeLocker = await deploy('MockFeeLocker');
  const locker = await deploy('MockLpLocker', [feeLocker, weth]);
  const chain: BonusChain = { feeLocker, lockers: [locker], weth, safe: SAFE };
  const split = [[SAFE, CREATOR, MINI, PAYOUT.address], [3000, 4000, 1000, 2000]];
  await call(locker, 'MockLpLocker', 'register', [COIN_A, ...split]);
  await call(locker, 'MockLpLocker', 'register', [COIN_B, ...split]);

  await rpc('evm_mine');
  const t0 = new Date(Number((await pc.getBlock()).timestamp) * 1000);
  const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);
  // The program's round (Ruling 21): keyed by its window's UTC start day.
  const ROUND = windowKey(PROG, h(-1));
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
      status, existing_work, starts_at, ends_at, submission_proof)
    VALUES (${PROG}, 'X', 'T7 anvil', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed',
      ${h(-1)}, ${h(2)}, ${sql().json({ host: 'x.example' })})`;
  const ids: number[] = [];
  for (const [i, coin, wallet] of [[1, COIN_A, WIN_A], [2, COIN_B, WIN_B]] as const) {
    const [p] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, coin_address, coin_launched_at, creator_wallet, submission_proof_ok_at,
        submitted_at, bonus_repo_key)
      VALUES (${PROG}, ${'t7 ' + i}, ${'https://github.com/t7/anvil' + i}, ${coin}, ${h(-0.5)}, ${wallet}, ${h(-0.5)}, ${h(-0.5)},
        ${'github.com/t7/anvil' + i})
      RETURNING id`;
    ids.push(p.id);
  }

  // In the round: A and B collected in one transaction (bonus wallet: 0.2 + 0.4 WETH).
  await call(locker, 'MockLpLocker', 'accrue', [COIN_A, 1n * E18]);
  await call(locker, 'MockLpLocker', 'accrue', [COIN_B, 2n * E18]);
  await call(locker, 'MockLpLocker', 'collectMany', [[COIN_A, COIN_B]]);
  await rpc('anvil_mine', [toHex(CONFIRMATIONS)]);
  const deps = (now: Date) => ({
    account: PAYOUT,
    rpc: bonusRpc(URL, chain),
    chain,
    startBlock: 0n,
    now,
    log: () => {},
    active: async () => false,
    rounds: (account: LocalAccount, d: Parameters<typeof advanceRounds>[1]) => advanceRounds(account, { ...d, listed: async () => false, only: [ROUND] }),
  });
  type Run = { index: { round: number; safe: number }; rounds: { rounds: { step: string; done?: boolean }[] }; sweep: { status?: string; result: string } };
  const r1 = (await runBonusLedger(deps(h(1)))) as unknown as Run;
  assert.equal(r1.index.round, 2);
  assert.deepEqual(r1.rounds.rounds, [], 'nothing has ended');
  const pool = (3n * E18) / 5n;

  // Final reads (the scoring is unit-tested in traction.test.ts): A ahead of B.
  for (const [id, users] of [[ids[0], 9], [ids[1], 4]] as const)
    await sql()`
      INSERT INTO bonus_scores (round_key, project_id, day, signals, failed, through)
      VALUES (${ROUND}, ${id}, ${h(1).toISOString().slice(0, 10)},
        ${sql().json({ users, liveRatio: 0, commitDays: 0, contributors: 0, interest: 0, holders: 0, marketCapUsd: 0 })}, '{}', ${h(2)})`;

  // After the end: A earns more; its deposit is the Safe's. The index reads past the end: freeze.
  await rpc('evm_increaseTime', [3 * 3600]);
  await call(locker, 'MockLpLocker', 'accrue', [COIN_A, 1n * E18]);
  await call(locker, 'MockLpLocker', 'collectRewards', [COIN_A]);
  await rpc('anvil_mine', [toHex(CONFIRMATIONS)]);
  const r2 = (await runBonusLedger(deps(h(4)))) as unknown as Run;
  assert.equal(r2.index.safe, 1, 'the late deposit is booked to the Safe');
  assert.equal(r2.rounds.rounds[0].step, 'review', JSON.stringify(r2.rounds));
  const [round] = await sql()<{ state: string; terms: { amounts: string[]; pool_wei: string } }[]>`
    SELECT state, terms FROM bonus_rounds WHERE round_key = ${ROUND}`;
  assert.equal(round.terms.pool_wei, pool.toString());
  const amounts = splitPool(pool, 2);
  assert.deepEqual(round.terms.amounts, amounts.map(String));
  assert.equal(r2.sweep.status, 'paid', `the late 0.2 WETH goes to the Safe: ${r2.sweep.result}`);

  const bal = (who: string) => pc.readContract({ address: weth, abi: erc20Abi, functionName: 'balanceOf', args: [who as Hex] });
  assert.equal(await bal(PAYOUT.address), pool, 'the bonus wallet holds exactly the frozen pool');

  // During the review: nothing is paid. After it: one WETH transfer per place.
  const r3 = (await runBonusLedger(deps(h(30)))) as unknown as Run;
  assert.equal(r3.rounds.rounds[0].step, 'wait');
  const r4 = (await runBonusLedger(deps(h(53)))) as unknown as Run;
  assert.equal(r4.rounds.rounds[0].done, true, JSON.stringify(r4.rounds));
  assert.equal(await bal(WIN_A), amounts[0]);
  assert.equal(await bal(WIN_B), amounts[1]);
  assert.equal(await bal(PAYOUT.address), 0n);
  const paid = await sql()<{ project_id: number; tx_hash: string; status: string }[]>`
    SELECT project_id, tx_hash, status FROM bonus_payouts WHERE round_key = ${ROUND} ORDER BY rank`;
  assert.deepEqual(paid.map((p) => [p.project_id, p.status]), [[ids[0], 'paid'], [ids[1], 'paid']]);
  for (const p of paid) assert.equal((await pc.getTransactionReceipt({ hash: p.tx_hash as Hex })).status, 'success');

  // Idempotent: a later run signs nothing.
  const nonce = await pc.getTransactionCount({ address: PAYOUT.address });
  const r5 = (await runBonusLedger(deps(h(54)))) as unknown as Run;
  assert.deepEqual(r5.rounds.rounds, []);
  assert.equal(await pc.getTransactionCount({ address: PAYOUT.address }), nonce);
}
