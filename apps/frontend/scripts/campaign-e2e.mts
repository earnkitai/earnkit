import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import {
  concatHex,
  createWalletClient,
  encodeFunctionData,
  http,
  parseUnits,
  publicActions,
  toHex,
  type Abi,
  type Hex,
} from 'viem';
import { mnemonicToAccount, type HDAccount } from 'viem/accounts';
import { base } from 'viem/chains';

/**
 * v2.4 end to end: one EarnKit campaign, nothing manual, from the first list_programs to the paid
 * winners. A local Postgres, anvil with Base's chain id (so the payout path is the production
 * one), a mock MINI, a mock ERC-4337 EntryPoint at the real v0.7 address, and one mock server for
 * Blockscout and raw GitHub:
 *   anvil --port 8561 --chain-id 8453
 *   DATABASE_URL=postgres://postgres@127.0.0.1:55447/postgres?sslmode=disable \
 *   BASE_RPC_URL=http://127.0.0.1:8561 pnpm campaign:e2e
 * Flow:
 *   1. list_programs: the EarnKit campaign first, money first, no emojis.
 *   2. Entry by deployer signature (a wrong signer first: every problem at once, no daily limit used).
 *   3. Two days of scoring through the real POST /api/cron route with CRON_SECRET: EOA users with
 *      history, a smart account (UserOps, EntryPoint getNonce >= 3 at the start block), and a
 *      staged account plus its fanned-out clones that don't count.
 *   4. The freeze; the 48 h review opens in the same call.
 *   5. A veto through the real POST /api/admin/veto route with the campaign's key.
 *   6. The next entry moves up.
 *   7. The automatic payout from the capped payout wallet: it stops when the wallet is short and
 *      resumes once topped up.
 *   8. The winner hears it on the next list_programs ("you won $100 ...").
 *   9. More cron runs send nothing.
 * Time: the cron route reads the clock, so this script runs the app on a shifted clock (Date only;
 * timers stay real). Anvil mines blocks exactly 2 s apart, as Base does, so the app's own
 * time-to-block mapping (baseBlockAt) finds the start block, and every history read (nonce, code,
 * getNonce at the start block) is a real historic-state read on anvil.
 * Resets anvil (anvil_reset) and drops and recreates the database's public schema. Refuses anything but a local Postgres and anvil.
 */
function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
let checks = 0;
function ok(cond: unknown, what: string) {
  if (!cond) fail(what);
  checks++;
  console.log(`ok: ${what}`);
}
const show = (label: string, value: unknown) =>
  console.log(`--- ${label}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n---`);

// ---- guards, before any app module loads ----
let dbHost = '';
try {
  dbHost = new URL(process.env.DATABASE_URL ?? '').hostname;
} catch {
  fail('DATABASE_URL is missing or not a URL.');
}
if (dbHost !== '127.0.0.1' && dbHost !== 'localhost') fail('DATABASE_URL must point at a local Postgres.');
const RPC = (process.env.BASE_RPC_URL ?? '').replace(/\/$/, '');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(RPC)) fail('BASE_RPC_URL must be a local anvil: http://127.0.0.1:<port>.');
async function rpc(method: string, params: unknown[] = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
const version = String(await rpc('web3_clientVersion').catch(() => ''));
if (!/anvil/i.test(version)) fail(`BASE_RPC_URL must be anvil (it says ${JSON.stringify(version)}).`);
if (Number(await rpc('eth_chainId')) !== 8453) fail('Start anvil with --chain-id 8453.');
// A fresh chain each run (wallet histories must start empty), then exactly 2 s per block, like Base.
await rpc('anvil_reset', []);
if (Number(await rpc('eth_blockNumber')) !== 0) fail('anvil_reset did not reset the chain.');
await rpc('anvil_setBlockTimestampInterval', [2]);

// ---- the app's clock: real time plus an offset the script moves (timers stay real) ----
const RealDate = Date;
let offsetMs = 0;
class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offsetMs);
    else super(...(args as [string | number | Date]));
  }
  static now() {
    return RealDate.now() + offsetMs;
  }
}
globalThis.Date = ShiftedDate as DateConstructor;
const setClock = (at: Date) => {
  offsetMs = at.getTime() - RealDate.now();
};

// ---- accounts: anvil's default mnemonic ----
const MNEMONIC = 'test test test test test test test test test test test junk';
const acct = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const lc = (a: HDAccount | string) => (typeof a === 'string' ? a : a.address).toLowerCase() as Hex;
const FUNDER = acct(0);
const DEPLOYER_A = acct(5); // Tip Jar's agent deploys from its own wallet and signs the entry
const PAYOUT_A = acct(6);
const HOT = acct(7); // the campaign payout wallet (CAMPAIGN_PAYOUT_PRIVATE_KEY)
const PAYOUT_B = acct(8);
const PAYOUT_C = acct(9);
const USERS = [10, 11, 12].map(acct); // 3 transactions each before the start
const NEWBIE = acct(13); // 1 transaction before the start: never counts
const BUNDLER = acct(14);
const STRANGER = acct(15);

// ---- env for the app modules (read when they load) ----
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.EARNKIT_AUTH_SECRET ||= 'e2e-auth-secret';
delete process.env.TOKENSFUN_DEPLOY_API_KEY; // no token flow here (pnpm token:e2e covers it)
process.env.CRON_SECRET = 'e2e-cron-secret-'.padEnd(48, 'c');
process.env.ADMIN_VETO_SECRET = 'e2e-veto-secret-'.padEnd(48, 'v');
process.env.CAMPAIGN_PAYOUT_PRIVATE_KEY = toHex(HOT.getHdKey().privateKey!);

// ---- the mock server: Blockscout and raw GitHub ----
type Direct = { from: string; at: Date; hash: Hex; input: Hex };
type Internal = { from: string; at: Date; hash: Hex };
const direct = new Map<string, Direct[]>();
const internal = new Map<string, Internal[]>();
const created = new Map<string, Hex>(); // contract -> creation tx
const senders = new Map<string, string>(); // tx -> sender
const files = new Map<string, string>(); // "owner/repo" -> earnkit.txt
const add = <T,>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
const newestFirst = <T extends { at: Date }>(l: T[]) => [...l].sort((a, b) => b.at.getTime() - a.at.getTime());
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  let m = /^\/api\/v2\/addresses\/(0x[0-9a-f]{40})\/transactions$/.exec(url.pathname);
  if (m)
    return send(200, {
      items: newestFirst(direct.get(m[1]) ?? []).map((t) => ({
        timestamp: t.at.toISOString(), status: 'ok', from: { hash: t.from }, raw_input: t.input, hash: t.hash,
      })),
      next_page_params: null,
    });
  if ((m = /^\/api\/v2\/addresses\/(0x[0-9a-f]{40})\/internal-transactions$/.exec(url.pathname)))
    return send(200, {
      items: newestFirst(internal.get(m[1]) ?? []).map((t) => ({
        timestamp: t.at.toISOString(), success: true, type: 'call', from: { hash: t.from }, transaction_hash: t.hash,
      })),
      next_page_params: null,
    });
  if ((m = /^\/api\/v2\/addresses\/(0x[0-9a-f]{40})$/.exec(url.pathname)))
    return send(200, { creation_transaction_hash: created.get(m[1]) ?? null });
  if ((m = /^\/api\/v2\/transactions\/(0x[0-9a-f]{64})$/.exec(url.pathname)))
    return senders.has(m[1]) ? send(200, { from: { hash: senders.get(m[1]) } }) : send(404, { message: 'Not found' });
  if ((m = /^\/([^/]+)\/([^/]+)\/HEAD\/earnkit\.txt$/.exec(url.pathname))) {
    const text = files.get(`${m[1]}/${m[2]}`.toLowerCase());
    res.writeHead(text ? 200 : 404, { 'content-type': 'text/plain' });
    return res.end(text ?? '404: Not Found');
  }
  send(404, { error: 'not found' });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.EARNKIT_BLOCKSCOUT_URL = MOCK;
process.env.EARNKIT_OWNERSHIP_BASE_URL = MOCK;

// ---- the app ----
const { sql } = await import('../lib/earnkit/db');
const { upsertProgram } = await import('../lib/earnkit/programs');
const { ProgramFile } = await import('../lib/earnkit/program-file');
const { earnkitTexts } = await import('../lib/earnkit/campaign-text');
const { saveInstallation, touchInstallation } = await import('../lib/earnkit/installations');
const { tools } = await import('../lib/earnkit/tools');
const { vetoKey } = await import('../lib/earnkit/veto');
const { setSanctionsOracle } = await import('../lib/earnkit/sanctions');
const { getCampaignBoard } = await import('../lib/earnkit/leaderboard');
const { ENTRY_POINTS } = await import('../lib/earnkit/campaigns');
const { POST: cronRoute } = await import('../app/api/cron/route');
const { POST: vetoRoute } = await import('../app/api/admin/veto/route');
const { Attribution } = await import('ox/erc8021');
const db = sql();
await db.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await db.unsafe(readFileSync(join(import.meta.dirname, '..', 'db', 'schema.sql'), 'utf8'));
setSanctionsOracle({ chainId: async () => 8453, isSanctioned: async () => false });

// ---- the chain ----
const wc = createWalletClient({ chain: base, transport: http(RPC) }).extend(publicActions);
for (const a of [FUNDER, DEPLOYER_A, PAYOUT_A, PAYOUT_B, PAYOUT_C, ...USERS, NEWBIE, BUNDLER, STRANGER])
  await rpc('anvil_setBalance', [a.address, toHex(10n ** 20n)]);
// The payout wallet is capped: gas money only, and later exactly the prizes.
await rpc('anvil_setBalance', [HOT.address, toHex(10n ** 16n)]);
const ROOT = join(import.meta.dirname, '..', '..', '..');
execFileSync('forge', ['build', '--root', join(ROOT, 'contracts')], { stdio: 'ignore' });
type Name = 'MockToken18' | 'Ping' | 'MockSmartAccount' | 'MockEntryPoint';
const artifact = (name: Name) =>
  JSON.parse(readFileSync(join(ROOT, 'contracts', 'out', 'E2EMocks.sol', `${name}.json`), 'utf8')) as {
    abi: Abi;
    bytecode: { object: Hex };
  };
const ABI = {
  token: artifact('MockToken18').abi,
  ping: artifact('Ping').abi,
  account: artifact('MockSmartAccount').abi,
  entryPoint: artifact('MockEntryPoint').abi,
};
async function mined(hash: Hex) {
  const r = await wc.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') fail(`transaction ${hash} reverted`);
  return r;
}
async function deploy(from: HDAccount, name: Name) {
  const a = artifact(name);
  const hash = await wc.deployContract({ account: from, abi: a.abi, bytecode: a.bytecode.object, chain: base });
  const address = lc((await mined(hash)).contractAddress!);
  created.set(address, hash);
  senders.set(hash, lc(from));
  return address;
}
const send = async (from: HDAccount, to: Hex, data: Hex = '0x') =>
  mined(await wc.sendTransaction({ account: from, to, data, value: 0n, chain: base })).then((r) => r.transactionHash);
const PING = encodeFunctionData({ abi: ABI.ping, functionName: 'ping' });
const EP = ENTRY_POINTS[1] as Hex; // v0.7
/** A UserOp from `account` (nonce key 0), sent by the bundler: the account runs `call` on itself. */
const userOp = (account: Hex, call: Hex) =>
  send(BUNDLER, EP, encodeFunctionData({ abi: ABI.entryPoint, functionName: 'handleOp', args: [account, 0n, call] }));
const execute = (target: Hex, data: Hex) =>
  encodeFunctionData({ abi: ABI.account, functionName: 'execute', args: [target, data] });
const getNonce = async (account: Hex, block?: bigint) =>
  (await wc.readContract({ address: EP, abi: ABI.entryPoint, functionName: 'getNonce', args: [account, 0n], blockNumber: block })) as bigint;

// The mock EntryPoint's code at the real v0.7 address.
const epImpl = await deploy(FUNDER, 'MockEntryPoint');
await rpc('anvil_setCode', [EP, await rpc('eth_getCode', [epImpl, 'latest'])]);
// History before the start: EOAs with 3 transactions, one with 1; a smart account with 3 UserOps;
// a staged account and two clones that exist but have never been used.
for (const u of USERS) for (let n = 0; n < 3; n++) await send(u, u.address);
await send(NEWBIE, NEWBIE.address);
const OLD_APP = await deploy(FUNDER, 'Ping');
const SMART = await deploy(FUNDER, 'MockSmartAccount');
for (let n = 0; n < 3; n++) await userOp(SMART, execute(OLD_APP, PING));
const STAGED = await deploy(FUNDER, 'MockSmartAccount');
const CLONES = [await deploy(FUNDER, 'MockSmartAccount'), await deploy(FUNDER, 'MockSmartAccount')];
const MINI = await deploy(FUNDER, 'MockToken18');
const startBlock = await wc.getBlockNumber();
const T0 = new RealDate(Number((await wc.getBlock({ blockNumber: startBlock })).timestamp) * 1000);
const h = (hours: number) => new RealDate(T0.getTime() + hours * 3_600_000);
const ENDS = h(48);
ok((await getNonce(SMART, startBlock)) === 3n && (await getNonce(STAGED, startBlock)) === 0n, 'before the start: the smart account has 3 UserOps, the staged one none');

// ---- the campaign: Campaign #1's file, 2 days, 2 winners of $100, at least 2 users ----
const SLUG = 'e2e-campaign';
const PROGRAMS = join(ROOT, 'programs');
for (const f of readdirSync(PROGRAMS).filter((f) => f.endsWith('.json')))
  await upsertProgram(ProgramFile.parse(JSON.parse(readFileSync(join(PROGRAMS, f), 'utf8'))));
const raw = JSON.parse(readFileSync(join(PROGRAMS, 'earnkit-campaign-1-base.json'), 'utf8'));
const AMOUNT = '1000';
const file = {
  ...raw,
  id: SLUG,
  title: 'E2E Campaign',
  status: 'active',
  starts_at: T0.toISOString(),
  ends_at: ENDS.toISOString(),
  campaign: { ...raw.campaign, prize: { ...raw.campaign.prize, token: MINI }, winners: 2, amount_each: AMOUNT, prize_usd_total: 200, min_score: 2 },
};
Object.assign(file, earnkitTexts(file));
await upsertProgram(ProgramFile.parse(file));

// ---- three agents ----
async function installation(name: string) {
  const token = `ek_e2e_${name}`;
  await saveInstallation(token);
  return (await touchInstallation(token))!;
}
const A = await installation('a');
const B = await installation('b');
const C = await installation('c');
const entryDeps = {
  // GitHub's repo API is the one read faked here; earnkit.txt, deployers and contract code are read for real.
  repoFacts: async () => ({ fork: false, created_at: h(0.1).toISOString(), pushed_at: h(0.2).toISOString() }),
};
const ctx = (installationId: number) => ({ installationId, entryDeps });
const entry = (name: string, repo: string, contracts: string[], payout: string) => {
  const repo_url = `https://github.com/${repo}`;
  const live_url = `https://${repo.split('/')[1]}.example`;
  return {
    program_id: SLUG,
    project: { name, description: `${name}, for the e2e`, repo_url, live_url },
    submission_data: { project_name: name, description: `${name}, for the e2e`, repo_url, live_url, contracts: contracts.join(','), payout_wallet: payout },
    token: 'skip',
  };
};
const used = async (id: number) =>
  (await db<{ n: number }[]>`SELECT COALESCE(sum(count), 0)::int AS n FROM rate_windows WHERE key = ${`recordSubmission:${id}`}`)[0].n;
const EMOJI = /\p{Extended_Pictographic}/u;

// ---- 1. list_programs ----
setClock(h(0.25));
const first = (await tools.list_programs({}, { installationId: A })) as { show_to_builder: string };
show('list_programs (first message)', first.show_to_builder);
ok(first.show_to_builder.startsWith('| Win | Prize | Ends | You |\n|---|---|---|---|\n| E2E Campaign | $100 each to top 2 (in MINI) | '), 'list_programs: the EarnKit campaign comes first, prize in USD');
ok(!EMOJI.test(first.show_to_builder), 'list_programs: no emojis');
ok(!/token/i.test(first.show_to_builder), 'list_programs: no token advertising');

// ---- 2. entry by deployer signature ----
setClock(h(0.5));
const CA = await deploy(DEPLOYER_A, 'Ping');
const CA2 = await deploy(DEPLOYER_A, 'Ping');
const CB = await deploy(PAYOUT_B, 'Ping');
const CC = await deploy(PAYOUT_C, 'Ping');
const contractsA = [CA2.toUpperCase().replace('0X', '0x'), CA]; // as an agent might type them
const prep = (await tools.prepare_submission(
  {
    program_id: SLUG,
    project: { name: 'Tip Jar', repo_url: 'https://github.com/alice/tipjar' },
    answers: { payout_wallet: lc(PAYOUT_A), contracts: contractsA.join(', ') },
  },
  ctx(A),
)) as Record<string, any>;
show('prepare_submission show_to_builder', prep.show_to_builder);
const MESSAGE = `EarnKit entry: ${SLUG} github.com/alice/tipjar ${lc(PAYOUT_A)} ${[CA, CA2].sort().join(',')}`;
ok(prep.sign_to_enter === MESSAGE, `sign_to_enter is "EarnKit entry: <program> <repo key> <payout wallet> <sorted contracts>": ${prep.sign_to_enter}`);
ok(String(prep.show_to_builder).startsWith('| Entry | Tip Jar for E2E Campaign |\n|---|---|\n| Prize | $100 in MINI if top 2'), 'prepare_submission: one confirmation, prize first');
ok(!EMOJI.test(prep.show_to_builder) && !prep.token, 'the confirmation has no emojis, and no token block without a deploy key');
files.set('alice/tipjar', `payout_wallet: ${lc(PAYOUT_A)}\n`);
const tip = { ...entry('Tip Jar', 'alice/tipjar', contractsA, lc(PAYOUT_A)) };
const wrong = await STRANGER.signMessage({ message: MESSAGE });
const failed = await tools
  .record_submission({ ...tip, project: { ...tip.project, description: '' }, submission_data: { ...tip.submission_data, description: '' }, deployer_signature: wrong }, ctx(A))
  .then(() => null, (e: unknown) => e as Error);
show('record_submission with a wrong signer', failed?.message);
ok(failed?.message.startsWith('Fix these, then call record_submission again:'), 'a wrong signer: every problem at once');
ok(/description/.test(failed!.message) && failed!.message.includes(`sign exactly "${MESSAGE}"`), 'the missing answer and the exact text to sign, together');
ok((await used(A)) === 0, "a failed attempt doesn't use the daily limit");
const recA = (await tools.record_submission({ ...tip, deployer_signature: await DEPLOYER_A.signMessage({ message: MESSAGE }) }, ctx(A))) as Record<string, any>;
show('record_submission (signed) show_to_builder', recA.show_to_builder);
ok(recA.recorded === true && (await used(A)) === 1, "entered by the deploying wallet's signature; one entry of the daily limit used");
const idA: number = recA.project_id;
const [rowA] = await db<{ deployers: string[]; contracts: string[] }[]>`SELECT deployers, contracts FROM projects WHERE id = ${idA}`;
ok(rowA.deployers.join() === lc(DEPLOYER_A) && [...rowA.contracts].sort().join() === [CA, CA2].sort().join(), 'the signer is stored as the deployer, with both contracts (lowercase)');
files.set('bob/board', `payout_wallet: ${lc(PAYOUT_B)}\n`);
files.set('carol/one', `payout_wallet: ${lc(PAYOUT_C)}\n`);
setClock(h(0.6));
const idB = ((await tools.record_submission(entry('Bounty Board', 'bob/board', [CB], lc(PAYOUT_B)), ctx(B))) as Record<string, any>).project_id as number;
setClock(h(0.7));
const idC = ((await tools.record_submission(entry('Carol One', 'carol/one', [CC], lc(PAYOUT_C)), ctx(C))) as Record<string, any>).project_id as number;
ok(idA < idB && idB < idC, 'three entries recorded (B and C deployed from their payout wallets: no signature)');

// ---- 3. activity on the chain, indexed by the mock explorer, and two days of cron ----
const coded = concatHex([PING, Attribution.toDataSuffix({ codes: ['earnkit'] })]);
async function use(user: HDAccount, app: Hex, at: Date, input: Hex = PING) {
  const hash = await send(user, app, input);
  add(direct, app, { from: lc(user), at, hash, input });
}
// Tip Jar: its payout and deployer wallets (never users), two EOAs with history (one through the
// second contract), a newbie, the smart account through a UserOp, and the staged account: its own
// UserOp and a fan-out through two clones.
await use(PAYOUT_A, CA, h(1));
await use(DEPLOYER_A, CA, h(1));
await use(USERS[0], CA, h(2), coded);
await use(USERS[1], CA2, h(3));
await use(NEWBIE, CA, h(4));
add(internal, CA, { from: SMART, at: h(5), hash: await userOp(SMART, execute(CA, PING)) });
add(internal, CA, { from: STAGED, at: h(6), hash: await userOp(STAGED, execute(CA, PING)) });
const fan = await userOp(STAGED, encodeFunctionData({ abi: ABI.account, functionName: 'fanOut', args: [CLONES, CA, PING] }));
for (const c of CLONES) add(internal, CA, { from: c, at: h(7), hash: fan });
// Bounty Board and Carol One: EOAs only.
await use(USERS[0], CB, h(8));
await use(USERS[1], CB, h(9));
await use(USERS[0], CC, h(10));
await use(USERS[1], CC, h(11));

const cron = async (at: Date, auth = `Bearer ${process.env.CRON_SECRET}`) => {
  setClock(at);
  const res = await cronRoute(
    new Request('http://127.0.0.1/api/cron', { method: 'POST', headers: { authorization: auth, 'x-real-ip': '127.0.0.1' } }),
  );
  const body = (await res.json()) as { campaigns?: { id: string; step: string }[] };
  return { status: res.status, body, mine: body.campaigns?.find((c) => c.id === SLUG) };
};
const score = async (id: number) =>
  (await db<{ score: number | null; score_error: string | null; score_final: boolean; code_share: number | null }[]>`
    SELECT score, score_error, score_final, code_share FROM projects WHERE id = ${id}`)[0];
const counted = async (id: number) =>
  (await db<{ wallet: string; kind: string }[]>`SELECT wallet, kind FROM entry_wallets WHERE project_id = ${id} ORDER BY wallet`)
    .map((w) => `${w.wallet}:${w.kind}`).join();
const expect = (pairs: [string, string][]) => pairs.map(([w, k]) => `${w}:${k}`).sort().join();

ok((await cron(h(24), 'Bearer wrong')).status === 401, 'the cron route refuses a wrong CRON_SECRET');
const day1 = await cron(h(24));
show('cron day 1', day1.body);
ok(day1.status === 200 && day1.mine?.step === 'score', 'day 1: the cron route scores (Bearer CRON_SECRET)');
ok((await score(idA)).score === 3 && (await score(idB)).score === 2 && (await score(idC)).score === 2, 'day 1 scores: Tip Jar 3, Bounty Board 2, Carol One 2');
ok(
  (await counted(idA)) === expect([[lc(USERS[0]), 'eoa'], [lc(USERS[1]), 'eoa'], [SMART, 'smart']]),
  'Tip Jar counts two EOAs with 3+ transactions before the start and the smart account (UserOp sender, getNonce 3 at the start block)',
);
const countedA = await counted(idA);
ok(
  [lc(PAYOUT_A), lc(DEPLOYER_A), lc(NEWBIE), STAGED, ...CLONES].every((w) => !countedA.includes(w)),
  'the payout wallet, the deployer, the newbie, the staged account (getNonce 0 at the start) and its fanned-out clones are not counted',
);
ok(((await score(idA)).code_share ?? 0) > 0, "the Builder Code share is kept as evidence");
await use(USERS[2], CA, h(30));
await use(USERS[2], CB, h(40));
const day2 = await cron(h(47));
show('cron day 2', day2.body);
ok(day2.mine?.step === 'score' && (await score(idA)).score === 4 && (await score(idB)).score === 3 && (await score(idC)).score === 2, 'day 2 (last day, hourly rescoring): Tip Jar 4, Bounty Board 3, Carol One 2');
const again = await cron(h(47.2));
ok(again.mine?.step === 'score' && (again.body.campaigns?.[0] as Record<string, unknown>)?.scored === 0, 'a second call within the hour rescores nothing');

// ---- 4. the freeze; the review opens in the same call ----
const freezeAt = new RealDate(ENDS.getTime() + 20 * 60_000);
const freeze = await cron(freezeAt);
show('cron freeze', freeze.body);
const [run] = await db<{ state: string; review_until: Date; terms: Record<string, unknown> }[]>`
  SELECT state, review_until, terms FROM campaign_runs WHERE program_id = ${SLUG}`;
ok(freeze.mine?.step === 'freeze' && (freeze.mine as Record<string, unknown>).review === true, 'the freeze pass finalizes every entry...');
ok(run.state === 'review' && Math.abs(run.review_until.getTime() - (freezeAt.getTime() + 48 * 3_600_000)) < 5_000, '...and the 48-hour review opens in the same call');
ok(run.terms.amount_each === AMOUNT && String(run.terms.token).toLowerCase() === MINI, 'the payout terms are frozen with it');
ok((await score(idA)).score_final && (await score(idB)).score_final && (await score(idC)).score_final, 'all scores final');
const board = await getCampaignBoard(SLUG);
ok(board?.review?.picks.map((p) => p.id).join() === [idA, idB].join(), 'the review publishes the top 2: Tip Jar, Bounty Board');
ok(board?.funds?.wallet.toLowerCase() === lc(HOT) && board.funds.balance === '0', 'the campaign page shows the payout wallet and its balance (empty)');

// ---- 5. veto through the route; 6. the next entry moves up ----
setClock(h(50));
const key = vetoKey(SLUG)!;
const veto = async (fields: Record<string, string>) =>
  vetoRoute(
    new Request('http://127.0.0.1/api/admin/veto', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': '127.0.0.1' },
      body: new URLSearchParams(fields).toString(),
    }),
  );
ok((await veto({ slug: SLUG, key: 'wrong', entry: String(idB), reason: 'wash activity' })).status === 404, 'the veto route: a wrong key is a 404');
const vetoed = await veto({ slug: SLUG, key, entry: String(idB), reason: 'wash activity' });
ok(vetoed.status === 303 && vetoed.headers.get('location')?.endsWith(`&removed=${idB}`), 'the owner removes Bounty Board with the key (303 back to the review page)');
const [vb] = await db<{ vetoed_at: Date | null; veto_reason: string }[]>`SELECT vetoed_at, veto_reason FROM projects WHERE id = ${idB}`;
ok(vb.vetoed_at !== null && vb.veto_reason === 'wash activity', 'the veto and its public reason are stored');
ok((await getCampaignBoard(SLUG))?.review?.picks.map((p) => p.id).join() === [idA, idC].join(), 'the next entry moves up: Tip Jar and Carol One');

// ---- 7. the automatic payout ----
const balance = async (w: string) => (await wc.readContract({ address: MINI, abi: ABI.token, functionName: 'balanceOf', args: [w] })) as bigint;
const mint = async (to: string, whole: string) =>
  mined(await wc.writeContract({ account: FUNDER, address: MINI, abi: ABI.token, functionName: 'mint', args: [to, parseUnits(whole, 18)], chain: base }));
const PRIZE = parseUnits(AMOUNT, 18);
const reviewWait = await cron(h(60));
ok(reviewWait.mine?.step === 'wait' && (await balance(PAYOUT_A.address)) === 0n, 'nothing is paid during the review');
await mint(HOT.address, AMOUNT); // one prize: the wallet is short for the second
const payAt = new RealDate(run.review_until.getTime() + 60_000);
const pay1 = await cron(payAt);
show('cron payout 1', pay1.body);
ok((await balance(PAYOUT_A.address)) === PRIZE, 'pays #1 first: Tip Jar, to its payout wallet (not the deployer)');
const [short] = await db<{ state: string; note: string | null }[]>`SELECT state, note FROM campaign_runs WHERE program_id = ${SLUG}`;
ok(short.state === 'paying' && /less than the next prize/.test(short.note ?? ''), 'stops when the wallet holds less than the next prize, and says so');
ok((await balance(PAYOUT_C.address)) === 0n, 'nothing sent past the shortfall');
await mint(HOT.address, AMOUNT);
const pay2 = await cron(new RealDate(payAt.getTime() + 3_600_000));
show('cron payout 2', pay2.body);
ok((await balance(PAYOUT_C.address)) === PRIZE, 'resumes once topped up: Carol One paid');
ok((await balance(PAYOUT_B.address)) === 0n && (await balance(lc(DEPLOYER_A))) === 0n, 'the vetoed entry and the deployer got nothing');
ok((await balance(HOT.address)) === 0n, 'the capped payout wallet is empty');
const paid = await db<{ id: number; payout_status: string | null; prize_tx: Hex | null; prize_amount: string | null }[]>`
  SELECT id, payout_status, prize_tx, prize_amount FROM projects WHERE program_id = ${SLUG} ORDER BY id`;
ok(
  paid.map((p) => `${p.id}:${p.payout_status}:${p.prize_amount}`).join() === `${idA}:paid:${AMOUNT},${idB}:null:null,${idC}:paid:${AMOUNT}`,
  'the database: Tip Jar and Carol One paid the frozen amount; Bounty Board not',
);
for (const p of paid.filter((p) => p.prize_tx)) {
  const r = await wc.getTransactionReceipt({ hash: p.prize_tx! });
  ok(r.status === 'success' && lc(r.from) === lc(HOT) && lc(r.to!) === MINI, `prize transaction ${p.prize_tx!.slice(0, 10)}… mined: a MINI transfer from the payout wallet`);
}
ok((await db<{ state: string }[]>`SELECT state FROM campaign_runs WHERE program_id = ${SLUG}`)[0].state === 'paid', 'the run is paid');

// ---- 8. the winner hears it ----
setClock(new RealDate(payAt.getTime() + 2 * 3_600_000));
const listA = (await tools.list_programs({}, { installationId: A })) as { show_to_builder: string };
show('list_programs (winner)', listA.show_to_builder.split('\n')[0]);
const txA = paid.find((p) => p.id === idA)!.prize_tx!;
ok(listA.show_to_builder.startsWith(`Since you last checked: you won $100 in MINI with Tip Jar (basescan.org/tx/${txA})`), 'the winner hears it first on the next list_programs');
const listA2 = (await tools.list_programs({}, { installationId: A })) as { show_to_builder: string };
ok(!listA2.show_to_builder.includes('you won'), '...once');
const listB = (await tools.list_programs({}, { installationId: B })) as { show_to_builder: string };
ok(!listB.show_to_builder.includes('you won'), 'the vetoed entry hears no win');

// ---- 9. nothing twice ----
const nonce = await wc.getTransactionCount({ address: HOT.address });
await mint(HOT.address, AMOUNT); // even with funds there, nothing more goes out
for (const hrs of [3, 4]) {
  const r = await cron(new RealDate(payAt.getTime() + hrs * 3_600_000));
  ok(r.status === 200 && !r.mine, `cron run ${hrs - 2} after the payout: the paid campaign is skipped`);
}
ok((await wc.getTransactionCount({ address: HOT.address })) === nonce, 'the payout wallet sent no transaction');
ok((await balance(PAYOUT_A.address)) === PRIZE && (await balance(PAYOUT_C.address)) === PRIZE && (await balance(HOT.address)) === PRIZE, 'balances unchanged: each winner paid once');

server.close();
await db.end();
console.log(`campaign e2e: ${checks} checks passed`);
process.exit(0);
