import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Attribution } from 'ox/erc8021';
import { EARNKIT_BUILDER_CODE, codesIn } from './builder-code';

test("codesIn reads ERC-8021 codes off a transaction's input; anything else is none", () => {
  const suffix = Attribution.toDataSuffix({ codes: ['earnkit', 'bc_ab12cd34'] });
  const transfer = '0xa9059cbb' + '00'.repeat(64);
  assert.deepEqual(codesIn(transfer + suffix.slice(2)), ['earnkit', 'bc_ab12cd34']);
  assert.deepEqual(codesIn(transfer), []);
  assert.deepEqual(codesIn('0x'), []);
  assert.deepEqual(codesIn(undefined), []);
  assert.deepEqual(codesIn('0xzz'), []);
});

test("EarnKit's code defaults to earnkit", () => {
  assert.equal(EARNKIT_BUILDER_CODE, process.env.EARNKIT_BUILDER_CODE?.trim() || 'earnkit');
});
