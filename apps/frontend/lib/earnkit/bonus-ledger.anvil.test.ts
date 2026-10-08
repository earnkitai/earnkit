import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, erc20Abi, http, toHex, type Abi, type Hex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { CONFIRMATIONS, bonusRpc, runBonusLedger, type BonusChain } from './bonus-ledger';
import { windowKey } from './bonus-rounds';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';

/**
 * The builder bonus ledger against real logs on anvil (v2.5 §7 local e2e, ledger part): mock WETH,
 * FeeLocker and two Clanker LP lockers (contracts/test/mocks/BonusMocks.sol), real StoreTokens /
 * ClaimedRewards receipts, real getLogs with indexed topics, real claims, collect and sweep. Runs
 * only with BONUS_ANVIL_URL (an anvil started with --chain-id 8453) and a local DATABASE_URL:
 *   anvil --port 8562 --chain-id 8453
 *   BONUS_ANVIL_URL=http://127.0.0.1:8562 DATABASE_URL=postgres://... pnpm -s test
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
const COIN_A = '0xaaaa00000000000000000000000000000000000a'; // program with an open round
const COIN_C = '0xcccc00000000000000000000000000000000000c'; // same program, collected in the same tx
const COIN_B = '0xbbbb00000000000000000000000000000000000b'; // legacy locker; its program ended
const PROG = 't4-anvil-open';
const PROG_ENDED = 't4-anvil-ended';
const E18 = 10n ** 18n;
type Run = {
  index: { round: number; safe: number };
  claim: { role: string; result: string }[];
  collect: { coin: string; result: string }[];
  sweep: { result: string; status?: string };
};

async function cleanup() {
  await sql()`DELETE FROM fee_claims WHERE owner IN (${CREATOR}, ${MINI}, ${SAFE}, ${PAYOUT.address.toLowerCase()})`;
  await sql()`DELETE FROM bonus_ledger`;
  await sql()`DELETE FROM bonus_sweeps`;
  await sql()`DELETE FROM bonus_cursor`;
  await sql()`DELETE FROM bonus_rounds WHERE program_id LIKE 't4-anvil%'`;
  await sql()`DELETE FROM projects WHERE program_id LIKE 't4-anvil%'`;
  await sql()`DELETE FROM programs WHERE id LIKE 't4-anvil%'`;
  await sql()`DELETE FROM scoring_leases WHERE program_id = 'bonus-ledger'`;
}

test('anvil: index, attribute (two coins in one tx, a bare deposit), claim, sweep to the Safe, collect near the end', gate, async () => {
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
    const r = await pc.waitForTransactionReceipt({ hash });
    assert.equal(r.status, 'success', functionName);
    return r;
  };
  const weth = await deploy('MockWETH');
  const feeLocker = await deploy('MockFeeLocker');
  const newLocker = await deploy('MockLpLocker', [feeLocker, weth]);
  const oldLocker = await deploy('MockLpLocker', [feeLocker, weth]);
  const chain: BonusChain = { feeLocker, lockers: [newLocker, oldLocker], weth, safe: SAFE };
  const split = [[SAFE, CREATOR, MINI, PAYOUT.address], [3000, 4000, 1000, 2000]];
  await call(newLocker, 'MockLpLocker', 'register', [COIN_A, ...split]);
  await call(newLocker, 'MockLpLocker', 'register', [COIN_C, ...split]);
  await call(oldLocker, 'MockLpLocker', 'register', [COIN_B, ...split]);

  // A fresh block, so t0 is chain time now (not an old genesis timestamp after anvil_reset).
  await rpc('evm_mine');
  const t0 = new Date(Number((await pc.getBlock()).timestamp) * 1000);
  const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);
  // The open program's round (Ruling 21): keyed by its window's UTC start day.
  const ROUND = windowKey(PROG, h(-1));
  for (const [id, starts, ends] of [[PROG, h(-1), h(30)], [PROG_ENDED, h(-48), h(-24)]] as const)
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
        status, existing_work, starts_at, ends_at, submission_proof)
      VALUES (${id}, 'X', ${id}, 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed',
        ${starts}, ${ends}, ${sql().json({ host: 'x.example' })})`;
  await sql()`
    INSERT INTO projects (program_id, name, token_status, coin_address) VALUES
      (${PROG}, 't4 a', 'launched', ${COIN_A}), (${PROG}, 't4 c', 'launched', ${COIN_C}),
      (${PROG_ENDED}, 't4 b', 'launched', ${COIN_B})`;

  // Fees: A and C collected in ONE transaction; B through the legacy locker; a bare deposit to the
  // bonus wallet's bucket by an address that isn't a locker (no ClaimedRewards: the Safe's).
  await call(newLocker, 'MockLpLocker', 'accrue', [COIN_A, 1n * E18]);
  await call(newLocker, 'MockLpLocker', 'accrue', [COIN_C, 2n * E18]);
  await call(oldLocker, 'MockLpLocker', 'accrue', [COIN_B, 4n * E18]);
  const both = await call(newLocker, 'MockLpLocker', 'collectMany', [[COIN_A, COIN_C]]);
  await call(oldLocker, 'MockLpLocker', 'collectRewards', [COIN_B]);
  await call(weth, 'MockWETH', 'mint', [DEPLOYER.address, E18 / 10n]);
  await call(weth, 'MockWETH', 'approve', [feeLocker, E18 / 10n]);
  await call(feeLocker, 'MockFeeLocker', 'storeFees', [PAYOUT.address, weth, E18 / 10n]);
  await rpc('anvil_mine', [toHex(CONFIRMATIONS)]);

  const lines: string[] = [];
  const deps = {
    account: PAYOUT,
    rpc: bonusRpc(URL, chain),
    chain,
    startBlock: 0n,
    now: h(1),
    log: (l: string) => lines.push(l),
    active: async () => true, // no explorer: every coin traded
  };
  const r1 = (await runBonusLedger(deps)) as unknown as Run;
  const why = (r: unknown) => JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  assert.equal(r1.index.round, 2, why(r1));
  assert.equal(r1.index.safe, 2, why(r1));
  const ledger = await sql()<{ tx_hash: string; coin: string | null; round_key: string | null; destination: string; amount_wei: string; swept_tx: string | null }[]>`
    SELECT tx_hash, coin, round_key, destination, amount_wei, swept_tx FROM bonus_ledger ORDER BY block_number, log_index`;
  assert.deepEqual(
    ledger.map((l) => [l.coin, l.round_key, l.destination, l.amount_wei]),
    [
      [COIN_A, ROUND, 'round', (E18 / 5n).toString()], // 20% of 1
      [COIN_C, ROUND, 'round', ((2n * E18) / 5n).toString()], // 20% of 2
      [COIN_B, null, 'safe', ((4n * E18) / 5n).toString()], // its program ended
      [null, null, 'safe', (E18 / 10n).toString()], // no ClaimedRewards
    ],
  );
  assert.equal(ledger[0].tx_hash, both.transactionHash.toLowerCase());
  assert.equal(ledger[1].tx_hash, both.transactionHash.toLowerCase());
  // The two Safe bookings (a database shared with other test files may add v2.9's line about
  // other files' coins whose fee recipients no anvil locker knows).
  assert.equal(lines.filter((l) => !l.includes('fee recipients unread')).length, 2);

  // Claimed every bucket (v2.9 D16: the creator's and MINI's too, read from the lockers), then swept
  // exactly the Safe's bookings from the bonus wallet.
  assert.deepEqual(r1.claim.map((c) => c.role), ['bonus', 'safe', 'creator', 'mini']);
  assert.ok(r1.claim.every((c: { result: string }) => c.result.startsWith('claim success')), JSON.stringify(r1.claim));
  assert.equal(r1.sweep.status, 'paid', JSON.stringify(r1.sweep));
  const bal = (who: string) => pc.readContract({ address: weth, abi: erc20Abi, functionName: 'balanceOf', args: [who as Hex] });
  const safeShare = ((1n + 2n + 4n) * E18 * 3000n) / 10_000n;
  const sweptAmount = (4n * E18) / 5n + E18 / 10n;
  assert.equal(await bal(SAFE), safeShare + sweptAmount);
  assert.equal(await bal(PAYOUT.address), (3n * E18) / 5n, 'the bonus wallet keeps exactly the round pools');
  // claim(owner, WETH) pays the owner: the creator and MINI get their whole share, EarnKit none of it.
  assert.equal(await bal(CREATOR), ((1n + 2n + 4n) * E18 * 4000n) / 10_000n);
  assert.equal(await bal(MINI), ((1n + 2n + 4n) * E18 * 1000n) / 10_000n);
  const logged = await sql()<{ role: string }[]>`SELECT role FROM fee_claims WHERE owner IN (${CREATOR}, ${MINI}) ORDER BY role`;
  assert.deepEqual(logged.map((l) => l.role), ['creator', 'mini']);
  const [sweep] = await sql()<{ tx_hash: string; status: string }[]>`SELECT tx_hash, status FROM bonus_sweeps`;
  const swept = await sql()<{ swept_tx: string | null; destination: string }[]>`SELECT swept_tx, destination FROM bonus_ledger`;
  assert.ok(swept.every((s) => (s.destination === 'safe') === (s.swept_tx === sweep.tx_hash)));
  assert.equal((await pc.getTransactionReceipt({ hash: sweep.tx_hash as Hex })).status, 'success');

  // Idempotent: a second run books, claims and sends nothing new.
  const nonce = await pc.getTransactionCount({ address: PAYOUT.address });
  const r2 = (await runBonusLedger({ ...deps, now: h(2) })) as unknown as Run;
  assert.equal(r2.index.round + r2.index.safe, 0, why(r2));
  assert.deepEqual(r2.sweep, { result: 'nothing to sweep' });
  assert.equal(await pc.getTransactionCount({ address: PAYOUT.address }), nonce);

  // In the round's last 24 h with no deposit for 12 h, EarnKit collects A and C itself, each through
  // the locker that simulates; B's round is over, so it isn't collected. T5 fix round 1: newest
  // coins first (C's entry was recorded after A's).
  await call(newLocker, 'MockLpLocker', 'accrue', [COIN_A, 1n * E18]);
  const r3 = (await runBonusLedger({ ...deps, now: h(14) })) as unknown as Run;
  assert.deepEqual(r3.collect.map((c: { coin: string }) => c.coin), [COIN_C, COIN_A], why(r3));
  assert.ok(r3.collect.every((c: { result: string }) => c.result.startsWith('collect success')), JSON.stringify(r3.collect));
  await rpc('anvil_mine', [toHex(CONFIRMATIONS)]);
  const r4 = (await runBonusLedger({ ...deps, now: h(15) })) as unknown as Run;
  assert.equal(r4.index.round, 1, `A's collected share is booked to the open round: ${why(r4)}`);
  assert.deepEqual(r4.collect, [], 'collected within 12 h: not again');
  const pool = await sql()<{ wei: string }[]>`SELECT sum(amount_wei)::text AS wei FROM bonus_ledger WHERE round_key = ${ROUND}`;
  assert.equal(pool[0].wei, ((E18 / 5n) * 2n + (2n * E18) / 5n).toString());
}
