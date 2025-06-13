import {
  Alchemy,
  AlchemyMinedTransactionsAddress,
  AlchemySubscription,
  AssetTransfersCategory,
  Network,
} from 'alchemy-sdk';
import {
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
import { sepolia, baseSepolia, base } from 'viem/chains';

import { env } from '@/env.mjs';
import type { AlchemyMinedTransaction, Transaction } from '@/types/web3';
import { turnkeyConfig } from '@/config/privy';

const clients = {
  base: createPublicClient({
    chain: base,
    transport: http(turnkeyConfig.rpcUrlBase),
  }),
  ethereum: createPublicClient({
    chain: sepolia,
    transport: http(turnkeyConfig.rpcUrl),
  }),
  baseSepolia: createPublicClient({
    chain: baseSepolia,
    transport: http(turnkeyConfig.rpcUrlBaseSepolia),
  }),
} as const;

export const getPublicClient = (
  network: 'base' | 'ethereum' | 'baseSepolia' = 'base',
) => {
  return clients[network];
};

const settings = {
  apiKey: env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.BASE_MAINNET,
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
  network: 'ethereum' | 'base' | 'baseSepolia' = 'ethereum',
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
  network: 'ethereum' | 'base' | 'baseSepolia' = 'ethereum',
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
        // AssetTransfersCategory.EXTERNAL,
        // AssetTransfersCategory.INTERNAL,
      ],
      withMetadata: true,
    }),
    alchemy.core.getAssetTransfers({
      toAddress: address,
      excludeZeroValue: false,
      category: [
        AssetTransfersCategory.ERC20,
        // AssetTransfersCategory.EXTERNAL,
        // AssetTransfersCategory.INTERNAL,
      ],
      withMetadata: true,
    }),
  ]);

  // console.log(sentResponse, 'sentResponse');
  // console.log(receivedResponse, 'receivedResponse');
  // Combine and map the responses
  const transactions = [
    ...sentResponse.transfers.map(
      ({ blockNum, from, to, hash, value, metadata, asset }) => ({
        asset: asset ?? '',
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
      ({ blockNum, from, to, hash, value, metadata, asset }) => ({
        asset: asset ?? '',
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

let injectedClient: WalletClient;
export const getInjectedWalletClient = async () => {
  if (!injectedClient) {
    const [account] = await window.ethereum!.request({
      method: 'eth_requestAccounts',
    });

    const client = createWalletClient({
      account,
      chain: base,
      transport: http(turnkeyConfig.rpcUrlBase),
    });

    injectedClient = client;
  }

  return injectedClient;
};

export const chainIdMap: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  optimism: 10,
  arbitrum: 42161,
  base: 8453,
  bnb: 56,
  avalanche: 43114,
  fantom: 250,
  gnosis: 100,
  celo: 42220,
  sepolia: 11155111,
  goerli: 5,
  polygon_mumbai: 80001,
  base_sepolia: 84532,
};
