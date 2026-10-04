import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { entryMessage, entrySigner } from './entry-proof';

const agent = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'); // anvil #1
const PAYOUT = '0xAbCdEf0123456789abcdef0123456789ABCDEF01';

test('entryMessage: the normalized repo and the lowercase payout wallet', () => {
  assert.equal(
    entryMessage('github.com/alice/tipjar', PAYOUT),
    'EarnKit entry: github.com/alice/tipjar 0xabcdef0123456789abcdef0123456789abcdef01',
  );
});

test('entrySigner recovers the deploying wallet from any spelling of the repo link', async () => {
  const sig = await agent.signMessage({ message: entryMessage('github.com/alice/tipjar', PAYOUT) });
  const me = agent.address.toLowerCase();
  assert.equal(await entrySigner('https://github.com/Alice/TipJar.git', PAYOUT, sig), me);
  assert.equal(await entrySigner('github.com/alice/tipjar', PAYOUT.toLowerCase(), sig), me);
  // Another repo or another payout wallet recovers someone else.
  assert.notEqual(await entrySigner('https://github.com/alice/other', PAYOUT, sig), me);
  assert.notEqual(await entrySigner('https://github.com/alice/tipjar', '0x' + 'cd'.repeat(20), sig), me);
  assert.equal(await entrySigner('https://github.com/alice/tipjar', PAYOUT, '0x1234'), null);
});
