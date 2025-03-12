'use server';

import { Alchemy, AssetTransfersCategory, Network } from 'alchemy-sdk';
import { Address, getAddress, parseEther } from 'viem';

import { env } from '@/env.mjs';
import type { Transaction } from '@/types/web3';

const sepoliaSettings = {
  apiKey: env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.ETH_SEPOLIA,
  connectionInfoOverrides: {
    skipFetchSetup: true,
  },
};

const baseSepoliaSettings = {
  apiKey: env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.BASE_SEPOLIA,
  connectionInfoOverrides: {
    skipFetchSetup: true,
  },
};

const sepoliaAlchemy = new Alchemy(sepoliaSettings);
const baseSepoliaAlchemy = new Alchemy(baseSepoliaSettings);

export const getBalance = async (
  address: Address,
  network: 'ethereum' | 'base' = 'ethereum',
) => {
  const client = network === 'ethereum' ? sepoliaAlchemy : baseSepoliaAlchemy;
  const response = await client.core.getBalance(address, 'latest');
  const balanceBigInt = BigInt(response.toString());
  return balanceBigInt;
};

export const getTokenBalance = async (address: Address) => {
  const tokenBalances = await sepoliaAlchemy.core.getTokenBalances(address);
  return tokenBalances;
};

export const getTransactions = async (
  address: Address,
): Promise<Record<string, Transaction[]>> => {
  // Fetch sent and received transactions concurrently
  const [sentResponse, receivedResponse] = await Promise.all([
    sepoliaAlchemy.core.getAssetTransfers({
      fromAddress: address,
      excludeZeroValue: false,
      category: [
        AssetTransfersCategory.ERC20,
        AssetTransfersCategory.EXTERNAL,
        AssetTransfersCategory.INTERNAL,
      ],
      withMetadata: true,
    }),
    sepoliaAlchemy.core.getAssetTransfers({
      toAddress: address,
      excludeZeroValue: false,
      category: [
        AssetTransfersCategory.ERC20,
        AssetTransfersCategory.EXTERNAL,
        AssetTransfersCategory.INTERNAL,
      ],
      withMetadata: true,
    }),
  ]);

  // Map the responses
  const sentTransactions = [
    ...sentResponse.transfers.map(
      ({ blockNum, from, to, hash, value, metadata }) => ({
        blockNumber: Number(blockNum),
        from: getAddress(from),
        to: to ? getAddress(to) : null,
        hash,
        value: value ? parseEther(value.toString()) : null,
        status: 'sent' as const,
        timestamp: metadata.blockTimestamp,
      }),
    ),
  ];
  const receivedTransactions = [
    ...receivedResponse.transfers.map(
      ({ blockNum, from, to, hash, value, metadata }) => ({
        blockNumber: Number(blockNum),
        from: getAddress(from),
        to: to ? getAddress(to) : null,
        hash,
        value: value ? parseEther(value.toString()) : null,
        status: 'received' as const,
        timestamp: metadata.blockTimestamp,
      }),
    ),
  ];

  // Sort transactions by block number in descending order
  sentTransactions.sort((a, b) => b.blockNumber - a.blockNumber);
  receivedTransactions.sort((a, b) => b.blockNumber - a.blockNumber);

  return {
    sentTransactions,
    receivedTransactions,
  };
};

type CoinGeckoResponse = {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  // ... other fields omitted for brevity
}[];

export const extractCurrentPrice = async (
  response: CoinGeckoResponse,
): Promise<number> => {
  if (!response || response.length === 0) {
    return 0;
  }
  return response[0]?.current_price || 0;
};

export const getTokenPrice = async (token: string): Promise<number> => {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${token}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    });
    const data: CoinGeckoResponse = await response.json();
    return extractCurrentPrice(data);
  } catch (error) {
    console.error('Error fetching token price:', error);
    return 0;
  }
};
