import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { entryMessage, entrySigner, signToEnter } from './entry-proof';

const agent = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'); // anvil #1
const PAYOUT = '0xAbCdEf0123456789abcdef0123456789ABCDEF01';
const PROGRAM = 'earnkit-campaign-1-base';
const C1 = '0x' + '1'.repeat(40);
const C2 = '0x' + '2'.repeat(40);
const C3 = '0x' + '3'.repeat(40);

test('entryMessage: program, normalized repo, lowercase payout wallet, sorted lowercase contracts (Ruling 23)', () => {
  assert.equal(
    entryMessage(PROGRAM, 'github.com/alice/tipjar', PAYOUT, [C2, C1.toUpperCase().replace('0X', '0x')]),
    `EarnKit entry: ${PROGRAM} github.com/alice/tipjar 0xabcdef0123456789abcdef0123456789abcdef01 ${C1},${C2}`,
  );
});

test('entrySigner recovers the deploying wallet from any spelling of the repo link and any contract order', async () => {
  const sig = await agent.signMessage({ message: entryMessage(PROGRAM, 'github.com/alice/tipjar', PAYOUT, [C1, C2]) });
  const me = agent.address.toLowerCase();
  assert.equal(await entrySigner(PROGRAM, 'https://github.com/Alice/TipJar.git', PAYOUT, [C1, C2], sig), me);
  assert.equal(await entrySigner(PROGRAM, 'github.com/alice/tipjar', PAYOUT.toLowerCase(), [C2, C1], sig), me);
  // Another repo, payout wallet, contract set or program recovers someone else.
  assert.notEqual(await entrySigner(PROGRAM, 'https://github.com/alice/other', PAYOUT, [C1, C2], sig), me);
  assert.notEqual(await entrySigner(PROGRAM, 'https://github.com/alice/tipjar', '0x' + 'cd'.repeat(20), [C1, C2], sig), me);
  assert.notEqual(await entrySigner(PROGRAM, 'https://github.com/alice/tipjar', PAYOUT, [C1, C3], sig), me);
  assert.notEqual(await entrySigner(PROGRAM, 'https://github.com/alice/tipjar', PAYOUT, [C1], sig), me);
  assert.notEqual(await entrySigner('other-campaign', 'https://github.com/alice/tipjar', PAYOUT, [C1, C2], sig), me);
  assert.equal(await entrySigner(PROGRAM, 'https://github.com/alice/tipjar', PAYOUT, [C1, C2], '0x1234'), null);
});

test('signToEnter: only once the repo, wallet and 1 to 5 contracts are known', () => {
  const repo = 'https://github.com/Alice/TipJar';
  assert.equal(
    signToEnter(PROGRAM, repo, PAYOUT, `${C2}, ${C1}`),
    entryMessage(PROGRAM, 'github.com/alice/tipjar', PAYOUT, [C1, C2]),
  );
  assert.equal(signToEnter(PROGRAM, undefined, PAYOUT, C1), null);
  assert.equal(signToEnter(PROGRAM, repo, null, C1), null);
  assert.equal(signToEnter(PROGRAM, repo, PAYOUT, undefined), null);
  assert.equal(signToEnter(PROGRAM, repo, PAYOUT, `${C1},nope`), null);
});
