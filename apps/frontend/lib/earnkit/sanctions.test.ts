import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_MAINNET,
  SanctionsError,
  sanctionedWallets,
  screenWallet,
  screenWinners,
  setSanctionsOracle,
} from './sanctions';

const LISTED = '0x00000000000000000000000000000000000000aa';
const CLEAN = '0x00000000000000000000000000000000000000bb';
const asked: string[] = [];
const stub = async (w: string) => {
  asked.push(w);
  return w === LISTED;
};
afterEach(() => {
  setSanctionsOracle(null);
  asked.length = 0;
});

test('sanctions: a listed wallet is refused on Base mainnet, plainly', async () => {
  setSanctionsOracle(stub);
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

test('sanctions: skipped off Base mainnet (no oracle call)', async () => {
  setSanctionsOracle(stub);
  assert.deepEqual(await sanctionedWallets([LISTED], 84532), []);
  await screenWallet(LISTED, 31337);
  assert.deepEqual(asked, []);
});

test('sanctions: fails closed when the oracle can not be read', async () => {
  setSanctionsOracle(async () => {
    throw new Error('rpc down');
  });
  await assert.rejects(
    screenWallet(CLEAN, BASE_MAINNET),
    /couldn't screen the wallet right now/,
  );
});

test('sanctions: award plans name the listed winner', async () => {
  setSanctionsOracle(stub);
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
