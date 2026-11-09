import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEY_REMOVED, MAX_ARG_DEPTH, looksSecret, scrubSecrets, tooDeep } from './secrets';

const nested = (n: number, leaf: unknown = 'x') => {
  let v: unknown = leaf;
  for (let i = 0; i < n; i += 1) v = { a: v };
  return v;
};

test('B4: the scrubber stops at depth 64 and never overflows the stack, even 10,000 deep', () => {
  assert.equal(MAX_ARG_DEPTH, 64);
  const key = 'sk_live_' + 'a1'.repeat(12);
  assert.doesNotThrow(() => scrubSecrets(nested(10_000, key)));
  assert.deepEqual(scrubSecrets(nested(3, key)), { value: nested(3, KEY_REMOVED), removed: 1 });
});

test('B4: tooDeep is false at 64 levels and true past them, for objects and arrays, without recursing past the cap', () => {
  assert.equal(tooDeep(nested(63)), false);
  assert.equal(tooDeep(nested(64)), false);
  assert.equal(tooDeep(nested(65)), true);
  let arr: unknown = 1;
  for (let i = 0; i < 100_000; i += 1) arr = [arr];
  assert.equal(tooDeep(arr), true);
  assert.equal(tooDeep({ a: 'x', b: [1, 2, { c: null }] }), false);
});

test('B9: looksSecret holds for a key shape and for the scrubbed placeholder, not for plain text', () => {
  assert.equal(looksSecret('sk_live_' + 'a1'.repeat(12)), true);
  assert.equal(looksSecret(`Ada ${KEY_REMOVED}`), true);
  assert.equal(looksSecret('Ada Lovelace'), false);
});
