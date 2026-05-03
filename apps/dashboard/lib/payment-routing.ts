import type { Abi } from 'viem';

export type PaymentMode = 'escrow' | 'splits';

export interface SupportedTokenConfig {
  address: `0x${string}`;
  symbol: string;
  coingeckoId: string;
}

export interface SplitRecipientConfig {
  address: `0x${string}`;
  label: 'Developer' | 'Platform' | 'Buyback';
  percentAllocation: number;
}

export const SUPPORTED_TOKENS: SupportedTokenConfig[] = [
  {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    symbol: 'USDC',
    coingeckoId: 'usd-coin',
  },
  {
    address: '0x534b7aad1cdb6f02ec48cabe428f0d9131e40b07',
    symbol: 'MINIDEV',
    coingeckoId: 'minidev',
  },
];

export const SPLIT_PLATFORM_FEE_PERCENT = 5;
export const SPLIT_PERCENTAGE_SCALE = BigInt(1_000_000);
export const SPLIT_DISTRIBUTION_INCENTIVE = 0;
export const SPLIT_NATIVE_TOKEN_ADDRESS =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export const SPLIT_DISTRIBUTE_ABI = [
  {
    type: 'function',
    name: 'distribute',
    inputs: [
      {
        name: '_split',
        type: 'tuple',
        components: [
          { name: 'recipients', type: 'address[]' },
          { name: 'allocations', type: 'uint256[]' },
          { name: 'totalAllocation', type: 'uint256' },
          { name: 'distributionIncentive', type: 'uint16' },
        ],
      },
      { name: '_token', type: 'address' },
      { name: '_distributor', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const satisfies Abi;

// Canonical 0xSplits v2 SplitsWarehouse address (deterministic across chains).
// PullSplit deposits distributed funds here; recipients then call `withdraw` to
// pull their balance into their wallet.
export const SPLIT_WAREHOUSE_ADDRESS =
  '0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8';

export const SPLIT_WAREHOUSE_ABI = [
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const satisfies Abi;

export function getDeveloperSplitPercent(buybackPercent = 0): number {
  return Math.max(0, 100 - SPLIT_PLATFORM_FEE_PERCENT - buybackPercent);
}

export function buildSplitRecipients(params: {
  developerWalletAddress?: string | null;
  platformFeeWallet?: string | null;
  buybackAddress?: string | null;
  buybackPercent?: number | null;
}): SplitRecipientConfig[] {
  const {
    developerWalletAddress,
    platformFeeWallet,
    buybackAddress,
    buybackPercent = 0,
  } = params;

  const recipients: SplitRecipientConfig[] = [];

  if (developerWalletAddress) {
    recipients.push({
      address: developerWalletAddress as `0x${string}`,
      label: 'Developer',
      percentAllocation: getDeveloperSplitPercent(buybackPercent ?? 0),
    });
  }

  if (platformFeeWallet) {
    recipients.push({
      address: platformFeeWallet as `0x${string}`,
      label: 'Platform',
      percentAllocation: SPLIT_PLATFORM_FEE_PERCENT,
    });
  }

  if (buybackAddress && (buybackPercent ?? 0) > 0) {
    recipients.push({
      address: buybackAddress as `0x${string}`,
      label: 'Buyback',
      percentAllocation: buybackPercent ?? 0,
    });
  }

  return recipients;
}

export function getSplitAllocationFromPercent(percent: number): bigint {
  return BigInt(
    Math.round(Number(SPLIT_PERCENTAGE_SCALE) * percent) / 100,
  );
}

export function buildSplitDistributionConfig(
  recipients: SplitRecipientConfig[],
) {
  const addresses = recipients.map((recipient) => recipient.address);
  const allocations = recipients.map((recipient) =>
    getSplitAllocationFromPercent(recipient.percentAllocation),
  );
  const totalAllocation = allocations.reduce(
    (sum, allocation) => sum + allocation,
    BigInt(0),
  );

  return {
    recipients: addresses,
    allocations,
    totalAllocation,
    distributionIncentive: SPLIT_DISTRIBUTION_INCENTIVE,
  };
}
