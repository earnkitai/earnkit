import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  atomicBatching,
  batchStatusProblem,
  batchUnsupported,
} from './wallet-batch';

test('atomicBatching: only "supported" on the chain (or on all chains) allows one signature', () => {
  const on = (status: unknown, chain = 8453) => ({
    [chain]: { atomic: { status } },
  });
  assert.equal(atomicBatching(on('supported'), 8453), true);
  // "ready" would upgrade the account (EIP-7702) without telling the sponsor: sequential.
  assert.equal(atomicBatching(on('ready'), 8453), false);
  assert.equal(atomicBatching(on('unsupported'), 8453), false);
  assert.equal(atomicBatching(on('supported', 1), 8453), false);
  // Chain-agnostic capabilities (0x0), and the chain's own answer winning over them.
  assert.equal(atomicBatching(on('supported', 0), 8453), true);
  assert.equal(
    atomicBatching(
      {
        0: { atomic: { status: 'supported' } },
        8453: { atomic: { status: 'unsupported' } },
      },
      8453,
    ),
    false,
  );
  assert.equal(atomicBatching({}, 8453), false);
  assert.equal(atomicBatching(null, 8453), false);
  assert.equal(atomicBatching(undefined, 8453), false);
  assert.equal(atomicBatching({ 8453: { atomic: true } }, 8453), false);
  assert.equal(
    atomicBatching({ 8453: { atomicBatch: { supported: true } } }, 8453),
    false,
  );
});

test('batchUnsupported: EIP-5792 57xx codes anywhere in the cause chain', () => {
  for (const code of [5700, 5710, 5720, 5760])
    assert.equal(batchUnsupported({ cause: { code } }), true);
  assert.equal(batchUnsupported({ code: 4001 }), false);
  assert.equal(batchUnsupported(new Error('x')), false);
  assert.equal(batchUnsupported(null), false);
});

test('batchStatusProblem: 4xx not sent, 5xx/6xx reverted, success or unknown is no problem', () => {
  assert.equal(batchStatusProblem(200), null);
  assert.equal(batchStatusProblem(100), null);
  assert.equal(batchStatusProblem(undefined), null);
  assert.match(batchStatusProblem(400)!, /didn't send it/);
  assert.match(batchStatusProblem(500)!, /reverted onchain/);
  assert.match(batchStatusProblem(600)!, /reverted onchain/);
});
