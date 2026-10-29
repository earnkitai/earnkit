import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { ignitionClues } from './discovery-clues';
import { discoverPerson } from './discovery';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { mcpCall } from './fixtures/mcp-call';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import type { ReaderDeps } from './source-readers';
import { person as findPerson } from './fixtures/find';
import { AlchemyNetworkOff, BASE_USDC, contractFlows, type AlchemyCall } from './alchemy';
import { USED_CONTRACTS, USED_PAGES } from './used-by';
import { contractsRevenue, latestRevenue, revenueDue, runRevenue } from './revenue';
import { runCron } from './cron';
import { SHIP_LOG_NOTE, shipLogBlock, shipLogFacts, type ShipLogFacts } from './ship-log-facts';
import { replyFacts } from './reply-facts';
import { builderJson } from './builder-json';
import { profileData } from './bench-data';
import { USED_MIN, USED_STALE_DAYS, highlights, profileSite } from './site-data';
import { readStats } from './stats';
import { feedWeeks } from './feed';
import { committedProgram } from './fixtures/program-file';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';

/** v4.5 Task 1: Hardhat Ignition deploy files are contract clues (never a GitHub or Alchemy read: fakes only). */
appEnv();
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const addr = () => '0x' + randomBytes(20).toString('hex');
const A = '0x' + 'ab'.repeat(20);
const B = '0x' + 'cd'.repeat(20);
const C = '0x' + 'ef'.repeat(20);

test('1.1 ignition: deployed_addresses entries on Base with the journal\'s sender per future id', () => {
  const deployed = JSON.stringify({ 'Counter#Counter': A.toUpperCase().replace('0X', '0x'), 'Other#Token': B, 'Bad#Thing': 'nope' });
  const journal = [
    JSON.stringify({ type: 'DEPLOYMENT_INITIALIZE', chainId: 8453 }),
    JSON.stringify({ type: 'DEPLOYMENT_EXECUTION_STATE_INITIALIZE', futureId: 'Counter#Counter', from: C.toUpperCase().replace('0X', '0x') }),
    'not json "futureId"',
    JSON.stringify({ type: 'NETWORK_INTERACTION_REQUEST', futureId: 'Other#Token', networkInteraction: { id: 1, from: C } }),
  ].join('\n');
  assert.deepEqual(ignitionClues(deployed, journal, '8453'), [
    { chain: 'base', address: A, deployer: C, via: 'ignition' },
    { chain: 'base', address: B, deployer: C, via: 'ignition' },
  ]);
  assert.deepEqual(ignitionClues(deployed, null, '8453').map((c) => c.deployer), [null, null]);
  assert.deepEqual(ignitionClues(deployed, '', '8453').map((c) => c.deployer), [null, null]);
});

test('1.2 ignition: other chains, malformed JSON and non-objects give none', () => {
  const deployed = JSON.stringify({ 'Counter#Counter': A });
  assert.deepEqual(ignitionClues(deployed, null, '1'), []);
  assert.deepEqual(ignitionClues(deployed, null, '84532'), []);
  assert.deepEqual(ignitionClues(deployed, null, 'abc'), []);
  assert.deepEqual(ignitionClues('not json', null, '8453'), []);
  assert.deepEqual(ignitionClues('[]', null, '8453'), []);
  assert.deepEqual(ignitionClues('null', null, '8453'), []);
  assert.equal(ignitionClues(deployed, null, '5042')[0]?.chain, 'arc');
});

let n = 0;
/** A signed-in person whose repo is proven by the App, with the given files. */
async function person(files: Record<string, string>) {
  const run = String(process.pid % 100000);
  const handle = `ign${run}${++n}`;
  const key = `${handle}/chain`;
  const t = `ek_v45_${run}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false);
  const own = (await connectInstallation(t))!.own;
  assert.ok((await attachToX(own, { id: `96${run}${n}`, username: handle.slice(0, 15), name: handle, avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: false }, 'find', { identity: { project: { name: 'chain', repo: `https://github.com/${key}` } } });
  const gh = fakeGitHub({ [key]: { id: Number(`7${run}${n}`), owner: handle, installation: 500 + n, pulls: [], commits: [], created: '2025-01-01T00:00:00Z', files } });
  const proof = await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  assert.equal((proof as { ok?: boolean }).ok, true, JSON.stringify(proof));
  return { id: c.id, gh };
}
const reader = (gh: ReturnType<typeof fakeGitHub>, onchain: { deployer: string | null; created_at: string | null }): ReaderDeps => {
  const no = async (): Promise<never> => { throw new Error('unexpected read'); };
  return { gh: (async () => ({})) as ReaderDeps["gh"], ghGraphql: no, probe: no, fetchText: no, json: no, walletCreations: async () => [], contractOrigin: async () => onchain, ghFetch: gh, now: new Date() };
};
const contracts = async (id: number) => (await sql()<{ ref: string; state: string; proof: string | null; reject_reason: string | null }[]>`
  SELECT ref, state, proof, reject_reason FROM builder_sources WHERE builder_id = ${id} AND kind = 'contract'`);

test('1.3 an ignition deploy file with a matching onchain deployer is a verified repo_link', dbTest, async () => {
  const [contract, deployer] = [addr(), addr()];
  const p = await person({
    'ignition/deployments/chain-8453/deployed_addresses.json': JSON.stringify({ 'Counter#Counter': contract }),
    'ignition/deployments/chain-8453/journal.jsonl': JSON.stringify({ type: 'DEPLOYMENT_EXECUTION_STATE_INITIALIZE', futureId: 'Counter#Counter', from: deployer }) + '\n',
  });
  await discoverPerson(p.id, { deadline: Date.now() + 10_000, reader: reader(p.gh, { deployer, created_at: '2025-06-01T00:00:00Z' }) });
  assert.deepEqual((await contracts(p.id)).map((r) => ({ ...r })), [{ ref: `base:${contract}`, state: 'verified', proof: 'repo_link', reject_reason: null }]);
});

test('1.4 a file naming a contract whose onchain deployer differs is rejected; no journal means no deployer, also rejected', dbTest, async () => {
  const [contract, deployer, other, bare] = [addr(), addr(), addr(), addr()];
  const p = await person({
    'ignition/deployments/chain-8453/deployed_addresses.json': JSON.stringify({ 'A#A': contract, 'B#B': bare }),
    'ignition/deployments/chain-8453/journal.jsonl': JSON.stringify({ type: 'DEPLOYMENT_EXECUTION_STATE_INITIALIZE', futureId: 'A#A', from: deployer }) + '\n',
  });
  await discoverPerson(p.id, { deadline: Date.now() + 10_000, reader: reader(p.gh, { deployer: other, created_at: '2025-06-01T00:00:00Z' }) });
  const rows = await contracts(p.id);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.state === 'rejected' && r.proof === null), JSON.stringify(rows));
});

// ---------------------------------------------------------------------------------------------- Task 2: the daily revenue read

/**
 * v4.5 Task 2: what outside wallets paid into a builder's own counted Base contracts in the last 30 days (ETH and
 * USDC), never a proven wallet, a deployer or a wallet they funded; a contract that forwards what it gets
 * (pass-through) stores usd 0; a failed read stores nothing. Every outside read is a fake.
 */
const NOW = new Date('2026-10-29T12:00:00Z');
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
const ETH = 10n ** 18n;
const hexOf = (n: bigint) => `0x${n.toString(16)}`;
const PRICE = 2000;
const price = async () => PRICE;
let rn = 0;

/** A Bench-confirmed builder with `wallets` proven wallets. */
async function builder(o: { wallets?: number; confirmed?: boolean } = {}): Promise<{ id: number; key: string; wallets: string[] }> {
  rn++;
  const key = `rv${process.pid}o${rn}/app${rn}`;
  const id = await findPerson({ projects: [{ key, name: `Rev ${rn}`, confirmed: o.confirmed ?? true }], main: key });
  const wallets = Array.from({ length: o.wallets ?? 1 }, addr);
  for (const w of wallets) await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${w}, ${id})`;
  return { id, key, wallets };
}
/** A counted contract a proven wallet created on `chain`, `daysAgo` old. */
async function made(wallet: string, chain = 'base', daysAgo = 100): Promise<string> {
  const a = addr();
  await sql()`INSERT INTO wallet_contracts (chain, address, wallet, created_at, counts) VALUES (${chain}, ${a}, ${wallet}, ${iso(daysAgo * DAY)}, true)`;
  return a;
}
/** A contract source on `chain` deployed by `deployer` (state verified unless said). */
async function source(b: { id: number; key: string }, a: string, deployer: string, state = 'verified', chain = 'base') {
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at, deployer)
    VALUES (${b.id}, 'contract', ${`${chain}:${a}`}, ${b.key}, 'deployer', ${state}, 'server', now(), ${deployer})`;
}

/** [peer, msAgo, raw amount] newest first. */
type F = [string, number, bigint];
/**
 * A fake Alchemy on Base: `flows["in:eth:<address>"]` (or out, usdc) the value transfers, newest first, in pages of
 * `pageSize`; `funded[wallet]` who a wallet sent ETH to; `tokens` answer decimals() and totalSupply(); `fail` an
 * address whose flow reads fail; `off` answers not enabled. Records every call.
 */
function alchemy(o: { flows?: Record<string, F[]>; funded?: Record<string, string[]>; tokens?: string[]; fail?: string; off?: boolean; pageSize?: number }) {
  const calls: { network: string; method: string; q: Record<string, unknown> }[] = [];
  const word = `0x${'0'.repeat(63)}1`;
  const size = o.pageSize ?? 1000;
  const callFor = (network: string) => (async (method: string, params: unknown[]) => {
    const q = (params[0] ?? {}) as Record<string, unknown>;
    calls.push({ network, method, q });
    if (o.off) throw new AlchemyNetworkOff(network);
    if (method === 'eth_call') {
      if (o.tokens?.includes(String(q.to))) return word;
      throw new Error('execution reverted');
    }
    const cats = q.category as string[];
    if (cats.length === 1 && cats[0] === 'external') return { transfers: (o.funded?.[String(q.fromAddress)] ?? []).map((to) => ({ from: q.fromAddress, to })) };
    const dir = q.toAddress ? 'in' : 'out';
    const at = String(q.toAddress ?? q.fromAddress);
    if (o.fail === at) throw new Error('Alchemy alchemy_getAssetTransfers returned 500');
    const kind = cats.includes('erc20') ? 'usdc' : 'eth';
    const all = o.flows?.[`${dir}:${kind}:${at}`] ?? [];
    const start = q.pageKey ? Number(q.pageKey) : 0;
    const page = all.slice(start, start + size).map(([peer, ago, raw]) => ({
      from: dir === 'in' ? peer : at,
      to: dir === 'in' ? at : peer,
      value: 999_999, // the float is never used
      metadata: { blockTimestamp: iso(ago) },
      rawContract: { value: hexOf(raw), address: kind === 'usdc' ? BASE_USDC : null },
    }));
    return { transfers: page, ...(start + size < all.length && { pageKey: String(start + size) }) };
  }) as AlchemyCall;
  return { callFor, calls, call: callFor('base-mainnet') };
}
const rows = async (id: number) => [...await sql()<{ day: string; usd: number; inbound_usd: number; outbound_usd: number; capped: boolean; contracts: number }[]>`
  SELECT day::text, usd::float8 AS usd, inbound_usd::float8 AS inbound_usd, outbound_usd::float8 AS outbound_usd, capped, contracts FROM app_revenue WHERE builder_id = ${id} ORDER BY day`];

// ---------------------------------------------------------------------------------------------- the reads

test('contractFlows: in and out, ETH (external and internal, no zero values) and Base USDC; exact raw amounts, never the float; the 30-day cut; capped', async () => {
  const C = addr();
  const [p, q] = [addr(), addr()];
  const fake = alchemy({ flows: { [`in:eth:${C}`]: [[p, DAY, ETH], [q, 2 * DAY, 3n], [p, 31 * DAY, ETH]], [`out:usdc:${C}`]: [[q, DAY, 5_000_000n]] }, pageSize: 2 });
  const since = NOW.getTime() - 30 * DAY;
  assert.deepEqual(await contractFlows(C, fake.call, since, USED_PAGES, 'in', 'eth'), { flows: [{ peer: p, at: NOW.getTime() - DAY, raw: ETH }, { peer: q, at: NOW.getTime() - 2 * DAY, raw: 3n }], capped: false });
  assert.deepEqual(fake.calls[0].q, { category: ['external', 'internal'], excludeZeroValue: true, withMetadata: true, toAddress: C, order: 'desc', maxCount: '0x3e8' });
  assert.deepEqual(await contractFlows(C, fake.call, since, USED_PAGES, 'out', 'usdc'), { flows: [{ peer: q, at: NOW.getTime() - DAY, raw: 5_000_000n }], capped: false });
  assert.deepEqual(fake.calls.at(-1)!.q, { category: ['erc20'], excludeZeroValue: false, withMetadata: true, fromAddress: C, contractAddresses: [BASE_USDC], order: 'desc', maxCount: '0x3e8' });
  const busy = alchemy({ flows: { [`in:eth:${C}`]: Array.from({ length: 5 }, () => [addr(), DAY, ETH] as F) }, pageSize: 2 });
  const r = await contractFlows(C, busy.call, since, 2, 'in', 'eth');
  assert.equal(r.flows.length, 4);
  assert.equal(r.capped, true, 'the last page allowed still had more');
  // A transfer with no parseable raw value is skipped.
  const bad = (async () => ({ transfers: [
    { from: p, to: C, value: 1, metadata: { blockTimestamp: iso(DAY) }, rawContract: { value: null } },
    { from: p, to: C, value: 1, metadata: { blockTimestamp: iso(DAY) }, rawContract: { value: '1.5' } },
    { from: p, to: C, value: 1, metadata: { blockTimestamp: iso(DAY) } },
    { from: p, to: C, metadata: { blockTimestamp: iso(DAY) }, rawContract: { value: '0x10' } },
  ] })) as AlchemyCall;
  assert.deepEqual((await contractFlows(C, bad, since, 1, 'in', 'eth')).flows, [{ peer: p, at: NOW.getTime() - DAY, raw: 16n }]);
  // An erc20 transfer of another token is never money, even if the filter let it through.
  const other = (async () => ({ transfers: [
    { from: p, to: C, metadata: { blockTimestamp: iso(DAY) }, rawContract: { value: '0x64', address: addr() } },
    { from: q, to: C, metadata: { blockTimestamp: iso(DAY) }, rawContract: { value: '0x65', address: BASE_USDC.toUpperCase().replace('0X', '0x') } },
  ] })) as AlchemyCall;
  assert.deepEqual((await contractFlows(C, other, since, 1, 'in', 'usdc')).flows, [{ peer: q, at: NOW.getTime() - DAY, raw: 101n }]);
});

test('contractsRevenue: ETH and USDC from outside wallets summed at the price; the builder\'s own wallets, the deployer and wallets they funded never pay (Review Focus 3); outbound to them is not pass-through', dbTest, async () => {
  const b = await builder({ wallets: 2 });
  const [w1, w2] = b.wallets;
  const C = await made(w1, 'base', 10);
  const deployer = addr();
  const S = addr();
  await source(b, S, deployer);
  const [p1, p2, p3] = [addr(), addr(), addr()];
  const funded = addr();
  const fake = alchemy({
    flows: {
      // 1 ETH external + 0.5 ETH internal from outsiders ($3,000), one older than 30 days, and the excluded ones.
      [`in:eth:${C}`]: [[p1, DAY, ETH], [p2, 2 * DAY, ETH / 2n], [w1, 3 * DAY, 10n * ETH], [funded, 4 * DAY, 5n * ETH], [p3, 31 * DAY, ETH]],
      // 250 USDC from an outsider; 1,000 from the deployer never counts.
      [`in:usdc:${S}`]: [[p3, DAY, 250_000_000n], [deployer, DAY, 1_000_000_000n], [w2, DAY, 7_000_000n]],
      // The builder taking money out to their own wallet and the deployer: not pass-through.
      [`out:eth:${C}`]: [[w2, DAY, ETH], [deployer, DAY, ETH / 2n]],
      // 100 USDC out to an outsider is outbound.
      [`out:usdc:${S}`]: [[p1, DAY, 100_000_000n]],
    },
    funded: { [w2]: [funded] },
  });
  const r = await contractsRevenue(b.id, NOW, fake.call, { price });
  assert.deepEqual(r, { usd: 3250, inbound_usd: 3250, outbound_usd: 100, capped: false, contracts: 2 });
  for (const c of [C, S]) for (const k of ['toAddress', 'fromAddress'])
    assert.ok(fake.calls.some((x) => x.q[k] === c && (x.q.category as string[]).includes('erc20')) && fake.calls.some((x) => x.q[k] === c && (x.q.category as string[]).includes('internal')), 'four reads per contract');
  assert.ok(fake.calls.every((c) => c.network === 'base-mainnet'), 'Base only');
});

test('contractsRevenue: a contract that only receives from the builder\'s own wallet is no revenue', dbTest, async () => {
  const b = await builder();
  const C = await made(b.wallets[0]);
  const fake = alchemy({ flows: { [`in:eth:${C}`]: [[b.wallets[0], DAY, 50n * ETH]], [`in:usdc:${C}`]: [[b.wallets[0], DAY, 9_000_000_000n]] } });
  assert.deepEqual(await contractsRevenue(b.id, NOW, fake.call, { price }), { usd: 0, inbound_usd: 0, outbound_usd: 0, capped: false, contracts: 1 });
  await runRevenue(NOW, { deadline: Date.now() + 5000, only: [b.id], callFor: fake.callFor, price });
  assert.ok((await rows(b.id)).every((x) => x.usd === 0));
  assert.equal(await latestRevenue(b.id, NOW), null);
});

test('contractsRevenue: pass-through (outbound to outside addresses at least half of inbound) stores usd 0 with the row (Review Focus 2)', dbTest, async () => {
  const b = await builder();
  const C = await made(b.wallets[0]);
  const [p, q] = [addr(), addr()];
  const router = alchemy({ flows: { [`in:usdc:${C}`]: [[p, DAY, 1_000_000_000n]], [`out:usdc:${C}`]: [[q, DAY, 400_000_000n]], [`out:eth:${C}`]: [[q, DAY, ETH / 20n]] } });
  // $1,000 in, $400 + $100 out: exactly half is pass-through.
  assert.deepEqual(await contractsRevenue(b.id, NOW, router.call, { price }), { usd: 0, inbound_usd: 1000, outbound_usd: 500, capped: false, contracts: 1 });
  const kept = alchemy({ flows: { [`in:usdc:${C}`]: [[p, DAY, 1_000_000_000n]], [`out:usdc:${C}`]: [[q, DAY, 499_000_000n]] } });
  assert.equal((await contractsRevenue(b.id, NOW, kept.call, { price }))!.usd, 1000, 'under half keeps it');
  await runRevenue(NOW, { deadline: Date.now() + 5000, only: [b.id], callFor: router.callFor, price });
  assert.deepEqual((await rows(b.id)).map((x) => [x.usd, x.inbound_usd, x.outbound_usd]), [[0, 1000, 500]]);
  assert.equal(await latestRevenue(b.id, NOW), null, 'drafts skip it');
});

test('contractsRevenue: pass-through is judged per contract; a router never adds its inbound, nor hides a revenue contract\'s', dbTest, async () => {
  const b = await builder();
  const shop = await made(b.wallets[0], 'base', 10);
  const router = await made(b.wallets[0], 'base', 20);
  const [p, q, r] = [addr(), addr(), addr()];
  // A big router (forwards ~100%) next to a $300 revenue contract: usd is the shop's $300 only.
  const big = alchemy({ flows: {
    [`in:usdc:${shop}`]: [[p, DAY, 300_000_000n]],
    [`in:usdc:${router}`]: [[q, DAY, 10_000_000_000n]],
    [`out:usdc:${router}`]: [[r, DAY, 9_990_000_000n]],
  } });
  assert.deepEqual(await contractsRevenue(b.id, NOW, big.call, { price }), { usd: 300, inbound_usd: 10_300, outbound_usd: 9_990, capped: false, contracts: 2 });
  // A small router next to a big revenue contract: the router's $100 is not added.
  const small = alchemy({ flows: {
    [`in:usdc:${shop}`]: [[p, DAY, 10_000_000_000n]],
    [`in:eth:${router}`]: [[q, DAY, ETH / 20n]],
    [`out:eth:${router}`]: [[r, DAY, ETH / 20n]],
  } });
  assert.deepEqual(await contractsRevenue(b.id, NOW, small.call, { price }), { usd: 10_000, inbound_usd: 10_100, outbound_usd: 100, capped: false, contracts: 2 });
  // Both pass through: usd 0.
  const both = alchemy({ flows: {
    [`in:usdc:${shop}`]: [[p, DAY, 1_000_000_000n]], [`out:usdc:${shop}`]: [[r, DAY, 600_000_000n]],
    [`in:usdc:${router}`]: [[q, DAY, 1_000_000_000n]], [`out:usdc:${router}`]: [[r, DAY, 1_000_000_000n]],
  } });
  assert.equal((await contractsRevenue(b.id, NOW, both.call, { price }))!.usd, 0);
});

test('contractsRevenue: token contracts and contracts the builder has not proven are never read; no counted Base contract is null', dbTest, async () => {
  const b = await builder();
  const coin = addr();
  const named = addr();
  const arb = await made(b.wallets[0], 'arbitrum');
  await source(b, coin, addr());
  await source(b, named, addr(), 'proposed'); // e.g. a famous router named in a README
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status, coin_address) VALUES (${b.id}, ${`rv${process.pid}x${rn}`}, 'existing', ${addr()})`;
  const [tokenAddr] = await sql()<{ coin_address: string }[]>`SELECT coin_address FROM builder_tokens WHERE builder_id = ${b.id}`;
  const fake = alchemy({ tokens: [coin], flows: { [`in:eth:${coin}`]: [[addr(), DAY, ETH]] } });
  assert.equal(await contractsRevenue(b.id, NOW, fake.call, { price }), null);
  const read = fake.calls.filter((c) => c.method === 'alchemy_getAssetTransfers').map((c) => c.q.toAddress ?? c.q.fromAddress);
  for (const a of [coin, named, arb, tokenAddr.coin_address]) assert.ok(!read.includes(a), 'never read for revenue');
  assert.equal(await contractsRevenue((await builder()).id, NOW, fake.call, { price }), null, 'no contract: null');
});

test('contractsRevenue: capped when a page limit was hit; at most USED_CONTRACTS (the newest)', dbTest, async () => {
  const b = await builder();
  const all: string[] = [];
  for (let i = 0; i < USED_CONTRACTS + 2; i++) all.push(await made(b.wallets[0], 'base', i + 1));
  const flows: Record<string, F[]> = { [`in:usdc:${all[0]}`]: Array.from({ length: USED_PAGES + 2 }, () => [addr(), DAY, 1_000_000n] as F) };
  const fake = alchemy({ flows, pageSize: 1 });
  const r = (await contractsRevenue(b.id, NOW, fake.call, { price }))!;
  assert.equal(r.capped, true);
  assert.equal(r.inbound_usd, USED_PAGES, 'a capped read counts what it saw');
  assert.equal(r.contracts, USED_CONTRACTS);
  const read = new Set(fake.calls.filter((c) => c.method === 'alchemy_getAssetTransfers' && (c.q.category as string[]).length === 2).map((c) => c.q.toAddress ?? c.q.fromAddress));
  assert.ok(!read.has(all.at(-1)) && !read.has(all.at(-2)), 'the two oldest are not read');
  await runRevenue(NOW, { deadline: Date.now() + 5000, only: [b.id], callFor: fake.callFor, price });
  assert.deepEqual(await latestRevenue(b.id, NOW), { usd: USED_PAGES, capped: true });
});

test('a failed read stores nothing, no zero row (Review Focus 4); an unknown price or Base not enabled stores nothing', dbTest, async () => {
  const b = await builder();
  const C = await made(b.wallets[0]);
  const D = await made(b.wallets[0], 'base', 5);
  const good = { [`in:usdc:${C}`]: [[addr(), DAY, 500_000_000n]] as F[] };
  const failing = alchemy({ flows: good, fail: D });
  await assert.rejects(contractsRevenue(b.id, NOW, failing.call, { price }), /returned 500/);
  const errors: unknown[] = [];
  const log = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    assert.deepEqual(await runRevenue(NOW, { deadline: Date.now() + 5000, only: [b.id], callFor: failing.callFor, price }), { due: 1, stored: 0 });
  } finally {
    console.error = log;
  }
  assert.ok(errors.length >= 1, 'logged');
  assert.deepEqual(await rows(b.id), []);
  // An unknown price: nothing, no builder claimed, so the next run the same day reads.
  const fine = alchemy({ flows: good });
  const day2 = new Date(NOW.getTime() + DAY);
  assert.equal(await contractsRevenue(b.id, day2, fine.call, { price: async () => null }), null);
  assert.deepEqual(await runRevenue(day2, { deadline: Date.now() + 5000, only: [b.id], callFor: fine.callFor, price: async () => null }), { due: 1, stored: 0 });
  assert.equal(fine.calls.length, 0, 'nothing read without a price');
  assert.deepEqual(await rows(b.id), []);
  assert.deepEqual(await runRevenue(new Date(day2.getTime() + 3_600_000), { deadline: Date.now() + 5000, only: [b.id], callFor: fine.callFor, price }), { due: 1, stored: 1 });
  assert.deepEqual((await rows(b.id)).map((x) => [x.day, x.usd]), [['2026-10-30', 500]]);
  await sql()`DELETE FROM app_revenue WHERE builder_id = ${b.id}`;
  // Base not enabled: nothing.
  const off = alchemy({ off: true });
  assert.equal(await contractsRevenue(b.id, NOW, off.call, { price }), null);
  assert.deepEqual(await rows(b.id), []);
});

// ---------------------------------------------------------------------------------------------- the run

test('runRevenue: off without Alchemy; each due builder (a counted Base contract) once a UTC day; the cron runs it after used by', dbTest, async () => {
  const b = await builder();
  const C = await made(b.wallets[0]);
  const arbOnly = await builder();
  await made(arbOnly.wallets[0], 'arbitrum');
  const unconfirmed = await builder({ confirmed: false });
  await made(unconfirmed.wallets[0]);
  const only = [b.id, arbOnly.id, unconfirmed.id];
  assert.deepEqual(await revenueDue(NOW, { only }), [b.id]);
  assert.deepEqual(await runRevenue(NOW, { deadline: Date.now() + 5000, only, price }), { step: 'off' });
  const fake = alchemy({ flows: { [`in:usdc:${C}`]: [[addr(), DAY, 1_240_000_000n]] } });
  assert.deepEqual(await runRevenue(NOW, { deadline: Date.now() + 5000, only, callFor: fake.callFor, price }), { due: 1, stored: 1 });
  const reads = fake.calls.length;
  assert.deepEqual(await rows(b.id), [{ day: '2026-10-29', usd: 1240, inbound_usd: 1240, outbound_usd: 0, capped: false, contracts: 1 }]);
  assert.deepEqual(await runRevenue(new Date(NOW.getTime() + 3_600_000), { deadline: Date.now() + 5000, only, callFor: fake.callFor, price }), { due: 0, stored: 0 });
  assert.equal(fake.calls.length, reads, 'nothing read again the same day');
  assert.deepEqual(await latestRevenue(b.id, NOW), { usd: 1240, capped: false });
  // The cron's step (scoped by `only`), the next day.
  const r = await runCron({ now: new Date(NOW.getTime() + DAY), only: ['none'], deps: { revenue: { callFor: fake.callFor, only, price } } });
  assert.deepEqual(r.revenue, { due: 1, stored: 1 });
  assert.deepEqual((await rows(b.id)).map((x) => x.day), ['2026-10-29', '2026-10-30']);
});

test('latestRevenue: the newest row no older than USED_STALE_DAYS with usd above 0, else null', dbTest, async () => {
  const b = await builder();
  const put = (day: string, usd: number) => sql()`INSERT INTO app_revenue (builder_id, day, usd, inbound_usd, outbound_usd, capped, contracts) VALUES (${b.id}, ${day}, ${usd}, ${usd}, 0, false, 1)`;
  await put('2026-10-20', 900);
  assert.equal(await latestRevenue(b.id, NOW), null, 'stale');
  await put('2026-10-27', 300);
  assert.deepEqual(await latestRevenue(b.id, NOW), { usd: 300, capped: false });
  await put('2026-10-28', 0);
  assert.equal(await latestRevenue(b.id, NOW), null, 'the newest is pass-through: no fallback to an older row');
});

// ---------------------------------------------------------------------------------------------- Task 3: drafts and replies

const BLOCK = { score: null, rank: null, why: null, streak: 3, live: 'https://kit.app/', page: 'earnkit.com/lee', usedBy: null, revenue: null } as const;
const USED = (users: number) => `Used by ${users} people in the last 30 days, verified onchain`;
const PAID = (usd: string) => `${usd} paid into its contracts by outside wallets in the last 30 days, verified onchain`;

test('3.1 shipLogBlock: the traction lines after the streak and before Live, by rule', () => {
  const lines = (o: Partial<ShipLogFacts>) => shipLogBlock({ ...BLOCK, ...o });
  const around = (...mid: string[]) => ['From your ship log:', '3 weeks in a row', ...mid, 'Live: https://kit.app/', 'Page: earnkit.com/lee'];
  assert.deepEqual(lines({}), around());
  // Usage only (returning under 2).
  assert.deepEqual(lines({ usedBy: { users: 240, returning: 1, capped: false } }), around(USED(240)));
  // Usage plus returning.
  assert.deepEqual(lines({ usedBy: { users: 240, returning: 60, capped: false } }), around(USED(240), '60 came back in a second week'));
  // Usage plus revenue; whole dollars, en-US grouping.
  assert.deepEqual(lines({ usedBy: { users: 1500, returning: 0, capped: false }, revenue: { usd: 1240.99, capped: false } }), around(USED(1500).replace('1500', '1,500'), PAID('$1,240')));
  // Capped values.
  assert.deepEqual(lines({ usedBy: { users: 1000, returning: 2, capped: true }, revenue: { usd: 12_345, capped: true } }), around('Used by 1,000+ people in the last 30 days, verified onchain', '2 came back in a second week', PAID('$12,345+')));
  // Revenue without usage shows; the returning line never without the usage line.
  assert.deepEqual(lines({ revenue: { usd: 100, capped: false } }), around(PAID('$100')));
  // Under thresholds: none.
  assert.deepEqual(lines({ usedBy: { users: 9, returning: 9, capped: false }, revenue: { usd: 99.99, capped: false } }), around());
  for (const l of lines({ usedBy: { users: 240, returning: 60, capped: true }, revenue: { usd: 5000, capped: true } }))
    assert.doesNotMatch(l, /—|\?|coin|points|[\u{1F300}-\u{1FAFF}]/u, l);
  assert.match(SHIP_LOG_NOTE, / Use the verified onchain numbers in traction answers as given\.$/);
});

/** A claimed person (find.ts person) with today's (or `day`'s) app_usage rows and app_revenue row. */
async function traced(o: { usage?: [source: 'contracts' | 'builder_code', users: number, returning: number, capped?: boolean][]; usd?: number; capped?: boolean; day?: string; hidden?: boolean } = {}) {
  rn++;
  const key = `tr${process.pid}o${rn}/kit${rn}`;
  const handle = `tr${process.pid % 10000}x${rn}`;
  const id = await findPerson({ projects: [{ key, name: `Kit ${rn}`, confirmed: true }], main: key, claimed: handle });
  if (o.hidden) await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${id}`;
  const day = o.day ?? new Date().toISOString().slice(0, 10);
  for (const [source, users, returning, capped] of o.usage ?? [])
    await sql()`INSERT INTO app_usage (builder_id, source, day, users, "returning", capped, href, chains)
      VALUES (${id}, ${source}, ${day}, ${users}, ${returning}, ${capped ?? false}, null, ${['base']}::text[])`;
  if (o.usd !== undefined)
    await sql()`INSERT INTO app_revenue (builder_id, day, usd, inbound_usd, outbound_usd, capped, contracts) VALUES (${id}, ${day}, ${o.usd}, ${o.usd}, 0, ${o.capped ?? false}, 1)`;
  return { id, key, handle };
}

test('3.2 shipLogFacts and replyFacts: the larger fresh source (never summed), revenue from $100; stale or under thresholds none', dbTest, async () => {
  const now = new Date();
  const b = await traced({ usage: [['contracts', 240, 60], ['builder_code', 300, 0]], usd: 1240.75 });
  const f = (await shipLogFacts(b.id, now))!;
  assert.deepEqual([f.usedBy, f.revenue], [{ users: 300, returning: 0, capped: false }, { usd: 1240, capped: false }]);
  assert.ok(shipLogBlock(f).includes(USED(300)) && shipLogBlock(f).includes(PAID('$1,240')));
  const r = await replyFacts({ installationId: b.id, sharedClient: false }, now);
  assert.deepEqual([r.used_by_30d, r.revenue_30d_usd], [300, 1240]);
  // A tie keeps contracts (and its returning).
  const tie = await traced({ usage: [['builder_code', 50, 0], ['contracts', 50, 7, true]] });
  assert.deepEqual((await shipLogFacts(tie.id, now))!.usedBy, { users: 50, returning: 7, capped: true });
  // Stale (older than USED_STALE_DAYS): none, in both.
  const stale = await traced({ usage: [['contracts', 240, 60]], usd: 5000, day: new Date(now.getTime() - (USED_STALE_DAYS + 1) * DAY).toISOString().slice(0, 10) });
  assert.deepEqual([(await shipLogFacts(stale.id, now))!.usedBy, (await shipLogFacts(stale.id, now))!.revenue], [null, null]);
  const rs = await replyFacts({ installationId: stale.id, sharedClient: false }, now);
  assert.ok(!('used_by_30d' in rs) && !('revenue_30d_usd' in rs));
  // Under thresholds: none.
  const under = await traced({ usage: [['contracts', USED_MIN - 1, 5]], usd: 99.99 });
  const fu = (await shipLogFacts(under.id, now))!;
  assert.deepEqual([fu.usedBy, fu.revenue], [null, null]);
  assert.deepEqual(shipLogBlock(fu).filter((l) => /verified onchain|came back/.test(l)), []);
  const ru = await replyFacts({ installationId: under.id, sharedClient: false }, now);
  assert.ok(!('used_by_30d' in ru) && !('revenue_30d_usd' in ru));
  // Pass-through (usd 0): none.
  assert.equal((await shipLogFacts((await traced({ usd: 0 })).id, now))!.revenue, null);
});

test('3.3 a drafted application (prepare) carries the lines, a hidden page\'s too (Review Focus 5)', dbTest, async () => {
  const base = committedProgram('base-builder-grants');
  const pid = `v45-tr-${process.pid}-draft`;
  await upsertProgram(ProgramFile.parse({ ...base, id: pid, title: `Traction ${process.pid}`, ends_at: new Date(Date.now() + 20 * DAY).toISOString(), status: 'active' }));
  try {
    const reqs = base.submission_requirements as { key: string; type: string; options?: string[] }[];
    const answers = Object.fromEntries(reqs.map((r) => [r.key, r.type === 'url' ? 'https://kit.app/demo' : r.type === 'email' ? 'lee@kit.app' : r.options ? r.options[0] : 'Kit lets fans tip creators on Base.']));
    for (const hidden of [false, true]) {
      const b = await traced({ usage: [['contracts', 240, 60]], usd: 1240, hidden });
      const ctx = { installationId: b.id, ownInstallationId: b.id, sharedClient: false };
      const project = { name: 'Kit', repo_url: `https://github.com/${b.key}`, live_url: 'https://kit.app' };
      // The first call hands the agent ship_log to draft from; the drafted one keeps it (the form is the shown draft).
      for (const args of [{ program_id: pid, project }, { program_id: pid, project, answers, coach_asked: true }]) {
        const prep = await mcpCall(ctx, 'prepare', args);
        const log = prep.reply?.ship_log as ShipLogFacts;
        assert.deepEqual([log?.usedBy, log?.revenue], [{ users: 240, returning: 60, capped: false }, { usd: 1240, capped: false }], `${hidden ? 'hidden' : 'public'}: ${prep.text}`);
        const block = shipLogBlock(log);
        for (const l of [USED(240), '60 came back in a second week', PAID('$1,240')]) assert.ok(block.includes(l), l);
        assert.ok(!String(prep.reply?.show_to_builder ?? '').includes('paid into'), 'never shown on the form link');
      }
      const r = await replyFacts({ installationId: b.id, sharedClient: false });
      assert.deepEqual([r.used_by_30d, r.revenue_30d_usd], [240, 1240], hidden ? 'hidden' : 'public');
    }
  } finally {
    await sql()`DELETE FROM programs WHERE id = ${pid}`.catch(() => sql()`UPDATE programs SET status = 'closed' WHERE id = ${pid}`);
  }
});

test('3.4 privacy: builder.json, the page data, /api/stats and the feed never carry revenue (serialized)', dbTest, async () => {
  const now = new Date();
  const b = await traced({ usage: [['contracts', 240, 60]], usd: 5000 });
  // The private documents have it (a control: the seeded row is read).
  assert.equal((await replyFacts({ installationId: b.id, sharedClient: false }, now)).revenue_30d_usd, 5000);
  const d = (await profileData(b.id, now))!;
  const outputs: Record<string, unknown> = {
    builderJson: await builderJson(b.handle, now),
    profileData: d,
    profileSite: await profileSite(b.id, d, now, { only: [b.id] }),
    highlights: await highlights(b.id, d, now),
    stats: await readStats(now),
    feed: await feedWeeks(now, { only: [b.id] }),
  };
  assert.ok(outputs.builderJson, 'the page is public');
  assert.ok(JSON.stringify(outputs.highlights).includes('Used by 240 people'), 'usage is public (as before)');
  for (const [name, out] of Object.entries(outputs)) {
    const s = JSON.stringify(out);
    assert.ok(!s.includes('5,000') && !s.includes('5000'), `${name} carries the dollars`);
    assert.doesNotMatch(s, /revenue|paid into its contracts/i, name);
  }
});

// ---------------------------------------------------------------------------------------------- Task 2 fix round 2

test('contractsRevenue: money a pass-through contract sends out beyond its own inbound offsets the others (the wash through an own contract)', dbTest, async () => {
  const b = await builder();
  const A = await made(b.wallets[0], 'base', 10);
  const B = await made(b.wallets[0], 'base', 20);
  const [p, q] = [addr(), addr()];
  // (a) $1,000 in to A, A moves it all to own B, B pays it out: a wash.
  const wash = alchemy({ flows: {
    [`in:usdc:${A}`]: [[p, DAY, 1_000_000_000n]], [`out:usdc:${A}`]: [[B, DAY, 1_000_000_000n]],
    [`in:usdc:${B}`]: [[A, DAY, 1_000_000_000n]], [`out:usdc:${B}`]: [[q, DAY, 1_000_000_000n]],
  } });
  assert.deepEqual(await contractsRevenue(b.id, NOW, wash.call, { price }), { usd: 0, inbound_usd: 1000, outbound_usd: 1000, capped: false, contracts: 2 });
  // (b) $1,000 in to A, $400 moved to B and paid out: $600 stays.
  const part = alchemy({ flows: {
    [`in:usdc:${A}`]: [[p, DAY, 1_000_000_000n]], [`out:usdc:${A}`]: [[B, DAY, 400_000_000n]],
    [`in:usdc:${B}`]: [[A, DAY, 400_000_000n]], [`out:usdc:${B}`]: [[q, DAY, 400_000_000n]],
  } });
  assert.deepEqual(await contractsRevenue(b.id, NOW, part.call, { price }), { usd: 600, inbound_usd: 1000, outbound_usd: 400, capped: false, contracts: 2 });
  // (d) A revenue contract withdrawing to the builder's proven wallet is unchanged.
  const withdraw = alchemy({ flows: { [`in:usdc:${A}`]: [[p, DAY, 1_000_000_000n]], [`out:usdc:${A}`]: [[b.wallets[0], DAY, 1_000_000_000n]] } });
  assert.deepEqual(await contractsRevenue(b.id, NOW, withdraw.call, { price }), { usd: 1000, inbound_usd: 1000, outbound_usd: 0, capped: false, contracts: 2 });
});
