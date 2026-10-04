import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseTransaction,
  parseUnits,
  recoverTransactionAddress,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { feeCaps, payCampaign, payWinner, payoutAccount, type PayoutRpc, type PayoutStore } from './payout';
import type { EarnKitCampaign } from './campaigns';

const account = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'); // anvil #3
const TOKEN = '0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07' as Hex;
const ONE = parseUnits('1', 18);

function fakeRpc(o: { chainId?: number; balance?: () => bigint; mined?: 'success' | 'reverted' | null } = {}) {
  const sent: Hex[] = [];
  const receipts = new Map<Hex, { status: 'success' | 'reverted' }>();
  /** Receipts at or below the finalized block. */
  const final = new Set<Hex>();
  const rpc: PayoutRpc = {
    getChainId: async () => o.chainId ?? 8453,
    nonce: async () => 7,
    finalizedNonce: async () => 0,
    transaction: async (h) => receipts.has(h),
    finalReceipt: async (h) => final.has(h),
    fees: async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    estimateGas: async () => 50_000n,
    receipt: async (h) => receipts.get(h) ?? null,
    broadcast: async (raw) => {
      sent.push(raw);
      if (o.mined !== null) receipts.set(keccak256(raw), { status: o.mined ?? 'success' });
      return 'sent';
    },
    waitFor: async (h) => receipts.get(h) ?? null,
    balanceOf: async () => (o.balance ? o.balance() : 10n ** 30n),
  };
  return { rpc, sent, receipts, final };
}

function memStore(sentSoFar: () => number = () => 0) {
  const calls: unknown[][] = [];
  const reverts = new Map<number, number>();
  const store: PayoutStore = {
    sending: async (id, hash) => { calls.push(['sending', id, hash, sentSoFar()]); return true; },
    paid: async (id, amount) => { calls.push(['paid', id, amount]); },
    failed: async (id, reverted) => {
      calls.push(['failed', id]);
      reverts.set(id, (reverts.get(id) ?? 0) + (reverted ? 1 : 0));
      return reverts.get(id)!;
    },
    refused: async (id) => { calls.push(['refused', id]); },
    stale: async (id, at) => { calls.push(['stale', id, at]); },
  };
  return { store, calls };
}

const row = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  payout_wallet: `0x${String(id).padStart(40, '0')}`,
  payout_status: null as string | null,
  prize_tx: null as string | null,
  prize_raw_tx: null as string | null,
  payout_stale_at: null as Date | null,
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

// Fix round 1 (Ruling 30).

/** A chain that checks nonces: below the confirmed nonce is "nonce too low"; `rpcNonce` is what the RPC reports. */
function nonceChain(o: { confirmed: number; rpcNonce: () => number; revertTo?: string }) {
  const f = fakeRpc();
  let confirmed = o.confirmed;
  const nonces: number[] = [];
  f.rpc.nonce = async () => o.rpcNonce();
  f.rpc.finalizedNonce = async () => confirmed;
  f.rpc.broadcast = async (raw) => {
    const tx = parseTransaction(raw);
    if (tx.nonce! < confirmed) return 'stale';
    f.sent.push(raw);
    nonces.push(tx.nonce!);
    confirmed = tx.nonce! + 1;
    const { args } = decodeFunctionData({ abi: erc20Abi, data: tx.data! });
    const reverts = o.revertTo && (args![0] as string).toLowerCase() === o.revertTo.toLowerCase();
    f.receipts.set(keccak256(raw), { status: reverts ? 'reverted' : 'success' });
    return 'sent';
  };
  return { ...f, nonces };
}

// Fix round 2 (Ruling 32): a "nonce too low" answer is never cleared in the same run.

const NOW = new Date('2026-10-21T02:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const signedAt = (nonce: number) =>
  account.signTransaction({
    chainId: 8453, type: 'eip1559', to: TOKEN, nonce, gas: 60_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [row(1).payout_wallet as Hex, ONE] }),
  });

test('Ruling 32: a first broadcast answered "nonce too low" stays sending (stale time recorded); once mined it is paid, never signed again', async () => {
  const c = nonceChain({ confirmed: 9, rpcNonce: () => 7 });
  const s = memStore();
  const r1 = row(1);
  const a = { token: TOKEN, amount: ONE, amountText: '1', account, rpc: c.rpc, store: s.store, now: NOW };
  assert.equal(await payWinner(r1, a), 'pending');
  assert.deepEqual(s.calls.map((x) => x.slice(0, 2)), [['sending', 1], ['stale', 1]]);
  assert.equal((s.calls[1][2] as Date).getTime(), NOW.getTime());
  assert.equal(r1.payout_status, 'sending');
  // The provider had in fact sent it: it is mined. The next run records it as paid.
  c.receipts.set(r1.prize_tx as Hex, { status: 'success' });
  assert.equal(await payWinner(r1, { ...a, now: new Date(NOW.getTime() + 3_600_000) }), 'paid');
  assert.deepEqual(s.calls.map((x) => x[0]), ['sending', 'stale', 'paid']);
  assert.equal(c.sent.length, 0);
});

/** Signed by the payout key with this nonce, to another wallet (an earlier winner's transfer). */
const otherAt = (nonce: number) =>
  account.signTransaction({
    chainId: 8453, type: 'eip1559', to: TOKEN, nonce, gas: 60_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [row(9).payout_wallet as Hex, ONE] }),
  });

test('Ruling 33 + M1: stale 30+ min, typed not-found, finalized nonce taken by our own other PAID transfer whose receipt is final: cleared once, re-signed once', async () => {
  const signed = await signedAt(7);
  const ours = await otherAt(7);
  const c = nonceChain({ confirmed: 8, rpcNonce: () => 8 });
  // M1: the other paid transfer's receipt is found at or below the finalized block.
  c.final.add(keccak256(ours));
  const s = memStore();
  const paidOther = entry(9, 60, { payout_status: 'paid', prize_tx: keccak256(ours), prize_raw_tx: ours });
  const stuck = entry(1, 50, { payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed, payout_stale_at: minutesAgo(31) });
  const r = await payCampaign(campaign, [paidOther, stuck, entry(2, 40)], { account, rpc: c.rpc, store: s.store, listed: async () => false, now: NOW });
  assert.deepEqual(r, { done: true, note: null });
  assert.deepEqual(s.calls.map((x) => x.slice(0, 2)), [['failed', 1], ['sending', 1], ['paid', 1]]);
  assert.deepEqual(c.nonces, [8]);
  assert.equal((await decodeSent(c.sent[0])).recipient, row(1).payout_wallet);
});

test('M1: until the other paid transfer\'s receipt is final, the stale send is not cleared (pending); then it is', async () => {
  const signed = await signedAt(7);
  const ours = await otherAt(7);
  const c = nonceChain({ confirmed: 8, rpcNonce: () => 8 });
  const asked: Hex[] = [];
  c.rpc.finalReceipt = async (h) => { asked.push(h); return c.final.has(h); };
  const s = memStore();
  const entries = () => [
    entry(9, 60, { payout_status: 'paid', prize_tx: keccak256(ours), prize_raw_tx: ours }),
    entry(1, 50, { payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed, payout_stale_at: minutesAgo(31) }),
  ];
  const pay = () => payCampaign(campaign, entries(), { account, rpc: c.rpc, store: s.store, listed: async () => false, now: NOW });
  assert.deepEqual(await pay(), { done: false, note: 'Waiting for the transfer to entry #1 to be mined.' });
  assert.deepEqual(asked, [keccak256(ours)], 'the receipt asked about is the other paid transfer\'s');
  assert.equal(s.calls.length, 0);
  assert.equal(c.sent.length, 0);
  c.final.add(keccak256(ours));
  assert.deepEqual(await pay(), { done: true, note: null });
  assert.deepEqual(s.calls.map((x) => x.slice(0, 2)), [['failed', 1], ['sending', 1], ['paid', 1]]);
});

test('Ruling 33: a nonce taken by an unknown transaction is never cleared; the page asks for a manual check', async () => {
  const signed = await signedAt(7);
  const c = nonceChain({ confirmed: 8, rpcNonce: () => 8 });
  const s = memStore();
  const stuck = entry(1, 50, { payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed, payout_stale_at: minutesAgo(600) });
  const r = await payCampaign(campaign, [stuck, entry(2, 40)], { account, rpc: c.rpc, store: s.store, listed: async () => false, now: NOW });
  assert.deepEqual(r, { done: false, note: 'Payouts paused: a transfer needs a manual check.' });
  assert.deepEqual(s.calls, []);
  assert.equal(c.sent.length, 0);
  assert.equal(stuck.payout_status, 'sending');
});

test('Ruling 33: a receipt or transaction read that errors (not a typed not-found) never clears: the run fails', async () => {
  const signed = await signedAt(7);
  const ours = await otherAt(7);
  for (const broken of ['receipt', 'transaction'] as const) {
    const c = nonceChain({ confirmed: 8, rpcNonce: () => 8 });
    c.rpc[broken] = async () => { throw new Error('HTTP 429 Too Many Requests'); };
    const s = memStore();
    const entries = [
      entry(9, 60, { payout_status: 'paid', prize_tx: keccak256(ours), prize_raw_tx: ours }),
      entry(1, 50, { payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed, payout_stale_at: minutesAgo(31) }),
    ];
    await assert.rejects(payCampaign(campaign, entries, { account, rpc: c.rpc, store: s.store, listed: async () => false, now: NOW }), /429/);
    assert.deepEqual(s.calls, [], broken);
    assert.equal(c.sent.length, 0);
  }
});

test('Ruling 33: a later broadcast that is accepted resets the stale time', async () => {
  const signed = await signedAt(7);
  const f = fakeRpc({ mined: null });
  const s = memStore();
  const r1 = row(1, { payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed, payout_stale_at: minutesAgo(5) });
  assert.equal(await payWinner(r1, { token: TOKEN, amount: ONE, amountText: '1', account, rpc: f.rpc, store: s.store, now: NOW }), 'pending');
  assert.deepEqual(s.calls, [['stale', 1, null]]);
  assert.equal(r1.payout_stale_at, null);
});

test('Ruling 32: stale under 30 minutes, or the nonce not used yet, keeps waiting (rebroadcast, never cleared)', async () => {
  const signed = await signedAt(7);
  for (const [ago, confirmed] of [[10, 8], [31, 7]] as const) {
    const c = nonceChain({ confirmed, rpcNonce: () => confirmed });
    if (confirmed === 8) c.rpc.broadcast = async () => 'stale';
    const s = memStore();
    const r = await payWinner(
      row(1, { payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed, payout_stale_at: minutesAgo(ago) }),
      { token: TOKEN, amount: ONE, amountText: '1', account, rpc: c.rpc, store: s.store, now: NOW },
    );
    if (confirmed === 8) {
      assert.equal(r, 'pending', `${ago} min: still waiting`);
      assert.deepEqual(s.calls, []);
    } else {
      // The nonce was free: the same bytes went out and were mined.
      assert.equal(r, 'paid');
      assert.deepEqual(c.sent, [signed]);
    }
  }
});

test('minor (Ruling 32): followOnly follows transfers in flight to paid and signs nothing new', async () => {
  const signed = await signedAt(7);
  const f = fakeRpc();
  f.receipts.set(keccak256(signed), { status: 'success' });
  const s = memStore();
  const entries = [entry(1, 50, { payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed }), entry(2, 40)];
  const r = await payCampaign(campaign, entries, { account, rpc: f.rpc, store: s.store, listed: async () => false, followOnly: true });
  assert.deepEqual(r, { done: false, note: null });
  assert.deepEqual(s.calls.map((x) => x.slice(0, 2)), [['paid', 1]]);
  assert.equal(f.sent.length, 0);
});

test('minor (Ruling 32): the gas limit is the estimate x 1.5', async () => {
  const f = fakeRpc();
  await payWinner(row(1), { token: TOKEN, amount: ONE, amountText: '1', account, rpc: f.rpc, store: memStore().store });
  assert.equal(parseTransaction(f.sent[0]).gas, 75_000n);
});

test('I1: with an RPC that keeps reporting a stale pending nonce, winners in one run still get consecutive nonces', async () => {
  const c = nonceChain({ confirmed: 7, rpcNonce: () => 7 });
  const s = memStore();
  const r = await payCampaign(campaign, [entry(1, 50), entry(2, 40)], { account, rpc: c.rpc, store: s.store, listed: async () => false });
  assert.deepEqual(r, { done: true, note: null });
  assert.deepEqual(c.nonces, [7, 8]);
  assert.deepEqual(s.calls.filter((x) => x[0] === 'paid').map((x) => x[1]), [1, 2]);
});

test('I2: prize_amount is the amount signed, from the terms passed in', async () => {
  const f = fakeRpc();
  const s = memStore();
  await payCampaign({ ...campaign, amount_each: '125' }, [entry(1, 50)], { account, rpc: f.rpc, store: s.store, listed: async () => false });
  const [d] = await Promise.all(f.sent.map(decodeSent));
  const paid = s.calls.find((x) => x[0] === 'paid')!;
  assert.equal(parseUnits(paid[2] as string, 18), d.amount);
  assert.equal(d.amount, parseUnits('125', 18));
});

test('I3: a transfer in flight is followed to paid even after its entry left the winners, and it takes a slot', async () => {
  const W1 = row(1).payout_wallet as Hex;
  const signed = await account.signTransaction({
    chainId: 8453, type: 'eip1559', to: TOKEN, nonce: 7, gas: 60_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [W1, ONE] }),
  });
  const f = fakeRpc();
  f.receipts.set(keccak256(signed), { status: 'success' });
  const s = memStore();
  const entries = [
    entry(1, 10, { vetoed_at: new Date(), payout_status: 'sending', prize_tx: keccak256(signed), prize_raw_tx: signed }),
    entry(2, 50), entry(3, 40), entry(4, 30),
  ];
  const r = await payCampaign(campaign, entries, { account, rpc: f.rpc, store: s.store, listed: async () => false });
  assert.deepEqual(r, { done: true, note: null });
  assert.deepEqual(s.calls.filter((x) => x[0] === 'paid').map((x) => x[1]), [1, 2], 'winners = 2: the mined transfer counts');
  assert.equal(f.sent.length, 1);
});

test('I3: an entry already paid counts toward the winners even when it no longer ranks', async () => {
  const f = fakeRpc();
  const s = memStore();
  const entries = [entry(1, 5, { payout_status: 'paid', prize_tx: '0x' + '3'.repeat(64) }), entry(2, 50), entry(3, 40)];
  await payCampaign(campaign, entries, { account, rpc: f.rpc, store: s.store, listed: async () => false });
  assert.deepEqual(s.calls.filter((x) => x[0] === 'paid').map((x) => x[1]), [2]);
});

test('M1: the fee cap is twice the base fee plus the tip', () => {
  assert.deepEqual(feeCaps(100n, 3n), { maxFeePerGas: 203n, maxPriorityFeePerGas: 3n });
});

test('M4: a transfer that reverts twice refuses that entry with a note, and the next entry is paid', async () => {
  const c = nonceChain({ confirmed: 7, rpcNonce: () => 7, revertTo: row(1).payout_wallet });
  let nonce = 7;
  c.rpc.nonce = async () => nonce;
  const s = memStore();
  const deps = { account, rpc: c.rpc, store: s.store, listed: async () => false };
  const entries = [entry(1, 50), entry(2, 40), entry(3, 30)];
  const first = await payCampaign(campaign, entries, deps);
  assert.match(first.note!, /The transfer to entry #1 failed; it is retried on the next run\./);
  nonce = 8;
  const second = await payCampaign(campaign, entries, deps);
  assert.equal(second.done, true);
  assert.match(second.note!, /The transfer to entry #1 reverted twice; that entry was skipped and the next one moved up\./);
  assert.deepEqual(s.calls.filter((x) => x[0] === 'refused' || x[0] === 'paid').map((x) => x.slice(0, 2)), [['refused', 1], ['paid', 2], ['paid', 3]]);
});
