// Archived v2.12 (archive/starters): the build_help test that lived in programs.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHelp } from './programs-starters';

const earnkitCampaign = {
  kind: 'earnkit', prize: { token: '0x' + 'a'.repeat(40), symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 5, amount_each: '1', prize_usd_total: 500, metric: 'unique_wallets', min_score: 10,
} as const;

test('v2.4 §7: an EarnKit campaign\'s build help is the campaign starter, not the grants kit or x402', () => {
  const help = buildHelp(['base'], earnkitCampaign);
  assert.equal(help[0].url, 'https://github.com/earnkitai/chain-kits/tree/main/base/campaign');
  assert.equal(help[0].start, 'npx degit earnkitai/chain-kits/base/campaign my-entry');
  assert.match(help[0].use, /people call directly/);
  assert.match(help[0].use, /Builder Code/);
  assert.ok(!help.some((h) => /needed for Base grants|x402/.test(h.use)));
  const other = buildHelp(['base'], null);
  assert.ok(other.some((h) => /needed for Base grants/.test(h.use)));
});
