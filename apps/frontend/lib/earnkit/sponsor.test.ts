import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  awardSearchFrom,
  LOG_CHUNK_MIN,
  RATE_BACKOFF_MS,
  logError,
  scanLogsNewestFirst,
  type CloneFacts,
  type EscrowReader,
} from './escrow';
import { AWARD_PROVENANCE, FUND_WARNING, awardWarnings } from './sponsor-text';
import {
  assertCanAward,
  CHAIN_CHECK_TTL_MS,
  checkIsFresh,
  DEADLINE_PASSED,
  DRAFT_EXPIRED,
  confirmableState,
  draftExpiry,
  expiredText,
  findFunding,
  matchFunding,
  sameLiveLink,
  type SponsorRow,
  scoreNotes,
  withScoringLock,
} from './sponsor';
import { sql } from './db';

const REF = '0x' + 'a'.repeat(64);
const WALLET = '0x00000000000000000000000000000000000000b0';
const OTHER = '0x00000000000000000000000000000000000000b9';
const CLONE = '0x00000000000000000000000000000000000000c1';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const row = {
  ref: REF,
  token: USDC,
  token_decimals: 6,
  amount: '5000',
  sponsor_wallet: WALLET,
  draft: { ends_at: '2026-10-15T00:00:00Z' },
};
const endsAt = Date.parse('2026-10-15T00:00:00Z') / 1000;
const good: CloneFacts = {
  sponsor: WALLET,
  token: USDC.toLowerCase(),
  prize: 4_500_000_000n,
  fee: 500_000_000n,
  endsAt,
  state: 'funded',
};

/** A stub chain: `clones` maps "sponsor:ref" to a clone address, `facts` that clone's state. */
function reader(
  clones: Record<string, string>,
  facts: CloneFacts = good,
): EscrowReader & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async campaignOf(sponsor, ref) {
      asked.push(sponsor);
      return clones[`${sponsor}:${ref}`] ?? null;
    },
    async clone() {
      return facts;
    },
  };
}

test("findFunding: the bound wallet's clone with the draft's exact terms is the funding", async () => {
  assert.deepEqual(
    await matchFunding(row, reader({ [`${WALLET}:${REF}`]: CLONE })),
    { status: 'funded', escrow: CLONE },
  );
});

test('findFunding: no clone for the bound wallet (zero address) is not funded', async () => {
  assert.deepEqual(await matchFunding(row, reader({})), { status: 'none' });
});

test("findFunding: another wallet's deposit for the same ref is never looked at (front-running)", async () => {
  const r = reader({ [`${OTHER}:${REF}`]: CLONE });
  assert.deepEqual(await matchFunding(row, r), { status: 'none' });
  assert.deepEqual(r.asked, [WALLET]);
});

test('findFunding: wrong sponsor, token, amount, end date or state are each refused', async () => {
  const at = { [`${WALLET}:${REF}`]: CLONE };
  const refused = async (over: Partial<CloneFacts>) =>
    matchFunding(row, reader(at, { ...good, ...over }));
  assert.deepEqual(await refused({ sponsor: OTHER }), {
    status: 'mismatch',
    escrow: CLONE,
    problem: "it wasn't made by the campaign's wallet",
    cloneState: 'funded',
  });
  assert.match(
    ((await refused({ token: OTHER })) as { problem: string }).problem,
    /different token/,
  );
  assert.match(
    ((await refused({ fee: 499_999_999n })) as { problem: string }).problem,
    /amount differs/,
  );
  assert.match(
    ((await refused({ prize: 4_500_000_001n })) as { problem: string }).problem,
    /amount differs/,
  );
  assert.match(
    ((await refused({ endsAt: endsAt + 1 })) as { problem: string }).problem,
    /end date differs/,
  );
  assert.match(
    ((await refused({ state: 'refunded' })) as { problem: string }).problem,
    /refunded, not funded/,
  );
});

test('findFunding: addresses compare case-insensitively', async () => {
  assert.equal(
    (
      await matchFunding(
        { ...row, sponsor_wallet: WALLET.toUpperCase().replace('0X', '0x') },
        reader({
          [`${WALLET.toUpperCase().replace('0X', '0x')}:${REF}`]: CLONE,
        }),
      )
    ).status,
    'funded',
  );
});

test("findFunding: a replaced draft's deposit is never published, only reported for refund", async () => {
  const replaced = { ...row, state: 'replaced' } as unknown as SponsorRow;
  const at = { [`${WALLET}:${REF}`]: CLONE };
  // Matching terms or not, it is reported with the escrow to refund (no DB write: never published).
  const r = await findFunding(replaced, reader(at));
  assert.deepEqual(r, {
    problem: `a deposit from ${WALLET} was found for this draft, but it was replaced by a newer draft, so it wasn't published.`,
    escrow: CLONE,
  });
  assert.equal(
    (await findFunding(replaced, reader(at, { ...good, fee: 1n })))?.escrow,
    CLONE,
  );
  // Already refunded: nothing left to refund.
  assert.deepEqual(
    await findFunding(replaced, reader(at, { ...good, state: 'refunded' })),
    {
      problem: `a deposit from ${WALLET} for this campaign was made after it was replaced and was refunded; fund the newer draft.`,
      escrow: null,
    },
  );
  assert.equal(await findFunding(replaced, reader({})), null);
  assert.equal(confirmableState('replaced'), 'refuse');
});

test('awardSearchFrom: from about the block at endsAt (2 s blocks), minus 300, never below 0', () => {
  // 1 hour after endsAt at block 1,000,000: ~1,800 blocks back, plus 300.
  assert.equal(awardSearchFrom(1_000_000n, 10_000n + 3_600n, 10_000), 997_900n);
  assert.equal(awardSearchFrom(100n, 10_000n + 86_400n, 10_000), 0n);
});

test('confirmableState: draft and expired publish, live is idempotent, terminal states refuse', () => {
  assert.equal(confirmableState('draft'), 'publish');
  // A lazily-expired draft is rescued by findFunding when the bound wallet's deposit is onchain —
  // see the comment on confirmableState.
  assert.equal(confirmableState('expired'), 'publish');
  assert.equal(confirmableState('live'), 'already_live');
  assert.equal(confirmableState('awarded'), 'already_live');
  assert.equal(confirmableState('refunded'), 'refuse');
  assert.equal(confirmableState('taken_down'), 'refuse');
});

test('award plan rejected before end and from another installation', () => {
  const live = {
    state: 'live',
    installation_id: 7,
    draft: { ends_at: '2026-10-15T00:00:00Z' },
  } as const;
  assert.throws(
    () => assertCanAward(live, 7, new Date('2026-10-14T23:59:59Z')),
    /after the campaign ends/,
  );
  assert.throws(
    () => assertCanAward(live, 8, new Date('2026-10-16T00:00:00Z')),
    /agent that created/,
  );
  assert.throws(
    () =>
      assertCanAward(
        { ...live, state: 'awarded' },
        7,
        new Date('2026-10-16T00:00:00Z'),
      ),
    /awarded/,
  );
  assert.doesNotThrow(() =>
    assertCanAward(live, 7, new Date('2026-10-15T00:00:00Z')),
  );
});

test('draftExpiry: a deadline under 10 minutes away (or past) expires the draft, as does 7 days unfunded', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const at = (ends_at: string, created = '2026-10-05T00:00:00Z') => ({
    created_at: new Date(created),
    draft: { ends_at },
  });
  assert.equal(draftExpiry(at('2026-10-09T12:00:00Z'), now), null);
  assert.equal(draftExpiry(at('2026-10-06T12:10:00Z'), now), null);
  assert.equal(draftExpiry(at('2026-10-06T12:09:59Z'), now), 'deadline');
  assert.equal(draftExpiry(at('2026-10-06T11:00:00Z'), now), 'deadline');
  assert.equal(
    draftExpiry(at('2026-10-20T00:00:00Z', '2026-09-28T00:00:00Z'), now),
    'age',
  );
  assert.equal(expiredText(at('2026-10-06T11:00:00Z'), now), DEADLINE_PASSED);
  assert.equal(
    expiredText(at('2026-10-20T00:00:00Z', '2026-09-28T00:00:00Z'), now),
    DRAFT_EXPIRED,
  );
  assert.equal(
    DEADLINE_PASSED,
    "This draft's deadline has passed or is less than 10 minutes away. Ask your agent to create a new campaign. " +
      'If you already deposited from your bound wallet, your funds are safe in escrow: EarnKit finds the deposit onchain and publishes the campaign (reload in a minute).',
  );
  assert.match(
    DRAFT_EXPIRED,
    /If you already deposited from your bound wallet, your funds are safe in escrow/,
  );
});

test('chain checks are reused for 15 seconds, then read again', () => {
  const at = new Date('2026-10-03T10:00:00Z');
  const after = (ms: number) => new Date(at.getTime() + ms);
  assert.equal(CHAIN_CHECK_TTL_MS, 15_000);
  assert.equal(checkIsFresh(null, at), false);
  assert.equal(checkIsFresh(at, at), true);
  assert.equal(checkIsFresh(at, after(14_999)), true);
  assert.equal(checkIsFresh(at, after(15_000)), false);
  // A clock that went backwards doesn't pin the cache forever.
  assert.equal(checkIsFresh(after(60_000), at), false);
});

/**
 * A fake RPC whose `getLogs` refuses ranges over `limit` blocks, like mainnet.base.org (HTTP 413,
 * -32614, "eth_getLogs is limited to a 2,000 range"); `named: false` refuses without a number.
 */
function fakeRpc(limit: bigint, hitAt: bigint | null, named = true) {
  const calls: [bigint, bigint][] = [];
  const get = async (lo: bigint, hi: bigint) => {
    calls.push([lo, hi]);
    if (hi - lo + 1n > limit)
      throw Object.assign(new Error('HTTP request failed.'), {
        status: 413,
        cause: {
          code: -32614,
          message: named
            ? `eth_getLogs is limited to a ${limit.toLocaleString('en-US')} range`
            : 'block range too large',
        },
      });
    return hitAt !== null && lo <= hitAt && hitAt <= hi ? `log@${hitAt}` : null;
  };
  return { calls, get };
}

test('award log search: newest first in 2,000-block chunks, at most 8 calls per check, resumes where it stopped', async () => {
  const rpc = fakeRpc(2_000n, null);
  const first = await scanLogsNewestFirst({
    latest: 100_000n,
    floor: 0n,
    resumeHi: null,
    get: rpc.get,
  });
  assert.equal(rpc.calls.length, 8);
  assert.deepEqual(rpc.calls[0], [98_001n, 100_000n]);
  assert.deepEqual(rpc.calls[7], [84_001n, 86_000n]);
  assert.deepEqual(first, { found: null, next: 84_000n });
  // The next check (with new blocks on top) continues below where this one stopped.
  rpc.calls.length = 0;
  const second = await scanLogsNewestFirst({
    latest: 100_050n,
    floor: 80_000n,
    resumeHi: first.next,
    get: rpc.get,
  });
  assert.deepEqual(rpc.calls[0], [82_001n, 84_000n]);
  assert.deepEqual(rpc.calls.at(-1), [80_000n, 80_000n]);
  assert.equal(second.next, null);
  // An empty range (floor above latest) does no work.
  rpc.calls.length = 0;
  assert.deepEqual(
    await scanLogsNewestFirst({
      latest: 10n,
      floor: 20n,
      resumeHi: null,
      get: rpc.get,
    }),
    { found: null, next: null },
  );
  assert.equal(rpc.calls.length, 0);
});

test('award log search: finds the event on an RPC with a 2,000-block limit (the Base mainnet fork bug)', async () => {
  const rpc = fakeRpc(2_000n, 95_500n);
  const r = await scanLogsNewestFirst({
    latest: 100_000n,
    floor: 90_000n,
    resumeHi: null,
    chunk: 9_000n, // the old chunk size: refused once, then the named limit is used
    get: rpc.get,
  });
  assert.equal(r.found, 'log@95500');
  assert.deepEqual(rpc.calls, [
    [91_001n, 100_000n],
    [98_001n, 100_000n],
    [96_001n, 98_000n],
    [94_001n, 96_000n],
  ]);
});

test('award log search: an unnamed limit halves the chunk until accepted, never below 100', async () => {
  const rpc = fakeRpc(600n, 99_000n, false);
  const r = await scanLogsNewestFirst({
    latest: 100_000n,
    floor: 0n,
    resumeHi: null,
    maxCalls: 20,
    get: rpc.get,
  });
  // 2,000 → 1,000 → 500 accepted.
  assert.deepEqual(rpc.calls.slice(0, 3), [
    [98_001n, 100_000n],
    [99_001n, 100_000n],
    [99_501n, 100_000n],
  ]);
  assert.equal(r.found, 'log@99000');
  // A provider that refuses even 100 blocks: the error surfaces instead of looping.
  const broken = fakeRpc(50n, null, false);
  await assert.rejects(
    scanLogsNewestFirst({
      latest: 100_000n,
      floor: 0n,
      resumeHi: null,
      maxCalls: 50,
      get: broken.get,
    }),
    /HTTP request failed/,
  );
  assert.equal(
    broken.calls.at(-1)![1] - broken.calls.at(-1)![0] + 1n,
    LOG_CHUNK_MIN,
  );
  // Other errors are not retried.
  let n = 0;
  await assert.rejects(
    scanLogsNewestFirst({
      latest: 100n,
      floor: 0n,
      resumeHi: null,
      get: async () => {
        n++;
        throw new Error('connection reset');
      },
    }),
    /connection reset/,
  );
  assert.equal(n, 1);
});

test('logError: a range limit only when the message says so; other -32005/-32614/429 are rate limits (T9 review I5, M1, M2)', () => {
  const range = (message: string, extra: object = {}) => {
    const r = logError({ message, ...extra });
    assert.equal(r?.kind, 'range', message);
    return r?.kind === 'range' ? r.limit : undefined;
  };
  assert.equal(
    range('eth_getLogs is limited to a 2,000 range', {
      code: -32614,
      status: 413,
    }),
    2_000n,
  );
  assert.equal(range('maximum block range: 500'), 500n);
  assert.equal(range('exceed maximum block range: 10000'), 10_000n);
  assert.equal(
    range(
      'Log response size exceeded. this block range should work: [0x10, 0x4f]',
    ),
    64n,
  );
  assert.equal(
    range('query returned more than 10000 results', { code: -32005 }),
    null,
  );
  assert.equal(range('too many blocks requested'), null);
  // Review M1: dRPC, thirdweb, a K suffix.
  assert.equal(range('ranges over 10000 blocks are not supported'), 10_000n);
  assert.equal(
    range('Maximum allowed number of requested blocks is 1000'),
    1_000n,
  );
  assert.equal(range('eth_getLogs is limited to 10K blocks'), 10_000n);
  // Rate limits: the codes without range wording, 429, rate wording.
  for (const e of [
    {
      message: 'daily request count exceeded, request rate limited',
      code: -32005,
    },
    { message: 'busy', code: -32614 },
    { message: 'Too Many Requests', status: 429 },
    { message: 'rate limit reached' },
  ])
    assert.deepEqual(logError(e), { kind: 'rate' }, e.message);
  assert.equal(logError(new Error('execution reverted')), null);
  assert.equal(logError({ message: 'nonce too low', code: -32000 }), null);
  // Through viem's cause chain.
  assert.equal(
    logError({
      message: 'HTTP request failed.',
      cause: { message: 'block range too large' },
    })?.kind,
    'range',
  );
  // Review M2: a huge error page is cut to 2 KB per text, so this stays fast.
  const t = performance.now();
  logError({
    message: 'x',
    details: '<html>' + 'range '.repeat(20_000) + 'a'.repeat(100_000),
  });
  assert.ok(performance.now() - t < 50);
});

test('award log search: a rate limit backs off 250 ms, 1 s, 3 s, then stops this check where it was (T9 review I5)', async () => {
  const waits: number[] = [];
  let n = 0;
  const r = await scanLogsNewestFirst({
    latest: 100_000n,
    floor: 0n,
    resumeHi: 50_000n,
    sleep: async (ms) => {
      waits.push(ms);
    },
    get: async () => {
      n++;
      throw Object.assign(new Error('rate limited'), { code: -32005 });
    },
  });
  assert.deepEqual(waits, RATE_BACKOFF_MS);
  assert.equal(n, 4);
  // Nothing searched: resume from the same block; no range was shrunk.
  assert.deepEqual(r, { found: null, next: 50_000n, rateLimited: true });
  // A rate limit that clears: the search goes on at full size.
  const calls: [bigint, bigint][] = [];
  let first = true;
  const ok = await scanLogsNewestFirst({
    latest: 10_000n,
    floor: 0n,
    resumeHi: null,
    sleep: async () => {},
    get: async (lo, hi) => {
      calls.push([lo, hi]);
      if (first) {
        first = false;
        throw Object.assign(new Error('Too Many Requests'), { status: 429 });
      }
      return lo <= 7_000n && 7_000n <= hi ? 'hit' : null;
    },
  });
  assert.equal(ok.found, 'hit');
  assert.deepEqual(calls.slice(0, 2), [
    [8_001n, 10_000n],
    [8_001n, 10_000n],
  ]);
});

test("award page warnings: the sponsor's own wallet, or one wallet paid twice", () => {
  const me = '0x' + 'a'.repeat(40);
  const x = '0x' + 'b'.repeat(40);
  const y = '0x' + 'c'.repeat(40);
  assert.deepEqual(awardWarnings([{ wallet: x }, { wallet: y }], me), [
    null,
    null,
  ]);
  assert.deepEqual(
    awardWarnings([{ wallet: me.toUpperCase().replace('0X', '0x') }], me),
    ['This winner is your own wallet.'],
  );
  assert.deepEqual(
    awardWarnings([{ wallet: x }, { wallet: y }, { wallet: x }], me),
    [
      'This wallet is paid more than once in this award.',
      null,
      'This wallet is paid more than once in this award.',
    ],
  );
  assert.match(
    FUND_WARNING,
    /^Only fund a campaign you asked your own agent to create\./,
  );
  assert.match(AWARD_PROVENANCE, /this payment is final\.$/);
});

test('scoreNotes: names capped entries and pending refreshes; nothing when all is well', () => {
  assert.equal(
    scoreNotes([{ id: 1, score_partial: false }], 'done'),
    undefined,
  );
  const n = scoreNotes(
    [
      { id: 4, score_partial: true },
      { id: 9, score_partial: true },
    ],
    'pending',
  )!;
  assert.match(n, /Entry #4, #9: more than 25000 transactions/);
  assert.match(n, /still being refreshed/);
  assert.match(scoreNotes([], 'busy')!, /^Scoring in progress/);
});

// Against the local database when configured.
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

test(
  'withScoringLock: a second concurrent pass for one campaign is busy; the lease frees after',
  dbTest,
  async () => {
    const id = `lock-test-${process.pid}-${Date.now()}`;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const first = withScoringLock(id, async () => {
      await held;
      return 'done' as const;
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      await withScoringLock(id, async () => 'done' as const),
      'busy',
    );
    release();
    assert.equal(await first, 'done');
    assert.equal(
      await withScoringLock(id, async () => 'done' as const),
      'done',
    );
  },
);

test(
  'withScoringLock: 8 campaigns scoring at once, each writing mid-pass, all finish (pool of 5)',
  dbTest,
  async () => {
    const ids = Array.from(
      { length: 8 },
      (_, i) => `pool-test-${process.pid}-${Date.now()}-${i}`,
    );
    const passes = Promise.all(
      ids.map((id) =>
        withScoringLock(id, async () => {
          // A pass: slow network reads with no connection held, then a write.
          await new Promise((r) => setTimeout(r, 200));
          await sql()`SELECT pg_sleep(0.05)`;
          await new Promise((r) => setTimeout(r, 100));
          const [row] = await sql()<{ n: number }[]>`SELECT 1 AS n`;
          return row.n;
        }),
      ),
    );
    const timeout = new Promise<'hung'>((r) =>
      setTimeout(() => r('hung'), 10_000).unref(),
    );
    const result = await Promise.race([passes, timeout]);
    assert.notEqual(result, 'hung', 'every pass completes');
    assert.deepEqual(
      result,
      ids.map(() => 1),
    );
    const [{ left }] = await sql()<{ left: number }[]>`
    SELECT count(*)::int AS left FROM scoring_leases WHERE program_id = ANY(${ids})`;
    assert.equal(left, 0, 'every lease is released');
  },
);

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

// Re-audit M5: live links aren't proven, so a unique live link let the first comer squat it.
test('a shared live link is flagged to the sponsor, not refused (re-audit M5)', () => {
  const entries = [
    { id: 4, live_key: 'alpha.app' },
    { id: 7, live_key: null },
    { id: 9, live_key: 'alpha.app' },
    { id: 12, live_key: 'beta.app' },
  ];
  assert.equal(sameLiveLink(entries[0], entries), null);
  assert.equal(sameLiveLink(entries[1], entries), null);
  assert.equal(sameLiveLink(entries[2], entries), 'same live link as entry #4');
  assert.equal(sameLiveLink(entries[3], entries), null);
});
