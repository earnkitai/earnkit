import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { FUNDS_FAIL_TTL_MS, FUNDS_TTL_MS, clearFundsMemo, prizeFunds } from './funds';
import { BASE_MAINNET, screenedWallets, setSanctionsOracle } from './sanctions';

const KEY = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';
const terms = { prize: { token: '0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07', symbol: 'MINI', decimals: 18 } };

afterEach(() => {
  clearFundsMemo();
  delete process.env.CAMPAIGN_PAYOUT_PRIVATE_KEY;
});

const clock = () => {
  let t = 1_000_000;
  return { now: () => t, tick: (ms: number) => { t += ms; } };
};

test('prizeFunds: two views within 60 s make one read; concurrent views share it; fresh reads now', async () => {
  process.env.CAMPAIGN_PAYOUT_PRIVATE_KEY = KEY;
  const c = clock();
  let reads = 0;
  const read = async () => { reads++; await new Promise((r) => setTimeout(r, 10)); return 1234n * 10n ** 18n; };
  const [a, b] = await Promise.all([prizeFunds(terms, { read, now: c.now }), prizeFunds(terms, { read, now: c.now })]);
  assert.equal(reads, 1);
  assert.deepEqual(a, b);
  assert.equal(a?.balance, '1234');
  assert.equal(a?.symbol, 'MINI');
  c.tick(FUNDS_TTL_MS - 1);
  await prizeFunds(terms, { read, now: c.now });
  assert.equal(reads, 1);
  c.tick(2);
  await prizeFunds(terms, { read, now: c.now });
  assert.equal(reads, 2);
  await prizeFunds(terms, { read, now: c.now, fresh: true });
  assert.equal(reads, 3);
});

test('prizeFunds: a failed read is null and cached 15 s; no payout key is null without a read', async () => {
  const c = clock();
  let reads = 0;
  const read = async () => { reads++; throw new Error('timeout'); };
  assert.equal(await prizeFunds(terms, { read, now: c.now }), null);
  assert.equal(reads, 0);
  process.env.CAMPAIGN_PAYOUT_PRIVATE_KEY = KEY;
  assert.equal(await prizeFunds(terms, { read, now: c.now }), null);
  c.tick(FUNDS_FAIL_TTL_MS - 1);
  assert.equal(await prizeFunds(terms, { read, now: c.now }), null);
  assert.equal(reads, 1);
  c.tick(2);
  await prizeFunds(terms, { read, now: c.now });
  assert.equal(reads, 2);
});

test('screenedWallets: says whether the screen ran (the dry run prints "sanctions not screened")', async () => {
  try {
    setSanctionsOracle({ chainId: async () => BASE_MAINNET, isSanctioned: async (w) => w.endsWith('1') });
    assert.deepEqual(await screenedWallets([`0x${'e'.repeat(39)}1`], BASE_MAINNET), { listed: [`0x${'e'.repeat(39)}1`], screened: true });
    setSanctionsOracle({ chainId: async () => { throw new Error('down'); }, isSanctioned: async () => false });
    assert.deepEqual(await screenedWallets([`0x${'e'.repeat(39)}2`], BASE_MAINNET), { listed: [], screened: false });
  } finally {
    setSanctionsOracle(null);
  }
});
