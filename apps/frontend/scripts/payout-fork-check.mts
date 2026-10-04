import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, encodeFunctionData, erc20Abi, http, parseUnits, toHex, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

/**
 * v2.4 §9 fork check: the payout path (payCampaign, payWinner, payoutRpc) against a Base mainnet
 * fork with the real MINI contract and the real Chainalysis sanctions oracle, plus the historic
 * state reads scoring needs (a nonce, code and an EntryPoint getNonce at a past block).
 * The fork is reset to Base's latest block first (anvil_reset). Transactions go to the local fork only. The real network is only read: the fork's upstream,
 * Base Blockscout once (a MINI holder to impersonate on the fork), and the public RPC (does it
 * serve historic state; the throwaway key never sent anything there).
 *   anvil --fork-url https://mainnet.base.org --port 8562 --chain-id 8453
 *   BASE_RPC_URL=http://127.0.0.1:8562 pnpm campaign:fork-check
 */
function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
let checks = 0;
const ok = (cond: unknown, what: string) => {
  if (!cond) fail(what);
  checks++;
  console.log(`ok: ${what}`);
};
const RPC = (process.env.BASE_RPC_URL ?? '').replace(/\/$/, '');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(RPC)) fail('BASE_RPC_URL must be a local anvil fork: http://127.0.0.1:<port>.');
async function rpc(method: string, params: unknown[] = []) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
if (!/anvil/i.test(String(await rpc('web3_clientVersion').catch(() => '')))) fail('BASE_RPC_URL must be anvil.');
if (Number(await rpc('eth_chainId')) !== 8453) fail('Fork Base mainnet with --chain-id 8453.');
const MINI = '0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07' as Hex;
const PUBLIC_RPC = 'https://mainnet.base.org';
// A fresh fork of Base's latest block each run: no blocks mined locally yet (they would break the
// 2 s block spacing that baseBlockAt relies on) and no state left from an earlier run.
await rpc('anvil_reset', [{ forking: { jsonRpcUrl: PUBLIC_RPC } }]);
if (String(await rpc('eth_getCode', [MINI, 'latest'])).length < 100) fail('BASE_RPC_URL is not a Base mainnet fork (no MINI contract).');
// Production settings: the sanctions screen fails closed, as on Railway.
(process.env as Record<string, string>).NODE_ENV = 'production';

const fork = createPublicClient({ chain: base, transport: http(RPC) });
const upstream = createPublicClient({ chain: base, transport: http(PUBLIC_RPC) });
const { payCampaign, payWinner, payoutRpc, fromTerms, termsOf } = await import('../lib/earnkit/payout');
type Store = import('../lib/earnkit/payout').PayoutStore;
const { ENTRY_POINTS, baseBlockAt, walletHistory } = await import('../lib/earnkit/campaigns');

// ---- 1. historic state, as scoring reads it, through the fork ----
const head = await fork.getBlock();
const twoDaysAgo = new Date(Number(head.timestamp) * 1000 - 2 * 86_400_000);
const startBlock = await baseBlockAt(twoDaysAgo, fork as never);
const startTs = Number((await fork.getBlock({ blockNumber: startBlock })).timestamp) * 1000;
ok(Math.abs(startTs - twoDaysAgo.getTime()) <= 2_000, `baseBlockAt maps "2 days ago" to block ${startBlock} (2 s blocks hold on Base)`);
// A recent UserOp on EntryPoint v0.7 gives a real smart account and a real EOA (its bundler).
const EP = ENTRY_POINTS[1] as Hex;
const USER_OP_EVENT = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';
const logs = (await rpc('eth_getLogs', [
  { address: EP, topics: [USER_OP_EVENT], fromBlock: toHex(head.number - 300n), toBlock: toHex(head.number) },
])) as { topics: Hex[]; data: Hex; transactionHash: Hex }[];
if (logs.length === 0) fail('No UserOp on EntryPoint v0.7 in the last 300 blocks to check against.');
// A sender using nonce key 0 (the UserOp's nonce >> 64 is 0) that already had UserOps at the start block.
const GET_NONCE = [{ type: 'function', name: 'getNonce', stateMutability: 'view', inputs: [{ name: 'sender', type: 'address' }, { name: 'key', type: 'uint192' }], outputs: [{ type: 'uint256' }] }] as const;
const epNonce = (who: Hex, block: bigint) => fork.readContract({ address: EP, abi: GET_NONCE, functionName: 'getNonce', args: [who, 0n], blockNumber: block });
let sender: Hex | null = null;
for (const l of logs.filter((l) => BigInt(`0x${l.data.slice(2, 66)}`) >> 64n === 0n).slice(0, 40)) {
  const s = `0x${l.topics[2].slice(-40)}` as Hex;
  if ((await fork.getCode({ address: s, blockNumber: startBlock }))?.length && (await epNonce(s, startBlock)) > 0n) {
    sender = s;
    break;
  }
}
if (!sender) fail('No recent key-0 UserOp sender that already had UserOps 2 days ago.');
const bundler = (await fork.getTransaction({ hash: logs[0].transactionHash })).from;
const nonceThen = await epNonce(sender, startBlock);
const nonceNow = await epNonce(sender, head.number);
ok(nonceNow > nonceThen, `EntryPoint v0.7 getNonce(${sender}, 0) at the start block: ${nonceThen} (now ${nonceNow})`);
ok((await walletHistory(sender, startBlock, fork as never)) === 'smart', `walletHistory: ${sender} had code at the start block (smart)`);
const eoaThen = await fork.getTransactionCount({ address: bundler, blockNumber: startBlock });
const eoaNow = await fork.getTransactionCount({ address: bundler, blockNumber: head.number });
ok(eoaNow > eoaThen, `a historic nonce differs from today's: bundler ${bundler} had ${eoaThen} transactions at the start block, ${eoaNow} now`);
ok((await walletHistory(bundler, startBlock, fork as never)) === (eoaThen >= 3 ? 'eoa' : null), 'walletHistory reads that nonce at the start block');
// The public RPC, directly (reads only): historic state 2 days and ~30 days back.
const monthAgo = startBlock - 14n * 43_200n;
const pubThen = await upstream.getTransactionCount({ address: bundler, blockNumber: startBlock });
const pubMonth = await upstream.getTransactionCount({ address: bundler, blockNumber: monthAgo });
const pubCode = await upstream.getCode({ address: MINI, blockNumber: 1_000_000n });
ok(pubThen === eoaThen && pubMonth <= pubThen && !pubCode, `the public RPC serves historic state: nonce ${pubThen} (2 days back), ${pubMonth} (~30 days back); MINI had no code at block 1,000,000`);

// ---- 2. the payout, on the fork, with real MINI ----
const file = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'programs', 'earnkit-campaign-1-base.json'), 'utf8'));
const terms = { ...termsOf(file.campaign), winners: 2 };
const amount = parseUnits(terms.amount_each, terms.decimals);
const holders = (await (await fetch(`https://base.blockscout.com/api/v2/tokens/${MINI}/holders`)).json()) as {
  items: { address: { hash: string; is_contract: boolean }; value: string }[];
};
// Blockscout's list can lag: the balance is read on the fork. Wallets first, then contracts.
let holder: Hex | undefined;
for (const x of [...holders.items].sort((a, b) => Number(a.address.is_contract) - Number(b.address.is_contract))) {
  const h = x.address.hash as Hex;
  if ((await fork.readContract({ address: MINI, abi: erc20Abi, functionName: 'balanceOf', args: [h] })) >= amount * 3n) {
    holder = h;
    break;
  }
}
if (!holder) fail('No MINI holder with enough balance on the fork to impersonate.');
const hot = privateKeyToAccount(generatePrivateKey()); // a throwaway payout key
await rpc('anvil_impersonateAccount', [holder]);
await rpc('anvil_setBalance', [holder, toHex(10n ** 18n)]);
await rpc('anvil_setBalance', [hot.address, toHex(10n ** 15n)]); // gas money only: 0.001 ETH
const funding = (await rpc('eth_sendTransaction', [
  { from: holder, to: MINI, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [hot.address, amount * 2n] }) },
])) as Hex;
await rpc('anvil_stopImpersonatingAccount', [holder]);
const chain = payoutRpc(RPC);
ok((await chain.waitFor(funding, 60_000))?.status === 'success' && (await chain.balanceOf(MINI, hot.address)) === amount * 2n, `the throwaway payout wallet holds exactly 2 prizes of real MINI (2 x ${terms.amount_each}), from ${holder} impersonated on the fork`);

// The store, in memory, with dbPayoutStore's semantics.
type Row = { id: number; score: number; submitted_at: Date; installation_id: number; payout_wallet: string; vetoed_at: Date | null; payout_status: string | null; prize_tx: string | null; prize_raw_tx: string | null; prize_amount?: string | null };
const db = new Map<number, Row>();
const store: Store = {
  sending: async (id, hash, raw) => {
    const r = db.get(id)!;
    if (r.prize_tx) return false;
    Object.assign(r, { payout_status: 'sending', prize_tx: hash, prize_raw_tx: raw });
    return true;
  },
  paid: async (id, amountText) => void Object.assign(db.get(id)!, { payout_status: 'paid', prize_amount: amountText }),
  failed: async (id) => {
    Object.assign(db.get(id)!, { payout_status: null, prize_tx: null, prize_raw_tx: null });
    return 1;
  },
  refused: async (id) => void Object.assign(db.get(id)!, { payout_status: 'refused' }),
  stale: async () => {},
};
const wallets = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()).address);
wallets.forEach((w, i) =>
  db.set(i + 1, { id: i + 1, score: 30 - i, submitted_at: new Date(Date.UTC(2026, 9, 1, i)), installation_id: 100 + i, payout_wallet: w.toLowerCase(), vetoed_at: null, payout_status: null, prize_tx: null, prize_raw_tx: null }),
);
const fromDb = () => [...db.values()].map((r) => ({ ...r })); // what the cron reads each run
const deps = { account: hot, rpc: chain, store };

const first = await payCampaign(fromTerms(terms), fromDb(), deps);
console.log('payout run 1:', JSON.stringify(first));
ok(first.done && first.note === null, 'payout run 1: done, no note (screened by the real Chainalysis oracle, fail-closed settings)');
for (const i of [0, 1]) {
  const r = db.get(i + 1)!;
  ok((await chain.balanceOf(MINI, wallets[i])) === amount, `winner ${i + 1} received exactly amount_each (${terms.amount_each} MINI)`);
  const receipt = await fork.getTransactionReceipt({ hash: r.prize_tx as Hex });
  ok(r.payout_status === 'paid' && receipt.status === 'success' && receipt.from.toLowerCase() === hot.address.toLowerCase(), `winner ${i + 1}: paid, tx ${r.prize_tx} mined on the fork`);
}
ok((await chain.balanceOf(MINI, wallets[2])) === 0n && db.get(3)!.payout_status === null, 'the third entry got nothing (2 winners)');
ok((await chain.balanceOf(MINI, hot.address)) === 0n, 'the capped wallet is empty');

const nonce = await fork.getTransactionCount({ address: hot.address });
await rpc('anvil_impersonateAccount', [holder]);
await rpc('eth_sendTransaction', [{ from: holder, to: MINI, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [hot.address, amount] }) }]);
await rpc('anvil_stopImpersonatingAccount', [holder]);
const second = await payCampaign(fromTerms(terms), fromDb(), deps);
console.log('payout run 2:', JSON.stringify(second));
const again = await payWinner(fromDb()[0], { token: MINI, amount, amountText: terms.amount_each, account: hot, rpc: chain, store });
ok(second.done && again === 'paid', 'payout run 2 (wallet topped up again): done, and a paid winner is never signed again');
ok((await fork.getTransactionCount({ address: hot.address })) === nonce, 'run 2 sent no transaction');
ok(
  (await chain.balanceOf(MINI, wallets[0])) === amount && (await chain.balanceOf(MINI, wallets[1])) === amount && (await chain.balanceOf(MINI, wallets[2])) === 0n && (await chain.balanceOf(MINI, hot.address)) === amount,
  'balances unchanged: each winner paid once',
);
ok((await upstream.getTransactionCount({ address: hot.address })) === 0, 'real Base: the throwaway payout key has never sent a transaction (nothing left the fork)');
console.log(`fork check: ${checks} checks passed`);
process.exit(0);
