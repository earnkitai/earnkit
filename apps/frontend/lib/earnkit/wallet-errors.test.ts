import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BaseError, UserRejectedRequestError } from 'viem';
import { walletErrorMessage } from './wallet-errors';

test('a plain Error keeps its message', () => {
  assert.equal(walletErrorMessage(new Error('boom')), 'boom');
});

test('a non-Error value is stringified', () => {
  assert.equal(walletErrorMessage('nope'), 'nope');
});

test('a viem BaseError is shortened to shortMessage, dropping the multi-line block', () => {
  const err = new BaseError('Something went wrong.', {
    metaMessages: ['Request Arguments:', '  from: 0x...'],
  });
  assert.equal(walletErrorMessage(err), 'Something went wrong.');
  assert.ok(
    err.message.includes('Request Arguments'),
    'sanity: message is the long form',
  );
});

test('a user rejection anywhere in the cause chain becomes a plain message', () => {
  const rejection = new UserRejectedRequestError(
    new Error('User rejected the request.'),
  );
  const wrapped = new BaseError('Could not send transaction.', {
    cause: rejection,
  });
  assert.equal(walletErrorMessage(wrapped), 'You cancelled in your wallet.');
});

test('a raw RPC code 4001 in the cause chain also counts as a rejection', () => {
  const cause = Object.assign(new Error('rejected'), { code: 4001 });
  const wrapped = new BaseError('Could not send transaction.', { cause });
  assert.equal(walletErrorMessage(wrapped), 'You cancelled in your wallet.');
});
