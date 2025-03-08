import { TurnkeyBrowserClient } from '@turnkey/sdk-browser';
import { TurnkeyServerClient } from '@turnkey/sdk-server';
import { createAccount } from '@turnkey/viem';
import {
  Alchemy,
  AlchemyMinedTransactionsAddress,
  AlchemySubscription,
  AssetTransfersCategory,
  Network,
} from 'alchemy-sdk';
import {
  Account,
  Address,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseEther,
  PublicClient,
  WalletClient,
  webSocket,
} from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';

import { env } from '@/env.mjs';
import type { AlchemyMinedTransaction, Transaction } from '@/types/web3';
import { turnkeyConfig } from '@/config/turnkey';

const clients = {
  ethereum: createPublicClient({
    chain: sepolia,
    transport: http(turnkeyConfig.rpcUrl),
  }),
  base: createPublicClient({
    chain: baseSepolia,
    transport: http(turnkeyConfig.rpcUrlBase),
  }),
} as const;

export const getPublicClient = (network: 'ethereum' | 'base' = 'ethereum') => {
  return clients[network];
};

const settings = {
  apiKey: env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.BASE_SEPOLIA,
};

const alchemy = new Alchemy(settings);

export const watchMinedTransactions = (
  address: Address,
  callback: (tx: Transaction) => void,
) => {
  const addressPairs: [
    AlchemyMinedTransactionsAddress,
    ...AlchemyMinedTransactionsAddress[],
  ] = [{ from: address }, { to: address }] as [
    AlchemyMinedTransactionsAddress,
    ...AlchemyMinedTransactionsAddress[],
  ];

  alchemy.ws.on(
    {
      method: AlchemySubscription.MINED_TRANSACTIONS,
      addresses: addressPairs,
      includeRemoved: true,
      hashesOnly: false,
    },
    ({ transaction }: AlchemyMinedTransaction) => {
      // Convert addresses to checksummed addresses before comparison
      const { from, to } = {
        from: getAddress(transaction.from),
        to: getAddress(transaction.to),
      };
      const txn: Transaction = {
        hash: transaction.hash,
        blockNumber: parseInt(transaction.blockNumber, 16),
        value: BigInt(transaction.value),
        from,
        to,
        status: from === address ? 'sent' : 'received',
        timestamp: new Date().toISOString(),
      };

      callback?.(txn);
    },
  );
  return () => {
    alchemy.ws.off(AlchemySubscription.MINED_TRANSACTIONS);
  };
};

let webSocketClient: PublicClient;

const getWebSocketClient = () => {
  if (!webSocketClient) {
    webSocketClient = createPublicClient({
      chain: sepolia,
      transport: webSocket('wss://ethereum-sepolia-rpc.publicnode.com'),
    });
  }
  return webSocketClient;
};

export const watchPendingTransactions = (
  address: Address,
  network: 'ethereum' | 'base' = 'ethereum',
  callback: (tx: Transaction) => void,
) => {
  const webSocketClient = getWebSocketClient();
  const publicClient = getPublicClient(network);
  const unwatch = webSocketClient.watchPendingTransactions({
    onTransactions: (hashes) => {
      hashes.forEach(async (hash) => {
        const tx = await publicClient.getTransaction({ hash });
        if (tx && (tx.from === address || tx.to === address)) {
          const transaction: Transaction = {
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: tx.value,
            blockNumber: tx.blockNumber ? Number(tx.blockNumber) : null,
            status: tx.from === address ? 'sent' : 'received',
            timestamp: new Date().toISOString(),
          };
          callback(transaction);
        }
      });
    },
  });

  return unwatch;
};

export const getBalance = async (
  address: Address,
  network: 'ethereum' | 'base' = 'ethereum',
) => {
  const publicClient = getPublicClient(network);
  const balance = await publicClient.getBalance({
    address,
  });

  return balance;
};

export const getTransactions = async (
  address: Address,
): Promise<Transaction[]> => {
  // Fetch sent and received transactions concurrently
  const [sentResponse, receivedResponse] = await Promise.all([
    alchemy.core.getAssetTransfers({
      fromAddress: address,
      excludeZeroValue: false,
      category: [
        AssetTransfersCategory.ERC20,
        AssetTransfersCategory.EXTERNAL,
        AssetTransfersCategory.INTERNAL,
      ],
      withMetadata: true,
    }),
    alchemy.core.getAssetTransfers({
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

  // Combine and map the responses
  const transactions = [
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
  transactions.sort((a, b) => b.blockNumber - a.blockNumber);

  return transactions;
};

/**
 * Creates and returns a wallet client for interacting with the Turnkey API using a specified account.
 *
 * @param {TurnkeyBrowserClient} turnkeyClient - The Turnkey client instance used for the API connection.
 * @param {string} signWith - The Turnkey wallet account address or private key ID used to sign transactions
 * @returns {Promise<WalletClient>} A promise that resolves to the wallet client configured for the specified account and chain.
 */
export const getTurnkeyWalletClient = async (
  turnkeyClient: TurnkeyBrowserClient | TurnkeyServerClient,
  accountAddress: string,
) => {
  // Create a new account using the provided Turnkey client and the specified account for signing
  const turnkeyAccount = await createAccount({
    // @ts-expect-error - Turnkey types are not fully compatible with viem
    client: turnkeyClient,
    organizationId: process.env.ORGANIZATION_ID!,
    signWith: accountAddress,
  });

  // Create a wallet client using the newly created account, targeting the Sepolia chain
  const client = createWalletClient({
    account: turnkeyAccount as Account,
    chain: sepolia,
    transport: http(turnkeyConfig.rpcUrl),
  });

  return client;
};

let injectedClient: WalletClient;
export const getInjectedWalletClient = async () => {
  if (!injectedClient) {
    const [account] = await window.ethereum!.request({
      method: 'eth_requestAccounts',
    });

    const client = createWalletClient({
      account,
      chain: sepolia,
      transport: http(),
    });

    injectedClient = client;
  }

  return injectedClient;
};
