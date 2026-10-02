import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  awardSearchFrom,
  logScanPlan,
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
  matchFunding,
} from './sponsor';

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

test('award log search: newest first, at most 6 chunks per check, resumes where it stopped', () => {
  const first = logScanPlan({
    latest: 100_000n,
    floor: 0n,
    resumeHi: null,
    chunk: 9_000n,
  });
  assert.equal(first.ranges.length, 6);
  assert.deepEqual(first.ranges[0], [91_001n, 100_000n]);
  assert.deepEqual(first.ranges[5], [46_001n, 55_000n]);
  assert.equal(first.next, 46_000n);
  // The next check (with new blocks on top) continues below where this one stopped.
  const second = logScanPlan({
    latest: 100_050n,
    floor: 0n,
    resumeHi: first.next,
    chunk: 9_000n,
  });
  assert.deepEqual(second.ranges[0], [37_001n, 46_000n]);
  assert.deepEqual(second.ranges.at(-1), [0n, 1_000n]);
  assert.equal(second.ranges.length, 6);
  assert.equal(second.next, null);
  // A short range is one chunk, clipped at the floor; nothing left.
  assert.deepEqual(logScanPlan({ latest: 500n, floor: 200n, resumeHi: null }), {
    ranges: [[200n, 500n]],
    next: null,
  });
  // An empty range (floor above latest) does no work.
  assert.deepEqual(logScanPlan({ latest: 10n, floor: 20n, resumeHi: null }), {
    ranges: [],
    next: null,
  });
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
