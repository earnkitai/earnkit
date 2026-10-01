import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt,
} from 'viem';
import { campaignsAbi } from './escrow-abi';
import { fundingFromReceipt } from './sponsor';

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
    [CLONE, USDC, over.amount ?? 5_000_000_000n, endsAt],
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
