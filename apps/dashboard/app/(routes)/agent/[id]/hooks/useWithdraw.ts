'use client';

import { useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import {
  createWalletClient,
  custom,
  createPublicClient,
  http,
} from 'viem';
import { base } from 'viem/chains';
import earnkitABI from '@/contract/earnkit_ABI.json';
import { type Abi, type Hex } from 'viem';

const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS ||
  '0xCAeB6A62D04C52E1e196E5Bdce63e43f45582aA2';
const CONTRACT_ABI = earnkitABI as unknown as Abi;

interface WithdrawData {
  agentId: string;
  amount: string;
  to: string;
}

interface TokenWithdrawData {
  agentId: string;
  tokenAddress: string;
  tokenSymbol: string;
  amount: string; // Raw token amount (not in smallest units)
  to: string;
}

interface FeeCalculation {
  amount: number;
  fee: number;
  net: number;
  platformFeeBps: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useWithdraw(agentDbId: string, agentSlug: string) {
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

  // Execute ETH withdrawal using withdrawWithSig (gasless with platform signature)
  // Any wallet can pay gas, funds go to the specified recipient (can be multisig)
  const executeWithdrawal = async (withdrawData: WithdrawData) => {
    if (!ready || !authenticated || !user) {
      throw new Error('User not authenticated');
    }

    setLoading(true);

    try {
      // Get the user's wallet from Privy (this wallet pays gas, not necessarily the recipient)
      const wallet = wallets.find(
        (wallet) => wallet.connectorType === 'injected',
      );
      console.log(wallets, 'wallets');
      if (!wallet) {
        throw new Error('No wallet connected');
      }

      // Step 1: Get signature from backend
      console.log('Requesting ETH withdrawal signature from backend...');
      const signatureResponse = await fetch(`/api/agents/${agentDbId}/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: withdrawData.amount, // USD amount
          toAddress: withdrawData.to,
        }),
      });

      if (!signatureResponse.ok) {
        const errorData = await signatureResponse.json();
        throw new Error(errorData.error || 'Failed to get withdrawal signature');
      }

      const signatureData = await signatureResponse.json();
      console.log('Signature data received:', signatureData);

      // Splits agents: distribute() is permissionless — no EIP-712 needed
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

      // Step 2: Execute withdrawWithSig with the platform's signature
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: wallet.address as Hex,
        chain: base,
        transport: custom(provider),
      });

      const { v, r, s } = signatureData.signature;
      const { agentId: agentIdBytes32, amount, to, deadline } = signatureData.withdrawal;

      console.log('Executing withdrawWithSig with params:', {
        agentIdBytes32,
        amount,
        to,
        deadline,
        v,
        r,
        s,
      });

      // Execute the ETH withdrawal transaction with signature
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

      console.log('ETH withdrawal transaction hash:', txHash);

      // Record the transaction in the database
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

  // Execute token withdrawal using withdrawTokenWithSig (gasless with platform signature)
  const executeTokenWithdrawal = async (withdrawData: TokenWithdrawData) => {
    if (!ready || !authenticated || !user) {
      throw new Error('User not authenticated');
    }

    setLoading(true);

    try {
      // Get the user's wallet from Privy
      const wallet = wallets.find(
        (wallet) => wallet.connectorType === 'injected',
      );
      console.log(wallets, 'wallets');
      if (!wallet) {
        throw new Error('No wallet connected');
      }

      // Step 1: Get signature from backend (use agentDbId for API)
      console.log('Requesting token withdrawal signature from backend...');
      const signatureResponse = await fetch(`/api/agents/${agentDbId}/withdraw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: withdrawData.amount, // Raw token amount
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
      console.log('Signature data received:', signatureData);

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

      // Step 2: Execute withdrawTokenWithSig with the platform's signature
      const provider = await wallet.getEthereumProvider();
      const walletClient = createWalletClient({
        account: wallet.address as Hex,
        chain: base,
        transport: custom(provider),
      });

      const { v, r, s } = signatureData.signature;
      const { agentId: agentIdBytes32, amount, to, deadline, tokenAddress: token } = signatureData.withdrawal;

      console.log('Executing withdrawTokenWithSig with params:', {
        agentIdBytes32,
        token,
        amount,
        to,
        deadline,
        v,
        r,
        s,
      });

      // Execute the token withdrawal transaction with signature
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

      console.log('Token withdrawal transaction hash:', txHash);

      // Record the transaction in the database (use agentDbId for API)
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
          }),
        });
      } catch (error) {
        console.error('Error recording token transaction in database:', error);
        // Don't throw error here as the transaction was successful
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

  return {
    executeWithdrawal,
    executeTokenWithdrawal,
    calculateFees,
    loading,
    isReady: ready && authenticated,
  };
}
