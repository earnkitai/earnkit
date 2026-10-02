import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRetry } from './send-retry';

const APPROVE = '0xapprove' as const;
const CREATE = '0xcreate' as const;
const AWARD = '0xaward' as const;

test('final hash submitted, receipt unknown -> retry (confirm with that hash)', () => {
  assert.deepEqual(decideRetry([APPROVE, CREATE], 2, false), {
    action: 'confirm',
    hash: CREATE,
  });
});

test('only an earlier step (approve) submitted -> fresh send is safe', () => {
  assert.deepEqual(decideRetry([APPROVE], 2, false), { action: 'fresh' });
  // Even if that earlier step is itself a confirmed revert, it's still not the last step.
  assert.deepEqual(decideRetry([APPROVE], 2, true), { action: 'fresh' });
});

test('the last step is a clean, confirmed revert -> fresh send is safe', () => {
  assert.deepEqual(decideRetry([APPROVE, CREATE], 2, true), {
    action: 'fresh',
  });
  // Single-step sequence (the award tx), reverted.
  assert.deepEqual(decideRetry([AWARD], 1, true), { action: 'fresh' });
});

test('success (the last step submitted and not reverted) -> retry/confirm path', () => {
  assert.deepEqual(decideRetry([AWARD], 1, false), {
    action: 'confirm',
    hash: AWARD,
  });
});

test('nothing submitted at all -> fresh send is safe', () => {
  assert.deepEqual(decideRetry([], 2, false), { action: 'fresh' });
});
