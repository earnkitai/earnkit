import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BaseError, TransactionReceiptNotFoundError } from 'viem';
import { z } from 'zod';
import { EntryError } from './campaigns';
import { EscrowConfigError } from './escrow';
import { SponsorError } from './sponsor-rules';
import {
  USAGE,
  cliErrorLine,
  fallbackProblem,
  operatorKeyProblem,
} from './cli';

test('cliErrorLine: our errors by message, viem by shortMessage, all on one line', () => {
  assert.equal(
    cliErrorLine(new SponsorError('This campaign is awarded.')),
    'This campaign is awarded.',
  );
  assert.equal(
    cliErrorLine(new EntryError('repo_url: already entered.')),
    'repo_url: already entered.',
  );
  assert.equal(
    cliErrorLine(new EscrowConfigError('ESCROW_CHAIN is bad')),
    'ESCROW_CHAIN is bad',
  );
  const viem = new BaseError('Execution reverted: NotEnded', {
    details: 'long details\nwith lines',
  });
  assert.equal(cliErrorLine(viem), 'Execution reverted: NotEnded');
  assert.match(
    cliErrorLine(
      new TransactionReceiptNotFoundError({ hash: `0x${'1'.repeat(64)}` }),
    ),
    /isn't confirmed yet/,
  );
  assert.equal(cliErrorLine(new Error('first\n  second')), 'first second');
  assert.equal(cliErrorLine('plain'), 'plain');
  const zod = z.object({ a: z.number() }).safeParse({ a: 'x' });
  assert.match(cliErrorLine(zod.error), /^Invalid input: a: /);
});

test('operatorKeyProblem: missing or malformed keys get a clear message', () => {
  assert.equal(
    operatorKeyProblem(undefined),
    'Set OPERATOR_PRIVATE_KEY in your local shell.',
  );
  assert.equal(
    operatorKeyProblem('abc'),
    'OPERATOR_PRIVATE_KEY must be 0x followed by 64 hex characters.',
  );
  assert.equal(
    operatorKeyProblem(`0x${'a'.repeat(63)}`),
    operatorKeyProblem('abc'),
  );
  assert.equal(operatorKeyProblem(`0x${'aB'.repeat(32)}`), null);
});

test('fallbackProblem: refuses before endsAt + 7 days with the opening date', () => {
  const endsAt = BigInt(Date.parse('2026-10-06T06:51:00Z') / 1000);
  const grace = 7n * 86_400n;
  assert.equal(
    fallbackProblem(endsAt, grace, endsAt + grace - 1n),
    'The fallback opens on Oct 13, 2026, 06:51 UTC.',
  );
  assert.equal(fallbackProblem(endsAt, grace, endsAt + grace), null);
});

test('USAGE lists every command', () => {
  for (const c of ['score', 'rank', 'payout', 'award', 'refund', 'sync'])
    assert.match(USAGE, new RegExp(`\\n  ${c} +<`));
});
