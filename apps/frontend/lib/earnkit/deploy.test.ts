import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Abi, Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sql } from './db';
import {
  DEPLOY_CAPS,
  DEPLOY_LINES,
  DEPLOY_PENDING,
  DEPLOY_UNCONFIRMED,
  TRANSFER_GAS,
  deployEnabled,
  deployForBuilder,
  deployRefusal,
  deployedLine,
  deployerAccount,
  keySeparate,
  runtimeRefusal,
  type DeployChain,
  type DeployDeps,
  type DeployInput,
} from './deploy';
import { QUIET_OWNER, cronPost, deployerGas } from './cron';
import { forceFreeTier, periodKey, takeFreeTier } from './free-tier';
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

// ---- Fix round 1 (I4): the simulated runtime

test('fix round 1 (I4) runtimeRefusal: over 24 KB, ERC-20 selectors, CREATE or CREATE2 opcodes; push data and metadata do not count', () => {
  assert.equal(runtimeRefusal(`0x${'60'.repeat(100)}` as Hex), null);
  assert.equal(runtimeRefusal(`0x${'5b'.repeat(24_577)}` as Hex), DEPLOY_LINES.tooBig);
  assert.equal(runtimeRefusal(`0x63a9059cbb63095ea7b36318160ddd00` as Hex), DEPLOY_LINES.token);
  assert.equal(runtimeRefusal('0x600060006000f500' as Hex), DEPLOY_LINES.factory, 'CREATE2');
  assert.equal(runtimeRefusal('0x600060006000f000' as Hex), DEPLOY_LINES.factory, 'CREATE');
  assert.equal(runtimeRefusal('0x61f5f000' as Hex), null, 'f5 and f0 inside PUSH2 data');
  // Solidity metadata: a CBOR map (0xa1..) at the end, its length in the last 2 bytes.
  assert.equal(runtimeRefusal('0x6000fea1f5f0f50004' as Hex), null, 'f0/f5 inside the metadata');
});

// ---- The chain fake and the DB setup

type Calls = {
  estimate: number;
  simulate: number;
  send: { data: Hex; gas: bigint; maxFeePerGas: bigint; [k: string]: unknown }[];
  writes: { fn: string; args: unknown[]; gas: bigint; maxFeePerGas: bigint; abi: Abi }[];
  reads: { fn: string; args?: unknown[] }[];
  balance: number;
};
const HASH = `0x${'ab'.repeat(32)}` as Hex;
const TX2 = `0x${'cd'.repeat(32)}` as Hex;
function fakeChain(o: {
  feeWei?: bigint;
  balance?: bigint;
  l1Fee?: bigint;
  receipt?: 'success' | 'reverted' | null;
  receiptGas?: bigint;
  receiptL1?: bigint;
  runtime?: Hex;
  code?: Hex;
  owner?: () => Address | null;
  admin?: boolean | null;
  probeThrows?: boolean;
  afterTransfer?: Address;
  sendDelayMs?: number;
  hash?: Hex;
} = {}) {
  const calls: Calls = { estimate: 0, simulate: 0, send: [], writes: [], reads: [], balance: 0 };
  let owner = o.owner ?? (() => BUILDER);
  const fee = o.feeWei ?? 100_000_000_000n;
  const chain: DeployChain = {
    estimate: async () => {
      calls.estimate++;
      // $0.01 for the deploy and $0.01 for the transfer cap at $1 a coin.
      return { gas: 100_000n, maxFeePerGas: fee, ...(o.l1Fee !== undefined && { l1Fee: o.l1Fee }) };
    },
    simulate: async () => {
      calls.simulate++;
      return o.runtime ?? (`0x${'60'.repeat(100)}` as Hex);
    },
    balance: async () => {
      calls.balance++;
      return o.balance ?? 10n ** 18n;
    },
    send: async (a) => {
      calls.send.push(a as Calls['send'][number]);
      if (o.sendDelayMs) await new Promise((r) => setTimeout(r, o.sendDelayMs));
      return o.hash ?? HASH;
    },
    receipt: async (hash) => {
      if (hash === TX2) return { status: 'success', contractAddress: null, gasUsed: 30_000n, effectiveGasPrice: fee };
      const r = o.receipt === undefined ? 'success' : o.receipt;
      if (r === null) return null;
      return {
        status: r,
        contractAddress: r === 'success' ? DEPLOYED : null,
        gasUsed: o.receiptGas ?? 50_000n,
        effectiveGasPrice: 100_000_000_000n,
        l1Fee: o.receiptL1 ?? null,
      };
    },
    code: async () => o.code ?? (`0x${'60'.repeat(100)}` as Hex),
    read: async (a) => {
      calls.reads.push({ fn: a.fn, args: a.args });
      if (o.probeThrows) throw new Error('rpc down');
      if (a.fn === 'owner') return owner();
      if (a.fn === 'hasRole') return o.admin ?? null;
      throw new Error(`unexpected read ${a.fn}`);
    },
    write: async (a) => {
      calls.writes.push({ fn: a.fn, args: a.args, gas: a.gas, maxFeePerGas: a.maxFeePerGas, abi: a.abi });
      const next = o.afterTransfer;
      if (next) owner = () => next;
      return TX2;
    },
  };
  return { chain, calls };
}

let seq = 0;
const proofRow = (installationId: number, repoKey: string, login = 'alice') => sql()`
  INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
  VALUES (${repoKey}, ${login}, ${installationId}, now(), 3, 'entry')`;
/** A fresh installation, a repo it proved (a sign-in row unless `proof: false`), unique per test. */
async function setup(o: { proof?: boolean; shared?: boolean; login?: string } = {}) {
  const stamp = `${process.pid}-${Date.now()}-${seq++}`;
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client) VALUES (${`deploy-${stamp}`}, ${o.shared ?? false}) RETURNING id`;
  const repoKey = `alice${stamp}/tipjar`;
  if (o.proof !== false) await proofRow(id, repoKey, o.login);
  return { installationId: id, repoKey, shared: o.shared ?? false };
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
const call = (
  s: { installationId: number; repoKey: string; shared?: boolean },
  i: DeployInput = input(),
  login: string | null = null,
) => ({
  installationId: s.installationId,
  login,
  shared: s.shared ?? false,
  repoKey: s.repoKey,
  projectName: 'TipJar',
  builderWallet: BUILDER,
  input: i,
});
const rowsOf = (repoKey: string) =>
  sql()<{ id: number; status: string; owner_ok: boolean | null; address: string | null; cost_micro_usd: string; tx_hash: string; chain: string; builder_key: string }[]>`
    SELECT id, status, owner_ok, address, cost_micro_usd::text, tx_hash, chain, builder_key FROM contract_deploys WHERE repo_key = ${repoKey} ORDER BY id`;
const monthUsed = async (now: Date) => {
  const [r] = await sql()<{ used: number }[]>`
    SELECT used FROM free_tier_usage WHERE name = 'deployGasMonth' AND period = ${periodKey('month', now)}`;
  return r?.used ?? 0;
};
const flagged = async (now = new Date()) => (await deployerGas(now, { chain: () => null })).needs_owner;
const pastRows = (s: { installationId: number; repoKey: string }, days: number[]) =>
  Promise.all(
    days.map(
      (d) => sql()`
        INSERT INTO contract_deploys (installation_id, login, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd, created_at)
        VALUES (${s.installationId}, NULL, ${`installation:${s.installationId}`}, ${s.repoKey}, 'arc', '0x01', 'deployed', 1, now() - make_interval(days => ${d}))`,
    ),
  );

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
    assert.equal(row.tx_hash, HASH);
    assert.equal(row.cost_micro_usd, '5000', 'gasUsed × effectiveGasPrice at $1: $0.005');
    assert.equal(await monthUsed(d.now!), 5000, 'the reserve minus the give-back');
    assert.equal(await contractDeployed('base', DEPLOYED, { getCode: async () => { throw new Error('no RPC in this test'); } }), true);
  }),
);

test('10.3, I4: a 25 KB runtime from the simulation is too big before anything is sent', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ runtime: `0x${'60'.repeat(25 * 1024)}` as Hex });
    const out = await deployForBuilder(call(s), deps(chain));
    assert.deepEqual(out, { status: 'refused', show_to_builder: DEPLOY_LINES.tooBig });
    assert.equal(calls.send.length, 0);
    assert.equal((await rowsOf(s.repoKey)).length, 0);
  }),
);

test('10.3: stored code that differs from the simulation (too big): owner_ok false, no getCode pass, flagged', dbTest, () =>
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

test('fix round 1 (I4): a runtime with the ERC-20 selectors or CREATE2, from clean initcode, is refused before sending', dbTest, () =>
  withDeployer(async () => {
    for (const [runtime, line] of [
      ['0x63a9059cbb63095ea7b36318160ddd00', DEPLOY_LINES.token],
      ['0x600060006000f500', DEPLOY_LINES.factory],
    ] as const) {
      const s = await setup();
      const { chain, calls } = fakeChain({ runtime: runtime as Hex });
      assert.deepEqual(await deployForBuilder(call(s), deps(chain)), { status: 'refused', show_to_builder: line });
      assert.equal(calls.send.length, 0);
    }
  }),
);

// ---- 10.4 the owner step (fix round 1 I5: raw probes, never the builder's ABI)

test('10.4 owner() is the deployer: one capped transferOwnership(builder), then the builder owns it', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const d = deps(fakeChain().chain);
    const { chain, calls } = fakeChain({ owner: () => DEPLOYER, afterTransfer: BUILDER });
    const out = await deployForBuilder(call(s), { ...d, chain: () => chain });
    assert.deepEqual(calls.writes.map((w) => [w.fn, w.args, w.gas, w.maxFeePerGas]), [['transferOwnership', [BUILDER], TRANSFER_GAS, 100_000_000_000n]]);
    assert.equal(out.status === 'deployed' && out.owner_ok, true);
    assert.match(out.show_to_builder, /You're the owner\.$/);
    const [row] = await rowsOf(s.repoKey);
    assert.equal(row.owner_ok, true);
    assert.equal(row.cost_micro_usd, '8000', 'the deploy (5,000) and the transfer (3,000)');
    assert.equal(await monthUsed(d.now!), 8000);
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

test('10.4, I5: no owner() and no hasRole on the contract: owner_ok null, no write', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ owner: () => null, admin: null });
    const out = await deployForBuilder(call(s, input({ abi: PLAIN })), deps(chain));
    assert.equal(calls.writes.length, 0);
    assert.equal(out.status === 'deployed' && out.owner_ok, null);
    assert.equal(out.show_to_builder, deployedLine('TipJar', 'base', DEPLOYED, false));
    assert.equal((await rowsOf(s.repoKey))[0].owner_ok, null);
  }),
);

test('fix round 1 (I5): an ABI without owner() still gets the raw probe; Ownable(deployer) is transferred', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ owner: () => DEPLOYER, afterTransfer: BUILDER });
    const out = await deployForBuilder(call(s, input({ abi: PLAIN })), deps(chain));
    assert.deepEqual(calls.reads.map((r) => r.fn), ['owner', 'owner', 'hasRole']);
    assert.equal(calls.writes.length, 1);
    assert.ok(calls.writes[0].abi.some((x) => x.type === 'function' && x.name === 'transferOwnership'), 'our own ABI, not the builder one');
    assert.equal(out.status === 'deployed' && out.owner_ok, true);
  }),
);

test('fix round 1 (I5): AccessControl with the deployer as admin, or a probe that fails: owner_ok false and flagged', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ owner: () => null, admin: true });
    const out = await deployForBuilder(call(s, input({ abi: PLAIN })), deps(chain));
    assert.deepEqual(calls.reads.at(-1), { fn: 'hasRole', args: [`0x${'00'.repeat(32)}`, DEPLOYER] });
    assert.equal(out.status === 'deployed' && out.owner_ok, false);
    const [row] = await rowsOf(s.repoKey);
    assert.ok((await flagged()).includes(`deploy-owner:${row.id}`));
    const s2 = await setup();
    const failing = fakeChain({ probeThrows: true });
    const out2 = await deployForBuilder(call(s2), deps(failing.chain));
    assert.equal(out2.status === 'deployed' && out2.owner_ok, false);
    assert.doesNotMatch(out2.show_to_builder, /owner/);
  }),
);

// ---- 10.5 ownership (R19, G7, G10)

test('10.5 a repo with no proof: notYours, nothing estimated', dbTest, () =>
  withDeployer(async () => {
    const s = await setup({ proof: false });
    const { chain, calls } = fakeChain();
    const out = await deployForBuilder(call(s), deps(chain));
    assert.deepEqual(out, { status: 'refused', show_to_builder: DEPLOY_LINES.notYours });
    assert.equal(calls.estimate + calls.simulate, 0);
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
    assert.equal((await rowsOf(s.repoKey))[0].builder_key, bobLogin.toLowerCase());
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

test('fix round 1 (I6): off a shared client the limits are per installation (or its login), never per repo', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const other = { ...s, repoKey: `${s.repoKey}-two` };
    await proofRow(s.installationId, other.repoKey);
    const { chain, calls } = fakeChain();
    const d = deps(chain);
    assert.equal((await deployForBuilder(call(s), d)).status, 'deployed');
    assert.deepEqual(await deployForBuilder(call(other), d), { status: 'refused', show_to_builder: DEPLOY_LINES.limit }, 'another repo, same builder, same chain and day');
    assert.equal(calls.send.length, 1);
    assert.equal((await rowsOf(s.repoKey))[0].builder_key, `installation:${s.installationId}`);
    // With the installation's verified login, the login is the key.
    const s2 = await setup();
    const login = `dana${process.pid}x${Date.now()}`;
    assert.equal((await deployForBuilder(call(s2, input(), login), d)).status, 'deployed');
    assert.equal((await rowsOf(s2.repoKey))[0].builder_key, login);
  }),
);

test('10.6 a fourth deploy in 30 days across chains is limited', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    await pastRows(s, [3, 10, 29]);
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
    const pricey = fakeChain({ feeWei: 1_300_000_000_000n }); // (100,000 + 100,000) gas × 1.3e12 = 0.26 at $1
    const high = await deployForBuilder(call(s2), deps(pricey.chain));
    assert.equal(high.status, 'refused');
    assert.equal(high.show_to_builder, DEPLOY_LINES.high);
    assert.equal(pricey.calls.send.length, 0);
    assert.equal((await rowsOf(s2.repoKey)).length, 0);
  }),
);

// ---- Fix round 1 (C1): the transfer is capped and reserved with the deploy

test('fix round 1 (C1): a deploy under $0.25 whose capped transfer takes it over is refused before sending', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    // The deploy alone: 100,000 × 1.3e12 = $0.13; with the 100,000-gas transfer cap: $0.26.
    const { chain, calls } = fakeChain({ feeWei: 1_300_000_000_000n });
    assert.deepEqual(await deployForBuilder(call(s), deps(chain)), { status: 'refused', show_to_builder: DEPLOY_LINES.high });
    assert.equal(calls.send.length, 0);
    // The balance check covers the transfer too: enough for the deploy alone is not enough.
    const s2 = await setup();
    const thin = fakeChain({ balance: 15_000_000_000_000_000n }); // 0.015: the deploy (0.01) fits, deploy + transfer (0.02) doesn't
    assert.equal((await deployForBuilder(call(s2), deps(thin.chain))).show_to_builder, DEPLOY_LINES.lowBalance);
    assert.equal(thin.calls.send.length, 0);
  }),
);

test('fix round 1 (C1): a cost over the reserve is always counted, even past the ceiling, and the next deploy is paused', dbTest, () =>
  withDeployer(async () => {
    const now = farDay();
    assert.equal(await takeFreeTier('deployGasMonth', 9_970_000, now), true);
    const s = await setup();
    // Reserve 20,000; the receipt says 400,000 gas: 40,000 micro-USD.
    const { chain } = fakeChain({ receiptGas: 400_000n });
    assert.equal((await deployForBuilder(call(s), deps(chain, { now }))).status, 'deployed');
    assert.equal(await monthUsed(now), 10_010_000, 'over the $10 ceiling: the overage is counted');
    const s2 = await setup();
    assert.deepEqual(await deployForBuilder(call(s2), deps(fakeChain().chain, { now })), { status: 'refused', show_to_builder: DEPLOY_LINES.paused });
    await forceFreeTier('deployGasMonth', 0, now); // a no-op
    assert.equal(await monthUsed(now), 10_010_000);
  }),
);

// ---- Fix round 1 (I2): Base's L1 data fee

test("fix round 1 (I2): Base's L1 data fee is in the upper bound (twice the estimate) and in the receipt's cost", dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const d = deps(fakeChain().chain);
    // Upper: 0.02 + 2 × 0.005 = 0.03; the receipt: 0.005 gas + 0.001 L1.
    const { chain } = fakeChain({ l1Fee: 5_000_000_000_000_000n, receiptL1: 1_000_000_000_000_000n });
    assert.equal((await deployForBuilder(call(s), { ...d, chain: () => chain })).status, 'deployed');
    assert.equal((await rowsOf(s.repoKey))[0].cost_micro_usd, '6000');
    assert.equal(await monthUsed(d.now!), 6000);
    // An L1 fee that takes the bound over $0.25 refuses: 0.02 + 2 × 0.12 = 0.26.
    const s2 = await setup();
    const l1 = fakeChain({ l1Fee: 120_000_000_000_000_000n });
    assert.equal((await deployForBuilder(call(s2), deps(l1.chain))).show_to_builder, DEPLOY_LINES.high);
    assert.equal(l1.calls.send.length, 0);
  }),
);

// ---- 10.7 the month ceiling

test('10.7 the month counter at $9.95 with an upper bound worth $0.10: paused, nothing sent', dbTest, () =>
  withDeployer(async () => {
    const now = farDay();
    assert.equal(await takeFreeTier('deployGasMonth', 9_950_000, now), true);
    const s = await setup();
    const { chain, calls } = fakeChain({ feeWei: 500_000_000_000n }); // (100,000 + 100,000) × 5e11 = $0.10
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
    await pastRows(s, [3, 10]);
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
    assert.equal(await monthUsed(d.now!), 20_000, 'the whole reserve stays counted');
    assert.ok((await flagged()).includes(`deploy-unknown:${row.id}`));
    const again = await deployForBuilder(call(s), d);
    assert.equal(again.show_to_builder, DEPLOY_LINES.limit);
    assert.equal(calls.send.length, 1);
  }),
);

test('fix round 1 (I3, M1): a DB error after the send never deletes the row or gives anything back; a send that throws reads "couldn\'t confirm"', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    // A hash Postgres can't store (a NUL byte): the UPDATE after the send throws.
    const { chain, calls } = fakeChain({ hash: '0x\u0000' as Hex });
    const d = deps(chain);
    const out = await deployForBuilder(call(s), d);
    assert.equal(calls.send.length, 1);
    assert.equal(out.show_to_builder, DEPLOY_PENDING);
    const [row] = await rowsOf(s.repoKey);
    assert.equal(row?.status, 'unknown', 'the row is kept and flagged');
    assert.equal(await monthUsed(d.now!), 20_000, 'the reserve is kept');
    const [day] = await sql()<{ used: number }[]>`SELECT used FROM free_tier_usage WHERE name = 'deploysDay' AND period = ${periodKey('day', d.now!)}`;
    assert.equal(day.used, 1, "the day's slot is kept");
    const s2 = await setup();
    const throwing: DeployChain = { ...fakeChain().chain, send: async () => { throw new Error('nonce too low'); } };
    const out2 = await deployForBuilder(call(s2), deps(throwing));
    assert.equal(out2.show_to_builder, DEPLOY_UNCONFIRMED);
    assert.equal((await rowsOf(s2.repoKey))[0].status, 'unknown');
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

test('fix round 1 (M6): a big deploy priced under 100 micro-USD (wrong decimals) is refused', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const odd: DeployChain = { ...fakeChain().chain, estimate: async () => ({ gas: 2_000_000n, maxFeePerGas: 1n }) };
    const out = await deployForBuilder(call(s, input({ chain: 'arc' })), deps(odd));
    assert.equal(out.status, 'unavailable');
    assert.equal((await rowsOf(s.repoKey)).length, 0);
  }),
);

test('10.10 a balance under the upper bound: refused, and deployerGas reports TOP_UP for that chain; a failed price is PRICE_UNKNOWN (M3)', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ balance: 10n ** 15n }); // $0.001, under the $0.02 bound
    const out = await deployForBuilder(call(s), deps(chain));
    assert.deepEqual(out, { status: 'unavailable', show_to_builder: DEPLOY_LINES.lowBalance, agent_note: 'The deployer wallet on Base needs a top-up; the owner is told.' });
    assert.equal(calls.send.length, 0);
    const gas = await deployerGas(new Date(), { chain: (c) => (c === 'base' ? chain : null), usdPerNative: async () => 1 });
    assert.ok(gas.needs_owner.includes('deployer-gas:base'));
    assert.equal((gas.deployer_gas.base as { note?: string }).note, 'TOP_UP');
    const noPrice = await deployerGas(new Date(), { chain: (c) => (c === 'base' ? chain : null), usdPerNative: async () => { throw new Error('down'); } });
    assert.ok(noPrice.needs_owner.includes('deployer-price:base'));
    assert.ok(!noPrice.needs_owner.includes('deployer-gas:base'));
    assert.equal((noPrice.deployer_gas.base as { note?: string }).note, 'PRICE_UNKNOWN');
  }),
);

// ---- Ruling H11: a deploy flag alerts for 24 hours, then stays listed quietly

test('fix round 1 (I1, H11): a deploy flag under 24 h old is a 503; over 24 h it is a quiet line and the cron answers 200', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, status, owner_ok, cost_micro_usd, created_at)
      VALUES (${s.installationId}, 'x', ${s.repoKey}, 'base', '0x01', 'deployed', false, 1, now() - interval '25 hours') RETURNING id`;
    const lines = await flagged();
    assert.ok(lines.includes(`deploy-owner:${id}${QUIET_OWNER}`));
    assert.ok(!lines.includes(`deploy-owner:${id}`));
    assert.ok((await flagged(new Date(Date.now() - 2 * 3_600_000))).includes(`deploy-owner:${id}`), 'at 23 hours old it alerts');
    process.env.CRON_SECRET = 'cron-test-secret-0123456789abcdef0123';
    const post = (needs_owner: string[]) =>
      cronPost(new Request('http://x/api/cron', { method: 'POST', headers: { authorization: 'Bearer cron-test-secret-0123456789abcdef0123' } }), {
        limit: async () => undefined,
        run: async () => ({ needs_owner }),
      });
    assert.equal((await post([`deploy-owner:${id}${QUIET_OWNER}`])).status, 200);
    assert.equal((await post([`deploy-owner:${id}`])).status, 503);
    assert.equal((await post([`deploy-owner:${id}${QUIET_OWNER}`, 'deployer-gas:base'])).status, 503);
  }, { CRON_SECRET: '' }),
);

test('deployForBuilder is off without the key: nothing read', async () => {
  const old = process.env.DEPLOYER_PRIVATE_KEY;
  delete process.env.DEPLOYER_PRIVATE_KEY;
  try {
    const { chain, calls } = fakeChain();
    const out = await deployForBuilder(call({ installationId: 1, repoKey: 'a/b' }), deps(chain));
    assert.deepEqual(out, { status: 'unavailable', show_to_builder: DEPLOY_LINES.off });
    assert.equal(calls.estimate + calls.balance + calls.simulate, 0);
  } finally {
    if (old !== undefined) process.env.DEPLOYER_PRIVATE_KEY = old;
  }
});
