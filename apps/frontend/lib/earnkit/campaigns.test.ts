import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CampaignConfig as CampaignSchema,
  EntryError,
  entryStatus,
  minScore,
  normalizeRepoUrl,
  parseAddresses,
  presentYourEntries,
  prizeText,
  sameRepoEntry,
  validateEntry,
  isWalletAddress,
  normalizeLiveUrl,
  wonText,
  type CampaignConfig,
  type YourEntry,
} from './campaigns';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const W = '0x' + 'c'.repeat(40);
const window = {
  starts_at: new Date('2026-09-30T00:00:00Z'),
  ends_at: new Date('2026-10-14T23:59:00Z'),
};
const during = async () => 'during' as const;

test('parses comma, space, and array forms; dedupes; lowercases', () => {
  assert.deepEqual(
    parseAddresses(`${A.toUpperCase().replace('0X', '0x')}, ${B} ${A}`),
    [A, B],
  );
  assert.deepEqual(parseAddresses([A, B]), [A, B]);
  assert.deepEqual(parseAddresses(undefined), []);
});

test('valid entry', async () => {
  assert.deepEqual(
    await validateEntry({ contracts: `${A},${B}`, payout_wallet: W }, window, {
      status: during,
    }),
    {
      contracts: [A, B],
      payoutWallet: W,
    },
  );
});

test('rejects bad entries with a clear reason', async () => {
  const bad = async (
    data: Record<string, unknown>,
    deployed: (
      c: string,
    ) => Promise<'not_contract' | 'before_start' | 'during'> = during,
  ) =>
    assert.rejects(
      validateEntry(data, window, { status: deployed }),
      EntryError,
    );
  await bad({ payout_wallet: W }); // no contracts
  await bad({ contracts: 'nope', payout_wallet: W });
  await bad({ contracts: A, payout_wallet: 'nope' });
  await bad({ contracts: A, payout_wallet: W }, async () => 'not_contract'); // not a contract
  await bad({ contracts: A, payout_wallet: W }, async () => 'before_start'); // deployed before start
  await bad({
    contracts: Array.from(
      { length: 6 },
      (_, i) => '0x' + String(i).repeat(40),
    ).join(','),
    payout_wallet: W,
  });
});

const campaign: CampaignConfig = {
  kind: 'earnkit',
  prize: { token: A, symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 5,
  amount_each: '75000000',
  metric: 'unique_wallets',
  min_score: 10,
};

const sponsored: CampaignConfig = {
  kind: 'sponsor',
  prize: { token: A, symbol: 'USDC', decimals: 6, chain_id: 8453 },
  pool: '5000',
  prize_total: '4500',
  winners: 3,
  metric: 'unique_wallets',
  sponsor: { name: 'Acme', url: 'https://acme.xyz' },
  criteria: 'Most useful x402 service, judged on usage and code quality.',
  escrow: A,
  ref: '0x' + '1'.repeat(64),
};

test('both campaign kinds parse; a campaign without kind is rejected', () => {
  assert.equal(CampaignSchema.parse(campaign).kind, 'earnkit');
  assert.equal(CampaignSchema.parse(sponsored).kind, 'sponsor');
  const { kind: _drop, ...noKind } = campaign;
  assert.throws(() => CampaignSchema.parse(noKind));
});

test('prize and win text per kind', () => {
  assert.equal(prizeText(campaign), '75,000,000 MINI each to 5 winners');
  assert.equal(prizeText(sponsored), '5,000 USDC pool (4,500 to winners)');
  assert.equal(wonText(campaign, null), '75,000,000 MINI');
  assert.equal(wonText(sponsored, '1500.5'), '1,500.5 USDC');
  assert.equal(minScore(campaign), 10);
  assert.equal(minScore(sponsored), 0);
});

test('sponsor entries may skip contracts but still need a payout wallet', async () => {
  const window = { starts_at: new Date(0), ends_at: new Date() };
  const r = await validateEntry({ payout_wallet: W }, window, {
    requireContracts: false,
    status: async () => 'during',
  });
  assert.deepEqual(r, { contracts: [], payoutWallet: W.toLowerCase() });
  await assert.rejects(
    validateEntry({}, window, { requireContracts: false }),
    /payout_wallet/,
  );
});

test('entries show rank while running and the prize once paid; wins announce once', () => {
  const lastCheck = new Date('2026-10-15T00:00:00Z');
  const { section, wins } = presentYourEntries(
    [
      {
        name: 'Alpha',
        campaign_title: 'C1',
        campaign,
        ends_at: null,
        sponsor_state: null,
        score: 41,
        rank: 3,
        entries: 12,
        prize_tx: null,
        prize_paid_at: null,
        prize_amount: null,
      },
      {
        name: 'Beta',
        campaign_title: 'C1',
        campaign,
        ends_at: null,
        sponsor_state: null,
        score: 90,
        rank: 1,
        entries: 12,
        prize_tx: '0xabc',
        prize_paid_at: new Date('2026-10-16T00:00:00Z'),
        prize_amount: null,
      },
      {
        name: 'Gamma',
        campaign_title: 'C1',
        campaign,
        ends_at: null,
        sponsor_state: null,
        score: null,
        rank: 12,
        entries: 12,
        prize_tx: null,
        prize_paid_at: null,
        prize_amount: null,
      },
    ],
    lastCheck,
  );
  assert.match(section!, /Alpha: #3 of 12 in C1 · 41 wallets \(min 10\)/);
  assert.match(section!, /Beta: you won 75,000,000 MINI in C1 \(tx 0xabc\)/);
  assert.match(section!, /Gamma: #12 of 12 in C1 · not scored yet/);
  assert.deepEqual(wins, ['you won 75,000,000 MINI with Beta']);
  assert.deepEqual(presentYourEntries([], null), { section: null, wins: [] });
});

test('normalizeRepoUrl: scheme, www., query, fragment, trailing "/" or ".git", /tree/ and case are ignored', () => {
  const want = 'github.com/x/a';
  for (const u of [
    'https://github.com/x/a',
    'http://github.com/x/a',
    'github.com/x/a',
    '//github.com/x/a',
    'git+https://github.com/x/a.git',
    'git+ssh://git@github.com/x/a.git',
    'https://GitHub.com/X/A',
    'https://www.github.com/x/a',
    'www.github.com/x/a',
    'https://github.com/x/a/',
    'https://github.com/x/a.git',
    'https://github.com/x/a.git/',
    'https://github.com/x/a?tab=readme',
    'https://github.com/x/a#readme',
    'https://github.com/x/a/tree/main',
    'https://github.com/x/a/tree/feature/x?y=1#z',
    '  https://www.github.com/x/a.git//  ',
  ])
    assert.equal(normalizeRepoUrl(u), want, u);
  // The duplicate the controller's rerun let in.
  assert.equal(
    normalizeRepoUrl('http://www.GitHub.com/b1/x402-weather.git/'),
    normalizeRepoUrl('https://github.com/b1/x402-weather'),
  );
  // Other repos stay different.
  assert.notEqual(normalizeRepoUrl('https://github.com/x/ab'), want);
  assert.notEqual(normalizeRepoUrl('https://github.com/x/a-git'), want);
  assert.notEqual(normalizeRepoUrl('https://github.com/y/a'), want);
  assert.notEqual(normalizeRepoUrl('https://gitlab.com/x/a'), want);
});

test('sameRepoEntry finds the entry with the same normalized repo, ignoring entries without one', () => {
  const entries = [
    { id: 1, name: 'Alpha', repo_url: null },
    { id: 2, name: 'Beta', repo_url: 'https://github.com/x/b' },
  ];
  assert.equal(
    sameRepoEntry('https://www.github.com/X/B.git/', entries)?.id,
    2,
  );
  assert.equal(sameRepoEntry('https://github.com/x/c', entries), undefined);
});

const yours = (over: Partial<YourEntry>): YourEntry => ({
  name: 'Alpha',
  campaign_title: 'S1',
  campaign: sponsored,
  ends_at: new Date('2026-10-06T06:51:00Z'),
  sponsor_state: 'live',
  score: null,
  rank: 2,
  entries: 3,
  prize_tx: null,
  prize_paid_at: null,
  prize_amount: null,
  ...over,
});

test('sponsor entries: no rank unless scored; status by campaign state', () => {
  const lines = presentYourEntries(
    [
      yours({}),
      yours({ name: 'Beta', score: 7 }),
      yours({ name: 'Gamma', sponsor_state: 'awarded' }),
      yours({ name: 'Delta', sponsor_state: 'refunded' }),
      yours({ name: 'Eps', sponsor_state: 'taken_down' }),
      yours({
        name: 'Zeta',
        sponsor_state: 'awarded',
        prize_tx: '0xabc',
        prize_amount: '60',
      }),
    ],
    null,
  )
    .section!.split('\n')
    .slice(2);
  assert.deepEqual(lines, [
    'Alpha in "S1": entered · winners picked after Oct 6, 2026, 06:51 UTC',
    'Beta in "S1": #2 of 3 · 7 wallets · winners picked after Oct 6, 2026, 06:51 UTC',
    'Gamma in "S1": not picked this time',
    'Delta in "S1": no winners; the sponsor was refunded',
    'Eps in "S1": removed by EarnKit; the sponsor was refunded',
    'Zeta: you won 60 USDC in "S1" (tx 0xabc)',
  ]);
});

test('entryStatus: sponsor states and EarnKit eligibility', () => {
  const e = { prize_tx: null, prize_amount: null, score: null };
  assert.equal(entryStatus(sponsored, e, 'live'), 'entered');
  assert.equal(entryStatus(sponsored, e, 'awarded'), 'not picked');
  assert.equal(
    entryStatus(sponsored, e, 'refunded'),
    'no winners — sponsor refunded',
  );
  assert.equal(
    entryStatus(
      sponsored,
      { ...e, prize_tx: '0x1', prize_amount: '60' },
      'awarded',
    ),
    'won 60 USDC',
  );
  assert.equal(entryStatus(campaign, { ...e, score: 10 }, null), 'eligible');
  assert.equal(entryStatus(campaign, { ...e, score: 9 }, null), 'building');
  assert.equal(
    entryStatus(campaign, { ...e, prize_tx: '0x1' }, null),
    'won 75,000,000 MINI',
  );
});

test('payout_wallet: mixed case must be a valid checksum; never zero or an entered contract', async () => {
  const opts = { requireContracts: false, status: during };
  const checksummed = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  assert.equal(isWalletAddress(checksummed), true);
  assert.equal(isWalletAddress(checksummed.toLowerCase()), true);
  assert.equal(
    isWalletAddress('0x' + 'F39FD6E51AAD88F6F4CE6AB8827279CFFFB92266'),
    true,
  );
  const typo = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92267';
  assert.equal(isWalletAddress(typo), false);
  assert.equal(isWalletAddress('0x' + '0'.repeat(40)), false);
  assert.deepEqual(
    (await validateEntry({ payout_wallet: checksummed }, window, opts))
      .payoutWallet,
    checksummed.toLowerCase(),
  );
  await assert.rejects(
    validateEntry({ payout_wallet: typo }, window, opts),
    /payout_wallet: .* has a wrong checksum/,
  );
  await assert.rejects(
    validateEntry({ payout_wallet: '0x' + '0'.repeat(40) }, window, opts),
    /never take it from the code/,
  );
  await assert.rejects(
    validateEntry({ contracts: A, payout_wallet: A }, window, {
      status: during,
    }),
    /can't be one of the entry's contracts/,
  );
});

test('normalizeLiveUrl: scheme, www, trailing slash, query and fragment are dropped', () => {
  for (const u of [
    'https://app.xyz',
    'HTTP://www.App.xyz/',
    'https://app.xyz/?ref=x#top',
    '//user@app.xyz//',
  ])
    assert.equal(normalizeLiveUrl(u), 'app.xyz', u);
  assert.equal(normalizeLiveUrl('https://app.xyz/demo/?a=1'), 'app.xyz/demo');
  assert.notEqual(
    normalizeLiveUrl('https://app.xyz/a'),
    normalizeLiveUrl('https://app.xyz/b'),
  );
});
