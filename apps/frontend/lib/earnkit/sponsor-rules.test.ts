import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DraftInput,
  SponsorError,
  checkDraft,
  mapOffPlanAward,
  matchAwardToPlan,
  planAward,
  splitUnits,
  sponsorProgramFile,
} from './sponsor-rules';
import { ProgramFile } from './program-file';

const USDC = {
  symbol: 'USDC',
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  decimals: 6,
};
const now = new Date('2026-10-01T00:00:00Z');
const days = (n: number) =>
  new Date(now.getTime() + n * 86_400_000).toISOString();
const draft = DraftInput.parse({
  sponsor_name: 'Acme',
  sponsor_url: 'https://acme.xyz',
  title: 'Best x402 service on Base',
  theme:
    'Ship an x402 service on Base that other agents pay to use, with docs and a live link.',
  criteria:
    'Usage by other agents, code quality, and docs. We read every repo.',
  chains: ['base'],
  token: 'USDC',
  amount: '5000',
  winners: 3,
  ends_at: days(14),
});

test('a good draft passes and converts to token units', () => {
  assert.equal(
    checkDraft(draft, USDC, 10_000_000_000n, now).amountUnits,
    5_000_000_000n,
  );
});

test('rejects unknown tokens, over-cap pools, and bad windows', () => {
  assert.throws(() => checkDraft(draft, null, 10_000_000_000n, now), /token/);
  assert.throws(() => checkDraft(draft, USDC, 1_000_000_000n, now), /cap/);
  assert.throws(
    () =>
      checkDraft({ ...draft, ends_at: days(2) }, USDC, 10_000_000_000n, now),
    /3 to 90 days/,
  );
  assert.throws(
    () =>
      checkDraft({ ...draft, ends_at: days(91) }, USDC, 10_000_000_000n, now),
    /3 to 90 days/,
  );
});

test("rejects amounts finer than the token's decimals", () => {
  assert.throws(
    () =>
      checkDraft(
        { ...draft, amount: '100.1234567' },
        USDC,
        10_000_000_000n,
        now,
      ),
    /6 decimals/,
  );
});

test('text limits and http(s)-only sponsor links', () => {
  assert.throws(() => DraftInput.parse({ ...draft, title: 'x'.repeat(81) }));
  assert.throws(() =>
    DraftInput.parse({ ...draft, criteria: 'x'.repeat(1001) }),
  );
  assert.throws(() =>
    DraftInput.parse({ ...draft, sponsor_url: 'javascript:alert(1)' }),
  );
});

test("prize is exact for pools that don't divide by 10", () => {
  assert.deepEqual(splitUnits(100_000_001n), {
    prize: 90_000_001n,
    fee: 10_000_000n,
  });
  assert.deepEqual(splitUnits(5_000_000_000n), {
    prize: 4_500_000_000n,
    fee: 500_000_000n,
  });
});

test('the program file is valid and states the judging rule and requirements', () => {
  const p = sponsorProgramFile({
    ref: '0x' + 'a'.repeat(64),
    draft,
    token: USDC,
    amountUnits: 5_000_000_000n,
    chainId: 8453,
    escrow: '0x' + 'b'.repeat(40),
    baseUrl: 'https://earnkit.com',
    now,
  });
  assert.equal(ProgramFile.parse(p).id, 'sponsor-aaaaaaaa');
  assert.equal(
    p.summary,
    'by Acme · 5,000 USDC pool in escrow · closes Oct 15',
  );
  assert.equal(p.campaign?.kind, 'sponsor');
  if (p.campaign?.kind === 'sponsor')
    assert.equal(p.campaign.prize_total, '4500');
  assert.ok(p.rules.some((r) => /picks the winners/.test(r)));
  assert.ok(
    p.submission_requirements.some(
      (r) => r.key === 'payout_wallet' && r.required,
    ),
  );
  assert.ok(
    p.submission_requirements.some((r) => r.key === 'contracts' && !r.required),
  );
});

const entries = [
  { id: 11, payout_wallet: '0x' + '1'.repeat(40) },
  { id: 12, payout_wallet: '0x' + '2'.repeat(40) },
  { id: 13, payout_wallet: '0x' + '1'.repeat(40) }, // same builder, second entry
];

test('award plan must use real entries and add up exactly to the prize', () => {
  const ok = planAward({
    winners: [
      { entry_id: 11, amount: '3000', reason: 'Most used' },
      { entry_id: 12, amount: '1500', reason: 'Best docs' },
    ],
    entries,
    prizeUnits: 4_500_000_000n,
    decimals: 6,
  });
  assert.deepEqual(ok.amountsUnits, [3_000_000_000n, 1_500_000_000n]);
  assert.throws(
    () =>
      planAward({
        winners: [{ entry_id: 99, amount: '4500', reason: 'x x x' }],
        entries,
        prizeUnits: 4_500_000_000n,
        decimals: 6,
      }),
    /isn't an entry/,
  );
  assert.throws(
    () =>
      planAward({
        winners: [{ entry_id: 11, amount: '4499.999999', reason: 'x x x' }],
        entries,
        prizeUnits: 4_500_000_000n,
        decimals: 6,
      }),
    /add up to 4500/,
  );
  assert.throws(
    () =>
      planAward({
        winners: [
          { entry_id: 11, amount: '4500', reason: 'a' },
          { entry_id: 11, amount: '0', reason: 'b' },
        ],
        entries,
        prizeUnits: 4_500_000_000n,
        decimals: 6,
      }),
    /once/,
  );
});

test("rejects award amounts finer than the token's decimals", () => {
  assert.throws(
    () =>
      planAward({
        winners: [{ entry_id: 11, amount: '4499.9999995', reason: 'x x x' }],
        entries,
        prizeUnits: 4_500_000_000n,
        decimals: 6,
      }),
    /6 decimals/,
  );
});

test('an uneven prize needs an exact award, not just a close one', () => {
  const prizeUnits = splitUnits(100_000_001n).prize; // 90_000_001n
  const ok = planAward({
    winners: [{ entry_id: 11, amount: '90.000001', reason: 'Exactly right' }],
    entries,
    prizeUnits,
    decimals: 6,
  });
  assert.deepEqual(ok.amountsUnits, [90_000_001n]);
  assert.throws(
    () =>
      planAward({
        winners: [{ entry_id: 11, amount: '90.000002', reason: 'x x x' }],
        entries,
        prizeUnits,
        decimals: 6,
      }),
    /add up to 90.000001/,
  );
  assert.throws(
    () =>
      planAward({
        winners: [{ entry_id: 11, amount: '90', reason: 'x x x' }],
        entries,
        prizeUnits,
        decimals: 6,
      }),
    /add up to 90.000001/,
  );
});

test('matches award to entries by plan order, even with a repeated wallet', () => {
  const { plan } = planAward({
    winners: [
      { entry_id: 13, amount: '2000', reason: 'Second app is better' },
      { entry_id: 12, amount: '2500', reason: 'Most used' },
    ],
    entries,
    prizeUnits: 4_500_000_000n,
    decimals: 6,
  });
  const matched = matchAwardToPlan(
    plan,
    [entries[2].payout_wallet, entries[1].payout_wallet],
    [2_000_000_000n, 2_500_000_000n],
    6,
  );
  assert.deepEqual(
    matched.map((m) => m.entry_id),
    [13, 12],
  );
  assert.equal(matched[0].amount, '2000');
  assert.throws(
    () =>
      matchAwardToPlan(
        plan,
        [entries[1].payout_wallet, entries[2].payout_wallet],
        [2_500_000_000n, 2_000_000_000n],
        6,
      ),
    SponsorError,
  );
});

test('off-plan award: case-insensitive matching, a shared wallet mapped to distinct entries in order, and an unknown wallet flagged', () => {
  const wallet1 = entries[0].payout_wallet; // also entries[2]'s wallet (entries 11 and 13)
  const unknown = '0x' + '9'.repeat(40);
  const { offPlan, matched } = mapOffPlanAward(
    entries,
    [wallet1.toUpperCase(), wallet1, unknown],
    [1_000_000n, 2_000_000n, 500_000n],
    6,
  );
  assert.deepEqual(offPlan, [
    { wallet: wallet1.toLowerCase(), amount: '1', entry_id: 11 },
    { wallet: wallet1.toLowerCase(), amount: '2', entry_id: 13 },
    { wallet: unknown, amount: '0.5', entry_id: null },
  ]);
  assert.deepEqual(matched, [
    {
      entry_id: 11,
      amount: '1',
      reason: 'Paid by the sponsor (no reason given)',
    },
    {
      entry_id: 13,
      amount: '2',
      reason: 'Paid by the sponsor (no reason given)',
    },
  ]);
});
