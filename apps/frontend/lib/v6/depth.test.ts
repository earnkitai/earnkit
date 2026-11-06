import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRepo } from '../v5/github';
import { replayFetch } from '../v5/fixtures/github';
import { KNOWN_TOKEN_ADDRESSES } from '../v5/repo-facts';
import { readDepth } from './depth';
import { detectIntegrations, INTEGRATIONS, USDC_ADDRESSES } from './integrations';

const replay = (slug: string) => replayFetch(`../../../v6/fixtures/repos/${slug}`);
const depthOf = async (slug: string) => {
  const rec = replay(slug);
  return readDepth(await readRepo(rec.repo, { fetch: rec.fetch, token: 'test' }));
};
const CHAIN_SDKS = ['onchainkit', 'smart_wallet', 'paymaster', 'basenames', 'minikit', 'builder_codes', 'cctp', 'circle_wallets', 'anchor', 'solana_web3', 'blinks', 'wagmi', 'viem', 'ethers', 'hardhat', 'foundry'];

test('onchain-reaction: wagmi, viem, builder codes and USDC; Base on mainnet', async () => {
  const d = await depthOf('onchain-reaction');
  for (const k of ['wagmi', 'viem', 'builder_codes', 'usdc', 'onchainkit']) assert.ok(d.integrations.includes(k), `${k} in ${d.integrations}`);
  // The wallet SDK without a smart-wallet-only setting is not Smart Wallet.
  assert.ok(!d.integrations.includes('smart_wallet'));
  assert.ok(d.chains_mainnet.includes('base'));
});

test('earnkit: none of the chain SDKs', async () => {
  const d = await depthOf('earnkit');
  for (const k of CHAIN_SDKS) assert.ok(!d.integrations.includes(k), `${k} found in ${d.integrations}`);
});

test('the registry holds every listed integration; USDC addresses are the known token ones', () => {
  const keys = INTEGRATIONS.map((i) => i.key);
  for (const k of [...CHAIN_SDKS, 'usdc']) assert.ok(keys.includes(k), k);
  assert.equal(new Set(keys).size, keys.length);
  for (const a of USDC_ADDRESSES) assert.ok(KNOWN_TOKEN_ADDRESSES.has(a), a);
});

test('detectIntegrations: package.json dependencies, imports, config and paths', () => {
  const files = [
    { path: 'package.json', text: JSON.stringify({ dependencies: { ethers: '^6' }, devDependencies: { hardhat: '^2' } }) },
    { path: 'src/wallet.ts', text: "import { coinbaseWallet } from 'wagmi/connectors';\ncoinbaseWallet({ preference: 'smartWalletOnly' });\nconst c = { paymasterService: { url } };" },
    { path: 'programs/x/src/lib.rs', text: 'use anchor_lang::prelude::*;' },
    { path: 'src/bridge.ts', text: "import { TokenMessenger } from './abi';" },
    // Text in a JSON file or a README is never an import.
    { path: 'fixtures/x.json', text: '"@solana/actions"' },
  ];
  const got = detectIntegrations(files, ['foundry.toml', 'src/wallet.ts']);
  for (const k of ['ethers', 'hardhat', 'wagmi', 'smart_wallet', 'paymaster', 'anchor', 'cctp', 'foundry']) assert.ok(got.includes(k), `${k} in ${got}`);
  assert.ok(!got.includes('blinks'));
  // path.basename is not Basenames.
  assert.deepEqual(detectIntegrations([{ path: 'a.ts', text: "import path from 'node:path'; path.basename(x);" }], []), []);
});
