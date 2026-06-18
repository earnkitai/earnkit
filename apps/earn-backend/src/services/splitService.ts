import { SplitsClient } from '@0xsplits/splits-sdk';
import { createPublicClient, createWalletClient, http, zeroAddress } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

export interface DeploySplitParams {
  developerWalletAddress: string;
  buybackAddress?: string;
  // 0–100; dev gets (100 - buybackPercent)%
  buybackPercent?: number;
}

/**
 * Deploy a SplitV2 contract for a new agent.
 *
 * Revenue split (all percentages env-driven, defaults shown):
 *   SPLITS_MINI_BUYBACK_PERCENT%   (10) → SPLITS_MINI_BUYBACK_WALLET
 *   SPLITS_PLATFORM_FEE_PERCENT%   (10) → SPLITS_PLATFORM_FEE_WALLET
 *   USER_PERCENT (= 100 - mini - platform, i.e. 80) → the developer, MINUS
 *     any configured buyback which is drawn out of the user's cut:
 *       buybackPercent%            → buybackAddress (optional, developer-controlled)
 *       (USER_PERCENT - buyback)%  → developerWalletAddress
 *
 * buybackPercent is a % of TOTAL revenue, capped at USER_PERCENT (it can only
 * eat into the user's slice, never the MINI buyback or platform fee).
 *
 * The split is IMMUTABLE: ownerAddress is the zero address, so no one (not even
 * the EarnKit deployer) can ever change the recipients or allocations after
 * deploy. This is a trust guarantee — the agent's revenue routing is fixed.
 */
export async function deploySplitForAgent(
  params: DeploySplitParams,
): Promise<{ splitAddress: string; txHash: string }> {
  const { developerWalletAddress, buybackAddress, buybackPercent = 0 } = params;

  const deployerPrivateKey = process.env.SPLITS_DEPLOYER_PRIVATE_KEY;
  if (!deployerPrivateKey) {
    throw new Error('SPLITS_DEPLOYER_PRIVATE_KEY is not configured');
  }

  // Env-driven split config. Defaults: 10% MINI buyback, 10% platform fee,
  // remainder (80%) to the user — from which the configurable buyback is drawn.
  const MINI_PCT = Number(process.env.SPLITS_MINI_BUYBACK_PERCENT ?? 10);
  const PLATFORM_PCT = Number(process.env.SPLITS_PLATFORM_FEE_PERCENT ?? 10);
  const MINI_WALLET = process.env.SPLITS_MINI_BUYBACK_WALLET;
  const PLATFORM_WALLET = process.env.SPLITS_PLATFORM_FEE_WALLET;

  if (!MINI_WALLET) {
    throw new Error('SPLITS_MINI_BUYBACK_WALLET is not configured');
  }
  if (!PLATFORM_WALLET) {
    throw new Error('SPLITS_PLATFORM_FEE_WALLET is not configured');
  }
  if (
    !Number.isFinite(MINI_PCT) ||
    !Number.isFinite(PLATFORM_PCT) ||
    MINI_PCT < 0 ||
    PLATFORM_PCT < 0 ||
    MINI_PCT + PLATFORM_PCT >= 100
  ) {
    throw new Error(
      `Invalid split fee config: MINI ${MINI_PCT}% + platform ${PLATFORM_PCT}% must each be >= 0 and sum to < 100`,
    );
  }

  // User (developer) cut before any buyback is drawn off.
  const USER_PERCENT = 100 - MINI_PCT - PLATFORM_PCT;

  if (buybackPercent < 0 || buybackPercent > USER_PERCENT) {
    throw new Error(
      `buybackPercent must be between 0 and ${USER_PERCENT} (it is drawn from the user's ${USER_PERCENT}% cut)`,
    );
  }

  // Buyback is drawn out of the user's cut; the remainder goes to the user.
  const hasBuyback = buybackPercent > 0 && !!buybackAddress;
  const devPercent = USER_PERCENT - (hasBuyback ? buybackPercent : 0);

  const account = privateKeyToAccount(deployerPrivateKey as `0x${string}`);
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
  });

  const splitsClient = new SplitsClient({
    chainId: 8453,
    publicClient: publicClient as any,
    walletClient: walletClient as any,
  });

  // 0xSplits requires every recipient's percentAllocation > 0 and the set to
  // sum to 100, so a 0% slice (e.g. dev when buyback == USER_PERCENT) is omitted.
  const recipients: { address: `0x${string}`; percentAllocation: number }[] = [
    ...(devPercent > 0
      ? [
          {
            address: developerWalletAddress as `0x${string}`,
            percentAllocation: devPercent,
          },
        ]
      : []),
    ...(hasBuyback
      ? [
          {
            address: buybackAddress as `0x${string}`,
            percentAllocation: buybackPercent,
          },
        ]
      : []),
    { address: MINI_WALLET as `0x${string}`, percentAllocation: MINI_PCT },
    {
      address: PLATFORM_WALLET as `0x${string}`,
      percentAllocation: PLATFORM_PCT,
    },
  ];

  const result = await splitsClient.splitV2.createSplit({
    recipients,
    distributorFeePercent: 0,
    // Zero owner = immutable split. Recipients/allocations can never be changed
    // after deploy — not even by the deployer.
    ownerAddress: zeroAddress,
    creatorAddress: account.address,
  });

  if (!result.splitAddress) {
    throw new Error('Split deployment succeeded but returned null splitAddress');
  }

  const splitAddress: string = result.splitAddress;

  console.log(
    `[splitService] Deployed SplitV2 at ${splitAddress} (tx: ${result.event.transactionHash})`,
  );

  return {
    splitAddress,
    txHash: result.event.transactionHash as string,
  };
}
