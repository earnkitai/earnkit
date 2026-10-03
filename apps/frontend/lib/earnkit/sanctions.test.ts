import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_MAINNET,
  CLEAN_TTL_MS,
  SanctionsError,
  sanctionedWallets,
  screenWallet,
  screenWinners,
  setSanctionsOracle,
  type SanctionsOracle,
} from './sanctions';

const LISTED = '0x00000000000000000000000000000000000000aa';
const CLEAN = '0x00000000000000000000000000000000000000bb';
const asked: string[] = [];
const stub = (rpcChain = BASE_MAINNET): SanctionsOracle => ({
  chainId: async () => rpcChain,
  isSanctioned: async (w) => {
    asked.push(w);
    return w === LISTED;
  },
});
const env = process.env as Record<string, string | undefined>;
const nodeEnv = env.NODE_ENV;
afterEach(() => {
  setSanctionsOracle(null);
  asked.length = 0;
  env.NODE_ENV = nodeEnv;
});

test('sanctions: a listed wallet is refused on Base mainnet, plainly', async () => {
  setSanctionsOracle(stub());
  await screenWallet(CLEAN, BASE_MAINNET);
  await assert.rejects(
    screenWallet(LISTED.toUpperCase().replace('0X', '0x'), BASE_MAINNET),
    (e) =>
      e instanceof SanctionsError &&
      e.message === "This wallet can't receive prizes on EarnKit.",
  );
  assert.deepEqual(
    await sanctionedWallets([CLEAN, LISTED, CLEAN], BASE_MAINNET),
    [LISTED],
  );
});

test('sanctions: clean results are cached for 10 minutes; listed ones never', async () => {
  setSanctionsOracle(stub());
  const t = 1_000_000;
  await sanctionedWallets([CLEAN, LISTED], BASE_MAINNET, t);
  await sanctionedWallets([CLEAN, LISTED], BASE_MAINNET, t + CLEAN_TTL_MS - 1);
  assert.deepEqual(asked, [CLEAN, LISTED, LISTED]);
  await sanctionedWallets([CLEAN], BASE_MAINNET, t + CLEAN_TTL_MS);
  assert.deepEqual(asked, [CLEAN, LISTED, LISTED, CLEAN]);
});

test('sanctions: skipped off Base mainnet (no oracle call)', async () => {
  setSanctionsOracle(stub());
  assert.deepEqual(await sanctionedWallets([LISTED], 84532), []);
  await screenWallet(LISTED, 31337);
  assert.deepEqual(asked, []);
});

test('sanctions: in production a mismatched or failing RPC refuses (fails closed)', async () => {
  env.NODE_ENV = 'production';
  const refused = (e: unknown) =>
    e instanceof SanctionsError &&
    e.message === "Can't check this wallet right now; try again shortly.";
  // BASE_RPC_URL answers Base Sepolia while the payment is on Base mainnet.
  setSanctionsOracle(stub(84532));
  await assert.rejects(screenWallet(LISTED, BASE_MAINNET), refused);
  assert.deepEqual(asked, []);
  setSanctionsOracle({
    chainId: async () => {
      throw new Error('rpc down');
    },
    isSanctioned: async () => false,
  });
  await assert.rejects(screenWallet(CLEAN, BASE_MAINNET), refused);
  setSanctionsOracle({
    chainId: async () => BASE_MAINNET,
    isSanctioned: async () => {
      throw new Error('revert');
    },
  });
  await assert.rejects(screenWallet(CLEAN, BASE_MAINNET), refused);
});

test('sanctions: outside production a mismatched or failing RPC is logged and skipped', async () => {
  env.NODE_ENV = 'development';
  setSanctionsOracle(stub(31337));
  assert.deepEqual(await sanctionedWallets([LISTED], BASE_MAINNET), []);
  setSanctionsOracle({
    chainId: async () => {
      throw new Error('rpc down');
    },
    isSanctioned: async () => true,
  });
  assert.deepEqual(await sanctionedWallets([LISTED], BASE_MAINNET), []);
});

test('sanctions: award plans and payouts name the listed winner', async () => {
  setSanctionsOracle(stub());
  await screenWinners([{ entry_id: 1, wallet: CLEAN }], BASE_MAINNET);
  await assert.rejects(
    screenWinners(
      [
        { entry_id: 1, wallet: CLEAN },
        { entry_id: 7, wallet: LISTED },
      ],
      BASE_MAINNET,
    ),
    /winners: entry 7's payout wallet can't receive prizes on EarnKit\./,
  );
});
