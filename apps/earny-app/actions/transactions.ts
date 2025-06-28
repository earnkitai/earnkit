'use server';

import { PrivyClient } from '@privy-io/server-auth';
import { Address, parseEther } from 'viem';

const privy = new PrivyClient(
  process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!,
  {
    walletApi: {
      authorizationPrivateKey: process.env.AUTH_PRIVATE_KEY!,
    },
  },
);

export async function sendTransactionWithoutApproval(
  walletId: string,
  to: Address,
  amount: string,
  chainId: number = 8453, // Default to Base Sepolia
) {
  try {
    const value = parseEther(amount);

    const { hash } = await privy.walletApi.ethereum.sendTransaction({
      walletId,
      caip2: `eip155:${chainId}`,
      transaction: {
        to,
        value: BigInt(value).toString() as `0x${string}`,
        chainId,
      },
    });

    return { success: true, hash };
  } catch (error) {
    console.error('Error sending transaction:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function sendContractTransactionWithoutApproval(
  walletId: string,
  to: Address,
  data: `0x${string}`,
  chainId: number = 8453, // Default to Base Sepolia
) {
  try {
    const { hash } = await privy.walletApi.ethereum.sendTransaction({
      walletId,
      caip2: `eip155:${chainId}`,
      transaction: {
        to,
        data,
        chainId,
      },
    });

    return { success: true, hash };
  } catch (error) {
    console.error('Error sending contract transaction:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
