'use client';

import { useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import {
  createWalletClient,
  custom,
  parseEther,
  createPublicClient,
  http,
} from 'viem';
import { base } from 'viem/chains';
import earnkitABI from '@/contract/earnkit_ABI.json';
import { type Abi, type Hex } from 'viem';

const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS ||
  '0x7476904a549AA6baeAFEa38070907DD5FB63c5Ac';
const CONTRACT_ABI = earnkitABI as unknown as Abi;

interface WithdrawData {
  agentId: string;
  amount: string;
  to: string;
}

interface FeeCalculation {
  amount: number;
  fee: number;
  net: number;
  platformFeeBps: number;
}

export function useWithdraw(agentId: string) {
  const [loading, setLoading] = useState(false);
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();

  // Function to get platform fee from contract
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
      // Default to 5% (500 basis points) if contract call fails
      return 500;
    }
  };

  // Function to get current ETH price in USD
  const getEthPrice = async (): Promise<number> => {
    try {
      const { priceService } = await import('@/lib/priceService');
      return await priceService.getEthPrice();
    } catch (error) {
      console.error('Error getting ETH price:', error);
      return 3000; // Default fallback price
    }
  };

  // Function to convert USD to ETH
  const convertUsdToEth = async (usdAmount: number): Promise<string> => {
    const ethPrice = await getEthPrice();
    const ethAmount = usdAmount / ethPrice;
    return ethAmount.toString();
  };

  // Function to calculate fees
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

      // Convert agentId to bytes32
      const { keccak256, encodePacked } = await import('viem');
      const agentIdBytes32 = keccak256(
        encodePacked(['string'], [withdrawData.agentId]),
      );

      // Convert USD amount to ETH and then to wei for contract
      const usdAmount = parseFloat(withdrawData.amount);
      const ethAmount = await convertUsdToEth(usdAmount);
      const amountInWei = parseEther(ethAmount);

      // Execute the withdrawal transaction
      const txHash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: 'withdraw',
        args: [agentIdBytes32, amountInWei, withdrawData.to as `0x${string}`],
      });

      // Calculate fees for database recording (in USD)
      const feeCalculation = await calculateFees(usdAmount);

      // Record the transaction in the database (using USD values)
      try {
        await fetch(`/api/agents/${agentId}/withdraw/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transactionHash: txHash,
            agentId: withdrawData.agentId,
            fromAddress: wallet.address,
            fee: feeCalculation.fee,
            netAmount: feeCalculation.net,
            toAddress: withdrawData.to,
            amount: usdAmount,
          }),
        });
      } catch (error) {
        console.error('Error recording transaction in database:', error);
        // Don't throw error here as the transaction was successful
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

  return {
    executeWithdrawal,
    calculateFees,
    loading,
    isReady: ready && authenticated,
  };
}
