import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atomicBatching } from './wallet-batch';

test('atomicBatching: only "supported" or "ready" atomic status allows one signature', () => {
  assert.equal(atomicBatching({ atomic: { status: 'supported' } }), true);
  assert.equal(atomicBatching({ atomic: { status: 'ready' } }), true);
  assert.equal(atomicBatching({ atomic: { status: 'unsupported' } }), false);
  assert.equal(atomicBatching({}), false);
  assert.equal(atomicBatching(null), false);
  assert.equal(atomicBatching(undefined), false);
  assert.equal(atomicBatching({ atomic: true }), false);
  assert.equal(atomicBatching({ atomicBatch: { supported: true } }), false);
});
