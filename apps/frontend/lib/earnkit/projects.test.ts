import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answersOf, missingAnswersProblem, selfEntryProblem } from './projects';
import { sponsorProgramFile } from './sponsor-rules';
import type { SubmissionRequirement } from './program-file';

const W = '0x' + 'a'.repeat(40);
const SPONSOR = '0x' + 'b'.repeat(40);

test('selfEntryProblem: the sponsor installation and the sponsor wallet cannot enter', () => {
  const sponsor = { installation_id: 7, sponsor_wallet: SPONSOR };
  assert.equal(
    selfEntryProblem(sponsor, 7, W),
    "You created this campaign, so you can't enter it.",
  );
  assert.equal(
    selfEntryProblem(sponsor, 8, SPONSOR.toUpperCase().replace('0X', '0x')),
    "payout_wallet: that's the sponsor's wallet, which can't enter its own campaign.",
  );
  assert.equal(selfEntryProblem(sponsor, 8, W), null);
  // EarnKit's own campaigns have no sponsor row.
  assert.equal(selfEntryProblem(null, 7, W), null);
});

test('answersOf: strings, lists joined', () => {
  assert.deepEqual(answersOf({ a: 'x', b: ['1', '2'], c: 3, d: null }), {
    a: 'x',
    b: '1, 2',
    c: '3',
  });
});

test('missingAnswersProblem: a sponsor campaign entry must answer every required field', () => {
  const reqs = sponsorProgramFile({
    ref: '0x' + 'a'.repeat(64),
    draft: {
      sponsor_name: 'Acme',
      title: 'Agents',
      what_to_build: 'Build agents.',
      criteria: 'Best one.',
      chains: ['base'],
      token: 'USDC',
      amount: '100',
      winners: 1,
      existing_work: 'allowed',
      ends_at: '2026-12-01T00:00:00Z',
    },
    token: {
      symbol: 'USDC',
      address: '0x' + 'c'.repeat(40),
      decimals: 6,
    } as never,
    amountUnits: 100_000_000n,
    chainId: 8453,
    escrow: '0x' + 'd'.repeat(40),
    baseUrl: 'https://earnkit.com',
    now: new Date('2026-10-01T00:00:00Z'),
  }).submission_requirements as SubmissionRequirement[];
  const project = {
    name: 'Alpha',
    description: 'An agent.',
    repo_url: 'https://github.com/a/alpha',
    live_url: 'https://alpha.app',
  };
  assert.equal(
    missingAnswersProblem(reqs, project, { payout_wallet: W }),
    null,
  );
  assert.equal(
    missingAnswersProblem(
      reqs,
      {
        name: 'Alpha',
        repo_url: 'https://github.com/a/alpha',
        live_url: 'nope',
      },
      { payout_wallet: W },
    ),
    'Missing required answers: description (What it does and who uses it), live_url (Live link: Not a valid http(s) link.). ' +
      'Call prepare_submission to see what each needs, then record_submission again.',
  );
  assert.match(
    missingAnswersProblem(reqs, project, {})!,
    /^Missing required answers: payout_wallet \(Payout wallet\)\./,
  );
});
