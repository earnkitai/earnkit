import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt,
} from 'viem';
import { campaignAbi, campaignsAbi } from './escrow-abi';
import {
  assertCanAward,
  confirmableState,
  fundingDecision,
  fundingFromReceipt,
  routeReceipt,
  secondEscrowMessage,
} from './sponsor';

// escrowConfig() (used by fundingFromReceipt via readCreated) reads these lazily per call, not
// at module load, so setting them here (after imports, which are hoisted) is sufficient — see
// oauth.test.ts for the same pattern with EARNKIT_AUTH_SECRET.
process.env.ESCROW_CHAIN = 'base';
process.env.ESCROW_FACTORY_ADDRESS =
  '0x00000000000000000000000000000000000000fa';

const REF = ('0x' + 'a'.repeat(64)) as `0x${string}`;
const SPONSOR = '0x00000000000000000000000000000000000000b0';
const CLONE = '0x00000000000000000000000000000000000000c1';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const row = {
  ref: REF,
  token: USDC,
  token_decimals: 6,
  amount: '5000',
  draft: { ends_at: '2026-10-15T00:00:00Z' },
  state: 'draft',
};
const endsAt = BigInt(Date.parse('2026-10-15T00:00:00Z') / 1000);

function receipt(over: {
  ref?: `0x${string}`;
  amount?: bigint;
  status?: 'success' | 'reverted';
  from?: string;
  token?: string;
  endsAt?: bigint;
  campaign?: string;
}) {
  const topics = encodeEventTopics({
    abi: campaignsAbi,
    eventName: 'CampaignCreated',
    args: { ref: over.ref ?? REF, sponsor: SPONSOR },
  });
  const data = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint64' },
    ],
    [
      (over.campaign ?? CLONE) as `0x${string}`,
      (over.token ?? USDC) as `0x${string}`,
      over.amount ?? 5_000_000_000n,
      over.endsAt ?? endsAt,
    ],
  );
  return {
    status: over.status ?? 'success',
    logs: [
      {
        address: over.from ?? process.env.ESCROW_FACTORY_ADDRESS,
        topics,
        data,
      },
    ],
  } as unknown as TransactionReceipt;
}

test('accepts the matching funding receipt', () => {
  assert.deepEqual(fundingFromReceipt(row, receipt({})), {
    escrow: CLONE,
    sponsor: SPONSOR,
  });
});

test('rejects a reverted tx, another ref, another amount, or another contract', () => {
  assert.throws(
    () => fundingFromReceipt(row, receipt({ status: 'reverted' })),
    /failed/,
  );
  assert.throws(
    () =>
      fundingFromReceipt(
        row,
        receipt({ ref: ('0x' + 'b'.repeat(64)) as `0x${string}` }),
      ),
    /isn't the funding/,
  );
  assert.throws(
    () => fundingFromReceipt(row, receipt({ amount: 1n })),
    /amount/,
  );
  assert.throws(
    () =>
      fundingFromReceipt(
        row,
        receipt({ from: '0x00000000000000000000000000000000000000ee' }),
      ),
    /isn't the funding/,
  );
});

test('confirmableState: draft and expired publish, live is idempotent, terminal states refuse', () => {
  assert.equal(confirmableState('draft'), 'publish');
  // A lazily-expired draft is rescued by confirmFunding when the receipt proves it was funded —
  // see the comment on confirmableState.
  assert.equal(confirmableState('expired'), 'publish');
  assert.equal(confirmableState('live'), 'already_live');
  // An awarded campaign's own funding tx is still recognised (fundingDecision checks the escrow).
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

test('rejects funding with a different token or a different end date', () => {
  assert.throws(
    () =>
      fundingFromReceipt(
        row,
        receipt({ token: '0x00000000000000000000000000000000000000dd' }),
      ),
    /different token/,
  );
  assert.throws(
    () => fundingFromReceipt(row, receipt({ endsAt: endsAt + 1n })),
    /end date/,
  );
});

function awardReceipt(escrow: string) {
  const data = encodeAbiParameters(
    [{ type: 'address[]' }, { type: 'uint256[]' }, { type: 'uint256' }],
    [['0x00000000000000000000000000000000000000a1'], [90n], 10n],
  );
  const topics = encodeEventTopics({ abi: campaignAbi, eventName: 'Awarded' });
  return {
    status: 'success',
    logs: [{ address: escrow, topics, data }],
  } as unknown as TransactionReceipt;
}

test('routeReceipt routes by what the receipt contains, not the row state', () => {
  const liveRow = { ref: REF, state: 'live', escrow_address: CLONE } as const;
  // The original funding tx of a live campaign is a funding receipt (re-confirm), not an award.
  assert.deepEqual(routeReceipt(liveRow, receipt({})), { route: 'funding' });
  assert.deepEqual(routeReceipt(liveRow, awardReceipt(CLONE)), {
    route: 'award',
  });
  const draftRow = { ref: REF, state: 'draft', escrow_address: null } as const;
  assert.deepEqual(routeReceipt(draftRow, receipt({})), { route: 'funding' });
  assert.deepEqual(routeReceipt({ ...draftRow, state: 'expired' }, receipt({})), {
    route: 'funding',
  });
  // Errors are readable.
  assert.match(
    (routeReceipt(liveRow, receipt({ status: 'reverted' })) as { error: string }).error,
    /failed onchain/,
  );
  assert.match(
    (routeReceipt(liveRow, awardReceipt('0x00000000000000000000000000000000000000ee')) as {
      error: string;
    }).error,
    /funding or award/,
  );
  assert.match(
    (routeReceipt(draftRow, receipt({ ref: ('0x' + 'b'.repeat(64)) as `0x${string}` })) as {
      error: string;
    }).error,
    /isn't the funding/,
  );
  assert.match(
    (routeReceipt({ ...liveRow, state: 'refunded' }, awardReceipt('0x00000000000000000000000000000000000000ee')) as {
      error: string;
    }).error,
    /refunded/,
  );
});

test('fundingDecision: publish, re-confirm, second escrow, refuse', () => {
  const created = { ref: REF, campaign: CLONE };
  const other = '0x00000000000000000000000000000000000000c2';
  assert.deepEqual(
    fundingDecision({ ref: REF, state: 'draft', escrow_address: null }, created),
    { action: 'publish' },
  );
  assert.deepEqual(
    fundingDecision({ ref: REF, state: 'expired', escrow_address: null }, created),
    { action: 'publish' },
  );
  // The live campaign's own funding receipt (any address casing) re-confirms.
  assert.deepEqual(
    fundingDecision(
      { ref: REF, state: 'live', escrow_address: CLONE.toUpperCase().replace('0X', '0x') },
      created,
    ),
    { action: 'already_live' },
  );
  // A second CampaignCreated for the same ref, from another wallet: a different, untracked escrow.
  assert.deepEqual(
    fundingDecision({ ref: REF, state: 'live', escrow_address: other }, created),
    { action: 'second_escrow', escrow: CLONE },
  );
  assert.deepEqual(
    fundingDecision({ ref: REF, state: 'taken_down', escrow_address: other }, created),
    { action: 'second_escrow', escrow: CLONE },
  );
  assert.equal(
    fundingDecision({ ref: REF, state: 'refunded', escrow_address: CLONE }, created).action,
    'refuse',
  );
  // No CampaignCreated, or one for another ref: not this campaign's funding, even when live.
  assert.equal(
    fundingDecision({ ref: REF, state: 'live', escrow_address: CLONE }, null).action,
    'refuse',
  );
  assert.equal(
    fundingDecision(
      { ref: REF, state: 'live', escrow_address: CLONE },
      { ref: '0x' + 'b'.repeat(64), campaign: CLONE },
    ).action,
    'refuse',
  );
  assert.match(secondEscrowMessage(CLONE, other), new RegExp(CLONE));
});
