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

const baseSettings = {
  apiKey: env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.BASE_MAINNET,
  connectionInfoOverrides: {
    skipFetchSetup: true,
  },
};
const sepoliaAlchemy = new Alchemy(sepoliaSettings);
const baseSepoliaAlchemy = new Alchemy(baseSepoliaSettings);
const baseAlchemy = new Alchemy(baseSettings);

export const getBalance = async (
  address: Address,
  network: 'ethereum' | 'base' | 'baseSepolia' = 'base',
) => {
  const client =
    network === 'base'
      ? baseAlchemy
      : network === 'baseSepolia'
        ? baseSepoliaAlchemy
        : sepoliaAlchemy;
  try {
    const response = await client.core.getBalance(address, 'latest');
    const balanceBigInt = BigInt(response.toString());
    return balanceBigInt;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message?.includes('Network error')) {
        // For UI: throw a clear error
        throw new Error(
          'Network error: Unable to fetch balance. Please check your connection or try again later.',
        );
      }
      console.error('Error fetching balance:', error);
    }
  }
};

export const getTokenBalances = async (
  address: Address,
  network: 'ethereum' | 'base' | 'baseSepolia' = 'base',
) => {
  try {
    const client =
      network === 'ethereum'
        ? sepoliaAlchemy
        : network === 'baseSepolia'
          ? baseSepoliaAlchemy
          : baseAlchemy;

    const balances = await client.core.getTokensForOwner(address);
    // remove the token with balance 0
    const filteredBalances = balances.tokens.filter(
      (token) => token.balance !== '0',
    );

    const finalBalances = await Promise.all(
      filteredBalances.map(async (token) => {
        try {
          const metadata = await getTokenMetadataWithCoingecko(
            token.contractAddress,
          );
          return { ...token, metadata };
        } catch (metaError) {
          console.error('Error fetching token metadata:', metaError);
          // Return token with minimal metadata if fetch fails
          return {
            ...token,
            metadata: {
              imageUrl: '',
              name: '',
              symbol: '',
              decimals: 18,
              priceUsd: 0,
            },
          };
        }
      }),
    );
    return finalBalances;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message?.includes('Network error')) {
        throw new Error(
          'Network error: Unable to fetch token balances. Please check your connection or try again later.',
        );
      }
    }
    console.error('Error fetching token balances:', error);
  }
};

export const getTokenBalance = async (address: Address) => {
  try {
    const tokenBalances = await sepoliaAlchemy.core.getTokenBalances(address);
    return tokenBalances;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message?.includes('Network error')) {
        throw new Error(
          'Network error: Unable to fetch token balance. Please check your connection or try again later.',
        );
      }
      console.error('Error fetching token balance:', error);
      throw new Error('Failed to fetch token balance');
    } else {
      console.error('Error fetching token balance:', error);
      throw new Error('Failed to fetch token balance');
    }
  }
};

export const getTransactions = async (
  address: Address,
): Promise<Record<string, Transaction[]>> => {
  try {
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
  } catch (error) {
    if (error instanceof Error) {
      if (error.message?.includes('Network error')) {
        throw new Error(
          'Network error: Unable to fetch transactions. Please check your connection or try again later.',
        );
      }
      console.error('Error:', error);
      throw error;
    } else {
      console.error('Error fetching transactions:', error);
      throw new Error('Failed to fetch transactions');
    }
  }
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

export type TokenMetadata = {
  imageUrl: string;
  name: string;
  symbol: string;
  decimals: number;
  priceUsd: number;
};

export const getTokenMetadataWithCoingecko = async (token: string) => {
  const url = `https://pro-api.coingecko.com/api/v3/onchain/networks/base/tokens/${token}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-cg-pro-api-key': env.COINGECKO_API_KEY,
    },
  });
  const data = await response.json();

  // Extract only the required fields
  const metadata: TokenMetadata = {
    imageUrl: data.data?.attributes?.image_url,
    name: data.data?.attributes?.name,
    symbol: data.data?.attributes?.symbol,
    decimals: data.data?.attributes?.decimals,
    priceUsd: Number(data.data?.attributes?.price_usd),
  };

  return metadata;
};

export const getTokenMetadataBasedOnChain = async (
  token: string,
  network: string,
) => {
  const url = `https://pro-api.coingecko.com/api/v3/onchain/networks/${network === 'ethereum' ? 'eth' : network}/tokens/${token}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-cg-pro-api-key': env.COINGECKO_API_KEY,
    },
  });
  const data = await response.json();

  // Extract only the required fields
  const metadata: TokenMetadata = {
    imageUrl: data.data?.attributes?.image_url,
    name: data.data?.attributes?.name,
    symbol: data.data?.attributes?.symbol,
    decimals: data.data?.attributes?.decimals,
    priceUsd: Number(data.data?.attributes?.price_usd),
  };

  return metadata;
};
