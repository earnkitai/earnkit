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
  prizeColumn,
  prizeText,
  prizeUsdEach,
  sameRepoEntry,
  usd,
  validateEntry,
  isWalletAddress,
  normalizeLiveUrl,
  wonText,
  wonUsdText,
  payoutBy,
  firstPageParams,
  needsScore,
  scoreEntry,
  scoreIsFinal,
  walletsUsing,
  internalCallers,
  walletHistory,
  ENTRY_POINTS,
  INTERNAL_MAX_PAGES,
  USER_OP_EVENT,
  userOpsIn,
  type InternalPage,
  type TxPage,
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
  prize_usd_total: 500,
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
  assert.equal(prizeText(campaign), '$100 each to the top 5 (75,000,000 MINI each)');
  assert.equal(prizeColumn(campaign), '$100 each to top 5 (in MINI)');
  assert.equal(prizeColumn(sponsored), '5,000 USDC pool (4,500 to winners)');
  assert.equal(prizeUsdEach(campaign), 100);
  assert.equal(wonUsdText(campaign, null), '$100 in MINI');
  assert.equal(wonUsdText(sponsored, '1500.5'), '1,500.5 USDC');
  assert.equal(usd(5000), '$5,000');
  assert.equal(usd(2.5), '$2.5');
  assert.equal(
    payoutBy(new Date('2026-10-18T23:59:00Z')).toISOString(),
    '2026-10-21T02:14:00.000Z',
  );
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
  assert.equal(entryStatus(campaign, e, null), 'not scored yet');
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

test('needsScore / scoreIsFinal: provisional until a full-window score taken after the grace', () => {
  const H = 3_600_000;
  const end = new Date('2026-10-10T00:00:00Z');
  const at = (iso: string) => new Date(iso);
  const later = at('2026-12-01T00:00:00Z');
  // Before the end: refreshed every 6 h.
  assert.equal(
    needsScore(null, null, end, at('2026-10-05T00:00:00Z'), 6 * H),
    true,
  );
  const t0 = at('2026-10-05T00:00:00Z');
  assert.equal(
    needsScore(t0, t0, end, at('2026-10-05T05:00:00Z'), 6 * H),
    false,
  );
  assert.equal(
    needsScore(t0, t0, end, at('2026-10-05T06:00:00Z'), 6 * H),
    true,
  );
  // The review's case: reads started at 23:59 (covering through 23:59) and saved after the end
  // are provisional, and replaced.
  const t1 = at('2026-10-09T23:59:00Z');
  assert.equal(scoreIsFinal(t1, t1, end), false);
  assert.equal(needsScore(t1, t1, end, later, 6 * H), true);
  // Taken 1 s after the end (explorer lag): covers the window but isn't final yet.
  const t2 = at('2026-10-10T00:00:01Z');
  assert.equal(scoreIsFinal(t2, end, end), false);
  assert.equal(
    needsScore(t2, end, end, at('2026-10-10T00:05:00Z'), 6 * H),
    false,
  );
  assert.equal(
    needsScore(t2, end, end, at('2026-10-10T00:15:00Z'), 6 * H),
    true,
  );
  // Taken 15 min after the end and covering it: final, never again.
  const t3 = at('2026-10-10T00:15:00Z');
  assert.equal(scoreIsFinal(t3, end, end), true);
  assert.equal(needsScore(t3, end, end, later, 6 * H), false);
  // A cut-short read (scored_through null) is always redone, even after the grace.
  assert.equal(needsScore(t3, null, end, later, 6 * H), true);
});

test('scoreEntry: a deadline stops the reads and the per-wallet history loop', async () => {
  const newest = new Date(Date.now() - 1000);
  const slowHistory = async () => {
    await new Promise((r) => setTimeout(r, 30));
    return 'eoa' as const;
  };
  const ex = fakeExplorer(3, newest);
  const started = Date.now();
  const r = await scoreEntry(
    ['0xc'],
    new Date(0),
    new Date(Date.now() + 60_000),
    {
      deadline: Date.now() + 100,
      fetchPage: ex.fetchPage,
      fetchInternal: noInternal,
      blockAt: async () => 1n,
      history: slowHistory,
    },
  );
  assert.ok(Date.now() - started < 400, 'returned near the deadline');
  assert.equal(r.timedOut, true);
  assert.equal(r.complete, false);
  assert.ok(
    r.score < 7 && r.seen === 7,
    `partial count: ${r.score} of ${r.seen}`,
  );
  // A page read past the deadline is refused too.
  const r2 = await scoreEntry(
    ['0xc'],
    new Date(0),
    new Date(Date.now() + 60_000),
    {
      deadline: Date.now() - 1,
      fetchPage: fakeExplorer(3, newest).fetchPage,
      fetchInternal: noInternal,
      blockAt: async () => 1n,
      history: async () => 'eoa' as const,
    },
  );
  assert.deepEqual([r2.timedOut, r2.score, r2.seen], [true, 0, 0]);
  // No deadline: everything counted.
  const r3 = await scoreEntry(
    ['0xc'],
    new Date(0),
    new Date(Date.now() + 60_000),
    {
      fetchPage: fakeExplorer(3, newest).fetchPage,
      fetchInternal: noInternal,
      blockAt: async () => 1n,
      history: async () => 'eoa' as const,
    },
  );
  assert.deepEqual([r3.timedOut, r3.complete, r3.score], [false, true, 7]);
});

test('firstPageParams: an ended window starts at its end block (Blockscout keyset cursor)', () => {
  assert.equal(firstPageParams(), 'filter=to');
  assert.equal(
    firstPageParams(123n),
    'filter=to&block_number=123&index=0&items_count=50',
  );
});

/** A fake explorer: `pages` pages of 50 txs, newest first, one a minute back from `newest`. */
function fakeExplorer(
  pages: number,
  newest: Date,
  from = (i: number) => `0x${(i % 7).toString(16).padStart(40, '0')}`,
) {
  const calls: string[] = [];
  const fetchPage = async (path: string): Promise<TxPage> => {
    calls.push(path);
    const page = calls.length - 1;
    return {
      items: Array.from({ length: 50 }, (_, j) => {
        const i = page * 50 + j;
        return {
          timestamp: new Date(newest.getTime() - i * 60_000).toISOString(),
          status: 'ok',
          from: { hash: from(i) },
        };
      }),
      next_page_params:
        page + 1 < pages
          ? { block_number: 1000 - page, index: 0, items_count: 50 }
          : null,
    };
  };
  return { calls, fetchPage };
}

test('walletsUsing: pages past the old 40-page cutoff back to the window start', async () => {
  const newest = new Date('2026-10-10T00:00:00Z');
  // 100 pages = 5,000 txs over ~83 h; the window covers all of it, so all pages are read.
  const ex = fakeExplorer(100, newest);
  const r = await walletsUsing(
    '0xc',
    new Date(newest.getTime() - 6 * 86_400_000),
    newest,
    { fetchPage: ex.fetchPage },
  );
  assert.equal(ex.calls.length, 100);
  assert.equal(r.complete, true);
  assert.equal(r.wallets.size, 7);
});

test('walletsUsing: stops at the window start, and at maxPages with complete=false', async () => {
  const newest = new Date('2026-10-10T00:00:00Z');
  const early = fakeExplorer(100, newest);
  const r1 = await walletsUsing(
    '0xc',
    new Date(newest.getTime() - 120 * 60_000), // 2 h: inside page 3
    newest,
    { fetchPage: early.fetchPage },
  );
  assert.equal(early.calls.length, 3);
  assert.equal(r1.complete, true);

  const capped = fakeExplorer(100, newest);
  const r2 = await walletsUsing('0xc', new Date(0), newest, {
    fetchPage: capped.fetchPage,
    maxPages: 10,
    startBlock: 999n,
  });
  assert.equal(capped.calls.length, 10);
  assert.equal(r2.complete, false);
  assert.match(capped.calls[0], /block_number=999&index=0/);
  assert.match(capped.calls[1], /block_number=1000/);
});

test('existing work allowed: a contract deployed before the start is accepted; new_work_only refuses it', async () => {
  const before = async () => 'before_start' as const;
  assert.deepEqual(
    await validateEntry({ contracts: A, payout_wallet: W }, window, {
      allowExisting: true,
      status: before,
    }),
    { contracts: [A], payoutWallet: W },
  );
  await assert.rejects(
    validateEntry({ contracts: A, payout_wallet: W }, window, {
      allowExisting: false,
      status: before,
    }),
    /deployed before the campaign started/,
  );
  // Not a contract is refused either way.
  await assert.rejects(
    validateEntry({ contracts: A, payout_wallet: W }, window, {
      allowExisting: true,
      status: async () => 'not_contract',
    }),
    /isn't a contract/,
  );
});

const noInternal = async (): Promise<InternalPage> => ({ items: [], next_page_params: null });
const at = (h: number) => new Date(Date.UTC(2026, 9, 5, h)).toISOString();
const page = <T,>(items: T[]) => ({ items, next_page_params: null });

test('internalCallers: successful calls inside the window only', async () => {
  const r = await internalCallers('0xc', new Date(Date.UTC(2026, 9, 5, 1)), new Date(Date.UTC(2026, 9, 5, 20)), {
    fetchPage: async (path) => {
      assert.match(path, /^\/api\/v2\/addresses\/0xc\/internal-transactions\?filter=to$/);
      return page([
        { timestamp: at(10), success: true, type: 'call', from: { hash: '0xAA' } },
        { timestamp: at(9), success: false, type: 'call', from: { hash: '0xbb' } },
        { timestamp: at(8), success: true, type: 'delegatecall', from: { hash: '0xcc' } },
        { timestamp: at(21), success: true, type: 'call', from: { hash: '0xdd' } },
        { timestamp: at(0), success: true, type: 'call', from: { hash: '0xee' } },
      ]) as InternalPage;
    },
  });
  assert.deepEqual([...r.wallets], ['0xaa']);
  assert.equal(r.complete, true);
});

test('walletHistory: EOAs need 3+ transactions before the start; smart accounts must have existed', async () => {
  const rpc = (code: { now: string; then: string }, nonce: number) =>
    ({
      getCode: async ({ blockNumber }: { blockNumber?: bigint }) => (blockNumber === undefined ? code.now : code.then),
      getTransactionCount: async () => nonce,
    }) as never;
  assert.equal(await walletHistory('0x1', 5n, rpc({ now: '0x', then: '0x' }, 2)), null);
  assert.equal(await walletHistory('0x1', 5n, rpc({ now: '0x', then: '0x' }, 3)), 'eoa');
  assert.equal(await walletHistory('0x1', 5n, rpc({ now: '0x6080', then: '0x6080' }, 0)), 'smart');
  assert.equal(await walletHistory('0x1', 5n, rpc({ now: '0x6080', then: '0x' }, 0)), null);
  // An EIP-7702 delegated EOA has code "0xef0100<address>": still an EOA.
  assert.equal(await walletHistory('0x1', 5n, rpc({ now: '0xef0100' + 'ab'.repeat(20), then: '0x' }, 4)), 'eoa');
});

test('scoreEntry v2: internal callers count; the payout wallet, deployers, contracts and EntryPoints never do', async () => {
  const C = '0x' + 'c'.repeat(40);
  const USER = '0x' + '1'.repeat(40);
  const SMART = '0x' + '2'.repeat(40);
  const PAYOUT = '0x' + '3'.repeat(40);
  const DEPLOYER = '0x' + '4'.repeat(40);
  const NEW = '0x' + '5'.repeat(40);
  const from = new Date(Date.UTC(2026, 9, 5, 0));
  const to = new Date(Date.UTC(2026, 9, 6, 0));
  const r = await scoreEntry([C], from, to, {
    blockAt: async () => 1n,
    fetchPage: async () =>
      page([USER, PAYOUT, DEPLOYER, NEW, C].map((w, i) => ({ timestamp: at(10 + i), status: 'ok', from: { hash: w } }))) as TxPage,
    fetchInternal: async () =>
      page([SMART, ENTRY_POINTS[1]].map((w) => ({ timestamp: at(12), success: true, type: 'call', from: { hash: w }, transaction_hash: '0xops' }))) as InternalPage,
    userOps: async () => [{ entryPoint: ENTRY_POINTS[1], sender: SMART, success: true }],
    epNonce: async () => 5n,
    history: async (w) => (w === SMART ? 'smart' : w === NEW ? null : 'eoa'),
    exclude: [PAYOUT, DEPLOYER.toUpperCase().replace('0X', '0x')],
  });
  assert.deepEqual(r.counted.sort((a, b) => a.wallet.localeCompare(b.wallet)), [
    { wallet: USER, kind: 'eoa' },
    { wallet: SMART, kind: 'smart' },
  ]);
  assert.equal(r.score, 2);
  assert.equal(r.seen, 3); // USER, NEW, SMART: the excluded ones are never looked at
});

test('scoreEntry v2: the share of direct transactions carrying EarnKit\'s Builder Code', async () => {
  const { Attribution } = await import('ox/erc8021');
  const coded = '0xa9059cbb' + Attribution.toDataSuffix({ codes: ['earnkit'] }).slice(2);
  const from = new Date(Date.UTC(2026, 9, 5, 0));
  const r = await scoreEntry(['0xc'], from, new Date(Date.UTC(2026, 9, 6)), {
    blockAt: async () => 1n,
    history: async (w) => (w === '0x05' ? null : 'eoa'),
    fetchInternal: noInternal,
    fetchPage: async () =>
      page([
        { timestamp: at(9), status: 'ok', from: { hash: '0x05' }, raw_input: coded }, // never counted: not in the share
        { timestamp: at(10), status: 'ok', from: { hash: '0x01' }, raw_input: coded },
        { timestamp: at(11), status: 'ok', from: { hash: '0x02' }, raw_input: '0xa9059cbb' },
        { timestamp: at(12), status: 'ok', from: { hash: '0x03' } },
        { timestamp: at(13), status: 'error', from: { hash: '0x04' }, raw_input: coded },
      ]) as TxPage,
  });
  assert.equal(r.codeShare, 1 / 3);
});

test('internalCallers: staticcalls and items without a type are ignored', async () => {
  const r = await internalCallers('0xc', new Date(Date.UTC(2026, 9, 5, 1)), new Date(Date.UTC(2026, 9, 5, 20)), {
    fetchPage: async () =>
      page([
        { timestamp: at(10), success: true, type: 'staticcall', from: { hash: '0xaa' } },
        { timestamp: at(9), success: true, from: { hash: '0xbb' } },
        { timestamp: at(8), success: true, type: 'call', from: { hash: '0xcc' }, transaction_hash: '0xt1' },
      ]) as InternalPage,
  });
  assert.deepEqual([...r.wallets], ['0xcc']);
  assert.deepEqual([...r.callers], [['0xcc', ['0xt1']]]);
});

test('internalCallers: an ended window starts at its end block; reads are capped at 100 pages (partial)', async () => {
  const paths: string[] = [];
  const r = await internalCallers('0xc', new Date(0), new Date(Date.UTC(2026, 9, 5, 20)), {
    startBlock: 123n,
    fetchPage: async (path) => {
      paths.push(path);
      return { items: [{ timestamp: at(10), success: true, type: 'call', from: { hash: '0xaa' } }], next_page_params: { block_number: 1, transaction_index: 0, index: 0, items_count: 50, filter: 'to' } };
    },
  });
  assert.equal(INTERNAL_MAX_PAGES, 100);
  assert.equal(paths.length, 100);
  assert.equal(paths[0], '/api/v2/addresses/0xc/internal-transactions?filter=to&block_number=123&transaction_index=0&index=0&items_count=50');
  assert.equal(r.complete, false);
});

test('scoreEntry: an ended window reads internal calls from its end block too', async () => {
  const paths: string[] = [];
  await scoreEntry(['0xc'], new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 2)), {
    blockAt: async () => 41n,
    history: async () => 'eoa',
    fetchPage: async () => page([]) as TxPage,
    fetchInternal: async (path) => { paths.push(path); return page([]) as InternalPage; },
  });
  assert.deepEqual(paths, ['/api/v2/addresses/0xc/internal-transactions?filter=to&block_number=42&transaction_index=0&index=0&items_count=50']);
});

test('scoreEntry: fetchPage without fetchInternal is refused (no silent skip of internal calls)', async () => {
  await assert.rejects(
    scoreEntry(['0xc'], new Date(0), new Date(), { fetchPage: async () => page([]) as TxPage, blockAt: async () => 1n }),
    /fetchInternal/,
  );
});

const V7 = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const addr = (d: string | number) => '0x' + String(d).repeat(40);
/** One internal call to the contract per [caller, parent tx hash]. */
const internalFrom = (calls: [string, string][]) => async () =>
  page(calls.map(([w, h]) => ({ timestamp: at(10), success: true, type: 'call', from: { hash: w }, transaction_hash: h }))) as InternalPage;
const window5 = [new Date(Date.UTC(2026, 9, 5, 0)), new Date(Date.UTC(2026, 9, 6, 0))] as const;
const noDirect = async () => page([]) as TxPage;

test('userOpsIn: reads UserOperationEvent (sender, success) logged by an EntryPoint; anything else is ignored', async () => {
  const { encodeAbiParameters, pad } = await import('viem');
  const S = addr(7);
  const log = (address: string, success: boolean, topic0 = USER_OP_EVENT) => ({
    address,
    topics: [topic0, '0x' + 'ab'.repeat(32), pad(S as `0x${string}`), pad(addr(0) as `0x${string}`)],
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }],
      [0n, success, 1n, 1n],
    ),
  });
  assert.deepEqual(userOpsIn([log('0x0000000071727De22E5E9d8BAf0edAc6f37da032', true)]), [{ entryPoint: V7, sender: S, success: true }]);
  assert.deepEqual(userOpsIn([log(V7, false)]), [{ entryPoint: V7, sender: S, success: false }]);
  assert.deepEqual(userOpsIn([log(addr('f'), true)]), [], 'not an EntryPoint');
  assert.deepEqual(userOpsIn([log(V7, true, '0x' + '00'.repeat(32))]), [], 'another event');
});

test('scoreEntry: staged clones fanned out from a normal transaction count 0', async () => {
  const clones = [1, 2, 3].map(addr);
  const r = await scoreEntry([addr('c')], ...window5, {
    blockAt: async () => 1n,
    fetchPage: noDirect,
    fetchInternal: internalFrom(clones.map((w) => [w, '0xfan'])),
    userOps: async () => [], // an ordinary transaction: no UserOperationEvent
    epNonce: async () => 9n,
    history: async () => 'smart',
  });
  assert.deepEqual([r.score, r.seen], [0, 3]);
});

test('scoreEntry: clones fanned out inside a handleOps transaction count 0; the UserOp sender counts', async () => {
  const S = addr(7);
  const clones = [1, 2, 3].map(addr);
  const lookups: string[] = [];
  const r = await scoreEntry([addr('c')], ...window5, {
    blockAt: async () => 1n,
    fetchPage: noDirect,
    fetchInternal: internalFrom([...clones.map((w): [string, string] => [w, '0xops']), [S, '0xops']]),
    userOps: async (hash) => {
      lookups.push(hash);
      return [{ entryPoint: V7, sender: S, success: true }];
    },
    epNonce: async () => 9n,
    history: async () => 'smart',
  });
  assert.deepEqual(r.counted, [{ wallet: S, kind: 'smart' }]);
  assert.deepEqual(lookups, ['0xops'], 'one receipt per transaction');
});

test('scoreEntry: a UserOp that failed does not count', async () => {
  const S = addr(7);
  const r = await scoreEntry([addr('c')], ...window5, {
    blockAt: async () => 1n,
    fetchPage: noDirect,
    fetchInternal: internalFrom([[S, '0xops']]),
    userOps: async () => [{ entryPoint: V7, sender: S, success: false }],
    epNonce: async () => 9n,
    history: async () => 'smart',
  });
  assert.equal(r.score, 0);
});

test('scoreEntry: a smart account needs EntryPoint nonce (key 0) >= 3 at the start block, via its own EntryPoint', async () => {
  const [A, B] = [7, 8].map(addr);
  const asked: [string, string, bigint][] = [];
  const r = await scoreEntry([addr('c')], ...window5, {
    blockAt: async () => 41n,
    fetchPage: noDirect,
    fetchInternal: internalFrom([[A, '0xa'], [B, '0xb']]),
    userOps: async (h) => [{ entryPoint: V7, sender: h === '0xa' ? A : B, success: true }],
    epNonce: async (ep, w, block) => {
      asked.push([ep, w, block]);
      return w === A ? 2n : 3n;
    },
    history: async () => 'smart',
  });
  assert.deepEqual(r.counted, [{ wallet: B, kind: 'smart' }]);
  assert.deepEqual(asked.sort(), [[V7, A, 41n], [V7, B, 41n]]);
});

test('scoreEntry: a failed receipt or nonce lookup means not counted (logged, cached), never a failed entry', async () => {
  const [A, B, C2] = [7, 8, 9].map(addr);
  const lookups: string[] = [];
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { errors.push(a); };
  try {
    const r = await scoreEntry([addr('c')], ...window5, {
      blockAt: async () => 1n,
      fetchPage: noDirect,
      fetchInternal: internalFrom([[A, '0xbad'], [B, '0xbad'], [C2, '0xok']]),
      userOps: async (h) => {
        lookups.push(h);
        if (h === '0xbad') throw new Error('receipt not found');
        return [{ entryPoint: V7, sender: C2, success: true }];
      },
      epNonce: async () => { throw new Error('execution reverted'); },
      history: async () => 'smart',
    });
    assert.deepEqual([r.score, r.timedOut], [0, false]);
    assert.deepEqual(lookups.sort(), ['0xbad', '0xok'], 'the failed receipt is cached, not retried');
    assert.equal(errors.length, 2, 'one log for the receipt, one for the nonce');
  } finally {
    console.error = original;
  }
});
