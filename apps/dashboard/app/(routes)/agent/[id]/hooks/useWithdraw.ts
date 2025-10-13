'use client';

import { useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom } from 'viem';
import { base } from 'viem/chains';
import earnkitABI from '@/contract/earnkit_new_ABI.json';
import { type Abi, type Hex } from 'viem';

const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS ||
  '0x1890E082F6eC52c149494C93d417D549FF36fBd8';
const CONTRACT_ABI = earnkitABI as unknown as Abi;

interface WithdrawData {
  signature: {
    v: number;
    r: string;
    s: string;
  };
  withdrawal: {
    agentId: string;
    amount: string;
    to: string;
    deadline: string;
    totalAmount: {
      eth: number;
      usd: number;
    };
    fee: {
      eth: number;
      usd: number;
    };
    net: {
      eth: number;
      usd: number;
    };
    recipient: string;
  };
}

export function useWithdraw(agentId: string) {
  const [loading, setLoading] = useState(false);
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();

  const executeWithdrawal = async (withdrawData: WithdrawData) => {
    if (!ready || !authenticated || !user) {
      throw new Error('User not authenticated');
    }

    setLoading(true);

    try {
      // Get the user's wallet from Privy
      // const wallet = wallets[0];
      const wallet = wallets.find(
        (wallet) => wallet.connectorType === 'injected',
      );
      console.log(wallets, 'wallets');
      if (!wallet) {
        throw new Error('No wallet connected');
      }

      // Get the Ethereum provider from Privy
      const provider = await wallet.getEthereumProvider();

      // Create wallet client using Privy's provider
      const walletClient = createWalletClient({
        account: wallet.address as Hex,
        chain: base,
        transport: custom(provider),
      });

      // Execute the withdrawal transaction
      const txHash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: 'withdrawWithAuthorization',
        args: [
          withdrawData.withdrawal.agentId as `0x${string}`,
          BigInt(withdrawData.withdrawal.amount),
          withdrawData.withdrawal.to as `0x${string}`,
          BigInt(withdrawData.withdrawal.deadline),
          withdrawData.signature.v,
          withdrawData.signature.r as `0x${string}`,
          withdrawData.signature.s as `0x${string}`,
        ],
      });

      // Record the transaction in the database
      try {
        await fetch(`/api/agents/${agentId}/withdraw/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transactionHash: txHash,
            agentId: withdrawData.withdrawal.agentId,
            fromAddress: wallet.address,
            toAddress: withdrawData.withdrawal.to,
            amount: withdrawData.withdrawal.totalAmount.usd,
            fee: withdrawData.withdrawal.fee.usd,
            netAmount: withdrawData.withdrawal.net.usd,
          }),
        });
      } catch (error) {
        console.error('Error recording transaction in database:', error);
        // Don't throw error here as the transaction was successful
      }

      return {
        success: true,
        transactionHash: txHash,
        withdrawal: withdrawData.withdrawal,
      };
    } catch (error) {
      console.error('Error executing withdrawal:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    executeWithdrawal,
    loading,
    isReady: ready && authenticated,
  };
}
