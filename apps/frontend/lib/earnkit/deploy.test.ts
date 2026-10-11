import { after, beforeEach, test } from 'node:test';
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
  deployChainOn,
  deployChains,
  deployEnabled,
  deployForBuilder,
  deployOffLine,
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
import { createServer } from 'node:http';
import { ETH_USD_BAND, OWNER_PROOF_NOTE, nativeUsd, viemDeployChain } from './deploy';
import { keccak256 } from 'viem';
import { ARC_TIPJAR_ABI, ARC_TIPJAR_BYTECODE } from './fixtures/arc-tipjar-artifact';
import { forceFreeTier, periodKey, takeFreeTier } from './free-tier';
import { contractDeployed } from './verify';
import { errorLines, eventsOfInstallation, withEventLog, withFailingEventLog } from './fixtures/events';

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
  assert.deepEqual(DEPLOY_CAPS, { initcodeBytes: 49_152, runtimeBytes: 24_576, perDeployUsd: 0.25, monthMicroUsd: 10_000_000, dayTotal: 20, perBuilderChainDay: 1, perBuilder30d: 3, perRepoChainDay: 3, perRepo30d: 10 });
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

test('KNOWN LIMIT (Ruling H12, N1), not desired behaviour: a reachable CREATE hidden in a CBOR-looking tail passes the runtime check', () => {
  // PUSH1 4; JUMP; a1; JUMPDEST; CREATE(0,0,0); STOP; tail length 0x000a. The tail is skipped as
  // metadata, so this factory is not refused. Accepted residual risk: it is the builder's own contract
  // and EarnKit only paid capped gas (the runbook records it). The post-deploy nonce check (N2) still
  // flags a constructor that created contracts. If this assertion ever fails, the limit was closed.
  assert.equal(runtimeRefusal('0x600456a15b600060006000f000000a' as Hex), null);
});

// ---- The chain fake and the DB setup

type Calls = {
  estimate: number;
  simulate: number;
  simulateArgs: { gas: bigint; maxFeePerGas: bigint }[];
  order: string[];
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
  nonce?: number | 'throws';
} = {}) {
  const calls: Calls = { estimate: 0, simulate: 0, simulateArgs: [], order: [], send: [], writes: [], reads: [], balance: 0 };
  let owner = o.owner ?? (() => BUILDER);
  const fee = o.feeWei ?? 100_000_000_000n;
  const chain: DeployChain = {
    estimate: async () => {
      calls.estimate++;
      calls.order.push('estimate');
      // $0.01 for the deploy and $0.01 for the transfer cap at $1 a coin.
      return { gas: 100_000n, maxFeePerGas: fee, ...(o.l1Fee !== undefined && { l1Fee: o.l1Fee }) };
    },
    simulate: async (a) => {
      calls.simulate++;
      calls.order.push('simulate');
      calls.simulateArgs.push({ gas: a.gas, maxFeePerGas: a.maxFeePerGas });
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
        blockNumber: 4242n,
      };
    },
    code: async () => o.code ?? (`0x${'60'.repeat(100)}` as Hex),
    nonce: async () => {
      if (o.nonce === 'throws') throw new Error('rpc down');
      return o.nonce ?? 1;
    },
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
/**
 * T9 security fix R3: a non-shared installation with no sign-in whose repo `<owner>/<name>` holds its
 * earnkit.txt line, the builder's said login (`githubUser`), GitHub's cached account read for the
 * owner (`days` old, 2 public repos, `type`) and the push record (`pusher`, default the owner).
 */
async function ownerSetup(o: { owner?: string; name?: string; githubUser?: string | null; days?: number; type?: string; pusher?: string | null } = {}) {
  const s = await setup({ proof: false });
  const owner = (o.owner ?? s.repoKey.split('/')[0]).toLowerCase();
  const repoKey = `${owner}/${o.name ?? 'tipjar'}`;
  await sql()`UPDATE installations SET github_user = ${o.githubUser === undefined ? owner : o.githubUser} WHERE id = ${s.installationId}`;
  const note = JSON.stringify({ type: o.type ?? 'User', created_at: new Date(Date.now() - (o.days ?? 400) * 86_400_000).toISOString(), public_repos: 2 });
  await sql()`
    INSERT INTO url_checks (key, ok, checked_at, note) VALUES (${`ghuser:${owner}`}, true, now(), ${note})
    ON CONFLICT (key) DO UPDATE SET ok = true, checked_at = now(), note = EXCLUDED.note`;
  const { tokenLineFor } = await import('./token-gate');
  const gate = {
    owner: async (r: { owner: string; repo: string }) => ({ status: 'ok' as const, text: `${tokenLineFor(s.installationId, `https://github.com/${r.owner}/${r.repo}`)}\n` }),
    latest: async () => null,
    pusher: async () => (o.pusher === undefined ? owner : o.pusher),
  };
  return { ...s, repoKey, owner, gate };
}

// A month of its own (far from real time) per call, so the global counters start at zero: years 2100
// to 2149 belong to this file, and each test clears them first (other files use other years).
let months = 0;
const farDay = () => {
  const n = months++;
  return new Date(Date.UTC(2100 + Math.floor(n / 12), n % 12, 15, 12));
};
beforeEach(async () => {
  if (process.env.DATABASE_URL)
    await sql()`DELETE FROM free_tier_usage WHERE name IN ('deploysDay', 'deployGasMonth') AND period >= '2100' AND period < '2150'`;
  // v2.11 T9 security fix (I3): every test here deploys to the one BUILDER wallet; the new per-wallet
  // day cap would carry over between tests, so earlier tests' rows for it are moved 40 days back.
  if (process.env.DATABASE_URL) await nextWallet();
});
/** T9 I3: another deploy to BUILDER in the same test is a new builder's: age the wallet's rows out of every window. */
async function nextWallet() {
  await sql()`UPDATE contract_deploys SET created_at = created_at - interval '40 days' WHERE owner_wallet = ${BUILDER.toLowerCase()} AND created_at > now() - interval '30 days'`;
}
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

test('10.5 the proof line in earnkit.txt proves the repo on a non-shared client (no sign-in row) when the owner\'s own proven account pushed it (T9 R3)', dbTest, () =>
  withDeployer(async () => {
    const s = await ownerSetup();
    const { chain } = fakeChain();
    const out = await deployForBuilder(call(s), deps(chain, { gate: s.gate }));
    assert.equal(out.status, 'deployed');
    const [row] = await sql()<{ line_owner: string | null }[]>`SELECT line_owner FROM contract_deploys WHERE repo_key = ${s.repoKey}`;
    assert.equal(row.line_owner, s.owner, 'capped by the proven owner login');
  }, { EARNKIT_AUTH_SECRET: 'deploy-test-secret' }),
);

test('T9 R3: a proof-line-only deploy with no proven owner login is refused with the agent note, nothing sent: a collaborator or merge push, no push record, a lying or missing github_user, an org, a 10-day account', dbTest, () =>
  withDeployer(async () => {
    const cases: [string, Parameters<typeof ownerSetup>[0]][] = [
      ["a collaborator's push", { pusher: 'mallory-x' }],
      ['no push record (a merge, a bot, a force push)', { pusher: null }],
      ['a github_user that lies', { githubUser: 'someone-else' }],
      ['no github_user', { githubUser: null }],
      ['an org', { type: 'Organization' }],
      ['a 10-day account', { days: 10 }],
    ];
    for (const [label, o] of cases) {
      await nextWallet();
      const s = await ownerSetup(o);
      const { chain, calls } = fakeChain();
      const out = await deployForBuilder(call(s), deps(chain, { gate: s.gate }));
      assert.deepEqual(out, { status: 'refused', show_to_builder: DEPLOY_LINES.notYours, agent_note: OWNER_PROOF_NOTE }, label);
      assert.equal(calls.estimate + calls.send.length, 0, label);
      assert.equal((await rowsOf(s.repoKey)).length, 0, label);
    }
    // A sign-in proof keeps v2.10 as it was: no pusher needed.
    await nextWallet();
    const signed = await setup();
    assert.equal((await deployForBuilder(call(signed), deps(fakeChain().chain, { gate: { ...noProofLine, pusher: async () => null } }))).status, 'deployed');
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

test('fix round 1 (I6): off a shared client the limits are per installation (or its login), and (T9 I3) per repo and per wallet too', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const other = { ...s, repoKey: `${s.repoKey}-two` };
    await proofRow(s.installationId, other.repoKey);
    const { chain, calls } = fakeChain();
    const d = deps(chain);
    assert.equal((await deployForBuilder(call(s), d)).status, 'deployed');
    await nextWallet();
    assert.deepEqual(await deployForBuilder(call(other), d), { status: 'refused', show_to_builder: DEPLOY_LINES.limit }, 'another repo, same builder, same chain and day');
    assert.equal(calls.send.length, 1);
    assert.equal((await rowsOf(s.repoKey))[0].builder_key, `installation:${s.installationId}`);
    // With the installation's verified login, the login is the key.
    await nextWallet();
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
    await nextWallet();
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
    await nextWallet();
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
    await nextWallet();
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

// ---- Fix round 2 (Ruling H12)

test('fix round 2 (N2): a contract whose nonce is above 1 (its constructor created contracts) is flagged, never cached, and blocks that builder', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const addr = '0x00000000000000000000000000000000000c41d2' as Address; // its own: other tests cache DEPLOYED
    const base = fakeChain({ nonce: 2 }).chain;
    const chain: DeployChain = { ...base, receipt: async (h, t) => { const r = await base.receipt(h, t); return r && r.contractAddress ? { ...r, contractAddress: addr } : r; } };
    await sql()`DELETE FROM url_checks WHERE key = ${`getcode:base:${addr}`}`;
    const out = await deployForBuilder(call(s), deps(chain));
    assert.equal(out.status === 'deployed' && out.owner_ok, false);
    assert.doesNotMatch(out.show_to_builder, /owner/);
    const [row] = await sql()<{ id: number; blocked: boolean; owner_ok: boolean }[]>`SELECT id, blocked, owner_ok FROM contract_deploys WHERE repo_key = ${s.repoKey}`;
    assert.equal(row.blocked, true);
    assert.ok((await flagged()).includes(`deploy-owner:${row.id}`));
    const [cached] = await sql()`SELECT 1 FROM url_checks WHERE key = ${`getcode:base:${addr}`}`;
    assert.equal(cached, undefined, 'no getCode pass');
    // The same builder on the other chain (its own day window): blocked, nothing simulated or sent.
    const next = fakeChain();
    assert.deepEqual(await deployForBuilder(call(s, input({ chain: 'arc' })), deps(next.chain)), { status: 'refused', show_to_builder: DEPLOY_LINES.blocked });
    assert.equal(next.calls.estimate + next.calls.send.length, 0);
    // A nonce read that fails can't confirm it: flagged, not blocked.
    await nextWallet();
    const s2 = await setup();
    const out2 = await deployForBuilder(call(s2), deps(fakeChain({ nonce: 'throws' }).chain));
    assert.equal(out2.status === 'deployed' && out2.owner_ok, false);
    assert.equal((await sql()<{ blocked: boolean }[]>`SELECT blocked FROM contract_deploys WHERE repo_key = ${s2.repoKey}`)[0].blocked, false);
  }),
);

test('fix round 2 (N3): the creation is simulated after the estimate, with its gas and fee cap', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain({ feeWei: 123_000_000_000n });
    assert.equal((await deployForBuilder(call(s), deps(chain))).status, 'deployed');
    assert.deepEqual(calls.order.slice(0, 2), ['estimate', 'simulate']);
    assert.deepEqual(calls.simulateArgs, [{ gas: 100_000n, maxFeePerGas: 123_000_000_000n }]);
    assert.deepEqual([calls.send[0].gas, calls.send[0].maxFeePerGas], [100_000n, 123_000_000_000n], 'the send carries the same values');
  }),
);

test('fix round 2 (N4): the default chain refuses an RPC whose chain id is not the one priced, before any other read', async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = JSON.parse(body) as { id: number; method: string } | { id: number; method: string }[];
      const one = (m: { id: number; method: string }) => {
        seen.push(m.method);
        return { jsonrpc: '2.0', id: m.id, result: m.method === 'eth_chainId' ? '0x1' : '0x0' };
      };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(Array.isArray(msg) ? msg.map(one) : one(msg)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const names = ['DEPLOYER_PRIVATE_KEY', 'BASE_RPC_URL'];
  const old = names.map((n) => process.env[n]);
  process.env.DEPLOYER_PRIVATE_KEY = DEPLOYER_KEY;
  process.env.BASE_RPC_URL = `http://127.0.0.1:${port}`;
  try {
    const chain = viemDeployChain('base')!;
    await assert.rejects(chain.estimate({ data: '0x6000', from: DEPLOYER }), /RPC chain id 1, expected 8453/);
    assert.deepEqual(seen, ['eth_chainId'], 'nothing else was read');
  } finally {
    names.forEach((n, i) => (old[i] === undefined ? delete process.env[n] : (process.env[n] = old[i])));
    await new Promise((r) => server.close(r));
  }
});

test('fix round 2 (N5): an ETH price outside $500 to $20,000 is refused; Arc is $1', async () => {
  assert.deepEqual(ETH_USD_BAND, { min: 500, max: 20_000 });
  assert.equal(await nativeUsd('base', async () => 3_000), 3_000);
  assert.equal(await nativeUsd('base', async () => 500), 500);
  assert.equal(await nativeUsd('base', async () => 20_000), 20_000);
  for (const bad of [499.99, 20_000.01, 300, 0, NaN, Infinity])
    await assert.rejects(nativeUsd('base', async () => bad), /outside the trusted band/, String(bad));
  assert.equal(await nativeUsd('arc', async () => { throw new Error('never read'); }), 1);
});

test('fix round 2 (N5): a deploy priced with an ETH price outside the band is refused before sending', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    const { chain, calls } = fakeChain();
    const out = await deployForBuilder(call(s), deps(chain, { usdPerNative: (c) => nativeUsd(c, async () => 300) }));
    assert.equal(out.status, 'unavailable');
    assert.equal(out.show_to_builder, DEPLOY_LINES.lowBalance);
    assert.equal(calls.send.length, 0);
    assert.equal((await rowsOf(s.repoKey)).length, 0);
  }),
);

// ---- v2.10.3: DEPLOY_CHAINS (the chains EarnKit deploys on)

test('v2.10.3 deployChains: unset or blank is both; "base, ARC " is normalized; garbage is ignored and logged once by name only', () => {
  assert.deepEqual(deployChains({}), ['arc', 'base']);
  assert.deepEqual(deployChains({ DEPLOY_CHAINS: '  ' }), ['arc', 'base'], 'blank is unset');
  assert.deepEqual(deployChains({ DEPLOY_CHAINS: 'base' }), ['base']);
  assert.deepEqual(deployChains({ DEPLOY_CHAINS: 'base, ARC ' }), ['arc', 'base']);
  assert.deepEqual(deployChains({ DEPLOY_CHAINS: 'base,base,,' }), ['base'], 'repeats and empty entries are dropped');
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  try {
    assert.deepEqual(deployChains({ DEPLOY_CHAINS: 'base,s3cr3t-junk' }), ['base']);
    assert.deepEqual(deployChains({ DEPLOY_CHAINS: 'ethereum' }), [], 'only garbage: no chain');
    assert.deepEqual(deployChains({ DEPLOY_CHAINS: 'base,s3cr3t-junk' }), ['base']);
  } finally {
    console.error = orig;
  }
  assert.equal(logged.length, 1, logged.join('\n'));
  assert.match(logged[0], /DEPLOY_CHAINS/);
  assert.ok(!logged[0].includes('s3cr3t') && !logged[0].includes('ethereum'), logged[0]);
});

test('v2.10.3 deployChainOn: the key and the chain both on', () => {
  const env = { DEPLOYER_PRIVATE_KEY: DEPLOYER_KEY };
  assert.equal(deployChainOn('arc', env), true);
  assert.equal(deployChainOn('base', env), true);
  assert.equal(deployChainOn('arc', { ...env, DEPLOY_CHAINS: 'base' }), false);
  assert.equal(deployChainOn('base', { ...env, DEPLOY_CHAINS: 'base' }), true);
  assert.equal(deployChainOn('base', { DEPLOY_CHAINS: 'base' }), false, 'no key: off');
});

test('v2.10.3 DEPLOY_CHAINS=base: no Arc client; the Base client is still made', () =>
  withDeployer(async () => {
    assert.equal(viemDeployChain('arc'), null);
    assert.notEqual(viemDeployChain('base'), null);
  }, { DEPLOY_CHAINS: 'base' }),
);

test('v2.10.3 DEPLOY_CHAINS=base: an Arc deploy is refused cleanly before any read; no chain on is the plain off line', () =>
  withDeployer(async () => {
    const { chain, calls } = fakeChain();
    let made: string[] = [];
    const out = await deployForBuilder(call({ installationId: 1, repoKey: 'a/b' }, input({ chain: 'arc' })), deps(chain, { chain: (c) => ((made.push(c)), chain) }));
    assert.deepEqual(out, { status: 'unavailable', show_to_builder: deployOffLine('arc'), agent_note: "EarnKit doesn't deploy on Arc right now. Don't retry it there." });
    assert.equal(out.show_to_builder, 'Deploys on Arc are off right now.');
    assert.deepEqual(made, [], 'no Arc client asked for');
    assert.equal(calls.estimate + calls.balance + calls.simulate + calls.send.length, 0);
    made = [];
    const none = await withDeployer(() => deployForBuilder(call({ installationId: 1, repoKey: 'a/b' }), deps(chain, { chain: (c) => ((made.push(c)), chain) })), { DEPLOY_CHAINS: 'nope' });
    assert.deepEqual(none, { status: 'unavailable', show_to_builder: DEPLOY_LINES.off }, 'no chain on: the plain off line');
    assert.deepEqual(made, []);
  }, { DEPLOY_CHAINS: 'base' }),
);

test('v2.10.3 DEPLOY_CHAINS=base: deployerGas reads Base only, so a low Arc wallet is never deployer-gas:arc', dbTest, () =>
  withDeployer(async () => {
    const asked: string[] = [];
    const chainOf = (c: 'arc' | 'base') => {
      asked.push(c);
      return { balance: async () => (c === 'arc' ? 0n : 5n * 10n ** 18n) } as unknown as DeployChain;
    };
    const gas = await deployerGas(new Date(), { chain: chainOf, usdPerNative: async () => 1 });
    assert.deepEqual(asked, ['base']);
    assert.deepEqual(gas.deployer_gas, { base: { usd: 5 } });
    assert.ok(!gas.needs_owner.some((k) => k.includes(':arc')), gas.needs_owner.join(','));
    asked.length = 0;
    const unset = await withDeployer(() => deployerGas(new Date(), { chain: chainOf, usdPerNative: async () => 1 }), { DEPLOY_CHAINS: '' });
    assert.deepEqual(asked.sort(), ['arc', 'base'], 'unset: both, as before');
    assert.ok(unset.needs_owner.includes('deployer-gas:arc'));
  }, { DEPLOY_CHAINS: 'base' }),
);

// ---- v2.11 T3: the deployed event

test('3.1 a deploy writes one deployed event: the tx, the address, the block, owner_ok, the wallet and the signed-in login', dbTest, () =>
  withEventLog(() =>
    withDeployer(async () => {
      const s = await setup();
      const out = await deployForBuilder(call(s), deps(fakeChain().chain));
      assert.equal(out.status, 'deployed');
      const [row] = await rowsOf(s.repoKey);
      const events = await eventsOfInstallation(s.installationId);
      assert.equal(events.length, 1);
      const e = events[0];
      assert.equal(e.type, 'deployed');
      assert.equal(e.dedupe_key, `deployed:${row.id}`);
      assert.equal(e.proof_tx, HASH);
      assert.equal(e.chain, 'base');
      assert.equal(e.repo_key, s.repoKey.toLowerCase());
      assert.equal(e.wallet, BUILDER.toLowerCase());
      assert.deepEqual(e.detail, { address: DEPLOYED.toLowerCase(), owner_ok: true, block: 4242 });
      assert.equal(e.github_login, 'alice');
      assert.equal(e.login_basis, 'signin');
      const [kept] = await sql()<{ owner_wallet: string | null; block: string | null }[]>`
        SELECT owner_wallet, block::text FROM contract_deploys WHERE id = ${row.id}`;
      assert.deepEqual({ ...kept }, { owner_wallet: BUILDER.toLowerCase(), block: '4242' }, 'the row keeps the owner wallet and the block');
    }),
  ),
);

test('3.1 a reverted deploy and one left unknown write no event; with the log off nothing is written', dbTest, () =>
  withDeployer(async () => {
    const reverted = await setup();
    const unknown = await setup();
    await withEventLog(async () => {
      assert.equal((await deployForBuilder(call(reverted), deps(fakeChain({ receipt: 'reverted' }).chain))).status, 'failed');
      await nextWallet();
      assert.equal((await deployForBuilder(call(unknown), deps(fakeChain({ receipt: null }).chain))).status, 'failed');
    });
    assert.equal((await rowsOf(reverted.repoKey))[0].status, 'reverted');
    assert.equal((await rowsOf(unknown.repoKey))[0].status, 'unknown');
    assert.deepEqual(await eventsOfInstallation(reverted.installationId), []);
    assert.deepEqual(await eventsOfInstallation(unknown.installationId), []);
    await nextWallet();
    const off = await setup();
    assert.equal((await deployForBuilder(call(off), deps(fakeChain().chain))).status, 'deployed');
    assert.deepEqual(await eventsOfInstallation(off.installationId), [], 'EARNKIT_EVENT_LOG is off');
  }),
);

test('3.2 a deploy the runbook settles from unknown to deployed later writes no event (the backfill picks it up)', dbTest, () =>
  withEventLog(() =>
    withDeployer(async () => {
      const s = await setup();
      await deployForBuilder(call(s), deps(fakeChain({ receipt: null }).chain));
      const [row] = await rowsOf(s.repoKey);
      await sql()`UPDATE contract_deploys SET status = 'deployed', address = ${DEPLOYED.toLowerCase()} WHERE id = ${row.id}`;
      assert.deepEqual(await eventsOfInstallation(s.installationId), []);
    }),
  ),
);

test('3.8 a deploy proven by the proof line alone records the owner only for the builder\'s own User account; a shared caller its own login', dbTest, () =>
  withEventLog(() =>
    withDeployer(async () => {
      const { tokenLineFor } = await import('./token-gate');
      // Review I2: the owner is recorded only when the builder said it is them and it is a User account.
      const lineDeploy = async (type: 'User' | 'Organization', pusher?: string) => {
        await nextWallet();
        const s = await setup({ proof: false });
        // T9 R3: only the owner's own proven account deploys; the others are refused (tested in R3).
        const owner = s.repoKey.split('/')[0].toLowerCase();
        await sql()`UPDATE installations SET github_user = ${owner} WHERE id = ${s.installationId}`;
        await sql()`
          INSERT INTO url_checks (key, ok, checked_at, note)
          VALUES (${`ghuser:${owner}`}, true, now(), ${JSON.stringify({ type, created_at: '2020-01-01T00:00:00Z', public_repos: 2 })})`;
        const line = tokenLineFor(s.installationId, `https://github.com/${s.repoKey}`);
        // T9 security fix I1: GitHub's push record says who added the line (default: the owner).
        const gate = { owner: async () => ({ status: 'ok' as const, text: `${line}\n` }), latest: async () => null, pusher: async () => pusher ?? owner };
        assert.equal((await deployForBuilder(call(s), deps(fakeChain().chain, { gate }))).status, 'deployed');
        const [e] = await eventsOfInstallation(s.installationId);
        const [row] = await sql()<{ line_owner: string | null }[]>`SELECT line_owner FROM contract_deploys WHERE repo_key = ${s.repoKey}`;
        return { e, owner, lineOwner: row.line_owner };
      };
      const user = await lineDeploy('User');
      assert.equal(user.e.github_login, user.owner);
      assert.equal(user.e.login_basis, 'proof_line');
      assert.equal(user.lineOwner, user.owner, 'the row keeps the proven owner');

      await nextWallet();
      const bobLogin = `bob${process.pid}y${Date.now()}`;
      const shared = await setup({ shared: true, login: bobLogin });
      await sql()`INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
        VALUES (${shared.repoKey}, 'carol', ${shared.installationId}, now(), 3, 'entry')`;
      assert.equal((await deployForBuilder(call(shared, input(), bobLogin), deps(fakeChain().chain))).status, 'deployed');
      const [b] = await eventsOfInstallation(shared.installationId);
      assert.equal(b.github_login, bobLogin.toLowerCase(), "the caller's login, never another builder's on the same agent");
      assert.equal(b.login_basis, 'signin');
    }, { EARNKIT_AUTH_SECRET: 'deploy-test-secret' }),
  ),
);

test('3.6 a failing event write leaves the deploy reply identical and logs the type and error class only', dbTest, () =>
  withDeployer(async () => {
    const s = await setup();
    let out: Awaited<ReturnType<typeof deployForBuilder>> | undefined;
    const lines = await errorLines(() => withFailingEventLog(async () => (out = await deployForBuilder(call(s), deps(fakeChain().chain)))));
    assert.deepEqual(out, { status: 'deployed', address: DEPLOYED, owner_ok: true, show_to_builder: deployedLine('TipJar', 'base', DEPLOYED, true) });
    assert.equal((await rowsOf(s.repoKey))[0].status, 'deployed');
    assert.deepEqual(lines, ['[events] deployed PostgresError']);
    assert.deepEqual(await eventsOfInstallation(s.installationId), []);
  }),
);

test('review M1: a deploy whose stored code differs is logged with code_differs, and the row keeps it', dbTest, () =>
  withEventLog(() =>
    withDeployer(async () => {
      const s = await setup();
      const out = await deployForBuilder(call(s), deps(fakeChain({ code: `0x${'5b'.repeat(24_577)}` as Hex }).chain));
      assert.equal(out.status, 'failed');
      const [row] = await sql()<{ id: number; code_differs: boolean }[]>`SELECT id, code_differs FROM contract_deploys WHERE repo_key = ${s.repoKey}`;
      assert.equal(row.code_differs, true);
      const [e] = await eventsOfInstallation(s.installationId);
      assert.deepEqual(e.detail, { address: DEPLOYED.toLowerCase(), owner_ok: false, block: 4242, code_differs: true });
    }),
  ),
);

// ---- v2.11 T9 security fix (I3): caps per repo, per owner wallet and per proven line pusher

test('T9 I3/R2/R3/N2: the caps hold per proven owner login and per repo (looser), never per named wallet; the installation and global caps stay', dbTest, () =>
  withDeployer(async () => {
    const t0 = Date.now().toString(16).padStart(28, '0');
    const W = (n: number) => `0x${String(n).padStart(4, '0')}${process.pid.toString(16).padStart(8, '0')}${t0}`.slice(0, 42) as Address;
    const run = (s: { installationId: number; repoKey: string }, wallet: Address, o: { chain?: 'arc' | 'base'; gate?: DeployDeps['gate'] } = {}) =>
      deployForBuilder({ ...call(s, input({ chain: o.chain ?? 'base' })), builderWallet: wallet }, deps(fakeChain().chain, o.gate ? { gate: o.gate } : {}));
    // R2: an attacker deploys naming the victim's wallet; the victim's own deploy that day still goes.
    const attacker = await setup();
    const victim = await setup();
    assert.equal((await run(attacker, W(1))).status, 'deployed');
    assert.equal((await run(victim, W(1))).status, 'deployed', "a named wallet never caps anyone's deploys");
    // One proven owner login, two installations, two of its repos: the second is limited that day.
    const owner = `pz${process.pid}${Date.now().toString(36)}`;
    const e = await ownerSetup({ owner, name: 'one' });
    const f = await ownerSetup({ owner, name: 'two' });
    assert.equal((await run(e, W(2), { gate: e.gate })).status, 'deployed');
    assert.deepEqual(await run(f, W(3), { gate: f.gate }), { status: 'refused', show_to_builder: DEPLOY_LINES.limit }, 'one owner login');
    // N2: one repo, several installations that proved it (sign-ins): 3 a day per chain, then limited.
    const a = await setup();
    const more = [await setup({ proof: false }), await setup({ proof: false }), await setup({ proof: false })];
    for (const m of more) await proofRow(m.installationId, a.repoKey);
    assert.equal((await run(a, W(4))).status, 'deployed');
    assert.equal((await run({ ...more[0], repoKey: a.repoKey }, W(5))).status, 'deployed');
    assert.equal((await run({ ...more[1], repoKey: a.repoKey }, W(6))).status, 'deployed');
    assert.deepEqual(await run({ ...more[2], repoKey: a.repoKey }, W(7)), { status: 'refused', show_to_builder: DEPLOY_LINES.limit }, '4th on one repo in a day');
    // 10 in 30 days on one repo: limited.
    const g = await setup();
    await sql()`
      INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd, created_at)
      SELECT ${g.installationId}, 'installation:other' || n, ${g.repoKey}, 'arc', '0x01', 'deployed', 1, now() - make_interval(days => n + 2)
      FROM generate_series(1, 10) n`;
    assert.deepEqual(await run(g, W(8)), { status: 'refused', show_to_builder: DEPLOY_LINES.limit }, '10 in 30 days on the repo');
  }, { EARNKIT_AUTH_SECRET: 'deploy-test-secret' }),
);

test('T9 N1: the registry hash is the exact forge bytecode (metadata included)', () => {
  assert.equal(keccak256(ARC_TIPJAR_BYTECODE), '0xa6f7f8eea13d3342af071976fe7d480df0fdeda009e3eb4ffd3920e673df9f2e');
});

test('T9 M3: the deployed event names the starter only for its own bytecode; other bytecode gets starter null', dbTest, () =>
  withEventLog(() =>
    withDeployer(async () => {
      const starter = { id: 'arc-tipjar', bytecode_hash: '0xa6f7f8eea13d3342af071976fe7d480df0fdeda009e3eb4ffd3920e673df9f2e' };
      const deployOf = async (i: DeployInput) => {
        await nextWallet();
        const s = await setup();
        assert.equal((await deployForBuilder({ ...call(s, i), starter }, deps(fakeChain().chain))).status, 'deployed');
        return (await eventsOfInstallation(s.installationId))[0].detail.starter;
      };
      const real = input({ chain: 'arc', bytecode: ARC_TIPJAR_BYTECODE, abi: ARC_TIPJAR_ABI as unknown as Abi, constructor_args: [BUILDER, 'PodTips', '1000000'] });
      assert.equal(await deployOf(real), 'arc-tipjar');
      assert.equal(await deployOf(input({ chain: 'arc' })), null, 'any other bytecode');
      // N1: the real bytecode with a suffix (say, a crafted owner word and length bytes) is not the starter's.
      const suffixed = `${ARC_TIPJAR_BYTECODE}${'00'.repeat(12)}${BUILDER.slice(2)}0040` as Hex;
      assert.equal(await deployOf({ ...real, bytecode: suffixed }), null, 'an appended suffix');
    }),
  ),
);
