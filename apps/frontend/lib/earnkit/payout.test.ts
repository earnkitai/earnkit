import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeFunctionData,
  erc20Abi,
  keccak256,
  parseTransaction,
  parseUnits,
  recoverTransactionAddress,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { payCampaign, payWinner, payoutAccount, type PayoutRpc, type PayoutStore } from './payout';
import type { EarnKitCampaign } from './campaigns';

const account = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'); // anvil #3
const TOKEN = '0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07' as Hex;
const ONE = parseUnits('1', 18);

function fakeRpc(o: { chainId?: number; balance?: () => bigint; mined?: 'success' | 'reverted' | null } = {}) {
  const sent: Hex[] = [];
  const receipts = new Map<Hex, { status: 'success' | 'reverted' }>();
  const rpc: PayoutRpc = {
    getChainId: async () => o.chainId ?? 8453,
    nonce: async () => 7,
    fees: async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    estimateGas: async () => 50_000n,
    receipt: async (h) => receipts.get(h) ?? null,
    broadcast: async (raw) => {
      sent.push(raw);
      if (o.mined !== null) receipts.set(keccak256(raw), { status: o.mined ?? 'success' });
    },
    waitFor: async (h) => receipts.get(h) ?? null,
    balanceOf: async () => (o.balance ? o.balance() : 10n ** 30n),
  };
  return { rpc, sent, receipts };
}

function memStore(sentSoFar: () => number = () => 0) {
  const calls: unknown[][] = [];
  const store: PayoutStore = {
    sending: async (id, hash) => { calls.push(['sending', id, hash, sentSoFar()]); return true; },
    paid: async (id, amount) => { calls.push(['paid', id, amount]); },
    failed: async (id) => { calls.push(['failed', id]); },
    refused: async (id) => { calls.push(['refused', id]); },
  };
  return { store, calls };
}

const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  payout_wallet: `0x${String(id).padStart(40, '0')}`,
  payout_status: null as string | null,
  prize_tx: null as string | null,
  prize_raw_tx: null as string | null,
  ...extra,
});

test('payWinner: the signed transfer is stored before it is broadcast, then paid', async () => {
  const f = fakeRpc();
  const s = memStore(() => f.sent.length);
  const r = await payWinner(row(1), { token: TOKEN, amount: ONE, amountText: '1', account, rpc: f.rpc, store: s.store });
  assert.equal(r, 'paid');
  assert.equal(f.sent.length, 1);
  assert.deepEqual(s.calls[0], ['sending', 1, keccak256(f.sent[0]), 0], 'stored while nothing was sent yet');
  assert.deepEqual(s.calls[1], ['paid', 1, '1']);
});

test('Review Focus 3: a transfer stored as sending is rebroadcast as the same bytes, never signed again', async () => {
  const signed = await account.signTransaction({
    chainId: 8453, type: 'eip1559', to: TOKEN, data: '0xa9059cbb', nonce: 7, gas: 60_000n,
    maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n,
  });
  const f = fakeRpc();
  const s = memStore();
  const r = await payWinner(
    row(1, { payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed }),
    { token: TOKEN, amount: ONE, amountText: '1', account, rpc: f.rpc, store: s.store },
  );
  assert.equal(r, 'paid');
  assert.deepEqual(f.sent, [signed]);
  assert.ok(!s.calls.some((c) => c[0] === 'sending'));
  // Already mined: no broadcast at all.
  const g = fakeRpc();
  g.receipts.set(keccak256(signed), { status: 'success' });
  await payWinner(row(1, { payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed }), {
    token: TOKEN, amount: ONE, amountText: '1', account, rpc: g.rpc, store: memStore().store,
  });
  assert.equal(g.sent.length, 0);
});

test('payWinner: a reverted transfer is cleared for a retry; an unmined one waits', async () => {
  const reverted = fakeRpc({ mined: 'reverted' });
  const s = memStore();
  assert.equal(await payWinner(row(1), { token: TOKEN, amount: ONE, amountText: '1', account, rpc: reverted.rpc, store: s.store }), 'failed');
  assert.deepEqual(s.calls.at(-1), ['failed', 1]);
  const stuck = fakeRpc({ mined: null });
  assert.equal(await payWinner(row(2), { token: TOKEN, amount: ONE, amountText: '1', account, rpc: stuck.rpc, store: memStore().store }), 'pending');
});

const campaign: EarnKitCampaign = {
  kind: 'earnkit',
  prize: { token: TOKEN, symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 2, amount_each: '1', prize_usd_total: 200, metric: 'unique_wallets', min_score: 10,
};
const entry = (id: number, score: number, extra: Record<string, unknown> = {}) => ({
  ...row(id), score, submitted_at: new Date(Date.UTC(2026, 9, id)), installation_id: id, vetoed_at: null, ...extra,
});

test('payCampaign: rank order, a listed wallet skipped, stops when short, resumes once topped up', async () => {
  const W = '0x' + 'f'.repeat(40);
  const entries = [entry(1, 50, { payout_wallet: W }), entry(2, 40, { payout_wallet: W }), entry(3, 30), entry(4, 20)];
  let funds = ONE + ONE / 2n;
  const f = fakeRpc({ balance: () => funds - ONE * BigInt(f.sent.length) });
  const s = memStore();
  const listed = async (w: string) => w === entries[2].payout_wallet;
  const first = await payCampaign(campaign, entries, { account, rpc: f.rpc, store: s.store, listed });
  assert.equal(first.done, false);
  assert.match(first.note!, /holds 0\.5 MINI, less than the next prize \(1\)/);
  assert.deepEqual(s.calls.filter((c) => c[0] !== 'sending').map((c) => c.slice(0, 2)), [['paid', 1], ['refused', 3]]);
  funds += ONE;
  const second = await payCampaign(campaign, entries, { account, rpc: f.rpc, store: s.store, listed });
  assert.deepEqual(second, { done: true, note: null });
  assert.deepEqual(s.calls.filter((c) => c[0] === 'paid').map((c) => c[1]), [1, 4]);
  // Nothing more to pay: no transfer.
  const before = f.sent.length;
  assert.deepEqual(await payCampaign(campaign, entries, { account, rpc: f.rpc, store: s.store, listed }), { done: true, note: null });
  assert.equal(f.sent.length, before);
});

test('payCampaign never sends without the key or off Base mainnet', async () => {
  const f = fakeRpc({ chainId: 1 });
  const entries = [entry(1, 50)];
  assert.match((await payCampaign(campaign, entries, { account: null, rpc: f.rpc })).note!, /isn't set up yet/);
  assert.match((await payCampaign(campaign, entries, { account, rpc: f.rpc, store: memStore().store })).note!, /not Base mainnet/);
  assert.equal(f.sent.length, 0);
  assert.equal(payoutAccount({}), null);
  assert.throws(() => payoutAccount({ CAMPAIGN_PAYOUT_PRIVATE_KEY: '0x1234' }), /CAMPAIGN_PAYOUT_PRIVATE_KEY/);
});

// Payout safety (v2.4 §8): each rule below is checked against the signed bytes, not the code path.

/** Who each sent transfer pays, how much, from which key, to which contract. */
async function decodeSent(raw: Hex) {
  const tx = parseTransaction(raw);
  const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: tx.data! });
  return {
    to: tx.to!.toLowerCase(),
    functionName,
    recipient: (args![0] as string).toLowerCase(),
    amount: args![1] as bigint,
    value: tx.value ?? 0n,
    chainId: tx.chainId,
    from: (await recoverTransactionAddress({ serializedTransaction: raw as never })).toLowerCase(),
  };
}

test("safety: each transfer is amount_each of the prize token, to that winner's payout wallet only, signed by the payout key", async () => {
  const f = fakeRpc();
  const c = { ...campaign, amount_each: '84800000' };
  const entries = [entry(1, 50), entry(2, 40, { payout_wallet: '0x' + 'AbC'.repeat(13) + 'a' })];
  assert.deepEqual(await payCampaign(c, entries, { account, rpc: f.rpc, store: memStore().store, listed: async () => false }), { done: true, note: null });
  const sent = await Promise.all(f.sent.map(decodeSent));
  assert.deepEqual(
    sent.map((s) => [s.to, s.functionName, s.recipient, s.amount, s.value, s.chainId, s.from]),
    entries.map((e) => [
      TOKEN.toLowerCase(), 'transfer', e.payout_wallet.toLowerCase(), parseUnits('84800000', 18), 0n, 8453,
      account.address.toLowerCase(),
    ]),
  );
});

test('safety: rank order, ties to the earlier entry; one prize per payout wallet and per installation; vetoed entries are never paid', async () => {
  const f = fakeRpc();
  const s = memStore();
  const c = { ...campaign, winners: 3 };
  const W8 = '0x' + 'ab'.repeat(20);
  const entries = [
    entry(5, 30, { submitted_at: new Date(Date.UTC(2026, 9, 9)) }), // tie with #6, but later
    entry(6, 30, { submitted_at: new Date(Date.UTC(2026, 9, 2)) }), // tie, earlier: ahead of #5
    entry(7, 90, { vetoed_at: new Date() }), // removed in review
    entry(8, 80, { installation_id: 42, payout_wallet: W8 }),
    entry(9, 70, { installation_id: 42 }), // same agent as #8
    entry(10, 60, { payout_wallet: '0x' + W8.slice(2).toUpperCase() }), // same wallet as #8, other case
    entry(11, 5), // under min_score
  ];
  const r = await payCampaign(c, entries, { account, rpc: f.rpc, store: s.store, listed: async () => false });
  assert.deepEqual(r, { done: true, note: null });
  assert.deepEqual(s.calls.filter((x) => x[0] === 'paid').map((x) => x[1]), [8, 6, 5]);
  assert.deepEqual((await Promise.all(f.sent.map(decodeSent))).map((d) => d.recipient), [W8, row(6).payout_wallet, row(5).payout_wallet]);
});

test('safety: a retry never double-pays (paid rows are skipped; a row another run claimed is not sent)', async () => {
  const f = fakeRpc();
  const paid = entry(1, 50, { payout_status: 'paid', prize_tx: '0x' + '1'.repeat(64) });
  const s = memStore();
  assert.deepEqual(await payCampaign(campaign, [paid, entry(2, 40)], { account, rpc: f.rpc, store: s.store, listed: async () => false }), { done: true, note: null });
  assert.deepEqual(s.calls.filter((x) => x[0] === 'paid').map((x) => x[1]), [2]);
  assert.equal(f.sent.length, 1);
  // Another run stored its signed transfer first: this run signs nothing and sends nothing.
  const g = fakeRpc();
  const lost: PayoutStore = { ...memStore().store, sending: async () => false };
  assert.equal(await payWinner(row(3), { token: TOKEN, amount: ONE, amountText: '1', account, rpc: g.rpc, store: lost }), 'pending');
  assert.equal(g.sent.length, 0);
});

test('safety: an unmined transfer stops the run before the next winner is signed', async () => {
  const f = fakeRpc({ mined: null });
  const s = memStore();
  const r = await payCampaign(campaign, [entry(1, 50), entry(2, 40)], { account, rpc: f.rpc, store: s.store, listed: async () => false });
  assert.equal(r.done, false);
  assert.match(r.note!, /Waiting for the transfer to entry #1 to be mined/);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(s.calls.map((x) => x[0]), ['sending']);
});

test('safety: the sanctions screen runs before every new transfer and fails closed', async () => {
  const f = fakeRpc();
  const screened: string[] = [];
  await payCampaign(campaign, [entry(1, 50), entry(2, 40)], {
    account, rpc: f.rpc, store: memStore().store, listed: async (w) => { screened.push(w); return false; },
  });
  assert.deepEqual(screened, [row(1).payout_wallet, row(2).payout_wallet]);
  const g = fakeRpc();
  await assert.rejects(
    payCampaign(campaign, [entry(1, 50)], {
      account, rpc: g.rpc, store: memStore().store, listed: async () => { throw new Error('screening unavailable'); },
    }),
    /screening unavailable/,
  );
  assert.equal(g.sent.length, 0);
});

test('safety: no ETH for gas stops with a note the page can show; the deadline stops before the next transfer', async () => {
  const f = fakeRpc();
  f.rpc.estimateGas = async () => { throw new Error('insufficient funds for gas * price + value: balance 0'); };
  const r = await payCampaign(campaign, [entry(1, 50)], { account, rpc: f.rpc, store: memStore().store, listed: async () => false });
  assert.deepEqual(r, {
    done: false,
    note: `The payout wallet ${account.address} needs a little ETH for gas. Payouts resume once it is topped up.`,
  });
  assert.equal(f.sent.length, 0);
  const g = fakeRpc();
  const late = await payCampaign(campaign, [entry(1, 50)], {
    account, rpc: g.rpc, store: memStore().store, listed: async () => false, deadline: Date.now() - 1,
  });
  assert.deepEqual(late, { done: false, note: 'Payout stopped early; it continues on the next run.' });
  assert.equal(g.sent.length, 0);
});

test('safety: CAMPAIGN_PAYOUT_PRIVATE_KEY is the only key ever used', () => {
  const key = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
  assert.equal(
    payoutAccount({ PAYOUT_PRIVATE_KEY: key, OPERATOR_PRIVATE_KEY: key, GUARDIAN_PRIVATE_KEY: key, DEPLOYER_PRIVATE_KEY: key }),
    null,
  );
  assert.equal(payoutAccount({ CAMPAIGN_PAYOUT_PRIVATE_KEY: ` ${key} ` })!.address, account.address);
});

test('safety: an entry already paid before v2.4 (prize_tx kept, no signed bytes, no status) is never paid again', async () => {
  const f = fakeRpc();
  const s = memStore();
  const legacy = entry(1, 50, { prize_tx: '0x' + '2'.repeat(64) });
  assert.deepEqual(await payCampaign(campaign, [legacy, entry(2, 40)], { account, rpc: f.rpc, store: s.store, listed: async () => false }), { done: true, note: null });
  assert.deepEqual((await Promise.all(f.sent.map(decodeSent))).map((d) => d.recipient), [row(2).payout_wallet]);
  assert.equal(await payWinner(row(1, { prize_tx: '0x' + '2'.repeat(64) }), { token: TOKEN, amount: ONE, amountText: '1', account, rpc: f.rpc, store: s.store }), 'paid');
  assert.equal(f.sent.length, 1);
});
