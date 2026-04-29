import { SplitsClient } from '@0xsplits/splits-sdk';
import { createPublicClient, createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

export interface DeploySplitParams {
  developerWalletAddress: string;
  buybackAddress?: string;
  // 0–95; platform always takes 5%, so dev gets (95 - buybackPercent)%
  buybackPercent?: number;
}

const PLATFORM_FEE_PERCENT = 5;

/**
 * Deploy a SplitV2 contract for a new agent.
 *
 * Revenue split:
 *   5%                     → PLATFORM_FEE_WALLET (EarnKit treasury)
 *   buybackPercent%        → buybackAddress (developer-controlled, optional)
 *   (95 - buybackPercent)% → developerWalletAddress
 *
 * Split owner = EarnKit deployer so platform fee recipient can change later.
 */
export async function deploySplitForAgent(
  params: DeploySplitParams,
): Promise<{ splitAddress: string; txHash: string }> {
  const { developerWalletAddress, buybackAddress, buybackPercent = 0 } = params;

  const deployerPrivateKey = process.env.SPLITS_DEPLOYER_PRIVATE_KEY;
  if (!deployerPrivateKey) {
    throw new Error('SPLITS_DEPLOYER_PRIVATE_KEY is not configured');
  }

  const platformFeeWallet = process.env.PLATFORM_FEE_WALLET;
  if (!platformFeeWallet) {
    throw new Error('PLATFORM_FEE_WALLET is not configured');
  }

  if (buybackPercent < 0 || buybackPercent > 95) {
    throw new Error('buybackPercent must be between 0 and 95');
  }

  const devPercent = 95 - buybackPercent;

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

  const recipients: { address: `0x${string}`; percentAllocation: number }[] = [
    {
      address: developerWalletAddress as `0x${string}`,
      percentAllocation: devPercent,
    },
    {
      address: platformFeeWallet as `0x${string}`,
      percentAllocation: PLATFORM_FEE_PERCENT,
    },
  ];

  if (buybackPercent > 0 && buybackAddress) {
    recipients.push({
      address: buybackAddress as `0x${string}`,
      percentAllocation: buybackPercent,
    });
  }

  const result = await splitsClient.splitV2.createSplit({
    recipients,
    distributorFeePercent: 0,
    ownerAddress: account.address,
    creatorAddress: account.address,
  });

  console.log(
    `[splitService] Deployed SplitV2 at ${result.splitAddress} (tx: ${result.event.transactionHash})`,
  );

  if (!result.splitAddress) {
    throw new Error('Split deployment succeeded but returned null splitAddress');
  }

  return {
    splitAddress: result.splitAddress,
    txHash: result.event.transactionHash,
  };
}
