import { randomBytes } from 'node:crypto';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type Hex } from 'viem';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { withEnv } from './fixtures/find';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { lastFinishedMonday } from './weeks';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import { BASE_BONUS, CONFIRMATIONS, type BonusRpc, type TxLog } from './bonus-ledger';
import { BACKER_EXCLUDED, backersOf, indexBackers } from './backers';
import { CLAIM_TOKENS, earnedUsd, indexCreatorFees } from './earned';
import { refreshFees, setFeeSource } from './fees';
import { profileData } from './bench-data';
import { builderJson } from './builder-json';
import { readStats } from './stats';
import { backingLine } from './bench-reply';
import BenchProfileView from '../../app/[handle]/BenchProfileView';

/**
 * v3 Stage 2 Task 4 (spec 5.2, 5.3 Route 2): backers (distinct wallets that received the coin, indexed from Base) and
 * Earned (creator fees claimed to the builder's wallet plus announced program prizes), with "and $X waiting" for the
 * fees still in the FeeLocker; the third number on the page, the reply's stand line, the builder JSON and /api/stats.
 */
(globalThis as { React?: typeof React }).React = React;
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v3-earned-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  setFeeSource(null);
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const ON = { EARNKIT_RAISING: 'on' };
const OFF = { EARNKIT_RAISING: undefined };
const on = <T>(fn: () => Promise<T>) => withEnv(ON, fn);
const off = <T>(fn: () => Promise<T>) => withEnv(OFF, fn);
const E18 = 10n ** 18n;
let n = 0;
/** A fresh lowercase address (`_tag` names it in the test only). */
const addr = (_tag: string) => `0x${randomBytes(20).toString('hex')}` as Hex;
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/** An ERC-20 Transfer log of `coin` at `block`. */
const transfer = (coin: Hex, from: string, to: string, block: bigint, i: number): TxLog => ({
  address: coin,
  topics: encodeEventTopics({ abi: [TRANSFER], eventName: 'Transfer', args: { from: from as Hex, to: to as Hex } }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }], [1000n]),
  logIndex: i,
  txHash: `0x${block.toString(16).padStart(60, '0')}${String(i).padStart(4, '0')}` as Hex,
  blockNumber: block,
});
/** A FeeLocker ClaimTokens log (feeOwner, token indexed; data = amountClaimed). */
const claim = (owner: string, amount: bigint, block: bigint, i: number, o: { token?: string; address?: string } = {}): TxLog => ({
  address: o.address ?? BASE_BONUS.feeLocker,
  topics: encodeEventTopics({ abi: [CLAIM_TOKENS], eventName: 'ClaimTokens', args: { feeOwner: owner as Hex, token: (o.token ?? BASE_BONUS.weth) as Hex } }) as Hex[],
  data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
  logIndex: i,
  txHash: `0x${randomBytes(32).toString('hex')}` as Hex,
  blockNumber: block,
});

/** A fake Base for the indexers: `head` (moves between runs), the launch receipt's block, the logs by block. */
function fakeChain(o: { launch: bigint; transfers?: TxLog[]; claims?: TxLog[]; hook?: string }) {
  const s = { head: 0n, ranges: [] as [bigint, bigint][], fail: new Set<string>() };
  const rpc = {
    blockNumber: async () => s.head + CONFIRMATIONS,
    receiptLogs: async () => ({ blockNumber: o.launch, logs: [] }),
    blockTime: async (b: bigint) => new Date(Date.UTC(2026, 9, 1) + Number(b) * 2000),
    transferLogs: async (token: Hex, lo: bigint, hi: bigint) => {
      if (s.fail.has(token)) throw new Error('rpc down');
      s.ranges.push([lo, hi]);
      return (o.transfers ?? []).filter((l) => l.address === token && l.blockNumber >= lo && l.blockNumber <= hi);
    },
    poolHooks: async () => o.hook ?? null,
    // Every claim in the range, whatever its owner: the indexer must keep only the creator's own.
    claimTokenLogs: async (_owner: Hex, lo: bigint, hi: bigint) => {
      s.ranges.push([lo, hi]);
      return (o.claims ?? []).filter((l) => l.blockNumber >= lo && l.blockNumber <= hi);
    },
  } as unknown as BonusRpc;
  return { s, rpc };
}

/** A launched Base coin entry (as tokens.ts records it) on `installation`. */
async function coinEntry(installation: number, o: { coin: Hex; wallet: Hex; key?: string; symbol?: string; raising?: boolean }) {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at,
      coin_launched_at, coin_address, coin_tx, coin_chain_id, creator_wallet)
    VALUES ('earnkit-coin', 'Kit', ${o.key ? `https://github.com/${o.key}` : null}, ${o.key ? `github.com/${o.key.toLowerCase()}` : null}, ${installation},
      ${o.symbol ?? 'KIT'}, 'launched', ${`https://tokens.fun/coin/${o.coin}`}, ${o.raising ? new Date() : null}, now(), ${o.coin},
      ${`0x${'a'.repeat(64)}`}, 8453, ${o.wallet}) RETURNING id`;
  return id;
}
async function plainInstallation(tag: string) {
  const t = `ek_v3e_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  return (await connectInstallation(t))!.id;
}

type B = { ctx: Parameters<typeof mcpCall>[0]; id: number; key: string; handle: string };
/** A ranked builder (signed in with X, the repo proven by the App and read public), with last week approved. */
async function builder(tag: string): Promise<B> {
  n++;
  const t = `ek_v3e_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `ve${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `97${RUN}${n}${tag.length}`, username: handle, name: 've', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `ve${tag}${RUN}/kit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true, verdicts: [] }];
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never,
    tokenDeps: { check: async () => true },
  } as Parameters<typeof mcpCall>[0];
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 8000 + n * 10 + (Number(RUN) % 7);
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key.toLowerCase()]: { id: gid, owner: handle, installation: gid + 1 } }) });
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  await sql()`
    INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${c.id}, ${key}, ${lastFinishedMonday(new Date())},
      ${sql().json({ shipped_code: { n: 3 }, checked: true, approved: true } as never)})
    ON CONFLICT (project_key, week) DO UPDATE SET facts = project_updates.facts || EXCLUDED.facts`;
  // The backing offer is another task's moment: answered, so it never takes the step here.
  await sql()`INSERT INTO coin_moments (builder_id, project_key, moment, answer) VALUES (${c.id}, ${key}, 'first_week', 'no') ON CONFLICT DO NOTHING`.catch(() => {});
  return { ctx, id: c.id, key, handle };
}
const find = (b: B) => mcpCall(b.ctx, 'find', {});
/** The line under "Where you stand". */
const standLine = (s: string) => {
  const lines = s.split('\n');
  return lines[lines.indexOf('Where you stand') + 1] ?? '';
};
/** An announced prize (or another outcome) for an entry of `installation`. */
async function outcome(installation: number, result: string, basis: string, prize: number | null) {
  const tag = `v3e-prog-${RUN}`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'closed', 'unknown') ON CONFLICT DO NOTHING`;
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO projects (program_id, name, installation_id) VALUES (${tag}, 'p', ${installation}) RETURNING id`;
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis) VALUES (${id}, ${tag}, 'R1', ${result}, ${prize}, ${basis})`;
}
/** WETH at $2,000; `waiting` WETH in the FeeLocker for every wallet. */
const fees = (waiting: bigint) => setFeeSource({ availableWeth: async () => waiting, wethUsd: async () => 2000 });

test('(a) indexBackers counts distinct recipients, skips zero/pool/locker/safe, advances the cursor and resumes', db, async () => {
  const inst = await plainInstallation('a');
  const coin = addr('a1');
  const other = addr('a2');
  const [w1, w2, w3, hook] = [addr('b1'), addr('b2'), addr('b3'), addr('h1')];
  await coinEntry(inst, { coin, wallet: addr('c1') });
  await coinEntry(inst, { coin: other, wallet: addr('c2') });
  const ZERO = '0x0000000000000000000000000000000000000000';
  const POOL = BACKER_EXCLUDED.poolManager;
  const transfers = [
    transfer(coin, ZERO, BACKER_EXCLUDED.factory, 5_000n, 1), // the mint
    transfer(coin, BACKER_EXCLUDED.factory, BASE_BONUS.lockers[0], 5_000n, 2),
    transfer(coin, BASE_BONUS.lockers[0], POOL, 5_000n, 3),
    transfer(coin, POOL, w1, 6_000n, 1),
    transfer(coin, POOL, w2, 7_000n, 1),
    transfer(coin, w1, w2, 7_400n, 1), // w2 again: counted once
    transfer(coin, w2, hook, 7_450n, 1),
    transfer(coin, POOL, BASE_BONUS.feeLocker, 7_460n, 1),
    transfer(coin, POOL, BASE_BONUS.safe, 7_470n, 1),
    transfer(coin, w2, ZERO, 7_480n, 1), // a burn
    transfer(coin, POOL, w3, 9_500n, 1),
  ];
  const f = fakeChain({ launch: 5_000n, transfers, hook });
  f.s.fail.add(other); // one coin's failure never stops the rest
  f.s.head = 7_500n;
  const first = await indexBackers(new Date(), { rpc: f.rpc, deadline: Date.now() + 25_000, only: [coin, other] });
  assert.equal(first.failed, 1, JSON.stringify(first));
  assert.ok(f.s.ranges.every(([lo, hi]) => hi - lo + 1n <= 2_000n), 'at most 2,000 blocks a call');
  assert.equal(f.s.ranges[0][0], 5_000n, 'from the launch block (the coin_tx receipt)');
  assert.equal((await backersOf([coin])).get(coin), 2);
  const [cur] = await sql()<{ block: string }[]>`SELECT block::text AS block FROM coin_backer_cursor WHERE coin = ${coin}`;
  assert.equal(cur.block, '7500');
  const rows = await sql()<{ wallet: string; first_block: string }[]>`SELECT wallet, first_block::text AS first_block FROM coin_backers WHERE coin = ${coin} ORDER BY first_block`;
  assert.deepEqual(rows.map((r) => [r.wallet, r.first_block]), [[w1, '6000'], [w2, '7000']]);

  // The next run resumes after the cursor.
  f.s.ranges = [];
  f.s.head = 10_000n;
  await indexBackers(new Date(), { rpc: f.rpc, deadline: Date.now() + 25_000, only: [coin] });
  assert.equal(f.s.ranges[0][0], 7_501n);
  assert.equal((await backersOf([coin, other])).get(coin), 3);
  assert.equal((await backersOf([coin, other])).get(other) ?? 0, 0);
  // Past the deadline: nothing is read.
  f.s.ranges = [];
  f.s.head = 12_000n;
  await indexBackers(new Date(), { rpc: f.rpc, deadline: Date.now() - 1, only: [coin] });
  assert.equal(f.s.ranges.length, 0);
  // Without a Transfer reader (an RPC that can't read logs), the step is skipped.
  assert.deepEqual(await indexBackers(new Date(), { rpc: {} as BonusRpc, only: [coin] }), { skipped: 'no reader' });
});

test('(b) indexCreatorFees records claims to the creator wallet only', db, async () => {
  const inst = await plainInstallation('b');
  const coin = addr('d1');
  const wallet = addr('e1');
  const stranger = addr('e2');
  await coinEntry(inst, { coin, wallet });
  const claims = [
    claim(wallet, E18 / 10n, 5_100n, 1),
    claim(stranger, E18, 5_200n, 1), // another owner
    claim(wallet, E18, 5_300n, 1, { token: addr('f1') }), // not WETH
    claim(wallet, E18, 5_400n, 1, { address: addr('f2') }), // not the FeeLocker
    claim(wallet, E18 / 20n, 8_000n, 2),
  ];
  const f = fakeChain({ launch: 5_000n, claims });
  f.s.head = 6_000n;
  await indexCreatorFees(new Date(), { rpc: f.rpc, deadline: Date.now() + 25_000, only: [coin] });
  assert.ok(f.s.ranges.every(([lo, hi]) => hi - lo + 1n <= 2_000n));
  const read = async () => sql()<{ wallet: string; amount_wei: string; coin: string; block_number: string }[]>`
    SELECT wallet, amount_wei::text AS amount_wei, coin, block_number::text AS block_number FROM creator_fees WHERE coin = ${coin} ORDER BY block_number`;
  assert.deepEqual((await read()).map((r) => [r.wallet, r.amount_wei, r.block_number]), [[wallet, (E18 / 10n).toString(), '5100']]);
  // Resumes after its cursor; a claim read twice is stored once.
  f.s.ranges = [];
  f.s.head = 9_000n;
  await indexCreatorFees(new Date(), { rpc: f.rpc, deadline: Date.now() + 25_000, only: [coin] });
  assert.equal(f.s.ranges[0][0], 6_001n);
  await sql()`DELETE FROM bonus_cursor WHERE id = ${`creator_fees:${coin}`}`;
  await indexCreatorFees(new Date(), { rpc: f.rpc, deadline: Date.now() + 25_000, only: [coin] });
  assert.deepEqual((await read()).map((r) => r.amount_wei), [(E18 / 10n).toString(), (E18 / 20n).toString()]);
});

test('(c) earnedUsd sums claims at the WETH price plus announced prizes; waiting from cachedFeesUsd', db, async () => {
  const inst = await plainInstallation('c');
  const coin = addr('g1');
  const wallet = addr('g2');
  await coinEntry(inst, { coin, wallet });
  fees(E18 / 4n); // $500 waiting
  const f = fakeChain({ launch: 5_000n, claims: [claim(wallet, E18 / 10n, 5_100n, 1)] }); // $200 claimed
  f.s.head = 6_000n;
  await indexCreatorFees(new Date(), { rpc: f.rpc, deadline: Date.now() + 25_000, only: [coin] });
  await outcome(inst, 'won', 'announcement', 500);
  await outcome(inst, 'won', 'self_reported', 9_000); // a self-report never counts
  await outcome(inst, 'finalist', 'announcement', 700); // not a win
  // Waiting is the cached FeeLocker read (never awaited on the reply path): none cached yet.
  const cold = await earnedUsd(inst, new Date());
  assert.equal(cold.paid_usd, 700);
  assert.equal(cold.waiting_usd, 0);
  await refreshFees([wallet]);
  assert.deepEqual(await earnedUsd(inst, new Date()), { paid_usd: 700, waiting_usd: 500, fees_usd: 200 });
  // Nothing earned: zeros, never an error.
  assert.deepEqual(await earnedUsd(await plainInstallation('c0'), new Date()), { paid_usd: 0, waiting_usd: 0, fees_usd: 0 });
});

test('(d) the profile shows Earned as the third number and the waiting line; the reply stand line carries Earned when paid', db, () => on(async () => {
  const b = await builder('d');
  const coin = addr('k1');
  const wallet = addr('k2');
  await coinEntry(b.id, { coin, wallet, key: b.key, symbol: 'KITD', raising: true });
  fees(E18 / 4n);
  await refreshFees([wallet]);
  await sql()`INSERT INTO creator_fees (tx_hash, log_index, coin, wallet, amount_wei, block_number, block_time)
    VALUES (${`0x${'d'.repeat(64)}`}, 1, ${coin}, ${wallet}, ${(E18 / 10n).toString()}, 5100, now())`;
  await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${coin}, ${addr('m1')}, 6000), (${coin}, ${addr('m2')}, 6001)`;
  const d = (await profileData(b.id, new Date()))!;
  assert.ok(d.bench, 'ranked');
  assert.deepEqual(d.earned, { paid_usd: 200, waiting_usd: 500 });
  assert.deepEqual(d.backing, { symbol: 'KITD', url: `https://tokens.fun/coin/${coin}`, backers: 2, earned_usd: 200 });
  const html = renderToStaticMarkup(React.createElement(BenchProfileView, { data: d, tab: 'log' }));
  const earned = html.match(/<[^>]*data-ek-earned[^>]*>([\s\S]*?)<\/(p|div)>/);
  assert.ok(earned, html);
  assert.match(html, /data-ek-earned[^>]*>\$200</, html);
  assert.ok(html.includes('and $500 waiting'), html);
  // The third number: after the Shipping ring and the rank.
  assert.ok(html.indexOf('data-ek-earned') > html.indexOf('Shipping'), html);
  assert.ok(html.indexOf('data-ek-earned') > html.indexOf(d.bench!.split(' ')[0]), html);

  const r = show(await find(b));
  assert.match(standLine(r), /\. Earned \$200\.$/, r);
  assert.ok(r.includes(`Backing: 2 backers, $200 earned. Your page: earnkit.com/${b.handle}`), r);
  assert.equal(links(r).length, 1, r);
  assert.ok(questions(r) <= 1, r);
  assert.doesNotMatch(r, /—/);
  assert.equal(backingLine(1, 0, 'earnkit.com/x'), 'Backing: 1 backer, $0 earned. Your page: earnkit.com/x');

  // The builder JSON carries Earned and the backing counts.
  const j = (await builderJson(b.handle, new Date()))!;
  assert.deepEqual(j.earned, { paid_usd: 200, waiting_usd: 500 });
  assert.deepEqual(j.backing, { symbol: 'KITD', url: `https://tokens.fun/coin/${coin}`, backers: 2, earned_usd: 200 });

  // Ranked with nothing earned: "$0", no waiting line, and no Earned in the reply.
  fees(0n);
  const z = await builder('z');
  const dz = (await profileData(z.id, new Date()))!;
  assert.deepEqual(dz.earned, { paid_usd: 0, waiting_usd: 0 });
  const hz = renderToStaticMarkup(React.createElement(BenchProfileView, { data: dz, tab: 'log' }));
  assert.match(hz, /data-ek-earned[^>]*>\$0</, hz);
  assert.doesNotMatch(hz, /waiting/);
  assert.doesNotMatch(show(await find(z)), /Earned/);
}));

test('(e) flag off: backers and backing_open absent, Earned still shows program prizes', db, async () => {
  fees(0n);
  const b = await off(() => builder('e'));
  const coin = addr('p1');
  await coinEntry(b.id, { coin, wallet: addr('p2'), key: b.key, symbol: 'KITE', raising: true });
  await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${coin}, ${addr('p3')}, 6000)`;
  await outcome(b.id, 'won', 'announcement', 340);
  const onStats = await on(() => readStats(new Date()));
  assert.ok((onStats.backing_open ?? 0) >= 1, JSON.stringify(onStats));
  assert.ok((onStats.backers ?? 0) >= 1);
  assert.ok(onStats.earned_usd >= 340);
  await off(async () => {
    const d = (await profileData(b.id, new Date()))!;
    assert.equal(d.backing, null);
    assert.deepEqual(d.earned, { paid_usd: 340, waiting_usd: 0 });
    const html = renderToStaticMarkup(React.createElement(BenchProfileView, { data: d, tab: 'log' }));
    assert.match(html, /data-ek-earned[^>]*>\$340</, html);
    assert.doesNotMatch(html, /backers|Backing|data-ek-back/i);
    const r = show(await find(b));
    assert.match(standLine(r), /\. Earned \$340\.$/, r);
    assert.doesNotMatch(r, /backing|backers/i, r);
    const j = (await builderJson(b.handle, new Date()))!;
    assert.equal(j.backing, null);
    assert.deepEqual(j.earned, { paid_usd: 340, waiting_usd: 0 });
    const s = await readStats(new Date());
    assert.ok(!('backing_open' in s) && !('backers' in s), JSON.stringify(s));
    assert.equal(s.earned_usd, onStats.earned_usd);
  });
});
