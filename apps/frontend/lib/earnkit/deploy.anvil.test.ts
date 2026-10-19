import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, createTestClient, http, type Abi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sql } from './db';
import { deployForBuilder, deployedLine } from './deploy';

/**
 * v2.10 item 13 against a real chain: the default viem DeployChain deploys a compiled contract
 * (contracts/test/mocks/DeployMocks.sol) on a local anvil, with no value and no recipient, and hands
 * ownership to the builder with one transferOwnership. Runs only with DEPLOY_ANVIL_URL (a fresh anvil
 * started with --chain-id 8453, never 8561) and a local DATABASE_URL:
 *   anvil --port 8573 --chain-id 8453
 *   DEPLOY_ANVIL_URL=http://127.0.0.1:8573 DATABASE_URL=postgres://... pnpm -s test
 */
const URL = process.env.DEPLOY_ANVIL_URL;
const gate = {
  skip:
    (!URL && 'no DEPLOY_ANVIL_URL') ||
    (!process.env.DATABASE_URL && 'no DATABASE_URL') ||
    (URL && (!/^http:\/\/127\.0\.0\.1:\d+$/.test(URL) || URL.endsWith(':8561')) && 'DEPLOY_ANVIL_URL must be a fresh local anvil'),
};
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

// Anvil's dev account #3: funded only on anvil.
const KEY = '7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
const BUILDER = '0x3333333333333333333333333333333333333333' as Address;
const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

test('anvil: EarnKit deploys OwnedTipJar on "Base", moves no money, and the builder owns it', gate, async () => {
  execFileSync('forge', ['build', '--root', join(ROOT, 'contracts')], { stdio: 'ignore' });
  const art = JSON.parse(readFileSync(join(ROOT, 'contracts', 'out', 'DeployMocks.sol', 'OwnedTipJar.json'), 'utf8')) as {
    abi: Abi;
    bytecode: { object: Hex };
  };
  // Fix round 1 (I2): Base's GasPriceOracle predeploy, mocked (a plain anvil has none).
  const oracle = JSON.parse(readFileSync(join(ROOT, 'contracts', 'out', 'DeployMocks.sol', 'MockGasPriceOracle.json'), 'utf8')) as {
    deployedBytecode: { object: Hex };
  };
  await createTestClient({ mode: 'anvil', transport: http(URL) }).setCode({
    address: '0x420000000000000000000000000000000000000F',
    bytecode: oracle.deployedBytecode.object,
  });
  const names = ['DEPLOYER_PRIVATE_KEY', 'BASE_RPC_URL', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'];
  const old = names.map((n) => process.env[n]);
  Object.assign(process.env, { DEPLOYER_PRIVATE_KEY: KEY, BASE_RPC_URL: URL, GITHUB_OAUTH_CLIENT_ID: 'c', GITHUB_OAUTH_CLIENT_SECRET: 's' });
  try {
    const stamp = `${process.pid}-${Date.now()}`;
    const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`deploy-anvil-${stamp}`}) RETURNING id`;
    const repoKey = `alice${stamp}/tipjar`;
    // v2.14 spec 2: the repo proven by the read-only App.
    await sql()`
      INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by, state, proof, verified_at, gh_owner, gh_owner_type)
      VALUES (${id}, 'repo', ${repoKey}, ${repoKey}, 'server', 'verified', 'github_app', now(), ${repoKey.split('/')[0]}, 'User')`;
    const pub = createPublicClient({ transport: http(URL) });
    const deployer = privateKeyToAccount(`0x${KEY}`).address;
    const before = await pub.getBalance({ address: deployer });
    const out = await deployForBuilder(
      { installationId: id, login: null, shared: false, repoKey, projectName: 'TipJar', builderWallet: BUILDER, input: { chain: 'base', bytecode: art.bytecode.object, abi: art.abi } },
      { usdPerNative: async () => 1, now: new Date(Date.UTC(2170, Number(process.pid % 12), 2)) },
    );
    assert.equal(out.status, 'deployed', JSON.stringify(out));
    if (out.status !== 'deployed') return;
    assert.equal(out.owner_ok, true);
    assert.equal(out.show_to_builder, deployedLine('TipJar', 'base', out.address, true));
    assert.equal(((await pub.readContract({ address: out.address, abi: art.abi, functionName: 'owner' })) as string).toLowerCase(), BUILDER.toLowerCase());
    // Two transactions (the creation, then transferOwnership), both value 0; the balance fell by their gas only.
    const [row] = await sql()<{ tx_hash: Hex; cost_micro_usd: string }[]>`SELECT tx_hash, cost_micro_usd::text FROM contract_deploys WHERE repo_key = ${repoKey}`;
    const tx = await pub.getTransaction({ hash: row.tx_hash });
    assert.equal(tx.to, null);
    assert.equal(tx.value, 0n);
    const r1 = await pub.getTransactionReceipt({ hash: row.tx_hash });
    const nonce = await pub.getTransactionCount({ address: deployer });
    const block = await pub.getBlock({ blockTag: 'latest', includeTransactions: true });
    const transfer = block.transactions.find((t) => typeof t !== 'string' && t.from.toLowerCase() === deployer.toLowerCase() && t.nonce === nonce - 1);
    assert.ok(transfer && typeof transfer !== 'string');
    assert.equal(transfer.value, 0n);
    assert.equal(transfer.to?.toLowerCase(), out.address.toLowerCase());
    const r2 = await pub.getTransactionReceipt({ hash: transfer.hash });
    const gas = r1.gasUsed * r1.effectiveGasPrice + r2.gasUsed * r2.effectiveGasPrice;
    assert.equal(before - (await pub.getBalance({ address: deployer })), gas);
    // The row's cost is that gas in micro-USD at $1 a coin (rounded up). (A plain anvil charges no L1
    // fee, so its receipts carry none; the reserve included the mocked oracle's estimate.)
    assert.equal(BigInt(row.cost_micro_usd), (gas * 1_000_000n + 10n ** 18n - 1n) / 10n ** 18n);
    // The deployer holds no rights: owner() is the builder and the raw hasRole probe found nothing.
    const [flag] = await sql()<{ owner_ok: boolean }[]>`SELECT owner_ok FROM contract_deploys WHERE repo_key = ${repoKey}`;
    assert.equal(flag.owner_ok, true);
  } finally {
    names.forEach((n, i) => (old[i] === undefined ? delete process.env[n] : (process.env[n] = old[i])));
  }
});
