import { SplitsClient } from '@0xsplits/splits-sdk';
import { createPublicClient, createWalletClient, http } from 'viem';
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
 * Revenue split:
 *   buybackPercent%         → buybackAddress (developer-controlled, optional)
 *   (100 - buybackPercent)% → developerWalletAddress
 *
 * Platform fee is 0% — 100% of revenue goes to the developer.
 * Split owner = EarnKit deployer so recipients can be updated later if needed.
 */
export async function deploySplitForAgent(
  params: DeploySplitParams,
): Promise<{ splitAddress: string; txHash: string }> {
  const { developerWalletAddress, buybackAddress, buybackPercent = 0 } = params;

  const deployerPrivateKey = process.env.SPLITS_DEPLOYER_PRIVATE_KEY;
  if (!deployerPrivateKey) {
    throw new Error('SPLITS_DEPLOYER_PRIVATE_KEY is not configured');
  }

  if (buybackPercent < 0 || buybackPercent > 100) {
    throw new Error('buybackPercent must be between 0 and 100');
  }

  const devPercent = 100 - buybackPercent;

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
