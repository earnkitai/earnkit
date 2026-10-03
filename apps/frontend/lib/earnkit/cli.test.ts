import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BaseError, ContractFunctionRevertedError } from 'viem';
import { z } from 'zod';
import { EntryError } from './campaigns';
import { EscrowConfigError } from './escrow';
import { SponsorError } from './sponsor-rules';
import {
  USAGE,
  cliErrorLine,
  executeProblem,
  fallbackProblem,
  guardianKeyProblem,
  operatorKeyProblem,
  parseFallbackPicks,
  privateKeyProblem,
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
  const revert = new BaseError(
    'The contract function "vetoFallback" reverted.',
    {
      cause: Object.assign(
        new ContractFunctionRevertedError({
          abi: [{ type: 'error', name: 'NotAllowed', inputs: [] }],
          data: '0x3d693ada',
          functionName: 'vetoFallback',
        }),
      ),
    },
  );
  assert.equal(
    cliErrorLine(revert),
    'The contract function "vetoFallback" reverted: NotAllowed.',
  );
  // By shape, not instanceof (a script's viem may be another module instance).
  assert.equal(
    cliErrorLine({ shortMessage: 'Short.', message: 'long\nlong' }),
    'Short.',
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
  for (const c of ['score', 'rank', 'payout', 'refund'])
    assert.match(USAGE, new RegExp(`\\n  ${c} +<`));
  for (const c of ['propose', 'execute', 'veto'])
    assert.match(USAGE, new RegExp(`\\n  fallback ${c} +<ref>`));
  assert.match(USAGE, /\n  sync +\[<ref>\]/);
  assert.doesNotMatch(USAGE, /--tx|\n  award /);
});

test('executeProblem: refuses before the 72-hour delay with the execute time', () => {
  const at = BigInt(Date.parse('2026-10-16T06:51:00Z') / 1000);
  assert.equal(
    executeProblem(at, at - 1n),
    'The fallback can be executed from Oct 16, 2026, 06:51 UTC.',
  );
  assert.equal(executeProblem(at, at), null);
});

test('guardianKeyProblem names GUARDIAN_PRIVATE_KEY', () => {
  assert.equal(
    guardianKeyProblem(undefined),
    'Set GUARDIAN_PRIVATE_KEY in your local shell.',
  );
});

test('privateKeyProblem checks PAYOUT_PRIVATE_KEY the same way, by name', () => {
  assert.equal(
    privateKeyProblem('PAYOUT_PRIVATE_KEY', '0x1234'),
    'PAYOUT_PRIVATE_KEY must be 0x followed by 64 hex characters.',
  );
  assert.equal(
    privateKeyProblem('PAYOUT_PRIVATE_KEY', undefined),
    'Set PAYOUT_PRIVATE_KEY in your local shell.',
  );
  assert.equal(
    privateKeyProblem('PAYOUT_PRIVATE_KEY', `0x${'1'.repeat(64)}`),
    null,
  );
});

test('parseFallbackPicks: a ranking with an optional split, or exact picks', () => {
  assert.deepEqual(parseFallbackPicks('12,7,3', undefined), {
    winners: [12, 7, 3],
  });
  assert.deepEqual(parseFallbackPicks('12,7', 'equal'), {
    winners: [12, 7],
    split: 'equal',
  });
  assert.deepEqual(parseFallbackPicks('12,7,3', '50,30,20'), {
    winners: [12, 7, 3],
    split: [50, 30, 20],
  });
  assert.deepEqual(
    parseFallbackPicks('12:60:Best docs: really,7:30', undefined),
    {
      winners: [
        { entry_id: 12, amount: '60', reason: 'Best docs: really' },
        { entry_id: 7, amount: '30' },
      ],
    },
  );
  assert.throws(
    () => parseFallbackPicks(undefined, undefined),
    /Name the winners/,
  );
  assert.throws(
    () => parseFallbackPicks('12,x', undefined),
    /"x" isn't an entry id/,
  );
  assert.throws(() => parseFallbackPicks('12,7', '50,abc'), /whole percentage/);
  assert.throws(
    () => parseFallbackPicks('12:60', 'equal'),
    /only for a ranking/,
  );
  assert.throws(
    () => parseFallbackPicks('12:', undefined),
    /needs <id>:<amount>/,
  );
  assert.match(USAGE, /--winners <id>,<id>,\.\.\. \[--split equal\|<pct>/);
});

test('parseFallbackPicks: 0% and over-100% splits refused; an empty reason gets the default', () => {
  assert.throws(() => parseFallbackPicks('12,7', '0,100'), /from 1 to 100/);
  assert.throws(() => parseFallbackPicks('12,7', '101,1'), /from 1 to 100/);
  assert.deepEqual(parseFallbackPicks('12:60:', undefined), {
    winners: [{ entry_id: 12, amount: '60' }],
  });
});
