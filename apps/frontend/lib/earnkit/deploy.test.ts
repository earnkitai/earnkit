import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Abi, Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sql } from './db';
import {
  DEPLOY_CAPS,
  DEPLOY_LINES,
  DEPLOY_PENDING,
  deployEnabled,
  deployForBuilder,
  deployRefusal,
  deployedLine,
  deployerAccount,
  keySeparate,
  type DeployChain,
  type DeployDeps,
  type DeployInput,
} from './deploy';
import { deployerGas } from './cron';
import { periodKey, takeFreeTier } from './free-tier';
import { contractDeployed } from './verify';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

// Anvil's well-known dev keys: never funded anywhere real.
const DEPLOYER_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const OTHER_KEY = '7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
const DEPLOYER = privateKeyToAccount(`0x${DEPLOYER_KEY}`).address;
const BUILDER = '0x1111111111111111111111111111111111111111' as Address;
const DEPLOYED = '0x00000000000000000000000000000000000d3910' as Address;

const OWNABLE: Abi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'transferOwnership', inputs: [{ name: 'o', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
];
const PLAIN: Abi = [{ type: 'function', name: 'tip', inputs: [], outputs: [], stateMutability: 'payable' }];
const CODE = `0x${'60'.repeat(200)}` as Hex;
const input = (o: Partial<DeployInput> = {}): DeployInput => ({ chain: 'base', bytecode: CODE, abi: OWNABLE, ...o });

// ---- 10.1 deployRefusal (pure)

test('10.1 deployRefusal: initcode over 48 KB, ERC-20 bytecode, a payable constructor; a normal contract is null', () => {
  const withArg: Abi = [{ type: 'constructor', inputs: [{ name: 'x', type: 'uint256' }], stateMutability: 'nonpayable' }];
  // 49,121 bytes of code plus a 32-byte argument: 49,153 bytes of initcode.
  const big = `0x${'00'.repeat(49_121)}` as Hex;
  assert.equal(deployRefusal({ chain: 'base', bytecode: big, abi: withArg, constructor_args: [1n] }), DEPLOY_LINES.tooBig);
  const fits = `0x${'00'.repeat(49_120)}` as Hex;
  assert.equal(deployRefusal({ chain: 'base', bytecode: fits, abi: withArg, constructor_args: [1n] }), null);
  const token = `0x6063a9059cbb63095ea7b3636318160ddd00` as Hex;
  assert.equal(deployRefusal(input({ bytecode: token })), DEPLOY_LINES.token);
  assert.equal(deployRefusal(input({ bytecode: `0x6063a9059cbb63095ea7b300` as Hex })), null, 'two of the three pass');
  const payable: Abi = [{ type: 'constructor', inputs: [], stateMutability: 'payable' }];
  assert.equal(deployRefusal(input({ abi: payable })), DEPLOY_LINES.payable);
  assert.equal(deployRefusal(input()), null);
  assert.equal(deployRefusal(input({ abi: PLAIN })), null, 'a payable function (not the constructor) is fine');
});

test('10.1 deployRefusal: bytecode that is not hex, or constructor args that do not fit the ABI, are refused', () => {
  assert.notEqual(deployRefusal(input({ bytecode: '0xzz' as Hex })), null);
  const withArg: Abi = [{ type: 'constructor', inputs: [{ name: 'x', type: 'uint256' }], stateMutability: 'nonpayable' }];
  assert.notEqual(deployRefusal({ chain: 'base', bytecode: CODE, abi: withArg, constructor_args: ['nope'] }), null);
});

test('10.1 deployedLine: the name, the chain and the short address; the owner sentence only when the builder owns it', () => {
  assert.equal(deployedLine('TipJar', 'arc', '0x12ab000000000000000000000000000000009f3e', true), "TipJar is deployed on Arc: 0x12ab…9f3e. You're the owner.");
  assert.equal(deployedLine('TipJar', 'base', '0x12ab000000000000000000000000000000009f3e', false), 'TipJar is deployed on Base: 0x12ab…9f3e.');
  assert.deepEqual(DEPLOY_CAPS, { initcodeBytes: 49_152, runtimeBytes: 24_576, perDeployUsd: 0.25, monthMicroUsd: 10_000_000, dayTotal: 20, perBuilderChainDay: 1, perBuilder30d: 3 });
});

// ---- 10.2 the key

test('10.2 deployerAccount: off when unset; a malformed key throws naming its shape, never the key', () => {
  assert.equal(deployerAccount({}), null);
  assert.equal(deployerAccount({ DEPLOYER_PRIVATE_KEY: '  ' }), null);
  assert.equal(deployerAccount({ DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY })!.address, DEPLOYER);
  assert.equal(deployerAccount({ DEPLOYER_PRIVATE_KEY: `0x${DEPLOYER_KEY}` })!.address, DEPLOYER);
  const short = DEPLOYER_KEY.slice(0, 63);
  let msg = '';
  try {
    deployerAccount({ DEPLOYER_PRIVATE_KEY: short });
  } catch (e) {
    msg = (e as Error).message;
  }
  assert.match(msg, /DEPLOYER_PRIVATE_KEY/);
  assert.match(msg, /63 characters/);
  assert.ok(!msg.includes(short) && !msg.includes(short.slice(0, 20)), msg);
});

test('10.2 keySeparate and deployEnabled: the deployer key equal to the payout, operator or guardian key refuses to start', () => {
  for (const name of ['CAMPAIGN_PAYOUT_PRIVATE_KEY', 'PAYOUT_PRIVATE_KEY', 'OPERATOR_PRIVATE_KEY', 'GUARDIAN_PRIVATE_KEY'])
    for (const same of [DEPLOYER_KEY, `0x${DEPLOYER_KEY}`, ` ${DEPLOYER_KEY.toUpperCase()}\n`]) {
      const env = { DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY, [name]: same };
      assert.equal(keySeparate(DEPLOYER, env), false, `${name} ${same.length}`);
      assert.equal(deployEnabled(env), false, name);
    }
  const env = { DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY, CAMPAIGN_PAYOUT_PRIVATE_KEY: OTHER_KEY, OPERATOR_PRIVATE_KEY: 'bad' };
  assert.equal(keySeparate(DEPLOYER, env), true);
  assert.equal(deployEnabled(env), true);
  assert.equal(deployEnabled({}), false);
  assert.equal(deployEnabled({ DEPLOYER_PRIVATE_KEY: 'x'.repeat(64) }), false, 'a malformed key is off, never a throw');
});

// ---- The chain fake and the DB setup

type Calls = { estimate: number; send: { data: Hex; gas: bigint; maxFeePerGas: bigint; [k: string]: unknown }[]; writes: { fn: string; args: unknown[] }[]; reads: number; balance: number };
function fakeChain(o: {
  feeWei?: bigint;
  balance?: bigint;
  receipt?: 'success' | 'reverted' | null;
  code?: Hex;
  owner?: () => Address;
  afterTransfer?: Address;
  sendDelayMs?: number;
} = {}) {
  const calls: Calls = { estimate: 0, send: [], writes: [], reads: 0, balance: 0 };
  let owner = o.owner ?? (() => BUILDER);
  const chain: DeployChain = {
    estimate: async () => {
      calls.estimate++;
      return { gas: 100_000n, maxFeePerGas: o.feeWei ?? 100_000_000_000n }; // $0.01 at $1 a coin
    },
    balance: async () => {
      calls.balance++;
      return o.balance ?? 10n ** 18n;
    },
    send: async (a) => {
      calls.send.push(a as Calls['send'][number]);
      if (o.sendDelayMs) await new Promise((r) => setTimeout(r, o.sendDelayMs));
      return `0x${'ab'.repeat(32)}` as Hex;
    },
    receipt: async (hash) => {
      if (hash !== `0x${'ab'.repeat(32)}` && hash !== `0x${'cd'.repeat(32)}`) throw new Error('unknown hash');
      if (hash === `0x${'cd'.repeat(32)}`) return { status: 'success', contractAddress: null, gasUsed: 30_000n, effectiveGasPrice: 100_000_000_000n };
      const r = o.receipt === undefined ? 'success' : o.receipt;
      if (r === null) return null;
      return { status: r, contractAddress: r === 'success' ? DEPLOYED : null, gasUsed: 50_000n, effectiveGasPrice: 100_000_000_000n };
    },
    code: async () => o.code ?? (`0x${'60'.repeat(100)}` as Hex),
    read: async () => {
      calls.reads++;
      return owner();
    },
    write: async (a) => {
      calls.writes.push({ fn: a.fn, args: a.args });
      const next = o.afterTransfer;
      if (next) owner = () => next;
      return `0x${'cd'.repeat(32)}` as Hex;
    },
  };
  return { chain, calls };
}

let seq = 0;
/** A fresh installation, a repo it proved (a sign-in row unless `proof: false`), unique per test. */
async function setup(o: { proof?: boolean; shared?: boolean; login?: string } = {}) {
  const stamp = `${process.pid}-${Date.now()}-${seq++}`;
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client) VALUES (${`deploy-${stamp}`}, ${o.shared ?? false}) RETURNING id`;
  const repoKey = `alice${stamp}/tipjar`;
  if (o.proof !== false)
    await sql()`
      INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
      VALUES (${repoKey}, ${o.login ?? 'alice'}, ${id}, now(), 3, 'entry')`;
  return { installationId: id, repoKey };
}
// A day and month far from real time and from each other test's, so the global counters start at zero.
const farDay = () => new Date(Date.UTC(2100 + (seq % 50), Number(process.pid % 12), 1 + (seq++ % 27), 12));
const noProofLine = { owner: async () => ({ status: 'missing' as const }), latest: async () => null };

async function withDeployer<T>(fn: () => Promise<T>, extra: Record<string, string> = {}): Promise<T> {
  const names = ['DEPLOYER_PRIVATE_KEY', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', ...Object.keys(extra)];
  const old = names.map((n) => process.env[n]);
  process.env.DEPLOYER_PRIVATE_KEY = DEPLOYER_KEY;
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-secret';
  Object.assign(process.env, extra);
  try {
    return await fn();
  } finally {
    names.forEach((n, i) => (old[i] === undefined ? delete process.env[n] : (process.env[n] = old[i])));
  }
}
const deps = (chain: DeployChain, o: Partial<DeployDeps> = {}): DeployDeps => ({
  chain: () => chain,
  usdPerNative: async () => 1,
  now: farDay(),
  gate: noProofLine,
  receiptMs: 50,
  ...o,
});
const call = (s: { installationId: number; repoKey: string }, i: DeployInput = input(), login: string | null = null) => ({
  installationId: s.installationId,
  login,
  repoKey: s.repoKey,
  projectName: 'TipJar',
  builderWallet: BUILDER,
  input: i,
});
const rowsOf = (repoKey: string) =>
  sql()<{ id: number; status: string; owner_ok: boolean | null; address: string | null; cost_micro_usd: string; tx_hash: string; chain: string }[]>`
    SELECT id, status, owner_ok, address, cost_micro_usd::text, tx_hash, chain FROM contract_deploys WHERE repo_key = ${repoKey} ORDER BY id`;
const monthUsed = async (now: Date) => {
  const [r] = await sql()<{ used: number }[]>`
    SELECT used FROM free_tier_usage WHERE name = 'deployGasMonth' AND period = ${periodKey('month', now)}`;
  return r?.used ?? 0;
};
const flagged = async (now = new Date()) => (await deployerGas(now, { chain: () => null })).needs_owner;

// ---- 10.3 a happy deploy

test('10.3 a happy deploy on Base: one send with no value, the line, the row, and a cached getCode pass', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain();
    const d = deps(chain);
    const out = await deployForBuilder(call(s), d);
    assert.deepEqual(out, { status: 'deployed', address: DEPLOYED, owner_ok: true, show_to_builder: deployedLine('TipJar', 'base', DEPLOYED, true) });
    assert.equal(calls.send.length, 1);
    assert.ok(!('value' in calls.send[0]) && !('to' in calls.send[0]), 'no value and no recipient: a contract creation');
    assert.equal(calls.writes.length, 0, 'already the builder: no transferOwnership');
    const [row] = await rowsOf(s.repoKey);
    assert.equal(row.status, 'deployed');
    assert.equal(row.owner_ok, true);
    assert.equal(row.address, DEPLOYED.toLowerCase());
    assert.equal(row.tx_hash, `0x${'ab'.repeat(32)}`);
    assert.equal(row.cost_micro_usd, '5000', 'gasUsed × effectiveGasPrice at $1: $0.005');
    assert.equal(await monthUsed(d.now!), 5000, 'the reserve minus the give-back');
    assert.equal(await contractDeployed('base', DEPLOYED, { getCode: async () => { throw new Error('no RPC in this test'); } }), true);
  }),
);

test('10.3 a 25 KB runtime: the line says too big, owner_ok false, no getCode pass, and the cron flags it', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const addr = '0x00000000000000000000000000000000000b1600' as Address;
    const { chain } = fakeChain({ code: `0x${'60'.repeat(25 * 1024)}` as Hex });
    const big: DeployChain = { ...chain, receipt: async (h) => ({ ...(await chain.receipt(h, 1))!, contractAddress: addr }) };
    const out = await deployForBuilder(call(s), deps(big));
    assert.equal(out.show_to_builder, DEPLOY_LINES.tooBig);
    assert.notEqual(out.status, 'deployed');
    const [row] = await rowsOf(s.repoKey);
    assert.equal(row.owner_ok, false);
    const [cached] = await sql()`SELECT 1 FROM url_checks WHERE key = ${`getcode:base:${addr}`}`;
    assert.equal(cached, undefined);
    assert.ok((await flagged()).includes(`deploy-owner:${row.id}`));
  }),
);

// ---- 10.4 the owner step

test('10.4 owner() is the deployer: one transferOwnership(builder), then the builder owns it', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ owner: () => DEPLOYER, afterTransfer: BUILDER });
    const out = await deployForBuilder(call(s), deps(chain));
    assert.deepEqual(calls.writes, [{ fn: 'transferOwnership', args: [BUILDER] }]);
    assert.equal(out.status === 'deployed' && out.owner_ok, true);
    assert.match(out.show_to_builder, /You're the owner\.$/);
    assert.equal((await rowsOf(s.repoKey))[0].owner_ok, true);
  }),
);

test('10.4 still not the builder after the transfer: owner_ok false, no owner sentence, flagged for the owner', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ owner: () => DEPLOYER });
    const out = await deployForBuilder(call(s), deps(chain));
    assert.equal(calls.writes.length, 1);
    assert.equal(out.status === 'deployed' && out.owner_ok, false);
    assert.doesNotMatch(out.show_to_builder, /owner/);
    const [row] = await rowsOf(s.repoKey);
    assert.equal(row.owner_ok, false);
    assert.ok((await flagged()).includes(`deploy-owner:${row.id}`));
  }),
);

test('10.4 an ABI with no owner(): no read, no write, owner_ok null', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain();
    const out = await deployForBuilder(call(s, input({ abi: PLAIN })), deps(chain));
    assert.equal(calls.reads, 0);
    assert.equal(calls.writes.length, 0);
    assert.equal(out.status === 'deployed' && out.owner_ok, null);
    assert.equal(out.show_to_builder, deployedLine('TipJar', 'base', DEPLOYED, false));
    assert.equal((await rowsOf(s.repoKey))[0].owner_ok, null);
  }),
);

// ---- 10.5 ownership (R19, G7, G10)

test('10.5 a repo with no proof: notYours, nothing estimated', dbTest, () =>
  withDeployer(async () => {
    const s = await setup({ proof: false });
    const { chain, calls } = fakeChain();
    const out = await deployForBuilder(call(s), deps(chain));
    assert.deepEqual(out, { status: 'refused', show_to_builder: DEPLOY_LINES.notYours });
    assert.equal(calls.estimate, 0);
    assert.equal((await rowsOf(s.repoKey)).length, 0);
  }),
);

test("10.5 a shared client: no signed_in login is notYours even when another login verified the repo; that login's call passes", dbTest, () =>
  withDeployer(async () => {
    const bobLogin = `bob${process.pid}x${Date.now()}`; // the day limit is keyed by login: one per run
    const s = await setup({ shared: true, login: bobLogin });
    const { chain, calls } = fakeChain();
    const out = await deployForBuilder(call(s), deps(chain));
    assert.equal(out.show_to_builder, DEPLOY_LINES.notYours);
    assert.equal((await deployForBuilder(call(s, input(), 'carol'), deps(chain))).show_to_builder, DEPLOY_LINES.notYours, "another login's call");
    assert.equal(calls.estimate, 0);
    const bob = await deployForBuilder(call(s, input(), bobLogin), deps(chain));
    assert.equal(bob.status, 'deployed');
  }),
);

test('10.5 the proof line in earnkit.txt proves the repo on a non-shared client (no sign-in row)', dbTest, () =>
  withDeployer(async () => {
    const s = await setup({ proof: false });
    const { tokenLineFor } = await import('./token-gate');
    const line = tokenLineFor(s.installationId, `https://github.com/${s.repoKey}`);
    assert.ok(line, 'EARNKIT_AUTH_SECRET set for the test');
    const { chain } = fakeChain();
    const out = await deployForBuilder(call(s), deps(chain, { gate: { owner: async () => ({ status: 'ok' as const, text: `${line}\n` }), latest: async () => null } }));
    assert.equal(out.status, 'deployed');
  }, { EARNKIT_AUTH_SECRET: 'deploy-test-secret' }),
);

// ---- 10.6 limits

test('10.6 a second deploy the same day on the same chain is limited; the other chain is not', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain();
    const d = deps(chain);
    assert.equal((await deployForBuilder(call(s), d)).status, 'deployed');
    assert.deepEqual(await deployForBuilder(call(s), d), { status: 'refused', show_to_builder: DEPLOY_LINES.limit });
    assert.equal((await deployForBuilder(call(s, input({ chain: 'arc' })), d)).status, 'deployed');
    assert.equal(calls.send.length, 2);
  }),
);

test('10.6 a fourth deploy in 30 days across chains is limited', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    for (const days of [3, 10, 29])
      await sql()`
        INSERT INTO contract_deploys (installation_id, login, repo_key, chain, tx_hash, status, cost_micro_usd, created_at)
        VALUES (${s.installationId}, NULL, ${s.repoKey}, 'arc', '0x01', 'deployed', 1, now() - make_interval(days => ${days}))`;
    const { chain, calls } = fakeChain();
    assert.deepEqual(await deployForBuilder(call(s), deps(chain)), { status: 'refused', show_to_builder: DEPLOY_LINES.limit });
    assert.equal(calls.estimate, 0);
    // One of the three is 31 days old: the deploy goes.
    await sql()`UPDATE contract_deploys SET created_at = now() - interval '31 days' WHERE repo_key = ${s.repoKey} AND created_at < now() - interval '28 days'`;
    assert.equal((await deployForBuilder(call(s, input({ chain: 'arc' })), deps(chain))).status, 'deployed');
  }),
);

test('10.6 the 21st deploy of the day across builders is dayFull; an estimate worth $0.26 is high, nothing sent', dbTest, () =>
  withDeployer(async () => {
    const now = farDay();
    assert.equal(await takeFreeTier('deploysDay', 20, now), true);
    const { chain, calls } = fakeChain();
    const s = await setup();
    assert.deepEqual(await deployForBuilder(call(s), deps(chain, { now })), { status: 'refused', show_to_builder: DEPLOY_LINES.dayFull });
    assert.equal(calls.estimate, 0);
    assert.equal((await rowsOf(s.repoKey)).length, 0, 'the reservation is released');
    const s2 = await setup();
    const pricey = fakeChain({ feeWei: 2_600_000_000_000n }); // 100,000 gas × 2.6e12 = 0.26 at $1
    const high = await deployForBuilder(call(s2), deps(pricey.chain));
    assert.equal(high.status, 'refused');
    assert.equal(high.show_to_builder, DEPLOY_LINES.high);
    assert.equal(pricey.calls.send.length, 0);
    assert.equal((await rowsOf(s2.repoKey)).length, 0);
  }),
);

// ---- 10.7 the month ceiling

test('10.7 the month counter at $9.95 with an upper bound worth $0.10: paused, nothing sent', dbTest, () =>
  withDeployer(async () => {
    const now = farDay();
    assert.equal(await takeFreeTier('deployGasMonth', 9_950_000, now), true);
    const s = await setup();
    const { chain, calls } = fakeChain({ feeWei: 1_000_000_000_000n }); // $0.10
    assert.deepEqual(await deployForBuilder(call(s), deps(chain, { now })), { status: 'refused', show_to_builder: DEPLOY_LINES.paused });
    assert.equal(calls.send.length, 0);
    assert.equal(await monthUsed(now), 9_950_000, 'unchanged');
    const [day] = await sql()<{ used: number }[]>`SELECT used FROM free_tier_usage WHERE name = 'deploysDay' AND period = ${periodKey('day', now)}`;
    assert.equal(day?.used ?? 0, 0, "the day's slot is given back");
  }),
);

// ---- 10.8 the race

test('10.8 two deploys for one builder and chain started together: exactly one send', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ sendDelayMs: 20 });
    const d = deps(chain);
    const outs = await Promise.all([deployForBuilder(call(s), d), deployForBuilder(call(s), d)]);
    assert.equal(calls.send.length, 1);
    assert.deepEqual(outs.map((o) => o.status).sort(), ['deployed', 'refused']);
  }),
);

test('10.8 two deploys for one builder on both chains at 2 of 3 in 30 days: exactly one send', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    for (const days of [3, 10])
      await sql()`
        INSERT INTO contract_deploys (installation_id, login, repo_key, chain, tx_hash, status, cost_micro_usd, created_at)
        VALUES (${s.installationId}, NULL, ${s.repoKey}, 'arc', '0x01', 'deployed', 1, now() - make_interval(days => ${days}))`;
    const { chain, calls } = fakeChain({ sendDelayMs: 20 });
    const d = deps(chain);
    await Promise.all([deployForBuilder(call(s), d), deployForBuilder(call(s, input({ chain: 'arc' })), d)]);
    assert.equal(calls.send.length, 1);
  }),
);

// ---- 10.9 reverted and unknown receipts

test('10.9 a reverted receipt: failed, the gas still counted, no transferOwnership', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ receipt: 'reverted', owner: () => DEPLOYER });
    const d = deps(chain);
    const out = await deployForBuilder(call(s), d);
    assert.equal(out.status, 'failed');
    assert.equal(out.show_to_builder, DEPLOY_LINES.failed);
    assert.equal(calls.writes.length, 0);
    const [row] = await rowsOf(s.repoKey);
    assert.equal(row.status, 'reverted');
    assert.equal(row.cost_micro_usd, '5000');
    assert.equal(await monthUsed(d.now!), 5000);
  }),
);

test('10.9 no receipt within the budget: unknown, "still going", flagged; a retry does not send again', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ receipt: null });
    const d = deps(chain);
    const out = await deployForBuilder(call(s), d);
    assert.equal(out.status, 'failed');
    assert.equal(out.show_to_builder, DEPLOY_PENDING);
    assert.match((out as { agent_note?: string }).agent_note ?? '', /0xabab/);
    const [row] = await rowsOf(s.repoKey);
    assert.equal(row.status, 'unknown');
    assert.equal(await monthUsed(d.now!), 10_000, 'the whole reserve stays counted');
    assert.ok((await flagged()).includes(`deploy-unknown:${row.id}`));
    const again = await deployForBuilder(call(s), d);
    assert.equal(again.show_to_builder, DEPLOY_LINES.limit);
    assert.equal(calls.send.length, 1);
  }),
);

// ---- 10.10 the price and the balance

test('10.10 the price read fails: refused before sending (R18)', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain();
    const out = await deployForBuilder(call(s), deps(chain, { usdPerNative: async () => { throw new Error('DefiLlama down'); } }));
    assert.equal(out.status, 'unavailable');
    assert.equal(calls.send.length, 0);
    assert.equal((await rowsOf(s.repoKey)).length, 0);
  }),
);

test('10.10 a balance under the upper bound: refused, and deployerGas reports TOP_UP for that chain', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ balance: 10n ** 15n }); // $0.001, under the $0.01 bound
    const out = await deployForBuilder(call(s), deps(chain));
    assert.deepEqual(out, { status: 'unavailable', show_to_builder: DEPLOY_LINES.lowBalance, agent_note: 'The deployer wallet on Base needs a top-up; the owner is told.' });
    assert.equal(calls.send.length, 0);
    const gas = await deployerGas(new Date(), { chain: (c) => (c === 'base' ? chain : null), usdPerNative: async () => 1 });
    assert.ok(gas.needs_owner.includes('deployer-gas:base'));
    assert.equal((gas.deployer_gas.base as { note?: string }).note, 'TOP_UP');
  }),
);

test('deployForBuilder is off without the key: nothing read', async () => {
  const old = process.env.DEPLOYER_PRIVATE_KEY;
  delete process.env.DEPLOYER_PRIVATE_KEY;
  try {
    const { chain, calls } = fakeChain();
    const out = await deployForBuilder(call({ installationId: 1, repoKey: 'a/b' }), deps(chain));
    assert.deepEqual(out, { status: 'unavailable', show_to_builder: DEPLOY_LINES.off });
    assert.equal(calls.estimate + calls.balance, 0);
  } finally {
    if (old !== undefined) process.env.DEPLOYER_PRIVATE_KEY = old;
  }
});
