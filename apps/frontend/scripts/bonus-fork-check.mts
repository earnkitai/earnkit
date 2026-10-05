import { createPublicClient, decodeEventLog, encodeFunctionData, http, type Hex } from 'viem';
import { base } from 'viem/chains';
import {
  BASE_BONUS,
  CLAIMED_REWARDS,
  FEE_LOCKER_ABI,
  STORE_TOKENS,
  bonusDeposits,
  bonusRpc,
} from '../lib/earnkit/bonus-ledger';

/**
 * v2.5 fork check: the builder bonus ledger against Clanker v4's real Base contracts. Read-only:
 * it never signs anything, so it can never broadcast. Every write is an eth_call (a simulation).
 *   1. a real collect receipt (a FeeLocker StoreTokens for WETH sent by an LP locker): bonusDeposits
 *      decodes it, attributes each deposit to the NEXT ClaimedRewards from the same locker (Ruling 8),
 *      and the attribution is confirmed independently (the coin's tokenRewards lists the fee owner,
 *      and the amount is one of that ClaimedRewards' rewards); getLogs with the indexed-topic filter
 *      (bonusRpc.storeLogs) finds the same logs;
 *   2. collectRewards(coin) simulated on each real LP locker (bonusRpc.canCollect);
 *   3. claim(feeOwner, WETH) simulated on the real FeeLocker, for an owner with fees and one without.
 *
 *   BASE_RPC_URL=https://mainnet.base.org pnpm bonus:fork-check            (the public RPC), or
 *   anvil --fork-url https://mainnet.base.org --chain-id 8453 --port 8575
 *   BASE_RPC_URL=http://127.0.0.1:8575 pnpm bonus:fork-check               (an anvil fork)
 * Optional: BONUS_FORK_TX=<hash> pins the receipt; otherwise the newest one found looking back in
 * 500-block steps up to DISCOVERY_STEPS steps (none found: it says to set BONUS_FORK_TX and skips).
 * Without BASE_RPC_URL, or with no network, it prints "skipped" and exits 0 (CI stays offline).
 */
const RPC = process.env.BASE_RPC_URL?.trim();
if (!RPC) {
  console.log('skipped: set BASE_RPC_URL (the public Base RPC or a local anvil fork) to run the fork check.');
  process.exit(0);
}
let checks = 0;
const ok = (cond: unknown, what: string, detail?: unknown) => {
  if (!cond) {
    console.error(`FAIL: ${what}${detail === undefined ? '' : `\n  got: ${JSON.stringify(detail, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`}`);
    process.exit(1);
  }
  checks++;
  console.log(`ok ${checks} - ${what}`);
};
const c = createPublicClient({ chain: base, transport: http(RPC, { timeout: 20_000, retryCount: 5, retryDelay: 1_000 }) });
// The reachability probe never retries, so an offline run skips at once (task-10-review M6).
const probe = createPublicClient({ chain: base, transport: http(RPC, { timeout: 5_000, retryCount: 0 }) });
let head: bigint;
try {
  head = await probe.getBlockNumber();
} catch (err) {
  console.log(`skipped: ${RPC} is unreachable (${err instanceof Error ? err.message.split('\n')[0] : err}).`);
  process.exit(0);
}
ok((await c.getChainId()) === 8453, 'BASE_RPC_URL is Base mainnet (or a fork of it, chain id 8453)');
const rpc = bonusRpc(RPC, BASE_BONUS);
const lower = (s: string) => s.toLowerCase();
const lockers = BASE_BONUS.lockers.map(lower);
const WETH = BASE_BONUS.weth;

// ---- 1. a real collect receipt ----
let hash = process.env.BONUS_FORK_TX?.trim() as Hex | undefined;
if (!hash) {
  // Newest first, 500 blocks at a time (task-10-review M5): a quiet window isn't a failure.
  const STEP = 500n;
  const DISCOVERY_STEPS = 20;
  for (let i = 0; i < DISCOVERY_STEPS && !hash && head - BigInt(i) * STEP >= 0n; i++) {
    const toBlock = head - BigInt(i) * STEP;
    const fromBlock = toBlock - STEP + 1n > 0n ? toBlock - STEP + 1n : 0n;
    const logs = await c.getLogs({ address: BASE_BONUS.feeLocker, event: STORE_TOKENS, args: { token: WETH }, fromBlock, toBlock });
    const fromLocker = logs.filter((l) => lockers.includes(lower(l.args.sender!)));
    if (fromLocker.length > 0) hash = fromLocker[fromLocker.length - 1].transactionHash!;
  }
  if (!hash) {
    console.log(`skipped: no WETH StoreTokens from a Clanker LP locker in the last ${BigInt(DISCOVERY_STEPS) * STEP} blocks; set BONUS_FORK_TX=<a collect tx hash> to pin one.`);
    process.exit(0);
  }
  ok(true, `a WETH StoreTokens from a Clanker LP locker (tx ${hash})`);
}
console.log(`receipt: ${hash}`);
const receipt = await rpc.receiptLogs(hash);
ok(receipt.logs.length > 0, `the receipt has logs (block ${receipt.blockNumber})`);
const stores = receipt.logs
  .filter((l) => lower(l.address) === lower(BASE_BONUS.feeLocker))
  .flatMap((l) => {
    try {
      const d = decodeEventLog({ abi: [STORE_TOKENS], topics: l.topics as [Hex, ...Hex[]], data: l.data as Hex });
      return [{ ...d.args, logIndex: l.logIndex }];
    } catch {
      return [];
    }
  })
  .filter((s) => lower(s.token) === WETH && lockers.includes(lower(s.sender)));
ok(stores.length > 0, `${stores.length} WETH StoreTokens from a locker in the receipt`);
const claims = receipt.logs
  .filter((l) => lockers.includes(lower(l.address)))
  .flatMap((l) => {
    try {
      const d = decodeEventLog({ abi: [CLAIMED_REWARDS], topics: l.topics as [Hex, ...Hex[]], data: l.data as Hex });
      return [{ ...d.args, logIndex: l.logIndex, locker: lower(l.address) }];
    } catch {
      return [];
    }
  });
ok(claims.length > 0, `${claims.length} ClaimedRewards in the receipt (coins: ${[...new Set(claims.map((x) => lower(x.token)))].join(', ')})`);

const owners = [...new Set(stores.map((s) => lower(s.feeOwner)))];
const coins = new Set<string>();
for (const owner of owners) {
  const deps = bonusDeposits(receipt.logs, owner);
  const mine = stores.filter((s) => lower(s.feeOwner) === owner);
  ok(deps.length === mine.length, `bonusDeposits finds every WETH deposit of ${owner} (${deps.length})`);
  for (const d of deps) {
    const s = mine.find((x) => x.logIndex === d.logIndex)!;
    ok(d.amount === s.amount && d.locker === lower(s.sender), `log ${d.logIndex}: amount ${d.amount} wei and locker decoded from the topics and data`);
    const found = claims.find((x) => x.locker === d.locker && x.logIndex > d.logIndex);
    // A clean FAIL line, never a TypeError, when the receipt has no later ClaimedRewards (task-10-review M4).
    ok(found, `log ${d.logIndex}: a later ClaimedRewards from the same locker`);
    const next = found!;
    ok(d.coin !== null && d.coin === lower(next.token), `log ${d.logIndex}: coin ${d.coin} is the NEXT ClaimedRewards from its locker (Ruling 8)`);
    ok([...next.rewards0, ...next.rewards1].includes(d.amount), `log ${d.logIndex}: the amount is one of that ClaimedRewards' rewards`);
    const recipients = await rpc.rewardRecipients(d.locker as Hex, d.coin as Hex);
    ok(recipients.includes(owner), `log ${d.logIndex}: tokenRewards(${d.coin}) on ${d.locker} pays ${owner}`, recipients);
    coins.add(`${d.locker} ${d.coin}`);
  }
  const found = await rpc.storeLogs(receipt.blockNumber, receipt.blockNumber, owner as Hex);
  const here = found.filter((f) => lower(f.txHash) === lower(hash!)).map((f) => f.logIndex).sort((a, b) => a - b);
  ok(
    JSON.stringify(here) === JSON.stringify(mine.map((m) => m.logIndex).sort((a, b) => a - b)),
    `getLogs filtered by feeOwner ${owner} and WETH (bonusRpc.storeLogs) returns exactly those logs`,
    here,
  );
}

// ---- 2. collectRewards(coin), simulated on each real LP locker ----
// A fresh address with no key: it can't sign anything; eth_call only. Anvil refuses an eth_call
// from an account that can't pay its gas, so on a local fork (only) it gets 1 ETH of fork state.
const CALLER = '0x00000000000000000000000000000000000e4a17' as Hex;
const isAnvil = /anvil/i.test(String(await c.request({ method: 'web3_clientVersion' } as never).catch(() => '')));
if (isAnvil) await c.request({ method: 'anvil_setBalance', params: [CALLER, '0xde0b6b3a7640000'] } as never);
for (const pair of coins) {
  const [locker, coin] = pair.split(' ') as [Hex, Hex];
  const results: string[] = [];
  for (const l of BASE_BONUS.lockers) results.push(`${l}: ${(await rpc.canCollect(l, coin, CALLER)) ? 'simulates cleanly' : 'reverts'}`);
  console.log(`  collectRewards(${coin}) -> ${results.join('; ')}`);
  ok(await rpc.canCollect(locker, coin, CALLER), `collectRewards(${coin}) simulates cleanly on its own locker ${locker}`);
  const gas = await c.estimateGas({ account: CALLER, to: locker, data: encodeFunctionData({ abi: [{ type: 'function', name: 'collectRewards', inputs: [{ name: 'token', type: 'address' }], outputs: [], stateMutability: 'nonpayable' }], functionName: 'collectRewards', args: [coin] }) });
  console.log(`  collectRewards(${coin}) gas estimate: ${gas}`);
}

// ---- 3. claim(feeOwner, WETH), simulated on the real FeeLocker ----
const claimCall = (owner: Hex) => ({ account: CALLER, to: BASE_BONUS.feeLocker, data: encodeFunctionData({ abi: FEE_LOCKER_ABI, functionName: 'claim', args: [owner, WETH] }) });
let withFees: Hex | null = null;
const candidates = new Set<string>(owners);
for (const pair of coins) {
  const [locker, coin] = pair.split(' ') as [Hex, Hex];
  for (const r of await rpc.rewardRecipients(locker, coin)) candidates.add(r);
}
for (const o of candidates) {
  const available = await rpc.availableFees(o as Hex, WETH);
  console.log(`  availableFees(${o}, WETH) = ${available}`);
  if (available > 0n && !withFees) withFees = o as Hex;
}
if (withFees) {
  const sim = await c.call(claimCall(withFees)).then(() => 'ok', (e: Error) => e.message.split('\n')[0]);
  ok(sim === 'ok', `claim(${withFees}, WETH) simulates cleanly from an unrelated caller (anyone may claim; it pays the fee owner)`, sim);
  console.log(`  claim gas estimate: ${await c.estimateGas(claimCall(withFees))}`);
} else console.log('  no recipient of these coins has unclaimed WETH right now; the positive claim simulation was not possible');
const empty = '0x000000000000000000000000000000000000dead' as Hex;
ok((await rpc.availableFees(empty, WETH)) === 0n, 'availableFees of an address with no fees is 0');
const refused = await c.call(claimCall(empty)).then(() => 'ok', () => 'reverted');
ok(refused === 'reverted', 'claim for an owner with no fees reverts (the ledger only claims when availableFees > 0)');
console.log(`  availableFees(Safe, WETH) = ${await rpc.availableFees(BASE_BONUS.safe, WETH)}`);
console.log(`\n${checks} checks passed against ${isAnvil ? 'a local anvil fork' : 'Base mainnet (read-only)'}; tx ${hash}. Nothing was signed or sent.`);
