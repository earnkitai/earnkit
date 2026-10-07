import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createPublicClient, createWalletClient, erc20Abi, http, toHex, type Abi, type Hex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';
import { committedProgram, completeAnswers } from './fixtures/program-file';

/**
 * The builder bonus lifecycle, end to end (v2.5 §7 local e2e, Task 10). Real code from the MCP
 * tool to the WETH transfer; only the outside world is mocked:
 * - anvil (--chain-id 8453) with mock WETH, Clanker's FeeLocker and two LP lockers (the coins sit
 *   on the second one, as on Base) from contracts/test/mocks/BonusMocks.sol;
 * - one local HTTP server standing in for tokens.fun (ticker check, deploy), raw GitHub (each
 *   repo's earnkit.txt) and Base Blockscout (coin info, holders, transfers);
 * - the GitHub API, the proof pages and the sanctions screen, injected.
 *
 * The story, over simulated days (`now` follows anvil's block time; the cron runs through
 * cronPost, so the HTTP status is checked too):
 * 1. three builders enter Arc Microgrants with record_submission: Alpha and Beta launch a coin
 *    each, Gamma says no coin (never eligible); Beta's proof page doesn't link its repo yet;
 *    Alpha's proof page answers 405 and Alpha's builder confirmed the submission (v2.6 Ruling 4
 *    (plan)): it counts as `unverified_page`, flagged for the review, never a 503;
 * 2. proof pages: Gamma checks out at once; Beta's is fixed and the cron's daily re-check passes
 *    it on day 2;
 * 3. fees: day 1, tokens.fun's cron collects both coins in one transaction; day 2 it collects
 *    Alpha only, and EarnKit collects Beta itself (the round's last 24 h); every deposit is booked
 *    to the round and claimed;
 * 4. scoring: no entry has onchain users (no contracts), and the round still ranks;
 * 5. the end: final reads, the freeze and the 48 h review; the owner vetoes Alpha; Beta takes
 *    first place and its WETH; the second place's share goes to the Safe;
 * 6. a deposit after the end is booked to the Safe and swept there;
 * 7. Beta's agent sees the win once;
 * 8. a re-run signs and pays nothing.
 *
 * Then v2.6 (zero friction, Task 8), on the same chain, mocks and cron helper: `e2e-confirm`, a
 * rolling program with no public entry page (`submission_proof: null`, builder bonus defaulted on),
 * so the builder's confirmation (`builder_submitted: true`) is the submission basis:
 * 1. Delta enters with builder_submitted and a coin; its earnkit.txt holds only the ticker-free
 *    `token: <code>` line; the reply shows the coin, the builder bonus and the leaderboard link;
 * 2. Echo enters another repo with a coin but no builder_submitted: never ranked;
 * 3. Foxtrot enters from an installation listed in EARNKIT_TEST_INSTALLATIONS, with a coin and a
 *    confirmation: on the board as "Test entry: not ranked", never scored or paid, and out of
 *    /api/stats;
 * 4. Delta's coin earns fees: the deposit is booked to `e2e-confirm:<YYYY-MM>` (the month of its
 *    block time), not to the Safe;
 * 5. the month ends: final reads, the freeze, the 48 h review, the payout: one WETH transfer of
 *    the whole pool to Delta's creator wallet, nothing for the owner;
 * 6. Echo confirms late: the same entry is updated (Ruling 23), no second entry and no second coin;
 * 7. Delta's next list_programs opens with the bonus paid and its leaderboard link;
 * 8. a re-run signs nothing.
 * Its round is keyed by the deposit's block time, never the wall clock, so the story holds on any
 * day of the month (eligibility needs only entry, coin and confirmation before the round's end).
 *
 * Not covered here (task-10-review M2): the veto goes through veto.ts vetoBonusEntry, the function
 * the admin review page's action calls, not through the page itself; its key check
 * (bonusVetoKey) and POST are covered by bonus-payout.test.ts ("bonus veto POST").
 *
 * Runs only with BONUS_ANVIL_URL (a local anvil started with --chain-id 8453) and a local
 * DATABASE_URL, like the other *.anvil.test.ts files:
 *   anvil --port 8574 --chain-id 8453
 *   BONUS_ANVIL_URL=http://127.0.0.1:8574 DATABASE_URL=postgres://... pnpm -s test
 */
const URL_ = process.env.BONUS_ANVIL_URL;
const gate = {
  skip:
    (!URL_ && 'no BONUS_ANVIL_URL') ||
    (!process.env.DATABASE_URL && 'no DATABASE_URL') ||
    (URL_ && !/^http:\/\/127\.0\.0\.1:\d+$/.test(URL_) && 'BONUS_ANVIL_URL must be a local anvil') ||
    // It wipes the bonus ledger tables: never against anything but a local database (task-10-review M3).
    (!/^postgres(ql)?:\/\/[^@/]*@?(127\.0\.0\.1|localhost)(:\d+)?\//.test(process.env.DATABASE_URL ?? '') && 'DATABASE_URL must be a local database'),
};
holdBonusDbLock();

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const MNEMONIC = 'test test test test test test test test test test test junk';
const DEPLOYER = mnemonicToAccount(MNEMONIC, { addressIndex: 0 }); // also "tokens.fun's cron"
const PAYOUT = mnemonicToAccount(MNEMONIC, { addressIndex: 1 }); // the payout (= bonus) wallet
const SAFE = '0xc8a889577446153e28d42254b75238ae31ec7d57';
const MINI = '0x2222222222222222222222222222222222222222';
const PROG = 't10-e2e-arc';
const E18 = 10n ** 18n;
const SECRET = 'e2e-cron-secret-0123456789abcdef0123456789';
const BUILDERS = {
  alpha: { wallet: '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', coin: '0xaaaa0000000000000000000000000000000010a1', symbol: 'ALPHA', login: 't10-alpha', buidl: 101 },
  beta: { wallet: '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', coin: '0xbbbb0000000000000000000000000000000010b2', symbol: 'BETA', login: 't10-beta', buidl: 102 },
  gamma: { wallet: '0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3', coin: null, symbol: null, login: 't10-gamma', buidl: 103 },
} as const;
type Name = keyof typeof BUILDERS;
const repoOf = (n: Name) => `https://github.com/${BUILDERS[n].login}/app`;
// v2.6: the program without a public entry page, and its three builders (Foxtrot: a test installation).
const PROG2 = 'e2e-confirm';
const BUILDERS2 = {
  delta: { wallet: '0xd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4', coin: '0xdddd0000000000000000000000000000000010d4', symbol: 'DELTA', login: 't10-delta' },
  echo: { wallet: '0xe5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5', coin: '0xeeee0000000000000000000000000000000010e5', symbol: 'ECHO', login: 't10-echo' },
  foxtrot: { wallet: '0xf6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6', coin: '0xffff0000000000000000000000000000000010f6', symbol: 'FOXT', login: 't10-foxtrot' },
} as const;
type Name2 = keyof typeof BUILDERS2;
const repo2 = (n: Name2) => `https://github.com/${BUILDERS2[n].login}/app`;
/** Every mocked coin, by address or symbol: [builder, wallet] for the Blockscout and tokens.fun mocks. */
const COINS = [...Object.entries(BUILDERS), ...Object.entries(BUILDERS2)].filter(([, b]) => b.coin) as [string, { coin: string; symbol: string; wallet: string }][];

async function cleanup() {
  await sql()`DELETE FROM bonus_ledger`;
  await sql()`DELETE FROM bonus_sweeps`;
  await sql()`DELETE FROM bonus_cursor`;
  for (const id of [PROG, PROG2]) {
    await sql()`DELETE FROM bonus_payouts WHERE round_key IN (SELECT round_key FROM bonus_rounds WHERE program_id = ${id})`;
    await sql()`DELETE FROM bonus_vetoes WHERE round_key IN (SELECT round_key FROM bonus_rounds WHERE program_id = ${id})`;
    await sql()`DELETE FROM bonus_scores WHERE round_key IN (SELECT round_key FROM bonus_rounds WHERE program_id = ${id})`;
    await sql()`DELETE FROM bonus_commits WHERE round_key IN (SELECT round_key FROM bonus_rounds WHERE program_id = ${id})`;
    await sql()`DELETE FROM bonus_rounds WHERE program_id = ${id}`;
    await sql()`DELETE FROM submissions WHERE project_id IN (SELECT id FROM projects WHERE program_id = ${id})`;
    await sql()`DELETE FROM projects WHERE program_id = ${id}`;
    await sql()`DELETE FROM programs WHERE id = ${id}`;
  }
  await sql()`DELETE FROM installations WHERE token_hash LIKE 't10-e2e-%'`;
  await sql()`DELETE FROM github_users WHERE login LIKE 't10-%'`;
  await sql()`DELETE FROM scoring_leases WHERE program_id IN ('bonus-ledger', 'bonus-scoring')`;
}

test('e2e: entries with coins, proof pages (one unverified), fees over 2 days, scoring, freeze, veto, WETH payout, sweep, alert, idempotent re-run; v2.6: confirmed entry paid, test installation never ranked, late confirmation', gate, async () => {
  const pc = createPublicClient({ chain: base, transport: http(URL_) });
  assert.equal(await pc.getChainId(), 8453, 'start anvil with --chain-id 8453');
  await pc.request({ method: 'anvil_reset' as never, params: [] as never });
  await pc.request({ method: 'anvil_setBalance' as never, params: [PAYOUT.address, toHex(E18)] as never });
  const mock = await startMocks();
  await cleanup();
  const testIds = process.env.EARNKIT_TEST_INSTALLATIONS;
  try {
    await scenario(mock);
  } finally {
    if (testIds === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = testIds;
    mock.server.closeAllConnections();
    await new Promise<void>((r) => mock.server.close(() => r()));
    await cleanup();
  }
});

/** The mutable state the mock servers answer from. */
type Mock = {
  server: Server;
  /** The simulated time (Blockscout's newest transfer is "now", so every coin counts as traded). */
  now: Date;
  deploys: Record<string, unknown>[];
  /** earnkit.txt per repo name: the builder's wallet and its token line. */
  files: Map<string, string>;
};

async function startMocks(): Promise<Mock> {
  const m: Mock = { server: null as unknown as Server, now: new Date(), deploys: [], files: new Map() };
  const body = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolve(b));
    });
  m.server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const json = (status: number, b: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(b));
    };
    // raw GitHub: earnkit.txt.
    const file = /^\/([^/]+)\/([^/]+)\/HEAD\/earnkit\.txt$/.exec(url.pathname);
    if (file) {
      const text = m.files.get(file[1]);
      res.writeHead(text ? 200 : 404, { 'content-type': 'text/plain' });
      return res.end(text ?? '404: Not Found');
    }
    // Base Blockscout.
    const token = /^\/api\/v2\/tokens\/(0x[0-9a-f]{40})(\/holders|\/transfers)?$/.exec(url.pathname);
    if (token) {
      const coin = token[1];
      const who = COINS.find(([, b]) => b.coin === coin)?.[0];
      if (!who) return json(404, { message: 'Not found' });
      if (token[2] === '/transfers') return json(200, { items: [{ timestamp: m.now.toISOString() }], next_page_params: null });
      if (token[2] === '/holders') {
        const worth = (5000n * E18).toString(); // $5 at the price below: counts
        const dust = (10n * E18).toString(); // $0.01: doesn't
        const items =
          who === 'alpha'
            ? [
                { address: { hash: '0x7000000000000000000000000000000000000001' }, value: worth },
                { address: { hash: '0x7000000000000000000000000000000000000002' }, value: worth },
                { address: { hash: '0x7000000000000000000000000000000000000003' }, value: dust },
                { address: { hash: BUILDERS.alpha.wallet }, value: worth }, // the builder: never counted
              ]
            : [{ address: { hash: '0x7000000000000000000000000000000000000004' }, value: worth }]; // Beta, and the v2.6 coins
        return json(200, { items, next_page_params: null });
      }
      return json(200, { exchange_rate: '0.001', total_supply: (10n ** 9n * E18).toString(), decimals: '18', circulating_market_cap: who === 'alpha' ? '9000' : '7000' });
    }
    // tokens.fun.
    if (req.headers.authorization !== 'Bearer e2e-mock-key') return json(401, { error: 'Unauthorized' });
    if (req.method === 'GET' && url.pathname === '/api/check-ticker') return json(200, { available: true });
    if (req.method === 'POST' && url.pathname === '/api/v1/deploy') {
      const b = JSON.parse(await body(req)) as Record<string, unknown>;
      m.deploys.push(b);
      const coin = COINS.find(([, c]) => c.symbol === b.symbol)?.[1].coin;
      if (!coin) return json(400, { error: 'unknown symbol' });
      return json(200, {
        success: true,
        tokenAddress: coin,
        txHash: '0x' + 'cd'.repeat(32),
        chainId: b.chainId,
        urls: { tokensfun: `https://tokens.fun/coin/${coin}` },
      });
    }
    json(404, { error: 'not found' });
  });
  await new Promise<void>((r) => m.server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(m.server.address() as AddressInfo).port}`;
  // Read by the app modules at import (tokens.fun) or per call (the overrides need NODE_ENV=test).
  Object.assign(process.env, {
    NODE_ENV: 'test',
    TOKENSFUN_API_URL: origin,
    TOKENSFUN_DEPLOY_API_KEY: 'e2e-mock-key',
    EARNKIT_OWNERSHIP_BASE_URL: origin,
    EARNKIT_BLOCKSCOUT_URL: origin,
    CRON_SECRET: SECRET,
  });
  process.env.EARNKIT_AUTH_SECRET ||= 'e2e-auth-secret-0123456789abcdef';
  delete process.env.EARNKIT_BONUS_WALLET;
  delete process.env.BONUS_INDEX_START_BLOCK;
  return m;
}

async function scenario(mock: Mock) {
  // App modules load only now, after the mock's URLs are in the environment.
  const { tools } = await import('./tools');
  const { upsertProgram } = await import('./programs');
  const { ProgramFile } = await import('./program-file');
  const { tokenLineFor } = await import('./token-gate');
  const { CONFIRMATIONS, bonusRpc } = await import('./bonus-ledger');
  const { cronPost, runCron } = await import('./cron');
  const { splitPool } = await import('./bonus-payout');
  const { roundFor, roundPoolsWei, windowKey } = await import('./bonus-rounds');
  const { bonusBoard } = await import('./bonus-board');
  const { readStats } = await import('./stats');
  const { vetoBonusEntry, VetoError } = await import('./veto');
  const { sinceYouLastChecked } = await import('./alerts');

  const pc = createPublicClient({ chain: base, transport: http(URL_) });
  const rpc = (method: string, params: unknown[] = []) => pc.request({ method: method as never, params: params as never });
  execFileSync('forge', ['build', '--root', join(ROOT, 'contracts')], { stdio: 'ignore' });
  const art = (name: string) =>
    JSON.parse(readFileSync(join(ROOT, 'contracts', 'out', 'BonusMocks.sol', `${name}.json`), 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  const wc = createWalletClient({ account: DEPLOYER, chain: base, transport: http(URL_) });
  const deploy = async (name: string, args: unknown[] = []) => {
    const hash = await wc.deployContract({ abi: art(name).abi, bytecode: art(name).bytecode.object, args });
    return (await pc.waitForTransactionReceipt({ hash })).contractAddress!.toLowerCase() as Hex;
  };
  const call = async (address: Hex, functionName: string, args: unknown[]) => {
    const hash = await wc.writeContract({ address, abi: art('MockLpLocker').abi, functionName, args });
    assert.equal((await pc.waitForTransactionReceipt({ hash })).status, 'success', functionName);
  };
  const weth = await deploy('MockWETH');
  const feeLocker = await deploy('MockFeeLocker');
  const oldLocker = await deploy('MockLpLocker', [feeLocker, weth]); // holds no EarnKit coin
  const locker = await deploy('MockLpLocker', [feeLocker, weth]);
  const chain = { feeLocker, lockers: [oldLocker, locker], weth, safe: SAFE as Hex };
  for (const n of ['alpha', 'beta'] as const)
    await call(locker, 'register', [BUILDERS[n].coin, [SAFE, BUILDERS[n].wallet, MINI, PAYOUT.address], [3000, 4000, 1000, 2000]]);
  const bal = (who: string) => pc.readContract({ address: weth, abi: erc20Abi, functionName: 'balanceOf', args: [who as Hex] });

  // Simulated time: hour offsets from the chain's start (anvil starts at the real time, so rows
  // written with the database's now() at submission fall inside the round too).
  await rpc('evm_mine');
  const t0 = Number((await pc.getBlock()).timestamp);
  const hour = (n: number) => new Date((t0 + n * 3600) * 1000);
  const setTime = async (n: number) => {
    await rpc('evm_setNextBlockTimestamp', [toHex(t0 + n * 3600)]);
    await rpc('evm_mine');
  };
  const mineDeep = () => rpc('anvil_mine', [toHex(CONFIRMATIONS + 1n)]);
  const chainNow = async () => new Date(Number((await pc.getBlock()).timestamp) * 1000);

  // The program: Arc Microgrants' real file (submission_proof: dorahacks.io, /buidl/<id>), under a
  // test id, open from an hour ago for 36 hours.
  const file = committedProgram('arc-microgrants');
  await upsertProgram(ProgramFile.parse({ ...file, id: PROG, status: 'active', starts_at: hour(-1).toISOString(), ends_at: hour(36).toISOString() }));
  const ENDS = hour(36);
  // The program's round (Ruling 21): keyed by its window's UTC start day.
  const ROUND = windowKey(PROG, hour(-1));

  // ---- 1. Three builders enter; two launch a coin, one says no coin ----
  // Alpha's page answers 405 (DoraHacks does to bots): unreachable, so Alpha's confirmation counts.
  const proofPages = new Map<number, string | 405>([
    [101, 405],
    [102, 'Beta: an app for teams (repo link coming soon)'],
    [103, `Source: ${repoOf('gamma')}`],
  ]);
  const fetchProof = async (url: string) => {
    const page = proofPages.get(Number(/\/buidl\/(\d+)$/.exec(url)?.[1]));
    if (page === undefined) throw new Error('404');
    if (page === 405) throw Object.assign(new Error('HTTP 405'), { status: 405 });
    return page;
  };
  const inst: Record<Name, number> = { alpha: 0, beta: 0, gamma: 0 };
  const ids: Record<Name, number> = { alpha: 0, beta: 0, gamma: 0 };
  type Recorded = { recorded: boolean; project_id: number; bonus_note?: string; token: { status: string; note?: string } };
  for (const n of Object.keys(BUILDERS) as Name[]) {
    const b = BUILDERS[n];
    const [row] = await sql()<{ id: number }[]>`
      INSERT INTO installations (token_hash, payout_wallet) VALUES (${`t10-e2e-${n}-${Date.now()}`}, ${b.wallet}) RETURNING id`;
    inst[n] = row.id;
    if (b.symbol) mock.files.set(b.login, `payout_wallet: ${b.wallet}\n${tokenLineFor(row.id, repoOf(n))}\n`);
    const r = (await tools.record_submission(
      {
        program_id: PROG,
        project: { name: `${n} app`, description: 'A tiny app on Arc', repo_url: repoOf(n), live_url: `https://${n}-app.example` },
        submission_data: { live_deployment_url: `https://${n}-app.example`, repo_url: repoOf(n), description: 'A tiny app on Arc', builder_profile: `https://github.com/${b.login}` },
        external_submission_url: `https://dorahacks.io/buidl/${b.buidl}`,
        payout_wallet: b.wallet,
        token: b.symbol ? { name: `${n} app`, symbol: b.symbol } : 'skip',
        builder_confirmed: true,
        ...(n === 'alpha' && { builder_submitted: true }),
      },
      {
        installationId: row.id,
        entryDeps: { fetchProof },
        tokenDeps: {
          gate: { repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }), screen: async () => {} },
          limit: async () => {},
        },
      },
    )) as Recorded;
    assert.equal(r.recorded, true, `${n} recorded`);
    ids[n] = r.project_id;
    assert.equal(r.token.status, b.symbol ? 'launched' : 'skipped', `${n} token: ${JSON.stringify(r.token)}`);
  }
  assert.equal(mock.deploys.length, 2, 'tokens.fun got two deploys (Gamma said no coin)');
  for (const d of mock.deploys) assert.equal(d.source, 'earnkit');
  type Row = { id: number; coin_address: string | null; creator_wallet: string | null; submission_proof_ok_at: Date | null; submission_basis: string | null };
  const rows = async (prog = PROG) =>
    new Map(
      (await sql()<Row[]>`SELECT id, coin_address, creator_wallet, submission_proof_ok_at, submission_basis FROM projects WHERE program_id = ${prog}`).map((r) => [r.id, r]),
    );
  let p = await rows();
  assert.equal(p.get(ids.alpha)!.coin_address, BUILDERS.alpha.coin);
  assert.equal(p.get(ids.beta)!.coin_address, BUILDERS.beta.coin);
  assert.equal(p.get(ids.gamma)!.coin_address, null, 'no coin: never bonus-eligible');
  assert.equal(p.get(ids.alpha)!.creator_wallet, BUILDERS.alpha.wallet);

  // ---- 2. Proof pages: Gamma checks out; Alpha counts on an unverified page; Beta's doesn't link its repo yet ----
  assert.ok(p.get(ids.alpha)!.submission_proof_ok_at && p.get(ids.gamma)!.submission_proof_ok_at);
  assert.equal(p.get(ids.gamma)!.submission_basis, 'page');
  assert.equal(p.get(ids.alpha)!.submission_basis, 'unverified_page', 'a 405 page with the builder confirmation: eligible, flagged');
  assert.equal(p.get(ids.beta)!.submission_proof_ok_at, null);

  // The cron, through the route handler (rate limit off). Everything outside is a mock.
  const github = githubMock(t0);
  const cron = async (now: Date, scope: { prog: string; round: string } = { prog: PROG, round: ROUND }) => {
    mock.now = now;
    const res = await cronPost(new Request('http://127.0.0.1/api/cron', { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } }), {
      limit: async () => {},
      run: () =>
        runCron({
          now,
          only: [scope.prog],
          deps: {
            refreshFees: async () => 0,
            bonus: { account: PAYOUT, rpc: bonusRpc(URL_, chain), chain, startBlock: 0n, now, log: (l) => logs.push(l) },
            traction: { now, only: [scope.round], github: async (path) => github(path), probe: async () => true, excluded: [PAYOUT.address.toLowerCase()] },
            proofRecheck: { fetchText: fetchProof },
            rounds: { listed: async () => false, only: [scope.round] },
          },
        }),
    });
    return { status: res.status, body: (await res.json()) as CronBody };
  };
  const logs: string[] = [];

  // ---- 3. Day 1: tokens.fun's cron collects both coins in one transaction ----
  await setTime(1);
  await call(locker, 'accrue', [BUILDERS.alpha.coin, 1n * E18]);
  await call(locker, 'accrue', [BUILDERS.beta.coin, 2n * E18]);
  await call(locker, 'collectMany', [[BUILDERS.alpha.coin, BUILDERS.beta.coin]]);
  await mineDeep();
  const d1 = await cron(await chainNow());
  assert.equal(d1.status, 200, JSON.stringify(d1.body));
  assert.equal(d1.body.bonus.index.round, 2, 'both deposits booked to the round');
  // collectNearEnd reads every EarnKit coin (other test files' too): only ours are checked.
  const ours = (r: CronBody) => r.bonus.collect.filter((c) => c.coin === BUILDERS.alpha.coin || c.coin === BUILDERS.beta.coin);
  assert.deepEqual(ours(d1.body), [], 'no EarnKit collect before the last 24 h');
  assert.match(d1.body.bonus.claim[0].result, /^claim success/, 'the bonus wallet claimed');
  assert.match(d1.body.bonus.claim[1].result, /^claim success/, "the Safe's 30% claimed to the Safe");
  assert.equal((await roundPoolsWei([PROG], { now: await chainNow() })).get(PROG), (6n * E18) / 10n, 'pool so far: 0.6 ETH');
  // The round's row is made by its first booking (this run's index step, after scoring): scoring starts next run.
  assert.deepEqual(d1.body.bonus_scoring, []);
  // The re-check is global (other test files' entries may be in it): Beta's own row is what counts.
  assert.ok(d1.body.proof_recheck, 'the daily proof re-check ran');
  assert.equal((await rows()).get(ids.beta)!.submission_proof_ok_at, null, "Beta's proof was checked under 24 h ago: not re-checked yet");

  // ---- Day 2: Beta fixes its page. tokens.fun collects Alpha only; EarnKit collects Beta itself ----
  proofPages.set(102, `Beta: ${repoOf('beta')}`);
  await setTime(25);
  await call(locker, 'accrue', [BUILDERS.alpha.coin, 1n * E18]);
  await call(locker, 'accrue', [BUILDERS.beta.coin, 1n * E18]);
  await call(locker, 'collectRewards', [BUILDERS.alpha.coin]);
  await mineDeep();
  const d2 = await cron(await chainNow());
  assert.equal(d2.status, 200, JSON.stringify(d2.body));
  assert.equal(d2.body.bonus.index.round, 1, "Alpha's day-2 deposit");
  const collected = ours(d2.body);
  assert.equal(collected.length, 1, `Alpha was collected by tokens.fun just now: ${JSON.stringify(collected)}`);
  assert.equal(collected[0].coin, BUILDERS.beta.coin);
  assert.match(collected[0].result, /^collect success/, 'found its locker (the second) and collected');
  assert.deepEqual(d2.body.bonus_scoring, [{ round: ROUND, ranked: 1 }], 'only Alpha is eligible yet');
  assert.ok((d2.body.proof_recheck?.passed ?? 0) >= 1, JSON.stringify(d2.body.proof_recheck));
  assert.ok((await rows()).get(ids.beta)!.submission_proof_ok_at, "Beta's proof passes on the daily re-check");
  // An hour later: Beta's collected deposit is booked; Beta is read for the first time.
  await setTime(26);
  await mineDeep();
  const d2b = await cron(await chainNow());
  assert.equal(d2b.status, 200, JSON.stringify(d2b.body));
  assert.equal(d2b.body.bonus.index.round, 1, "Beta's deposit from EarnKit's own collect");
  assert.deepEqual(d2b.body.bonus_scoring, [{ round: ROUND, ranked: 2 }], 'Beta is eligible now');
  assert.equal((await roundPoolsWei([PROG], { now: await chainNow() })).get(PROG), E18, 'pool so far: 1 ETH');

  // ---- 4. Scoring with no onchain users still ranks ----
  type Score = { project_id: number; rank: number; score: number; signals: { users: number; holders: number; interest: number } };
  const latest = async () =>
    sql()<Score[]>`
      SELECT DISTINCT ON (project_id) project_id, rank, score, signals FROM bonus_scores
      WHERE round_key = ${ROUND} ORDER BY project_id, day DESC`;
  let scores = await latest();
  assert.deepEqual(scores.map((s) => s.project_id).sort(), [ids.alpha, ids.beta].sort(), 'Gamma (no coin) is never scored');
  for (const s of scores) assert.equal(s.signals.users, 0, 'no contracts: no onchain users');
  const byId = new Map(scores.map((s) => [s.project_id, s]));
  assert.equal(byId.get(ids.alpha)!.rank, 1);
  assert.equal(byId.get(ids.beta)!.rank, 2);
  assert.ok(byId.get(ids.alpha)!.score > byId.get(ids.beta)!.score && byId.get(ids.beta)!.score > 0, JSON.stringify(scores));
  assert.equal(byId.get(ids.alpha)!.signals.holders, 2, "holders worth $1+, never the builder's wallet");

  // ---- 5 and 6. The end: a deposit after it; final reads, the freeze, the review; the sweep ----
  await setTime(37);
  await call(locker, 'accrue', [BUILDERS.alpha.coin, 1n * E18]);
  await call(locker, 'collectRewards', [BUILDERS.alpha.coin]);
  await mineDeep();
  const end = await cron(await chainNow());
  assert.equal(end.status, 200, JSON.stringify(end.body));
  assert.equal(end.body.bonus.index.safe, 1, 'the post-end deposit is booked to the Safe');
  assert.ok(logs.some((l) => l.includes(`${PROG}: no open round`)), logs.join('\n'));
  assert.equal(end.body.bonus.rounds.rounds[0].step, 'review', JSON.stringify(end.body.bonus.rounds));
  assert.equal(end.body.bonus.sweep.status, 'paid', `the late 0.2 WETH goes to the Safe: ${end.body.bonus.sweep.result}`);
  const [round] = await sql()<{ state: string; review_until: Date; terms: { pool_wei: string; amounts: string[]; flagged: number[] } }[]>`
    SELECT state, review_until, terms FROM bonus_rounds WHERE round_key = ${ROUND}`;
  // An oracle independent of splitPool (task-10-review M1): 25 : 18 renormalized over two
  // places, the rounding dust to first place.
  const second = (E18 * 1800n) / 4300n;
  const amounts = [E18 - second, second];
  assert.deepEqual(splitPool(E18, 2), amounts);
  assert.equal(round.state, 'review');
  assert.equal(round.terms.pool_wei, E18.toString(), 'the pool is every deposit made inside the round');
  assert.deepEqual(round.terms.amounts, amounts.map(String), '25 : 18, renormalized over two places');
  assert.deepEqual(round.terms.flagged, [], 'an unverified page is a review note, never a hold');
  assert.ok(!end.body.needs_owner.includes(`bonus:${ROUND}`), JSON.stringify(end.body.needs_owner));
  const [alphaFrozen] = await sql()<{ flags: string[] }[]>`
    SELECT flags FROM bonus_payouts WHERE round_key = ${ROUND} AND project_id = ${ids.alpha}`;
  assert.ok(alphaFrozen.flags.includes('unverified_page'), JSON.stringify(alphaFrozen));
  scores = await latest();
  for (const s of scores) assert.ok(s.rank >= 1);
  assert.equal(await bal(PAYOUT.address), E18, 'the bonus wallet holds exactly the frozen pool');

  // The owner's veto, during the review: Alpha (first place) is removed; Gamma was never ranked.
  await vetoBonusEntry(ROUND, ids.alpha, 'e2e: removed in review');
  await assert.rejects(vetoBonusEntry(ROUND, ids.gamma, 'not ranked'), VetoError);
  const wait = await cron(hour(60));
  assert.equal(wait.body.bonus.rounds.rounds[0].step, 'wait', 'nothing is paid during the 48 h review');
  assert.equal(await bal(BUILDERS.beta.wallet), 0n);

  // After the review: Beta moves up into first place's frozen amount; second place's goes to the Safe.
  const safeBefore = await bal(SAFE);
  const pay = await cron(new Date(round.review_until.getTime() + 3_600_000));
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal(pay.body.bonus.rounds.rounds[0].done, true, JSON.stringify(pay.body.bonus.rounds));
  assert.equal(pay.body.bonus.rounds.rounds[0].to_safe, amounts[1].toString());
  assert.equal(await bal(BUILDERS.beta.wallet), amounts[0], 'Beta (creator wallet) gets first place: 2500/4300 of the pool');
  assert.equal(await bal(BUILDERS.alpha.wallet), 0n, 'the vetoed entry gets nothing');
  assert.equal(await bal(BUILDERS.gamma.wallet), 0n);
  assert.equal(pay.body.bonus.sweep.status, 'paid', `the unpaid place is swept to the Safe: ${pay.body.bonus.sweep.result}`);
  assert.equal((await bal(SAFE)) - safeBefore, amounts[1]);
  assert.equal(await bal(PAYOUT.address), 0n, 'the bonus wallet keeps nothing');
  // The Safe: its 30% of every fee (6 ETH collected), the post-end bonus share and the unpaid place.
  assert.equal(await bal(SAFE), (18n * E18) / 10n + (2n * E18) / 10n + amounts[1]);
  const paid = await sql()<{ project_id: number; status: string | null; slot: number | null; tx_hash: string | null; amount_wei: string | null }[]>`
    SELECT project_id, status, slot, tx_hash, amount_wei::text FROM bonus_payouts WHERE round_key = ${ROUND} ORDER BY rank`;
  assert.deepEqual(
    paid.map((r) => [r.project_id, r.status, r.slot]),
    [[ids.alpha, null, null], [ids.beta, 'paid', 0]],
  );
  assert.equal((await pc.getTransactionReceipt({ hash: paid[1].tx_hash as Hex })).status, 'success');

  // ---- 7. The winner alert: Beta's agent sees the win once; Alpha's sees none ----
  const beta = await sinceYouLastChecked(inst.beta);
  // Ruling 25 (v2.6): one natural clause, the tx link (Ruling 26) and the leaderboard slug (Ruling 12).
  assert.ok(
    beta.lines.some((l) =>
      new RegExp(`^you were paid a 0\\.58 ETH builder bonus \\(as WETH\\) for Arc Microgrants, sent to 0xb2b2…b2b2 \\(basescan\\.org/tx/0x[0-9a-f]{64}\\) · earnkit\\.com/bonus/${PROG}-\\d{4}-\\d{2}-\\d{2}$`).test(l),
    ),
    JSON.stringify(beta.lines),
  );
  assert.ok(!(await sinceYouLastChecked(inst.beta)).lines.some((l) => l.includes('builder bonus (')), 'shown once');
  assert.ok(!(await sinceYouLastChecked(inst.alpha)).lines.some((l) => l.includes('builder bonus (')));

  // ---- 8. A re-run signs and pays nothing ----
  const nonce = await pc.getTransactionCount({ address: PAYOUT.address });
  const balances = await Promise.all([SAFE, BUILDERS.alpha.wallet, BUILDERS.beta.wallet, PAYOUT.address].map(bal));
  for (const h of [2, 26]) {
    const again = await cron(new Date(round.review_until.getTime() + h * 3_600_000));
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(again.body.bonus.rounds.rounds, []);
    assert.equal(again.body.bonus.sweep.result, 'nothing to sweep');
  }
  assert.equal(await pc.getTransactionCount({ address: PAYOUT.address }), nonce, 'no new transaction');
  assert.deepEqual(await Promise.all([SAFE, BUILDERS.alpha.wallet, BUILDERS.beta.wallet, PAYOUT.address].map(bal)), balances);
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM bonus_payouts WHERE round_key = ${ROUND} AND status = 'paid'`;
  assert.equal(n, 1);
  p = await rows();
  assert.ok(ENDS.getTime() > p.get(ids.beta)!.submission_proof_ok_at!.getTime(), "Beta's proof passed before the end");
  assert.equal(p.get(ids.alpha)!.submission_basis, 'unverified_page', 'still unreachable on every re-check: no change');

  // ======== v2.6: a program without a public entry page; the builder's confirmation counts ========
  const baseFile = committedProgram('base-builder-grants');
  // Rolling, submission_proof null, builder_bonus left out (defaults on).
  await upsertProgram(ProgramFile.parse({ ...baseFile, id: PROG2, title: 'E2E Confirm Grants', status: 'active', starts_at: null, ends_at: null }));
  for (const n of Object.keys(BUILDERS2) as Name2[])
    await call(locker, 'register', [BUILDERS2[n].coin, [SAFE, BUILDERS2[n].wallet, MINI, PAYOUT.address], [3000, 4000, 1000, 2000]]);
  const inst2: Record<Name2, number> = { delta: 0, echo: 0, foxtrot: 0 };
  const ids2: Record<Name2, number> = { delta: 0, echo: 0, foxtrot: 0 };
  for (const n of Object.keys(BUILDERS2) as Name2[]) {
    // No remembered wallet: the wallet given at submission is remembered (Ruling 10 (plan)).
    const [row] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t10-e2e-${n}-${Date.now()}`}) RETURNING id`;
    inst2[n] = row.id;
    // v2.6: earnkit.txt holds only the ticker-free code line (Ruling 1 (plan)), no payout_wallet.
    mock.files.set(BUILDERS2[n].login, `${tokenLineFor(row.id, repo2(n))}\n`);
  }
  assert.match(mock.files.get(BUILDERS2.delta.login)!, /^token: [0-9a-f]{16}\n$/);
  // Foxtrot is the owner's test installation (Ruling 6 (plan)).
  process.env.EARNKIT_TEST_INSTALLATIONS = ` ${inst2.foxtrot}, `;
  type Entered = Recorded & { show_to_builder: string; updated?: true; bonus_join: { kind: string } | null };
  const submit2 = async (n: Name2, confirmed: boolean) =>
    (await tools.record_submission(
      {
        program_id: PROG2,
        project: { name: `${n} app`, description: 'A tiny app on Base', repo_url: repo2(n), live_url: `https://${n}-app.example` },
        // C7: every required answer, so the entry is ready and its token launches.
        submission_data: completeAnswers(baseFile.submission_requirements, {
          full_name: n,
          project_name_description: `${n} app: a tiny app on Base`,
          live_product_url: `https://${n}-app.example`,
        }),
        payout_wallet: BUILDERS2[n].wallet,
        token: { name: `${n} app`, symbol: BUILDERS2[n].symbol },
        builder_confirmed: true,
        ...(confirmed && { builder_submitted: true }),
      },
      {
        installationId: inst2[n],
        tokenDeps: {
          gate: { repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }), screen: async () => {} },
          limit: async () => {},
        },
      },
    )) as Entered;
  const deploysBefore = mock.deploys.length;
  // ---- v2.6 1-3. Delta confirms; Echo doesn't; Foxtrot is a test installation ----
  const delta = await submit2('delta', true);
  const echo = await submit2('echo', false);
  const foxtrot = await submit2('foxtrot', true);
  for (const [n, r] of [['delta', delta], ['echo', echo], ['foxtrot', foxtrot]] as const) {
    assert.equal(r.recorded, true, n);
    assert.equal(r.token.status, 'launched', `${n} token: ${JSON.stringify(r.token)}`);
    ids2[n] = r.project_id;
  }
  assert.equal(mock.deploys.length - deploysBefore, 3, 'three coins on tokens.fun');
  // The after-submission reply: the coin, then the builder bonus with its leaderboard link. v2.8
  // Ruling 29 (plan): "Also qualifies" may follow after a blank line (the shared test database
  // holds other open programs this repo fits), anchored on that join.
  assert.match(delta.show_to_builder, new RegExp(`^Entered in E2E Confirm Grants\\. Your token: tokens\\.fun/coin/${BUILDERS2.delta.coin} · you earn 40% of its fees\\.\\nBuilder bonus: .+ · ends .+ · earnkit\\.com/bonus/${PROG2}-\\d{4}-\\d{2}(?:\\n\\nYou also qualify for:\\n[\\s\\S]*)?$`), delta.show_to_builder);
  // Echo's reply says the one step that joins the bonus; the note tells the agent the field.
  assert.equal(echo.bonus_join?.kind, 'confirm');
  assert.match(echo.show_to_builder, /\nTell me once you've submitted on forms\.gle to join the builder bonus \(/, echo.show_to_builder);
  assert.match(echo.bonus_note ?? '', /builder_submitted: true/);
  let p2 = await rows(PROG2);
  assert.equal(p2.get(ids2.delta)!.submission_basis, 'confirmed');
  assert.ok(p2.get(ids2.delta)!.submission_proof_ok_at, 'counts on the confirmation');
  assert.equal(p2.get(ids2.delta)!.creator_wallet, BUILDERS2.delta.wallet);
  assert.equal(p2.get(ids2.echo)!.submission_basis, null, 'not confirmed: not eligible');
  assert.equal(p2.get(ids2.echo)!.submission_proof_ok_at, null);
  assert.equal(p2.get(ids2.foxtrot)!.submission_basis, 'confirmed', "a test entry's own row is like any other");
  const [mem] = await sql()<{ payout_wallet: string | null }[]>`SELECT payout_wallet FROM installations WHERE id = ${inst2.delta}`;
  assert.equal(mem.payout_wallet, BUILDERS2.delta.wallet, "the installation's last wallet is remembered");

  // /api/stats never counts the test installation (Ruling 16 (plan)); one snapshot, the env toggled.
  const stats = await sql().begin('isolation level repeatable read', async (tx) => {
    process.env.EARNKIT_TEST_INSTALLATIONS = '';
    const all = await readStats(new Date(), tx);
    process.env.EARNKIT_TEST_INSTALLATIONS = String(inst2.foxtrot);
    const shown = await readStats(new Date(), tx);
    return { all, shown };
  });
  assert.equal(stats.all.installs - stats.shown.installs, 1, 'installs');
  assert.equal(stats.all.coins_launched - stats.shown.coins_launched, 1, 'coins_launched');

  // ---- v2.6 4. Delta's coin earns fees: booked to the program's month round, not the Safe ----
  const safe2Before = await bal(SAFE);
  // Fix round 1 (review M3): never deposit in the month's last 2 h, so the scoring run and the
  // board below always fit inside the round (else start an hour into the next month).
  let at = new Date((Number((await pc.getBlock()).timestamp) + 3600) * 1000);
  const monthEnd = roundFor({ id: PROG2, starts_at: null, ends_at: null }, at)!.ends;
  if (monthEnd.getTime() - at.getTime() < 2 * 3_600_000) at = new Date(monthEnd.getTime() + 3_600_000);
  await setTime((at.getTime() / 1000 - t0) / 3600);
  await call(locker, 'accrue', [BUILDERS2.delta.coin, 1n * E18]);
  await call(locker, 'collectRewards', [BUILDERS2.delta.coin]);
  const depositAt = await chainNow();
  // The deposit's block time picks the round (bookingFor): never the wall clock.
  const r2 = roundFor({ id: PROG2, starts_at: null, ends_at: null }, depositAt)!;
  const ROUND2 = r2.key;
  assert.match(ROUND2, /^e2e-confirm:\d{4}-\d{2}$/);
  const scope2 = { prog: PROG2, round: ROUND2 };
  await mineDeep();
  const c1 = await cron(await chainNow(), scope2);
  assert.equal(c1.status, 200, JSON.stringify(c1.body));
  assert.equal(c1.body.bonus.index.round, 1, "Delta's deposit is booked to its round");
  assert.equal(c1.body.bonus.index.safe, 0, 'not the Safe');
  const POOL2 = (2n * E18) / 10n; // the bonus wallet's 20% slot
  const [booked] = await sql()<{ round_key: string; destination: string; amount_wei: string }[]>`
    SELECT round_key, destination, amount_wei::text FROM bonus_ledger WHERE coin = ${BUILDERS2.delta.coin}`;
  assert.deepEqual(booked, { round_key: ROUND2, destination: 'round', amount_wei: POOL2.toString() });
  assert.ok(r2.ends.getTime() - depositAt.getTime() > 3_600_000, 'the deposit leaves room to score before the end');
  // Scoring, once the round has its row: an hour after the deposit, still inside the round.
  await setTime((depositAt.getTime() / 1000 + 3600 - t0) / 3600);
  await mineDeep();
  const c2 = await cron(await chainNow(), scope2);
  assert.equal(c2.status, 200, JSON.stringify(c2.body));
  assert.deepEqual(c2.body.bonus_scoring, [{ round: ROUND2, ranked: 1 }], 'only Delta: Echo unconfirmed, Foxtrot a test entry');
  const board = (await bonusBoard(ROUND2, await chainNow()))!;
  assert.equal(board.state, 'open');
  const byName = new Map(board.rows.map((r) => [r.name, r]));
  assert.deepEqual([byName.get('delta app')!.rank, byName.get('delta app')!.note], [1, 'Yes']);
  assert.deepEqual([byName.get('echo app')!.rank, byName.get('echo app')!.note], [null, 'No: submission not confirmed yet']);
  assert.deepEqual([byName.get('foxtrot app')!.rank, byName.get('foxtrot app')!.note], [null, 'Test entry: not ranked']);

  // ---- v2.6 5. The month ends: final reads, the freeze, the review, the payout ----
  await setTime((r2.ends.getTime() / 1000 - t0) / 3600 + 1);
  await mineDeep();
  const end2 = await cron(await chainNow(), scope2);
  assert.equal(end2.status, 200, JSON.stringify(end2.body));
  assert.equal(end2.body.bonus.rounds.rounds[0]?.step, 'review', JSON.stringify(end2.body.bonus.rounds));
  const [frozen2] = await sql()<{ review_until: Date; terms: { pool_wei: string; amounts: string[]; flagged: number[] } }[]>`
    SELECT review_until, terms FROM bonus_rounds WHERE round_key = ${ROUND2}`;
  assert.equal(frozen2.terms.pool_wei, POOL2.toString());
  assert.deepEqual(frozen2.terms.amounts, splitPool(POOL2, 1).map(String), 'one place: the whole pool');
  const ranked2 = await sql()<{ project_id: number }[]>`SELECT project_id FROM bonus_payouts WHERE round_key = ${ROUND2}`;
  assert.deepEqual(ranked2.map((r) => r.project_id), [ids2.delta], 'Echo (unconfirmed) and Foxtrot (test) are never ranked');
  const [{ scored }] = await sql()<{ scored: number }[]>`
    SELECT count(*)::int AS scored FROM bonus_scores WHERE round_key = ${ROUND2} AND project_id IN (${ids2.echo}, ${ids2.foxtrot})`;
  assert.equal(scored, 0, 'never scored');
  const fromBlock = (await pc.getBlock()).number;
  const pay2 = await cron(new Date(frozen2.review_until.getTime() + 3_600_000), scope2);
  assert.equal(pay2.status, 200, JSON.stringify(pay2.body));
  assert.equal(pay2.body.bonus.rounds.rounds[0]?.done, true, JSON.stringify(pay2.body.bonus.rounds));
  assert.deepEqual(pay2.body.needs_owner, [], 'nothing for the owner');
  assert.deepEqual(pay2.body.bonus.rounds.needs_owner, []);
  const transfers = await pc.getContractEvents({ address: weth, abi: erc20Abi, eventName: 'Transfer', fromBlock });
  const toBuilders = transfers.filter((t) => (Object.values(BUILDERS2) as { wallet: string }[]).some((b) => b.wallet === t.args.to?.toLowerCase()));
  assert.equal(toBuilders.length, 1, 'one WETH transfer');
  assert.equal(toBuilders[0].args.to!.toLowerCase(), BUILDERS2.delta.wallet, "to the confirmed entry's creator wallet");
  assert.equal(toBuilders[0].args.value, POOL2, 'the whole pool (splitPool(pool, 1))');
  assert.equal(await bal(BUILDERS2.echo.wallet), 0n);
  assert.equal(await bal(BUILDERS2.foxtrot.wallet), 0n, 'a test entry is never paid');
  assert.equal((await bal(SAFE)) - safe2Before, (3n * E18) / 10n, "the Safe gets its 30% of the fees only: no bonus money");

  // ---- v2.6 6. Echo confirms late: the same entry is updated (Ruling 23) ----
  // "Late" in chain time only: the database's now() (submission_proof_ok_at) follows the wall clock,
  // which is behind the advanced anvil clock, so this says nothing about eligibility for ROUND2;
  // the frozen round's payouts are what must not change.
  const projectsBefore = (await rows(PROG2)).size;
  const deploysNow = mock.deploys.length;
  const late = await submit2('echo', true);
  assert.equal(late.project_id, ids2.echo, 'the same entry');
  assert.equal(late.updated, true);
  assert.equal(late.token.status, 'launched', 'keeps its coin');
  assert.equal(mock.deploys.length, deploysNow, 'no second coin');
  p2 = await rows(PROG2);
  assert.equal(p2.size, projectsBefore, 'no second entry');
  assert.equal(p2.get(ids2.echo)!.submission_basis, 'confirmed');
  assert.ok(p2.get(ids2.echo)!.submission_proof_ok_at, 'counts from now on');
  assert.deepEqual(
    (await sql()<{ project_id: number }[]>`SELECT project_id FROM bonus_payouts WHERE round_key = ${ROUND2}`).map((r) => r.project_id),
    [ids2.delta],
    'a frozen round never changes',
  );

  // ---- v2.6 7. Delta's next list_programs opens with the bonus paid and its leaderboard ----
  const listed = (await tools.list_programs({}, { installationId: inst2.delta })) as { show_to_builder: string };
  assert.ok(listed.show_to_builder.startsWith('Since you last checked: you were paid a 0.20 ETH builder bonus (as WETH) for E2E Confirm Grants'), listed.show_to_builder);
  assert.ok(listed.show_to_builder.includes(`earnkit.com/bonus/${PROG2}-`), listed.show_to_builder);

  // ---- v2.6 8. A re-run signs nothing ----
  const nonce2 = await pc.getTransactionCount({ address: PAYOUT.address });
  for (const h of [2, 26]) {
    const again = await cron(new Date(frozen2.review_until.getTime() + h * 3_600_000), scope2);
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual(again.body.bonus.rounds.rounds, []);
  }
  assert.equal(await pc.getTransactionCount({ address: PAYOUT.address }), nonce2, 'no new transaction');
  assert.equal(await bal(BUILDERS2.delta.wallet), POOL2);
}

type CronBody = {
  needs_owner: string[];
  bonus_scoring?: { round: string; ranked?: number }[];
  proof_recheck?: { checked: number; passed: number };
  bonus: {
    index: { round: number; safe: number };
    collect: { coin: string; result: string }[];
    claim: { owner: string; result: string }[];
    rounds: { rounds: { round: string; step: string; done?: boolean; to_safe?: string }[]; needs_owner: string[] };
    sweep: { result: string; status?: string };
  };
};

/**
 * The GitHub API as traction.ts reads it. Alpha: three commits over the round (two authors),
 * one star; Beta: one commit, no stars. Every account is years old. Commits are listed up to the
 * read's `until`, so each read sees what existed by then.
 */
function githubMock(t0: number) {
  const at = (h: number) => new Date((t0 + h * 3600) * 1000).toISOString();
  const commits: Record<string, { sha: string; login: string; at: string }[]> = {
    't10-alpha': [
      { sha: 'a1', login: 't10-alice', at: at(0.5) },
      { sha: 'a2', login: 't10-alice', at: at(20) },
      { sha: 'a3', login: 't10-carol', at: at(30) },
    ],
    't10-beta': [{ sha: 'b1', login: 't10-bob', at: at(0.5) }],
    // v2.6: e2e-confirm's builders (only Delta is ever read: the others never qualify).
    't10-delta': [{ sha: 'd1', login: 't10-dave', at: at(0.5) }],
    't10-echo': [{ sha: 'e1', login: 't10-erin', at: at(0.5) }],
    't10-foxtrot': [{ sha: 'f1', login: 't10-fred', at: at(0.5) }],
  };
  return (path: string): unknown => {
    const u = new URL(path, 'https://api.github.com');
    const user = /^\/users\/([^/]+)$/.exec(u.pathname);
    if (user) return { login: user[1], created_at: '2019-01-01T00:00:00Z' };
    const m = /^\/repos\/([^/]+)\/app(\/commits|\/stargazers|\/forks)?$/.exec(u.pathname);
    if (!m || !commits[m[1]]) throw Object.assign(new Error('not found'), { status: 404 });
    const page = Number(u.searchParams.get('page') ?? '1');
    if (!m[2]) return { stargazers_count: m[1] === 't10-alpha' ? 1 : 0, owner: { login: m[1] } };
    if (page > 1) return [];
    if (m[2] === '/commits') {
      const until = Date.parse(u.searchParams.get('until')!);
      return commits[m[1]].filter((c) => Date.parse(c.at) <= until).map((c) => ({ sha: c.sha, author: { login: c.login } }));
    }
    if (m[2] === '/stargazers') return m[1] === 't10-alpha' ? [{ starred_at: at(2), user: { login: 't10-fan' } }] : [];
    return [];
  };
}
