'use client';

import { useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom, createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import earnkitABI from '@/contract/earnkit_ABI.json';
import {
  buildSplitDistributionConfig,
  SPLIT_DISTRIBUTE_ABI,
  SPLIT_NATIVE_TOKEN_ADDRESS,
  type SplitRecipientConfig,
} from '@/lib/payment-routing';
import { type Abi, type Hex } from 'viem';

const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS ||
  '0xCAeB6A62D04C52E1e196E5Bdce63e43f45582aA2';
const CONTRACT_ABI = earnkitABI as unknown as Abi;

interface WithdrawData {
  agentId: string;
  amount: string;
  amountWei?: string;
  to: string;
}

interface TokenWithdrawData {
  agentId: string;
  tokenAddress: string;
  tokenSymbol: string;
  amount: string;
  to: string;
}

interface SplitDistributionAsset {
  symbol: string;
  amount: string;
  amountUsd: number;
  tokenAddress?: string;
}

interface SplitDistributionData {
  splitAddress: string;
  paymentAddress: string;
  recipients: SplitRecipientConfig[];
  assets: SplitDistributionAsset[];
}

interface FeeCalculation {
  amount: number;
  fee: number;
  net: number;
  platformFeeBps: number;
}

export function useWithdraw(agentDbId: string, agentSlug: string) {
  const [loading, setLoading] = useState(false);
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();

  const getInjectedWallet = () => {
    const wallet = wallets.find((candidate) => candidate.connectorType === 'injected');

    if (!wallet) {
      throw new Error('No wallet connected');
    }

    return wallet;
  };

  const getPlatformFee = async (): Promise<number> => {
    try {
      const publicClient = createPublicClient({
        chain: base,
        transport: http(),
      });

      const platformFeeBps = await publicClient.readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: 'platformFeeBps',
      });

      return Number(platformFeeBps);
    } catch (error) {
      console.error('Error getting platform fee:', error);
      return 500;
    }
  };

  const calculateFees = async (amount: number): Promise<FeeCalculation> => {
    const platformFeeBps = await getPlatformFee();
    const fee = (amount * platformFeeBps) / 10000;
    const net = amount - fee;

    return {
      amount,
      fee,
      net,
      platformFeeBps,
    };
  };

  const executeWithdrawal = async (withdrawData: WithdrawData) => {
    if (!ready || !authenticated || !user) {
      throw new Error('User not authenticated');
    }

    setLoading(true);

    try {
      const wallet = getInjectedWallet();

      const signatureResponse = await fetch(`/api/agents/${agentDbId}/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: withdrawData.amount,
          amountWei: withdrawData.amountWei,
          toAddress: withdrawData.to,
        }),
      });

      if (!signatureResponse.ok) {
        const errorData = await signatureResponse.json();
        throw new Error(errorData.error || 'Failed to get withdrawal signature');
      }

      const signatureData = await signatureResponse.json();

      if (signatureData.withdrawalMode === 'splits') {
        return {
          success: true,
          withdrawalMode: 'splits' as const,
          splitAddress: signatureData.splitAddress as string,
          message: signatureData.message as string,
          transactionHash: '',
          withdrawal: withdrawData,
        };
      }

      if (!signatureData.success || !signatureData.signature) {
        throw new Error('Invalid signature response from server');
      }

      await wallet.switchChain(base.id);

      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: wallet.address as Hex,
        chain: base,
        transport: custom(provider),
      });

      const { v, r, s } = signatureData.signature;
      const { agentId: agentIdBytes32, amount, to, deadline } = signatureData.withdrawal;

      const txHash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: 'withdrawWithSig',
        args: [
          agentIdBytes32 as `0x${string}`,
          BigInt(amount),
          to as `0x${string}`,
          BigInt(deadline),
          v,
          r as `0x${string}`,
          s as `0x${string}`,
        ],
      });

      try {
        await fetch(`/api/agents/${agentDbId}/withdraw/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transactionHash: txHash,
            agentId: withdrawData.agentId,
            fromAddress: wallet.address,
            fee: signatureData.withdrawal.fee.usd,
            netAmount: signatureData.withdrawal.net.usd,
            toAddress: withdrawData.to,
            amount: signatureData.withdrawal.totalAmount.usd,
            withdrawalMode: 'escrow',
          }),
        });
      } catch (error) {
        console.error('Error recording transaction in database:', error);
      }

      return {
        success: true,
        transactionHash: txHash,
        withdrawal: withdrawData,
      };
    } catch (error) {
      console.error('Error executing withdrawal:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const executeTokenWithdrawal = async (withdrawData: TokenWithdrawData) => {
    if (!ready || !authenticated || !user) {
      throw new Error('User not authenticated');
    }

    setLoading(true);

    try {
      const wallet = getInjectedWallet();

      const signatureResponse = await fetch(`/api/agents/${agentDbId}/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: withdrawData.amount,
          toAddress: withdrawData.to,
          tokenAddress: withdrawData.tokenAddress,
          tokenSymbol: withdrawData.tokenSymbol,
        }),
      });

      if (!signatureResponse.ok) {
        const errorData = await signatureResponse.json();
        throw new Error(errorData.error || 'Failed to get withdrawal signature');
      }

      const signatureData = await signatureResponse.json();

      if (signatureData.withdrawalMode === 'splits') {
        return {
          success: true,
          withdrawalMode: 'splits' as const,
          splitAddress: signatureData.splitAddress as string,
          message: signatureData.message as string,
          transactionHash: '',
          withdrawal: withdrawData,
        };
      }

      if (!signatureData.success || !signatureData.signature) {
        throw new Error('Invalid signature response from server');
      }

      await wallet.switchChain(base.id);

      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: wallet.address as Hex,
        chain: base,
        transport: custom(provider),
      });

      const { v, r, s } = signatureData.signature;
      const { agentId: agentIdBytes32, amount, to, deadline, tokenAddress: token } = signatureData.withdrawal;

      const txHash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: 'withdrawTokenWithSig',
        args: [
          agentIdBytes32 as `0x${string}`,
          token as `0x${string}`,
          BigInt(amount),
          to as `0x${string}`,
          BigInt(deadline),
          v,
          r as `0x${string}`,
          s as `0x${string}`,
        ],
      });

      try {
        await fetch(`/api/agents/${agentDbId}/withdraw/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transactionHash: txHash,
            agentId: withdrawData.agentId,
            fromAddress: wallet.address,
            fee: signatureData.withdrawal.fee,
            netAmount: signatureData.withdrawal.net,
            toAddress: withdrawData.to,
            amount: signatureData.withdrawal.totalAmount,
            tokenAddress: withdrawData.tokenAddress,
            tokenSymbol: withdrawData.tokenSymbol,
            withdrawalMode: 'escrow',
          }),
        });
      } catch (error) {
        console.error('Error recording token transaction in database:', error);
      }

      return {
        success: true,
        transactionHash: txHash,
        withdrawal: withdrawData,
      };
    } catch (error) {
      console.error('Error executing token withdrawal:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const executeSplitDistribution = async (
    distributionData: SplitDistributionData,
  ) => {
    if (!ready || !authenticated || !user) {
      throw new Error('User not authenticated');
    }

    if (distributionData.recipients.length < 2) {
      throw new Error('Split recipient configuration is incomplete');
    }

    const assetsToDistribute = distributionData.assets.filter((asset) => {
      return parseFloat(asset.amount) > 0;
    });

    if (assetsToDistribute.length === 0) {
      throw new Error('No split funds are currently available to distribute');
    }

    setLoading(true);

    try {
      const wallet = getInjectedWallet();
      await wallet.switchChain(base.id);
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: wallet.address as Hex,
        chain: base,
        transport: custom(provider),
      });
      const publicClient = createPublicClient({
        chain: base,
        transport: http(),
      });
      const splitConfig = buildSplitDistributionConfig(
        distributionData.recipients,
      );
      const transactionHashes: string[] = [];

      for (const asset of assetsToDistribute) {
        const tokenAddress = (asset.tokenAddress ||
          SPLIT_NATIVE_TOKEN_ADDRESS) as `0x${string}`;

        const txHash = await walletClient.writeContract({
          address: distributionData.splitAddress as `0x${string}`,
          abi: SPLIT_DISTRIBUTE_ABI,
          functionName: 'distribute',
          args: [splitConfig, tokenAddress, wallet.address as `0x${string}`],
        });

        transactionHashes.push(txHash);

        await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });

        try {
          await fetch(`/api/agents/${agentDbId}/withdraw/confirm`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              transactionHash: txHash,
              agentId: agentSlug,
              fromAddress: wallet.address,
              toAddress: distributionData.splitAddress,
              amount: asset.amountUsd,
              withdrawalMode: 'splits',
              paymentAddress: distributionData.paymentAddress,
              assetSymbol: asset.symbol,
              assetAddress: asset.tokenAddress,
              assetAmount: asset.amount,
              metadata: {
                recipients: distributionData.recipients,
              },
            }),
          });
        } catch (error) {
          console.error('Error recording split distribution:', error);
        }
      }

      return {
        success: true,
        withdrawalMode: 'splits' as const,
        transactionHashes,
        distributedAssets: assetsToDistribute,
      };
    } catch (error) {
      console.error('Error executing split distribution:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    executeWithdrawal,
    executeTokenWithdrawal,
    executeSplitDistribution,
    calculateFees,
    loading,
    isReady: ready && authenticated,
  };
}
